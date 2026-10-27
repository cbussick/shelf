import { test, expect } from '../fixtures/isolated-test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// This checks the browser-spellcheck opt-out, not Android's native keyboard/popup.
test('new and existing note bodies disable browser spellcheck and remain editable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Spelling popup workaround');
  const body = page.getByRole('textbox', { name: 'Note', exact: true });
  const text = 'A speling mistake.';
  await body.fill(text);

  for (const state of ['new', 'existing']) {
    await expect(body).toHaveAttribute('spellcheck', 'false');
    await expect(body).toHaveJSProperty('spellcheck', false);
    await body.tap();
    await body.press('Home');
    for (let index = 0; index < text.indexOf('speling') + 3; index++) await body.press('ArrowRight');
    await page.keyboard.type('l');
    await expect(body).toHaveText('A spelling mistake.');
    await expect(body).toBeFocused();
    await page.keyboard.press('Backspace');
    await expect(body).toHaveText(text);
    await expect(body).toBeFocused();
    await page.getByRole('button', { name: 'Close note' }).click();
    if (state === 'new') {
      await page.getByRole('button', { name: 'Open note: Spelling popup workaround', exact: true }).click();
    }
  }
});
