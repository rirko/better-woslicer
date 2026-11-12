// R0 baseline capture for docs/refactoring/UI_READABILITY_PLAN.md.
// Each test records one visual scenario of the CURRENT implementation so later
// refactoring cards can be compared against these artifacts. Assertions only
// pin existing behavior needed for a stable capture; they add no new contracts.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { encodeWav16 } from '../../src/core/wav';
import { writeSmfSequence } from '../../src/core/smf';

const TABS: ReadonlyArray<{ name: string; label: string; ready: string }> = [
  { name: 'source', label: 'Source', ready: '.source-info' },
  { name: 'cuts', label: 'Cuts', ready: '.marker-list' },
  { name: 'detect', label: 'Band detect', ready: '.detection-panel' },
  { name: 'output', label: 'Output', ready: '.output-panel' },
  { name: 'bmhelper', label: 'BMHelper', ready: '.bmhelper' },
];

function artifactPath(project: string, name: string): string {
  return path.resolve('test-artifacts', 'ui-baseline', project, name);
}

// These capture-only tests run through scripts/verify-ui-readability.mjs, one
// scenario per invocation; they stay out of the default dual-profile workflow
// so that command keeps its 30-seconds-per-profile budget.
test.skip(
  process.env.WOSLICER_UI_BASELINE !== '1',
  'baseline capture runs via scripts/verify-ui-readability.mjs',
);

async function pick(page: Page, label: string, name: string, bytes: Uint8Array): Promise<void> {
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: label, exact: true }).click();
  await (
    await choosing
  ).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
}

async function openAudio(page: Page): Promise<void> {
  const pcm = Int16Array.from({ length: 48000 }, (_, i) => Math.round(Math.sin(i / 12) * 16000));
  await pick(page, 'Open', 'tone.wav', encodeWav16([pcm], 48000, pcm.length));
  await expect(page.locator('.status-message')).toContainText('Ready: tone');
}

function guardErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function saveShot(page: Page, project: string, name: string): Promise<void> {
  await mkdir(path.dirname(artifactPath(project, name)), { recursive: true });
  await page.screenshot({ path: artifactPath(project, name) });
}

// toBeVisible passes while the ElDialog enter transition is still at opacity 0,
// so wait for the computed style instead of taking a mid-animation capture.
async function awaitDialogPainted(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => dialog.evaluate((element) => getComputedStyle(element).opacity))
    .toBe('1');
}

// Narrow-window captures need the same computed-style facts as the main
// window plus flex direction, so the media-query layout is comparable.
async function writeLayoutStyles(page: Page, project: string, name: string): Promise<void> {
  const styles = await page.evaluate(() => {
    const pick = (selector: string): Record<string, unknown> | null => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const css = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        display: css.display,
        gridTemplateColumns: css.gridTemplateColumns,
        flexDirection: css.flexDirection,
        minHeight: css.minHeight,
        height: css.height,
        borderTopWidth: css.borderTopWidth,
        borderRightWidth: css.borderRightWidth,
        borderBottomWidth: css.borderBottomWidth,
        borderLeftWidth: css.borderLeftWidth,
        overflow: css.overflow,
        overflowX: css.overflowX,
        overflowY: css.overflowY,
        boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    };
    return {
      dpr: devicePixelRatio,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      appShell: pick('.app-shell'),
      workspace: pick('.workspace'),
      editorColumn: pick('.editor-column'),
      timeline: pick('.timeline'),
      sidePanel: pick('.side-panel'),
    };
  });
  await writeFile(artifactPath(project, name), JSON.stringify(styles, null, 2));
}

// The theme toggle writes the dark class onto the html element; wait for it
// instead of sleeping so the dark capture shows the applied theme.
async function awaitDarkApplied(page: Page): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true);
}

// Themed components keep running color transitions after the dark class lands;
// wait until they settle so a capture cannot land mid-transition.
async function awaitTransitionsSettled(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length),
    )
    .toBe(0);
}

test('ui readability baseline: main window', async ({ page }, info) => {
  const errors = guardErrors(page);
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  await openAudio(page);
  await expect(page.locator('.timeline-viewport')).toBeVisible();
  await saveShot(page, info.project.name, 'main.png');
  const styles = await page.evaluate(() => {
    const pick = (selector: string): Record<string, unknown> | null => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const css = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        display: css.display,
        gridTemplateColumns: css.gridTemplateColumns,
        minHeight: css.minHeight,
        height: css.height,
        borderTopWidth: css.borderTopWidth,
        borderRightWidth: css.borderRightWidth,
        borderBottomWidth: css.borderBottomWidth,
        borderLeftWidth: css.borderLeftWidth,
        overflow: css.overflow,
        overflowX: css.overflowX,
        overflowY: css.overflowY,
        boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    };
    return {
      dpr: devicePixelRatio,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      timeline: pick('.timeline'),
      workspace: pick('.workspace'),
      sidePanel: pick('.side-panel'),
      app: pick('#app'),
    };
  });
  await writeFile(
    artifactPath(info.project.name, 'computed-styles.json'),
    JSON.stringify(styles, null, 2),
  );
  expect(errors).toEqual([]);
});

