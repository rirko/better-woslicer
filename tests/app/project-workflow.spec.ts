import { wavBytesDepth, writeWavHeader } from '../fixtures';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeWav16 } from '../../src/core/wav';
import { decodeProject } from '../../src/project/codec';
import { readBmh } from '../../src/core/bmh';

async function pick(page: Page, label: string, name: string, bytes: Uint8Array): Promise<void> {
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: label, exact: true }).click();
  await (
    await choosing
  ).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
}

test('opens and exports an original BMH file without changing its bytes', async ({ page }) => {
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  const original = await readFile('tests/fixtures/bmh/original-events.bmh');
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }),
  );
  await page.goto('/');
  await page.getByRole('tab', { name: 'BMHelper', exact: true }).click();
  await pick(page, 'Open project', 'original-events.bmh', original);
  await expect(page.locator('.division-actions .el-select')).toContainText('コード分割');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const path = await (await downloading).path();
  if (!path) throw new Error('Missing BMH download');
  expect(await readFile(path)).toEqual(original);
  const name = '简体中文・한국어・🎵';
  const rename = page.locator('.division-name input');
  await rename.fill(name);
  await rename.press('Tab');
  const savingLegacy = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('CP932');
  const legacyPath = await (await savingLegacy).path();
  if (!legacyPath) throw new Error('Missing converted BMH download');
  expect(readBmh(new Uint8Array(await readFile(legacyPath))).divisions[0].name).not.toBe(name);
  await expect(rename).toHaveValue(name);
  const savingDx = page.waitForEvent('download');
  await page.getByRole('button', { name: /Save \.wosdx/ }).click();
  const dxPath = await (await savingDx).path();
  if (!dxPath) throw new Error('Missing DX project download');
  const dx = await readFile(dxPath);
  expect(dx.toString('utf8')).toContain(name);
  const decoded = decodeProject(dx);
  if (decoded.kind !== 'supported') throw new Error('Unexpected project version');
  expect(decoded.project.bmhelper?.divisions[0].name).toBe(name);
  await pick(page, 'Open .wosdx...', 'unicode.wosdx', dx);
  await expect(rename).toHaveValue(name);
});

test('opens, saves and relinks a project at native browser scale', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }),
  );
  await page.addInitScript(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let first = true;
    crypto.subtle.digest = async (...args) => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) =>
          document.addEventListener('resume-media', () => resolve(), { once: true }),
        );
      }
      return digest(...args);
    };
  });
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  const pcm = Int16Array.from({ length: 48000 }, (_, i) => Math.round(Math.sin(i / 12) * 16000));
  const wav = encodeWav16([pcm], 48000, pcm.length);
  await pick(page, 'Open', 'tone.wav', wav);
  const loading = page.locator('.media-loading');
  await expect(loading).toBeVisible();
  await expect(loading).toContainText('Checking media');
  await expect(loading).toContainText('tone.wav');
  await expect(page.getByRole('menubar')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('media-loading.png'), fullPage: true });
  await page.evaluate(() => document.dispatchEvent(new Event('resume-media')));
  await expect(page.locator('.status-message')).toContainText('Ready: tone');
  await expect(loading).toBeHidden();
  await page.locator('.timeline-viewport').focus();
  await page.keyboard.press('z');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('z');
  await expect(page.getByLabel('Unsaved changes', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /Save \.wosdx/ }).click();
  const download = await downloading;
  const path = await download.path();
  if (!path) throw new Error('Missing project download');
  const bytes = new Uint8Array(await readFile(path));
  const parsed = decodeProject(bytes);
  expect(parsed.kind).toBe('supported');
  if (parsed.kind !== 'supported') throw new Error('Unexpected project version');
  expect(parsed.project.slicing.markers).toEqual([0, 24]);
  expect(parsed.project.media[0]?.integrity?.digest).toMatch(/^[0-9a-f]{64}$/);
  await expect(page.getByLabel('Unsaved changes', { exact: true })).toHaveCount(0);
  await pick(page, 'Open .wosdx...', 'tone.wosdx', bytes);
  await expect(page.locator('.source-info')).toContainText('Audio unavailable: tone.wav');
  await pick(page, 'Relink audio...', 'tone.wav', wav);
  await expect(page.locator('.source-info')).toContainText('48000 Hz');
  await expect(page.getByLabel('Unsaved changes', { exact: true })).toHaveCount(0);
  await page.locator('.timeline-viewport').focus();
  await page.keyboard.press('z');
  await page.getByRole('button', { name: 'Open .wosdx...', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Unsaved project changes will be replaced.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.source-info')).toContainText('48000 Hz');
  const dimensions = await page.evaluate(() => ({
    dpr: devicePixelRatio,
    overflow: document.documentElement.scrollWidth - innerWidth,
    canvases: Array.from(document.querySelectorAll('canvas')).map((canvas) => ({
      width: canvas.width,
      css: canvas.clientWidth,
    })),
  }));
  expect(dimensions.dpr).toBeCloseTo(info.project.use.deviceScaleFactor ?? 1, 5);
  expect(dimensions.overflow).toBeLessThanOrEqual(1);
  expect(dimensions.canvases.length).toBeGreaterThanOrEqual(4);
  for (const canvas of dimensions.canvases)
    expect(Math.abs(canvas.width - canvas.css * dimensions.dpr)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: info.outputPath('project-workflow.png'), fullPage: true });
  expect(errors).toEqual([]);
});

for (const kind of ['pcm', 'float'] as const) {
  test(
    'displays the original 32-bit ' + kind + ' WAV format through the worker',
    async ({ page }) => {
      let bytes: Uint8Array;
      if (kind === 'pcm') {
        bytes = wavBytesDepth([0, 0x7fffffff, -0x80000000], 48000, 32);
      } else {
        bytes = new Uint8Array(44 + 12);
        const view = new DataView(bytes.buffer);
        writeWavHeader(view, 12, 3, 1, 48000, 32);
        view.setFloat32(48, 0.5, true);
        view.setFloat32(52, -0.5, true);
      }
      await page.goto('/');
      await pick(page, 'Open', 'source-32.wav', bytes);
      const details = page.locator('.source-info');
      await expect(details).toContainText(kind === 'pcm' ? 'WAV PCM 32-bit' : 'WAV Float 32-bit');
      await expect(details).toContainText('Processing / output');
      await expect(details).toContainText('PCM 16-bit');
    },
  );
}
