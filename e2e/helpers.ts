import { expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export interface Account {
  email: string;
  password: string;
  id: string;
}

/** Registers a fresh designer through the real API; the session cookie lands in the page's browser context. */
export async function signUp(page: Page, role?: 'ADMIN' | 'DESIGNER' | 'VIEWER'): Promise<Account> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@nivas.test`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-test`;
  const res = await page.request.post('/api/auth/register', { data: { name: 'E2E User', email, password } });
  expect(res.ok()).toBeTruthy();
  const { user } = await res.json();
  if (role && user.role !== role) {
    await prisma.user.update({ where: { id: user.id }, data: { role } });
  }
  return { email, password, id: user.id };
}

export async function createProject(page: Page, body: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/projects', { data: body });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).project.id;
}

export async function openProject(page: Page, id: string, tab?: string) {
  await page.goto(`/projects/${id}${tab ? `?tab=${tab}` : ''}`);
  await page.waitForFunction(() => !!(window as unknown as { __nivas?: unknown }).__nivas, undefined, { timeout: 30_000 });
  await page.waitForSelector('canvas, [aria-label="Project sections"]', { timeout: 30_000 });
}

export type Store = { getState: () => any; setState: (s: any) => void }; // eslint-disable-line @typescript-eslint/no-explicit-any

export const state = <T>(page: Page, fn: string): Promise<T> =>
  page.evaluate((src) => {
    const w = window as unknown as { __nivas: { store: Store } };
    // eslint-disable-next-line no-new-func
    return new Function('s', `return (${src})(s)`)(w.__nivas.store.getState());
  }, fn) as Promise<T>;

export async function waitSaved(page: Page) {
  await expect(page.getByText(/All changes saved/)).toBeVisible({ timeout: 20_000 });
}

export async function setNumber(page: Page, label: string, value: string) {
  const f = page.getByRole('textbox', { name: label, exact: true }).first();
  await f.click();
  await f.fill(value);
  await f.press('Enter');
}
