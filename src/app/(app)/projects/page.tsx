import { PageHeader } from '@/components/ui';
import { ProjectsView } from '@/components/ProjectsView';

export const metadata = { title: 'My Projects' };

export default function Page() {
  return (
    <>
      <PageHeader title="My Projects" subtitle="Everything you own or that has been shared with you. Projects are stored in the database and reopen exactly as you left them." />
      <ProjectsView />
    </>
  );
}
