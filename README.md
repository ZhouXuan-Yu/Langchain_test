# LangChain Agent — AI 助手

基于 LangChain + DeepSeek + FastAPI + HTML 的 AI 助手，带实时 Agent 思考链路可视化。

## 常见问题

### 端口 9000 被占用

如果启动时报错 `[Errno 10048] error while attempting to bind on address`，说明端口 9000 已被其他进程占用，按以下步骤排查：

**Step 1：查找占用进程**

```powershell
# Windows PowerShell
netstat -ano | Select-String ":9000"
```

找到 LISTENING 状态的进程 PID（最后一列），例如：

```
TCP    0.0.0.0:9000    0.0.0.0:0    LISTENING    12345
```

**Step 2：杀掉该进程**

```powershell
# Windows PowerShell
taskkill /PID 12345 /F
```

**Step 3：重新启动服务**

```bash
python backend/main.py
```

> 如果杀掉进程后仍然提示端口被占用，可能是重复启动了多个后端服务，重复执行 Step 1-2 确认无残留进程后再启动。

### API Key 无效（401 认证失败）

如果前端调用无响应或后端日志出现 `AuthenticationError: Your api key is invalid`，请检查：

1. `.env` 文件中 `DEEPSEEK_API_KEY` 是否填入了正确的 Key
2. Key 是否已过期或被禁用
3. 获取新 Key：[https://platform.deepseek.com/](https://platform.deepseek.com/)

### 启动后前端一直转圈

1. 确认后端服务已成功启动（终端显示 `Uvicorn running on http://0.0.0.0:9000`）
2. 浏览器地址栏使用 `http://localhost:9000/` 而不是 `http://0.0.0.0:9000/`
3. 检查 `.env` 中的 API Key 是否正确

---

## 项目结构

```
.
├── backend/
│   ├── main.py       # FastAPI 应用，LangChain Agent，SSE 流式响应
│   └── tools.py      # 工具定义（天气、计算、知识搜索）
├── frontend/
│   ├── index.html    # 单页 HTML 界面
│   ├── style.css     # 样式
│   └── app.js        # SSE 流式客户端
├── .env.example      # 环境变量模板
├── requirements.txt  # Python 依赖
└── README.md
```

## 环境配置（从零开始）

> 完整流程：创建 conda 环境 → 安装依赖 → 配置 API Key → 启动服务

### Step 1：创建 conda 环境

```bash
# 新建一个 Python 3.11 的独立环境（避免与全局 Python 冲突）
conda create -n langchain-agent python=3.11 -y

# 进入该环境
conda activate langchain-agent
```

### Step 2：安装 Python 依赖

```bash
# 确保已进入项目根目录
cd D:/Aprogress/Test

# 安装所有依赖（一行命令）
pip install -r requirements.txt
```

> 如果安装较慢，可以切换到国内镜像源：
> ```bash
> pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
> ```

### Step 3：配置 DeepSeek API Key

```bash
# 从模板复制 .env 文件（Windows PowerShell）
copy .env.example .env

# 或 Linux/macOS
cp .env.example .env
```

用任意编辑器打开 `.env`，填入你的 DeepSeek API Key：

```
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

> 没有 API Key？请访问 [https://platform.deepseek.com/](https://platform.deepseek.com/) 注册并获取。

### Step 4：启动后端服务

```bash
# 从项目根目录启动（PowerShell / Linux / macOS 通用）
python backend/main.py
```

成功后会看到：

```
==================================================
 LangChain Agent 服务已启动
 http://localhost:9000/
==================================================
```

> **端口被占用？** 修改 `backend/main.py` 末尾 `uvicorn.run(..., port=9000)` 中的端口号即可。

### Step 5：打开浏览器

直接访问 **`http://localhost:9000`**

---

> **每次使用只需执行 Step 4 和 Step 5**（Step 1-3 仅首次配置或换电脑时需要）。

## 功能说明

Agent 支持以下工具：

| 工具 | 说明 | 示例问题 |
|------|------|----------|
| 天气查询 | 返回预设城市的天气数据 | "北京今天天气怎么样？" |
| 数学计算 | 安全 AST 解析计算器（支持加减乘除、指数、括号） | "帮我算一下 123 * 456 + 789" |
| 知识搜索 | 从预设知识库中匹配关键词 | "LangChain 是什么？" |

## 接口说明

### `POST /chat`

发送消息并接收 SSE 流式响应。

**请求：**
```json
{ "message": "北京今天天气怎么样？" }
```

**响应（SSE 流）：**
```
data: {"type": "thinking", "content": "..."}
data: {"type": "tool_call", "content": "get_current_weather(...)"}
data: {"type": "tool_result", "content": "晴天，气温 28°C..."}
data: {"type": "answer", "content": "北京今天天气晴朗..."}
data: {"type": "done", "content": ""}
```

### `GET /health`

健康检查，返回 `{"status": "ok"}`

## 开发说明

- 后端依赖 `httpx` 提供同步 HTTP 能力（如需自定义工具调用外部 API）
- 后端默认从 `.env` 文件加载环境变量
- 前端静态文件由 FastAPI 通过 `StaticFiles` 自动托管
- 修改前端代码后刷新浏览器即可，无需重启后端
- 修改后端 Python 代码后需重启后端服务
