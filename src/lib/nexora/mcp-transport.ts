/** Bounded Streamable HTTP client. No retries for potentially mutating calls. */
export function validateMcpEndpoint(endpoint: string, allowedOrigins: string[]): URL {
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !allowedOrigins.includes(url.origin) ||
    !/^[a-z0-9.-]+$/i.test(url.hostname) ||
    !url.hostname.includes(".") ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)
  ) {
    throw new Error("MCP endpoint is not approved by the deployment administrator.");
  }
  return url;
}

async function rpcResponse(res: Response, id: number): Promise<any> {
  if (!res.ok || !res.body) throw new Error("MCP server rejected the request.");
  const streaming = res.headers.get("content-type")?.includes("text/event-stream");
  if (!streaming && !res.headers.get("content-type")?.includes("application/json"))
    throw new Error("Unsupported MCP response type.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    bytes = 0;
  const extract = (value: any) => {
    const messages = Array.isArray(value) ? value : [value];
    const message = messages.find(
      (v: any) => v?.jsonrpc === "2.0" && v.id === id && ("result" in v || "error" in v),
    );
    if (!message) return undefined;
    if (message.error) throw new Error("MCP operation failed.");
    return { result: message.result };
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > 262144) throw new Error("MCP response exceeds the size limit.");
      buffer += decoder.decode(value, { stream: !done });
      if (streaming) {
        let match: RegExpExecArray | null;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const event = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          const result = extract(JSON.parse(data));
          if (result) return result.result;
        }
      } else if (done) {
        const result = extract(JSON.parse(buffer));
        if (result) return result.result;
      }
      if (done) throw new Error("MCP response did not contain the requested result.");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function withMcp<T>(
  options: { endpoint: string; allowedOrigins: string[]; token?: string; fetcher?: typeof fetch },
  work: (call: (method: string, params?: Record<string, unknown>) => Promise<any>) => Promise<T>,
): Promise<T> {
  const url = validateMcpEndpoint(options.endpoint, options.allowedOrigins);
  const fetcher = options.fetcher ?? fetch;
  const signal = AbortSignal.timeout(30_000);
  let session: string | null = null;
  let nextId = 0;
  const headers = () => ({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-03-26",
    ...(session ? { "Mcp-Session-Id": session } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  });
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const id = ++nextId;
    const res = await fetcher(url, {
      method: "POST",
      redirect: "error",
      signal,
      headers: headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (method === "initialize") {
      session = res.headers.get("Mcp-Session-Id");
      if (session && !/^[\x21-\x7e]{1,256}$/.test(session)) throw new Error("Invalid MCP session.");
    }
    return rpcResponse(res, id);
  };
  try {
    const init = await call("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "nexora", version: "1.0.0" },
    });
    if (init?.protocolVersion !== "2025-03-26" || !init?.capabilities?.tools)
      throw new Error("MCP server does not support the required tools protocol.");
    const notified = await fetcher(url, {
      method: "POST",
      redirect: "error",
      signal,
      headers: headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    await notified.body?.cancel();
    if (!notified.ok) throw new Error("MCP initialization failed.");
    return await work(call);
  } finally {
    if (session) {
      await fetcher(url, {
        method: "DELETE",
        headers: headers(),
        redirect: "error",
        signal: AbortSignal.timeout(2000),
      })
        .then((r) => r.body?.cancel())
        .catch(() => {});
    }
  }
}
