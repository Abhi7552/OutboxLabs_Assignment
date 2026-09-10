import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

export type EmailJob = { emailId: string; senderId: string };

export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
export const emailQueue = new Queue<EmailJob>('email-delivery', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 604800, count: 5000 }
  }
});
