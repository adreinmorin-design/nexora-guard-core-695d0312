import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { next: string; recovery?: boolean } => ({
    next:
      typeof search["next"] === "string" &&
      /^(?:\/connect-agent(?:\?code=[A-Fa-f0-9]{10})?|\/admin\/billing(?:\?plan=(?:solo|team|enterprise))?)$/.test(
        search["next"],
      )
        ? search["next"]
        : "/overview",
    recovery: search["recovery"] === "1" || search["recovery"] === true ? true : undefined,
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

type AuthMode = "signin" | "signup" | "forgot" | "recovery";

function AuthPage() {
  const { next, recovery } = Route.useSearch();
  const [mode, setMode] = useState<AuthMode>(recovery ? "recovery" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(recovery ? "recovery" : "signin");
  }, [recovery]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (!active || !data.session) return;

        if (recovery) {
          await requireVerifiedSession();
          if (active) setStatus("Recovery link verified. Choose a new password.");
          return;
        }

        await requireVerifiedSession();
        if (active) window.location.replace(next);
      } catch (err) {
        if (active) setError(authErrorMessage(err));
      }
    })();

    return () => {
      active = false;
    };
  }, [next, recovery]);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setStatus(null);
    setPassword("");
    setPasswordConfirmation("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      if (mode === "forgot") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth?recovery=1`,
        });
        if (resetError) throw resetError;
        setStatus("If that address is registered, a password-reset link has been sent.");
        return;
      }

      if (mode === "recovery") {
        if (password.length < 8) {
          throw new Error("Password must contain at least 8 characters.");
        }
        if (password !== passwordConfirmation) {
          throw new Error("Passwords do not match.");
        }

        await requireVerifiedSession();
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;

        setStatus("Password updated. Redirecting to the control plane…");
        window.location.replace(next);
        return;
      }

      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth` },
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

  const heading =
    mode === "signup"
      ? "Create an operator account"
      : mode === "forgot"
        ? "Reset your password"
        : mode === "recovery"
          ? "Choose a new password"
          : "Sign in to the control plane";

  return (
    <div className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <div className="h-6 w-6 rounded-sm border border-primary/50 bg-primary/15" />
          <span className="font-display text-sm font-semibold tracking-[0.22em]">NEXORA</span>
        </Link>

        <div className="panel p-6">
          <h1 className="font-display text-xl font-semibold">{heading}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "forgot"
              ? "Enter your work email and NEXORA will send a secure recovery link."
              : mode === "recovery"
                ? "Use a new password with at least eight characters."
                : "Access is scoped to your organization. Single sign-on (Entra ID, Okta) plugs into this same identity layer."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode !== "recovery" ? (
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
            ) : null}

            {mode !== "forgot" ? (
              <div>
                <label className="label-caps" htmlFor="password">
                  {mode === "recovery" ? "New password" : "Password"}
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={
                    mode === "signin"
                      ? "current-password"
                      : mode === "recovery"
                        ? "new-password"
                        : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                />
              </div>
            ) : null}

            {mode === "recovery" ? (
              <div>
                <label className="label-caps" htmlFor="password-confirmation">
                  Confirm new password
                </label>
                <input
                  id="password-confirmation"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                />
              </div>
            ) : null}

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
              {busy
                ? "Working…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "forgot"
                      ? "Send recovery link"
                      : "Update password"}
            </button>
          </form>

          {mode === "signin" ? (
            <button
              type="button"
              onClick={() => changeMode("forgot")}
              className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot your password?
            </button>
          ) : null}

          {mode !== "recovery" ? (
            <button
              type="button"
              onClick={() => changeMode(mode === "signup" ? "signin" : "signup")}
              className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              {mode === "signup"
                ? "Already have an account? Sign in"
                : "No account yet? Create one"}
            </button>
          ) : null}

          {mode === "forgot" ? (
            <button
              type="button"
              onClick={() => changeMode("signin")}
              className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Back to sign in
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
