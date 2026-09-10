import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgresql://reachinbox:reachinbox@localhost:5433/reachinbox'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  MIN_SEND_DELAY_MS: z.coerce.number().int().nonnegative().default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().positive().default(200),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  ETHEREAL_USER: z.string().optional(),
  ETHEREAL_PASS: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().default('http://localhost:4000/api/slack/callback'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:4000/api/auth/google/callback'),
  SESSION_SECRET: z.string().min(16).default('local-reachinbox-session-secret')
});

export const config = schema.parse(process.env);

if (config.NODE_ENV === 'production') {
  const required = ['DATABASE_URL', 'REDIS_URL', 'CLIENT_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'SESSION_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing production environment variables: ${missing.join(', ')}`);
  if (!config.CLIENT_URL.startsWith('https://')) throw new Error('CLIENT_URL must use HTTPS in production');
  if (config.SESSION_SECRET === 'local-reachinbox-session-secret') throw new Error('SESSION_SECRET must be changed in production');
}
