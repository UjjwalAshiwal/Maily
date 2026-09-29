"use client";

// Shared list view for Scheduled / Sent: PG-backed list by default,
// Elasticsearch-backed search when a query is typed. Loading/empty/error.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, fetchEmails, searchEmails, unscheduleEmail } from "../lib/api";
import { notifyEmailsChanged, onEmailsChanged } from "../lib/events";
import type { EmailItem } from "../types/index";
import { Button, Card, EmptyState, ErrorState, Input, Spinner } from "./ui";
import { EmailTable } from "./EmailTable";
import { IconSearch } from "./icons";

const PAGE_SIZE = 20;

export function EmailListView({
  status,
  emptyTitle,
  emptyHint,
  onCompose,
  manage,
}: {
  status: string;
  emptyTitle: string;
  emptyHint: string;
  onCompose: () => void;
  manage?: boolean;
}) {
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Empty query → authoritative PG list. Typed query → ES search scoped
      // to the caller's senders by the backend (ownership boundary respected).
      if (query.trim()) {
        const res = await searchEmails({ q: query.trim(), status, page, limit: PAGE_SIZE });
        setEmails(res.results);
        setTotal(res.total);
      } else {
        const res = await fetchEmails({ status, page, limit: PAGE_SIZE });
        setEmails(res.results);
        setTotal(res.total);
      }
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 500 && query.trim()
          ? "Search is unavailable right now (search index down). Clear the search to browse."
          : e instanceof Error
            ? e.message
            : "Failed to load emails."
      );
    } finally {
      setLoading(false);
    }
  }, [status, page, query]);

  useEffect(() => {
    void load();
    // Refetch when an email is scheduled elsewhere (compose dialog).
    return onEmailsChanged(() => void load());
  }, [load]);

  // New search starts from page 1.
  const onSearch = (v: string) => {
    setPage(1);
    setQuery(v);
  };

  const onUnschedule = async (email: EmailItem) => {
    if (!window.confirm(`Unschedule the email to ${email.recipient}? This cannot be undone.`)) return;
    setActionError(null);
    setActingId(email.id);
    try {
      await unscheduleEmail(email.id);
      notifyEmailsChanged();
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to unschedule email.");
    } finally {
      setActingId(null);
    }
  };

  const rowActions = (email: EmailItem) => (
    <span className="inline-flex gap-1">
      <button
        onClick={() => router.push(`/dashboard/compose?edit=${email.id}`)}
        aria-label={`Edit email to ${email.recipient}`}
        className="rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
      >
        Edit
      </button>
      <button
        onClick={() => void onUnschedule(email)}
        disabled={actingId === email.id}
        aria-label={`Unschedule email to ${email.recipient}`}
        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {actingId === email.id ? "Working…" : "Unschedule"}
      </button>
    </span>
  );

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-3">
      <div className="relative max-w-md">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
          <IconSearch width={16} height={16} />
        </span>
        <Input
          aria-label="Search emails"
          placeholder="Search"
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          className="!rounded-full !border-zinc-200 !bg-zinc-50 !pl-9"
        />
      </div>

      {actionError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>
      )}

      <Card>
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : emails.length === 0 ? (
          query.trim() ? (
            <EmptyState title="No matches" hint={`Nothing ${status.toLowerCase()} matches “${query.trim()}”.`} />
          ) : (
            <EmptyState
              title={emptyTitle}
              hint={emptyHint}
              action={<Button onClick={onCompose}>Schedule email</Button>}
            />
          )
        ) : (
          <>
            <EmailTable
              emails={emails}
              actions={manage ? rowActions : undefined}
              onOpen={(email) => router.push(`/dashboard/emails/${email.id}`)}
            />
            <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 text-sm text-zinc-500">
              <span role="status">
                {total} email{total === 1 ? "" : "s"} · page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" className="!px-3 !py-1.5" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" className="!px-3 !py-1.5" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
