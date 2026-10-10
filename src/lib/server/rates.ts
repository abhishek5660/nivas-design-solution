import { ILLUSTRATIVE_RATES } from '@/lib/catalog';
import { prisma } from './db';

/** Rate card = illustrative starter values overlaid with the administrator's own rates. */
export async function getRates(): Promise<{ rates: Record<string, number>; custom: Record<string, number> }> {
  const row = await prisma.setting.findUnique({ where: { key: 'rateCard' } });
  const custom = (row?.value ?? {}) as Record<string, number>;
  return { rates: { ...ILLUSTRATIVE_RATES, ...custom }, custom };
}
