// Integration tests: real HTTP against a running app + PostgreSQL.
// Run with the app up (`npm run dev`), then `npm run test:integration`. Skipped automatically if the server is unreachable.
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { starterDoc } from '@/lib/scene';

const BASE = process.env.APP_URL ?? 'http://localhost:3000';
let up = false;
const prisma = new PrismaClient();

class Client {
  cookie = '';
  async req(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (this.cookie) headers.cookie = this.cookie;
    let body = init.body;
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    const res = await fetch(BASE + path, { ...init, headers, body, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    return res;
  }
  async json(path: string, init: RequestInit & { json?: unknown } = {}) {
    const res = await this.req(path, init);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  async signUp(name = 'Integration User') {
    const email = `int-${Date.now()}-${Math.floor(Math.random() * 1e6)}@nivas.test`;
    const r = await this.json('/api/auth/register', { method: 'POST', json: { name, email, password: 'integration-pass-1' } });
    expect(r.status).toBe(201);
    return { email, id: r.body.user.id as string };
  }
}

beforeAll(async () => {
  try {
    const r = await fetch(`${BASE}/login`);
    up = r.ok;
  } catch {
    up = false;
  }
  if (!up) console.warn(`[integration] ${BASE} is not reachable - skipping`);
});
afterAll(async () => {
  await prisma.$disconnect();
});


describe('API integration', () => {
  it('auth: register, session, me, wrong password, logout', async (ctx) => {
    if (!up) return ctx.skip();
    const c = new Client();
    const { email } = await c.signUp();
    expect((await c.json('/api/auth/me')).body.user.email).toBe(email);
    const bad = new Client();
    expect((await bad.json('/api/auth/login', { method: 'POST', json: { email, password: 'wrong-password' } })).status).toBe(401);
    expect((await bad.json('/api/auth/me')).body.user).toBeNull();
    const dup = await new Client().json('/api/auth/register', { method: 'POST', json: { name: 'x', email, password: 'integration-pass-1' } });
    expect(dup.status).toBe(409);
    const short = await new Client().json('/api/auth/register', { method: 'POST', json: { name: 'x', email: 'a@b.test', password: 'short' } });
    expect(short.status).toBe(400);
  });

  it('persistence: save → reopen preserves geometry, materials and placement; stale saves conflict; revisions restore', async (ctx) => {
    if (!up) return ctx.skip();
    const c = new Client();
    await c.signUp();
    const created = await c.json('/api/projects', { method: 'POST', json: { name: 'Persist', category: 'WARDROBE' } });
    expect(created.status).toBe(201);
    const id = created.body.project.id;
    const first = (await c.json(`/api/projects/${id}`)).body.project;
    const doc = first.data;
    const nid = doc.order[0];
    doc.nodes[nid].size = { w: 3100, h: 2350, d: 640 };
    doc.nodes[nid].materials = { shutter: 'wood-walnut' };
    doc.nodes[nid].position = [1900, 0, 321];
    const save = await c.json(`/api/projects/${id}`, { method: 'PUT', json: { data: doc, baseVersion: first.version, revisionLabel: 'Walnut 3100' } });
    expect(save.status).toBe(200);
    expect(save.body.version).toBe(first.version + 1);

    const reopened = (await c.json(`/api/projects/${id}`)).body.project.data.nodes[nid];
    expect(reopened.size).toEqual({ w: 3100, h: 2350, d: 640 });
    expect(reopened.materials.shutter).toBe('wood-walnut');
    expect(reopened.position).toEqual([1900, 0, 321]);

    // stale write → 409, nothing overwritten
    const stale = await c.json(`/api/projects/${id}`, { method: 'PUT', json: { data: doc, baseVersion: first.version } });
    expect(stale.status).toBe(409);

    // restore the first revision as a new version
    const revs = (await c.json(`/api/projects/${id}/revisions`)).body.revisions as { id: string; label: string; version: number }[];
    expect(revs.length).toBeGreaterThanOrEqual(2);
    const original = revs.find((r) => r.label === 'Created')!;
    const restored = await c.json(`/api/projects/${id}/revisions/${original.id}`, { method: 'POST' });
    expect(restored.status).toBe(200);
    const now = (await c.json(`/api/projects/${id}`)).body.project;
    expect(now.data.nodes[nid].size.w).not.toBe(3100);
    expect(now.version).toBe(save.body.version + 1);

    // duplicate then delete
    const dup = await c.json(`/api/projects/${id}/duplicate`, { method: 'POST' });
    expect(dup.status).toBe(201);
    expect((await c.json(`/api/projects/${dup.body.project.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await c.json(`/api/projects/${dup.body.project.id}`)).status).toBe(404);
  });

  it('rejects invalid designs with explicit messages and never partially saves', async (ctx) => {
    if (!up) return ctx.skip();
    const c = new Client();
    await c.signUp();
    const id = (await c.json('/api/projects', { method: 'POST', json: { name: 'Invalid', category: 'KITCHEN', layout: 'straight' } })).body.project.id;
    const p = (await c.json(`/api/projects/${id}`)).body.project;
    const bad = structuredClone(p.data);
    const nid = bad.order[0];
    bad.nodes[nid].size.w = -50;
    let r = await c.json(`/api/projects/${id}`, { method: 'PUT', json: { data: bad, baseVersion: p.version } });
    expect(r.status).toBe(422);
    const bad2 = structuredClone(p.data);
    bad2.nodes[nid].materials.carcass = 'nonexistent-material';
    r = await c.json(`/api/projects/${id}`, { method: 'PUT', json: { data: bad2, baseVersion: p.version } });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body.details)).toMatch(/missing asset/);
    // untouched
    expect((await c.json(`/api/projects/${id}`)).body.project.version).toBe(p.version);
    // invalid import via create
    const imp = await c.json('/api/projects', { method: 'POST', json: { name: 'bad import', category: 'WARDROBE', doc: { schema: 1 } } });
    expect(imp.status).toBe(422);
  });

  it('exports are generated from saved data and contain it', async (ctx) => {
    if (!up) return ctx.skip();
    const c = new Client();
    await c.signUp();
    const doc = starterDoc('KITCHEN', { layout: 'u_shape' });
    const id = (await c.json('/api/projects', { method: 'POST', json: { name: 'Export check ünïcode', category: 'KITCHEN', doc, customer: 'ACME' } })).body.project.id;
    const boq = await (await c.req(`/api/projects/${id}/export?type=boq.csv`)).text();
    expect(boq).toContain('Export check');
    expect(boq).toContain('Refrigerator');
    const json = await (await c.req(`/api/projects/${id}/export?type=project.json`)).json();
    expect(json.format).toBe('nivas-project');
    expect(Object.keys(json.data.nodes).length).toBe(Object.keys(doc.nodes).length);
    const svg = await (await c.req(`/api/projects/${id}/export?type=front.svg`)).text();
    expect(svg).toContain('<svg');
    expect((await c.req(`/api/projects/${id}/export?type=bogus`)).status).toBe(400);
  });

  it('assets: only validated PNG/JPG/WEBP/GLB uploads are accepted; reads require sign-in', async (ctx) => {
    if (!up) return ctx.skip();
    const c = new Client();
    await c.signUp();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const upload = async (name: string, bytes: Uint8Array, type = 'application/octet-stream') => {
      const fd = new FormData();
      fd.append('file', new File([bytes as BlobPart], name, { type }));
      return c.req('/api/assets', { method: 'POST', body: fd });
    };
    const ok = await upload('tex.png', png, 'image/png');
    expect(ok.status).toBe(201);
    const asset = (await ok.json()).asset;
    expect((await upload('evil.exe', png)).status).toBe(415);
    expect((await upload('fake.png', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).status).toBe(415);
    expect((await upload('bad.glb', Uint8Array.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 9, 9, 9, 9, 0, 0, 0, 0, 0, 0, 0, 0]))).status).toBe(415);
    expect((await c.req(asset.url)).status).toBe(200);
    expect((await new Client().req(asset.url)).status).toBe(401);
  });

  it('catalog: private items belong to their owner; admins can share and verify', async (ctx) => {
    if (!up) return ctx.skip();
    const a = new Client();
    const b = new Client();
    const adm = new Client();
    await a.signUp('A');
    await b.signUp('B');
    const admin = await adm.signUp('Admin');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    const mat = { id: 'cm_x', name: 'Custom Teal', category: 'Custom', color: '#117788', roughness: 0.5, metalness: 0, texture: 'none', textureScale: 1, source: 'custom', verified: false };
    const created = await a.json('/api/catalog', { method: 'POST', json: { kind: 'MATERIAL', name: 'Custom Teal', data: { material: mat } } });
    expect(created.status).toBe(201);
    const id = created.body.item.id;
    expect((await a.json('/api/catalog?kind=MATERIAL')).body.items.some((i: { id: string }) => i.id === id)).toBe(true);
    expect((await b.json('/api/catalog?kind=MATERIAL')).body.items.some((i: { id: string }) => i.id === id)).toBe(false);
    expect((await b.json(`/api/catalog/${id}`, { method: 'DELETE' })).status).toBe(404);
    // a designer cannot self-share or self-verify
    await a.json(`/api/catalog/${id}`, { method: 'PATCH', json: { shared: true, verified: true } });
    expect((await b.json('/api/catalog?kind=MATERIAL')).body.items.some((i: { id: string }) => i.id === id)).toBe(false);
    // admin can
    expect((await adm.json(`/api/catalog/${id}`, { method: 'PATCH', json: { shared: true, verified: true } })).status).toBe(200);
    const seen = (await b.json('/api/catalog?kind=MATERIAL')).body.items.find((i: { id: string }) => i.id === id);
    expect(seen.verified).toBe(true);
    expect((await a.json(`/api/catalog/${id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('public preview link: enabled by the owner, readable anonymously, revocable', async (ctx) => {
    if (!up) return ctx.skip();
    const c = new Client();
    await c.signUp();
    const id = (await c.json('/api/projects', { method: 'POST', json: { name: 'Shareable', category: 'TV_PANEL' } })).body.project.id;
    const en = await c.json(`/api/projects/${id}/public`, { method: 'POST' });
    expect(en.status).toBe(200);
    const page = await new Client().req(en.body.path);
    expect(page.status).toBe(200);
    expect((await page.text()).length).toBeGreaterThan(500);
    expect((await new Client().req('/share/not-a-real-token-123456')).status).toBe(404);
    await c.json(`/api/projects/${id}/public`, { method: 'DELETE' });
    expect((await new Client().req(en.body.path)).status).toBe(404);
  });

  it('admin: user roles, registration switch and role-based access are enforced server-side', async (ctx) => {
    if (!up) return ctx.skip();
    const adm = new Client();
    const user = new Client();
    const a = await adm.signUp('Admin 2');
    const u = await user.signUp('Plain');
    await prisma.user.update({ where: { id: a.id }, data: { role: 'ADMIN' } });
    expect((await user.json('/api/admin/users')).status).toBe(403);
    expect((await adm.json('/api/admin/users')).body.users.length).toBeGreaterThan(1);
    expect((await adm.json(`/api/admin/users/${u.id}`, { method: 'PATCH', json: { role: 'VIEWER' } })).status).toBe(200);
    expect((await user.json('/api/projects', { method: 'POST', json: { name: 'nope', category: 'WARDROBE' } })).status).toBe(403);
    expect((await adm.json(`/api/admin/users/${a.id}`, { method: 'PATCH', json: { role: 'VIEWER' } })).status).toBe(400); // cannot demote self
    // registration switch
    await adm.json('/api/settings/app', { method: 'PUT', json: { allowRegistration: false } });
    const blocked = await new Client().json('/api/auth/register', { method: 'POST', json: { name: 'x', email: `closed-${Date.now()}@nivas.test`, password: 'integration-pass-1' } });
    expect(blocked.status).toBe(403);
    await adm.json('/api/settings/app', { method: 'PUT', json: { allowRegistration: true } });
    // deactivated users lose access immediately
    await adm.json(`/api/admin/users/${u.id}`, { method: 'PATCH', json: { active: false } });
    expect((await user.json('/api/auth/me')).body.user).toBeNull();
  });

  it('cross-origin state-changing requests are blocked', async (ctx) => {
    if (!up) return ctx.skip();
    const c = new Client();
    await c.signUp();
    const res = await c.req('/api/projects', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'csrf', category: 'WARDROBE' }) });
    expect(res.status).toBe(403);
  });
});
