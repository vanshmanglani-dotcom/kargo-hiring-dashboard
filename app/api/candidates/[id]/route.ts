import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { writeBrief } from '@/lib/pipeline';
import type { Candidate } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Founder actions: override decision, edit the draft, or generate a brief on demand. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const s = store();
  const c = await s.getCandidate(id);
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await req.json();
  const patch: Partial<Candidate> = {};

  if (body.decision !== undefined) {
    if (!['auto', 'invite', 'reject'].includes(body.decision)) return NextResponse.json({ error: 'Bad decision' }, { status: 400 });
    patch.decision = body.decision;
  }
  if (typeof body.email_subject === 'string' || typeof body.email_body === 'string') {
    if (c.sent_at) return NextResponse.json({ error: 'Already sent' }, { status: 400 });
    if (typeof body.email_subject === 'string') patch.email_subject = body.email_subject;
    if (typeof body.email_body === 'string') patch.email_body = body.email_body;
    patch.email_edited = true;
  }
  if (body.action === 'brief') {
    if (c.status !== 'scored') return NextResponse.json({ error: 'Not scored yet' }, { status: 400 });
    patch.brief = await writeBrief(c);
  }
  await s.updateCandidate(id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await store().deleteCandidate(id);
  return NextResponse.json({ ok: true });
}
