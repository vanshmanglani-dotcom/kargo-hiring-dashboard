import { NextResponse } from 'next/server';
import { buildViews, SHORTLIST_SIZE } from '@/lib/pipeline';
import { store, storeKind } from '@/lib/store';
import { aiMode } from '@/lib/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const s = store();
    const [cands, pii, rubric] = await Promise.all([s.listCandidates(), s.listPII(), s.rubric()]);
    return NextResponse.json({
      candidates: buildViews(cands, pii),
      rubric,
      config: {
        shortlistSize: SHORTLIST_SIZE,
        ai: aiMode(),
        db: storeKind(),
        email: process.env.RESEND_API_KEY ? 'resend' : 'off',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
