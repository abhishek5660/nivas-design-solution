import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/**
 * Deployment diagnostics. Reports configuration/database status without exposing any secret:
 * only booleans and a Prisma error CODE (e.g. P1001 = database unreachable, P2021 = tables missing).
 */
export async function GET() {
  const checks: Record<string, unknown> = {
    databaseUrlSet: !!process.env.DATABASE_URL,
    sessionSecretOk: !!process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 && !/change-me/i.test(process.env.SESSION_SECRET),
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.databaseReachable = true;
  } catch (e) {
    checks.databaseReachable = false;
    checks.databaseErrorCode = (e as { code?: string }).code ?? (e as Error).name;
    return NextResponse.json({ ok: false, ...checks }, { status: 503 });
  }
  try {
    await prisma.user.count();
    checks.tablesPresent = true;
  } catch (e) {
    checks.tablesPresent = false;
    checks.databaseErrorCode = (e as { code?: string }).code ?? (e as Error).name;
    return NextResponse.json({ ok: false, ...checks }, { status: 503 });
  }
  return NextResponse.json({ ok: !!checks.sessionSecretOk, ...checks });
}
