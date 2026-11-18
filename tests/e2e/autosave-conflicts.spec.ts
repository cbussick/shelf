import { test, expect } from '../fixtures/isolated-test';

test('an open editor keeps remote changes and continues autosaving its conflict copy', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Two devices');
  const body = page.getByRole('textbox', { name: 'Note', exact: true });
  await body.fill('Original text.');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open note: Two devices', exact: true }).click();
  await expect(body).toHaveText('Original text.');
  const original = (await (await request.get('/api/notes')).json()).notes[0];
  const response = await request.put(`/api/notes/${original.id}`, { multipart: { payload: JSON.stringify({ id: original.id, title: original.title, body: 'Written on the other device.', color: original.color, pinned: original.pinned, expectedVersion: original.version, retainedImageIds: [], retainedAudioIds: [], newImageIds: [], newAudio: [], imageRotations: [] }) } });
  expect(response.ok()).toBe(true);
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/notes') && response.request().method() === 'GET');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await refreshed;
  // The editor retains its own document and base version, not the refreshed board's.
  await expect(body).toHaveText('Original text.');
  await body.fill('My first conflicting edit.');
  await expect(page.getByTestId('note-save-status')).toHaveText('Saved');
  await expect.poll(async () => (await (await request.get('/api/notes')).json()).notes.length).toBe(2);
  await body.fill('My next edit stays in the same conflict copy.');
  await expect(page.getByTestId('note-save-status')).toHaveText('Saved');
  const notes = (await (await request.get('/api/notes')).json()).notes;
  expect(notes.find((note: { id: string }) => note.id === original.id).body).toBe('Written on the other device.');
  expect(notes.find((note: { id: string }) => note.id !== original.id).body).toContain('My next edit stays in the same conflict copy.');
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/notes')).json()).notes.length).toBe(1);
  expect((await (await request.get('/api/notes')).json()).notes[0].id).toBe(original.id);
});
