import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ensureWorkspace } from "@/lib/nexora.functions";
import { AppShell } from "@/components/nexora/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { next: location.href } });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  const ensure = useServerFn(ensureWorkspace);
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => ensure({}),
    staleTime: 60_000,
  });

  if (isPending) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4">
        <div className="panel w-full max-w-md p-6">
          <p className="label-caps">NEXORA</p>
          <h1 className="mt-2 font-display text-lg font-semibold">Initializing your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your identity is verified. NEXORA is loading the organization control plane.
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    console.error("[NEXORA] Workspace initialization failed", error);

    return (
      <div className="grid min-h-screen place-items-center bg-background px-4">
        <div className="panel w-full max-w-md p-6">
          <p className="label-caps">NEXORA</p>
          <h1 className="mt-2 font-display text-lg font-semibold">Workspace initialization failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your sign-in succeeded, but the control plane could not initialize your organization.
            This is a backend or deployment configuration error, not an invalid password.
          </p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                void supabase.auth.signOut().finally(() => window.location.replace("/auth"));
              }}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AppShell org={data.orgName} roles={data.roles} email={user?.email ?? null}>
      <Outlet />
    </AppShell>
  );
}
