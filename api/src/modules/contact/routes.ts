import { contactPerMinute, type Env } from '../../env.ts';
import { notFoundError } from '../../errors.ts';
import { clientIp, hit } from '../../http/rateLimit.ts';
import { idParam, iso, paginate } from '../../http/helpers.ts';
import type { Api } from '../../http/route.ts';
import { parse, validationError, z } from '../../http/validate.ts';
import { nextId, type ContactMessageDoc } from '../../models.ts';
import { defer } from '../../runtime.ts';
import { checkCaptcha, issueCaptcha } from './captcha.ts';
import { notifierFor } from './notify.ts';

const blank = (v: string | null | undefined) => (v === '' ? null : v);

export const contactSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: z.string().max(150).pipe(z.email()),
  phone: z.string().max(30).nullable().optional().transform(blank),
  subject: z.string().max(150).nullable().optional().transform(blank),
  message: z.string().trim().min(1).max(5000),
  captcha_id: z.string().min(1).max(64),
  captcha_answer: z.union([z.number().int(), z.string().regex(/^-?\d+$/, 'The captcha answer must be an integer.').transform(Number)]),
  /** Honeypot: real visitors never see this field. */
  website: z.string().optional(),
});

export const messageResource = (m: ContactMessageDoc) => ({
  id: m._id, name: m.name, email: m.email, phone: m.phone ?? null, subject: m.subject ?? null, message: m.message,
  read_at: iso(m.read_at), created_at: iso(m.created_at),
});

const inboxQuery = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), unread: z.string().optional() });

export function contactRoutes(api: Api, env: Env): void {
  api.get('/public/captcha', { public: true }, async (req, res) => {
    await hit(req, res, 'captcha', clientIp(req), 30, 60);
    res.json({ data: await issueCaptcha(env, res.locals.models()) });
  });

  api.post('/contact', { public: true }, async (req, res) => {
    const m = res.locals.models();
    await hit(req, res, 'contact', clientIp(req), contactPerMinute(env), 60); // counts invalid submissions too

    // Honeypot: look like a success, store nothing, keep the captcha untouched.
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    if (typeof rawBody.website === 'string' && rawBody.website.trim() !== '') {
      res.status(201).json({ data: { received: true } });
      return;
    }

    const parsed = contactSchema.safeParse(rawBody);
    const details: Record<string, string[]> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.code === 'unrecognized_keys') for (const k of issue.keys) (details[k] ??= []).push('This field is not allowed.');
        else (details[issue.path.join('.') || '_'] ??= []).push(issue.message);
      }
    }
    // The captcha is spent as soon as it is well formed, even when other fields are wrong (legacy behaviour).
    const id = rawBody.captcha_id;
    const answer = rawBody.captcha_answer;
    if (typeof id === 'string' && id !== '' && id.length <= 64 && ((typeof answer === 'number' && Number.isInteger(answer)) || (typeof answer === 'string' && /^-?\d+$/.test(answer)))) {
      if (!(await checkCaptcha(m, id, Number(answer)))) (details.captcha_answer ??= []).push('The captcha answer is wrong or expired.');
    }
    if (Object.keys(details).length || !parsed.success) throw validationError(details);

    const { name, email, phone, subject, message } = parsed.data;
    const row = (await m.ContactMessage.create({ _id: await nextId(m, 'contact_messages'), name, email, phone, subject, message })).toObject();

    // The notification never fails the request: errors are logged by defer().
    const setting = await m.Setting.findOne({ _id: 1 }, { email: 1 }).lean();
    const to = setting?.email || env.CONTACT_NOTIFY_TO || null;
    defer(notifierFor(env).send(to, row), 'contact notification');
    res.status(201).json({ data: { received: true } });
  });

  api.get('/contact-messages', { permission: 'contact.view' }, async (req, res) => {
    const q = parse(inboxQuery, req.query);
    const unread = q.unread === '1' || q.unread === 'true';
    const m = res.locals.models();
    res.json(await paginate(m.ContactMessage, `${req.baseUrl}${req.path}`, q.page, 20, (rows) => rows.map(messageResource), { _id: -1 }, unread ? { read_at: null } : {}));
  });

  api.get('/contact-messages/:id', { permission: 'contact.view' }, async (req, res) => {
    const row = await res.locals.models().ContactMessage.findOne({ _id: idParam(req) }).lean();
    if (!row) throw notFoundError();
    res.json({ data: messageResource(row) });
  });

  api.post('/contact-messages/:id/read', { permission: 'contact.update' }, async (req, res) => {
    const { ContactMessage } = res.locals.models();
    const id = idParam(req);
    if (!(await ContactMessage.exists({ _id: id }))) throw notFoundError();
    await ContactMessage.updateOne({ _id: id, read_at: null }, { $set: { read_at: new Date() } }); // only the first read counts
    res.json({ data: messageResource((await ContactMessage.findOne({ _id: id }).lean())!) });
  });
}

