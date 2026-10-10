import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, requireAdmin, requireUser } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';
import { getRates } from '@/lib/server/rates';

/** Rate card used by BOQ/quotations. Readable by all signed-in users, editable by administrators. */
export const GET = handle(async () => {
  await requireUser();
  return NextResponse.json(await getRates());
});

const schema = z.object({ custom: z.record(z.string().regex(/^(mat|hw|app):[A-Za-z0-9_.-]+$/), z.number().min(0).max(100_000_000)) });

export const PUT = handle(async (req: Request) => {
  await requireAdmin();
  const body = schema.parse(await req.json());
  await prisma.setting.upsert({ where: { key: 'rateCard' }, create: { key: 'rateCard', value: body.custom }, update: { value: body.custom } });
  return NextResponse.json(await getRates());
});
