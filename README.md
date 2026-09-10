# ReachInbox Scheduler

A production-shaped full-stack email scheduler for the Outbox Labs assignment. Schedule outbound email, persist it in PostgreSQL, deliver it through BullMQ and Redis, inspect it with Ethereal, search it with Elasticsearch, and monitor the queue from a focused React dashboard.

![ReachInbox scheduler dashboard](https://placehold.co/1200x630/f7f8f5/202624?text=ReachInbox+Scheduler)

## What is included

- Real Google OAuth login with Redis-backed HttpOnly sessions
- Scheduled and sent email views
- Search, email detail, compose, and delivery status flows
- BullMQ delayed jobs with persistent Redis storage
- PostgreSQL persistence through Prisma
- Ethereal fake SMTP delivery with preview URLs
- Configurable worker concurrency and send throttling
- Redis-backed per-sender hourly rate limiting
- Slack OAuth connection and rate-limit notifications
- Elasticsearch indexing with PostgreSQL fallback search
- Bull Board queue monitoring
- Docker Compose for PostgreSQL, Redis, and optional Elasticsearch

## Run locally on Windows

### Prerequisites

Install and start:

- Docker Desktop with the `desktop-linux` engine
- Node.js 20 or newer
- npm

Verify Docker before starting:

```powershell
docker version
```

You should see both `Client` and `Server` sections. If the server section is missing, start or restart Docker Desktop.

### 1. Configure environment

```powershell
cd C:\Users\hp\Desktop\OutBox_Labs_Assignment
Copy-Item .env.example .env
notepad .env
```

The Docker PostgreSQL container uses host port `5433` because many Windows installations already have PostgreSQL on `5432`:

```dotenv
DATABASE_URL=postgresql://reachinbox:reachinbox@localhost:5433/reachinbox
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200
```

Add Ethereal and Slack values to `.env` only. Do not commit `.env` or put secrets in `.env.example`.

### 2. Start infrastructure

```powershell
docker compose up -d
docker compose ps
```

Required services:

- PostgreSQL: `localhost:5433`
- Redis: `localhost:6379`

Elasticsearch is optional because Docker Desktop may not be able to resolve `docker.elastic.co` on restricted or proxy networks. PostgreSQL search remains available when it is offline.

When registry access is available:

```powershell
docker compose --profile search up -d
```

### 3. Install, generate, and seed

```powershell
npm install
npx prisma generate --schema server/prisma/schema.prisma
npm run db:push
npm run db:seed
```

The seed creates the initial demo sender `oliver.brown@domain.io`. Authentication is handled by Google OAuth; there is no mock password login.

### 4. Start the application

```powershell
npm run dev
```

Open the dashboard at http://localhost:5173.

Other useful URLs:

- API health: http://localhost:4000/api/health
- Bull Board: http://localhost:4000/admin/queues
- Elasticsearch, when enabled: http://localhost:9200

## Google OAuth setup

Google login requires a Google OAuth 2.0 Web application client:

1. Open https://console.cloud.google.com/.
2. Create or select a project.
3. Configure the OAuth consent screen. For local testing, add your Google account as a test user if the app is in testing mode.
4. Create an OAuth client under **APIs & Services > Credentials > Create credentials > OAuth client ID**.
5. Select **Web application**.
6. Add this exact authorized redirect URI:

      `http://localhost:4000/api/auth/google/callback`

7. Add the client values to `.env`:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
SESSION_SECRET=use-a-long-random-secret-at-least-16-characters
```

8. Restart `npm run dev` and open http://localhost:5173.

Click **Continue with Google**. Google redirects back to the API callback, the server verifies the profile, upserts the user and sender, creates a seven-day Redis-backed HttpOnly session, and redirects to the dashboard. The dashboard displays the Google name, email, and avatar. The logout icon revokes the Redis session and clears the cookie.

## Email delivery

Open **Compose**, enter a recipient, subject, body, and scheduled time, then choose **Schedule**. The email is written to PostgreSQL and added to BullMQ with a durable delayed job ID.

The worker sends through Ethereal SMTP. After delivery, it prints a preview URL in the worker terminal. Ethereal is a fake provider; it does not deliver mail to real recipients.

If `ETHEREAL_USER` and `ETHEREAL_PASS` are empty, Nodemailer creates a disposable Ethereal account automatically.

## Slack integration

Slack is optional. To enable it:

1. Create an app at https://api.slack.com/apps.
2. Add the OAuth redirect URL `http://localhost:4000/api/slack/callback`.
3. Add the `chat:write` bot scope.
4. Install the app into your development workspace.
5. Add the credentials to `.env`:

```dotenv
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
SLACK_REDIRECT_URI=http://localhost:4000/api/slack/callback
```

6. Restart the app and click **Connect Slack** in the dashboard.

The token is stored for the seeded user. Disconnect from the sidebar at any time. If Slack is not connected, rate-limit events do not crash or stop delivery.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | Express API port |
| `CLIENT_URL` | `http://localhost:5173` | Frontend origin |
| `WORKER_CONCURRENCY` | `5` | Parallel BullMQ jobs |
| `MIN_SEND_DELAY_MS` | `2000` | Minimum delay before an SMTP send |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | Redis-backed hourly sender limit |
| `DATABASE_URL` | Postgres on `5433` | Prisma connection |
| `REDIS_URL` | Redis on `6379` | BullMQ and rate-limit connection |
| `ELASTICSEARCH_URL` | Elasticsearch on `9200` | Search connection |

## Architecture and reliability

```text
React dashboard
      |
      v
Express API ---> PostgreSQL (source of truth)
      |
      +-------> BullMQ delayed jobs ---> Redis
                                      |
                                      v
                                  SMTP worker ---> Ethereal
                                      |
                                      +-------> Elasticsearch index
                                      +-------> Slack notification on rate limit
```

- Scheduling uses BullMQ delayed jobs only. There are no cron jobs.
- PostgreSQL stores every email and its delivery state.
- Each email has a unique `messageKey`, also used as the BullMQ `jobId`.
- Workers claim scheduled rows before sending and skip rows already marked `SENT`.
- Worker concurrency, minimum send delay, retry count, and backoff are configurable.
- Redis atomic counters enforce hourly limits safely across workers.
- Rate-limited jobs are delayed into the next available hour instead of being dropped.
- Elasticsearch is used for indexing and search when available; PostgreSQL remains the fallback.
- Slack failures do not fail email delivery.

For 1,000 emails scheduled at the same time, Redis and BullMQ persist the workload, workers process jobs concurrently, and the rate limiter moves excess messages to later hourly windows.

## API reference

- `GET /api/health` - API and queue counts
- `GET /api/auth/google` - start Google OAuth
- `GET /api/auth/google/callback` - complete Google OAuth
- `POST /api/auth/logout` - revoke the current session
- `GET /api/me` - current authenticated Google user
- `GET /api/me` - seeded user
- `GET /api/senders` - available sender accounts
- `GET /api/emails?status=SCHEDULED&search=keyword` - searchable messages
- `POST /api/emails` - schedule an email
- `GET /api/slack/connect` - start Slack OAuth
- `GET /api/slack/callback` - OAuth callback
- `POST /api/slack/disconnect` - disconnect Slack

Example scheduling request:

```json
{
  "recipient": "person@example.com",
  "subject": "A scheduled message",
  "body": "Hello from ReachInbox",
  "scheduledAt": "2026-09-10T15:00:00.000Z",
  "senderId": "sender-id-from-api"
}
```

## Development commands

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

`docker compose down` keeps named volumes. Use `docker compose down -v` only when you intentionally want to delete local database and search data.

## Troubleshooting

### Docker cannot resolve `docker.elastic.co`

Start only the required services:

```powershell
docker compose up -d
```

Elasticsearch is in the `search` profile and is not required for the dashboard or PostgreSQL fallback search. Fix Docker Desktop DNS or proxy settings before running the optional profile.

### Prisma reports `P1000` authentication failure

Check that the Docker database is on port `5433` and `.env` contains:

```dotenv
DATABASE_URL=postgresql://reachinbox:reachinbox@localhost:5433/reachinbox
```

If this is a disposable local database, recreate it:

```powershell
docker compose down -v
docker compose up -d
npm run db:push
npm run db:seed
```

### The dashboard says to initialize the demo

Run `npm run db:push` followed by `npm run db:seed`, then restart `npm run dev`.

## Security notes

- Keep credentials in `.env`; it is ignored by Git.
- Rotate any credentials that were ever committed or shared publicly.
- Google OAuth uses a short-lived Redis state value to prevent callback replay and a seven-day HttpOnly session cookie.
- Use HTTPS and set secure cookies before deploying outside localhost.
- Store OAuth and integration secrets in a managed secret store in production.
