# ReachInbox Email Scheduler

A full-stack email scheduling service for the Outbox Labs assignment. It persists email requests in PostgreSQL, schedules delivery through BullMQ and Redis, sends through Ethereal SMTP, indexes messages in Elasticsearch, and exposes a React dashboard.

## Stack

- Frontend: React, TypeScript, Vite, responsive CSS
- API: Express, TypeScript, Zod validation
- Persistence: PostgreSQL with Prisma
- Scheduler: BullMQ delayed jobs backed by Redis
- SMTP: Ethereal Email via Nodemailer
- Search: Elasticsearch with PostgreSQL fallback search
- Notifications: Slack OAuth and Slack Web API
- Queue visibility: Bull Board at `/admin/queues`

## Windows Quick Start

Open PowerShell in the project directory:

```powershell
cd C:\Users\hp\Desktop\OutBox_Labs_Assignment
```

### 1. Start Docker Desktop

The error in the screenshot means the Docker CLI could not reach the Docker Desktop Linux engine. It is not a Prisma error or an application error.

Start Docker Desktop and wait until it says **Docker Desktop is running**, then run:

```powershell
docker version
```

You should see both `Client` and `Server` sections. If the server section is missing, restart Docker Desktop and retry. You can also check the selected context:

```powershell
docker context ls
docker context use desktop-linux
```

### 2. Configure environment variables

Create a private `.env` file. Never put real credentials in `.env.example` or commit `.env`:

```powershell
Copy-Item .env.example .env
notepad .env
```

The local Docker values are:

```dotenv
DATABASE_URL=postgresql://reachinbox:reachinbox@localhost:5433/reachinbox
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200
```

Add Ethereal credentials to `.env`:

```dotenv
ETHEREAL_USER=your-ethereal-user
ETHEREAL_PASS=your-ethereal-password
```

If these are empty, the worker creates a disposable Ethereal account automatically and prints a preview URL when it sends a message.

### 3. Start infrastructure

```powershell
docker compose up -d
docker compose ps
```

PostgreSQL and Redis should be running. Elasticsearch is intentionally in the optional `search` profile because Docker Desktop may be unable to resolve or reach `docker.elastic.co` on a corporate, VPN, proxy, or restricted network. The application continues to provide PostgreSQL-backed search when Elasticsearch is unavailable.

To start Elasticsearch as well, after fixing Docker Desktop DNS/proxy access, run:

```powershell
docker compose --profile search up -d
```

Useful checks:

```powershell
docker compose logs postgres
docker compose logs redis
docker compose logs elasticsearch
Invoke-WebRequest http://localhost:9200
```

The Elasticsearch check is expected to fail when the `search` profile is not enabled.

If a port is occupied, stop the conflicting service or change the host-side port in `docker-compose.yml` and update `.env`.

### 4. Install and initialize

```powershell
npm install
npx prisma generate --schema server/prisma/schema.prisma
npm run db:push
npm run db:seed
```

The seed creates the demo account `Oliver Brown` with sender `oliver.brown@domain.io`.

### 5. Start the application

```powershell
npm run dev
```

This starts:

- Dashboard: http://localhost:5173
- API: http://localhost:4000
- BullMQ worker: a separate process in the same command

Open http://localhost:5173.

## Verify the installation

Use a second PowerShell window while the app is running:

```powershell
Invoke-WebRequest http://localhost:4000/api/health
Invoke-WebRequest http://localhost:5173
```

The queue dashboard is available at http://localhost:4000/admin/queues. Schedule an email from the dashboard. It should first appear under **Scheduled**, then move to **Sent**. Ethereal preview URLs are printed in the worker terminal.

## Slack setup

Slack is optional. Without Slack credentials, the dashboard still works and rate-limit events simply do not notify Slack.

1. Create a Slack app at https://api.slack.com/apps.
2. Add this exact OAuth redirect URL: `http://localhost:4000/api/slack/callback`.
3. Add the `chat:write` bot scope.
4. Install or reinstall the app to your development workspace.
5. Add these values to the private `.env` file:

```dotenv
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
SLACK_REDIRECT_URI=http://localhost:4000/api/slack/callback
```

6. Restart `npm run dev`.
7. Click **Connect Slack** in the dashboard and approve OAuth.

The token is stored for the seeded user in PostgreSQL. To disconnect, click the connected Slack control. If authorization fails, check that the redirect URL matches exactly and reinstall the Slack app after changing scopes.

## Ethereal setup

Ethereal is fake SMTP and does not deliver real mail. Use the preview URL printed by the worker to inspect a message. You can provide an existing account through `.env`, or leave the values empty and let Nodemailer create a disposable account.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Express API port |
| `CLIENT_URL` | `http://localhost:5173` | CORS origin |
| `WORKER_CONCURRENCY` | `5` | Parallel BullMQ jobs |
| `MIN_SEND_DELAY_MS` | `2000` | Minimum delay before each SMTP send |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | Redis-backed hourly sender limit |
| `DATABASE_URL` | local Postgres URL on port `5433` | Prisma connection |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ and rate-limit connection |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Search connection |

## API reference

- `GET /api/health` - API and queue counts
- `GET /api/me` - seeded demo user
- `GET /api/senders` - available senders
- `GET /api/emails?status=SCHEDULED&search=keyword` - searchable emails
- `POST /api/emails` - schedule an email
- `GET /api/slack/connect` - start Slack OAuth
- `GET /api/slack/callback` - OAuth callback
- `POST /api/slack/disconnect` - remove the saved Slack token

Schedule request body:

```json
{
	"recipient": "person@example.com",
	"subject": "A scheduled message",
	"body": "Hello from ReachInbox",
	"scheduledAt": "2026-09-10T15:00:00.000Z",
	"senderId": "sender-id-from-api"
}
```

## Reliability behavior

- BullMQ delayed jobs are the only scheduling mechanism; there are no cron jobs.
- PostgreSQL is the source of truth for email state.
- Every email has a unique `messageKey`, also used as the BullMQ `jobId`.
- The worker claims a scheduled row before sending. Already sent rows are skipped after restarts.
- BullMQ retries failed jobs with exponential backoff.
- Worker concurrency is configurable through `WORKER_CONCURRENCY`.
- Redis atomic counters enforce the hourly limit across workers and instances.
- When a sender reaches the hourly limit, the job returns to `SCHEDULED` and is delayed to the next hour rather than dropped.
- Elasticsearch indexes email metadata when the `search` profile is running. If it is unavailable, the API falls back to PostgreSQL search.
- Slack failures do not fail email jobs.

For 1,000 emails scheduled at the same time, BullMQ persists all delayed jobs, the worker drains them using configured concurrency and send delay, and Redis shifts excess work into later hourly windows.

## Useful commands

```powershell
npm run dev
npm run dev:api
npm run dev:worker
npm run dev:web
npm run typecheck
npm run build
npm run db:push
npm run db:seed
docker compose up -d
docker compose --profile search up -d
docker compose ps
docker compose logs -f
docker compose down
```

`docker compose down` stops containers but keeps named volumes. Use `docker compose down -v` only when you intentionally want to delete local PostgreSQL and Elasticsearch data.

## Security notes

- `.env` is ignored by Git. Keep Ethereal and Slack secrets there.
- If credentials were committed or shared publicly, rotate them before continuing.
- This assignment uses a seeded demo user rather than production authentication. Add authentication and encrypted secret storage before public deployment.
