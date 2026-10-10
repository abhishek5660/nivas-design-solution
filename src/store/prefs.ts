'use client';
import { create } from 'zustand';

export type Unit = 'mm' | 'cm' | 'in';

interface Prefs {
  unit: Unit;
  setUnit: (u: Unit) => void;
  hydrate: () => void;
}

const FACTOR: Record<Unit, number> = { mm: 1, cm: 0.1, in: 1 / 25.4 };
const DECIMALS: Record<Unit, number> = { mm: 1, cm: 2, in: 3 };

export const usePrefs = create<Prefs>((set) => ({
  unit: 'mm',
  setUnit: (unit) => {
    set({ unit });
    try {
      localStorage.setItem('nivas:unit', unit);
    } catch {
      /* ignore */
    }
  },
  hydrate: () => {
    try {
      const u = localStorage.getItem('nivas:unit');
      if (u === 'mm' || u === 'cm' || u === 'in') set({ unit: u });
    } catch {
      /* ignore */
    }
  },
}));

export const toDisplay = (mm: number, u: Unit) => Math.round(mm * FACTOR[u] * 10 ** DECIMALS[u]) / 10 ** DECIMALS[u];
export const fromDisplay = (v: number, u: Unit) => v / FACTOR[u];
export const formatLen = (mm: number, u: Unit) => `${toDisplay(mm, u)} ${u}`;
