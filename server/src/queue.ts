import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

export type EmailJob = { emailId: string; senderId: string };

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  connectTimeout: 5000,
  retryStrategy: (attempt) => attempt >= 3 ? null : Math.min(attempt * 500, 2000)
});
export const emailQueue = new Queue<EmailJob>('email-delivery', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 604800, count: 5000 }
  }
});
