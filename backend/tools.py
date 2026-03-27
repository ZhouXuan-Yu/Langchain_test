import ast
import operator
from langchain_core.tools import tool


@tool
def get_current_weather(city: str) -> str:
    """获取指定城市的当前天气，当用户询问天气时使用。"""
    weather_data = {
        "北京": "晴天，气温 28°C，湿度 45%",
        "上海": "多云，气温 25°C，湿度 70%",
        "深圳": "雷阵雨，气温 30°C，湿度 85%",
        "广州": "阴天，气温 27°C，湿度 80%",
        "杭州": "小雨，气温 23°C，湿度 90%",
        "成都": "晴天，气温 26°C，湿度 55%",
        "武汉": "多云，气温 24°C，湿度 65%",
        "西安": "晴天，气温 29°C，湿度 40%",
    }
    return weather_data.get(city, f"抱歉，暂无 {city} 的天气数据")


@tool
def calculate(expression: str) -> str:
    """计算数学表达式。支持加法、减法、乘法、除法、乘方和括号。"""
    ops = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.Pow: operator.pow,
        ast.USub: operator.neg,
    }

    def safe_eval(node):
        if isinstance(node, ast.Expression):
            return safe_eval(node.body)
        elif isinstance(node, ast.Constant):
            return node.value
        elif isinstance(node, ast.BinOp):
            left = safe_eval(node.left)
            right = safe_eval(node.right)
            return ops[type(node.op)](left, right)
        elif isinstance(node, ast.UnaryOp):
            operand = safe_eval(node.operand)
            return ops[type(node.op)](operand)
        else:
            raise ValueError(f"Unsupported expression type: {type(node)}")

    try:
        tree = ast.parse(expression, mode="eval")
        result = safe_eval(tree)
        return f"计算结果：{expression} = {result}"
    except Exception as e:
        return f"计算错误：{e}"


@tool
def search_knowledge(query: str) -> str:
    """在知识库中搜索相关信息。用于事实性问题。"""
    knowledge = {
        "LangChain": "LangChain 是一个用于构建 LLM 应用的开源框架，支持链式调用、记忆管理和工具集成。",
        "Python": "Python 是一种高级编程语言，以简洁易读著称，广泛用于 AI、数据科学等领域。",
        "DeepSeek": "DeepSeek 是深度求索公司开发的 AI 大语言模型，支持强大的推理和对话能力。",
        "AI Agent": "AI Agent（智能体）是能够自主决策、调用工具来完成复杂任务的 AI 系统。",
        "RAG": "RAG（检索增强生成）通过在生成前检索相关文档，让 LLM 能回答训练数据之外的问题。",
        "LCEL": "LCEL（LangChain Expression Language）是 LangChain 的新一代链构建语法，使用管道符 | 连接各组件。",
    }
    for key, value in knowledge.items():
        if key.lower() in query.lower():
            return value
    return f"未找到与 '{query}' 相关的信息"


TOOLS = [get_current_weather, calculate, search_knowledge]
