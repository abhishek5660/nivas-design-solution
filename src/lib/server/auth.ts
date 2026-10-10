import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { Role } from '@prisma/client';
import { prisma } from './db';

const COOKIE = 'nivas_session';
const MAX_AGE = 60 * 60 * 24 * 14;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32 || (process.env.NODE_ENV === 'production' && /change-me/i.test(s))) {
    if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters (not the example value).');
    return new TextEncoder().encode('dev-only-insecure-secret-change-me-please-0123456789');
  }
  return new TextEncoder().encode(s);
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export async function createSession(userId: string) {
  const token = await new SignJWT({ uid: userId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: MAX_AGE });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export async function getUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const user = await prisma.user.findUnique({ where: { id: String(payload.uid) }, select: { id: true, email: true, name: true, role: true, active: true } });
    if (!user || !user.active) return null;
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) throw new HttpError(401, 'You need to sign in.');
  return u;
}

export const canWrite = (u: SessionUser) => u.role === 'ADMIN' || u.role === 'DESIGNER';

export async function requireDesigner(): Promise<SessionUser> {
  const u = await requireUser();
  if (!canWrite(u)) throw new HttpError(403, 'Your role is read-only (Viewer).');
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'ADMIN') throw new HttpError(403, 'Administrator access required.');
  return u;
}

/** Wraps a route handler: converts HttpError / zod errors into JSON responses and logs unexpected failures. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response | NextResponse>) {
  return async (...args: A): Promise<Response> => {
    try {
      // CSRF defence in depth (cookies are also SameSite=Lax): reject cross-origin state-changing requests
      const req = args[0] as unknown;
      if (req instanceof Request && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.headers.get('origin');
        const host = req.headers.get('host');
        if (origin && host && new URL(origin).host !== host) throw new HttpError(403, 'Cross-origin request blocked.');
      }
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      if (e && typeof e === 'object' && 'issues' in e) {
        const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues;
        return NextResponse.json({ error: 'Invalid request.', details: issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`) }, { status: 400 });
      }
      console.error('[api] unhandled error', e);
      return NextResponse.json({ error: 'Something went wrong on the server. Your data was not changed.' }, { status: 500 });
    }
  };
}

// ---- tiny in-memory rate limiter (per process) ----
const hits = new Map<string, { n: number; t: number }>();
export function rateLimit(key: string, max = 8, windowMs = 60_000) {
  if (process.env.NODE_ENV !== 'production') max *= 50; // keep local development and automated tests unthrottled
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.t > windowMs) {
    hits.set(key, { n: 1, t: now });
    return;
  }
  h.n++;
  if (h.n > max) throw new HttpError(429, 'Too many attempts. Please wait a minute and try again.');
}

// ---- project access ----
export async function loadProjectFor(userId: string, role: Role, id: string, need: 'read' | 'write') {
  const project = await prisma.project.findUnique({ where: { id }, include: { shares: { where: { userId } } } });
  if (!project) throw new HttpError(404, 'Project not found.');
  const owner = project.ownerId === userId;
  const share = project.shares[0];
  const admin = role === 'ADMIN';
  const canRead = owner || admin || !!share;
  if (!canRead) throw new HttpError(404, 'Project not found.');
  if (need === 'write') {
    if (role === 'VIEWER') throw new HttpError(403, 'Viewers cannot edit projects.');
    if (!(owner || admin || share?.access === 'EDIT')) throw new HttpError(403, 'You only have view access to this project.');
  }
  return { project, owner, admin, access: owner || admin ? 'OWNER' : share!.access };
}
