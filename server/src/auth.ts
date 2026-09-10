import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from './db.js';
import { redis } from './queue.js';
import { config } from './config.js';

const sessionCookie = 'reachinbox_session';
const sessionTtl = 60 * 60 * 24 * 7;

function cookieValue(request: Request, name: string) {
  const header = request.headers.cookie ?? '';
  return header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function googleLoginUrl() {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) throw new Error('Google OAuth is not configured');
  const state = crypto.randomBytes(32).toString('hex');
  await redis.set(`oauth:google:state:${state}`, 'valid', 'EX', 600);
  const params = new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, redirect_uri: config.GOOGLE_REDIRECT_URI, response_type: 'code', scope: 'openid email profile', access_type: 'offline', state, prompt: 'select_account' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function completeGoogleLogin(code: string, state: string, response: Response) {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) throw new Error('Google OAuth is not configured');
  const stateKey = `oauth:google:state:${state}`;
  if (!(await redis.get(stateKey))) throw new Error('Google login expired. Please try again.');
  await redis.del(stateKey);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, redirect_uri: config.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code' }) });
  const token = await tokenResponse.json() as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token) throw new Error('Google did not return an access token');

  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } });
  const profile = await profileResponse.json() as { email?: string; name?: string; picture?: string; email_verified?: boolean };
  if (!profileResponse.ok || !profile.email || profile.email_verified === false) throw new Error('Google account email could not be verified');

  const user = await prisma.user.upsert({ where: { email: profile.email }, update: { name: profile.name ?? profile.email, avatarUrl: profile.picture }, create: { email: profile.email, name: profile.name ?? profile.email, avatarUrl: profile.picture } });
  await prisma.sender.upsert({ where: { email: user.email }, update: { name: user.name }, create: { email: user.email, name: user.name, userId: user.id } });

  const session = crypto.randomBytes(32).toString('hex');
  await redis.set(`auth:session:${session}`, user.id, 'EX', sessionTtl);
  response.setHeader('Set-Cookie', `${sessionCookie}=${session}; HttpOnly; SameSite=Lax; Max-Age=${sessionTtl}; Path=/`);
  return user;
}

export async function currentUser(request: Request) {
  const token = cookieValue(request, sessionCookie);
  if (!token) return null;
  const userId = await redis.get(`auth:session:${token}`);
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId }, include: { senders: true } });
}

export async function logout(request: Request, response: Response) {
  const token = cookieValue(request, sessionCookie);
  if (token) await redis.del(`auth:session:${token}`);
  response.setHeader('Set-Cookie', `${sessionCookie}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);
}