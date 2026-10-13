import { NextResponse } from 'next/server';
import { handle, HttpError, loadProjectFor, requireUser } from '@/lib/server/auth';
import { getRates } from '@/lib/server/rates';
import { buildBoq } from '@/lib/docs/bom';
import { buildDrawing, drawingToDXF, drawingToSVG, type DrawingView } from '@/lib/docs/drawing';
import { buildFloorSheet } from '@/lib/plan/sheet';
import { boqCsv, cutlistCsv, cutlistPdf, drawingsPdf, hardwareCsv, quotationPdf } from '@/lib/docs/export';
import { exportProjectJson, validateDoc } from '@/lib/schema';

const VIEWS: DrawingView[] = ['plan', 'front', 'back', 'left', 'right'];

/**
 * Generates documents from the SAVED project in the database (not from the browser state), so
 * every export reflects exactly what has been persisted.
 */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await params;
  const { project } = await loadProjectFor(user.id, user.role, id, 'read');
  const type = new URL(req.url).searchParams.get('type') ?? '';
  const rep = validateDoc(project.data);
  if (!rep.ok) throw new HttpError(422, 'The saved design is invalid and cannot be exported.', rep.errors);
  const doc = rep.doc!;
  const meta = { id: project.id, name: project.name, customer: project.customer, category: project.category, version: project.version, updatedAt: project.updatedAt.toISOString() };
  const safe = project.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'project';
  const file = (body: BodyInit, mime: string, name: string) =>
    new Response(body, { headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${safe}-${name}"`, 'Cache-Control': 'no-store' } });

  switch (type) {
    case 'boq.csv': {
      const { rates } = await getRates();
      return file(boqCsv(doc, meta, buildBoq(doc, rates)), 'text/csv; charset=utf-8', 'boq.csv');
    }
    case 'cutlist.csv':
      return file(cutlistCsv(doc, meta), 'text/csv; charset=utf-8', 'cutlist.csv');
    case 'hardware.csv':
      return file(hardwareCsv(doc, meta), 'text/csv; charset=utf-8', 'hardware.csv');
    case 'quotation.pdf': {
      const { rates } = await getRates();
      return file(quotationPdf(doc, meta, buildBoq(doc, rates)), 'application/pdf', 'quotation.pdf');
    }
    case 'cutlist.pdf':
      return file(cutlistPdf(doc, meta), 'application/pdf', 'cutlist.pdf');
    case 'drawings.pdf':
      return file(drawingsPdf(doc, meta, ['plan', 'front', 'left']), 'application/pdf', 'drawings.pdf');
    case 'project.json':
      return file(exportProjectJson({ name: project.name, category: project.category, customer: project.customer, roomNotes: project.roomNotes }, doc), 'application/json', 'project.json');
    case 'floorplan.svg':
    case 'floorplan.dxf': {
      if (!doc.plan?.enabled) throw new HttpError(400, 'This project has no floor plan.');
      const d = buildFloorSheet(doc, doc.plan.activeFloorId);
      if (type === 'floorplan.svg') return file(drawingToSVG(d, { title: `${project.name} - ${d.title}` }), 'image/svg+xml', 'floorplan.svg');
      return file(drawingToDXF(d), 'application/dxf', 'floorplan.dxf');
    }
    default: {
      const m = /^(plan|front|back|left|right)\.(svg|dxf)$/.exec(type);
      if (m && VIEWS.includes(m[1] as DrawingView)) {
        const d = buildDrawing(doc, m[1] as DrawingView);
        if (m[2] === 'svg') return file(drawingToSVG(d, { title: `${project.name} - ${d.title}` }), 'image/svg+xml', `${m[1]}.svg`);
        return file(drawingToDXF(d), 'application/dxf', `${m[1]}.dxf`);
      }
      throw new HttpError(400, `Unknown export type "${type}".`);
    }
  }
});

void NextResponse;
