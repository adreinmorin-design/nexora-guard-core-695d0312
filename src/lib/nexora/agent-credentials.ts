export async function hashCredential(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function newAgentCredential() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = "nxr_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return { token, hash: await hashCredential(token), prefix: token.slice(0, 12) };
}

export function agentBearer(header: string | null): string {
  const match = /^Bearer (nxr_[a-f0-9]{64})$/.exec(header ?? "");
  if (!match?.[1]) throw new Error("Invalid agent credential.");
  return match[1];
}
