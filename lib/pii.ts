/**
 * Personal-details separation. The extraction step identifies name / email / phone; this module
 * removes them (plus any other emails, phone numbers and profile URLs) from the CV text before
 * anything is stored as cv_content or sent to a scoring / brief / email step.
 */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// +91 98204 37810, 98204-37810, (022) 2345 6789, +1 415 555 0100 …
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{2,4})?/g;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|leetcode\.com|behance\.net|flowcv\.me|medium\.com|twitter\.com|x\.com)\/[^\s|,·]*/gi;

export function firstEmail(text: string): string | null {
  return text.match(EMAIL_RE)?.[0] ?? null;
}

export function firstPhone(text: string): string | null {
  for (const m of text.match(PHONE_RE) ?? []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13) return m.trim();
  }
  return null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redact(text: string, pii: { name?: string | null; email?: string | null; phone?: string | null }): string {
  let out = text.replace(EMAIL_RE, '[email removed]').replace(URL_RE, '[profile link removed]');

  out = out.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, '');
    // Only strip things that look like phone numbers, not years/date ranges/amounts.
    if (digits.length >= 10 && digits.length <= 13 && !/^(19|20)\d{2}\D+(19|20)\d{2}$/.test(m.trim())) return '[phone removed]';
    return m;
  });
  if (pii.phone) {
    const d = pii.phone.replace(/\D/g, '');
    if (d.length >= 8) {
      const loose = d.slice(-10).split('').join('[\\s.-]?');
      out = out.replace(new RegExp(loose, 'g'), '[phone removed]');
    }
  }
  if (pii.name) {
    const full = pii.name.trim();
    if (full) out = out.replace(new RegExp(escapeRe(full).replace(/\s+/g, '\\s*'), 'gi'), '[Candidate]');
    // Individual name parts (≥3 letters) as whole words, e.g. "Kabir", "Mehta".
    for (const part of full.split(/\s+/).filter((p) => p.length >= 3)) {
      out = out.replace(new RegExp(`\\b${escapeRe(part)}\\b`, 'gi'), '[Candidate]');
    }
    out = out.replace(/(\[Candidate\]\s*){2,}/g, '[Candidate] ');
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Put the real name back into a draft written with placeholders. */
export function personalise(text: string, name: string | null | undefined): string {
  const full = (name || '').trim();
  const first = full.split(/\s+/)[0] || '';
  return text
    .replace(/\{\{\s*FIRST_NAME\s*\}\}/g, first || 'there')
    .replace(/\{\{\s*NAME\s*\}\}/g, full || 'there')
    .replace(/\[Candidate\]/g, full || 'the candidate');
}
