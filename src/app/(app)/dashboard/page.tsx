import Link from 'next/link';
import { CATEGORY_LABEL, PageHeader, STATUS_COLOR, STATUS_LABEL } from '@/components/ui';
import { getUser } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';
import { DashboardActions } from '@/components/DashboardActions';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = (await getUser())!;
  const where = { OR: [{ ownerId: user.id }, { shares: { some: { userId: user.id } } }] };
  const [recent, total, byCat, byStatus] = await Promise.all([
    prisma.project.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 6, select: { id: true, name: true, category: true, status: true, customer: true, updatedAt: true, thumbnail: true, version: true } }),
    prisma.project.count({ where }),
    prisma.project.groupBy({ by: ['category'], where, _count: true }),
    prisma.project.groupBy({ by: ['status'], where, _count: true }),
  ]);
  const cat = Object.fromEntries(byCat.map((c) => [c.category, c._count]));
  const st = Object.fromEntries(byStatus.map((c) => [c.status, c._count]));

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Start a new design or pick up where you left off." actions={<DashboardActions canCreate={user.role !== 'VIEWER'} />} />

      <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Project summary">
        {(['WARDROBE', 'KITCHEN', 'TV_PANEL', 'CUSTOM'] as const).map((c) => (
          <Link key={c} href={`/designer/${c === 'TV_PANEL' ? 'tv-panel' : c.toLowerCase()}`} className="card group p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="text-xs font-semibold uppercase tracking-wider text-mute">{CATEGORY_LABEL[c]}</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-5xl font-semibold">{cat[c] ?? 0}</span>
              <span className="text-sm text-mute">project{(cat[c] ?? 0) === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-3 h-0.5 w-8 bg-gold transition-all group-hover:w-16" />
          </Link>
        ))}
      </section>

      <div className="mb-3 flex items-end justify-between">
        <h2 className="font-display text-2xl font-semibold">Recently edited</h2>
        <Link href="/projects" className="text-sm font-medium text-wood hover:underline">All {total} projects →</Link>
      </div>
      {recent.length === 0 ? (
        <div className="card p-10 text-center text-sm text-mute">No projects yet. Use “New project” above to design your first wardrobe, kitchen or TV panel.</div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {recent.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="card flex gap-4 overflow-hidden p-3 transition hover:shadow-lg">
                <div className="h-20 w-28 shrink-0 overflow-hidden rounded-md bg-linen">
                  {p.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-[10px] font-semibold uppercase tracking-wider text-stone">{CATEGORY_LABEL[p.category]}</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-display text-lg font-semibold">{p.name}</h3>
                  <p className="truncate text-xs text-mute">{CATEGORY_LABEL[p.category]}{p.customer ? ` · ${p.customer}` : ''}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`chip ${STATUS_COLOR[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                    <span className="text-[11px] text-mute">{p.updatedAt.toLocaleDateString()} · v{p.version}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-9" aria-label="Status">
        <h2 className="mb-3 font-display text-2xl font-semibold">Pipeline</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <span key={k} className={`chip px-3 py-1 text-xs ${STATUS_COLOR[k]}`}>{v}: <b className="ml-1">{st[k] ?? 0}</b></span>
          ))}
        </div>
      </section>
    </>
  );
}
