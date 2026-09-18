import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ensureWorkspace } from "@/lib/nexora.functions";
import { AppShell } from "@/components/nexora/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  const ensure = useServerFn(ensureWorkspace);
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => ensure({}),
    staleTime: 60_000,
  });

  return (
    <AppShell org={data?.orgName} roles={data?.roles} email={user?.email ?? null}>
      <Outlet />
    </AppShell>
  );
}
