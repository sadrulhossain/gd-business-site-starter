import { mailProvider, type Env } from '../../env.ts';
import type { ContactMessageDoc } from '../../models.ts';

/** One interface, three adapters chosen by MAIL_PROVIDER (ADR 018). */
export interface Notifier {
  send(to: string | null, message: ContactMessageDoc): Promise<void>;
}

export const subjectFor = (m: Pick<ContactMessageDoc, 'subject'>): string => `New contact message${m.subject ? `: ${m.subject}` : ''}`;
export const bodyFor = (m: ContactMessageDoc): string =>
  `From: ${m.name} <${m.email}>${m.phone ? ` (${m.phone})` : ''}\n\n${m.message}`;

const fail = (what: string, status: number): never => {
  // Never include URLs, keys or response bodies: they can hold secrets.
  throw new Error(`${what} failed (${status})`);
};

/** none: the message is only stored and shown in the admin inbox. */
const none: Notifier = { async send() {} };

/** webhook: a POST to NOTIFY_WEBHOOK_URL (a secret), e.g. a chat service incoming webhook. */
const webhook = (env: Env): Notifier => ({
  async send(to, m) {
    const url = env.NOTIFY_WEBHOOK_URL;
    if (!url) return;
    const text = `${subjectFor(m)}\n${bodyFor(m)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // "text" and "content" cover the common chat webhooks; the rest is for custom receivers.
      body: JSON.stringify({ text, content: text, subject: subjectFor(m), name: m.name, email: m.email, phone: m.phone, message: m.message, to }),
    });
    if (!r.ok) fail('Notification webhook', r.status);
  },
});

/** http: an email provider's HTTP API (Resend-style JSON). MAIL_FROM_ADDRESS must be one the provider accepts. */
const http = (env: Env): Notifier => ({
  async send(to, m) {
    if (!to || !env.MAIL_API_KEY || !env.MAIL_FROM_ADDRESS) return;
    const r = await fetch(env.MAIL_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.MAIL_API_KEY}` },
      body: JSON.stringify({ from: env.MAIL_FROM_ADDRESS, to: [to], subject: subjectFor(m), text: bodyFor(m), reply_to: m.email }),
    });
    if (!r.ok) fail('Mail provider', r.status);
  },
});

export const notifierFor = (env: Env): Notifier => {
  const provider = mailProvider(env);
  return provider === 'webhook' ? webhook(env) : provider === 'http' ? http(env) : none;
};
