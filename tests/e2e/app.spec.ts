import { test, expect } from '../fixtures/isolated-test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

test('creates, edits, pins, searches, and deletes a note', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Shelf — Your notes');
  await expect(page.getByRole('link', { name: 'Shelf home' })).toContainText('Shelf');
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  await page.keyboard.press('n');
  await page.getByRole('textbox', { name: 'Title' }).fill('Keep this close');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('A private thought.');
  await page.getByRole('button', { name: 'Note color' }).click();
  await page.getByRole('radio', { name: 'Mint' }).click();
  const editorPin = page.getByRole('button', { name: 'Pin note' });
  await expect(editorPin.locator('svg path').first()).not.toHaveAttribute('fill', 'currentColor');
  await editorPin.click();
  await expect(page.getByRole('button', { name: 'Unpin note' }).locator('svg path').first()).toHaveAttribute('fill', 'currentColor');
  await expect(page.getByRole('button', { name: 'Save note' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close note' }).click();
  const card = page.getByRole('button', { name: 'Open note: Keep this close' });
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('background-color', 'rgb(219, 235, 225)');
  await expect(card).toHaveCSS('border-style', 'solid');
  await expect(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Open note: Keep this close' }).click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('An edited private thought.');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
  await page.getByRole('searchbox').fill('edited private');
  await expect(page.getByText('An edited private thought.')).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'Open note: Keep this close' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open note: Image note' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Open note: Image note' }).click();
  await page.getByRole('button', { name: 'Delete note' }).click();
  await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note' }).click();
  await expect(page.getByRole('button', { name: 'Open note: Image note' })).not.toBeVisible();
});

test('uses Shelf browser storage and install metadata', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map(database => database.name));
  expect(databases).toContain('shelf');
  expect(databases).not.toContain('jot');
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Shelf', short_name: 'Shelf', start_url: '/', scope: '/' });
});

test('note editor uses available desktop space and stays usable on small screens', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('dialog', { name: 'Add note' });
  const body = editor.getByRole('textbox', { name: 'Note', exact: true });
  const desktop = await editor.boundingBox();
  const desktopBody = await body.boundingBox();
  expect(desktop?.width).toBeGreaterThanOrEqual(900);
  expect(desktop?.height).toBeGreaterThanOrEqual(750);
  expect(desktopBody?.height).toBeGreaterThanOrEqual(550);

  await page.setViewportSize({ width: 800, height: 500 });
  const compact = await editor.boundingBox();
  expect(compact?.width).toBeLessThan(800);
  expect(compact?.height).toBeLessThanOrEqual(450);
  await expect(editor.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await editor.boundingBox();
  expect(mobile?.width).toBe(390);
  expect(mobile?.height).toBe(844);
  await expect(body).toBeInViewport();
  await expect(editor.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
});

test('focuses the body when creating a note', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('dialog', { name: 'Add note' });
  const body = editor.getByRole('textbox', { name: 'Note', exact: true });
  await expect(body).toBeFocused();
  await page.keyboard.type('Start here');
  await expect(body).toHaveValue('Start here');
});

test('note colors stay in a palette popover that can be dismissed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('dialog', { name: 'Add note' });
  const palette = editor.getByRole('button', { name: 'Note color' });
  await expect(palette).toHaveAttribute('aria-expanded', 'false');
  await expect(editor.getByRole('radio')).toHaveCount(0);
  await palette.click();
  await expect(palette).toHaveAttribute('aria-expanded', 'true');
  await expect(editor.getByRole('radio', { name: 'Paper' })).toBeChecked();
  await editor.getByRole('radio', { name: 'Paper' }).click();
  await expect(editor.getByRole('radio')).toHaveCount(0);
  await palette.click();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(palette).toBeFocused();
  await expect(editor.getByRole('radio')).toHaveCount(0);
  await palette.click();
  await editor.getByRole('textbox', { name: 'Title' }).click();
  await expect(editor.getByRole('radio')).toHaveCount(0);
  await palette.click();
  await editor.getByRole('radio', { name: 'Peach' }).click();
  await expect(editor).toHaveCSS('background-color', 'rgb(246, 223, 210)');
  await expect(editor.getByRole('radio')).toHaveCount(0);
  await palette.click();
  const paper = editor.getByRole('radio', { name: 'Paper' }).locator('..');
  await expect(paper).toHaveCSS('border-color', 'rgb(102, 120, 107)');
  await expect(paper).toHaveCSS('border-width', '2px');
  await palette.click();
  await editor.getByRole('textbox', { name: 'Title' }).fill('Palette note');
  await editor.getByRole('button', { name: 'Close note' }).click();
  const card = page.getByRole('button', { name: 'Open note: Palette note' });
  await expect(card).toHaveCSS('background-color', 'rgb(246, 223, 210)');
  await card.click();
  await page.getByRole('dialog', { name: 'Edit note' }).getByRole('button', { name: 'Delete note' }).click();
  await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note' }).click();
  await expect(card).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
});

