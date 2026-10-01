import 'server-only';
import postgres from 'postgres';
import { SCHEMA_SQL } from './schema-sql';

/**
 * Creates the tables and seeds the rubric on first run, using the direct Postgres URL that the
 * Vercel ↔ Supabase integration provides. Runs once per server instance; a no-op when the rubric
 * is already there. (You can also run supabase/schema.sql by hand in the Supabase SQL editor.)
 */
let done: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!done) done = run().catch((e) => { done = null; throw e; });
  return done;
}

async function run() {
  const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) return; // tables were created manually
  const sql = postgres(url, { ssl: 'require', max: 1, prepare: false, onnotice: () => {} });
  try {
    const [{ t }] = await sql`select to_regclass('public.rubric_criteria') as t`;
    if (t) {
      const [{ n }] = await sql`select count(*)::int as n from rubric_criteria`;
      if (n > 0) return;
    }
    await sql.unsafe(SCHEMA_SQL);
    await sql.unsafe(`notify pgrst, 'reload schema'`);
    await new Promise((r) => setTimeout(r, 1500)); // let the API layer pick up the new tables
  } finally {
    await sql.end({ timeout: 5 });
  }
}
