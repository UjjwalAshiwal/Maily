import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env.js";

export const EMAILS_INDEX = "emails";

export interface EmailDocument {
  id: string;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const es = new Client({ node: env.ELASTICSEARCH_URL });

const MAPPING = {
  properties: {
    id: { type: "keyword" },
    senderId: { type: "keyword" },
    recipient: { type: "keyword", fields: { text: { type: "text" } } },
    subject: { type: "text" },
    body: { type: "text" },
    status: { type: "keyword" },
    scheduledAt: { type: "date" },
    sentAt: { type: "date" },
    createdAt: { type: "date" },
    updatedAt: { type: "date" },
  },
} as const;

export const ensureEmailsIndex = async (): Promise<void> => {
  const exists = await es.indices.exists({ index: EMAILS_INDEX });
  if (!exists) await es.indices.create({ index: EMAILS_INDEX, mappings: MAPPING });
};

export const indexEmailDocument = async (doc: EmailDocument): Promise<void> => {
  await ensureEmailsIndex();
  await es.index({ index: EMAILS_INDEX, id: doc.id, document: doc });
};

export interface EmailSearchParams {
  q: string;
  status?: string;
  senderIds?: string[]; // ownership scope, resolved from PostgreSQL by the caller
  from: number;
  size: number;
}

export const searchEmailDocuments = async (params: EmailSearchParams) => {
  await ensureEmailsIndex();
  const filter = [];
  if (params.status) filter.push({ term: { status: params.status } });
  if (params.senderIds) filter.push({ terms: { senderId: params.senderIds } });
  return es.search<EmailDocument>({
    index: EMAILS_INDEX,
    from: params.from,
    size: params.size,
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query: params.q,
              fields: ["recipient", "recipient.text", "subject", "body"],
            },
          },
        ],
        filter,
      },
    },
  });
};
