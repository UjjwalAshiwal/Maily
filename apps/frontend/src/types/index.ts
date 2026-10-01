export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface Sender {
  id: string;
  email: string;
}

export interface EmailItem {
  id: string;
  senderId: string;
  senderEmail?: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  errorMessage?: string | null;
  failedAt?: string | null;
  attempts?: number;
}

export interface EmailListResponse {
  results: EmailItem[];
  total: number;
  page: number;
  limit: number;
}

export interface SchedulePayload {
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
}
