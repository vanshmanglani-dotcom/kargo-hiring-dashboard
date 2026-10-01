import 'server-only';
import { aiMode, geminiJSON, S } from './gemini';
import { firstEmail, firstPhone, redact } from './pii';
import { store } from './store';
import type { Candidate, CandidateView, Criterion, EmailKind, PII, Role, RoleScore } from './types';
import { ROLES } from './types';
import type { ParsedFile } from './parse';

export const SHORTLIST_SIZE = Math.max(1, parseInt(process.env.SHORTLIST_SIZE || '5', 10));
const COMPANY = 'Kargo';
const FOUNDER = process.env.FOUNDER_NAME || 'Arjun Mehta';
const ROLE_LABEL: Record<Role, string> = { PM: 'Product Manager', SPM: 'Senior Product Manager' };

// ------------------------------------------------------------------------------------------------
// Step 0 — Extraction: separate personal details from CV content.
// This is the ONLY step that sees the raw CV. Everything after it gets cv_content (redacted).
// ------------------------------------------------------------------------------------------------
export async function extract(file: ParsedFile): Promise<{ pii: Omit<PII, 'candidate_id'>; content: string }> {
  const scanned = file.text.length < 300; // image-only PDF → let Gemini read the file itself
  let name: string | null = null;
  let email = firstEmail(file.text);
  let phone = firstPhone(file.text);
  let text = file.text;

  if (aiMode() !== 'mock') {
    const parts = scanned && file.mime === 'application/pdf'
      ? [{ text: 'CV attached as PDF.' }, { inline_data: { mime_type: file.mime, data: file.bytes.toString('base64') } }]
      : [{ text: `CV TEXT:\n"""\n${file.text.slice(0, 30000)}\n"""` }];
    const out = await geminiJSON<{ name: string; email: string; phone: string; cv_text: string }>({
      system:
        'You extract contact details from a CV. Return the candidate\'s full name, email and phone exactly as written, ' +
        'or an empty string for any that are missing. ' +
        (scanned
          ? 'The CV is a scanned document: in cv_text, transcribe ALL of its content faithfully (experience, education, skills) as plain text.'
          : 'Return an empty string for cv_text.'),
      parts,
      schema: S.obj({ name: S.str(), email: S.str(), phone: S.str(), cv_text: S.str() }),
    });
    name = out.name?.trim() || null;
    email = out.email?.trim() || email;
    phone = out.phone?.trim() || phone;
    if (scanned && out.cv_text) text = out.cv_text;
  } else {
    name = mockName(file.text);
  }

  const content = redact(text, { name, email, phone });
  return { pii: { name, email, phone }, content };
}

// ------------------------------------------------------------------------------------------------
// Step 1 — Scoring against BOTH rubrics. Totals are computed here (deterministic), not by the model.
// ------------------------------------------------------------------------------------------------
export async function score(content: string, rubric: Criterion[]): Promise<Record<Role, RoleScore>> {
  const byRole = (r: Role) => rubric.filter((c) => c.role === r).sort((a, b) => a.position - b.position);

  let raw: Record<Role, { criterion: string; score: number; reason: string }[]>;
  if (aiMode() !== 'mock') {
    const rubricText = ROLES.map(
      (r) =>
        `### ${r} — ${ROLE_LABEL[r]}\n` +
        byRole(r).map((c) => `- ${c.name} (weight ${c.weight}%): ${c.description}`).join('\n'),
    ).join('\n\n');
    const item = S.obj({ criterion: S.str('Exact criterion name'), score: S.int('0-5'), reason: S.str('One line, cite CV evidence') });
    raw = await geminiJSON({
      system:
        `You are a strict, consistent hiring evaluator for ${COMPANY}, a Series A logistics SaaS company in Mumbai. ` +
        'Score the candidate against EVERY criterion of BOTH rubrics (PM and SPM) using only evidence written in the CV. ' +
        'Use the 0-5 anchors in each description literally. No evidence = 0 or 1. Do not reward certifications, school brands, ' +
        'titles or years of experience unless a criterion asks for them. Each reason is ONE line (max 25 words) citing the ' +
        'specific CV evidence (or its absence). The candidate is anonymised as [Candidate]; never guess identity, gender, age or ethnicity.',
      parts: [{ text: `RUBRICS\n${rubricText}\n\nCANDIDATE CV (personal details removed)\n"""\n${content.slice(0, 30000)}\n"""` }],
      schema: S.obj({ PM: S.arr(item), SPM: S.arr(item) }),
    });
  } else {
    raw = { PM: mockScores(content, byRole('PM')), SPM: mockScores(content, byRole('SPM')) };
  }

  const result = {} as Record<Role, RoleScore>;
  for (const r of ROLES) {
    const criteria = byRole(r).map((c) => {
      const hit = raw[r]?.find((x) => norm(x.criterion) === norm(c.name)) ?? raw[r]?.[c.position - 1];
      const s = Math.max(0, Math.min(5, Math.round(Number(hit?.score ?? 0))));
      return { name: c.name, weight: c.weight, score: s, reason: hit?.reason?.trim() || 'No evidence found.' };
    });
    const total = Math.round(criteria.reduce((sum, c) => sum + (c.score / 5) * c.weight, 0) * 10) / 10;
    result[r] = { total, criteria };
  }
  return result;
}

