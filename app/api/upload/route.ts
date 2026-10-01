import { NextResponse } from 'next/server';
import { parseFile } from '@/lib/parse';
import { extract, score } from '@/lib/pipeline';
import { store } from '@/lib/store';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Upload one CV + the role it was applied for. Runs extraction + scoring; drafts are made by /api/sync. */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  const role = String(form.get('role') || '').toUpperCase() as Role;
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  if (role !== 'PM' && role !== 'SPM') return NextResponse.json({ error: 'Role must be PM or SPM' }, { status: 400 });

  const s = store();
  const cand = await s.insertCandidate({ file_name: file.name, applied_role: role, status: 'processing' });
  try {
    const parsed = await parseFile(file);
    const { pii, content } = await extract(parsed);
    await s.upsertPII({ candidate_id: cand.id, ...pii });
    if (content.length < 100) throw new Error('Could not read enough text from this CV');
    await s.updateCandidate(cand.id, { cv_content: content });

    const scores = await score(content, await s.rubric());
    await s.updateCandidate(cand.id, {
      scores,
      pm_score: scores.PM.total,
      spm_score: scores.SPM.total,
      status: 'scored',
      error: null,
    });
    return NextResponse.json({ id: cand.id, name: pii.name, pm: scores.PM.total, spm: scores.SPM.total });
  } catch (e) {
    const msg = (e as Error).message || 'Processing failed';
    await s.updateCandidate(cand.id, { status: 'error', error: msg });
    return NextResponse.json({ id: cand.id, error: msg }, { status: 500 });
  }
}
