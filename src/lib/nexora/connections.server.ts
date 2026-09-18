import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashCredential, newAgentCredential } from "./agent-credentials";
import { checked } from "./gateway.server";
import type { ConnectionScope } from "./connection-scopes";
const db: any = supabaseAdmin;

export async function startAgentConnection(name: string, scopes: ConnectionScope[]) {
  const deviceCode = (await newAgentCredential()).token;
  const code = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) =>
    b.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
  await checked(
    db.rpc("nexora_start_connection", {
      p_hash: await hashCredential(deviceCode),
      p_code: code,
      p_name: name,
      p_scopes: scopes,
    }),
  );
  return { device_code: deviceCode, user_code: code, expires_in: 600, interval: 5 };
}

export async function exchangeAgentConnection(deviceCode: string) {
  const credential = await newAgentCredential();
  const result = await checked(
    db.rpc("nexora_exchange_connection", {
      p_hash: await hashCredential(deviceCode),
      p_token_hash: credential.hash,
      p_prefix: credential.prefix,
    }),
  );
  if (result.error) return result;
  return {
    access_token: credential.token,
    token_type: "Bearer",
    expires_in: 90 * 86400,
    scope: result.scope,
    agent_id: result.agent_id,
  };
}
