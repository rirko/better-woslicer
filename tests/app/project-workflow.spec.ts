import { wavBytesDepth, writeWavHeader } from '../fixtures';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeWav16 } from '../../src/core/wav';
import { decodeProject } from '../../src/project/codec';

async function pick(page: Page, label: string, name: string, bytes: Uint8Array): Promise<void> {
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: label, exact: true }).click();
  await (
    await choosing
  ).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
}

test('opens, saves and relinks a project at native browser scale', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }),
  );
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  const pcm = Int16Array.from({ length: 48000 }, (_, i) => Math.round(Math.sin(i / 12) * 16000));
  const wav = encodeWav16([pcm], 48000, pcm.length);
  await pick(page, 'Open', 'tone.wav', wav);
  await expect(page.locator('.status-message')).toContainText('Ready: tone');
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