test('ui readability baseline: side panel tabs', async ({ page }, info) => {
  const errors = guardErrors(page);
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  await openAudio(page);
  for (const tab of TABS) {
    await page.getByRole('tab', { name: tab.label, exact: true }).click();
    await expect(page.locator(tab.ready)).toBeVisible();
    await saveShot(page, info.project.name, `tab-${tab.name}.png`);
  }
  expect(errors).toEqual([]);
});

test('ui readability baseline: bmhelper dialogs', async ({ page }, info) => {
  const errors = guardErrors(page);
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  await page.getByRole('tab', { name: 'BMHelper', exact: true }).click();
  await expect(page.locator('.bmhelper')).toBeVisible();
  const midi = writeSmfSequence({
    quantize: 480,
    notes: [
      { position: 0, nn: 60, vel: 100, gate: 120 },
      { position: 480, nn: 64, vel: 90, gate: 240 },
    ],
    pitches: [],
    controls: [],
  });
  await pick(page, 'Import MIDI', 'phrase.mid', midi);
  await awaitDialogPainted(page);
  await saveShot(page, info.project.name, 'bmh-settings-dialog.png');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.bmhelper .piano-roll, .bmhelper canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Definition info', exact: true }).click();
  await awaitDialogPainted(page);
  await saveShot(page, info.project.name, 'bmh-definitions-dialog.png');
  expect(errors).toEqual([]);
});

test('ui readability baseline: about dialog', async ({ page }, info) => {
  const errors = guardErrors(page);
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  // The browser lane has no status-bar version button: web CSP blocks the
  // build-info fetch, so identity stays null and About opens via the View menu.
  // Element Plus renders the group trigger as role=button; items are menuitems.
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'About', exact: true }).click();
  await awaitDialogPainted(page);
  await expect(page.getByRole('menuitem', { name: 'About', exact: true })).toBeHidden();
  await saveShot(page, info.project.name, 'about-dialog.png');
  expect(errors).toEqual([]);
});

test('ui readability baseline: calibration dialog', async ({ page }, info) => {
  const errors = guardErrors(page);
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  await openAudio(page);
  await page.getByRole('button', { name: 'Calibrate', exact: true }).click();
  await awaitDialogPainted(page);
  await saveShot(page, info.project.name, 'calibration-dialog.png');
  expect(errors).toEqual([]);
});

test('ui readability baseline: narrow 900', async ({ page }, info) => {
  const errors = guardErrors(page);
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  await openAudio(page);
  await expect(page.locator('.timeline-viewport')).toBeVisible();
  await saveShot(page, info.project.name, 'narrow-900.png');
  await writeLayoutStyles(page, info.project.name, 'computed-styles-narrow-900.json');
  // Pin the fixed 310px panel column that the 900px media query owns.
  const columns = await page
    .locator('.workspace')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(columns.endsWith('310px')).toBe(true);
  expect(errors).toEqual([]);
});

test('ui readability baseline: narrow 680', async ({ page }, info) => {
  const errors = guardErrors(page);
  await page.setViewportSize({ width: 680, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  await openAudio(page);
  await expect(page.locator('.timeline-viewport')).toBeVisible();
  await saveShot(page, info.project.name, 'narrow-680.png');
  await writeLayoutStyles(page, info.project.name, 'computed-styles-narrow-680.json');
  // Pin the stacked layout and top border that the 680px media query owns.
  const workspace = await page
    .locator('.workspace')
    .evaluate((element) => getComputedStyle(element).display);
  const sidePanelBorderTop = await page
    .locator('.side-panel')
    .evaluate((element) => getComputedStyle(element).borderTopWidth);
  expect(workspace).toBe('flex');
  expect(sidePanelBorderTop).toBe('1px');
  // Dark capture proves the moved layout rules stay theme independent.
  await page.getByText('Dark', { exact: true }).click();
  await awaitDarkApplied(page);
  await awaitTransitionsSettled(page);
  await saveShot(page, info.project.name, 'narrow-680-dark.png');
  expect(errors).toEqual([]);
});
