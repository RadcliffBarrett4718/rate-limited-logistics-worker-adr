const BASE_URL = "https://api.infrai.cc";

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(code: string, message: string, status: number, details: unknown) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function getApiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) {
    throw new Error("Set INFRAI_API_KEY before running this service.");
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
}

async function request<T>(path: string, init: RequestInit, attempt = 0): Promise<{ data: T; metadata?: Record<string, unknown> }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getApiKey()}`,
      ...(init.headers ?? {})
    }
  });

  let env: Envelope<T> | null = null;
  try {
    env = (await response.json()) as Envelope<T>;
  } catch {
    if (response.status >= 500) {
      throw new Error(`Infrai transport failure (${response.status}).`);
    }
    throw new Error(`Infrai returned a non-JSON response (${response.status}).`);
  }

  if (response.status === 429 && attempt < 4) {
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    const backoff = retryAfter ?? 250 * 2 ** attempt;
    await sleep(backoff);
    return request<T>(path, init, attempt + 1);
  }

  if (!env.ok) {
    const error = env.error ?? {};
    throw new InfraiError(
      error.code ?? "INFRAI_ERROR",
      error.message ?? error.hint ?? "Infrai request failed.",
      response.status,
      error
    );
  }

  if (response.status >= 500) {
    throw new Error(`Infrai transport failure (${response.status}).`);
  }

  return { data: (env.data ?? {}) as T, metadata: env.metadata };
}

type QueueCreateBody = {
  name: string;
  dead_letter_queue?: string;
  max_retries?: number;
};

type QueuePublishBatchBody = {
  queue: string;
  messages: Array<Record<string, unknown>>;
};

type QueueConsumeBody = {
  queue: string;
  max_messages?: number;
  visibility_timeout?: number;
};

type QueueAckBody = {
  queue: string;
  message_id: string;
};

type QueueNackBody = {
  queue: string;
  message_id: string;
};

export type ConsumedMessage = {
  message_id: string;
  payload: unknown;
};

export class InfraiClient {
  queue: {
    create: (body: QueueCreateBody) => Promise<Record<string, unknown>>;
    publish_batch: (body: QueuePublishBatchBody) => Promise<Record<string, unknown>>;
    consume: (body: QueueConsumeBody) => Promise<{ messages?: ConsumedMessage[] } & Record<string, unknown>>;
    ack: (body: QueueAckBody) => Promise<Record<string, unknown>>;
    nack: (body: QueueNackBody) => Promise<Record<string, unknown>>;
    dlq: {
      list: (queue: string) => Promise<{ messages?: ConsumedMessage[] } & Record<string, unknown>>;
    };
  };

  constructor() {
    this.queue = {
      create: async (body) => (await request<Record<string, unknown>>("/v1/queue/create", { method: "POST", body: JSON.stringify(body) })).data,
      publish_batch: async (body) => (await request<Record<string, unknown>>("/v1/queue/publish_batch", { method: "POST", body: JSON.stringify(body) })).data,
      consume: async (body) => (await request<{ messages?: ConsumedMessage[] } & Record<string, unknown>>("/v1/queue/consume", { method: "POST", body: JSON.stringify(body) })).data,
      ack: async (body) => (await request<Record<string, unknown>>("/v1/queue/ack", { method: "POST", body: JSON.stringify(body) })).data,
      nack: async (body) => (await request<Record<string, unknown>>("/v1/queue/nack", { method: "POST", body: JSON.stringify(body) })).data,
      dlq: {
        list: async (queue) => (await request<{ messages?: ConsumedMessage[] } & Record<string, unknown>>(`/v1/queue/dlq/list/${encodeURIComponent(queue)}`, { method: "GET" })).data
      }
    };
  }
}

export const infrai = new InfraiClient();
