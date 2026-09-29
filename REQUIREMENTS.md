# ReachInbox Email Scheduler

## Objective

Build a production-style email scheduling system using:

- TypeScript
- Express.js
- PostgreSQL
- Redis
- BullMQ
- Ethereal SMTP
- Elasticsearch
- Next.js
- Tailwind CSS

## Backend Requirements

### Scheduling
- Accept email scheduling requests
- Store emails in PostgreSQL
- Schedule emails using BullMQ delayed jobs
- No cron
- Jobs survive server restarts

### Sending
- Use Ethereal SMTP
- Support multiple senders
- Track email status

### Concurrency
- Configurable worker concurrency

### Delay
- Configurable minimum delay between emails

### Rate Limiting
- Configurable hourly limit
- Redis-backed
- Safe across multiple workers
- Jobs must be rescheduled rather than dropped

### Slack
- Real Slack OAuth
- Store connection
- Send notification when rate limit is reached

### Search
- Elasticsearch indexing
- Search scheduled/sent emails

### Dashboard
- Google OAuth
- Scheduled emails
- Sent emails
- Compose email
- CSV upload
- User information
- Logout

## Non-Requirements

- No cron
- No fake OAuth
- No in-memory rate limiter
- No mock email sending