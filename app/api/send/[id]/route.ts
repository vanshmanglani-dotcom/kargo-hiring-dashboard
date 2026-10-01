import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { store } from '@/lib/store';
import { personalise } from '@/lib/pii';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** The one button: founder confirms → email goes out via Resend → record marked sent. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const s = store();
  const [c, pii] = await Promise.all([s.getCandidate(id), s.getPII(id)]);
  if (!c) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  if (c.sent_at) return NextResponse.json({ error: `Already sent on ${new Date(c.sent_at).toLocaleString()}` }, { status: 400 });
  if (!c.email_body || !c.email_subject) return NextResponse.json({ error: 'No draft yet' }, { status: 400 });

  const to = (process.env.TEST_RECIPIENT_OVERRIDE || pii?.email || '').trim();
  if (!to) return NextResponse.json({ error: 'No email address was found on this CV' }, { status: 400 });

  // Safety rail: only send to allowed domains (default: the MESA test domain). Set to * to allow any.
  const allowed = (process.env.ALLOWED_RECIPIENT_DOMAINS || 'pg27.mesaschool.co').split(',').map((d) => d.trim().toLowerCase());
  const domain = to.split('@')[1]?.toLowerCase() || '';
  if (!allowed.includes('*') && !allowed.includes(domain)) {
    return NextResponse.json({ error: `Blocked: ${to} is not in ALLOWED_RECIPIENT_DOMAINS (${allowed.join(', ')})` }, { status: 400 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ error: 'RESEND_API_KEY is not set — add it in Vercel and redeploy' }, { status: 400 });

  const subject = personalise(c.email_subject, pii?.name);
  const text = personalise(c.email_body, pii?.name);
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM || 'Kargo Hiring <onboarding@resend.dev>',
    to: [to],
    subject,
    text,
    ...(process.env.REPLY_TO ? { replyTo: process.env.REPLY_TO } : {}),
  });
  if (error) return NextResponse.json({ error: `Resend: ${error.message}` }, { status: 502 });

  await s.updateCandidate(id, { sent_at: new Date().toISOString(), sent_to: to, sent_message_id: data?.id ?? null });
  return NextResponse.json({ ok: true, to, id: data?.id });
}
