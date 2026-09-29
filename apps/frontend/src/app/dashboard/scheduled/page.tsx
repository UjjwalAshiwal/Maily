"use client";

import { useRouter } from "next/navigation";
import { EmailListView } from "../../../components/EmailListView";

export default function ScheduledPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-bold tracking-tight">Scheduled</h1>
        <p className="text-sm text-zinc-500">Emails queued for future delivery.</p>
      </div>
      <EmailListView
        status="SCHEDULED"
        emptyTitle="No scheduled emails"
        emptyHint="Nothing is queued. Schedule your first email to see it here."
        onCompose={() => router.push("/dashboard/compose")}
        manage
      />
    </div>
  );
}
