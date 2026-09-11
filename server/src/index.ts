import express from 'express';
import path from 'node:path';
import cors from 'cors';
import { z } from 'zod';
import { prisma } from './db.js';
import { config } from './config.js';
import { emailQueue } from './queue.js';
import { ensureSearchIndex, indexEmail, searchEmails } from './search.js';
import { slackConnectUrl, exchangeSlackCode } from './slack.js';
import { completeGoogleLogin, currentUser, googleLoginUrl, logout } from './auth.js';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors({ origin: config.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '2mb' }));
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
app.use('/admin/queues', async (req, res, next) => {
  if (!(await currentUser(req))) return res.status(401).send('Authentication required');
  return next();
}, serverAdapter.getRouter());

app.get('/api/health', async (_req, res) => res.json({ ok: true, service: 'reachinbox-api', queue: await emailQueue.getJobCounts() }));
app.get('/api/auth/google', async (_req, res) => {
  try { return res.redirect(await googleLoginUrl()); }
  catch (error) { return res.status(503).json({ message: error instanceof Error ? error.message : 'Google OAuth is not configured' }); }
});
app.get('/api/auth/google/callback', async (req, res) => {
  try { await completeGoogleLogin(String(req.query.code), String(req.query.state), res); return res.redirect(config.CLIENT_URL); }
  catch (error) { return res.redirect(`${config.CLIENT_URL}?authError=${encodeURIComponent(error instanceof Error ? error.message : 'Google login failed')}`); }
});
app.post('/api/auth/logout', async (req, res) => { await logout(req, res); return res.json({ ok: true }); });
app.get('/api/me', async (req, res) => {
  const user = await currentUser(req);
  return user ? res.json({ id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, slackConnected: Boolean(user.slackToken) }) : res.status(401).json({ message: 'Sign in required' });
});
app.get('/api/senders', async (req, res) => { const user = await currentUser(req); return user ? res.json(user.senders) : res.status(401).json({ message: 'Sign in required' }); });
app.get('/api/emails', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ message: 'Sign in required' });
  const status = req.query.status === 'SCHEDULED' || req.query.status === 'SENT' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const ids = search ? await searchEmails(search, status) : [];
  const emails = await prisma.email.findMany({ where: { userId: user.id, ...(status ? { status } : {}), ...(ids.length ? { id: { in: ids } } : {}), ...(search && !ids.length ? { OR: [{ recipient: { contains: search, mode: 'insensitive' } }, { subject: { contains: search, mode: 'insensitive' } }] } : {}) }, include: { sender: { select: { id: true, name: true, email: true } } }, orderBy: { scheduledAt: 'asc' }, take: 100 });
  return res.json(emails);
});

const emailInput = z.object({ recipient: z.string().email().max(320), subject: z.string().trim().min(1).max(998), body: z.string().min(1).max(1_000_000), scheduledAt: z.coerce.date(), senderId: z.string().min(1) });
app.post('/api/emails', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ message: 'Sign in required' });
  const parsed = emailInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid email request' });
  const sender = user.senders.find((item) => item.id === parsed.data.senderId);
  if (!sender) return res.status(400).json({ message: 'Sender not found' });
  const email = await prisma.email.create({ data: { ...parsed.data, messageKey: crypto.randomUUID(), userId: user.id } });
  await emailQueue.add(email.messageKey, { emailId: email.id, senderId: sender.id }, { jobId: email.messageKey, delay: Math.max(0, email.scheduledAt.getTime() - Date.now()) });
  void indexEmail(email);
  return res.status(201).json(email);
});

app.get('/api/slack/connect', async (req, res) => {
  const user = await currentUser(req);
  const url = user ? await slackConnectUrl(user.id) : null;
  return url ? res.redirect(url) : res.status(503).json({ message: 'Configure Slack OAuth credentials in .env first.' });
});
app.get('/api/slack/callback', async (req, res) => {
  try {
    const result = await exchangeSlackCode(String(req.query.code), String(req.query.state));
    await prisma.user.update({ where: { id: result.userId }, data: { slackToken: result.token, slackTeamId: result.teamId } });
    return res.redirect(`${config.CLIENT_URL}?slack=connected`);
  } catch (error) { return res.status(400).send(error instanceof Error ? error.message : 'Slack authorization failed'); }
});
app.post('/api/slack/disconnect', async (req, res) => { const user = await currentUser(req); if (user) await prisma.user.update({ where: { id: user.id }, data: { slackToken: null, slackTeamId: null } }); res.json({ ok: true }); });

const clientDirectory = path.resolve(process.cwd(), 'dist/client');
app.use(express.static(clientDirectory));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/')) return next();
  return res.sendFile(path.join(clientDirectory, 'index.html'));
});

ensureSearchIndex().catch(console.error);
app.listen(config.PORT, () => console.log(`ReachInbox API listening on http://localhost:${config.PORT}`));
