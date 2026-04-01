"""
OpenAI 模型连接器
"""
from typing import List, Dict, Any, Optional, AsyncGenerator
from openai import AsyncOpenAI

from app.models.base import BaseModelConnector, Message, ModelResponse
from app.config import settings


class OpenAIConnector(BaseModelConnector):
    """OpenAI API 连接器"""
    
    def __init__(
        self,
        api_key: str = None,
        base_url: str = None,
        default_model: str = None
    ):
        super().__init__(
            api_key=api_key or settings.OPENAI_API_KEY,
            base_url=base_url,
            default_model=default_model or settings.OPENAI_DEFAULT_MODEL
        )
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url
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
        formatted_messages = self.format_messages(messages)
        
        try:
            response = await self.client.chat.completions.create(
                model=model,
                messages=formatted_messages,
                temperature=temperature,
                max_tokens=max_tokens,
                tools=tools,
                stream=False
            )
            
            choice = response.choices[0]
            message = choice.message
            
            return ModelResponse(
                content=message.content or "",
                usage={
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                    "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                    "total_tokens": response.usage.total_tokens if response.usage else 0
                },
                model=response.model,
                finish_reason=choice.finish_reason,
                tool_calls=[tool.model_dump() for tool in message.tool_calls] if message.tool_calls else None
            )
        except Exception as e:
            raise Exception(f"OpenAI API error: {str(e)}")
    
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
        formatted_messages = self.format_messages(messages)
        
        try:
            stream = await self.client.chat.completions.create(
                model=model,
                messages=formatted_messages,
                temperature=temperature,
                max_tokens=max_tokens,
                tools=tools,
                stream=True
            )
            
            async for chunk in stream:
                delta = chunk.choices[0].delta
                if delta.content:
                    yield delta.content
        except Exception as e:
            raise Exception(f"OpenAI streaming error: {str(e)}")
    
    async def validate(self) -> bool:
        """验证API连接"""
        try:
            models = await self.client.models.list()
            return len(models.data) > 0
        except Exception:
            return False
