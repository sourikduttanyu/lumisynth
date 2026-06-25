import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'lumisynth-state-v8';
const LEGACY_STORAGE_KEYS = ['lumisynth-state-v7', 'lumisynth-state-v6', 'lumisynth-state-v5'];
const INTRO_DISMISSED_KEY = 'lumisynth-intro-dismissed';

const byValue = (group, value) => `${group} .toggle-btn[data-value="${value}"]`;

async function gotoClean(page) {
  await page.goto('/');
  await page.evaluate(([stateKey, legacyStateKeys, introKey]) => {
    localStorage.removeItem(stateKey);
    for (const key of legacyStateKeys) localStorage.removeItem(key);
    localStorage.removeItem(introKey);
  }, [STORAGE_KEY, LEGACY_STORAGE_KEYS, INTRO_DISMISSED_KEY]);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
}

async function gotoDismissed(page) {
  await gotoClean(page);
  await page.locator('#intro-start').click();
  await expect(page.locator('#intro-overlay')).toBeHidden();
}

// Simulate a source being loaded: unhide the pipeline panel and set state.hasSource
// so tests can interact with STRUCTURE / COLOR / FX controls without a real video file.
async function activatePipelinePanel(page) {
  await page.evaluate(() => {
    const panel = document.getElementById('pipeline-panel');
    if (panel) panel.classList.remove('hidden');
    if (window._state) window._state.hasSource = true;
    document.body.dataset.hasSource = 'true';
  });
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
  await expect(page.locator('#topbar-source')).toBeVisible();
  await expect(page.locator('#placeholder')).toBeVisible();
  await expect.poll(() => runtimeErrors).toEqual([]);
});

test('selecting each structure reveals only its control card', async ({ page }) => {
  await gotoDismissed(page);
  await activatePipelinePanel(page);

  for (const effect of ['ascii', 'erode', 'pixelsort', 'melt', 'moddiff']) {
    await page.locator(byValue('#structure-group', effect)).click();
    await expect(page.locator(`#${effect}-controls`)).toBeVisible();

    for (const other of ['ascii', 'erode', 'pixelsort', 'melt', 'moddiff']) {
      if (other !== effect) await expect(page.locator(`#${other}-controls`)).toBeHidden();
    }
  }
});

test('structure output mode persists across reload', async ({ page }) => {
  await gotoDismissed(page);
  await activatePipelinePanel(page);

  await page.locator(byValue('#structure-output-group', 'source')).click();
  await expect(page.locator(byValue('#structure-output-group', 'source'))).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate((key) => {
    return JSON.parse(localStorage.getItem(key) || '{}').structureOutputMode;
  }, STORAGE_KEY)).toBe('source');

  await page.reload();
  await activatePipelinePanel(page);
  await expect(page.locator(byValue('#structure-output-group', 'source'))).toHaveAttribute('aria-checked', 'true');
});

test('track mode reveals tracking controls', async ({ page }) => {
  await gotoDismissed(page);
  await activatePipelinePanel(page);

  await page.locator(byValue('#mode-group', 'track')).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'track');
  await expect(page.locator('#track-composite-group')).toBeVisible();

  // Detection backend: switch to blob to reveal lumi-channel section
  await page.locator(byValue('#track-backend-group', 'blob')).click();
  await expect(page.locator('#lumi-channel-group')).toBeVisible();

  // Color key controls appear only when channel = color
  await page.locator(byValue('#lumi-channel-group', 'color')).click();
  await expect(page.locator('#color-key-controls')).toBeVisible();

  await page.locator(byValue('#lumi-channel-group', 'motion')).click();
  await expect(page.locator('#color-key-controls')).toBeHidden();
});

