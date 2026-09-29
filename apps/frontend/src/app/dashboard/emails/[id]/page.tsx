"use client";

// Email detail: back · subject · sender avatar/name · recipient ·
// timestamp · body · top-right actions. Data comes from the existing
// single-email API; scheduled mails keep Edit / Unschedule here too.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchEmail, unscheduleEmail } from "../../../../lib/api";
import { notifyEmailsChanged } from "../../../../lib/events";
import { formatDateTime } from "../../../../lib/compose";
import { Button, Card, ErrorState, Spinner } from "../../../../components/ui";
import { IconBack, IconEdit, IconStar, IconTrash } from "../../../../components/icons";
import type { EmailItem } from "../../../../types/index";

export default function EmailDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [email, setEmail] = useState<EmailItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starred, setStarred] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchEmail(id)
      .then(({ email }) => {
        if (!cancelled) setEmail(email);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load email.");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const onUnschedule = async () => {
    if (!email) return;
    if (!window.confirm(`Unschedule the email to ${email.recipient}? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await unscheduleEmail(email.id);
      notifyEmailsChanged();
      router.push("/dashboard/scheduled");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to unschedule email.");
    }
  };

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={() => router.back()} className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-zinc-900 hover:text-zinc-600">
          <IconBack width={16} height={16} />
          Back
        </button>
        <Card>
          <ErrorState message={error} onRetry={() => router.refresh()} />
        </Card>
      </div>
    );
  }
  if (!email) {
    return <Spinner label="Loading email…" />;
  }

  const scheduled = email.status === "SCHEDULED";
  const when = email.status === "SENT" && email.sentAt ? email.sentAt : email.scheduledAt;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-900 hover:text-zinc-600">
          <IconBack width={16} height={16} />
          <span className="max-w-[50vw] truncate">{email.subject}</span>
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setStarred((v) => !v)}
            aria-label={starred ? "Unstar email" : "Star email"}
            aria-pressed={starred}
            className={`rounded-lg p-2 ${starred ? "text-amber-400" : "text-zinc-400 hover:bg-zinc-100"}`}
          >
            <IconStar width={18} height={18} />
          </button>
          {scheduled && (
            <>
              <button
                onClick={() => router.push(`/dashboard/compose?edit=${email.id}`)}
                aria-label="Edit email"
                title="Edit"
                className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <IconEdit width={18} height={18} />
              </button>
              <button
                onClick={onUnschedule}
                aria-label="Unschedule email"
                title="Unschedule"
                className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600"
              >
                <IconTrash width={18} height={18} />
              </button>
            </>
          )}
        </div>
      </div>

      {actionError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">
            {(email.senderEmail ?? email.senderId).slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">{email.senderEmail ?? email.senderId}</p>
            <p className="truncate text-xs text-zinc-500">to {email.recipient}</p>
          </div>
        </div>
        <p className="shrink-0 text-xs text-zinc-400">{formatDateTime(when)}</p>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">{email.body}</p>

      {scheduled && (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push(`/dashboard/compose?edit=${email.id}`)}>
            <IconEdit width={16} height={16} />
            Edit
          </Button>
          <Button variant="danger" onClick={onUnschedule}>
            <IconTrash width={16} height={16} />
            Unschedule
          </Button>
        </div>
      )}
    </div>
  );
}
