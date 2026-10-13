import { request, type FullConfig } from '@playwright/test';

/** Warms up every route once so first-visit compilation in dev mode cannot make the timing-sensitive tests flaky. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL ?? 'http://localhost:3000';
  const ctx = await request.newContext({ baseURL, timeout: 180_000 });
  const email = `warm-${Date.now()}@nivas.test`;
  const reg = await ctx.post('/api/auth/register', { data: { name: 'Warmup', email, password: 'warmup-pass-123' } });
  if (!reg.ok()) return;
  const created = await ctx.post('/api/projects', { data: { name: 'warm', category: 'KITCHEN', layout: 'l_shape' } });
  const id = (await created.json()).project?.id;
  const pages = ['/dashboard', '/projects', '/library', '/materials', '/templates', '/settings', '/designer/kitchen', `/projects/${id}`, `/projects/${id}?tab=boq`];
  for (const p of pages) await ctx.get(p).catch(() => undefined);
  // warm the save route (first compile is slow in dev mode)
  const cur = await ctx.get(`/api/projects/${id}`).then((r) => r.json()).catch(() => null);
  if (cur?.project) await ctx.put(`/api/projects/${id}`, { data: { data: cur.project.data, baseVersion: cur.project.version } }).catch(() => undefined);
  for (const t of ['boq.csv', 'quotation.pdf', 'cutlist.pdf', 'drawings.pdf', 'plan.dxf']) await ctx.get(`/api/projects/${id}/export?type=${t}`).catch(() => undefined);
  for (const a of ['/api/catalog', '/api/settings/rates', `/api/projects/${id}/revisions`, `/api/projects/${id}/public`, `/api/projects/${id}/share`, '/api/admin/users']) await ctx.get(a).catch(() => undefined);
  await ctx.dispose();
}
