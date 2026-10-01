import { NextResponse } from 'next/server';
import { syncDrafts } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Generate missing / stale interview briefs and email drafts, a few at a time. Call until remaining = 0. */
export async function POST() {
  try {
    return NextResponse.json(await syncDrafts(4));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
