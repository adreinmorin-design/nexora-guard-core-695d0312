# Deploying to Cloudflare Workers

Status: IMPLEMENTED, NOT_VERIFIED. No deploy has run from this repository's
workflow yet; treat the target as unverified until a `deploy.yml` run and the
smoke workflow both pass against it.

## How the build is produced

- `bun run build` uses the Nitro `cloudflare-module` preset and writes
  `.output/server/wrangler.json`.
- Nitro merges the root `wrangler.jsonc` into that file. The root file pins the
  worker `name` (`nexora-guard`) and `compatibility_date`. Nitro still owns
  `main`, `assets` and the `nodejs_compat` flag.
- Builds with `NEXORA_STRICT_PUBLIC_CONFIG=1` (set by `deploy.yml`) fail unless
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_*`) are set,
  so a Workers deploy can never point the browser at another project. Non-strict
  builds (Lovable's hosted builds) fall back to the legacy Lovable Cloud project with
  a loud warning, so the Lovable-connected app keeps publishing until cutover.
- `supabase/config.toml` still names the Lovable Cloud project so Lovable's linking
  is unchanged; the Nexora Guard project id is `pivwdmtcfzanrcbpkdqn`.
- The CI validation build (`ci.yml`) uses fake placeholder values under
  `*.supabase.invalid`. That build is never deployed.

- `deploy.yml` also passes `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and
  `NEXORA_ENVIRONMENT=production` to the Worker as plain runtime vars. The server
  Supabase client and the auth middleware read them from `process.env`; the
  build-time `VITE_*` copies only reach the browser bundle. Secrets such as
  `SUPABASE_SERVICE_ROLE_KEY` are never passed this way.

## GitHub configuration (repository owner)

Repository variables (Settings → Secrets and variables → Actions → Variables):

| Variable                   | Used by                              | Value                                                                           |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| `SUPABASE_URL`             | deploy build, smoke, isolation proof | `https://pivwdmtcfzanrcbpkdqn.supabase.co`                                      |
| `SUPABASE_PUBLISHABLE_KEY` | deploy build, smoke, isolation proof | the project's `sb_publishable_…` key                                            |
| `NEXORA_HOST`              | smoke                                | the deployed base URL, for example `https://nexora-guard.<account>.workers.dev` |

Repository secrets:

| Secret                  | Purpose                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | A token with the "Edit Cloudflare Workers" template. If it is absent, `deploy.yml` skips with a notice. |
| `CLOUDFLARE_ACCOUNT_ID` | The target account.                                                                                     |

`deploy.yml` runs in the `production` GitHub environment, so you can add
required reviewers there. It deploys after a successful push run of `ci.yml`
on `main`, or from a manual dispatch on `main`.

Once the `SUPABASE_*` variables are set, `production-smoke.yml` and
`live-tenant-isolation-proof.yml` target the new project by default. Both run
only by manual dispatch (Actions → workflow → Run workflow); they never run on
push. Dispatch inputs override the variables. When neither is
set, the workflows keep using the legacy Lovable Cloud values.

## Worker secrets (set out of band, never in this repo or workflow)

Run each command interactively and paste the value when prompted:

```bash
bunx wrangler@4.164.0 secret put <NAME> --name nexora-guard
```

Required:

- `SUPABASE_SERVICE_ROLE_KEY`

Model providers (set the ones you use):

- `OPENAI_API_KEY` (or `OPEN_AI_PLATFORM_API_KEY`)
- `ANTHROPIC_API_KEY`
- `GOOGLE_AI_API_KEY` (or `GEMINI_API_KEY`)
- `LOVABLE_API_KEY`, used by the failure-summary AI Gateway

Billing (Paddle):

- `PADDLE_WEBHOOK_SECRET`
- `PADDLE_CHECKOUT_SIGNING_SECRET`

Operations:

- `LOVABLE_CRON_SECRET` (and `LOVABLE_CRON_SECRET_PREVIOUS` during rotation)
- `SLACK_WEBHOOK_URL`
- `MCP_TOKEN_<SERVER_UUID_WITH_UNDERSCORES>`, one for each MCP server that needs a bearer token

Some values are configuration rather than secrets. Set them with
`wrangler secret put` too, or as plain `vars` in a deploy-time config:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
- `PADDLE_ENVIRONMENT`, `PADDLE_CLIENT_TOKEN`, `PADDLE_PRICE_SOLO_MONTHLY`,
  `PADDLE_PRICE_SOLO_ANNUAL`, `PADDLE_PRICE_TEAM_MONTHLY` and `PADDLE_PRICE_TEAM_ANNUAL`
- `PROVIDER_ALLOWED_ORIGINS`, `MCP_ALLOWED_ORIGINS`, `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL`
- `NEXORA_ENVIRONMENT`, `NEXORA_ALERT_MAILBOX_ID`

Never put any of these in a `VITE_` variable.

## Supabase Auth URL configuration

In the Supabase dashboard for project `pivwdmtcfzanrcbpkdqn`, open
Authentication → URL Configuration:

- **Site URL**: the production origin, such as `https://nexora-guard.<account>.workers.dev`
  or your custom domain.
- **Redirect URLs**: `<origin>/auth` and `<origin>/auth?recovery=1`. The app
  sends these for sign-up confirmation and password recovery. Add the same
  entries for any other origin you still serve, such as a Lovable preview.
