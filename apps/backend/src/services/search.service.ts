import { prisma } from "../db/prisma.js";
import { logger } from "../utils/logger.js";
import {
  EMAILS_INDEX,
  es,
  indexEmailDocument,
  searchEmailDocuments,
  type EmailDocument,
} from "../integrations/elasticsearch.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
export const EMAIL_STATUSES = ["SCHEDULED", "PROCESSING", "SENT", "FAILED"] as const;

export interface SearchResultItem {
  id: string;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
}

export interface SearchResponse {
  results: SearchResultItem[];
  total: number;
}

export const EMPTY_SEARCH_RESPONSE: SearchResponse = { results: [], total: 0 };

// Best-effort sync: PostgreSQL is authoritative. Never throws — callers must
// not fail sends or scheduling just because the index is unreachable.
export const syncEmailToIndex = async (emailId: string): Promise<void> => {
  try {
    const email = await prisma.email.findUnique({ where: { id: emailId } });
    if (!email) return;
    await indexEmailDocument(toEmailDocument(email));
  } catch (err) {
    logger.error({ emailId, operation: "index", err }, "elasticsearch indexing failed");
  }
};

// Single row→document mapper shared by live sync and the reindex script.
export const toEmailDocument = (email: {
  id: string;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): EmailDocument => ({
  id: email.id,
  senderId: email.senderId,
  recipient: email.recipient,
  subject: email.subject,
  body: email.body,
  status: email.status,
  scheduledAt: email.scheduledAt.toISOString(),
  sentAt: email.sentAt?.toISOString() ?? null,
  createdAt: email.createdAt.toISOString(),
  updatedAt: email.updatedAt.toISOString(),
});

// Pure mapping from ES hits to the public API shape. No ES internals leak.
export const toSearchResponse = (hits: EmailDocument[], total: number): SearchResponse => ({
  results: hits.map((h) => ({
    id: h.id,
    senderId: h.senderId,
    recipient: h.recipient,
    subject: h.subject,
    body: h.body,
    status: h.status,
    scheduledAt: h.scheduledAt,
    sentAt: h.sentAt,
  })),
  total,
});

// Best-effort removal (unschedule): missing documents are fine, other
// failures are logged and swallowed — same contract as syncEmailToIndex.
export const removeEmailFromIndex = async (emailId: string): Promise<void> => {
  try {
    await es.delete({ index: EMAILS_INDEX, id: emailId });
  } catch (err: any) {
    if (err?.statusCode === 404 || err?.meta?.statusCode === 404) return;
    logger.error({ emailId, operation: "delete", err }, "elasticsearch delete failed");
  }
};

export const searchEmails = async (input: {
  q?: unknown;
  status?: unknown;
  page?: unknown;
  limit?: unknown;
  senderIds?: unknown;
}): Promise<SearchResponse> => {
  const q = typeof input.q === "string" ? input.q.trim() : "";
  // Deliberate: no match-all. Empty query returns nothing.
  if (!q) return EMPTY_SEARCH_RESPONSE;

  // Ownership boundary: an explicitly empty sender list means "user owns
  // nothing" and short-circuits without touching Elasticsearch.
  const senderIds = Array.isArray(input.senderIds)
    ? (input.senderIds as unknown[]).filter((s): s is string => typeof s === "string")
    : undefined;
  if (senderIds !== undefined && senderIds.length === 0) return EMPTY_SEARCH_RESPONSE;

  const status =
    typeof input.status === "string" && (EMAIL_STATUSES as readonly string[]).includes(input.status)
      ? input.status
      : undefined;
  if (typeof input.status === "string" && input.status && !status)
    throw Object.assign(new Error("invalid status filter"), { status: 400 });

  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(input.limit) || DEFAULT_LIMIT));

  try {
    const res = await searchEmailDocuments({ q, status, senderIds, from: (page - 1) * limit, size: limit });
    const hits = res.hits.hits.map((h) => h._source as EmailDocument);
    const total =
      typeof res.hits.total === "number" ? res.hits.total : (res.hits.total?.value ?? hits.length);
    return toSearchResponse(hits, total);
  } catch (err) {
    // ponytail: ES down (e.g. Render with no managed ES) falls back to Postgres
    // ILIKE instead of 500ing search.
    logger.error({ err }, "elasticsearch search failed, falling back to postgres");
    const where: any = {
      ...(status ? { status } : {}),
      ...(senderIds !== undefined ? { senderId: { in: senderIds } } : {}),
      OR: [
        { recipient: { contains: q, mode: "insensitive" } },
        { subject: { contains: q, mode: "insensitive" } },
        { body: { contains: q, mode: "insensitive" } },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.email.findMany({
        where,
        orderBy: { scheduledAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.email.count({ where }),
    ]);
    return {
      results: rows.map((e) => ({
        id: e.id,
        senderId: e.senderId,
        recipient: e.recipient,
        subject: e.subject,
        body: e.body,
        status: e.status,
        scheduledAt: e.scheduledAt.toISOString(),
        sentAt: e.sentAt?.toISOString() ?? null,
      })),
      total,
    };
  }
};