test('overview shortcuts search, create, and confirm deletion only for a focused note', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox');
  await expect(page.locator('search kbd')).toHaveText('F');
  await page.keyboard.press('f');
  await expect(search).toBeFocused();
  await page.keyboard.type('n/d');
  await expect(search).toHaveValue('n/d');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await search.fill('');
  await search.blur();
  await page.keyboard.press('/');
  await expect(search).not.toBeFocused();

  await page.keyboard.press('n');
  const add = page.getByRole('dialog', { name: 'Add note' });
  await expect(add).toBeVisible();
  await add.getByRole('textbox', { name: 'Title' }).fill('Shortcut target');
  await add.getByRole('textbox', { name: 'Note', exact: true }).focus();
  await page.keyboard.type('find');
  await expect(search).not.toBeFocused();
  await expect(add.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('find');
  await add.getByRole('button', { name: 'Close note' }).click();

  const card = page.getByRole('button', { name: 'Open note: Shortcut target' });
  await expect(card).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.getByRole('dialog', { name: 'Delete this note?' })).not.toBeVisible();
  await card.focus();
  await page.keyboard.press('d');
  const confirmation = page.getByRole('dialog', { name: 'Delete this note?' });
  await expect(confirmation).toBeVisible();
  await page.keyboard.press('n');
  await page.keyboard.press('f');
  await expect(page.getByRole('dialog', { name: 'Add note' })).toHaveCount(0);
  await expect(search).not.toBeFocused();
  await confirmation.getByRole('button', { name: 'Keep note' }).click();
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press('d');
  await confirmation.getByRole('button', { name: 'Delete note' }).click();
  await expect(card).not.toBeVisible();
});

test('shows created and updated times only inside an existing note', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add note' });
  await expect(addDialog.locator('time')).toHaveCount(0);
  await addDialog.getByRole('textbox', { name: 'Title' }).fill('Timestamp placement');
  await addDialog.getByRole('button', { name: 'Close note' }).click();

  const card = page.getByRole('button', { name: 'Open note: Timestamp placement' });
  await expect(card).toBeVisible();
  await expect(card.locator('time')).toHaveCount(0);
  await card.click({ position: { x: 16, y: 20 } });
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  const timestamps = editor.locator('header time');
  await expect(timestamps).toHaveCount(2);
  await expect(editor.locator('header')).toContainText('Created');
  await expect(editor.locator('header')).toContainText('Updated');
  const created = await timestamps.nth(0).getAttribute('datetime');
  const updated = await timestamps.nth(1).getAttribute('datetime');
  expect(created).toBeTruthy();
  expect(updated).toBeTruthy();
  expect(await timestamps.nth(0).textContent()).toBeTruthy();
  expect(await timestamps.nth(1).textContent()).toBeTruthy();
  const actions = await editor.getByRole('button', { name: 'Close note' }).boundingBox();
  const metadata = await editor.locator('header time').first().boundingBox();
  expect(metadata!.x + metadata!.width).toBeLessThanOrEqual(actions!.x);
  await editor.getByRole('button', { name: 'Close note' }).click();
  await expect(card.locator('time')).toHaveCount(0);
});

test('shows the simplified copy and gives sync its own dismissible dialog', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search your notes');
  await expect(page.getByRole('navigation', { name: 'Create a note' }).getByRole('button', { name: 'New note' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add an image' })).toBeVisible();
  await expect(page.getByText('All notes')).toHaveCount(0);
  await expect(page.getByText('Drag to reorder')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Synced' }).click();
  const syncDialog = page.getByRole('dialog', { name: 'Synced' });
  await expect(syncDialog).toBeVisible();
  await expect(syncDialog.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await syncDialog.getByRole('button', { name: 'Back' }).click();
  await expect(syncDialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Synced' }).click();
  await syncDialog.getByRole('button', { name: 'Sync now' }).click();
  await expect(syncDialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Synced' }).click();
  await page.keyboard.press('Escape');
  await expect(syncDialog).not.toBeVisible();
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Copy check');
  await page.getByRole('button', { name: 'Close note' }).click();
  await page.getByRole('button', { name: 'Open note: Copy check' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor).toBeVisible();
  await expect(editor.getByText('A little note')).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Pin note' })).toHaveText('');
  await editor.getByRole('button', { name: 'Delete note' }).click();
  await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note' }).click();
});

test('keeps the header and floating create action visible while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('/');
  await page.locator('#main').evaluate(main => { main.style.minHeight = '200vh'; });
  const header = page.locator('#root > header');
  const floating = page.getByRole('navigation', { name: 'Create a note' });
  await expect(floating.getByRole('button', { name: 'New note' })).toBeVisible();
  await expect(floating).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect(floating).toBeVisible();
  expect(await header.evaluate(element => element.getBoundingClientRect().top)).toBe(0);
  await floating.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('dialog', { name: 'Add note' })).toBeVisible();
});

test('uses two note columns on phones and three on tablets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/');
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill(`Layout note ${index}`);
    await page.getByRole('button', { name: 'Close note' }).click();
  }
  const board = page.getByRole('list', { name: 'Notes', exact: true });
  await expect(board.locator('li')).toHaveCount(3);
  await expect(board).toHaveCSS('--columns', '2');
  await expect(board).toHaveCSS('column-gap', '12px');
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(board).toHaveCSS('--columns', '3');
  await expect(board).toHaveCSS('column-gap', '16px');
});

test('keeps the mobile create action visible while the header sticks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/');
  await page.locator('#main').evaluate(main => { main.style.minHeight = '200vh'; });
  const floating = page.getByRole('navigation', { name: 'Create a note' });
  await expect(floating).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect(floating).toBeVisible();
  expect(await page.locator('#root > header').evaluate(element => element.getBoundingClientRect().top)).toBe(0);
});

