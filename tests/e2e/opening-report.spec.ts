import { test, expect } from '../fixtures/isolated-test';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const title = 'PRIVATE diagnostic fixture title';
const source = 'PRIVATE diagnostic fixture body\n\n' + '- Private row\n'.repeat(60);
async function setup(page: Page) {
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0;
    window.cancelIdleCallback = () => {};
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
  });
  const id = crypto.randomUUID();
  expect((await page.request.put(`/api/notes/${id}`, { multipart: { payload: JSON.stringify({
    id, title, body: source, color: 'blue', pinned: false, expectedVersion: 0, retainedImageIds: [], retainedAudioIds: [],
  }) } })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Synced', exact: true }).waitFor();
  return id;
}
async function showReport(page: Page) {
  await page.getByRole('button', { name: 'Synced', exact: true }).click();
  await page.getByRole('button', { name: 'Opening diagnostics', exact: true }).click();
}
const report = async (page: Page) => JSON.parse(await page.getByRole('textbox', { name: 'Opening report', exact: true }).inputValue());
const back = async (page: Page) => page.getByRole('dialog', { name: 'Opening diagnostics', exact: true }).getByRole('button', { name: 'Back', exact: true }).click();
async function open(page: Page) {
  await page.getByRole('button', { name: `Open note: ${title}`, exact: true }).tap();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toBeVisible();
  // Allow the observer's paint-opportunity frame, without timing thresholds.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function close(page: Page) {
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note', exact: true })).not.toBeVisible();
}

test('opening diagnostics are off by default and do not collect ordinary note sessions', async ({ page }) => {
  await setup(page);
  await open(page); await close(page);
  await showReport(page);
  expect(await report(page)).toMatchObject({ enabled: false, samples: [] });
  await expect(page.getByRole('checkbox', { name: 'Enable opening timings' })).not.toBeChecked();
});

test('opt-in report measures actual cold/warm reuse without private data and supports clipboard denial', async ({ page }) => {
  const id = await setup(page);
  await showReport(page);
  await page.getByRole('checkbox', { name: 'Enable opening timings' }).check();
  await back(page);
  await open(page); await close(page);
  await open(page); await close(page);
  await showReport(page);
  const result = await report(page);
  expect(result.report).toBe('Shelf opening diagnostics v3');
  expect(result.browserTimingTypes.every((type: string) => ['event', 'longtask', 'long-animation-frame'].includes(type))).toBe(true);
  expect(result.build).toMatch(/^index-[\w-]+\.js$/);
  expect(result.samples).toHaveLength(2);
  expect(result.samples[0]).toMatchObject({ reusedReadyDialog: false, outcome: 'ready', retainedOnClose: true, closeAttempt: { dirty: false, interacted: false, ready: true } });
  expect(result.samples[1]).toMatchObject({ existingReadyDialog: true, previousRetainedDialogPresent: true, reusedReadyDialog: true, outcome: 'ready', retainedOnClose: true });
  for (const sample of result.samples) {
    expect(sample.requestMs).toBeGreaterThanOrEqual(0);
    expect(sample.pointerUpMs).toBeGreaterThanOrEqual(0);
    expect(sample.pointerUpDispatchMs).toBeGreaterThanOrEqual(0);
    expect(sample.releaseToRequestMs).toBeGreaterThanOrEqual(0);
    expect(Math.abs(sample.requestMs - sample.pointerUpMs - sample.releaseToRequestMs)).toBeLessThanOrEqual(1);
    expect(Array.isArray(sample.browserTimings)).toBe(true);
    for (const timing of sample.browserTimings) {
      expect(['pointerdown', 'pointerup', 'click', 'longtask', 'long-animation-frame']).toContain(timing.kind);
      expect(timing.durationMs).toBeGreaterThanOrEqual(0);
      expect(Object.keys(timing).every(key => ['kind', 'startMs', 'durationMs', 'inputDelayMs', 'processingMs', 'presentationMs', 'blockingMs', 'renderingMs', 'styleAndLayoutMs'].includes(key))).toBe(true);
    }
    expect(sample.modalReturnMs).toBeGreaterThanOrEqual(sample.dialogEffectMs);
    expect(sample.editableFrameMs).toBeGreaterThanOrEqual(sample.readableFrameMs);
    expect(sample.nextFrameMs).toBeGreaterThanOrEqual(sample.editableFrameMs);
  }
  const text = JSON.stringify(result);
  for (const privateValue of [id, title, 'PRIVATE', 'http://', 'https://']) expect(text).not.toContain(privateValue);
  await page.getByRole('button', { name: 'Copy report', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Select and copy the report below.');
  await expect(page.getByRole('textbox', { name: 'Opening report', exact: true })).toBeFocused();
  await page.getByRole('checkbox', { name: 'Enable opening timings' }).uncheck();
  expect(await report(page)).toMatchObject({ enabled: false, samples: [] });
  await back(page);
  const note = (await (await page.request.get('/api/notes')).json()).notes[0];
  expect(note.body).toBe(source); expect(note.version).toBe(1);
});

test('later unrelated browser activity cannot evict captured opening evidence', async ({ page }) => {
  await page.addInitScript(() => {
    type Entry = { entryType: string; name: string; startTime: number; duration: number };
    const state = window as unknown as { emitTiming: (entry: Entry) => void };
    Object.defineProperty(window, 'PerformanceObserver', { configurable: true, value: class {
      static supportedEntryTypes = ['longtask'];
      constructor(private callback: (list: { getEntries: () => Entry[] }) => void) {}
      observe() { state.emitTiming = entry => this.callback({ getEntries: () => [entry] }); }
      disconnect() { state.emitTiming = () => {}; }
    } });
    document.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('[data-note-id]')) {
        const startTime = event.timeStamp;
        setTimeout(() => state.emitTiming({ entryType: 'longtask', name: 'self', startTime, duration: 71 }), 0);
      }
    }, true);
  });
  await setup(page); await showReport(page);
  await page.getByRole('checkbox', { name: 'Enable opening timings' }).check();
  await back(page); await open(page); await close(page);
  await page.evaluate(() => {
    const state = window as unknown as { emitTiming: (entry: { entryType: string; name: string; startTime: number; duration: number }) => void };
    for (let i = 0; i < 200; i++) state.emitTiming({ entryType: 'longtask', name: 'self', startTime: performance.now() + 1000 + i * 100, duration: 99 });
  });
  await showReport(page);
  const result = await report(page);
  expect(result.samples[0].browserTimings).toContainEqual(expect.objectContaining({ kind: 'longtask', durationMs: 71 }));
  expect(result.samples[0].browserTimings.every((entry: { durationMs: number }) => entry.durationMs !== 99)).toBe(true);
});

