import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'lumisynth-state-v5';
const INTRO_DISMISSED_KEY = 'lumisynth-intro-dismissed';

const byValue = (group, value) => `${group} .toggle-btn[data-value="${value}"]`;

async function gotoClean(page) {
  await page.goto('/');
  await page.evaluate(([stateKey, introKey]) => {
    localStorage.removeItem(stateKey);
    localStorage.removeItem(introKey);
  }, [STORAGE_KEY, INTRO_DISMISSED_KEY]);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
}

async function gotoDismissed(page) {
  await gotoClean(page);
  await page.locator('#intro-start').click();
  await expect(page.locator('#intro-overlay')).toBeHidden();
}

test('loads default synth chrome without runtime errors', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await gotoClean(page);

  await expect(page.locator('#intro-overlay')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'synth');
  await expect(page.locator('#file-status')).toHaveText('No source loaded');
  await expect(page.locator('#placeholder')).toBeVisible();
  await expect(page.locator(byValue('#structure-group', 'none'))).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator(byValue('#structure-output-group', 'mono'))).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => runtimeErrors).toEqual([]);
});

test('selecting each structure reveals only its control card', async ({ page }) => {
  await gotoDismissed(page);

  for (const effect of ['ascii', 'erode', 'watershed', 'pixelsort', 'melt']) {
    await page.locator(byValue('#structure-group', effect)).click();
    await expect(page.locator(`#${effect}-controls`)).toBeVisible();

    for (const other of ['ascii', 'erode', 'watershed', 'pixelsort', 'melt']) {
      if (other !== effect) await expect(page.locator(`#${other}-controls`)).toBeHidden();
    }
  }
});

test('structure output mode persists across reload', async ({ page }) => {
  await gotoDismissed(page);

  await page.locator(byValue('#structure-output-group', 'source')).click();
  await expect(page.locator(byValue('#structure-output-group', 'source'))).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate((key) => {
    return JSON.parse(localStorage.getItem(key) || '{}').structureOutputMode;
  }, STORAGE_KEY)).toBe('source');

  await page.reload();
  await expect(page.locator(byValue('#structure-output-group', 'source'))).toHaveAttribute('aria-checked', 'true');
});

test('track mode reveals tracking controls and color key options', async ({ page }) => {
  await gotoDismissed(page);

  await page.locator(byValue('#mode-group', 'track')).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'track');
  await expect(page.locator('#track-composite-group')).toBeVisible();
  await expect(page.locator('#lumi-channel-group')).toBeVisible();

  await page.locator(byValue('#lumi-channel-group', 'color')).click();
  await expect(page.locator('#color-key-controls')).toBeVisible();

  await page.locator(byValue('#lumi-channel-group', 'motion')).click();
  await expect(page.locator('#color-key-controls')).toBeHidden();
});

test('keyboard-adjusted structure knob resets from card reset', async ({ page }) => {
  await gotoDismissed(page);

  await page.locator(byValue('#structure-group', 'ascii')).click();
  const contrastKnob = page.locator('#ascii-contrast');
  await contrastKnob.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#ascii-contrast-val')).toHaveText('0.31');

  await page.locator('#ascii-controls [data-reset-card="ascii"]').click();
  await expect(page.locator('#ascii-contrast-val')).toHaveText('0.3');
});

test('global reset restores structure and output defaults', async ({ page }) => {
  await gotoDismissed(page);

  await page.locator(byValue('#structure-group', 'melt')).click();
  await page.locator(byValue('#structure-output-group', 'ink')).click();

  await page.locator('#btn-reset').click();
  await expect(page.locator('#btn-reset')).toHaveText('Confirm?');
  await page.locator('#btn-reset').click();

  await expect(page.locator(byValue('#structure-group', 'none'))).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator(byValue('#structure-output-group', 'mono'))).toHaveAttribute('aria-checked', 'true');
});

test('fps overlay toggles from the topbar', async ({ page }) => {
  await gotoDismissed(page);

  await expect(page.locator('#fps-overlay')).toBeHidden();
  await page.locator('#btn-fps').click();
  await expect(page.locator('#fps-overlay')).toBeVisible();

  await page.locator('#btn-fps').click();
  await expect(page.locator('#fps-overlay')).toBeHidden();
});

test('source-gated export controls start disabled', async ({ page }) => {
  await gotoDismissed(page);

  await expect(page.locator('#btn-snapshot')).toBeDisabled();
  await expect(page.locator('#btn-record')).toBeDisabled();
  await expect(page.locator('#topbar-source')).toHaveText('No source');
});

test('help overlay opens and closes', async ({ page }) => {
  await gotoDismissed(page);

  await page.locator('#btn-help').click();
  await expect(page.locator('#help-overlay')).toBeVisible();
  await expect(page.locator('#help-title')).toHaveText('Keyboard & Mouse');

  await page.locator('#help-close').click();
  await expect(page.locator('#help-overlay')).toBeHidden();
});

test('intro overlay dismisses and stays dismissed', async ({ page }) => {
  await gotoClean(page);

  await expect(page.locator('#intro-title')).toHaveText('Meet LumiSynth');
  await page.locator('#intro-start').click();
  await expect(page.locator('#intro-overlay')).toBeHidden();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), INTRO_DISMISSED_KEY)).toBe('true');

  await page.reload();
  await expect(page.locator('#intro-overlay')).toBeHidden();
});
