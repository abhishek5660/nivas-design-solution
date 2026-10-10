import { PageHeader } from '@/components/ui';
import { ProjectsView } from '@/components/ProjectsView';

export const metadata = { title: '2D Drawings' };

export default function Page() {
  return (
    <>
      <PageHeader title="2D Drawings" subtitle="Plans and elevations generated from the 3D model, with dimension lines. Choose a project to open its drawing sheets (export SVG, DXF or PDF)." />
      <ProjectsView linkTab="drawings" />
    </>
  );
}
