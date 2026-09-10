# Outbox Labs Assignment - Video Script

## 1. Introduction

"Hi, this is my Outbox Labs email scheduling project. It is a full-stack application that allows users to authenticate, compose emails, schedule them for delivery, and monitor their delivery status from a dashboard."

"The main goal is to make email delivery reliable by separating the user interface, API, database, and background worker."

## 2. Project Structure

[Show the project folder]

"The project has two main parts. The `client` folder contains the React and Vite frontend. The `server` folder contains the Express API, background worker, Prisma schema, and integrations."

"Docker Compose provides PostgreSQL, Redis, and optional Elasticsearch for local development."

## 3. Frontend Dashboard

[Open the application in the browser]

"The frontend is built with React. The dashboard has separate Scheduled and Sent views, email search, refresh support, sender information, and a compose flow."

"The interface periodically refreshes the current email list, while search requests are debounced to avoid sending a request for every keystroke."

## 4. Authentication

[Show the login screen, or explain while logged in]

"Authentication uses Google OAuth. After Google verifies the user, the server stores a session in Redis and sends an HttpOnly session cookie to the browser."

"The server uses that session to identify the current user and only return that user's senders and emails. Logging out removes the Redis session and clears the cookie."

## 5. Scheduling an Email

[Open Compose and fill in the form]

"When I compose an email, the frontend sends the recipient, subject, message body, scheduled time, and sender ID to the API."

"The API validates the request with Zod, verifies that the sender belongs to the signed-in user, saves the email in PostgreSQL through Prisma, and creates a delayed BullMQ job."

[Click Schedule]

"This means the API does not need to remain active in the browser to wait for the scheduled time. Redis and BullMQ persist the job until the worker is ready to process it."

## 6. Background Worker and Delivery

[Show the worker terminal or explain the flow]

"The worker listens to the email-delivery queue. When a job becomes due, it loads the email, claims it by changing the status from Scheduled to Processing, and sends it through Ethereal SMTP."

"After delivery, the worker updates the record to Sent and stores the delivery time. If delivery fails, the email is marked Failed and BullMQ can retry the job using its configured retry and backoff settings."

"Ethereal is used here as a safe test email provider. It creates a preview URL instead of sending real email to a recipient."

## 7. Rate Limiting

"Before sending, the worker uses Redis atomic counters to track how many emails each sender has sent during the current hour."

"If the hourly limit is reached, the email is returned to the Scheduled state and moved to the next available hour. If Slack is connected, the application also sends a rate-limit notification."

## 8. Search and Queue Monitoring

[Use the search box and optionally open the queue monitor]

"Email search uses Elasticsearch when it is available. PostgreSQL remains the fallback, so the application can continue working when the optional Elasticsearch container is offline."

"Bull Board provides a queue monitoring page where I can inspect waiting, delayed, completed, and failed jobs."

## 9. Data Model

[Show `server/prisma/schema.prisma` briefly]

"The main database models are User, Sender, and Email. A user can have multiple senders and emails. Each email stores its status, scheduled time, sent time, sender, recipient, and failure reason. Database indexes support filtering by user, status, and scheduled time."

## 10. Reliability and Performance

"The application separates immediate API work from background delivery. This keeps the dashboard responsive while scheduled jobs are processed independently."

"It also uses Redis for sessions, queues, and rate limiting; PostgreSQL as the source of truth; retries for temporary delivery failures; and a fast fallback when Elasticsearch is unavailable."

## 11. Closing

"To summarize, this project demonstrates a complete email scheduling workflow: secure authentication, validated API requests, durable database storage, delayed background jobs, test email delivery, rate limiting, search, and queue monitoring."

"The project can be started locally with Docker Compose for the infrastructure and `npm run dev` for the API, worker, and frontend. Thank you."

## Quick Demo Order

1. Start Docker services and the application.
2. Open the React dashboard.
3. Sign in with Google.
4. Show the Scheduled and Sent views.
5. Compose and schedule an email one or two minutes in the future.
6. Show the new Scheduled email.
7. Show the worker processing the job.
8. Show the Ethereal preview URL in the worker terminal.
9. Refresh the dashboard and show the Sent status.
10. Demonstrate search and briefly open Bull Board.