test('pins from the board and shows pin controls on hover for both groups', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  await page.keyboard.press('n');
  await page.getByRole('textbox', { name: 'Title' }).fill('Board pin test');
  await page.getByRole('button', { name: 'Close note' }).click();

  const card = page.getByRole('button', { name: 'Open note: Board pin test' });
  const pin = page.getByRole('button', { name: 'Pin note: Board pin test' });
  await page.mouse.move(0, 0);
  await expect(pin).toHaveCSS('opacity', '0');
  await expect(pin.locator('svg path').first()).not.toHaveAttribute('fill', 'currentColor');
  await card.hover();
  await expect(pin).toHaveCSS('opacity', '1');
  await pin.hover();
  await expect(pin).toHaveCSS('background-color', 'rgb(230, 235, 232)');
  const cardBox = await card.boundingBox();
  const pinBox = await pin.boundingBox();
  expect(pinBox!.x).toBeGreaterThan(cardBox!.x + cardBox!.width / 2);
  expect(pinBox!.y).toBeLessThan(cardBox!.y + cardBox!.height / 2);

  await pin.click();
  const unpin = page.getByRole('button', { name: 'Unpin note: Board pin test' });
  await expect(unpin.locator('svg path').first()).toHaveAttribute('fill', 'currentColor');
  await page.getByRole('heading', { name: 'Pinned', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(unpin).toHaveCSS('opacity', '0');
  await card.hover();
  await expect(unpin).toHaveCSS('opacity', '1');
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await page.mouse.move(0, 0);
  await expect(unpin).toHaveCSS('opacity', '0');
  await card.hover();
  await expect(unpin).toHaveCSS('opacity', '1');
  await unpin.click();
  await page.getByRole('heading', { name: 'Your notes' }).click();
  await page.mouse.move(0, 0);
  await expect(pin).toHaveCSS('opacity', '0');
  await expect(pin.locator('svg path').first()).not.toHaveAttribute('fill', 'currentColor');
  await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
});

test.describe('touch note pins', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('hides board pins and lets a note be pinned after opening it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).tap();
    await page.getByRole('textbox', { name: 'Title' }).fill('Mobile pin test');
    await page.getByRole('button', { name: 'Close note' }).tap();

    const card = page.getByRole('button', { name: 'Open note: Mobile pin test' });
    const boardPin = page.getByRole('button', { name: 'Pin note: Mobile pin test', includeHidden: true });
    await expect(boardPin).toBeHidden();
    await card.tap();
    const editor = page.getByRole('dialog', { name: 'Edit note' });
    const editorPin = editor.getByRole('button', { name: 'Pin note' });
    await expect(editorPin).toBeVisible();
    await editorPin.tap();
    await expect(editor.getByRole('button', { name: 'Unpin note' })).toHaveAttribute('aria-pressed', 'true');
    await editor.getByRole('button', { name: 'Close note' }).tap();
    await expect(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unpin note: Mobile pin test', includeHidden: true })).toBeHidden();
  });
});

test('right-click note actions open, pin, and confirm deletion', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Context actions test');
  await page.getByRole('button', { name: 'Close note' }).click();
  const card = page.getByRole('button', { name: 'Open note: Context actions test' });
  const menu = page.getByRole('menu', { name: 'Note actions' });
  await card.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Delete', 'Pin', 'Change color', 'Open']);
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(card).toBeFocused();
  await card.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Open' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeVisible();
  await page.getByRole('button', { name: 'Close note' }).click();
  await card.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Pin' }).click();
  await expect(page.getByRole('list', { name: 'Pinned notes' }).getByRole('button', { name: 'Open note: Context actions test' })).toBeVisible();
  await card.click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Unpin' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete this note?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Keep note' }).click();
  await expect(card).toBeVisible();
  await card.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  await confirmation.getByRole('button', { name: 'Delete note' }).click();
  await expect(card).not.toBeVisible();
});

