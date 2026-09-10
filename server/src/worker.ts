import { Worker, Job } from 'bullmq';
import { prisma } from './db.js';
import { config } from './config.js';
import { redis } from './queue.js';
import { sendEmail } from './mailer.js';
import { indexEmail } from './search.js';
import { notifyRateLimit } from './slack.js';
import type { EmailJob } from './queue.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function processEmail(job: Job<EmailJob>) {
  const email = await prisma.email.findUnique({ where: { id: job.data.emailId }, include: { sender: true } });
  if (!email || email.status === 'SENT') return;
  const claimed = await prisma.email.updateMany({ where: { id: email.id, status: 'SCHEDULED' }, data: { status: 'PROCESSING' } });
  if (claimed.count === 0) return;

  const hour = new Date().toISOString().slice(0, 13);
  const key = `rate:${email.senderId}:${hour}`;
  const count = await redis.incr(key);
  await redis.expire(key, 7200);
  if (count > config.MAX_EMAILS_PER_HOUR_PER_SENDER) {
    await prisma.email.update({ where: { id: email.id }, data: { status: 'SCHEDULED' } });
    await notifyRateLimit(email.userId, email.sender.email, hour).catch((error) => console.warn('Slack notification failed:', error));
    const nextHour = new Date();
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    await job.moveToDelayed(nextHour.getTime(), job.token);
    return;
  }

  await sleep(config.MIN_SEND_DELAY_MS);
  try {
    const previewUrl = await sendEmail({ from: email.sender.email, to: email.recipient, subject: email.subject, html: email.body });
    const sent = await prisma.email.update({ where: { id: email.id }, data: { status: 'SENT', sentAt: new Date() } });
    void indexEmail(sent);
    if (previewUrl) console.log(`Sent ${email.id}; preview: ${previewUrl}`);
  } catch (error) {
    await prisma.email.update({ where: { id: email.id }, data: { status: 'FAILED', failureReason: error instanceof Error ? error.message : 'Unknown SMTP failure' } });
    throw error;
  }
}

export const worker = new Worker<EmailJob>('email-delivery', processEmail, { connection: redis, concurrency: config.WORKER_CONCURRENCY });
worker.on('failed', (job, error) => console.error(`Email job ${job?.id} failed`, error));
console.log(`Email worker online with concurrency ${config.WORKER_CONCURRENCY}`);
