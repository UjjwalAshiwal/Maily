"use client";

// Settings: sender management + Slack integration.

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { createSender, deleteSender, disconnectSlack, fetchSenders, fetchSlackStatus, slackConnectUrl } from "../../../lib/api";
import { notifyEmailsChanged } from "../../../lib/events";
import { Button, Card, Input, Spinner } from "../../../components/ui";
import type { Sender } from "../../../types/index";

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}

function SettingsInner() {
  const slackReturn = useSearchParams().get("slack");
  const [senderList, setSenderList] = useState<Sender[]>([]);
  const [newSender, setNewSender] = useState("");
  const [senderSaving, setSenderSaving] = useState(false);
  const [senderError, setSenderError] = useState<string | null>(null);
  const [slackConnected, setSlackConnected] = useState<boolean | null>(null);
  const [slackBusy, setSlackBusy] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSenders()
      .then((r) => {
        if (!cancelled) setSenderList(r.senders);
      })
      .catch(() => {});
    fetchSlackStatus()
      .then((r) => {
        if (!cancelled) setSlackConnected(r.connected);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshSenders() {
    const { senders: list } = await fetchSenders();
    setSenderList(list);
    notifyEmailsChanged();
  }

  async function addSender() {
    const email = newSender.trim();
    if (!email) {
      setSenderError("Enter an email address.");
      return;
    }
    setSenderSaving(true);
    setSenderError(null);
    try {
      await createSender(email);
      setNewSender("");
      await refreshSenders();
    } catch (e) {
      setSenderError(e instanceof Error ? e.message : "Failed to add sender.");
    } finally {
      setSenderSaving(false);
    }
  }

  async function removeSender(id: string, email: string) {
    if (!window.confirm(`Remove sender ${email}? Its saved emails will be kept.`)) return;
    setSenderError(null);
    try {
      await deleteSender(id);
      await refreshSenders();
    } catch (e) {
      setSenderError(e instanceof Error ? e.message : "Failed to remove sender.");
    }
  }

  async function connectSlackAccount() {
    setSlackBusy(true);
    setSlackError(null);
    try {
      window.location.href = await slackConnectUrl();
    } catch (e) {
      setSlackError(e instanceof Error ? e.message : "Failed to start Slack connect.");
      setSlackBusy(false);
    }
  }

  async function disconnectSlackAccount() {
    setSlackBusy(true);
    setSlackError(null);
    try {
      await disconnectSlack();
      const { connected } = await fetchSlackStatus();
      setSlackConnected(connected);
    } catch (e) {
      setSlackError(e instanceof Error ? e.message : "Failed to disconnect Slack.");
    } finally {
      setSlackBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-500">Senders and integrations for your account.</p>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Slack</h2>
        {slackReturn === "connected" && (
          <p role="status" className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Slack connected — hourly-limit alerts enabled.
          </p>
        )}
        {slackReturn === "error" && (
          <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Slack connection failed — please try again.
          </p>
        )}
        {slackConnected ? (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-emerald-700" role="status">Slack connected — hourly-limit alerts enabled.</p>
            <Button variant="secondary" onClick={disconnectSlackAccount} disabled={slackBusy}>
              {slackBusy ? "Working…" : "Disconnect"}
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-500">Connect Slack to get notified when a sender hits the hourly limit.</p>
            <Button onClick={connectSlackAccount} disabled={slackBusy}>
              {slackBusy ? "Working…" : "Connect Slack"}
            </Button>
          </div>
        )}
        {slackError && (
          <p role="alert" className="mt-2 text-sm text-red-600">{slackError}</p>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Senders</h2>
        {senderList.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {senderList.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 border-b border-zinc-100 py-1.5 text-sm text-zinc-700 last:border-0">
                <span className="truncate">{s.email}</span>
                <button
                  onClick={() => removeSender(s.id, s.email)}
                  aria-label={`Remove sender ${s.email}`}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">No senders yet — add one below to enable scheduling.</p>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            placeholder="you@example.com"
            aria-label="New sender email"
            value={newSender}
            onChange={(e) => setNewSender(e.target.value)}
          />
          <Button onClick={addSender} disabled={senderSaving}>
            {senderSaving ? "Adding…" : "Add sender"}
          </Button>
        </div>
        {senderError && (
          <p role="alert" className="mt-2 text-sm text-red-600">{senderError}</p>
        )}
      </Card>
    </div>
  );
}
