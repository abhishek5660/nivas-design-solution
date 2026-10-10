import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, requireAdmin } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

/** Application settings (administrator only). */
async function read() {
  const reg = await prisma.setting.findUnique({ where: { key: 'allowRegistration' } });
  const [users, projects, assets] = await Promise.all([prisma.user.count(), prisma.project.count(), prisma.asset.count()]);
  return { allowRegistration: reg ? reg.value !== false : true, stats: { users, projects, assets } };
}

export const GET = handle(async () => {
  await requireAdmin();
  return NextResponse.json(await read());
});

const schema = z.object({ allowRegistration: z.boolean() });

export const PUT = handle(async (req: Request) => {
  await requireAdmin();
  const body = schema.parse(await req.json());
  await prisma.setting.upsert({ where: { key: 'allowRegistration' }, create: { key: 'allowRegistration', value: body.allowRegistration }, update: { value: body.allowRegistration } });
  return NextResponse.json(await read());
});
