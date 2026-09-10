import nodemailer, { Transporter } from 'nodemailer';
import { config } from './config.js';

let transporter: Transporter | undefined;

async function getTransporter() {
  if (transporter) return transporter;
  if (config.ETHEREAL_USER && config.ETHEREAL_PASS) {
    transporter = nodemailer.createTransport({ host: 'smtp.ethereal.email', port: 587, secure: false, auth: { user: config.ETHEREAL_USER, pass: config.ETHEREAL_PASS } });
    return transporter;
  }
  const account = await nodemailer.createTestAccount();
  console.log(`Ethereal account created for demo: ${account.user}`);
  transporter = nodemailer.createTransport({ host: 'smtp.ethereal.email', port: 587, secure: false, auth: { user: account.user, pass: account.pass } });
  return transporter;
}

export async function sendEmail(input: { from: string; to: string; subject: string; html: string }) {
  const transport = await getTransporter();
  const result = await transport.sendMail(input);
  return nodemailer.getTestMessageUrl(result) ?? null;
}
