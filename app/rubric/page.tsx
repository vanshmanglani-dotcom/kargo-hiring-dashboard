import { store } from '@/lib/store';
import type { Role } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function RubricPage() {
  let rubric;
  try {
    rubric = await store().rubric();
  } catch (e) {
    return <div className="banner">Couldn&apos;t load rubric: {(e as Error).message}</div>;
  }
  return (
    <>
      <h1>Hiring rubric</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Built from Kargo&apos;s 8 past hires — what the &ldquo;Exceeds Expectations&rdquo; people had in common that the others didn&apos;t —
        not from the job descriptions. Every candidate is scored 0–5 on each criterion for <b>both</b> roles; the weighted total is out of 100.
      </p>
      {(['PM', 'SPM'] as Role[]).map((r) => {
        const list = rubric.filter((c) => c.role === r);
        return (
          <div className="card" key={r}>
            <h2>{r === 'PM' ? 'Product Manager' : 'Senior Product Manager'} <span className="muted small">· weights total {list.reduce((s, c) => s + c.weight, 0)}%</span></h2>
            <table className="crit">
              <tbody>
                {list.map((c) => (
                  <tr key={c.name}>
                    <td style={{ width: '26%' }}><b>{c.name}</b><div className="small muted">{c.weight}%</div></td>
                    <td>{c.description}{c.source && <div className="small muted" style={{ marginTop: 4 }}>Evidence: {c.source}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
