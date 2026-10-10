import { TemplatesView } from '@/components/TemplatesView';
import { PageHeader } from '@/components/ui';
import { getUser } from '@/lib/server/auth';

export const metadata = { title: 'Templates' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = (await getUser())!;
  return (
    <>
      <PageHeader title="Templates" subtitle="Start from a proven layout, or reuse your own designs. Templates copy the whole design - you can change everything afterwards." />
      <TemplatesView canCreate={user.role !== 'VIEWER'} />
    </>
  );
}