test('drags notes into a persistent order and supports keyboard reordering', async ({ page }) => {
  const suffix = crypto.randomUUID();
  const [one, two, three] = ['one', 'two', 'three'].map(label => `Order ${label} ${suffix}`);
  await page.goto('/');
  for (const title of [one, two, three]) {
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill(title);
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByRole('button', { name: `Open note: ${title}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  }
  const board = page.getByRole('list', { name: 'Notes' });
  const titles = async () => (await board.getByRole('button', { name: /^Open note:/ }).allTextContents()).filter(text => text.includes(suffix));
  const order = async () => (await titles()).map(text => text.includes(one) ? 'one' : text.includes(two) ? 'two' : 'three');
  const first = page.getByRole('button', { name: `Open note: ${one}` });
  const third = page.getByRole('button', { name: `Open note: ${three}` });
  // Hover waits for the masonry/FLIP animation to settle before taking coordinates.
  await third.hover();
  await first.hover();
  const from = await first.boundingBox();
  const to = await third.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
  await expect(page.locator('body > button[aria-hidden="true"]')).toBeVisible();
  await expect.poll(order).toEqual(['one', 'three', 'two']);
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).not.toBeVisible();
  await expect.poll(order).toEqual(['one', 'three', 'two']);
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect.poll(order).toEqual(['one', 'three', 'two']);
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(order).toEqual(['three', 'one', 'two']);
});

test.describe('touch reordering', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('holds a note to drag it without opening the editor or a context menu', async ({ page }) => {
    await page.goto('/');
    for (const title of ['Touch one', 'Touch two']) {
      await page.getByRole('button', { name: 'New note' }).click();
      await page.getByRole('textbox', { name: 'Title' }).fill(title);
      await page.getByRole('button', { name: 'Close note' }).click();
    }
    const first = page.getByRole('button', { name: 'Open note: Touch one' });
    const second = page.getByRole('button', { name: 'Open note: Touch two' });
    // Some mobile browsers emit contextmenu during a long press; it must not interrupt dragging.
    await first.evaluate(card => card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })));
    await expect(page.getByRole('menu', { name: 'Note actions' })).toHaveCount(0);
    const from = await first.boundingBox();
    const to = await second.boundingBox();
    // Start below the pin control: on narrow cards it covers the card's center.
    const x = from!.x + 20;
    const y = from!.y + from!.height - 20;
    const destination = { x: to!.x + 20, y: to!.y + to!.height - 20 };
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(500);
    await expect(page.getByRole('menu', { name: 'Note actions' })).toHaveCount(0);
    for (let step = 1; step <= 5; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (destination.x - x) * step / 5, y: y + (destination.y - y) * step / 5 }] });
    }
    const board = page.getByRole('list', { name: 'Notes' });
    const order = async () => (await board.locator('[data-item-id]').allTextContents()).filter(text => text.includes('Touch ')).map(text => text.includes('Touch one') ? 'one' : 'two');
    await expect.poll(order).toEqual(['one', 'two']); // Preview before releasing.
    const floating = page.locator('body > button[aria-hidden="true"]');
    await expect(floating).toBeVisible();
    expect(Math.abs((await floating.boundingBox())!.x - from!.x)).toBeGreaterThan(10);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(order).toEqual(['one', 'two']);
    await expect(floating).toHaveCount(0);
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const held = await first.boundingBox();
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: held!.x + 20, y: held!.y + held!.height - 20 }] });
    await page.waitForTimeout(500);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await first.tap({ position: { x: 20, y: held!.height - 20 } });
    await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeVisible();
  });

  test('does not open note actions on a touchscreen with a desktop-sized viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Hybrid touch note');
    await page.getByRole('button', { name: 'Close note' }).click();
    await page.getByRole('button', { name: 'Open note: Hybrid touch note' }).click({ button: 'right' });
    await expect(page.getByRole('menu', { name: 'Note actions' })).toHaveCount(0);
  });
});

test('saves a new text note when closed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  await page.keyboard.press('n');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Saved by closing');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Open note: Saved by closing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
});

test('closes empty drafts without creating a note', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  const count = await page.getByRole('button', { name: 'Open note:', exact: false }).count();
  await page.keyboard.press('n');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('dialog', { name: 'Add note' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open note:', exact: false })).toHaveCount(count);
});

test('accepts an image and keeps the editor textarea fixed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add an image' }).click();
  await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');
  const textarea = page.getByRole('textbox', { name: 'Note', exact: true });
  const before = await textarea.boundingBox();
  await textarea.fill('Coffee first.');
  const after = await textarea.boundingBox();
  expect(after?.width).toBe(before?.width);
  expect(after?.height).toBe(before?.height);
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Open note: Coffee first.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
});

test('a note image fits without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add an image' }).click();
  await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');

  const editor = page.getByRole('dialog', { name: 'Add note' });
  const image = editor.getByRole('button', { name: 'View image 1' }).locator('img');
  await expect(image).toBeVisible();
  for (const width of [390, 598, 900]) {
    await page.setViewportSize({ width, height: 844 });
    const dimensions = await image.evaluate(element => {
      const container = element.closest('div')!.parentElement!;
      return {
        scrollWidth: container.scrollWidth,
        clientWidth: container.clientWidth,
        imageWidth: element.getBoundingClientRect().width,
        availableWidth: container.clientWidth - 60,
      };
    });
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
    expect(dimensions.imageWidth).toBeLessThanOrEqual(dimensions.availableWidth);
  }
});

test('image-only cards have no empty content section', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add an image' }).click();
  await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');
  await page.getByRole('button', { name: 'Close note' }).click();

  const card = page.getByRole('button', { name: 'Open note: image.jpg' });
  await expect(card.getByRole('img')).toBeVisible();
  await expect(card.locator('span')).toHaveCount(0);
  const dimensions = await card.evaluate(element => ({ card: element.getBoundingClientRect().height, image: element.querySelector('img')!.getBoundingClientRect().height }));
  expect(dimensions.card - dimensions.image).toBeLessThanOrEqual(2);

  await card.click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('A caption');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Open note: A caption' }).getByText('A caption')).toBeVisible();
});

test('pasting an image from the overview opens a new note with the image attached', async ({ page, context }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Search notes' });
  await search.focus();
  const textPasteAllowed = await search.evaluate(element => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'ordinary text');
    return element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });
  expect(textPasteAllowed).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Add note' })).not.toBeVisible();

  const jpeg = await readFile('tests/fixtures/image.jpg');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async bytes => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    try {
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } finally { URL.revokeObjectURL(url); }
  }, [...jpeg]);
  await search.press('ControlOrMeta+v');
  const editor = page.getByRole('dialog', { name: 'Add note' });
  await expect(editor.getByRole('button', { name: 'View image 1' })).toBeVisible();
  await expect(search).toHaveValue('');
  await editor.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Open note: image.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Open note: image.png' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note' }).getByRole('button', { name: 'View image 1' })).toBeVisible();
});

test('pastes clipboard images into new and existing notes without disrupting text paste', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const body = page.getByRole('textbox', { name: 'Note', exact: true });
  await body.focus();
  const textPasteAllowed = await body.evaluate(element => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'Pasted words');
    return element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });
  expect(textPasteAllowed).toBe(true);
  // Text-only paste remains the browser's normal behavior (a synthetic event does not insert text).
  await body.fill('A note with a picture');
  const jpeg = await readFile('tests/fixtures/image.jpg');
  const pasteImage = async (type = 'image/jpeg') => body.evaluate((element, { bytes, type }) => {
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([new Uint8Array(bytes)], 'clipboard.jpg', { type }));
    clipboard.setData('text/plain', 'Do not insert this caption');
    return element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  }, { bytes: [...jpeg], type });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async bytes => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    try {
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } finally { URL.revokeObjectURL(url); }
  }, [...jpeg]);
  await body.press('ControlOrMeta+v');
  await expect(body).toHaveValue('A note with a picture');
  await expect(page.getByRole('button', { name: 'View image 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Open note: A note with a picture' }).click();
  await body.focus();
  expect(await pasteImage()).toBe(false);
  await expect(page.getByRole('button', { name: 'View image 2' })).toBeVisible();
  for (let index = 3; index <= 6; index++) expect(await pasteImage()).toBe(false);
  await expect(page.getByText('2 more images')).toBeVisible();
  expect(await pasteImage()).toBe(false);
  await expect(page.getByRole('alert')).toContainText('Up to 6 images per note.');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Open note: A note with a picture' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note' }).getByText('2 more images')).toBeVisible();
});

test('closes notes from the footer or backdrop, and keeps destructive actions in the header', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('dialog', { name: 'Add note' });
  await expect(editor.getByText('Something worth keeping')).toHaveCount(0);
  await editor.getByRole('textbox', { name: 'Title' }).fill('Dismissible note');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Open note: Dismissible note' }).click();
  const saved = page.getByRole('dialog', { name: 'Edit note' });
  const deleteBox = await saved.getByRole('button', { name: 'Delete note' }).boundingBox();
  const pinBox = await saved.getByRole('button', { name: 'Pin note' }).boundingBox();
  expect(deleteBox!.x).toBeLessThan(pinBox!.x);
  await saved.getByRole('textbox', { name: 'Note', exact: true }).fill('Saved from backdrop');
  await page.mouse.click(5, 5);
  await expect(saved).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Open note: Dismissible note' }).click();
  await expect(saved.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Saved from backdrop');
  await saved.getByRole('button', { name: 'Delete note' }).click();
  await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note' }).click();
});

test('confirms removal of draft and saved images without removing them on cancel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Image removal test');
  await page.getByRole('button', { name: 'Attach an image' }).click();
  await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');
  const confirmation = page.getByRole('dialog', { name: 'Remove this image?' });
  const preview = page.getByRole('dialog', { name: 'Image preview' });
  const editor = page.getByRole('dialog', { name: 'Add note' });
  await expect(editor.getByRole('button', { name: 'Remove image 1' })).toHaveCount(0);
  await editor.getByRole('button', { name: 'View image 1' }).click();
  await preview.getByRole('button', { name: 'Remove image 1' }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Keep image' }).click();
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Remove image 1' }).click();
  await confirmation.getByRole('button', { name: 'Remove image' }).click();
  await expect(preview).not.toBeVisible();
  await expect(editor.getByRole('button', { name: 'View image 1' })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Attach an image' }).click();
  await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');
  await editor.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Open note: Image removal test', exact: true }).click();
  const saved = page.getByRole('dialog', { name: 'Edit note' });
  await expect(saved.getByRole('button', { name: 'Remove image 1' })).toHaveCount(0);
  await saved.getByRole('button', { name: 'View image 1' }).click();
  await preview.getByRole('button', { name: 'Remove image 1' }).click();
  await expect(confirmation).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Remove image 1' }).click();
  await confirmation.getByRole('button', { name: 'Remove image' }).click();
  await expect(preview).not.toBeVisible();
  await expect(saved.getByRole('button', { name: 'View image 1' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Open note: Image removal test', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View image 1' })).toHaveCount(0);
});

for (const width of [390, 1440]) {
  test(`centers lightbox chevron artwork at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('button', { name: 'Attach an image' }).click();
    await page.locator('input[type=file]').last().setInputFiles(Array(2).fill('tests/fixtures/image.jpg'));
    await page.getByRole('button', { name: 'View image 1' }).click();
    await page.evaluate(() => document.fonts.ready);
    const preview = page.getByRole('dialog', { name: 'Image preview' });
    for (const name of ['Previous image', 'Next image']) {
      const button = preview.getByRole('button', { name });
      await button.blur();
      await page.mouse.move(0, 0);
      const { data, info } = await sharp(await button.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const rows: number[] = [];
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const offset = (y * info.width + x) * info.channels;
          if (data[offset] > 200 && data[offset + 1] > 200 && data[offset + 2] > 200) rows.push(y);
        }
      }
      expect(rows.length).toBeGreaterThan(0);
      const artworkCenter = (Math.min(...rows) + Math.max(...rows) + 1) / 2;
      expect(Math.abs(artworkCenter - info.height / 2), `${name} vertical offset`).toBeLessThanOrEqual(1);
    }
  });

  test(`opens draft and saved images in a lightbox at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
    await page.keyboard.press('n');
    await page.getByRole('textbox', { name: 'Title' }).fill(`Photo preview ${width}`);
    const draft = page.getByRole('dialog', { name: 'Add note' });
    await expect(draft).toHaveCSS('border-width', '0px');
    await page.getByRole('button', { name: 'Note color' }).click();
    await page.getByRole('radio', { name: 'Mint' }).click();
    await expect(draft).toHaveCSS('background-color', 'rgb(219, 235, 225)');
    await expect(draft).toHaveCSS('border-width', '0px');
    await page.getByRole('button', { name: 'Attach an image' }).click();
    await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');
    const preview = page.getByRole('dialog', { name: 'Image preview' });
    await page.getByRole('button', { name: 'View image 1' }).click();
    await expect(preview.getByRole('img')).toBeVisible();
    await expect(preview).toHaveCSS('border-width', '0px');
    await expect(preview).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(preview).toHaveCSS('box-shadow', 'none');
    const closePreview = preview.getByRole('button', { name: 'Close image preview' });
    await page.keyboard.press('Tab');
    await expect(closePreview).toBeFocused();
    await expect(closePreview).toHaveCSS('outline-style', 'solid');
    await expect(closePreview).toHaveCSS('outline-width', '3px');
    const imageBox = await preview.getByRole('img').boundingBox();
    const removeBox = await preview.getByRole('button', { name: 'Remove image 1' }).boundingBox();
    expect(removeBox!.x).toBeGreaterThan(imageBox!.x + imageBox!.width / 2);
    expect(removeBox!.x + removeBox!.width).toBeLessThanOrEqual(imageBox!.x + imageBox!.width);
    expect(removeBox!.y).toBeLessThan(imageBox!.y + 16);
    const bounds = await preview.boundingBox();
    if (width === 390) expect(bounds?.width).toBe(width);
    else expect(bounds?.width).toBeGreaterThan(800);
    await page.keyboard.press('Escape');
    await expect(preview).not.toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(`Photo preview ${width}`);
    await page.getByRole('button', { name: 'Close note' }).click();
    await page.getByRole('button', { name: `Open note: Photo preview ${width}` }).click();
    const saved = page.getByRole('dialog', { name: 'Edit note' });
    await expect(saved).toHaveCSS('border-width', '0px');
    await expect(saved).toHaveCSS('background-color', 'rgb(219, 235, 225)');
    await page.getByRole('button', { name: 'View image 1' }).click();
    await expect(preview.getByRole('img')).toBeVisible();
    await preview.getByRole('button', { name: 'Close image preview' }).click();
    await expect(preview).not.toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeVisible();
  });
}

test('centers images and navigates and removes mixed gallery images', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Gallery note');
  await page.getByRole('button', { name: 'Attach an image' }).click();
  await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Open note: Gallery note', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  const bounds = await editor.boundingBox();
  const photo = editor.getByRole('button', { name: 'View image 1' });
  await expect.poll(async () => (await photo.boundingBox())!.width).toBeGreaterThan(420);
  const photoBounds = await photo.boundingBox();
  expect(Math.abs(photoBounds!.x + photoBounds!.width / 2 - (bounds!.x + bounds!.width / 2))).toBeLessThan(8);
  expect(photoBounds!.height).toBeGreaterThan(300);
  await page.getByRole('button', { name: 'Attach an image' }).click();
  await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');
  await expect(editor.getByRole('button', { name: /^Remove image/ })).toHaveCount(0);
  await editor.getByRole('button', { name: 'View image 1' }).click();
  const gallery = page.getByRole('dialog', { name: 'Image preview' });
  await expect(gallery.getByText('1 / 2')).toBeVisible();
  await gallery.getByRole('button', { name: 'Next image' }).click();
  await expect(gallery.getByText('2 / 2')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(gallery.getByText('1 / 2')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(gallery.getByText('2 / 2')).toBeVisible();
  await gallery.getByRole('button', { name: 'Remove image 2' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Remove this image?' });
  await confirmation.getByRole('button', { name: 'Keep image' }).click();
  await expect(gallery.getByText('2 / 2')).toBeVisible();
  await gallery.getByRole('button', { name: 'Remove image 2' }).click();
  await confirmation.getByRole('button', { name: 'Remove image' }).click();
  await expect(gallery).toBeVisible();
  await expect(gallery.getByRole('button', { name: 'Next image' })).toHaveCount(0);
  await gallery.getByRole('button', { name: 'Remove image 1' }).click();
  await confirmation.getByRole('button', { name: 'Remove image' }).click();
  await expect(gallery).not.toBeVisible();
  await expect(editor.getByRole('button', { name: 'View image 1' })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Open note: Gallery note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View image 1' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete note' }).click();
  await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note' }).click();
});

test('shows the same image mosaic on cards and in the editor', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  for (const count of [2, 3, 4, 5, 6]) {
    const title = `Mosaic ${count}`;
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill(title);
    await page.getByRole('button', { name: 'Attach an image' }).click();
    await page.locator('input[type=file]').last().setInputFiles(Array(count).fill('tests/fixtures/image.jpg'));
    const editor = page.getByRole('dialog', { name: 'Add note' });
    const tiles = editor.getByRole('button', { name: /^View image/ });
    await expect(tiles).toHaveCount(Math.min(count, 4));
    await expect(editor.getByRole('button', { name: /^Remove image/ })).toHaveCount(0);
    const boxes = await Promise.all((await tiles.all()).map(tile => tile.boundingBox()));
    expect(boxes[0]!.y).toBe(boxes[1]!.y);
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    if (count === 3) {
      expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y);
      expect(boxes[2]!.width).toBeGreaterThan(boxes[0]!.width * 1.9);
    }
    if (count >= 4) {
      expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y);
      expect(boxes[2]!.x).toBe(boxes[0]!.x);
      expect(boxes[3]!.x).toBe(boxes[1]!.x);
    }
    if (count > 4) await expect(editor.getByText(`${count - 4} more ${count === 5 ? 'image' : 'images'}`)).toBeVisible();
    if (count === 6) {
      await editor.getByRole('button', { name: 'View image 4' }).click();
      const preview = page.getByRole('dialog', { name: 'Image preview' });
      await preview.getByRole('button', { name: 'Next image' }).click();
      await expect(preview.getByText('5 / 6')).toBeVisible();
      await preview.getByRole('button', { name: 'Close image preview' }).click();
    }
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 15_000 });
    const card = page.getByRole('button', { name: `Open note: ${title}` });
    await expect(card.locator('img')).toHaveCount(Math.min(count, 4));
    const cardBoxes = await card.evaluate(element => Array.from(element.querySelectorAll('img'), image => image.getBoundingClientRect().toJSON()));
    expect(cardBoxes[0].width).toBeGreaterThan(0);
    expect(cardBoxes[0].y).toBe(cardBoxes[1].y);
    if (count === 3) expect(cardBoxes[2].width).toBeGreaterThan(cardBoxes[0].width * 1.9);
    if (count > 4) await expect(card.getByText(`${count - 4} more ${count === 5 ? 'image' : 'images'}`)).toBeVisible();
    await card.click();
    await page.getByRole('button', { name: 'Delete note' }).click();
    await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 15_000 });
  }
});

test('receives an Android share as a draft and saves it on close', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const share = async () => {
    const chooser = await page.evaluateHandle(() => {
      const input = document.createElement('input');
      input.type = 'file';
      document.body.append(input);
      return input;
    });
    await chooser.asElement()!.setInputFiles('tests/fixtures/image.jpg');
    return page.evaluate(async () => {
      const input = document.querySelector('body > input[type=file]') as HTMLInputElement;
      const form = new FormData();
      form.append('images', input.files![0]);
      input.remove();
      const response = await fetch('/share-target', { method: 'POST', body: form });
      return response.url;
    });
  };

  const first = await share();
  expect(first).toContain('share=');
  await page.goto(first);
  await expect(page.getByRole('dialog', { name: 'Add note' }).getByRole('img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Add note' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open note: image.jpg' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await page.goto(first);
  await expect(page.getByRole('status')).toContainText('no longer available');

  const second = await share();
  await page.goto(second);
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Shared screenshot note');
  await page.getByRole('button', { name: 'Attach an image' }).click();
  await page.locator('input[type=file]').last().setInputFiles('tests/fixtures/image.jpg');
  await expect(page.getByRole('dialog', { name: 'Add note' }).getByRole('img')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Add note' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open note: Shared screenshot note' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 10_000 });
  await page.goto(second);
  await expect(page.getByRole('status')).toContainText('no longer available');
});

test('can receive and save a shared screenshot offline', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const picker = await page.evaluateHandle(() => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.append(input);
    return input;
  });
  await picker.asElement()!.setInputFiles('tests/fixtures/image.jpg');
  await context.setOffline(true);
  await page.evaluate(() => {
    const picker = document.querySelector('body > input[type=file]') as HTMLInputElement;
    const form = document.createElement('form');
    form.action = '/share-target';
    form.method = 'POST';
    form.enctype = 'multipart/form-data';
    picker.name = 'images';
    form.append(picker);
    document.body.append(form);
    form.submit();
  });
  await expect(page).toHaveURL(/share=/);
  await expect(page.getByRole('dialog', { name: 'Add note' }).getByRole('img')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Title' }).fill('Shared while offline');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Open note: Shared while offline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saved on device' })).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 15_000 });
});

test('works offline after the first online visit and syncs on reconnect', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  await page.keyboard.press('n');
  await page.getByRole('textbox', { name: 'Title' }).fill('Written offline');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(page.getByRole('button', { name: 'Open note: Written offline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saved on device' })).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible({ timeout: 15_000 });
});

for (const width of [390, 834, 1440]) {
  test(`layout and accessibility at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
    const violations = await new AxeBuilder({ page }).analyze();
    expect(violations.violations).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
}

for (const width of [390, 1280]) {
  test(`create controls leave the last notes clear at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto('/');
    // Seed enough rows for both two-column mobile and four-column desktop layouts.
    for (let index = 0; index < 12; index++) {
      await page.getByRole('heading', { name: 'Your notes' }).click();
      await page.keyboard.press('n');
      await page.getByRole('textbox', { name: 'Title' }).fill(`Tall note ${index}`);
      await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Long thought. '.repeat(40));
      await page.getByRole('button', { name: 'Close note' }).click();
      await expect(page.getByRole('button', { name: `Open note: Tall note ${index}`, exact: true })).toBeVisible();
    }
    const nav = page.getByRole('navigation', { name: 'Create a note' });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(nav).toHaveCSS('position', 'fixed');
    const clearance = await page.evaluate(() => {
      const navTop = document.querySelector<HTMLElement>('nav[aria-label="Create a note"]')!.getBoundingClientRect().top;
      const lastCardBottom = Math.max(...[...document.querySelectorAll<HTMLElement>('[data-note-id]')].map(card => card.getBoundingClientRect().bottom));
      return { gap: navTop - lastCardBottom, scrolled: scrollY > 0 };
    });
    expect(clearance.scrolled).toBe(true);
    expect(clearance.gap).toBeGreaterThanOrEqual(12);
  });
}

test('serves the service worker and page shell without browser HTTP caching', async ({ request }) => {
  for (const path of ['/sw.js', '/', '/share-target']) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['cache-control']).toContain('no-store');
  }
});

test('GET share-target bypasses cached navigation for older installed versions', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const response = await page.goto('/share-target');
  expect(response?.fromServiceWorker()).toBe(false);
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
});

test('offers a refresh when a new offline app version is waiting', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const workerPath = 'dist/client/sw.js';
  const original = await readFile(workerPath, 'utf8');
  try {
    await writeFile(workerPath, `${original}\n// test update ${Date.now()}\n`);
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    await expect(page.getByRole('button', { name: 'Refresh app' })).toBeVisible({ timeout: 10_000 });
    const reloaded = page.waitForEvent('load', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Refresh app' }).click();
    await reloaded;
    await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Refresh app' })).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await writeFile(workerPath, original);
  }
});

test('requires the owner password in a new browser profile', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(baseURL!);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Password').fill('incorrect password value');
  await page.getByRole('button', { name: 'Open Shelf' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect password');
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Open Shelf' }).click();
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
  await context.close();
});

for (const width of [390, 1280]) {
  test(`clamps long note previews but keeps the editor text intact at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    const title = `${'A very long title that should be shortened in the overview '.repeat(2).trim()} ${width}`;
    const body = 'A longer body that should be shortened in the overview. '.repeat(20).trim();
    await page.getByRole('textbox', { name: 'Title' }).fill(title);
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill(body);
    await page.getByRole('button', { name: 'Close note' }).click();

    const card = page.getByRole('button', { name: `Open note: ${title}`, exact: true });
    await expect(card).toBeVisible();
    for (const [index, lines, text] of [[1, 2, title], [2, 4, body]] as const) {
      const preview = card.locator('span').nth(index);
      // The full text remains available; only its rendered preview is truncated.
      expect(await preview.textContent()).toBe(text);
      const dimensions = await preview.evaluate(element => {
        const style = getComputedStyle(element);
        return { height: element.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight), clamp: style.webkitLineClamp };
      });
      expect(dimensions.clamp).toBe(String(lines));
      expect(dimensions.height).toBeLessThanOrEqual(lines * dimensions.lineHeight + 1);
    }
    await card.click();
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(title);
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue(body);
  });
}
