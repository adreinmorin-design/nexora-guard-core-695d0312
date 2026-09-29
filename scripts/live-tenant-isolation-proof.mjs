import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Missing public Supabase configuration.");

const run = `${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
const emailA = `adreinmorin+nxproof2-a-${run}@gmail.com`;
const emailB = `adreinmorin+nxproof2-b-${run}@gmail.com`;
const passA = `${randomBytes(24).toString("hex")}Aa1!`;
const passB = `${randomBytes(24).toString("hex")}Bb2!`;

const client = () =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const a = client();
const b = client();

async function signup(c, email, password) {
  const { error } = await c.auth.signUp({
    email,
    password,
    options: { data: { purpose: "nexora-live-verification-v2" } },
  });
  if (error) throw error;
}

async function login(c, email, password) {
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) return null;
  return data.user.id;
}

console.log(`Verification user A: ${emailA}`);
console.log(`Verification user B: ${emailB}`);
await signup(a, emailA, passA);
await signup(b, emailB, passB);

let userA = null;
let userB = null;
for (let attempt = 1; attempt <= 72; attempt++) {
  if (!userA) userA = await login(a, emailA, passA);
  if (!userB) userB = await login(b, emailB, passB);
  if (userA && userB) break;
  if (attempt === 72) throw new Error("Timed out waiting for both verification users to authenticate.");
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
console.log("PASS: both disposable users established valid production sessions.");

async function createOrg(c, uid, side) {
  const slug = `nxproof2-${side}-${run}`;
  const { data, error } = await c
    .from("organizations")
    .insert({ name: `Nexora Verification ${side.toUpperCase()} ${run}`, slug, created_by: uid })
    .select("id,slug,created_by")
    .single();
  if (error || !data) throw error ?? new Error("Organization creation returned no row.");
  return data;
}

const orgA = await createOrg(a, userA, "a");
const orgB = await createOrg(b, userB, "b");
if (orgA.id === orgB.id) throw new Error("Tenant IDs unexpectedly match.");

async function readOrg(c, id) {
  const { data, error } = await c.from("organizations").select("id,slug,created_by").eq("id", id);
  if (error) throw error;
  return data ?? [];
}

const [aOwn, bOwn, aCross, bCross] = await Promise.all([
  readOrg(a, orgA.id),
  readOrg(b, orgB.id),
  readOrg(a, orgB.id),
  readOrg(b, orgA.id),
]);

if (aOwn.length !== 1 || aOwn[0].id !== orgA.id) throw new Error("Tenant A cannot read its own resource.");
if (bOwn.length !== 1 || bOwn[0].id !== orgB.id) throw new Error("Tenant B cannot read its own resource.");
if (aCross.length !== 0) throw new Error("Tenant A can read tenant B resource.");
if (bCross.length !== 0) throw new Error("Tenant B can read tenant A resource.");

console.log(`Tenant A resource: ${orgA.id}`);
console.log(`Tenant B resource: ${orgB.id}`);
console.log("PASS: tenant A own-resource access succeeded.");
console.log("PASS: tenant B own-resource access succeeded.");
console.log("PASS: tenant A -> tenant B direct-ID probe returned zero rows.");
console.log("PASS: tenant B -> tenant A direct-ID probe returned zero rows.");
