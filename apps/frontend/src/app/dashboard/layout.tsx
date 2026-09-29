"use client";

// Auth gate + shell for every /dashboard route. Composing lives on the
// full /dashboard/compose page (create + ?edit=<id>); no modal remains.

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../../lib/auth";
import { Shell } from "../../components/Shell";
import { Button, Spinner } from "../../components/ui";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, error, refresh } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <Spinner label="Loading your workspace…" />
      </div>
    );
  }

  if (!user) {
    if (error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
          <div className="text-center">
            <p role="alert" className="text-sm text-red-600">{error}</p>
            <div className="mt-3 flex justify-center gap-2">
              <Button variant="secondary" onClick={() => void refresh()}>Retry</Button>
              <Button onClick={() => router.push("/login")}>Back to login</Button>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <Shell onCompose={() => router.push("/dashboard/compose")}>
      <div className="view-enter">{children}</div>
    </Shell>
  );
}
