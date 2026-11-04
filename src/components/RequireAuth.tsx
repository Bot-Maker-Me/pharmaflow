import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";

import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * Protects the application shell. If Supabase auth env is missing (local demos),
 * access is allowed so engineering can still run the UI offline.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [loading, setLoading] = React.useState(true);
  const [ok, setOk] = React.useState(false);

  React.useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) {
      setOk(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setOk(Boolean(data.session));
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setOk(Boolean(session));
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Checking session…
      </div>
    );
  }

  if (!ok) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
