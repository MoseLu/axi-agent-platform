"""
miniMax 模型连接器
"""
import httpx
from typing import List, Dict, Any, Optional, AsyncGenerator

from app.models.base import BaseModelConnector, Message, ModelResponse, MessageRole
from app.config import settings


class MiniMaxConnector(BaseModelConnector):
    """miniMax API 连接器"""
    
    def __init__(
        self,
        api_key: str = None,
        base_url: str = None,
        default_model: str = None
    ):
        super().__init__(
            api_key=api_key or settings.MINIMAX_API_KEY,
            base_url=base_url or settings.MINIMAX_API_URL,
            default_model=default_model or settings.MINIMAX_DEFAULT_MODEL
        )
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            timeout=60.0
        )
    
    async def chat(
        self,
        messages: List[Message],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        tools: Optional[List[Dict]] = None,
        stream: bool = False
    ) -> ModelResponse:
        """对话接口"""
        model = model or self.default_model
        
        # 转换消息格式
        formatted_messages = self._convert_messages(messages)
        
        payload = {
            "model": model,
            "messages": formatted_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream
        }
        
        if tools:
            payload["tools"] = tools
        
        try:
            response = await self.client.post(
                "/chat/completions",
                json=payload
            )
            response.raise_for_status()
            data = response.json()
            
            choice = data["choices"][0]
            message = choice["message"]
            
            return ModelResponse(
                content=message.get("content", ""),
                usage=data.get("usage", {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}),
                model=data.get("model", model),
                finish_reason=choice.get("finish_reason"),
                tool_calls=message.get("tool_calls")
            )
        except httpx.HTTPError as e:
            raise Exception(f"miniMax API error: {str(e)}")
    
    async def chat_stream(
        self,
        messages: List[Message],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        tools: Optional[List[Dict]] = None
    ) -> AsyncGenerator[str, None]:
        """流式对话接口"""
        model = model or self.default_model
        formatted_messages = self._convert_messages(messages)
        
        payload = {
            "model": model,
            "messages": formatted_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True
        }
        
        if tools:
            payload["tools"] = tools
        
        try:
            async with self.client.stream(
                "POST",
                "/chat/completions",
                json=payload
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            import json
                            chunk = json.loads(data)
                            delta = chunk["choices"][0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                yield content
                        except (json.JSONDecodeError, KeyError):
                            continue
        except httpx.HTTPError as e:
            raise Exception(f"miniMax streaming error: {str(e)}")
    
    def _convert_messages(self, messages: List[Message]) -> List[Dict]:
        """转换为miniMax格式"""
        formatted = []
        for msg in messages:
            if msg.role == MessageRole.SYSTEM:
                formatted.append({
                    "role": "system",
                    "content": msg.content
                })
            elif msg.role == MessageRole.USER:
                formatted.append({
                    "role": "user",
                    "content": msg.content
                })
            elif msg.role == MessageRole.ASSISTANT:
                formatted.append({
                    "role": "assistant",
                    "content": msg.content
                })
        return formatted
    
    async def validate(self) -> bool:
        """验证API连接"""
        try:
            response = await self.client.get("/models")
            return response.status_code == 200
        except Exception:
            return False
    
    async def close(self):
        """关闭连接"""
        await self.client.aclose()
