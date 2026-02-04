export type FetchMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface FetchOptions {
  method?: FetchMethod;
  headers?: Record<string, string>;
  body?: string | Uint8Array | Buffer;
  timeoutMs?: number;
}

export interface FetchResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export const fetchJson = async <T>(url: string, options: FetchOptions = {}): Promise<FetchResponse<T>> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);
    return { status: response.status, data, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchBuffer = async (url: string, options: FetchOptions = {}): Promise<{ status: number; data: ArrayBuffer; headers: Headers }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const data = await response.arrayBuffer();
    return { status: response.status, data, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
};
