import { test, expect } from '../fixtures/isolated-test';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
const noteTitle = 'PRIVATE CPU fixture';
async function setup(page: Page) {
  await page.addInitScript(() => { window.requestIdleCallback = () => 0; window.cancelIdleCallback = () => {}; });
  const id = crypto.randomUUID();
  expect((await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({ id, title: noteTitle, body: 'ab\n', color: 'blue', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [] }) } })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Synced', exact: true }).waitFor();
}
async function showReport(page: Page) {
  await page.getByRole('button', { name: 'Synced', exact: true }).click();
  await page.getByRole('button', { name: 'Opening diagnostics', exact: true }).click();
}
const report = async (page: Page) => JSON.parse(await page.getByRole('textbox', { name: 'Opening report', exact: true }).inputValue());
async function enableCpu(page: Page) {
  await showReport(page);
  await page.getByRole('button', { name: 'Load CPU profiling mode', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Opening diagnostics', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Enable CPU sampling and timings' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Enable CPU sampling and timings' }).check();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
}
async function openClose(page: Page) {
  await page.getByRole('button', { name: `Open note: ${noteTitle}`, exact: true }).tap();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note', exact: true })).not.toBeVisible();
}

test('profiling policy is confined to the read-only worker-bypass page', async ({ page }) => {
  for (const path of ['/', '/index.html', '/?openingProfile=1', '/api/auth/status']) {
    expect((await page.request.get(path)).headers()['document-policy']).toBeUndefined();
  }
  const response = await page.request.get('/share-target');
  expect(response.headers()['document-policy']).toBe('js-profiling');
  expect(response.headers()['cache-control']).toBe('no-store');
});

test('Chrome can run the real API, with no sampling until explicit opt-in', async ({ page, browserName }) => {
  await setup(page); await showReport(page);
  expect((await report(page)).cpu).toMatchObject({ mode: false, enabled: false, available: false });
  await page.getByRole('button', { name: 'Load CPU profiling mode', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Opening diagnostics', exact: true })).toBeVisible();
  const initial = await report(page);
  expect(initial.cpu.enabled).toBe(false); expect(initial.enabled).toBe(false);
  const checkbox = page.getByRole('checkbox', { name: 'Enable CPU sampling and timings' });
  if (browserName !== 'chromium' && !initial.cpu.available) { await expect(checkbox).toBeDisabled(); return; }
  expect(initial.cpu.available).toBe(true);
  await checkbox.check();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await openClose(page); await showReport(page);
  await page.getByRole('button', { name: 'Copy report', exact: true }).click();
  await expect.poll(async () => (await report(page)).samples[0].cpu.status).toBe('ready');
  const result = await report(page);
  expect(result.samples[0].cpu.sampleCount).toBeLessThanOrEqual(256);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|https?:\/\//);
  await page.getByRole('checkbox', { name: 'Enable opening timings' }).uncheck();
  expect(await report(page)).toMatchObject({ enabled: false, cpu: { enabled: false }, samples: [] });
  await expect(checkbox).not.toBeChecked();
  await page.getByRole('button', { name: 'Exit CPU profiling mode', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('CPU report redacts raw trace fields, preserves note source and stops each capture once', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { cpuTest: { started: number; stopped: number } };
    state.cpuTest = { started: 0, stopped: 0 };
    Object.defineProperty(window, 'Profiler', { configurable: true, value: class {
      sampleInterval = 10;
      constructor() { state.cpuTest.started++; }
      async stop() {
        state.cpuTest.stopped++;
        return {
          resources: [document.querySelector<HTMLScriptElement>('script[type="module"][src]')!.src, 'https://PRIVATE.invalid/token'],
          frames: [{ resourceId: 0, line: 1, column: 120, name: 'PRIVATE function' }, { resourceId: 1, line: 7, column: 10, name: 'PRIVATE body' }],
          stacks: [{ frameId: 0 }, { frameId: 1 }], samples: [{ stackId: 0 }, { stackId: 1 }],
          note: 'PRIVATE title', credentials: 'PRIVATE secret',
        };
      }
    } });
  });
  await setup(page); await enableCpu(page);
  await openClose(page); await openClose(page);
  await showReport(page);
  await page.getByRole('button', { name: 'Copy report', exact: true }).click();
  await expect.poll(async () => (await report(page)).samples.at(-1).cpu.status).toBe('ready');
  const result = await report(page);
  for (const sample of result.samples) {
    expect(sample.cpu).toMatchObject({ status: 'ready', sampleCount: 2, appSamples: 1, unattributedSamples: 1, locations: [{ line: 1, column: 120, topAppSamples: 1, inclusiveSamples: 1 }] });
  }
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|https?:\/\//);
  expect(await page.evaluate(() => (window as unknown as { cpuTest: unknown }).cpuTest)).toEqual({ started: 2, stopped: 2 });
  await page.getByRole('checkbox', { name: 'Enable CPU sampling and timings' }).uncheck();
  expect((await report(page)).samples.every((sample: { cpu?: unknown }) => sample.cpu === undefined)).toBe(true);
  const saved = (await (await page.request.get('/api/notes')).json()).notes[0];
  expect(saved.body).toBe('ab\n'); expect(saved.version).toBe(1);
});
