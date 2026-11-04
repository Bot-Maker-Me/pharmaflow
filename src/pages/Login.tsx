import * as React from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
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
    <div className="flex min-h-screen flex-col bg-[#F6F4EF] text-[#1C1C1C]">
      <header className="border-b border-[#1C1C1C]/08">
        <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-[#1C1C1C] text-[10px] font-semibold tracking-[0.12em] text-[#F6F4EF]">
              PF
            </span>
            <span className="text-[14px] font-medium tracking-tight">Pharma Flow</span>
          </Link>
          <Link
            to="/"
            className="ml-auto text-[12px] text-[#1C1C1C]/5 transition hover:text-[#1C1C1C]"
          >
            Site
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-12">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#1F4A4D]">
          {mode === "signin" ? "Access" : "Onboarding"}
        </p>
        <h1 className="mt-3 text-[1.75rem] font-semibold tracking-[-0.03em]">
          {mode === "signin" ? "Sign in" : "Create pharmacy account"}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[#1C1C1C]/55">
          Each pharmacy is isolated. Queues, agent data, and learnings stay inside your store.
        </p>

        {!isSupabaseConfigured() ? (
          <div className="mt-6 rounded-lg border border-[#A63737]/25 bg-[#A63737]/08 p-3 text-[13px] text-[#733232]">
            Set <code className="font-mono text-[11px]">VITE_SUPABASE_URL</code> and{" "}
            <code className="font-mono text-[11px]">VITE_SUPABASE_ANON_KEY</code> on Vercel, then
            redeploy.
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {mode === "signup" ? (
            <div>
              <Label htmlFor="pharmacy" className="text-[13px] text-[#1C1C1C]/7">
                Pharmacy name
              </Label>
              <Input
                id="pharmacy"
                className="mt-1.5 h-11 border-[#1C1C1C]/12 bg-white"
                value={pharmacyName}
                onChange={(e) => setPharmacyName(e.target.value)}
                placeholder="Amjay Pharmacy"
                required
              />
            </div>
          ) : null}
          <div>
            <Label htmlFor="email" className="text-[13px] text-[#1C1C1C]/7">
              Work email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              className="mt-1.5 h-11 border-[#1C1C1C]/12 bg-white"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="password" className="text-[13px] text-[#1C1C1C]/7">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className="mt-1.5 h-11 border-[#1C1C1C]/12 bg-white"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <Button
            type="submit"
            className="h-11 w-full rounded-full bg-[#1F4A4D] text-[14px] font-medium hover:bg-[#183741]"
            disabled={busy}
          >
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-8 text-center text-[13px] text-[#1C1C1C]/55">
          {mode === "signin" ? (
            <>
              New pharmacy?{" "}
              <button
                type="button"
                className="font-medium text-[#1F4A4D] underline-offset-2 hover:underline"
                onClick={() => setMode("signup")}
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already registered?{" "}
              <button
                type="button"
                className="font-medium text-[#1F4A4D] underline-offset-2 hover:underline"
                onClick={() => setMode("signin")}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </main>
    </div>
  );
}
