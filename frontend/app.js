/* ── State ────────────────────────────────────────────────── */
let isStreaming = false;
let currentAnswerEl = null;
let currentTraceCard = null;

/* ── Configure marked + highlight.js ───────────────────── */
if (typeof marked !== "undefined") {
  marked.setOptions({
    breaks: true,
    gfm: true,
  });
  const renderer = new marked.Renderer();

  renderer.code = function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
      } catch (_) {}
    }
    const escaped = typeof code === "string"
      ? code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      : "";
    return `<pre><code>${escaped}</code></pre>`;
  };

  renderer.codespan = function (text) {
    return `<code>${text}</code>`;
  };

  marked.use({ renderer });
}

function renderMarkdown(text) {
  if (!text) return "";
  if (typeof marked !== "undefined") {
    try { return marked.parse(text); } catch (_) {}
  }
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

/* ── DOM refs ─────────────────────────────────────────────── */
const messagesEl = document.getElementById("messages");
const traceLogEl = document.getElementById("traceLog");
const inputEl = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const toolsRegistry = document.getElementById("toolsRegistry");
const toolsRegistryToggle = document.getElementById("toolsRegistryToggle");
const toolsRegistryList = document.getElementById("toolsRegistryList");
const toolsCount = document.getElementById("toolsCount");
const promptModal = document.getElementById("promptModal");
const promptConfigBtn = document.getElementById("promptConfigBtn");
const promptModalClose = document.getElementById("promptModalClose");
const promptEditor = document.getElementById("promptEditor");
const promptSaveBtn = document.getElementById("promptSaveBtn");
const promptCancelBtn = document.getElementById("promptCancelBtn");

/* ── Badge labels (for collapsible headers) ─────────────────── */
const BADGE_LABELS = {
  thinking: "思考",
  "tool-call": "工具调用",
  工具结果: "工具结果",
  answer: "回答",
  error: "错误",
};

function labelForBadge(key) {
  return BADGE_LABELS[key] || key;
}

function mapVariantClass(key) {
  if (key === "thinking") return "thinking";
  if (key === "tool-call") return "tool-call";
  if (key === "工具结果") return "tool-result";
  if (key === "answer") return "answer";
  if (key === "error") return "error";
  return "";
}

function truncate(text, max) {
  const s = text == null ? "" : String(text);
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

/* ── Load tools from backend ──────────────────────────────── */
async function loadTools() {
  if (!toolsRegistryList) return;
  try {
    const r = await fetch("/api/tools");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const tools = await r.json();
    toolsRegistryList.innerHTML = "";
    tools.forEach((t) => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="tool-name">${escapeHtml(t.name)}</div><div class="tool-desc">${escapeHtml(t.description || "")}</div>`;
      toolsRegistryList.appendChild(li);
    });
    if (toolsCount) toolsCount.textContent = tools.length ? `共 ${tools.length} 个` : "";
  } catch (e) {
    toolsRegistryList.innerHTML = `<li class="tools-error">无法加载工具列表：${escapeHtml(e.message)}</li>`;
    if (toolsCount) toolsCount.textContent = "";
  }
}

if (toolsRegistryToggle && toolsRegistry) {
  toolsRegistryToggle.addEventListener("click", () => {
    toolsRegistry.classList.toggle("is-collapsed");
    const collapsed = toolsRegistry.classList.contains("is-collapsed");
    toolsRegistryToggle.setAttribute("aria-expanded", String(!collapsed));
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadTools);
} else {
  loadTools();
}

/* ── Auto-resize textarea ────────────────────────────────── */
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

/* ── Example shortcuts ────────────────────────────────────── */
function sendExample(text) {
  inputEl.value = text;
  sendMessage();
}

/* ── Send message ─────────────────────────────────────────── */
async function sendMessage() {
  const message = inputEl.value.trim();
  if (!message || isStreaming) return;

  isStreaming = true;
  inputEl.value = "";
  inputEl.style.height = "auto";

  const welcome = document.querySelector(".welcome-message");
  if (welcome) welcome.style.display = "none";

  appendBubble(message, "user");

  setLoading(true);
  setStatus("思考中...", "loading");

  currentTraceCard = addTraceCard("thinking", "Agent 开始思考…");

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const aiMsg = appendBubble("", "assistant");
    currentAnswerEl = aiMsg.querySelector(".bubble");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          handleEvent(event);
        } catch {
          /* partial JSON */
        }
      }
    }
  } catch (err) {
    addTraceCard("error", `请求失败: ${err.message}`);
    if (currentAnswerEl) {
      currentAnswerEl.textContent = "抱歉，发生了错误，请检查后端服务是否运行。";
    }
  } finally {
    isStreaming = false;
    setLoading(false);
    setStatus("就绪", "");
    currentAnswerEl = null;
    currentTraceCard = null;
  }
}

/* ── Handle SSE event ─────────────────────────────────────── */
function handleEvent(event) {
  switch (event.type) {
    case "thinking":
      updateTraceCard(currentTraceCard, "thinking", event.content);
      break;

    case "tool_call":
      currentTraceCard = addTraceCard("tool-call", event.content);
      break;

    case "tool_result":
      updateTraceCard(currentTraceCard, "工具结果", event.content);
      break;

    case "answer":
      currentTraceCard = addTraceCard("answer", event.content || "");
      if (currentAnswerEl) {
        currentAnswerEl.innerHTML = renderMarkdown(event.content || "");
        scrollToBottom(messagesEl);
      }
      break;

    case "error":
      updateTraceCard(currentTraceCard, "error", event.content);
      break;

    case "done":
      if (currentTraceCard) {
        currentTraceCard.classList.remove("streaming-cursor");
      }
      break;
  }
}

/* ── Trace helpers (collapsible cards) ────────────────────── */
function wireTraceCardToggle(card) {
  const btn = card.querySelector(".trace-card-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    card.classList.toggle("is-collapsed");
    btn.setAttribute("aria-expanded", String(!card.classList.contains("is-collapsed")));
  });
}

function setTraceVariant(card, badgeKey) {
  card.classList.remove("thinking", "tool-call", "tool-result", "answer", "error");
  const v = mapVariantClass(badgeKey);
  if (v) card.classList.add(v);
}

function addTraceCard(badgeKey, content) {
  const empty = traceLogEl.querySelector(".trace-empty");
  if (empty) empty.remove();

  const card = document.createElement("div");
  const label = labelForBadge(badgeKey);
  const summary = truncate(content, 120);
  card.className = "trace-card streaming-cursor";
  setTraceVariant(card, badgeKey);

  card.innerHTML = `
    <button type="button" class="trace-card-toggle" aria-expanded="true">
      <span class="trace-chevron" aria-hidden="true">▼</span>
      <span class="trace-badge-inline">${escapeHtml(label)}</span>
      <span class="trace-summary">${escapeHtml(summary)}</span>
    </button>
    <div class="trace-card-body">
      <div class="trace-content">${escapeHtml(content)}</div>
    </div>
  `;
  wireTraceCardToggle(card);
  traceLogEl.appendChild(card);
  scrollToBottom(traceLogEl);
  return card;
}

function updateTraceCard(card, badgeKey, content) {
  if (!card) return;
  card.classList.remove("streaming-cursor");
  setTraceVariant(card, badgeKey);
  const label = labelForBadge(badgeKey);
  const badgeEl = card.querySelector(".trace-badge-inline");
  const summaryEl = card.querySelector(".trace-summary");
  const contentEl = card.querySelector(".trace-content");
  if (badgeEl) badgeEl.textContent = label;
  if (summaryEl) summaryEl.textContent = truncate(content, 120);
  if (contentEl) contentEl.textContent = content;
  scrollToBottom(traceLogEl);
}

function clearTrace() {
  traceLogEl.innerHTML = `
    <div class="trace-empty">
      <p>等待 Agent 运行…</p>
      <p class="trace-hint">发送消息后，此处显示思考与工具调用，可点击条目标题折叠内容。</p>
    </div>
  `;
}

/* ── Chat helpers ─────────────────────────────────────────── */
function appendBubble(content, role) {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  const rendered = role === "assistant" ? renderMarkdown(content) : escapeHtml(content);
  msg.innerHTML = `<div class="bubble">${rendered}</div>`;
  messagesEl.appendChild(msg);
  scrollToBottom(messagesEl);
  return msg;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom(el) {
  el.scrollTop = el.scrollHeight;
}

/* ── Status helpers ───────────────────────────────────────── */
function setLoading(loading) {
  sendBtn.disabled = loading;
  inputEl.disabled = loading;
}

function setStatus(text, cls) {
  statusText.textContent = text;
  statusBadge.className = "header-status" + (cls ? " " + cls : "");
}

/* ── System prompt modal ──────────────────────────────────── */
async function loadSystemPrompt() {
  try {
    const r = await fetch("/api/system-prompt");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    if (promptEditor) promptEditor.value = data.system_prompt || "";
  } catch (e) {
    if (promptEditor) promptEditor.value = "";
  }
}

function openPromptModal() {
  if (promptModal) {
    promptModal.classList.add("is-visible");
    document.body.style.overflow = "hidden";
  }
  loadSystemPrompt();
}

function closePromptModal() {
  if (promptModal) {
    promptModal.classList.remove("is-visible");
    document.body.style.overflow = "";
  }
}

async function saveSystemPrompt() {
  if (!promptSaveBtn || !promptEditor) return;
  const value = promptEditor.value;
  promptSaveBtn.disabled = true;
  promptSaveBtn.textContent = "保存中…";
  try {
    const r = await fetch("/api/system-prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system_prompt: value }),
    });
    if (!r.ok) {
      const err = await r.json();
      alert("保存失败：" + (err.error || r.status));
      return;
    }
    closePromptModal();
  } catch (e) {
    alert("保存失败：" + e.message);
  } finally {
    if (promptSaveBtn) {
      promptSaveBtn.disabled = false;
      promptSaveBtn.textContent = "保存并应用";
    }
  }
}

if (promptConfigBtn) {
  promptConfigBtn.addEventListener("click", openPromptModal);
}

if (promptModalClose) {
  promptModalClose.addEventListener("click", closePromptModal);
}

if (promptCancelBtn) {
  promptCancelBtn.addEventListener("click", closePromptModal);
}

if (promptSaveBtn) {
  promptSaveBtn.addEventListener("click", saveSystemPrompt);
}

// Close on overlay click
if (promptModal) {
  promptModal.addEventListener("click", (e) => {
    if (e.target === promptModal) closePromptModal();
  });
}

// Close on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && promptModal && promptModal.classList.contains("is-visible")) {
    closePromptModal();
  }
});
