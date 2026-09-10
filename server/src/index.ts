import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { prisma } from './db.js';
import { config } from './config.js';
import { emailQueue } from './queue.js';
import { ensureSearchIndex, indexEmail, searchEmails } from './search.js';
import { slackConnectUrl, exchangeSlackCode } from './slack.js';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import './worker.js';

const app = express();
app.use(cors({ origin: config.CLIENT_URL }));
app.use(express.json({ limit: '2mb' }));
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
app.use('/admin/queues', serverAdapter.getRouter());

const currentUser = () => prisma.user.findFirst({ include: { senders: true } });

app.get('/api/health', async (_req, res) => res.json({ ok: true, service: 'reachinbox-api', queue: await emailQueue.getJobCounts() }));
app.get('/api/me', async (_req, res) => res.json(await currentUser()));
app.get('/api/senders', async (_req, res) => res.json((await currentUser())?.senders ?? []));
app.get('/api/emails', async (req, res) => {
  const user = await currentUser();
  if (!user) return res.status(404).json({ message: 'Seed the demo user first.' });
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const ids = search ? await searchEmails(search, status) : [];
  const emails = await prisma.email.findMany({ where: { userId: user.id, ...(status ? { status: status as 'SCHEDULED' | 'SENT' } : {}), ...(ids.length ? { id: { in: ids } } : {}), ...(search && !ids.length ? { OR: [{ recipient: { contains: search, mode: 'insensitive' } }, { subject: { contains: search, mode: 'insensitive' } }] } : {}) }, include: { sender: true }, orderBy: { scheduledAt: 'asc' }, take: 100 });
  return res.json(emails);
});

const emailInput = z.object({ recipient: z.string().email(), subject: z.string().min(1), body: z.string().min(1), scheduledAt: z.coerce.date(), senderId: z.string() });
app.post('/api/emails', async (req, res) => {
  const user = await currentUser();
  if (!user) return res.status(404).json({ message: 'Seed the demo user first.' });
  const parsed = emailInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid email request' });
  const sender = user.senders.find((item) => item.id === parsed.data.senderId);
  if (!sender) return res.status(400).json({ message: 'Sender not found' });
  const email = await prisma.email.create({ data: { ...parsed.data, messageKey: crypto.randomUUID(), userId: user.id } });
  await emailQueue.add(email.messageKey, { emailId: email.id, senderId: sender.id }, { jobId: email.messageKey, delay: Math.max(0, email.scheduledAt.getTime() - Date.now()) });
  await indexEmail(email);
  return res.status(201).json(email);
});

app.get('/api/slack/connect', async (_req, res) => {
  const user = await currentUser();
  const url = user ? slackConnectUrl(user.id) : null;
  return url ? res.redirect(url) : res.status(503).json({ message: 'Configure Slack OAuth credentials in .env first.' });
});
app.get('/api/slack/callback', async (req, res) => {
  try {
    const result = await exchangeSlackCode(String(req.query.code));
    await prisma.user.update({ where: { id: String(req.query.state) }, data: { slackToken: result.token, slackTeamId: result.teamId } });
    return res.redirect(`${config.CLIENT_URL}?slack=connected`);
  } catch (error) { return res.status(400).send(error instanceof Error ? error.message : 'Slack authorization failed'); }
});
app.post('/api/slack/disconnect', async (_req, res) => { const user = await currentUser(); if (user) await prisma.user.update({ where: { id: user.id }, data: { slackToken: null, slackTeamId: null } }); res.json({ ok: true }); });

ensureSearchIndex().catch(console.error);
app.listen(config.PORT, () => console.log(`ReachInbox API listening on http://localhost:${config.PORT}`));
