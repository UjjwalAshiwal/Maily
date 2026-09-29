"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmailListView } from "../../../components/EmailListView";

const TABS = [
  { label: "All", status: "" },
  { label: "Sent", status: "SENT" },
  { label: "Failed", status: "FAILED" },
] as const;

export default function SentPage() {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-bold tracking-tight">Sent</h1>
        <p className="text-sm text-zinc-500">Delivered and failed sends.</p>
      </div>
      <div className="flex gap-1" role="tablist" aria-label="Sent filter">
        {TABS.map((t) => (
          <button
            key={t.label}
            role="tab"
            aria-selected={tab.label === t.label}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
              tab.label === t.label
                ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
                : "text-zinc-500 hover:bg-zinc-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <EmailListView
        key={tab.status}
        status={tab.status}
        emptyTitle={tab.status === "FAILED" ? "No failed emails" : "No sent emails yet"}
        emptyHint={
          tab.status === "FAILED"
            ? "Failed sends will appear here."
            : "Delivered emails will appear here once the worker processes the queue."
        }
        onCompose={() => router.push("/dashboard/compose")}
      />
    </div>
  );
}
