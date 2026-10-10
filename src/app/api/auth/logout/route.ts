import { NextResponse } from 'next/server';
import { destroySession, handle } from '@/lib/server/auth';

export const POST = handle(async () => {
  await destroySession();
  return NextResponse.json({ ok: true });
});
