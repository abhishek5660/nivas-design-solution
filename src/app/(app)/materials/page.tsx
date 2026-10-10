import { MaterialsView } from '@/components/MaterialsView';
import { PageHeader } from '@/components/ui';
import { getUser } from '@/lib/server/auth';

export const metadata = { title: 'Materials & Hardware' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = (await getUser())!;
  return (
    <>
      <PageHeader title="Materials & Hardware" subtitle="Searchable catalogs of finishes and hardware. Create custom materials with your own colours, textures and rates." />
      <MaterialsView canCreate={user.role !== 'VIEWER'} isAdmin={user.role === 'ADMIN'} />
    </>
  );
}
