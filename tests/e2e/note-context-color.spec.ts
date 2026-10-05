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

test('color flyout supports keyboard navigation and flips left without moving the parent menu', async ({ page }) => {
  const card = await createNote(page);
  await page.setViewportSize({ width: 800, height: 320 });
  const menu = page.getByRole('menu', { name: 'Note actions' });
  const submenu = page.getByRole('menu', { name: 'Note color', exact: true });
  const trigger = menu.getByRole('menuitem', { name: 'Change color' });
  await card.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: innerWidth - 1, clientY: innerHeight - 1,
  })));
  const originalBounds = await menu.boundingBox();
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await page.keyboard.press('ArrowRight');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(submenu.getByRole('menuitemradio', { name: 'Paper' })).toBeFocused();
  expect(await menu.boundingBox()).toEqual(originalBounds);
  const flyoutBounds = await submenu.boundingBox();
  expect(flyoutBounds!.x + flyoutBounds!.width).toBeLessThan(originalBounds!.x);
  await expect(menu).toBeInViewport({ ratio: 1 });
  await expect(submenu).toBeInViewport({ ratio: 1 });
  expect((await new AxeBuilder({ page }).include('[role="menu"]').analyze()).violations).toEqual([]);
  await page.keyboard.press('End');
  await expect(submenu.getByRole('menuitemradio', { name: 'Peach' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(submenu.getByRole('menuitemradio', { name: 'Paper' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(submenu.getByRole('menuitemradio', { name: 'Peach' })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(submenu.getByRole('menuitemradio', { name: 'Butter' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).not.toBeVisible();
  await expect(submenu).not.toBeVisible();
  await expect(card).toHaveCSS('background-color', 'rgb(248, 235, 173)');
  await expect(card).toBeFocused();
  await card.click({ button: 'right' });
  await trigger.click();
  await expect(submenu.getByRole('menuitemradio', { name: 'Paper' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(submenu).not.toBeVisible();
  await expect(menu).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(submenu).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(submenu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Open', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(card).toBeFocused();
  await card.click({ button: 'right' });
  await expect(submenu).toHaveCount(0);
  await trigger.click();
  await page.mouse.click(8, 8);
  await expect(menu).not.toBeVisible();
  await expect(submenu).not.toBeVisible();
  await expect(card).toHaveCSS('background-color', 'rgb(248, 235, 173)');
});

test('hover opens a right-hand flyout and allows crossing the gap without shifting actions', async ({ page }) => {
  const card = await createNote(page);
  const menu = page.getByRole('menu', { name: 'Note actions' });
  const submenu = page.getByRole('menu', { name: 'Note color', exact: true });
  const trigger = menu.getByRole('menuitem', { name: 'Change color' });
  await card.click({ button: 'right' });
  const originalBounds = await menu.boundingBox();
  const openBounds = await menu.getByRole('menuitem', { name: 'Open', exact: true }).boundingBox();
  await trigger.hover();
  await expect(submenu).toBeVisible();
  expect(await menu.boundingBox()).toEqual(originalBounds);
  expect(await menu.getByRole('menuitem', { name: 'Open', exact: true }).boundingBox()).toEqual(openBounds);
  expect((await submenu.boundingBox())!.x).toBeGreaterThan(originalBounds!.x + originalBounds!.width);
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused();
  const from = await trigger.boundingBox();
  const to = await submenu.getByRole('menuitemradio', { name: 'Mint' }).boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 5 });
  await expect(submenu).toBeVisible();
  await page.waitForTimeout(250); // Still open after the pointer-leave grace period.
  await expect(submenu).toBeVisible();
  await page.getByRole('heading', { name: 'Your notes' }).hover();
  await expect(submenu).not.toBeVisible();
  await expect(menu).toBeVisible();
  expect(await menu.boundingBox()).toEqual(originalBounds);
  await trigger.hover();
  await submenu.getByRole('menuitemradio', { name: 'Mint' }).click();
  await expect(menu).not.toBeVisible();
  await expect(card).toHaveCSS('background-color', 'rgb(219, 235, 225)');
});

for (const key of ['Tab', 'Shift+Tab']) {
  test(`${key} leaves the entire context menu instead of traversing its items`, async ({ page }) => {
    const card = await createNote(page);
    const menu = page.getByRole('menu', { name: 'Note actions' });
    await card.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Change color' }).click();
    await page.keyboard.press(key);
    await expect(menu).not.toBeVisible();
    await expect(page.getByRole('menu', { name: 'Note color', exact: true })).not.toBeVisible();
    await expect(page.getByRole('button', { name: key === 'Tab' ? 'Pin note: Color target' : 'New note', exact: true })).toBeFocused();
  });
}

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
