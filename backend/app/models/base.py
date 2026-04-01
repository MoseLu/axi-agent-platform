"""
模型连接器基类
"""
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, AsyncGenerator
from dataclasses import dataclass
from enum import Enum


class MessageRole(str, Enum):
    """消息角色"""
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


@dataclass
class Message:
    """消息数据类"""
    role: MessageRole
    content: str
    name: Optional[str] = None
    tool_calls: Optional[List[Dict]] = None
    tool_call_id: Optional[str] = None


@dataclass
class ModelResponse:
    """模型响应数据类"""
    content: str
    usage: Dict[str, int]
    model: str
    finish_reason: Optional[str] = None
    tool_calls: Optional[List[Dict]] = None


class BaseModelConnector(ABC):
    """模型连接器基类"""
    
    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        default_model: str = None
    ):
        self.api_key = api_key
        self.base_url = base_url
        self.default_model = default_model
    
    @abstractmethod
    async def chat(
        self,
        messages: List[Message],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        tools: Optional[List[Dict]] = None,
        stream: bool = False
    ) -> ModelResponse:
        """
        对话接口
        
        Args:
            messages: 消息列表
            model: 模型名称
            temperature: 温度参数
            max_tokens: 最大令牌数
            tools: 可用工具列表
            stream: 是否流式输出
            
        Returns:
            模型响应
        """
        pass
    
    @abstractmethod
    async def chat_stream(
        self,
        messages: List[Message],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        tools: Optional[List[Dict]] = None
    ) -> AsyncGenerator[str, None]:
        """
        流式对话接口
        
        Args:
            messages: 消息列表
            model: 模型名称
            temperature: 温度参数
            max_tokens: 最大令牌数
            tools: 可用工具列表
            
        Yields:
            文本片段
        """
        pass
    
    @abstractmethod
    async def validate(self) -> bool:
        """验证API连接是否正常"""
        pass
    
    def format_messages(self, messages: List[Message]) -> List[Dict]:
        """格式化消息为API格式"""
        formatted = []
        for msg in messages:
            data = {
                "role": msg.role.value,
                "content": msg.content
            }
            if msg.name:
                data["name"] = msg.name
            if msg.tool_calls:
                data["tool_calls"] = msg.tool_calls
            if msg.tool_call_id:
                data["tool_call_id"] = msg.tool_call_id
            formatted.append(data)
        return formatted
