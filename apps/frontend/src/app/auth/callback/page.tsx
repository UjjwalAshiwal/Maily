"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { setToken } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { Spinner } from "../../../components/ui";

function CallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("Sign-in did not return a token.");
      return;
    }
    // Backstop: never spin forever. The API layer already times out, but
    // this guarantees the spinner always resolves to dashboard or error.
    const safety = setTimeout(() => {
      setError((prev) => prev ?? "Sign-in is taking too long. Please try again.");
    }, 30000);
    setToken(token);
    refresh()
      .then(() => {
        clearTimeout(safety);
        router.replace("/dashboard");
      })
      .catch(() => {
        clearTimeout(safety);
        setError("Sign-in succeeded but loading your profile failed.");
      });
    return () => clearTimeout(safety);
  }, [params, router, refresh]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
        <div className="text-center">
          <p role="alert" className="text-sm text-red-600">{error}</p>
          <a href="/login" className="mt-2 inline-block text-sm font-medium text-zinc-900 underline">
            Back to login
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <Spinner label="Finishing sign-in…" />
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-zinc-50"><Spinner /></div>}>
      <CallbackInner />
    </Suspense>
  );
}
