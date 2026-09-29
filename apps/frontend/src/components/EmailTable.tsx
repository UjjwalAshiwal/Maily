"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { formatDateTime } from "../lib/compose";
import type { EmailItem } from "../types/index";
import { statusRing } from "./ui";
import { IconStar } from "./icons";

// Figma mail-client rows: To · time pill · subject + body preview · star.
// One self-contained row component; starring is a local visual toggle.
function previewOf(body: string | undefined | null): string {
  const flat = (body ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 110 ? `${flat.slice(0, 110)}…` : flat;
}

function TimePill({ email }: { email: EmailItem }) {
  const sent = email.status === "SENT" && email.sentAt;
  const label = sent ? formatDateTime(email.sentAt as string) : formatDateTime(email.scheduledAt);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusRing(email.status)}`}
    >
      {label}
    </span>
  );
}

export function EmailTable({
  emails,
  actions,
  onOpen,
}: {
  emails: EmailItem[];
  actions?: (email: EmailItem) => ReactNode;
  onOpen?: (email: EmailItem) => void;
}) {
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const toggleStar = (id: string) =>
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ul className="flex flex-col">
      {emails.map((e) => (
        <li
          key={e.id}
          onClick={() => onOpen?.(e)}
          className={`flex items-center gap-3 border-b border-zinc-100 px-4 py-2.5 last:border-0 ${
            onOpen ? "cursor-pointer hover:bg-zinc-50" : ""
          }`}
        >
          <span className="w-28 shrink-0 truncate text-[13px] text-zinc-500">To: {e.recipient}</span>
          <TimePill email={e} />
          <span className="min-w-0 flex-1 truncate text-[13px]">
            <span className="font-semibold text-zinc-900">{e.subject}</span>
            <span className="text-zinc-500"> · {previewOf(e.body)}</span>
          </span>
          {actions && (
            <span className="flex shrink-0 items-center gap-1" onClick={(ev) => ev.stopPropagation()}>
              {actions(e)}
            </span>
          )}
          <button
            onClick={(ev) => {
              ev.stopPropagation();
              toggleStar(e.id);
            }}
            aria-label={starred.has(e.id) ? "Unstar email" : "Star email"}
            aria-pressed={starred.has(e.id)}
            className={starred.has(e.id) ? "shrink-0 text-amber-400" : "shrink-0 text-zinc-300 hover:text-zinc-400"}
          >
            <IconStar width={16} height={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}
