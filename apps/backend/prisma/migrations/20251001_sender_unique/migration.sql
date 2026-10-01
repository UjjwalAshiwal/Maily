-- Add per-user unique constraint on Sender.email
ALTER TABLE "Sender" ADD CONSTRAINT "Sender_userId_email_key" UNIQUE ("userId", "email");
