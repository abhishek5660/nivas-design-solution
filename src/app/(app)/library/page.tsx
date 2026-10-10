import { LibraryView } from '@/components/LibraryView';
import { PageHeader } from '@/components/ui';
import { getUser } from '@/lib/server/auth';

export const metadata = { title: '3D Component Library' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = (await getUser())!;
  return (
    <>
      <PageHeader title="3D Component Library" subtitle="Parametric building blocks: every component is generated from dimensions and rules, not a fixed model. Add them inside any project, or start a new project from one." />
      <LibraryView canCreate={user.role !== 'VIEWER'} />
    </>
  );
}
