interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let fetchCalls: FetchCall[] = [];

function parseFetchCall(url: string | URL, init?: RequestInit): FetchCall {
  const headers: Record<string, string> = {};
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers)) {
      headers[k] = v as string;
    }
  }
  let body: unknown = undefined;
  if (init?.body) {
    try {
      body = JSON.parse(init.body as string);
    } catch {
      body = init.body;
    }
  }
  return {
    url: url.toString(),
    method: init?.method ?? "GET",
    headers,
    body,
  };
}

export function mockFetchJson(body: unknown, status = 200): void {
  const mockFn = vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    fetchCalls.push(parseFetchCall(url, init));
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: () => Promise.resolve(body),
    });
  });
  vi.stubGlobal("fetch", mockFn);
}

export function mockFetchError(status: number, body: { error: string }): void {
  const mockFn = vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    fetchCalls.push(parseFetchCall(url, init));
    return Promise.resolve({
      ok: false,
      status,
      statusText: "Error",
      json: () => Promise.resolve(body),
    });
  });
  vi.stubGlobal("fetch", mockFn);
}

export function mockFetchNetworkError(message: string): void {
  const mockFn = vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    fetchCalls.push(parseFetchCall(url, init));
    return Promise.reject(new Error(message));
  });
  vi.stubGlobal("fetch", mockFn);
}

export function mockFetchNonJsonError(status: number, statusText: string): void {
  const mockFn = vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    fetchCalls.push(parseFetchCall(url, init));
    return Promise.resolve({
      ok: false,
      status,
      statusText,
      json: () => Promise.reject(new Error("not json")),
    });
  });
  vi.stubGlobal("fetch", mockFn);
}

export function getLastFetchCall(): FetchCall {
  if (fetchCalls.length === 0) throw new Error("No fetch calls recorded");
  return fetchCalls[fetchCalls.length - 1];
}

export function getAllFetchCalls(): FetchCall[] {
  return [...fetchCalls];
}

export function resetFetchMock(): void {
  fetchCalls = [];
  vi.unstubAllGlobals();
}
