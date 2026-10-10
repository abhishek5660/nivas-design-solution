import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { ProjectsView } from '@/components/ProjectsView';

const MAP: Record<string, { cat: string; title: string; blurb: string }> = {
  wardrobe: { cat: 'WARDROBE', title: 'Wardrobe Designer', blurb: 'Parametric wardrobes: sections, shelves, drawers, rods, hinged or sliding shutters, lofts and lighting.' },
  kitchen: { cat: 'KITCHEN', title: 'Kitchen Designer', blurb: 'Straight, L, U, parallel and island kitchens built from individually editable cabinets and appliances.' },
  'tv-panel': { cat: 'TV_PANEL', title: 'TV Panel Designer', blurb: 'Full-wall panels, floating units, side towers, fluted and slat finishes, niches and LED lighting.' },
  custom: { cat: 'CUSTOM', title: 'Custom Furniture Designer', blurb: 'Compose any piece from cabinets, shelves and panels using the parametric component library.' },
};

export default async function Page({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const m = MAP[category];
  if (!m) notFound();
  return (
    <>
      <PageHeader title={m.title} subtitle={m.blurb} />
      <ProjectsView category={m.cat} />
    </>
  );
}
