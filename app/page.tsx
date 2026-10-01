'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CandidateView, Criterion, Role } from '@/lib/types';

type Config = { shortlistSize: number; ai: 'gemini' | 'gateway' | 'mock'; db: 'supabase' | 'local'; email: 'resend' | 'off' };
type UploadItem = { name: string; role: Role; state: 'queued' | 'working' | 'done' | 'error'; msg?: string };
const ROLE_LABEL: Record<Role, string> = { PM: 'Product Manager', SPM: 'Senior Product Manager' };

function personalise(t: string, name: string | null) {
  const full = (name || '').trim();
  const first = full.split(/\s+/)[0] || 'there';
  return t.replace(/\{\{\s*FIRST_NAME\s*\}\}/g, first).replace(/\{\{\s*NAME\s*\}\}/g, full || 'there').replace(/\[Candidate\]/g, full || 'the candidate');
}
const roleScore = (c: CandidateView, r: Role) => (r === 'PM' ? c.pm_score : c.spm_score);

export default function Dashboard() {
  const [cands, setCands] = useState<CandidateView[]>([]);
  const [rubric, setRubric] = useState<Criterion[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Role>('PM');
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [syncLeft, setSyncLeft] = useState<number | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const syncing = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/candidates', { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) return setLoadErr(j.error || 'Failed to load');
    setLoadErr(null);
    setCands(j.candidates);
    setRubric(j.rubric);
    setConfig(j.config);
    return j.candidates as CandidateView[];
  }, []);

  const runSync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    setSyncErr(null);
    try {
      for (let i = 0; i < 60; i++) {
        const r = await fetch('/api/sync', { method: 'POST' });
        const j = await r.json();
        if (!r.ok) { setSyncErr(j.error); break; }
        if (j.errors?.length) setSyncErr(j.errors[0]);
        setSyncLeft(j.remaining);
        await load();
        if (j.remaining === 0 || (j.done === 0 && j.errors?.length)) break;
      }
    } finally {
      syncing.current = false;
      setSyncLeft(null);
    }
  }, [load]);

  useEffect(() => {
    load().then((list) => { if (list?.some((c) => c.draft_stale)) runSync(); });
  }, [load, runSync]);

  async function startUpload(files: File[], roleChoice: Role | 'auto') {
    const items: UploadItem[] = files.map((f) => {
      const n = f.name.toLowerCase();
      const role: Role = roleChoice !== 'auto' ? roleChoice : n.startsWith('spm') ? 'SPM' : 'PM';
      return { name: f.name, role, state: 'queued' };
    });
    setUploads(items);
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        setUploads((u) => u.map((x, k) => (k === i ? { ...x, state: 'working' } : x)));
        const fd = new FormData();
        fd.append('file', files[i]);
        fd.append('role', items[i].role);
        try {
          const r = await fetch('/api/upload', { method: 'POST', body: fd });
          const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
          setUploads((u) => u.map((x, k) => (k === i ? { ...x, state: r.ok ? 'done' : 'error', msg: j.error } : x)));
        } catch (e) {
          setUploads((u) => u.map((x, k) => (k === i ? { ...x, state: 'error', msg: String(e) } : x)));
        }
        if (i % 3 === 0) load();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await load();
    await runSync();
  }

  const list = useMemo(
    () =>
      cands
        .filter((c) => c.applied_role === tab)
        .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.created_at.localeCompare(b.created_at)),
    [cands, tab],
  );
  const stats = useMemo(() => {
    const mine = cands.filter((c) => c.applied_role === tab);
    return {
      total: mine.length,
      shortlist: mine.filter((c) => c.outcome === 'invite').length,
      ready: mine.filter((c) => c.status === 'scored' && !c.draft_stale && !c.sent_at).length,
      sent: mine.filter((c) => c.sent_at).length,
    };
  }, [cands, tab]);

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <div>
          <h1>Hiring dashboard</h1>
          <div className="muted">The system ranks and drafts. You decide and send. Nothing goes out without you.</div>
        </div>
        <div className="spacer" />
        {config && (
          <div className="row small">
            <span className={`pill ${config.ai !== 'mock' ? 'good' : 'warn'}`}>AI: {config.ai === 'mock' ? 'mock (no key)' : config.ai === 'gateway' ? 'Gemini via AI Gateway' : 'Gemini'}</span>
            <span className={`pill ${config.db === 'supabase' ? 'good' : 'warn'}`}>DB: {config.db}</span>
            <span className={`pill ${config.email === 'resend' ? 'good' : 'warn'}`}>Email: {config.email === 'resend' ? 'Resend' : 'not set'}</span>
          </div>
        )}
      </div>

      {loadErr && <div className="banner">Couldn&apos;t load data: {loadErr}</div>}

      <Uploader onUpload={startUpload} items={uploads} syncLeft={syncLeft} syncErr={syncErr} onRetrySync={runSync} />

      <div className="tabs">
        {(['PM', 'SPM'] as Role[]).map((r) => (
          <button key={r} className={tab === r ? 'on' : ''} onClick={() => { setTab(r); setOpenId(null); }}>
            {ROLE_LABEL[r]} · {cands.filter((c) => c.applied_role === r).length}
          </button>
        ))}
      </div>

      <div className="stats">
        <div className="stat"><b>{stats.total}</b><span>Applicants</span></div>
        <div className="stat"><b>{stats.shortlist}</b><span>Shortlisted (invite)</span></div>
        <div className="stat"><b>{stats.ready}</b><span>Drafts ready to send</span></div>
        <div className="stat"><b>{stats.sent}</b><span>Emails sent</span></div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Candidate</th>
              <th>{tab} score</th>
              <th className="hide-sm">{tab === 'PM' ? 'SPM' : 'PM'} score</th>
              <th>Recommendation</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>No {tab} candidates yet — upload CVs above.</td></tr>
            )}
            {list.map((c, i) => {
              const showLine = config && c.rank === config.shortlistSize + 1 && list[i - 1]?.rank === config.shortlistSize;
              return (
                <Fragment key={c.id}>
                  {showLine && <tr className="line"><td colSpan={6}>▲ Shortlist line — top {config!.shortlistSize} get a brief and an interview invite; everyone below gets a warm rejection</td></tr>}
                  <Row c={c} tab={tab} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />
                  {openId === c.id && (
                    <tr className="detail"><td colSpan={6}><Detail c={c} tab={tab} rubric={rubric} config={config} reload={load} sync={runSync} /></td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}


function Row({ c, tab, open, onToggle }: { c: CandidateView; tab: Role; open: boolean; onToggle: () => void }) {
  const other: Role = tab === 'PM' ? 'SPM' : 'PM';
  const s = roleScore(c, tab);
  const o = roleScore(c, other);
  return (
    <tr className={`cand ${open ? 'open' : ''}`} onClick={onToggle}>
      <td className="rank">{c.rank ?? '–'}</td>
      <td className="name">
        <b>{c.name || <span className="muted">Name not found</span>}</b>
        <span>{c.file_name}</span>
      </td>
      <td>
        {c.status === 'scored' ? (
          <div className="bar"><div className="track"><div className="fill" style={{ width: `${s}%` }} /></div><b>{Math.round(Number(s))}</b></div>
        ) : c.status === 'processing' ? <span className="pill">Processing…</span> : <span className="pill bad" title={c.error || ''}>Error</span>}
      </td>
      <td className="hide-sm">
        {c.status === 'scored' && (
          <span>
            {Math.round(Number(o))}
            {Number(o) >= Number(s) + 8 && <span className="pill accent" style={{ marginLeft: 6 }}>Stronger fit for {other}</span>}
          </span>
        )}
      </td>
      <td>
        {c.outcome === 'invite' && <span className="pill good">Interview</span>}
        {c.outcome === 'reject' && <span className="pill bad">Reject</span>}
        {c.decision !== 'auto' && <span className="pill" style={{ marginLeft: 4 }} title="You overrode the system">overridden</span>}
      </td>
      <td>
        {c.sent_at ? <span className="pill good">✓ Sent</span>
          : c.status !== 'scored' ? null
          : c.draft_stale ? <span className="pill">Drafting…</span>
          : <span className="pill warn">Draft ready</span>}
      </td>
    </tr>
  );
}

function Detail({ c, tab, rubric, config, reload, sync }: {
  c: CandidateView; tab: Role; rubric: Criterion[]; config: Config | null; reload: () => Promise<unknown>; sync: () => Promise<void>;
}) {
  const [view, setView] = useState<Role>(tab);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(c.email_subject || '');
  const [body, setBody] = useState(c.email_body || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { if (!editing) { setSubject(c.email_subject || ''); setBody(c.email_body || ''); } }, [c.email_subject, c.email_body, editing]);

  async function patch(data: object, label: string) {
    setBusy(label); setMsg(null);
    const r = await fetch(`/api/candidates/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) setMsg({ ok: false, text: j.error });
    await reload();
    return r.ok;
  }
  async function setDecision(d: 'auto' | 'invite' | 'reject') {
    if (await patch({ decision: d }, 'decision')) sync();
  }
  async function send() {
    const to = c.email || 'the address on the CV';
    if (!confirm(`Send this ${c.email_kind === 'invite' ? 'interview invite' : 'rejection'} to ${to}?`)) return;
    setBusy('send'); setMsg(null);
    const r = await fetch(`/api/send/${c.id}`, { method: 'POST' });
    const j = await r.json();
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: `Sent to ${j.to}` } : { ok: false, text: j.error });
    await reload();
  }
  async function remove() {
    if (!confirm('Delete this candidate and their stored personal details?')) return;
    await fetch(`/api/candidates/${c.id}`, { method: 'DELETE' });
    await reload();
  }

  if (c.status !== 'scored') {
    return (
      <div className="inner" style={{ display: 'block' }}>
        {c.status === 'error' ? <p className="err">Processing failed: {c.error}</p> : <p className="muted">Still processing…</p>}
        <button className="danger" onClick={remove}>Delete and re-upload</button>
      </div>
    );
  }

  const rs = c.scores?.[view];
  const crit = rubric.filter((r) => r.role === view);
  const kindLabel = c.email_kind === 'invite' ? 'interview invite' : 'rejection';

  return (
    <div className="inner">
      <div>
        <div className="row" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Why ranked here</h3>
          <div className="spacer" />
          <div className="seg small">
            {(['PM', 'SPM'] as Role[]).map((r) => (
              <button key={r} className={view === r ? 'on' : ''} onClick={() => setView(r)}>{r} {Math.round(Number(roleScore(c, r)))}</button>
            ))}
          </div>
        </div>
        <table className="crit">
          <tbody>
            {rs?.criteria.map((k) => (
              <tr key={k.name}>
                <td>
                  <b title={crit.find((x) => x.name === k.name)?.description}>{k.name}</b>
                  <div className="small muted">weight {k.weight}%</div>
                </td>
                <td>
                  <span className="dots">{'●'.repeat(k.score)}<i>{'●'.repeat(5 - k.score)}</i></span> <b>{k.score}/5</b>
                  <div className="small">{k.reason}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="small muted" style={{ marginTop: 10 }}>
          {c.email || 'no email on CV'} · {c.phone || 'no phone'} · {c.file_name}
          {' · '}<button className="link small danger" onClick={remove}>delete</button>
        </div>
      </div>

      <div>
        <h3>Interview brief</h3>
        {c.brief ? <div className="brief">{c.brief}</div> : (
          <div className="row" style={{ marginBottom: 14 }}>
            <span className="muted small">Briefs are generated for shortlisted candidates.</span>
            <button className="small" disabled={!!busy} onClick={() => patch({ action: 'brief' }, 'brief')}>{busy === 'brief' ? 'Writing…' : 'Generate brief anyway'}</button>
          </div>
        )}

        <div className="row" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Your decision</h3>
          <div className="seg small">
            <button className={c.decision === 'auto' ? 'on' : ''} disabled={!!c.sent_at || !!busy} onClick={() => setDecision('auto')}>
              System: {c.recommended === 'invite' ? 'Interview' : 'Reject'}
            </button>
            <button className={c.decision === 'invite' ? 'on' : ''} disabled={!!c.sent_at || !!busy} onClick={() => setDecision('invite')}>Interview</button>
            <button className={c.decision === 'reject' ? 'on' : ''} disabled={!!c.sent_at || !!busy} onClick={() => setDecision('reject')}>Reject</button>
          </div>
        </div>

        {c.draft_stale && !c.sent_at ? (
          <p className="muted">Drafting the {c.outcome === 'invite' ? 'interview invite' : 'rejection'}…</p>
        ) : (
          <div className="email">
            <div className="hdr">
              <div><span className="muted">To:</span> {c.sent_to || c.email || <span className="err">no email found on CV</span>}</div>
              {editing ? (
                <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
              ) : (
                <div><span className="muted">Subject:</span> <b>{personalise(c.email_subject || '', c.name)}</b></div>
              )}
            </div>
            {editing ? (
              <div style={{ padding: 10 }}>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} />
                <div className="small muted">{'{{FIRST_NAME}}'} is replaced with the candidate&apos;s real name when sent.</div>
              </div>
            ) : (
              <div className="body">{personalise(c.email_body || '', c.name)}</div>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          {c.sent_at ? (
            <span className="pill good">✓ Sent to {c.sent_to} · {new Date(c.sent_at).toLocaleString()}</span>
          ) : editing ? (
            <>
              <button className="primary" disabled={!!busy} onClick={async () => { if (await patch({ email_subject: subject, email_body: body }, 'save')) setEditing(false); }}>Save draft</button>
              <button onClick={() => setEditing(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="primary" disabled={!!busy || c.draft_stale || !c.email_body || !c.email || config?.email !== 'resend'} onClick={send}>
                {busy === 'send' ? 'Sending…' : `Confirm & send ${kindLabel}`}
              </button>
              <button disabled={c.draft_stale} onClick={() => setEditing(true)}>Edit</button>
              {config?.email !== 'resend' && <span className="small muted">Add RESEND_API_KEY to enable sending</span>}
            </>
          )}
        </div>
        {msg && <p className={msg.ok ? 'small' : 'err'} style={msg.ok ? { color: 'var(--good)' } : {}}>{msg.text}</p>}
      </div>
    </div>
  );
}

function Uploader({ onUpload, items, syncLeft, syncErr, onRetrySync }: {
  onUpload: (f: File[], r: Role | 'auto') => void; items: UploadItem[]; syncLeft: number | null; syncErr: string | null; onRetrySync: () => void;
}) {
  const [role, setRole] = useState<Role | 'auto'>('PM');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const working = items.some((i) => i.state === 'queued' || i.state === 'working');
  const done = items.filter((i) => i.state === 'done').length;
  const errs = items.filter((i) => i.state === 'error');

  const pick = (files: FileList | null) => {
    const list = Array.from(files || []).filter((f) => /\.(pdf|docx|txt)$/i.test(f.name));
    if (list.length) onUpload(list, role);
  };

  return (
    <div className="card">
      <div className="row">
        <div>
          <h2 style={{ marginBottom: 6 }}>Upload CVs</h2>
          <label className="small muted">Applied for&nbsp;
            <select value={role} onChange={(e) => setRole(e.target.value as Role | 'auto')} disabled={working}>
              <option value="PM">Product Manager (PM)</option>
              <option value="SPM">Senior Product Manager (SPM)</option>
              <option value="auto">Detect from file name (spm_… → SPM, else PM)</option>
            </select>
          </label>
        </div>
        <div
          className={`drop ${over ? 'over' : ''}`}
          onClick={() => !working && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (!working) pick(e.dataTransfer.files); }}
        >
          {working ? `Processing ${done + errs.length} of ${items.length}…` : 'Drop PDF / DOCX files here, or click to choose (multiple allowed)'}
          <input ref={input} type="file" multiple accept=".pdf,.docx,.txt" hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
        </div>
      </div>
      {items.length > 0 && (
        <>
          <div className="progress"><div style={{ width: `${((done + errs.length) / items.length) * 100}%` }} /></div>
          <div className="small muted" style={{ marginTop: 6 }}>
            {done} scored{errs.length > 0 && <span className="err"> · {errs.length} failed</span>}
            {syncLeft !== null && ` · writing briefs & drafts (${syncLeft} left)…`}
          </div>
          {errs.slice(0, 5).map((e) => <div key={e.name} className="err">{e.name}: {e.msg}</div>)}
        </>
      )}
      {items.length === 0 && syncLeft !== null && <div className="small muted" style={{ marginTop: 8 }}>Writing briefs & drafts ({syncLeft} left)…</div>}
      {syncErr && <div className="err" style={{ marginTop: 6 }}>Draft step: {syncErr} <button className="link small" onClick={onRetrySync}>retry</button></div>}
    </div>
  );
}