test('report still measures release timing when browser PerformanceObserver is unavailable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'PerformanceObserver', { configurable: true, value: undefined }); });
  await setup(page);
  await showReport(page);
  await page.getByRole('checkbox', { name: 'Enable opening timings' }).check();
  await back(page);
  await open(page); await close(page);
  await showReport(page);
  const result = await report(page);
  expect(result.browserTimingTypes).toEqual([]);
  expect(result.samples[0].releaseToRequestMs).toBeGreaterThanOrEqual(0);
  expect(result.samples[0].browserTimings).toEqual([]);
});

test('report distinguishes an edited discarded session and bounds retained samples', async ({ page }) => {
  await setup(page);
  await showReport(page);
  await page.getByRole('checkbox', { name: 'Enable opening timings' }).check();
  await back(page);
  await open(page);
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('PRIVATE replacement');
  await close(page);
  await page.getByRole('button', { name: 'Synced', exact: true }).waitFor();
  await open(page); await close(page);
  await showReport(page);
  const edited = await report(page);
  expect(edited.samples[0]).toMatchObject({ retainedOnClose: false, closeAttempt: { dirty: true, interacted: true, ready: true } });
  expect(edited.samples[1].reusedReadyDialog).toBe(false);
  await back(page);
  for (let i = 0; i < 5; i++) { await open(page); await close(page); }
  await showReport(page);
  const bounded = await report(page);
  expect(bounded.samples).toHaveLength(6);
  expect(bounded.samples.at(-1).opening).toBe(7);
  await page.getByRole('button', { name: 'Clear report', exact: true }).click();
  expect(await report(page)).toMatchObject({ enabled: true, samples: [] });
});
