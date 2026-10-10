import { hardwareIndex, ILLUSTRATIVE_RATES } from '../catalog';
import type { ApplianceParams, SceneDoc } from '../types';
import { allNodeParts, docMaterial, resolveMaterialId } from './resolve';

export type BoqSection = 'Boards & panels' | 'Shutters & fronts' | 'Countertops & stone' | 'Glass & mirror' | 'Hardware' | 'Lighting' | 'Appliances' | 'Services';

export interface BoqItem {
  key: string;
  section: BoqSection;
  description: string;
  spec: string;
  unit: string;
  /** net quantity from the model */
  netQty: number;
  /** quantity after wastage (sheet goods only) */
  qty: number;
  unitPrice: number | null;
  priceSource: 'override' | 'illustrative' | 'custom-material' | 'none';
  estimate: boolean;
  amount: number;
  nodes: string[];
}

export interface BoqTotals {
  materials: number;
  hardware: number;
  appliances: number;
  labour: number;
  installation: number;
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
}

export interface Boq {
  items: BoqItem[];
  totals: BoqTotals;
  warnings: string[];
  currency: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const APPLIANCE_LABEL: Record<ApplianceParams['kind'], string> = {
  fridge: 'Refrigerator',
  oven: 'Built-in oven',
  microwave: 'Microwave',
  hob: 'Hob',
  chimney: 'Chimney / hood',
  dishwasher: 'Dishwasher',
  sink: 'Sink & faucet',
  light_strip: 'Under-cabinet light',
};

export function buildBoq(doc: SceneDoc, rates: Record<string, number> = ILLUSTRATIVE_RATES): Boq {
  const hw = hardwareIndex();
  const items = new Map<string, BoqItem>();
  const warnings: string[] = [];
  const pricing = doc.pricing;

  const priceFor = (key: string, materialRate?: number): Pick<BoqItem, 'unitPrice' | 'priceSource' | 'estimate'> => {
    const o = pricing.overrides[key];
    if (o) return { unitPrice: o.unitPrice, priceSource: 'override', estimate: o.estimate };
    if (materialRate != null) return { unitPrice: materialRate, priceSource: 'custom-material', estimate: true };
    if (key in rates) return { unitPrice: rates[key], priceSource: 'illustrative', estimate: true };
    return { unitPrice: null, priceSource: 'none', estimate: true };
  };

  const add = (key: string, base: Omit<BoqItem, 'key' | 'netQty' | 'qty' | 'unitPrice' | 'priceSource' | 'estimate' | 'amount' | 'nodes'>, qty: number, nodeId: string, materialRate?: number) => {
    const id = `${base.section}::${key}`;
    const ex = items.get(id);
    if (ex) {
      ex.netQty += qty;
      if (!ex.nodes.includes(nodeId)) ex.nodes.push(nodeId);
      return;
    }
    items.set(id, { key, ...base, netQty: qty, qty, ...priceFor(key, materialRate), amount: 0, nodes: [nodeId] });
  };

  // --- from model parts
  const thick: Record<string, Set<number>> = {};
  for (const { node, parts } of allNodeParts(doc)) {
    for (const p of parts) {
      const matId = resolveMaterialId(doc, node, p);
      const mat = docMaterial(doc, matId);
      const matRate = mat.rate?.unit === 'm2' ? mat.rate.price : undefined;
      if (p.sheet && p.shape === 'box') {
        const dims = [...p.size].sort((a, b) => a - b);
        const area = (dims[1] * dims[2]) / 1e6;
        const section: BoqSection = p.role === 'door' || p.role === 'drawer_front' ? 'Shutters & fronts' : p.role === 'worktop' || p.role === 'backsplash' ? 'Countertops & stone' : 'Boards & panels';
        const key = `mat:${matId}`;
        (thick[`${section}::${key}`] ??= new Set()).add(Math.round(dims[0]));
        add(key, { section, description: mat.name, spec: '', unit: 'm²' }, area, node.id, matRate);
      } else if (p.shape === 'box' && (p.slot === 'glass' || p.slot === 'mirror') && p.role !== 'appliance') {
        const dims = [...p.size].sort((a, b) => a - b);
        add(`mat:${matId}`, { section: 'Glass & mirror', description: mat.name, spec: '', unit: 'm²' }, (dims[1] * dims[2]) / 1e6, node.id, matRate);
      }
      for (const h of p.hardware ?? []) {
        const def = hw.get(h.code);
        const isLight = def?.category === 'led';
        add(`hw:${h.code}`, { section: isLight ? 'Lighting' : 'Hardware', description: def?.name ?? h.code, spec: def?.spec ?? '', unit: def?.unit ?? 'each' }, h.qty, node.id);
        if (!def) warnings.push(`Hardware code ${h.code} is not in the library.`);
      }
    }
    if (node.type === 'model') {
      add(`app:model-${node.id}`, { section: 'Appliances', description: `Imported model: ${node.name}`, spec: `${Math.round(node.size.w)} x ${Math.round(node.size.h)} x ${Math.round(node.size.d)} mm`, unit: 'each' }, 1, node.id);
    }
    if (node.type === 'appliance') {
      const kind = (node.params as unknown as ApplianceParams).kind;
      if (kind !== 'light_strip') {
        const key = `app:${kind}`;
        add(key, { section: 'Appliances', description: APPLIANCE_LABEL[kind], spec: 'Dimensions per model', unit: 'each' }, 1, node.id);
      }
    }
  }
  // finalize sheet items: spec, wastage, rounding, amounts
  for (const it of items.values()) {
    const isArea = it.unit === 'm²';
    if (isArea) {
      const th = thick[`${it.section}::${it.key}`];
      if (th) it.spec = `Thickness ${[...th].sort((a, b) => a - b).join(', ')} mm`;
      it.netQty = r3(it.netQty);
      const wasteFactor = it.section === 'Boards & panels' || it.section === 'Shutters & fronts' || it.section === 'Countertops & stone' ? 1 + pricing.wastagePct / 100 : 1;
      it.qty = r3(it.netQty * wasteFactor);
    } else if (it.unit === 'm') {
      it.netQty = r3(it.netQty);
      it.qty = it.netQty;
    } else {
      // whole units: round up fractional hardware quantities (e.g. 0.5 sliding sets)
      it.netQty = Math.ceil(r3(it.netQty));
      it.qty = it.netQty;
    }
    if (it.unitPrice == null) {
      it.amount = 0;
      warnings.push(`No price for "${it.description}" - enter a unit price (item is excluded from the total until priced).`);
    } else it.amount = r2(it.qty * it.unitPrice);
  }
  const list = [...items.values()];
  // one LED driver per lit node is already counted via part hardware.

  const sum = (secs: BoqSection[]) => r2(list.filter((i) => secs.includes(i.section)).reduce((a, i) => a + i.amount, 0));
  const materials = sum(['Boards & panels', 'Shutters & fronts', 'Countertops & stone', 'Glass & mirror']);
  const hardware = sum(['Hardware', 'Lighting']);
  const appliances = sum(['Appliances']);
  const labour = r2(((materials + hardware) * pricing.labourPct) / 100);
  const installation = r2(pricing.installationFlat);
  const subtotal = r2(materials + hardware + appliances + labour + installation);
  const discount = r2((subtotal * pricing.discountPct) / 100);
  const taxable = r2(subtotal - discount);
  const tax = r2((taxable * pricing.taxPct) / 100);
  const total = r2(taxable + tax);

  const order: BoqSection[] = ['Boards & panels', 'Shutters & fronts', 'Countertops & stone', 'Glass & mirror', 'Hardware', 'Lighting', 'Appliances', 'Services'];
  list.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section) || a.description.localeCompare(b.description));
  if (list.length === 0) warnings.push('The design has no components yet - the BOQ is empty.');
  return {
    items: list,
    totals: { materials, hardware, appliances, labour, installation, subtotal, discount, taxable, tax, total },
    warnings: [...new Set(warnings)],
    currency: pricing.currency,
  };
}
