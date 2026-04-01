"""
内置工具
"""
from typing import List
from app.schemas.tool import Tool, ToolCategory, ToolType


def get_builtin_tools() -> List[Tool]:
    """获取所有内置工具"""
    return [
        # 搜索工具
        Tool(
            id="search_web",
            name="search_web",
            description="搜索网络获取实时信息",
            category=ToolCategory.SEARCH,
            tool_type=ToolType.BUILTIN,
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索查询词"
                    },
                    "num_results": {
                        "type": "integer",
                        "description": "返回结果数量",
                        "default": 5
                    }
                },
                "required": ["query"]
            }
        ),
        
        # 文件操作工具
        Tool(
            id="read_file",
            name="read_file",
            description="读取本地文件内容",
            category=ToolCategory.FILE,
            tool_type=ToolType.BUILTIN,
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件路径"
                    }
                },
                "required": ["path"]
            },
            required_permissions=["file_read"]
        ),
        
        Tool(
            id="write_file",
            name="write_file",
            description="写入内容到本地文件",
            category=ToolCategory.FILE,
            tool_type=ToolType.BUILTIN,
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件路径"
                    },
                    "content": {
                        "type": "string",
                        "description": "文件内容"
                    }
                },
                "required": ["path", "content"]
            },
            required_permissions=["file_write"]
        ),
        
        # 计算工具
        Tool(
            id="calculate",
            name="calculate",
            description="执行数学计算",
            category=ToolCategory.CALCULATE,
            tool_type=ToolType.BUILTIN,
            parameters={
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "数学表达式，如 '2 + 2' 或 'pow(2, 10)'"
                    }
                },
                "required": ["expression"]
            }
        ),
        
        # 代码执行工具
        Tool(
            id="run_python",
            name="run_python",
            description="运行Python代码",
            category=ToolCategory.CODE,
            tool_type=ToolType.BUILTIN,
            parameters={
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Python代码"
                    }
                },
                "required": ["code"]
            },
            required_permissions=["code_execution"]
        ),
        
        # 数据处理工具
        Tool(
            id="parse_json",
            name="parse_json",
            description="解析JSON字符串",
            category=ToolCategory.DATA,
            tool_type=ToolType.BUILTIN,
            parameters={
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "JSON字符串"
                    }
                },
                "required": ["content"]
            }
        ),
        
        Tool(
            id="parse_csv",
            name="parse_csv",
            description="解析CSV字符串",
            category=ToolCategory.DATA,
            tool_type=ToolType.BUILTIN,
            parameters={
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "CSV字符串"
                    },
                    "delimiter": {
                        "type": "string",
                        "description": "分隔符",
                        "default": ","
                    }
                },
                "required": ["content"]
            }
        ),
    ]
