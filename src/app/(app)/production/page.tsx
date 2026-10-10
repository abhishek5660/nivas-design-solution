import { PageHeader } from '@/components/ui';
import { ProjectsView } from '@/components/ProjectsView';

export const metadata = { title: 'Production Documents' };

export default function Page() {
  return (
    <>
      <PageHeader title="Production Documents" subtitle="Cut lists with panel labels, edge banding, board layouts, hardware lists and assembly notes for each project." />
      <ProjectsView linkTab="production" />
    </>
  );
}
