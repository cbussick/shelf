import AxeBuilder from '@axe-core/playwright';
import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures/isolated-test';

async function createNote(page: Page, withImage = false) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Color target');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Keep this text');
  if (withImage) {
    await page.getByRole('button', { name: 'Pin note' }).click();
    await page.locator('dialog input[type=file]').setInputFiles('tests/fixtures/image.jpg');
  }
  await page.getByRole('button', { name: 'Close note' }).click();
  const card = page.getByRole('button', { name: 'Open note: Color target' });
  await expect(card).toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
  return card;
}

test('changes every note color without opening it or altering its content, images, pin, or order', async ({ page, request }) => {
  const card = await createNote(page, true);
  const original = (await (await request.get('/api/notes')).json()).notes[0];
  const menu = page.getByRole('menu', { name: 'Note actions' });
  const options = [
    ['Paper', 'rgb(255, 255, 255)'],
    ['Butter', 'rgb(248, 235, 173)'],
    ['Mint', 'rgb(219, 235, 225)'],
    ['Lilac', 'rgb(234, 228, 243)'],
    ['Peach', 'rgb(246, 223, 210)'],
  ];
  let selected = 'Paper';
  for (const [name, background] of options) {
    await card.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Change color' }).click();
    await expect(menu.getByRole('menuitemradio')).toHaveText(options.map(([label]) => label === selected ? `${label}✓` : label));
    await expect(menu.getByRole('menuitemradio', { name: selected, exact: true })).toHaveAttribute('aria-checked', 'true');
    await menu.getByRole('menuitemradio', { name, exact: true }).click();
    await expect(menu).not.toBeVisible();
    await expect(card).toBeFocused();
    await expect(card).toHaveCSS('background-color', background);
    await expect(page.getByRole('dialog', { name: 'Edit note' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
    const saved = (await (await request.get('/api/notes')).json()).notes[0];
    expect(saved).toMatchObject({
      id: original.id, title: original.title, body: original.body,
      images: original.images, pinned: true, position: original.position, createdAt: original.createdAt,
      color: name.toLowerCase(),
    });
    if (name === 'Paper') expect(saved.version).toBe(original.version);
    selected = name;
  }
  await page.reload();
  await expect(card).toHaveCSS('background-color', 'rgb(246, 223, 210)');
  await expect(card.locator('img')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Pinned notes' }).getByRole('button', { name: 'Open note: Color target' })).toBeVisible();
});

test('color choices support keyboard use, dismissal, and viewport clamping', async ({ page }) => {
  const card = await createNote(page);
  await page.setViewportSize({ width: 800, height: 320 });
  const menu = page.getByRole('menu', { name: 'Note actions' });
  await card.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: innerWidth - 1, clientY: innerHeight - 1,
  })));
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Change color' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitem', { name: 'Change color' })).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeInViewport({ ratio: 1 });
  expect((await new AxeBuilder({ page }).include('[role="menu"]').analyze()).violations).toEqual([]);
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Paper' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(card).toHaveCSS('background-color', 'rgb(248, 235, 173)');
  await expect(card).toBeFocused();
  await card.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Change color' }).click();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(card).toBeFocused();
  await card.click({ button: 'right' });
  await expect(menu.getByRole('menuitemradio')).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Change color' }).click();
  await page.getByRole('heading', { name: 'Your notes' }).click();
  await expect(menu).not.toBeVisible();
  await expect(card).toHaveCSS('background-color', 'rgb(248, 235, 173)');
});

test('reports a failed color save and allows another attempt', async ({ page }) => {
  const card = await createNote(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as unknown as { restoreWrites: () => void }).restoreWrites = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'notes') throw new DOMException('Storage unavailable', 'UnknownError');
      return put.apply(this, args);
    };
  });
  const menu = page.getByRole('menu', { name: 'Note actions' });
  await card.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Change color' }).click();
  await menu.getByRole('menuitemradio', { name: 'Mint' }).click();
  await expect(page.getByRole('status')).toHaveText('Could not change note color. Try again.');
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.evaluate(() => (window as unknown as { restoreWrites: () => void }).restoreWrites());
  await card.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Change color' }).click();
  await menu.getByRole('menuitemradio', { name: 'Mint' }).click();
  await expect(card).toHaveCSS('background-color', 'rgb(219, 235, 225)');
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
});

test('saves context-menu color changes offline and syncs after reconnecting', async ({ page, context, request }) => {
  const card = await createNote(page);
  await context.setOffline(true);
  await card.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Note actions' });
  await menu.getByRole('menuitem', { name: 'Change color' }).click();
  await menu.getByRole('menuitemradio', { name: 'Mint' }).click();
  await expect(card).toHaveCSS('background-color', 'rgb(219, 235, 225)');
  await expect(page.getByRole('button', { name: 'Saved on device' })).toBeVisible();
  expect((await (await request.get('/api/notes')).json()).notes[0].color).toBe('paper');
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
  expect((await (await request.get('/api/notes')).json()).notes[0].color).toBe('mint');
  await page.reload();
  await expect(card).toHaveCSS('background-color', 'rgb(219, 235, 225)');
});
