"use client";

// Full-page compose (?edit=<id> becomes the scheduled-email editor).
// Delay/hourly inputs are computed into each recipient's scheduledAt;
// the server's Redis rate limiting stays the enforceable backstop.

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { fetchEmail, fetchSenders, scheduleEmail, updateScheduledEmail } from "../../../lib/api";
import { computeSchedule, defaultStartTime, EMAIL_RE, formatDateTime, toLocalInput } from "../../../lib/compose";
import { parseCsvRecipients } from "../../../lib/csv";
import { notifyEmailsChanged } from "../../../lib/events";
import { Button, Card, Input, Select, Spinner } from "../../../components/ui";
import { toast } from "../../../components/toast";
import { IconBack, IconCheck, IconClock, IconUpload, IconX } from "../../../components/icons";
import { useEffect } from "react";
import type { Sender } from "../../../types/index";

const fmtTime = (ms: number) => formatDateTime(new Date(ms).toISOString());

const atHour = (dayOffset: number, hour: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function ComposePage() {
  return (
    <Suspense>
      <ComposeInner />
    </Suspense>
  );
}

function ComposeInner() {
  const router = useRouter();
  const editId = useSearchParams().get("edit");
  const editing = editId !== null;
  const [senders, setSenders] = useState<Sender[]>([]);
  const [editLoading, setEditLoading] = useState(editing);
  const [senderId, setSenderId] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delaySecs, setDelaySecs] = useState("2");
  const [hourlyLimit, setHourlyLimit] = useState("200");
  const [startTime, setStartTime] = useState(() => defaultStartTime());
  const [popupStart, setPopupStart] = useState(() => defaultStartTime());
  const [showLater, setShowLater] = useState(false);
  const [csvInfo, setCsvInfo] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ email: string; error: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSenders()
      .then(({ senders }) => {
        setSenders(senders);
        setSenderId((prev) => prev || senders[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  // Edit mode: prefill the single scheduled email (PATCH is single-recipient).
  useEffect(() => {
    if (!editId) return;
    fetchEmail(editId)
      .then(({ email }) => {
        setSenderId(email.senderId);
        setChips([email.recipient]);
        setSubject(email.subject);
        setBody(email.body ?? "");
        setStartTime(toLocalInput(email.scheduledAt));
      })
      .catch((e) => setFormError(e instanceof Error ? e.message : "Failed to load email."))
      .finally(() => setEditLoading(false));
  }, [editId]);

  const addDraft = () => {
    const parts = draft.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const bad = parts.find((p) => !EMAIL_RE.test(p));
    if (bad) {
      setDraftError(`"${bad}" is not a valid email.`);
      return;
    }
    setDraftError(null);
    setDraft("");
    setChips((prev) => [...prev, ...parts.filter((p) => !prev.includes(p))]);
  };

  const addCsvFile = async (file: File) => {
    const parsed = parseCsvRecipients(await file.text());
    setChips((prev) => [...prev, ...parsed.validEmails.filter((e) => !prev.includes(e))]);
    setCsvInfo(
      `${parsed.validEmails.length} detected${parsed.invalidRows.length > 0 ? `, ${parsed.invalidRows.length} invalid skipped` : ""}`
    );
  };

  const delayMs = Math.max(0, Math.round(Number(delaySecs) || 0) * 1000);
  const hourly = Math.max(1, Math.floor(Number(hourlyLimit) || 200));
  const plan = chips.length > 0 ? computeSchedule(chips.length, new Date(startTime).getTime(), delayMs, hourly) : [];
  const lastMs = plan.length > 0 ? plan[plan.length - 1] : 0;

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!senderId) errs.senderId = "Choose a sender.";
    if (chips.length === 0) errs.to = "Add at least one recipient.";
    else if (editing && chips.length > 1) errs.to = "Editing handles one recipient at a time.";
    if (!subject.trim()) errs.subject = "Subject is required.";
    if (!body.trim()) errs.body = "Body is required.";
    if (!startTime || new Date(startTime).getTime() <= Date.now())
      errs.startTime = "Start time must be in the future.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const schedule = async () => {
    setFormError(null);
    setSuccess(null);
    setFailed([]);
    if (!validate()) return;
    setSubmitting(true);
    if (editing && editId) {
      try {
        await updateScheduledEmail(editId, {
          senderId,
          recipient: chips[0],
          subject: subject.trim(),
          body,
          scheduledAt: new Date(startTime).toISOString(),
        });
        notifyEmailsChanged();
        router.push("/dashboard/scheduled");
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Failed to save changes.");
        setSubmitting(false);
      }
      return;
    }
    const times = computeSchedule(chips.length, new Date(startTime).getTime(), delayMs, hourly);
    const results = await Promise.allSettled(
      chips.map((recipient, i) =>
        scheduleEmail({
          senderId,
          recipient,
          subject: subject.trim(),
          body,
          scheduledAt: new Date(times[i]).toISOString(),
        })
      )
    );
    const problems = results.flatMap((r, i) =>
      r.status === "rejected"
        ? [{ email: chips[i], error: r.reason instanceof Error ? r.reason.message : "failed" }]
        : []
    );
    const done = chips.length - problems.length;
    setSubmitting(false);
    notifyEmailsChanged();
    if (problems.length === 0) {
      setSuccess(`${done} email${done === 1 ? "" : "s"} scheduled.`);
      toast(`${done} email${done === 1 ? "" : "s"} scheduled.`);
      setChips([]);
      setSubject("");
      setBody("");
    } else {
      setFailed(problems);
      setFormError(`${problems.length} of ${chips.length} failed to schedule.`);
      toast(`${problems.length} of ${chips.length} failed to schedule.`);
    }
  };

  const presets = [
    { label: "Tomorrow, 9:00 AM", value: () => atHour(1, 9) },
    { label: "Tomorrow, 10:00 AM", value: () => atHour(1, 10) },
    { label: "Tomorrow, 11:00 AM", value: () => atHour(1, 11) },
    { label: "Tomorrow, 2:00 PM", value: () => atHour(1, 14) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-900 hover:text-zinc-600">
          <IconBack width={16} height={16} />
          {editing ? "Edit Scheduled Email" : "Compose New Email"}
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setPopupStart(startTime);
              setShowLater((v) => !v);
            }}
            aria-label="Send later options"
            title="Send later"
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100"
          >
            <IconClock width={18} height={18} />
          </button>
          <Button onClick={schedule} disabled={submitting || senders.length === 0} className="!rounded-full">
            {submitting ? (editing ? "Saving…" : "Scheduling…") : editing ? "Save changes" : "Send"}
          </Button>
        </div>
      </div>

      {showLater && (
        <Card className="max-w-xs self-end p-4">
          <p className="text-sm font-semibold">Send Later</p>
          <p className="mt-1 text-xs text-zinc-500">Pick date &amp; time</p>
          <Input
            type="datetime-local"
            aria-label="Send later date and time"
            value={popupStart}
            min={defaultStartTime()}
            onChange={(e) => setPopupStart(e.target.value)}
            className="mt-2"
          />
          <div className="mt-2 flex flex-col gap-1">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  setStartTime(p.value());
                  setShowLater(false);
                }}
                className="rounded-md px-2 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-100"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => setShowLater(false)}>Cancel</Button>
            <Button
              variant="secondary"
              className="!border-emerald-600 !px-3 !py-1.5 !text-emerald-700"
              onClick={() => {
                setStartTime(popupStart);
                setShowLater(false);
              }}
            >
              Done
            </Button>
          </div>
        </Card>
      )}

      {senders.length === 0 && (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No senders connected — add one in Settings before scheduling.
        </p>
      )}

      {editLoading && <Spinner label="Loading email…" />}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
          <span className="w-16 shrink-0 text-[13px] text-zinc-500">From:</span>
          <Select aria-label="Sender" value={senderId} onChange={(e) => setSenderId(e.target.value)} disabled={senders.length === 0} className="max-w-xs !border-0 !bg-zinc-50 !px-2">
            {senders.map((s) => (
              <option key={s.id} value={s.id}>{s.email}</option>
            ))}
          </Select>
          {errors.senderId && <p role="alert" className="text-sm text-red-600">{errors.senderId}</p>}
        </div>

        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start">
          <span className="w-16 shrink-0 pt-1.5 text-[13px] text-zinc-500">To:</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                  {c}
                  <button onClick={() => setChips(chips.filter((x) => x !== c))} aria-label={`Remove ${c}`} className="text-emerald-500 hover:text-emerald-800">
                    <IconX width={12} height={12} />
                  </button>
                </span>
              ))}
              {(!editing || chips.length === 0) && (
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addDraft();
                  }
                }}
                onBlur={addDraft}
                placeholder={chips.length === 0 ? "recipient@example.com" : "Add another…"}
                aria-label="Add recipient"
                className="min-w-[160px] flex-1 bg-transparent px-1 py-1 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
              />
              )}
              {!editing && (
              <button onClick={() => fileRef.current?.click()} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900">
                <IconUpload width={14} height={14} />
                Upload List
              </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,.txt"
                className="sr-only"
                aria-label="Upload recipient list"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void addCsvFile(f);
                  e.target.value = "";
                }}
              />
            </div>
            {draftError && <p role="alert" className="mt-1 text-sm text-red-600">{draftError}</p>}
            {csvInfo && <p role="status" className="mt-1 text-xs text-zinc-500">{csvInfo}</p>}
            {errors.to && <p role="alert" className="mt-1 text-sm text-red-600">{errors.to}</p>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
          <span className="w-16 shrink-0 text-[13px] text-zinc-500">Subject:</span>
          <Input aria-label="Subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="!border-0 !px-1" />
        </div>
        {errors.subject && <p role="alert" className="-mt-2 text-sm text-red-600 sm:pl-[4.5rem]">{errors.subject}</p>}

        {!editing && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:pl-[4.5rem]">
          <label className="inline-flex items-center gap-2 text-[13px] text-zinc-600">
            Delay between 2 emails
            <Input
              type="number"
              min={0}
              aria-label="Delay between emails in seconds"
              value={delaySecs}
              onChange={(e) => setDelaySecs(e.target.value)}
              className="!w-16 !px-2 !py-1 text-center"
            />
            <span className="text-zinc-400">sec</span>
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] text-zinc-600">
            Hourly Limit
            <Input
              type="number"
              min={1}
              aria-label="Hourly limit"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
              className="!w-20 !px-2 !py-1 text-center"
            />
          </label>
        </div>
        )}

        <div className="rounded-lg bg-zinc-50 p-3">
          <textarea
            aria-label="Email body"
            placeholder="Type Your Reply…"
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full resize-y bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          />
        </div>
        {errors.body && <p role="alert" className="text-sm text-red-600">{errors.body}</p>}

        <div className="flex flex-wrap items-center gap-2 text-[13px] text-zinc-500">
          <IconClock width={14} height={14} />
          <Input
            type="datetime-local"
            aria-label="Start time"
            value={startTime}
            min={defaultStartTime()}
            onChange={(e) => setStartTime(e.target.value)}
            className="!w-auto !border-zinc-200 !py-1"
          />
          {errors.startTime && <span role="alert" className="text-sm text-red-600">{errors.startTime}</span>}
          {!editing && plan.length > 0 && !errors.startTime && (
            <span role="status">
              {chips.length} recipient{chips.length === 1 ? "" : "s"} · starts {fmtTime(plan[0])}
              {plan.length > 1 && ` · last ${fmtTime(lastMs)}`}
            </span>
          )}
          {editing && (
            <span className="text-zinc-400">Saving reschedules this email; other queued mail is untouched.</span>
          )}
        </div>
        <p className="text-xs text-zinc-400">
          Pacing above schedules each recipient; the server also enforces its own minimum delay and hourly limit.
        </p>

        {formError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
        )}
        {failed.length > 0 && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {failed.map((f) => (
              <p key={f.email}>{f.email}: {f.error}</p>
            ))}
          </div>
        )}
        {success && (
          <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            <IconCheck width={16} height={16} /> {success}
          </p>
        )}
      </div>
    </div>
  );
}
