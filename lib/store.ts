import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Candidate, Criterion, PII } from './types';
import rubricSeed from './rubric-seed.json';
import { ensureSchema } from './migrate';

/**
 * Data access. Uses Supabase when SUPABASE_URL is set; otherwise falls back to a local JSON file
 * (.data/db.json) so the app runs on a laptop with zero setup. Vercel always needs Supabase.
 */
export interface Store {
  rubric(): Promise<Criterion[]>;
  listCandidates(): Promise<Candidate[]>;
  getCandidate(id: string): Promise<Candidate | null>;
  insertCandidate(c: Partial<Candidate>): Promise<Candidate>;
  updateCandidate(id: string, patch: Partial<Candidate>): Promise<void>;
  deleteCandidate(id: string): Promise<void>;
  listPII(): Promise<PII[]>;
  getPII(id: string): Promise<PII | null>;
  upsertPII(p: PII): Promise<void>;
}

// ---------- Supabase ----------
class SupabaseStore implements Store {
  db: SupabaseClient;
  constructor(url: string, key: string) {
    this.db = createClient(url, key, { auth: { persistSession: false } });
  }
  private check<T>(r: { data: T; error: { message: string } | null }): T {
    if (r.error) throw new Error(`Database error: ${r.error.message}`);
    return r.data;
  }
  async rubric() {
    await ensureSchema();
    return this.check(await this.db.from('kargo_rubric_criteria').select('*').order('role').order('position')) as Criterion[];
  }
  async listCandidates() {
    await ensureSchema();
    return this.check(await this.db.from('kargo_candidates').select('*').order('created_at')) as Candidate[];
  }
  async getCandidate(id: string) {
    return this.check(await this.db.from('kargo_candidates').select('*').eq('id', id).maybeSingle()) as Candidate | null;
  }
  async insertCandidate(c: Partial<Candidate>) {
    await ensureSchema();
    return this.check(await this.db.from('kargo_candidates').insert(c).select('*').single()) as Candidate;
  }
  async updateCandidate(id: string, patch: Partial<Candidate>) {
    this.check(await this.db.from('kargo_candidates').update(patch).eq('id', id));
  }
  async deleteCandidate(id: string) {
    this.check(await this.db.from('kargo_candidates').delete().eq('id', id));
  }
  async listPII() {
    return this.check(await this.db.from('kargo_candidate_pii').select('*')) as PII[];
  }
  async getPII(id: string) {
    return this.check(await this.db.from('kargo_candidate_pii').select('*').eq('candidate_id', id).maybeSingle()) as PII | null;
  }
  async upsertPII(p: PII) {
    this.check(await this.db.from('kargo_candidate_pii').upsert(p));
  }
}

// ---------- Local JSON file (dev only) ----------
interface LocalDB {
  candidates: Candidate[];
  pii: PII[];
}
class LocalStore implements Store {
  file = path.join(process.cwd(), '.data', 'db.json');
  private read(): LocalDB {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { candidates: [], pii: [] };
    }
  }
  private write(db: LocalDB) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(db, null, 2));
  }
  async rubric() {
    return rubricSeed as Criterion[];
  }
  async listCandidates() {
    return this.read().candidates;
  }
  async getCandidate(id: string) {
    return this.read().candidates.find((c) => c.id === id) ?? null;
  }
  async insertCandidate(c: Partial<Candidate>) {
    const db = this.read();
    const row = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      file_name: null,
      status: 'processing',
      error: null,
      cv_content: null,
      scores: null,
      pm_score: null,
      spm_score: null,
      decision: 'auto',
      brief: null,
      email_kind: null,
      email_subject: null,
      email_body: null,
      email_edited: false,
      sent_at: null,
      sent_to: null,
      sent_message_id: null,
      ...c,
    } as Candidate;
    db.candidates.push(row);
    this.write(db);
    return row;
  }
  async updateCandidate(id: string, patch: Partial<Candidate>) {
    const db = this.read();
    const i = db.candidates.findIndex((c) => c.id === id);
    if (i >= 0) db.candidates[i] = { ...db.candidates[i], ...patch };
    this.write(db);
  }
  async deleteCandidate(id: string) {
    const db = this.read();
    db.candidates = db.candidates.filter((c) => c.id !== id);
    db.pii = db.pii.filter((p) => p.candidate_id !== id);
    this.write(db);
  }
  async listPII() {
    return this.read().pii;
  }
  async getPII(id: string) {
    return this.read().pii.find((p) => p.candidate_id === id) ?? null;
  }
  async upsertPII(p: PII) {
    const db = this.read();
    db.pii = db.pii.filter((x) => x.candidate_id !== p.candidate_id);
    db.pii.push(p);
    this.write(db);
  }
}

let _store: Store | null = null;
export function store(): Store {
  if (_store) return _store;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) _store = new SupabaseStore(url, key);
  else if (process.env.VERCEL) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on Vercel.');
  else _store = new LocalStore();
  return _store;
}

export function storeKind(): 'supabase' | 'local' {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL ? 'supabase' : 'local';
}
