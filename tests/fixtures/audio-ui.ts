import type { Locator, Page } from '@playwright/test';
import { wavAudio } from './audio';

export const audioFile = (name = 'A sound.wav', seconds = 2) => ({ name, mimeType: 'audio/wav', buffer: wavAudio(seconds) });
export const editorFor = (page: Page) => page.getByRole('dialog', { name: /^(Add|Edit) note$/ });
export async function upload(editor: Locator, names: string[]) {
  await editor.getByRole('button', { name: 'Add audio', exact: true }).click();
  await editor.locator('input[type=file][accept^="audio/"]').setInputFiles(names.map(name => audioFile(name)));
}
export async function openCard(page: Page, title: string) {
  // Open the card away from its independently interactive player controls.
  await page.getByRole('button', { name: `Open note: ${title}`, exact: true }).click({ position: { x: 12, y: 8 } });
}
export async function holdFirstPut(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const arrived = new Promise<void>(resolve => { started = resolve; });
  let first = true;
  await page.route('**/api/notes/*', async route => {
    if (route.request().method() === 'PUT' && first) { first = false; started(); await gate; }
    await route.continue();
  });
  return { arrived, release };
}
