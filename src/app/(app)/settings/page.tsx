import { PageHeader } from '@/components/ui';
import { SettingsView } from '@/components/SettingsView';
import { getUser } from '@/lib/server/auth';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = (await getUser())!;
  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile, display units and shortcuts." />
      <SettingsView user={{ name: user.name, email: user.email, role: user.role }} />
    </>
  );
}