test('keyboard-adjusted structure knob resets from card reset', async ({ page }) => {
  await gotoDismissed(page);
  await activatePipelinePanel(page);

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
  await activatePipelinePanel(page);

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

  // Snap and Export require a source — both start disabled.
  await expect(page.locator('#btn-snapshot')).toBeDisabled();
  await expect(page.locator('#btn-export')).toBeDisabled();
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

test('color stage picks a map and persists the selection', async ({ page }) => {
  await gotoDismissed(page);
  await activatePipelinePanel(page);

  // MAPS grid renders None + the per-pixel map library.
  const mapButtons = page.locator('#color-maps-grid .toggle-btn');
  await expect(mapButtons.first()).toHaveText('None');
  expect(await mapButtons.count()).toBeGreaterThan(9);

  // Pick Thermo: button activates and its knobs render below the grid.
  await page.locator('#color-maps-grid .toggle-btn[data-value="thermo"]').click();
  await expect(page.locator('#color-maps-grid .toggle-btn[data-value="thermo"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#color-maps-knob-panel .knob')).toHaveCount(4);

  await expect.poll(() => page.evaluate((key) => {
    return JSON.parse(localStorage.getItem(key) || '{}').color;
  }, STORAGE_KEY)).toBe('thermo');

  await page.reload();
  await activatePipelinePanel(page);
  await expect(page.locator('#color-maps-grid .toggle-btn[data-value="thermo"]')).toHaveAttribute('aria-checked', 'true');
});

test('unique tab renders categories and selects an effect', async ({ page }) => {
  await gotoDismissed(page);
  await activatePipelinePanel(page);

  await page.locator('#color-tab-group .toggle-btn[data-value="unique"]').click();
  await expect(page.locator('#color-tab-unique')).toBeVisible();
  await expect(page.locator('#color-tab-maps')).toBeHidden();

  // Category headers render between the swatch rows.
  expect(await page.locator('#color-unique-grid .color-grid-category').count()).toBeGreaterThan(2);

  await page.locator('#color-unique-grid .toggle-btn[data-value="aurorastorm"]').click();
  await expect(page.locator('#color-tab-unique')).toHaveClass(/color-source-active/);
  await expect(page.locator('#color-unique-knob-panel .knob')).toHaveCount(4);

  await expect.poll(() => page.evaluate((key) => {
    return JSON.parse(localStorage.getItem(key) || '{}').color;
  }, STORAGE_KEY)).toBe('aurorastorm');

  // Reload lands back on the UNIQUE tab (derived from the selection).
  await page.reload();
  await activatePipelinePanel(page);
  await expect(page.locator('#color-tab-unique')).toBeVisible();
  await expect(page.locator('#color-unique-grid .toggle-btn[data-value="aurorastorm"]')).toHaveAttribute('aria-checked', 'true');
});

test('fx rack hosts stateless signal effects', async ({ page }) => {
  await gotoDismissed(page);
  await activatePipelinePanel(page);

  await page.locator('#fx-rack .color-rack-slot').first().locator('.color-rack-chip').click();
  // Picker is built from FX_SECTIONS: None + feedback + signal effects.
  expect(await page.locator('#fx-picker-popover .color-pick').count()).toBeGreaterThan(8);
  await page.locator('#fx-picker-popover [data-pick-fx="crt"]').click();

  const slot0 = page.locator('#fx-rack .color-rack-slot').first();
  await expect(slot0.locator('.color-rack-chip-label')).toHaveText('CRT');

  await expect.poll(() => page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    return raw.fxRack && raw.fxRack[0] && raw.fxRack[0].type;
  }, STORAGE_KEY)).toBe('crt');
});

test('chroma custom tab activates from a driver click', async ({ page }) => {
  await gotoDismissed(page);
  await activatePipelinePanel(page);

  await page.locator('#color-tab-group .toggle-btn[data-value="custom"]').click();
  await expect(page.locator('#chroma-driver-group .toggle-btn')).toHaveCount(5);
  await expect(page.locator('#chroma-stop-row input[type="color"]')).toHaveCount(4);

  await page.locator('#chroma-driver-group [data-driver-value="3"]').click();
  await expect(page.locator('#color-tab-custom')).toHaveClass(/color-source-active/);

  await expect.poll(() => page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    return `${raw.color}:${raw.colorParams?.chroma?.driver}`;
  }, STORAGE_KEY)).toBe('chroma:3');
});

test('fx rack fills a slot with flowfield and persists it', async ({ page }) => {
  await gotoDismissed(page);
  await activatePipelinePanel(page);

  // Three empty slots render in the FX rack.
  await expect(page.locator('#fx-rack .color-rack-slot')).toHaveCount(3);
  await expect(page.locator('#fx-rack .color-rack-slot[data-empty="true"]')).toHaveCount(3);

  // Pick FlowField into slot 0 via the picker popover.
  await page.locator('#fx-rack .color-rack-slot').first().locator('.color-rack-chip').click();
  await expect(page.locator('#fx-picker-popover')).toBeVisible();
  await page.locator('#fx-picker-popover [data-pick-fx="flowfield"]').click();

  const slot0 = page.locator('#fx-rack .color-rack-slot').first();
  await expect(slot0).toHaveAttribute('data-empty', 'false');
  await expect(slot0).toHaveAttribute('data-enabled', 'true');
  await expect(slot0.locator('.color-rack-chip-label')).toHaveText('FlowField');

  // Slot auto-expands on pick — four knobs are immediately visible.
  await expect(page.locator('#fx-rack .color-rack-slot').first().locator('.color-rack-slot-panel .knob')).toHaveCount(4);

  // The pick lands in persisted state and survives reload.
  await expect.poll(() => page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    return raw.fxRack && raw.fxRack[0] && raw.fxRack[0].type;
  }, STORAGE_KEY)).toBe('flowfield');

  await page.reload();
  await activatePipelinePanel(page);
  await expect(page.locator('#fx-rack .color-rack-slot').first().locator('.color-rack-chip-label')).toHaveText('FlowField');
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
