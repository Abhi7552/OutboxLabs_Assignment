# ReachInbox Scheduler

ReachInbox is a full-stack email scheduling application. Users authenticate with Google, compose and schedule messages, and track delivery status from a React dashboard.

## Features

- Google OAuth with Redis-backed HttpOnly sessions
- Scheduled and sent email views with search
- PostgreSQL persistence through Prisma
- Durable delayed delivery with BullMQ and Redis
- Background delivery worker with retry and rate limiting
- SMTP delivery through Nodemailer
- Optional Elasticsearch search with PostgreSQL fallback
- Optional Slack notifications when sender limits are reached
- Bull Board queue monitoring

## Architecture

```text
React/Vite client
        |
        v
Express API ----> PostgreSQL
        |
        +--------> BullMQ ----> Redis ----> delivery worker ----> SMTP
        |
        +--------> Elasticsearch (optional)
        +--------> Slack notifications (optional)
```

PostgreSQL is the source of truth for users, senders, emails, and delivery state. Redis stores sessions, delayed jobs, and rate-limit counters. The worker processes delivery outside the request cycle so scheduling remains responsive.

## Requirements

- Node.js 20 or newer
- PostgreSQL
- Redis
- An SMTP provider
- Google OAuth credentials

Elasticsearch and Slack are optional.

## Configuration

Copy `.env.example` to `.env` for local development. In production, inject these values through the deployment platform or a managed secret store. Never commit credentials.

| Variable | Purpose |
| --- | --- |
| `PORT` | API listening port; defaults to `4000` |
| `CLIENT_URL` | Public frontend URL |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `WORKER_CONCURRENCY` | Number of concurrent delivery jobs |
| `MIN_SEND_DELAY_MS` | Delay before each SMTP send |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Per-sender hourly limit |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | Production SMTP connection |
| `SMTP_USER` / `SMTP_PASS` | Production SMTP credentials |
| `ETHEREAL_USER` / `ETHEREAL_PASS` | Test SMTP credentials; replace with production SMTP settings in a real deployment |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `GOOGLE_REDIRECT_URI` | Google callback URL |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Optional Slack OAuth credentials |
| `SLACK_REDIRECT_URI` | Optional Slack callback URL |
| `ELASTICSEARCH_URL` | Optional Elasticsearch URL |
| `SESSION_SECRET` | Session configuration secret; use a long random value |

## OAuth Callback URLs

Register the exact public URLs with each provider. For local development, the defaults are:

```text
Google: http://localhost:4000/api/auth/google/callback
Slack:  http://localhost:4000/api/slack/callback
```

For production, replace `localhost` with the public API hostname and update the corresponding environment variables.

## Run Locally

Start PostgreSQL and Redis, then install dependencies and initialize Prisma:

```powershell
npm install
npx prisma generate --schema server/prisma/schema.prisma
npm run db:push
npm run db:seed
npm run dev
```

The development server starts the API, delivery worker, and Vite client. The dashboard is available at `http://localhost:5173` and the API at `http://localhost:4000`.

Docker Compose can start the local infrastructure:

```powershell
docker compose up -d
```

Elasticsearch is available only when started with the `search` profile:

```powershell
docker compose --profile search up -d
```

## Production Build

Build both applications and run the compiled API:

```powershell
npm ci
npx prisma generate --schema server/prisma/schema.prisma
npm run build
npm run start
```

Run the compiled worker as a separate process:

```powershell
node dist/server/src/worker.js
```

The API and worker must share the same PostgreSQL and Redis instances. Apply database schema changes through the deployment migration process before starting new application versions.

Use a process manager or container orchestrator to restart failed API and worker processes. Terminate TLS at the reverse proxy or load balancer, and expose only the public client and API endpoints.

## Email Delivery Flow

1. The API validates the compose request with Zod.
2. Prisma stores the email in PostgreSQL.
3. BullMQ adds a durable delayed job in Redis.
4. The worker claims the email and changes it to `PROCESSING`.
5. Nodemailer sends the message through SMTP.
6. The worker updates the record to `SENT` or `FAILED`.

BullMQ retries temporary failures with exponential backoff. Redis counters enforce the per-sender hourly limit; limited jobs are delayed until the next available hour.

Ethereal is suitable for demonstrations because it provides preview URLs instead of sending real email. Use a production SMTP provider and configure its credentials before sending real messages.

## API Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | API and queue health |
| `GET` | `/api/auth/google` | Start Google login |
| `GET` | `/api/auth/google/callback` | Complete Google login |
| `POST` | `/api/auth/logout` | End the current session |
| `GET` | `/api/me` | Return the authenticated user |
| `GET` | `/api/senders` | List the user's senders |
| `GET` | `/api/emails` | List and search emails |
| `POST` | `/api/emails` | Schedule an email |
| `GET` | `/api/slack/connect` | Start optional Slack OAuth |
| `GET` | `/api/slack/callback` | Complete Slack OAuth |
| `POST` | `/api/slack/disconnect` | Disconnect Slack |

The queue monitor is available at `/admin/queues` when enabled.

## Security Checklist

- Store all secrets outside source control.
- Rotate credentials that were exposed or shared.
- Use HTTPS in production.
- Use secure, HttpOnly cookies in the production environment.
- Restrict CORS to the production frontend origin.
- Protect the Bull Board route with authentication before exposing it publicly.
- Use a managed PostgreSQL and Redis deployment with backups and monitoring.
- Replace `prisma db push` with reviewed migrations for production schema changes.

## Useful Commands

```powershell
npm run typecheck
npm run build
npm run db:push
npm run db:seed
```

