/**
 * 调用统一 API 与大模型对话。假设 API 为 OpenAI 兼容格式：POST /chat/completions 或 /api/chat
 * MiniMax 使用独立 base URL 与 key（SWARM_MINIMAX_*），其余模型使用 SWARM_API_*。
 */

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_CHAT_PATH = "/api/chat";

/** 使用 MiniMax 独立配置的模型 id */
export const MINIMAX_MODEL_ID = "MiniMax-M2.5";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResponse {
  success: boolean;
  content?: string;
  error?: string;
  model?: string;
  tokens?: number;
}

function getBaseUrl(model: string): string {
  if (model === MINIMAX_MODEL_ID && process.env.SWARM_MINIMAX_API_BASE_URL) {
    return process.env.SWARM_MINIMAX_API_BASE_URL.replace(/\/$/, "");
  }
  return (process.env.SWARM_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

function getApiKey(model: string): string {
  if (model === MINIMAX_MODEL_ID && process.env.SWARM_MINIMAX_API_KEY) {
    const key = process.env.SWARM_MINIMAX_API_KEY.trim();
    return key.startsWith("Bearer ") ? key : `Bearer ${key}`;
  }
  const key = process.env.SWARM_API_KEY ?? "";
  return key.startsWith("Bearer ") ? key : key ? `Bearer ${key}` : "";
}

function getChatPath(model: string): string {
  if (model === MINIMAX_MODEL_ID && process.env.SWARM_MINIMAX_CHAT_PATH) {
    return process.env.SWARM_MINIMAX_CHAT_PATH.replace(/^\//, "");
  }
  const p = process.env.SWARM_CHAT_PATH ?? DEFAULT_CHAT_PATH;
  return p.replace(/^\//, "");
}

/**
 * 调用聊天接口。若你的 API 不是 OpenAI 兼容格式，可在此处或通过 env 适配。
 */
export async function chat(options: ChatOptions): Promise<ChatResponse> {
  const base = getBaseUrl(options.model);
  const path = getChatPath(options.model);
  const url = `${base}/${path}`;
  const apiKey = getApiKey(options.model);

  const body = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.5,
    max_tokens: options.max_tokens ?? 4096,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = apiKey;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      content?: string;
      data?: { choices?: Array<{ message?: { content?: string } }> };
      usage?: { total_tokens?: number };
      error?: { message?: string };
    };

    if (!res.ok) {
      const errMsg =
        data?.error?.message ?? (data as { message?: string }).message ?? res.statusText;
      return { success: false, error: errMsg, model: options.model };
    }

    // OpenAI 兼容: data.choices[0].message.content
    const content =
      data?.choices?.[0]?.message?.content ??
      data?.content ??
      (data?.data?.choices?.[0]?.message?.content as string | undefined);

    if (content == null) {
      return {
        success: false,
        error: "API 返回中无 content",
        model: options.model,
      };
    }

    return {
      success: true,
      content: typeof content === "string" ? content : JSON.stringify(content),
      model: options.model,
      tokens: data?.usage?.total_tokens,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      error: `请求失败: ${err}`,
      model: options.model,
    };
  }
}
