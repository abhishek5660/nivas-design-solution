import { z } from 'zod';
import { materialIndex } from './catalog';
import type { SceneDoc } from './types';
import { validateNode, validateRoom } from './scene';
import { validatePlan } from './plan/validate';

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const pos = z.number().finite().positive();

const nodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['wardrobe', 'cabinet', 'countertop', 'appliance', 'tv_panel', 'box', 'model', 'furniture', 'group']),
  name: z.string().max(120),
  parentId: z.string().nullable(),
  position: vec3,
  rotationY: z.number().finite(),
  size: z.object({ w: pos, h: pos, d: pos }),
  materials: z.record(z.string(), z.string()),
  subMaterials: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  visible: z.boolean(),
  locked: z.boolean(),
  floorId: z.string().max(64).optional(),
  params: z.record(z.string(), z.unknown()),
  notes: z.string().max(2000).optional(),
});

const materialSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  category: z.string().max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1),
  opacity: z.number().min(0).max(1).optional(),
  texture: z.string(),
  textureUrl: z.string().max(300).optional(),
  textureScale: z.number().min(0.05).max(50),
  emissive: z.string().optional(),
  source: z.enum(['sample', 'custom']),
  verified: z.boolean(),
  catalogId: z.string().optional(),
  rate: z.object({ unit: z.enum(['m2', 'each']), price: z.number().min(0) }).optional(),
});

export const docSchema = z.object({
  schema: z.literal(1),
  units: z.literal('mm'),
  category: z.enum(['WARDROBE', 'KITCHEN', 'TV_PANEL', 'CUSTOM']),
  room: z.object({
    points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).max(40),
    height: z.number().finite(),
    wallThickness: z.number().finite(),
    openings: z.array(z.object({ id: z.string(), kind: z.enum(['door', 'window', 'opening']), wall: z.number().int().min(0), offset: z.number(), width: z.number(), height: z.number(), sill: z.number() })),
    columns: z.array(z.object({ id: z.string(), x: z.number(), z: z.number(), w: z.number().positive(), d: z.number().positive() })),
    floorMaterial: z.string(),
    wallMaterial: z.string(),
    ceilingMaterial: z.string(),
    showWalls: z.boolean(),
    showCeiling: z.boolean(),
  }),
  nodes: z.record(z.string(), nodeSchema),
  order: z.array(z.string()),
  defaults: z.record(z.string(), z.string()),
  customMaterials: z.array(materialSchema),
  pricing: z.object({
    currency: z.string().min(1).max(8),
    taxPct: z.number().min(0).max(100),
    labourPct: z.number().min(0).max(300),
    installationFlat: z.number().min(0),
    wastagePct: z.number().min(0).max(100),
    discountPct: z.number().min(0).max(100),
    overrides: z.record(z.string(), z.object({ unitPrice: z.number().min(0), estimate: z.boolean() })),
    customerName: z.string().optional(),
  }),
  lighting: z.object({
    preset: z.enum(['daylight', 'warm', 'neutral', 'night']),
    exposure: z.number().min(0.1).max(4),
    toneMapping: z.enum(['ACES', 'AgX', 'Neutral', 'None']),
    shadows: z.boolean(),
    ao: z.boolean(),
    roomLight: z.number().min(0).max(4),
  }),
  meta: z.object({ createdWith: z.string(), notes: z.string() }),
  plan: z.unknown().optional(),
});

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  doc?: SceneDoc;
}

/**
 * Full validation of a scene document: structural schema, id/order consistency, per-node
 * geometry constraints and asset (material) references. Used on save, import and load.
 */