// ------------------------------------------------------------------------------------------------
// Step 2 — Interview brief (top candidates): three sentences.
// ------------------------------------------------------------------------------------------------
export async function writeBrief(c: Candidate): Promise<string> {
  const rs = c.scores![c.applied_role];
  if (aiMode() === 'mock') return mockBrief(c);
  const out = await geminiJSON<{ brief: string }>({
    system:
      `You write interview briefs for ${FOUNDER}, founder of ${COMPANY}, who has 10 minutes per candidate. ` +
      'Write EXACTLY three sentences, plain text, no bullets: (1) who this candidate is in one line — their background and the most relevant thing they have done; ' +
      '(2) why the system ranked them here — the strongest rubric evidence; (3) what to probe in the interview — the weakest or least-evidenced rubric area, phrased as a concrete question to ask. ' +
      'Refer to the person as "the candidate". Never invent facts not in the CV.',
    parts: [{ text: `ROLE APPLIED FOR: ${ROLE_LABEL[c.applied_role]}\nSCORE: ${rs.total}/100\n${scoreLines(rs)}\n\nCV (personal details removed)\n"""\n${c.cv_content!.slice(0, 20000)}\n"""` }],
    schema: S.obj({ brief: S.str() }),
    temperature: 0.3,
  });
  return out.brief.trim();
}

// ------------------------------------------------------------------------------------------------
// Step 3 — Personalised email draft (invite or warm rejection). Name is a placeholder until send.
// ------------------------------------------------------------------------------------------------
export async function writeEmail(c: Candidate, kind: EmailKind): Promise<{ subject: string; body: string }> {
  if (aiMode() === 'mock') return mockEmail(c, kind);
  const rs = c.scores![c.applied_role];
  const instructions =
    kind === 'invite'
      ? 'Write an interview INVITE. Warm, direct, founder voice. Mention one or two SPECIFIC things from their CV that made you want to talk. ' +
        'Ask them to reply with two or three 45-minute slots that work for them next week (in-office Mumbai or video). Under 140 words.'
      : 'Write a warm, respectful REJECTION. Thank them, be honest that you are moving ahead with candidates whose experience is closer to what the role needs right now, ' +
        'name ONE specific genuine strength from their CV, and wish them well. No false promises, no "we will keep your CV on file" unless natural. Under 120 words.';
  const out = await geminiJSON<{ subject: string; body: string }>({
    system:
      `You draft candidate emails sent personally by ${FOUNDER}, Founder of ${COMPANY} (logistics SaaS, Mumbai). ${instructions} ` +
      'Start the body with "Hi {{FIRST_NAME}}," exactly — the placeholder is replaced with the real name at send time. Never write any name for the candidate other than the placeholder. ' +
      `Sign off as:\n${FOUNDER}\nFounder, ${COMPANY}\nPlain text only.`,
    parts: [{ text: `ROLE: ${ROLE_LABEL[c.applied_role]}\n${scoreLines(rs)}\n\nCV (personal details removed)\n"""\n${c.cv_content!.slice(0, 15000)}\n"""` }],
    schema: S.obj({ subject: S.str(), body: S.str() }),
    temperature: 0.4,
  });
  return { subject: out.subject.trim(), body: out.body.trim() };
}

// ------------------------------------------------------------------------------------------------
// Ranking + views
// ------------------------------------------------------------------------------------------------
export function roleScore(c: Candidate, r: Role): number {
  return Number((r === 'PM' ? c.pm_score : c.spm_score) ?? -1);
}

export function buildViews(cands: Candidate[], pii: PII[]): CandidateView[] {
  const piiMap = new Map(pii.map((p) => [p.candidate_id, p]));
  const rankMap = new Map<string, number>();
  for (const r of ROLES) {
    cands
      .filter((c) => c.applied_role === r && c.status === 'scored')
      .sort((a, b) => roleScore(b, r) - roleScore(a, r) || a.created_at.localeCompare(b.created_at))
      .forEach((c, i) => rankMap.set(c.id, i + 1));
  }
  return cands.map((c) => {
    const p = piiMap.get(c.id);
    const rank = rankMap.get(c.id) ?? null;
    const recommended: EmailKind | null = rank == null ? null : rank <= SHORTLIST_SIZE ? 'invite' : 'reject';
    const outcome: EmailKind | null = c.decision === 'auto' ? recommended : c.decision;
    const draft_stale =
      c.status === 'scored' && !c.sent_at && outcome != null && (c.email_kind !== outcome || !c.email_body || (outcome === 'invite' && !c.brief));
    return { ...c, name: p?.name ?? null, email: p?.email ?? null, phone: p?.phone ?? null, rank, recommended, outcome, draft_stale };
  });
}

