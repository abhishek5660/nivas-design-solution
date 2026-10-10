import { PageHeader } from '@/components/ui';
import { ProjectsView } from '@/components/ProjectsView';

export const metadata = { title: 'BOQ & Quotations' };

export default function Page() {
  return (
    <>
      <PageHeader title="BOQ & Quotations" subtitle="Bills of quantities generated from the saved components, with editable rates, wastage, labour, discount and tax. Estimates only - never a verified quotation." />
      <ProjectsView linkTab="boq" />
    </>
  );
}
