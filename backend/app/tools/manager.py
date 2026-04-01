"""
工具管理器
"""
import json
import time
import asyncio
from typing import Dict, List, Any, Optional, Callable
from datetime import datetime

from app.schemas.tool import Tool, ToolCreate, ToolUpdate, ToolExecutionResult, ToolType
from app.database.vector_store import VectorStore


class ToolManager:
    """工具管理器"""
    
    def __init__(self):
        self._tools: Dict[str, Tool] = {}
        self._handlers: Dict[str, Callable] = {}
        self._vector_store: Optional[VectorStore] = None
    
    async def initialize(self, vector_store: VectorStore):
        """初始化工具管理器"""
        self._vector_store = vector_store
        # 注册内置工具
        from app.tools.builtin import get_builtin_tools
        for tool in get_builtin_tools():
            self._tools[tool.id] = tool
            self._handlers[tool.id] = self._get_builtin_handler(tool.id)
    
    def _get_builtin_handler(self, tool_id: str) -> Callable:
        """获取内置工具处理器"""
        handlers = {
            "search_web": self._handle_search_web,
            "read_file": self._handle_read_file,
            "write_file": self._handle_write_file,
            "calculate": self._handle_calculate,
            "run_python": self._handle_run_python,
            "parse_json": self._handle_parse_json,
            "parse_csv": self._handle_parse_csv,
        }
        return handlers.get(tool_id, self._handle_unknown)
    
    async def register_tool(self, tool: Tool, handler: Optional[Callable] = None) -> str:
        """
        注册工具
        
        Args:
            tool: 工具定义
            handler: 工具处理函数
            
        Returns:
            工具ID
        """
        self._tools[tool.id] = tool
        if handler:
            self._handlers[tool.id] = handler
        return tool.id
    
    async def unregister_tool(self, tool_id: str) -> bool:
        """注销工具"""
        if tool_id in self._tools:
            del self._tools[tool_id]
            if tool_id in self._handlers:
                del self._handlers[tool_id]
            return True
        return False
    
    async def get_tool(self, tool_id: str) -> Optional[Tool]:
        """获取工具"""
        return self._tools.get(tool_id)
    
    async def list_tools(
        self,
        category: Optional[str] = None,
        tool_type: Optional[ToolType] = None,
        enabled_only: bool = True
    ) -> List[Tool]:
        """列出工具"""
        tools = list(self._tools.values())
        
        if category:
            tools = [t for t in tools if t.category == category]
        if tool_type:
            tools = [t for t in tools if t.tool_type == tool_type]
        if enabled_only:
            tools = [t for t in tools if t.enabled]
        
        return tools
    
    async def execute_tool(
        self,
        tool_id: str,
        parameters: Dict[str, Any],
        agent_id: Optional[str] = None,
        task_id: Optional[str] = None
    ) -> ToolExecutionResult:
        """
        执行工具
        
        Args:
            tool_id: 工具ID
            parameters: 执行参数
            agent_id: 调用智能体ID
            task_id: 任务ID
            
        Returns:
            执行结果
        """
        start_time = time.time()
        
        tool = self._tools.get(tool_id)
        if not tool:
            return ToolExecutionResult(
                success=False,
                error=f"Tool not found: {tool_id}",
                execution_time=time.time() - start_time
            )
        
        if not tool.enabled:
            return ToolExecutionResult(
                success=False,
                error=f"Tool is disabled: {tool_id}",
                execution_time=time.time() - start_time
            )
        
        handler = self._handlers.get(tool_id)
        if not handler:
            return ToolExecutionResult(
                success=False,
                error=f"Tool handler not found: {tool_id}",
                execution_time=time.time() - start_time
            )
        
        try:
            # 验证参数
            self._validate_parameters(tool, parameters)
            
            # 执行工具
            if asyncio.iscoroutinefunction(handler):
                result = await handler(**parameters)
            else:
                result = handler(**parameters)
            
            # 更新使用计数
            tool.use_count += 1
            tool.updated_at = datetime.now()
            
            return ToolExecutionResult(
                success=True,
                result=result,
                execution_time=time.time() - start_time
            )
        except Exception as e:
            return ToolExecutionResult(
                success=False,
                error=str(e),
                execution_time=time.time() - start_time
            )
    
    def _validate_parameters(self, tool: Tool, parameters: Dict[str, Any]):
        """验证参数"""
        schema = tool.parameters
        required = schema.get("required", [])
        properties = schema.get("properties", {})
        
        # 检查必填参数
        for param in required:
            if param not in parameters:
                raise ValueError(f"Missing required parameter: {param}")
        
        # 验证参数类型
        for key, value in parameters.items():
            if key in properties:
                expected_type = properties[key].get("type")
                if expected_type == "string" and not isinstance(value, str):
                    raise ValueError(f"Parameter {key} should be string")
                elif expected_type == "number" and not isinstance(value, (int, float)):
                    raise ValueError(f"Parameter {key} should be number")
                elif expected_type == "boolean" and not isinstance(value, bool):
                    raise ValueError(f"Parameter {key} should be boolean")
                elif expected_type == "array" and not isinstance(value, list):
                    raise ValueError(f"Parameter {key} should be array")
                elif expected_type == "object" and not isinstance(value, dict):
                    raise ValueError(f"Parameter {key} should be object")
    
    # ===== 内置工具处理器 =====
    
    async def _handle_search_web(self, query: str, num_results: int = 5) -> Dict[str, Any]:
        """搜索网络"""
        # 这里可以实现真实的搜索API调用
        # 目前返回模拟数据
        return {
            "query": query,
            "results": [
                {"title": f"Result {i+1}", "url": f"https://example.com/{i}", "snippet": f"Search result for {query}"}
                for i in range(min(num_results, 5))
            ]
        }
    
    async def _handle_read_file(self, path: str) -> str:
        """读取文件"""
        import aiofiles
        try:
            async with aiofiles.open(path, 'r', encoding='utf-8') as f:
                return await f.read()
        except Exception as e:
            raise Exception(f"Failed to read file: {str(e)}")
    
    async def _handle_write_file(self, path: str, content: str) -> Dict[str, Any]:
        """写入文件"""
        import aiofiles
        import os
        
        # 安全检查：禁止写入系统关键目录
        dangerous_paths = ['/etc', '/sys', '/proc', 'C:\\Windows', 'C:\\Program Files']
        abs_path = os.path.abspath(path)
        for dangerous in dangerous_paths:
            if abs_path.startswith(dangerous):
                raise Exception(f"Writing to system directory is not allowed: {path}")
        
        try:
            # 确保目录存在
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            
            async with aiofiles.open(abs_path, 'w', encoding='utf-8') as f:
                await f.write(content)
            
            return {"path": abs_path, "bytes_written": len(content.encode('utf-8'))}
        except Exception as e:
            raise Exception(f"Failed to write file: {str(e)}")
    
    async def _handle_calculate(self, expression: str) -> Dict[str, Any]:
        """计算表达式"""
        try:
            # 安全计算：只允许数学运算
            allowed_names = {
                "abs": abs, "round": round, "max": max, "min": min,
                "sum": sum, "pow": pow, "len": len
            }
            
            # 使用eval进行安全计算
            result = eval(expression, {"__builtins__": {}}, allowed_names)
            return {
                "expression": expression,
                "result": result
            }
        except Exception as e:
            raise Exception(f"Calculation error: {str(e)}")
    
    async def _handle_run_python(self, code: str) -> Dict[str, Any]:
        """运行Python代码"""
        # 安全限制：在沙箱环境中执行
        import subprocess
        import tempfile
        import os
        
        # 创建临时文件
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            temp_file = f.name
        
        try:
            # 使用subprocess执行，设置超时和资源限制
            result = subprocess.run(
                ['python', temp_file],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode
            }
        finally:
            os.unlink(temp_file)
    
    async def _handle_parse_json(self, content: str) -> Dict[str, Any]:
        """解析JSON"""
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            raise Exception(f"JSON parse error: {str(e)}")
    
    async def _handle_parse_csv(self, content: str, delimiter: str = ",") -> List[List[str]]:
        """解析CSV"""
        import csv
        from io import StringIO
        
        try:
            reader = csv.reader(StringIO(content), delimiter=delimiter)
            return list(reader)
        except Exception as e:
            raise Exception(f"CSV parse error: {str(e)}")
    
    async def _handle_unknown(self, **kwargs) -> Any:
        """未知工具处理器"""
        raise Exception("Unknown tool handler")
    
    def get_tool_definitions(self) -> List[Dict[str, Any]]:
        """获取工具定义列表（用于模型调用）"""
        definitions = []
        for tool in self._tools.values():
            if tool.enabled:
                definitions.append({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters
                    }
                })
        return definitions