/** Generate any missing/stale briefs and drafts. Processes up to `limit`; returns how many remain. */
export async function syncDrafts(limit = 4): Promise<{ done: number; remaining: number; errors: string[] }> {
  const s = store();
  const views = buildViews(await s.listCandidates(), await s.listPII());
  const todo = views.filter((v) => v.draft_stale);
  const batch = todo.slice(0, limit);
  const errors: string[] = [];
  await Promise.all(
    batch.map(async (v) => {
      try {
        const patch: Partial<Candidate> = {};
        if (v.outcome === 'invite' && !v.brief) patch.brief = await writeBrief(v);
        if (v.email_kind !== v.outcome || !v.email_body) {
          const e = await writeEmail(v, v.outcome!);
          Object.assign(patch, { email_kind: v.outcome, email_subject: e.subject, email_body: e.body, email_edited: false });
        }
        await s.updateCandidate(v.id, patch);
      } catch (e) {
        errors.push(`${v.file_name}: ${(e as Error).message}`);
      }
    }),
  );
  return { done: batch.length - errors.length, remaining: Math.max(0, todo.length - batch.length), errors };
}

// ------------------------------------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------------------------------------
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const scoreLines = (rs: RoleScore) =>
  'RUBRIC SCORES:\n' + rs.criteria.map((c) => `- ${c.name}: ${c.score}/5 — ${c.reason}`).join('\n');

// ---------- Mock AI (no GEMINI_API_KEY): keyword heuristics so the app is testable offline ----------
function mockName(text: string): string | null {
  const first = text.split('\n').map((l) => l.trim()).find((l) => /^[A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+){1,2}$/.test(l));
  return first ?? null;
}
const KW: Record<string, RegExp[]> = {
  operationalgroundtruth: [/freight|forwarder|customs|cha\b|port|terminal|jnpt|warehouse|3pl|carrier|shipment|logistics|supply chain|dispatch/gi],
  unpromptedbuilder: [/adopted|built (a|the)|became the (team'?s )?standard|nobody|first .* (programme|process|tracker|dashboard)/gi],
  killspostmortems: [/killed|post-?mortem|did not work|didn't work|lost|retrospective|reversed/gi],
  ownershipunderpressure: [/overnight|night|outage|weekend|deadline|crisis|escalation|without escalat|peak|incident/gi],
  soleownership: [/sole|only pm|no (pm )?manager|without a|reported directly|head of product|independent|first pm/gi],
};
function mockScores(content: string, crit: Criterion[]) {
  return crit.map((c) => {
    const re = KW[norm(c.name)] ?? [];
    const hits = re.reduce((n, r) => n + (content.match(r)?.length ?? 0), 0);
    const score = Math.min(5, hits === 0 ? 0 : 1 + Math.floor(hits / 2));
    return { criterion: c.name, score, reason: hits ? `Mock: ${hits} keyword signals found in CV.` : 'Mock: no keyword signals found.' };
  });
}
function mockBrief(c: Candidate) {
  const rs = c.scores![c.applied_role];
  const sorted = [...rs.criteria].sort((a, b) => b.score - a.score);
  return `The candidate applied for ${ROLE_LABEL[c.applied_role]} and scored ${rs.total}/100. Strongest on ${sorted[0].name} (${sorted[0].score}/5). Probe ${sorted[sorted.length - 1].name} (${sorted[sorted.length - 1].score}/5): ask for one concrete example. [mock — add GEMINI_API_KEY]`;
}
function mockEmail(c: Candidate, kind: EmailKind) {
  const role = ROLE_LABEL[c.applied_role];
  return kind === 'invite'
    ? { subject: `${COMPANY} — ${role} interview`, body: `Hi {{FIRST_NAME}},\n\nThanks for applying for the ${role} role at ${COMPANY}. I'd like to talk. Could you reply with two or three 45-minute slots next week?\n\n${FOUNDER}\nFounder, ${COMPANY}\n\n[mock draft — add GEMINI_API_KEY]` }
    : { subject: `Your ${role} application at ${COMPANY}`, body: `Hi {{FIRST_NAME}},\n\nThank you for applying for the ${role} role at ${COMPANY}. We're moving ahead with candidates whose experience is closer to what the role needs right now. I wish you the very best.\n\n${FOUNDER}\nFounder, ${COMPANY}\n\n[mock draft — add GEMINI_API_KEY]` };
}
