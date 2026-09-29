"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { googleLoginUrl, loginWithPassword, setToken, signupWithPassword } from "../../lib/api";
import { Card, Input, Spinner } from "../../components/ui";

function LoginInner() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const oauthFailed = params.get("error") === "oauth_failed";
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Spinner label="Checking sign-in…" />
      </div>
    );
  }
  if (user) return null;

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const { token } =
        mode === "signup"
          ? await signupWithPassword(email.trim(), password, name.trim() || undefined)
          : await loginWithPassword(email.trim(), password);
      setToken(token);
      await refresh();
      router.replace("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <Card className="w-full max-w-xs p-6 shadow-none">
        <h1 className="text-center text-lg font-bold tracking-tight">
          {mode === "signup" ? "Sign up" : "Login"}
        </h1>

        {oauthFailed && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Google sign-in failed. Please try again.
          </p>
        )}

        <a
          href={googleLoginUrl()}
          data-testid="google-login"
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 transition-colors hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
        >
          <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-xs font-bold text-zinc-900 ring-1 ring-zinc-200">G</span>
          Login with Google
        </a>

        <p className="my-3 text-center text-xs text-zinc-400">or continue with email</p>

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {mode === "signup" && (
            <Input
              placeholder="Name"
              aria-label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="!rounded-md !border-zinc-200 !bg-zinc-50 focus:!border-emerald-600"
            />
          )}
          <Input
            type="email"
            placeholder="Email ID"
            aria-label="Email ID"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="!rounded-md !border-zinc-200 !bg-zinc-50 focus:!border-emerald-600"
          />
          <Input
            type="password"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="!rounded-md !border-zinc-200 !bg-zinc-50 focus:!border-emerald-600"
          />
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Working…" : mode === "signup" ? "Sign up" : "Login"}
          </button>
        </form>
        <button
          onClick={() => {
            setMode(mode === "signup" ? "login" : "signup");
            setError(null);
          }}
          className="mt-3 w-full text-center text-xs font-medium text-emerald-700 hover:text-emerald-900"
        >
          {mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}
        </button>
        <p className="mt-3 text-center text-xs text-zinc-400">
          Google sign-in goes directly to Google — we never see that password.
        </p>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-white"><Spinner /></div>}>
      <LoginInner />
    </Suspense>
  );
}
