import asyncio
import json
import os
import threading
from pathlib import Path
from queue import Queue, Empty

from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent.parent.resolve()
load_dotenv(BASE_DIR / ".env")

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.requests import ClientDisconnect

from langchain.agents import create_agent
from langchain_deepseek import ChatDeepSeek

from tools import TOOLS

app = FastAPI(title="LangChain Agent Chat")

app.mount("/static", StaticFiles(directory=BASE_DIR / "frontend"), name="static")


def build_llm():
    """Build the DeepSeek chat model from environment variables."""
    return ChatDeepSeek(
        model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        temperature=0.7,
    )


llm = build_llm()

# Stored in module-level variable so it can be hot-reloaded via the API
_current_system_prompt = (
    "你是一个功能强大的 AI 助手，可以使用工具来帮助用户。"
    "根据用户的问题，判断是否需要使用工具，选择最合适的工具来获取信息。"
)

SYSTEM_PROMPT = _current_system_prompt

agent = create_agent(
    model=llm,
    tools=TOOLS,
    system_prompt=SYSTEM_PROMPT,
)


def run_agent(message: str, event_queue: Queue):
    """Run the agent in a thread, pushing events into a queue as messages arrive."""
    inputs = {"messages": [{"role": "human", "content": message}]}
    last_msg_count = 0

    try:
        for chunk in agent.stream(inputs, stream_mode="values"):
            messages = chunk.get("messages", [])
            # Process any new messages since the last chunk
            for msg in messages[last_msg_count:]:
                msg_type = getattr(msg, "type", None) or type(msg).__name__
                tool_name = getattr(msg, "name", None)
                content = getattr(msg, "content", "") or ""

                if tool_name and tool_name not in ("Developer", "system"):
                    # Tool call (AIMessage with tool_calls or FunctionMessage)
                    event_queue.put({
                        "type": "tool_call",
                        "content": f"{tool_name}({content})" if content else tool_name,
                    })
                elif tool_name == "system":
                    # Agent internal thinking — not a user-facing event
                    pass
                elif "ToolMessage" in str(type(msg).__name__) or tool_name:
                    # Tool result
                    event_queue.put({
                        "type": "tool_result",
                        "content": content,
                    })
                elif "AIMessage" in str(type(msg).__name__) and not tool_name:
                    # Final answer
                    if content:
                        event_queue.put({
                            "type": "answer",
                            "content": content,
                        })

            last_msg_count = len(messages)

    except Exception as e:
        event_queue.put({"type": "error", "content": str(e)})
    finally:
        event_queue.put({"type": "done", "content": ""})


def format_sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/health")
async def health():
    return JSONResponse({"status": "ok"})


# ── System prompt management ─────────────────────────────────
@app.get("/api/system-prompt")
async def get_system_prompt():
    return JSONResponse({"system_prompt": _current_system_prompt})


@app.put("/api/system-prompt")
async def update_system_prompt(request: Request):
    body = await request.json()
    new_prompt = body.get("system_prompt", "")
    if not new_prompt.strip():
        return JSONResponse({"error": "System prompt 不能为空"}, status_code=400)

    global _current_system_prompt, SYSTEM_PROMPT, agent
    _current_system_prompt = new_prompt
    SYSTEM_PROMPT = new_prompt

    # Rebuild agent with updated prompt
    agent = create_agent(model=llm, tools=TOOLS, system_prompt=SYSTEM_PROMPT)

    return JSONResponse({"status": "ok", "system_prompt": _current_system_prompt})


@app.get("/api/tools")
async def list_tools():
    """Expose agent tool names and descriptions for the frontend."""
    out = []
    for t in TOOLS:
        out.append(
            {
                "name": getattr(t, "name", None) or str(t),
                "description": (getattr(t, "description", None) or "").strip(),
            }
        )
    return JSONResponse(out)


@app.get("/", response_class=HTMLResponse)
async def index():
    with open(BASE_DIR / "frontend" / "index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.post("/chat")
async def chat(request: Request):
    try:
        body = await request.json()
        message = body.get("message", "")
    except ClientDisconnect:
        return StreamingResponse(iter([]), media_type="text/event-stream")

    if not message:
        return StreamingResponse(
            iter([format_sse({"type": "error", "content": "消息不能为空"})]),
            media_type="text/event-stream",
        )

    event_queue: Queue = Queue()

    thread = threading.Thread(target=run_agent, args=(message, event_queue), daemon=True)
    thread.start()

    async def event_generator():
        try:
            while thread.is_alive() or not event_queue.empty():
                await asyncio.sleep(0.05)
                try:
                    while True:
                        event = event_queue.get_nowait()
                        yield format_sse(event)
                        if event["type"] == "done":
                            return
                except Empty:
                    pass

            while True:
                try:
                    event = event_queue.get_nowait()
                    yield format_sse(event)
                    if event["type"] == "done":
                        return
                except Empty:
                    return
        except ClientDisconnect:
            pass

    return StreamingResponse(event_generator(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print(" LangChain Agent 服务已启动")
    print(" http://localhost:9000/")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=9000)
