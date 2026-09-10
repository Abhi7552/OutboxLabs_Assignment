# ReachInbox Deployment Guide

This guide deploys the current project as three runtime components:

1. A static React frontend served by Nginx or a static hosting provider.
2. The Express API running from `dist/server/src/index.js`.
3. The BullMQ delivery worker running from `dist/server/src/worker.js`.

PostgreSQL and Redis must be reachable by both the API and worker. Elasticsearch and Slack are optional.

## Production Requirements

- Linux server or container platform
- Node.js 20 or newer
- PostgreSQL 16 or a compatible managed PostgreSQL service
- Redis 7 or a compatible managed Redis service
- HTTPS and a domain name
- Google OAuth credentials
- A process manager such as systemd, Docker, or Kubernetes

## Important Current Limitation

The current mailer uses Ethereal SMTP directly in `server/src/mailer.ts`. Ethereal is a testing service and should not be used for real production delivery. Before sending real email, update the mailer to read a production SMTP host, port, username, and password from environment variables, then rebuild and redeploy.

## 1. Prepare Infrastructure

Create production PostgreSQL and Redis instances. Do not expose either service publicly. Restrict access to the API and worker network, enable backups for PostgreSQL, and enable authentication and TLS where supported by the provider.

Create a production database and record its connection string. The API and worker must use the same `DATABASE_URL` and `REDIS_URL`.

## 2. Prepare OAuth Applications

Register the exact HTTPS callback URLs with the providers:

```text
https://api.example.com/api/auth/google/callback
https://api.example.com/api/slack/callback
```

Slack is optional. If it is enabled, configure a Slack bot user and the `chat:write` scope before installing the app into a workspace.

Set the Google OAuth authorized origin to the frontend URL, for example:

```text
https://app.example.com
```

## 3. Configure Environment Variables

Create the environment in the deployment secret manager or on the server. Do not commit `.env`.

```dotenv
NODE_ENV=production
PORT=4000
CLIENT_URL=https://app.example.com
DATABASE_URL=postgresql://user:password@db-host:5432/reachinbox
REDIS_URL=rediss://:password@redis-host:6379
ELASTICSEARCH_URL=https://search-host:9200
WORKER_CONCURRENCY=5
MIN_SEND_DELAY_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=200

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://api.example.com/api/auth/google/callback
SESSION_SECRET=generate-a-long-random-secret

SLACK_CLIENT_ID=optional-slack-client-id
SLACK_CLIENT_SECRET=optional-slack-client-secret
SLACK_REDIRECT_URI=https://api.example.com/api/slack/callback

ETHEREAL_USER=demo-only-user
ETHEREAL_PASS=demo-only-password
```

Remove the Slack and Elasticsearch variables when those integrations are not used. Keep `SESSION_SECRET` at least 16 characters long and use a unique random value.

## 4. Build the Application

On the deployment machine or in CI:

```bash
npm ci
npx prisma generate --schema server/prisma/schema.prisma
npm run typecheck
npm run build
```

The build produces:

```text
dist/client/                 Static frontend files
dist/server/src/index.js     Express API
dist/server/src/worker.js    BullMQ worker
```

Copy only the required build output, `package.json`, `package-lock.json`, and Prisma generated client/runtime files to the runtime image or server. Keep source maps and development files out of the public web root.

## 5. Initialize the Database

For the current repository, initialize the schema with:

```bash
npx prisma db push --schema server/prisma/schema.prisma
```

Run this only as a controlled deployment step after reviewing schema changes. The repository does not currently contain Prisma migration files, so add and review migrations before adopting an automated production migration pipeline.

The seed command creates a demo user and is not required for production:

```bash
npm run db:seed
```

## 6. Start the API and Worker

Run the API and worker as separate supervised processes:

```bash
node dist/server/src/index.js
node dist/server/src/worker.js
```

The API listens on `PORT`, which defaults to `4000`. The worker does not expose an HTTP port. Both processes require access to the same environment variables, PostgreSQL, and Redis.

Configure the process manager to:

- restart either process after failure;
- start the worker after Redis is available;
- stop both processes gracefully during deployment;
- retain API and worker logs;
- run as a non-root user.

## 7. Serve the Frontend

The Vite build creates static files in `dist/client`. Serve that directory from the frontend domain, for example `https://app.example.com`.

Configure the reverse proxy so API requests go to the API process:

```text
/app.example.com/       -> static files from dist/client
/app.example.com/api/*  -> http://127.0.0.1:4000
/app.example.com/admin/* -> http://127.0.0.1:4000
```

The application uses relative `/api` requests in the browser, so the frontend and API must be reachable through the configured `CLIENT_URL` and API proxy. Enable HTTPS and forward the original protocol and host headers.

Protect `/admin/queues` with authentication at the reverse proxy or application layer before exposing it publicly. The current Bull Board route does not implement user authentication by itself.

## 8. Health Checks

Use the API health endpoint for liveness checks:

```text
GET https://api.example.com/api/health
```

A healthy response contains `ok: true` and queue counts. Also monitor:

- API process restarts and error rate;
- worker process restarts;
- Redis connectivity and queue depth;
- PostgreSQL connections, storage, and backups;
- delayed, failed, and stuck email jobs;
- SMTP provider responses and rate limits.

## 9. Deployment Order

1. Build and test the new version in CI.
2. Confirm PostgreSQL and Redis are available.
3. Apply the reviewed database schema change.
4. Deploy the API and worker with the same version.
5. Deploy the static frontend.
6. Verify `/api/health` and Google login.
7. Schedule a test email and confirm the worker updates its status.
8. Review logs and queue counts.

Keep the previous application version available for rollback. Do not delete PostgreSQL or Redis volumes during a normal deployment.

## 10. Security Checklist

- Use HTTPS everywhere.
- Store secrets in a managed secret store.
- Rotate any credentials that were exposed or shared.
- Restrict CORS to `CLIENT_URL`.
- Keep PostgreSQL and Redis private.
- Use a secure, HttpOnly session cookie in production.
- Protect Bull Board with authentication.
- Configure database backups and restoration tests.
- Use a real SMTP provider before sending production email.
- Remove demo seed data and test credentials from production.
- Review logs to ensure tokens and passwords are never printed.