export function validateDoc(input: unknown): ValidationReport {
  const parsed = docSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || 'document'}: ${i.message}`), warnings: [] };
  }
  const doc = parsed.data as unknown as SceneDoc;
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const [k, n] of Object.entries(doc.nodes)) {
    if (n.id !== k) errors.push(`Node key "${k}" does not match its id "${n.id}".`);
    if (n.parentId && !doc.nodes[n.parentId]) errors.push(`${n.name}: parent ${n.parentId} does not exist.`);
  }
  const seen = new Set<string>();
  for (const id of doc.order) {
    if (!doc.nodes[id]) errors.push(`Order list references missing node ${id}.`);
    if (seen.has(id)) errors.push(`Node ${id} appears twice in the order list.`);
    seen.add(id);
  }
  for (const id of Object.keys(doc.nodes)) if (!seen.has(id)) errors.push(`Node ${id} is missing from the order list.`);
  if (Object.keys(doc.nodes).length > 2000) errors.push('Too many components (limit 2000).');
  const mats = materialIndex(doc.customMaterials);
  const refs = new Set<string>([...Object.values(doc.defaults), doc.room.floorMaterial, doc.room.wallMaterial, doc.room.ceilingMaterial]);
  for (const n of Object.values(doc.nodes)) {
    Object.values(n.materials).forEach((m) => refs.add(m));
    Object.values(n.subMaterials ?? {}).forEach((a) => Object.values(a).forEach((m) => refs.add(m)));
    for (const issue of validateNode(n)) (issue.level === 'error' ? errors : warnings).push(`${n.name}: ${issue.message}`);
  }
  for (const r of refs) if (!mats.has(r)) errors.push(`Material "${r}" is referenced but not defined (missing asset).`);
  for (const n of Object.values(doc.nodes)) {
    if (n.type === 'model') {
      const url = (n.params as { url?: string }).url;
      if (!url || !/^\/api\/assets\/[A-Za-z0-9_-]+$/.test(url)) errors.push(`${n.name}: the imported model has no valid uploaded asset (missing asset).`);
    }
  }
  for (const m of doc.customMaterials) {
    if (m.texture === 'image' && !m.textureUrl) errors.push(`Material "${m.name}" uses an image texture without a file.`);
    if (m.textureUrl && !/^\/api\/assets\/[A-Za-z0-9_-]+$/.test(m.textureUrl)) errors.push(`Material "${m.name}": texture URL must be an uploaded asset.`);
  }
  if (doc.plan) {
    const pv = validatePlan(doc.plan);
    errors.push(...pv.errors.slice(0, 8).map((m) => `Floor plan: ${m}`));
    warnings.push(...pv.warnings);
    const floors = new Set(doc.plan.buildings?.flatMap((b) => b.floors.map((f) => f.id)) ?? []);
    for (const n of Object.values(doc.nodes)) if (n.floorId && !floors.has(n.floorId)) errors.push(`${n.name}: it stands on a floor that does not exist.`);
  }
  for (const i of validateRoom(doc.room)) (i.level === 'error' ? errors : warnings).push(`Room: ${i.message}`);
  return { ok: errors.length === 0, errors, warnings, doc };
}

export const projectExportEnvelope = z.object({
  format: z.literal('nivas-project'),
  version: z.literal(1),
  exportedAt: z.string(),
  project: z.object({
    name: z.string().min(1).max(160),
    category: z.enum(['WARDROBE', 'KITCHEN', 'TV_PANEL', 'CUSTOM']),
    customer: z.string().max(200).optional(),
    roomNotes: z.string().max(2000).optional(),
  }),
  data: z.unknown(),
});

export type ProjectExport = z.infer<typeof projectExportEnvelope> & { data: SceneDoc };

export function parseProjectImport(text: string): { ok: true; value: ProjectExport; warnings: string[] } | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The file is not valid JSON.'] };
  }
  const env = projectExportEnvelope.safeParse(json);
  if (!env.success) return { ok: false, errors: env.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || 'file'}: ${i.message}`) };
  const rep = validateDoc(env.data.data);
  if (!rep.ok) return { ok: false, errors: rep.errors.slice(0, 12) };
  return { ok: true, value: { ...env.data, data: rep.doc! }, warnings: rep.warnings };
}

export function exportProjectJson(meta: { name: string; category: string; customer?: string; roomNotes?: string }, doc: SceneDoc): string {
  return JSON.stringify({ format: 'nivas-project', version: 1, exportedAt: new Date().toISOString(), project: meta, data: doc }, null, 2);
}
