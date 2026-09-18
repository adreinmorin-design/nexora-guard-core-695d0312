import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    next:
      typeof search["next"] === "string" &&
      /^(?:\/connect-agent(?:\?code=[A-Fa-f0-9]{10})?|\/admin\/billing(?:\?plan=(?:solo|team|enterprise))?)$/.test(
        search["next"],
      )
        ? search["next"]
        : "/overview",
  }),
  head: () => ({
    meta: [
      { title: "Sign in — NEXORA Control Plane" },
      {
        name: "description",
        content:
          "Sign in to NEXORA, the AI security, governance and control plane for enterprise AI traffic, policies and agents.",
      },
      { property: "og:title", content: "Sign in — NEXORA Control Plane" },
      {
        property: "og:description",
        content: "Access your organization's AI security and governance console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function authErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "Authentication failed.";
  if (message.includes("Missing Supabase environment variable")) {
    return "Authentication is temporarily unavailable because this deployment is missing its Supabase public configuration.";
  }
  return message;
}

async function requireVerifiedSession(): Promise<void> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session?.access_token) {
    throw new Error("Authentication completed without a usable session. Please try again.");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(
    sessionData.session.access_token,
  );
  if (userError) throw userError;
  if (!userData.user) {
    throw new Error("Authentication completed but the session could not be verified.");
  }
}

function AuthPage() {
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (active && data.session) {
          await requireVerifiedSession();
          if (active) window.location.replace(next);
        }
      } catch (err) {
        if (active) setError(authErrorMessage(err));
      }
    })();

    return () => {
      active = false;
    };
  }, [next]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setStatus("Check your inbox to confirm this address, then sign in.");
          return;
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        if (!data.session) {
          throw new Error("Sign-in succeeded without creating a session. Please try again.");
        }
      }

      await requireVerifiedSession();
      window.location.replace(next);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <div className="h-6 w-6 rounded-sm border border-primary/50 bg-primary/15" />
          <span className="font-display text-sm font-semibold tracking-[0.22em]">NEXORA</span>
        </Link>

        <div className="panel p-6">
          <h1 className="font-display text-xl font-semibold">
            {mode === "signin" ? "Sign in to the control plane" : "Create an operator account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Access is scoped to your organization. Single sign-on (Entra ID, Okta) plugs into this
            same identity layer.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label-caps" htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="label-caps" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </div>

            {error ? (
              <p role="alert" className="text-sm text-critical">
                {error}
              </p>
            ) : null}
            {status ? (
              <p role="status" className="text-sm text-primary">
                {status}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {mode === "signin" ? "No account yet? Create one" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
