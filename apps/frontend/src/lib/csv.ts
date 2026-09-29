// Minimal CSV recipient parsing. Header-based (email/recipient/address
// column, case-insensitive); falls back to the first column. No spreadsheet
// editor ambitions — one recipient per row, validated, previewed.

import { EMAIL_RE } from "./compose";

export interface CsvRow {
  email: string;
  valid: boolean;
}

export interface CsvParseResult {
  rows: CsvRow[];
  validEmails: string[];
  invalidRows: CsvRow[];
}

const splitLine = (line: string): string[] => {
  // Quote-aware splitter (handles "a,b"@x.com style fields).
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { out.push(cur); cur = ""; }
    else cur += c;
  }
  return [...out, cur].map((s) => s.trim());
};

export const parseCsvRecipients = (text: string): CsvParseResult => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [], validEmails: [], invalidRows: [] };

  const firstCells = splitLine(lines[0]);
  const header = firstCells.map((h) => h.toLowerCase());
  const emailIdx = header.findIndex((h) => ["email", "recipient", "address", "e-mail"].includes(h));
  // A first line that already looks like data (contains an email) is data,
  // not a header — otherwise a headerless file loses its first recipient.
  const firstLineIsData = firstCells.some((c) => EMAIL_RE.test(c.trim().toLowerCase()));
  const hasHeader = !firstLineIsData;
  const col = emailIdx >= 0 ? emailIdx : 0;
  const data = hasHeader ? lines.slice(1) : lines;

  const seen = new Set<string>();
  const rows: CsvRow[] = [];
  for (const line of data) {
    const email = (splitLine(line)[col] ?? "").trim().toLowerCase();
    if (!email) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    rows.push({ email, valid: EMAIL_RE.test(email) });
  }
  return {
    rows,
    validEmails: rows.filter((r) => r.valid).map((r) => r.email),
    invalidRows: rows.filter((r) => !r.valid),
  };
};
