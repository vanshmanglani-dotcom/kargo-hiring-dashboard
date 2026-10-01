# Kargo Hiring Dashboard

Arjun uploads a CV and picks the role (PM / SPM). The system separates personal details, scores the
candidate against **both** rubrics, ranks everyone, writes a 3‑sentence interview brief for the top
candidates, and drafts a personalised invite or warm rejection for everyone. Arjun reads, decides,
and clicks one button to send via Resend. **Nothing goes out without him.**

```
Upload CV + role ─► Extract (Gemini) ─► PII → candidate_pii table (never sent to AI again)
                                     └► CV content (name/email/phone/links stripped) → candidates.cv_content
                                            │
                     Score vs PM + SPM rubric (Gemini, 0–5 per criterion; weighted total computed in code)
                                            │
                     Rank within applied role ─► top N: brief + invite draft │ rest: rejection draft
                                            │
                     Dashboard ─► Arjun reviews / overrides / edits ─► Confirm & send (Resend) ─► marked sent
```

## Stack
Next.js 15 (App Router) · Gemini Flash (direct API key, or via Vercel AI Gateway) · Supabase Postgres · Resend · Vercel

## Deploy

**Zero-key route (how this repo is deployed):**
1. Import the GitHub repo into Vercel.
2. Vercel → Storage / Integrations → add **Supabase** (creates the DB and injects `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
   and **Resend** (injects `RESEND_API_KEY`).
3. Supabase → SQL Editor → run `supabase/schema.sql` (creates tables, seeds the rubric from `rubric.txt`).
4. AI: on Vercel, Gemini Flash is called through **Vercel AI Gateway**, authenticated automatically by the deployment
   (no key). To use your own Google key instead, set `GEMINI_API_KEY`.
5. Redeploy.

**Manual route:** create the Supabase project yourself, run `supabase/schema.sql`, and set the variables in
`.env.example` in Vercel → Settings → Environment Variables.

Resend free-tier note: with `onboarding@resend.dev` as sender Resend only delivers to the address you signed up with.
Verify a domain in Resend, or set `TEST_RECIPIENT_OVERRIDE` to your own address.

`.env.local` is in `.gitignore` — never commit keys.

## Run locally
```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # http://localhost:3000
```
With no Supabase keys it stores data in `.data/db.json`; with no Gemini key it uses a keyword‑based
mock scorer so you can click through the whole flow. The header pills show which mode is live.

## Using it
- **Upload** – drop many PDFs/DOCX at once. Pick the role, or "Detect from file name" (`spm_…` → SPM).
  Three CVs are processed in parallel; briefs and drafts are written right after.
- **Rank** – tabs per role, ranked by that role's score. The green line marks the shortlist (top `SHORTLIST_SIZE`).
  "Stronger fit for SPM/PM" flags people who'd score better on the other role.
- **Decide** – open a row: per‑criterion score + one‑line reason (toggle PM/SPM), the brief, and the draft.
  Override the system (Interview / Reject) and the right draft is regenerated. Edit any draft before sending.
- **Send** – "Confirm & send" → confirmation → Resend → row marked ✓ Sent with time and address.

## Rubric
`rubric.txt` holds the patterns found in the 8 past hires and the PM/SPM rubric (5 criteria each,
weights = 100%). To change it, edit `rubric.txt`, run `npm run schema`, and re‑run `supabase/schema.sql`.

## Privacy (DPDP)
- Extraction is the only AI call that sees the raw CV. Name, email and phone go to `candidate_pii`;
  `cv_content` has them (plus profile URLs and any stray emails/phones) stripped, and that's all the
  scoring, brief and email steps ever receive. Drafts use `{{FIRST_NAME}}`; the real name is filled in at send time.
- Use a Gemini key on a **billing‑enabled** project: the free AI Studio tier may use inputs to improve Google's
  models, the paid API does not.
- Tables have Row Level Security on with no policies — only the server (service‑role key) can read them.
- Delete a candidate from the dashboard to remove their record and personal details (cascade).

## What is deliberately NOT automated
Auto‑sending rejections (Checks 06 + 09): a wrongly rejected candidate never comes back and no person
would be accountable for the decision. So the system ranks, explains and drafts; Arjun confirms every send.
