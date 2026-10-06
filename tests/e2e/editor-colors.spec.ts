import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures/isolated-test';

for (const width of [1440, 320]) {
  test(`editor offers all colors and saves new colors at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Expanded palette');
    const editor = page.getByRole('dialog', { name: 'Add note' });
    const trigger = editor.getByRole('button', { name: 'Note color' });
    const options = ['Paper', 'Butter', 'Mint', 'Lilac', 'Peach', 'Blue', 'Orange', 'Rose'];
    for (const [name, background] of [
      ['Blue', 'rgb(217, 232, 248)'],
      ['Orange', 'rgb(248, 210, 168)'],
      ['Rose', 'rgb(243, 220, 229)'],
    ]) {
      await trigger.click();
      await expect(editor.getByRole('radio')).toHaveCount(options.length);
      for (const option of options) await expect(editor.getByRole('radio', { name: option, exact: true })).toBeInViewport({ ratio: 1 });
      expect((await new AxeBuilder({ page }).include('#note-color-choices').analyze()).violations).toEqual([]);
      await editor.getByRole('radio', { name, exact: true }).click();
      await expect(editor).toHaveCSS('background-color', background);
      await expect(trigger).toBeFocused();
      await expect(editor.getByRole('radio')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Close note' }).click();
    await expect(page.getByRole('button', { name: 'Synced' })).toBeVisible();
    expect((await (await request.get('/api/notes')).json()).notes[0].color).toBe('rose');
    await page.reload();
    const card = page.getByRole('button', { name: 'Open note: Expanded palette' });
    await expect(card).toHaveCSS('background-color', 'rgb(243, 220, 229)');
    await card.click();
    const savedEditor = page.getByRole('dialog', { name: 'Edit note' });
    await expect(savedEditor).toHaveCSS('background-color', 'rgb(243, 220, 229)');
    await savedEditor.getByRole('button', { name: 'Note color' }).click();
    await expect(savedEditor.getByRole('radio', { name: 'Rose' })).toBeChecked();
    await page.screenshot({ path: `test-results/editor-colors-${width}.png` });
  });
}
