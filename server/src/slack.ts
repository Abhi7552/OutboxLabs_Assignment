import crypto from 'node:crypto';
import { WebClient } from '@slack/web-api';
import { prisma } from './db.js';
import { config } from './config.js';
import { redis } from './queue.js';

export async function slackConnectUrl(userId: string) {
  if (!config.SLACK_CLIENT_ID) return null;
  const state = crypto.randomBytes(32).toString('hex');
  await redis.set(`oauth:slack:state:${state}`, userId, 'EX', 600);
  const params = new URLSearchParams({ client_id: config.SLACK_CLIENT_ID, scope: 'chat:write', redirect_uri: config.SLACK_REDIRECT_URI, state });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export async function exchangeSlackCode(code: string, state: string) {
  if (!config.SLACK_CLIENT_ID || !config.SLACK_CLIENT_SECRET) throw new Error('Slack OAuth is not configured');
  const stateKey = `oauth:slack:state:${state}`;
  const userId = await redis.get(stateKey);
  if (!userId) throw new Error('Slack authorization expired. Please try again.');
  await redis.del(stateKey);
  const response = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: config.SLACK_CLIENT_ID, client_secret: config.SLACK_CLIENT_SECRET, redirect_uri: config.SLACK_REDIRECT_URI }) });
  const data = await response.json() as { ok: boolean; access_token?: string; team?: { id?: string } };
  if (!data.ok || !data.access_token) throw new Error('Slack authorization was not approved');
  return { userId, token: data.access_token, teamId: data.team?.id };
}

export async function notifyRateLimit(userId: string, senderEmail: string, window: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { slackToken: true } });
  if (!user?.slackToken) return;
  const client = new WebClient(user.slackToken);
  await client.chat.postMessage({ channel: 'slackbot', text: `ReachInbox paused ${senderEmail}: hourly send limit reached for ${window}. Messages will resume in the next available window.` });
}
