"use client";

// Email-app shell: slim left sidebar (brand, user, compose, CORE nav),
// content slot on the right. Matches the Figma mail-client layout.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { fetchEmails } from "../lib/api";
import { Button } from "./ui";
import { IconClock, IconLogout, IconMenu, IconPlus, IconSend, IconX } from "./icons";

const NAV = [
  { href: "/dashboard/scheduled", label: "Scheduled", icon: IconClock, countKey: "scheduled" as const },
  { href: "/dashboard/sent", label: "Sent", icon: IconSend, countKey: "sent" as const },
];

export function Shell({ children, onCompose }: { children: ReactNode; onCompose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<{ scheduled: number | null; sent: number | null }>({
    scheduled: null,
    sent: null,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchEmails({ status: "SCHEDULED", limit: 1 }).then((r) => r.total),
      fetchEmails({ status: "SENT", limit: 1 }).then((r) => r.total),
    ])
      .then(([scheduled, sent]) => {
        if (!cancelled) setCounts({ scheduled, sent });
      })
      .catch(() => {}); // counts stay blank rather than breaking nav
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const compose = () => {
    setOpen(false);
    onCompose();
  };

  const nav = (
    <div className="flex flex-col gap-4 p-3">
      <button
        onClick={compose}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-emerald-600 bg-white px-4 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
      >
        <IconPlus width={16} height={16} />
        Compose
      </button>
      <div>
        <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Core</p>
        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon, countKey }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-emerald-50 font-medium text-emerald-900"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                <Icon width={16} height={16} />
                <span className="flex-1">{label}</span>
                {counts[countKey] !== null && (
                  <span className="text-xs tabular-nums text-zinc-400">{counts[countKey]}</span>
                )}
              </Link>
            );
          })}
          <Link
            href="/dashboard/settings"
            onClick={() => setOpen(false)}
            aria-current={pathname.startsWith("/dashboard/settings") ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
              pathname.startsWith("/dashboard/settings")
                ? "bg-emerald-50 font-medium text-emerald-900"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            <IconMenu width={16} height={16} />
            <span className="flex-1">Settings</span>
          </Link>
        </nav>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-white text-zinc-900">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">
        <div className="px-4 pb-2 pt-4">
          <p className="text-base font-extrabold tracking-tight">Maily</p>
        </div>
        <div className="px-3 pb-1">
          <div className="flex items-center gap-2.5 rounded-lg bg-zinc-50 px-2.5 py-2">
            {user?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
                {(user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-tight">{user?.name ?? "…"}</p>
              <p className="truncate text-xs leading-tight text-zinc-500">{user?.email ?? ""}</p>
            </div>
          </div>
        </div>
        <div className="flex-1">{nav}</div>
        <div className="border-t border-zinc-100 p-3">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100"
          >
            <IconLogout width={16} height={16} />
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2.5 md:hidden">
          <button
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
          >
            {open ? <IconX /> : <IconMenu />}
          </button>
          <p className="text-base font-extrabold tracking-tight">Maily</p>
          <div className="ml-auto">
            <Button className="!rounded-full !px-3 !py-1.5" onClick={compose}>
              <IconPlus width={16} height={16} />
              Compose
            </Button>
          </div>
        </header>
        {open && (
          <div className="border-b border-zinc-200 bg-white md:hidden">
            {nav}
            <div className="border-t border-zinc-100 p-3">
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
              >
                <IconLogout width={16} height={16} />
                Log out
              </button>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
