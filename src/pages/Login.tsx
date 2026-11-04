import * as React from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Pill } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = React.useState<"signin" | "signup">("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pharmacyName, setPharmacyName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sessionReady, setSessionReady] = React.useState(false);
  const [hasSession, setHasSession] = React.useState(false);

  React.useEffect(() => {
    if (!supabase) {
      setSessionReady(true);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (sessionReady && hasSession) {
    return <Navigate to="/app" replace />;
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      toast.error("Auth is not configured (missing VITE_SUPABASE_URL / ANON_KEY)");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in");
        navigate("/app", { replace: true });
      } else {
        if (!pharmacyName.trim()) {
          toast.error("Enter your pharmacy name");
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { pharmacy_name: pharmacyName.trim() },
          },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Account created");
          navigate("/app", { replace: true });
        } else {
          toast.success("Check your email to confirm the account");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-lg items-center gap-2 px-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white">
            <Pill className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-slate-900">Pharma Flow</span>
          <Link to="/" className="ml-auto text-xs text-slate-500 hover:text-slate-800">
            Marketing site
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {mode === "signin" ? "Sign in" : "Create pharmacy account"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Each pharmacy is isolated. Your queue, agent data, and learnings never mix with another store.
        </p>

        {!isSupabaseConfigured() ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Set <code className="font-mono text-xs">VITE_SUPABASE_URL</code> and{" "}
            <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> on Vercel, then redeploy.
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {mode === "signup" ? (
            <div>
              <Label htmlFor="pharmacy">Pharmacy name</Label>
              <Input
                id="pharmacy"
                className="mt-1.5"
                value={pharmacyName}
                onChange={(e) => setPharmacyName(e.target.value)}
                placeholder="Amjay Pharmacy"
                required
              />
            </div>
          ) : null}
          <div>
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              className="mt-1.5"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className="mt-1.5"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          {mode === "signin" ? (
            <>
              New pharmacy?{" "}
              <button type="button" className="font-medium text-teal-700 hover:underline" onClick={() => setMode("signup")}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already registered?{" "}
              <button type="button" className="font-medium text-teal-700 hover:underline" onClick={() => setMode("signin")}>
                Sign in
              </button>
            </>
          )}
        </p>
      </main>
    </div>
  );
}
