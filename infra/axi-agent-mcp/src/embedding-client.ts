/**
 * 文本向量化客户端（OpenAI 兼容的 /embeddings 接口）
 * 用于向量搜索前的 query 向量化。
 */

const DEFAULT_EMBEDDING_DIM = 1536;

export interface EmbeddingOptions {
  /** 单条文本或文本数组 */
  input: string | string[];
  /** 模型，默认从环境变量 SWARM_EMBEDDING_MODEL 读取 */
  model?: string;
}

export interface EmbeddingResult {
  success: boolean;
  embedding?: number[];
  embeddings?: number[][];
  dimensions?: number;
  error?: string;
}

function getBaseUrl(): string {
  const url =
    process.env.SWARM_EMBEDDING_API_BASE_URL ||
    process.env.SWARM_API_BASE_URL ||
    "http://localhost:3000";
  return url.replace(/\/$/, "");
}

function getApiKey(): string {
  const key = process.env.SWARM_EMBEDDING_API_KEY || process.env.SWARM_API_KEY || "";
  if (!key) return "";
  return key.startsWith("Bearer ") ? key : `Bearer ${key}`;
}

function getPath(): string {
  const path = process.env.SWARM_EMBEDDING_PATH || "/v1/embeddings";
  return path.replace(/^\//, "");
}

/**
 * 调用 embedding 接口，返回 1536 维向量（与 VectorStore 默认维度一致）
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  const model =
    process.env.SWARM_EMBEDDING_MODEL ||
    process.env.SWARM_EMBEDDING_MODEL_NAME ||
    "text-embedding-v3"; // 通义/OpenAI 等常用名

  const base = getBaseUrl();
  const path = getPath();
  const url = `${base}/${path}`;
  const apiKey = getApiKey();

  const body: Record<string, unknown> = {
    model,
    input: text,
  };
  if (process.env.SWARM_EMBEDDING_DIMENSIONS) {
    body.dimensions = parseInt(process.env.SWARM_EMBEDDING_DIMENSIONS, 10) || DEFAULT_EMBEDDING_DIM;
  }

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
      data?: Array<{ embedding?: number[] }>;
      embedding?: number[];
      error?: { message?: string };
    };

    if (!res.ok) {
      const errMsg =
        data?.error?.message ?? (data as { message?: string }).message ?? res.statusText;
      throw new Error(errMsg);
    }

    const embedding =
      Array.isArray(data?.data) && data.data[0]?.embedding
        ? data.data[0].embedding
        : Array.isArray((data as { embedding?: number[] }).embedding)
          ? (data as { embedding: number[] }).embedding
          : null;

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("API 返回中无 embedding 数组");
    }

    return embedding;
  } catch (e) {
    throw e;
  }
}

/**
 * 批量获取向量（部分 API 支持）
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const model =
    process.env.SWARM_EMBEDDING_MODEL ||
    process.env.SWARM_EMBEDDING_MODEL_NAME ||
    "text-embedding-v3";

  const base = getBaseUrl();
  const path = getPath();
  const url = `${base}/${path}`;
  const apiKey = getApiKey();

  const body: Record<string, unknown> = {
    model,
    input: texts,
  };
  if (process.env.SWARM_EMBEDDING_DIMENSIONS) {
    body.dimensions = parseInt(process.env.SWARM_EMBEDDING_DIMENSIONS, 10) || DEFAULT_EMBEDDING_DIM;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = apiKey;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as {
    data?: Array<{ embedding?: number[] }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    const errMsg = data?.error?.message ?? res.statusText;
    throw new Error(errMsg);
  }

  if (!Array.isArray(data?.data)) {
    throw new Error("API 返回中无 data 数组");
  }

  return data.data.map((item) => item.embedding!).filter(Boolean);
}
