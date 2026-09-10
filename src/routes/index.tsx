import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const adminRole = useQuery({
    queryKey: ["current-user", "admin-role", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) return false;
      return data?.role === "admin";
    },
  });

  return (
    <section className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl items-center px-6 py-16">
      <div>
        <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Search className="h-5 w-5" />
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">LinkedIn Research</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
          Search people, companies, and jobs through verified LinkedIn-capable providers, with
          explicit source provenance and private per-user history.
        </p>
        {!isLoading ? (
          <div className="mt-8 flex flex-wrap gap-3">
            {isAuthenticated ? (
              <Button asChild>
                <Link to="/linkedin-search">Open Search</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link to="/auth">Sign In</Link>
              </Button>
            )}
            {isAuthenticated && adminRole.data ? (
              <Button variant="outline" asChild>
                <Link to="/linkedin-diagnostics">
                  <ShieldCheck className="mr-2 h-4 w-4" /> Diagnostics
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
