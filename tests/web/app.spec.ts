/**
 * Playwright suite for the offline browser build. Scenarios mirror the
 * Electron smoke test's user paths against the pure-browser host: load, edit,
 * export (single download and ZIP for many slices), i18n and clipboard.
 *
 * Audio loading drives the real drag-and-drop path (works identically in
 * Chromium and Firefox); the file-input chooser path is exercised separately
 * on Chromium, whose headless file chooser Playwright intercepts.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";

const APP = "http://127.0.0.1:4173/index.html";

/** Builds a minimal PCM16 WAV file in memory (44-byte canonical header). */
function makeWavBytes(frames = 4800, channels = 2, sampleRate = 48000): Uint8Array {
  const dataBytes = frames * channels * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  // Non-silent samples so band detection and exports see real signal.
  for (let i = 0; i < frames * channels; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.sin(i / 16) * 16000), true);
  }
  return bytes;
}

/** Loads audio through the drag-and-drop path (browser-agnostic). */
async function loadWav(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  const b64 = Buffer.from(bytes).toString("base64");
  const dataTransfer = await page.evaluateHandle(
    ({ name, b64 }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([arr], name, { type: "audio/wav" }));
      return dt;
    },
    { name, b64 }
  );
  await page.locator("#wave-wrap").dispatchEvent("drop", { dataTransfer });
}

test.describe("browser build", () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(String(error)));
    // Force the download fallback for save targets: headless engines cannot
    // show the File System Access picker (and would abort the dialog), and
    // the fallback path is exactly what Firefox takes in production.
    await page.addInitScript(() => {
      (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
    });
    await page.goto(APP);
    await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveText("Open");
  });

  test("loads with no console errors and the default chrome", async ({ page }) => {
    expect(consoleErrors).toEqual([]);
    await expect(page.locator("#status-main")).toHaveText("Empty: drop a WAV/OGG file to begin");
    await expect(page.locator("#readout-position")).toContainText("M001");
  });

  test("places markers with Z before any audio is loaded", async ({ page }) => {
    await page.locator("#wave-wrap").focus();
    await page.keyboard.press("z");
    await expect(page.locator("#status-main")).toHaveText("Marker toggled at tick 0");
    await page.keyboard.press("z");
    await expect(page.locator("#status-main")).toHaveText("Marker toggled at tick 0");
    expect(consoleErrors).toEqual([]);
  });

  test("switches to Japanese through the language selector", async ({ page }) => {
    await page.locator("#select-language").selectOption("ja");
    await expect(page.getByRole("button", { name: "読込", exact: true })).toHaveText("読込");
    await page.locator("#select-language").selectOption("en");
    await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveText("Open");
    expect(consoleErrors).toEqual([]);
  });

  test("loads a wav and reports readiness", async ({ page }) => {
    await loadWav(page, "song.wav", makeWavBytes());
    await expect(page.locator("#status-main")).toContainText("Ready: song (48000Hz, 2ch)");
    await expect(page.locator("#src-format")).toContainText("PCM 16-bit");
    expect(consoleErrors).toEqual([]);
  });

  test("opens audio through the file input chooser (Chromium)", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", "Firefox headless does not deliver the picked file to the input");
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#btn-open").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: "song.wav", mimeType: "audio/wav", buffer: Buffer.from(makeWavBytes()) });
    await expect(page.locator("#status-main")).toContainText("Ready: song (48000Hz, 2ch)");
    expect(consoleErrors).toEqual([]);
  });

  test("exports the slice at the cursor as a wav download", async ({ page }) => {
    await loadWav(page, "song.wav", makeWavBytes());
    await expect(page.locator("#status-main")).toContainText("Ready: song (48000Hz, 2ch)");
    // The single-slice button lives in the Output side tab.
    await page.locator('.side-tab[data-tab="output"]').click();
    await page.locator("#wave-wrap").focus();
    await page.keyboard.press("z"); // marker at tick 0
    const download = page.waitForEvent("download");
    await page.locator("#btn-export-one").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("song_000.wav");
    const bytes = readFileSync((await file.path()) as string);
    expect(bytes.length).toBeGreaterThan(44);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(consoleErrors).toEqual([]);
  });

  test("packs a multi-slice export into a single zip download", async ({ page }) => {
    // Long enough source for three slices (tick 48 ends at 60k frames).
    await loadWav(page, "song.wav", makeWavBytes(72_000));
    await expect(page.locator("#status-main")).toContainText("Ready: song (48000Hz, 2ch)");
    await page.locator("#wave-wrap").focus();
    // Three markers: grid 8 per measure places 24 ticks per ArrowRight step.
    for (const key of ["z", "ArrowRight", "z", "ArrowRight", "z"]) await page.keyboard.press(key);
    const download = page.waitForEvent("download");
    await page.locator("#btn-export").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("song.zip");
    const bytes = new Uint8Array(readFileSync((await file.path()) as string));
    const entries = Object.keys(unzipSync(bytes));
    expect(entries).toEqual(["song_000.wav", "song_001.wav", "song_002.wav"]);
    expect(consoleErrors).toEqual([]);
  });

  test("writes and reads the BMSE clipboard as plain text", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", "clipboard permissions are Chromium-only in Playwright");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await page.locator("#wave-wrap").focus();
    await page.keyboard.press("z");
    await page.keyboard.press("v"); // BMSE clipboard out (V)
    await expect(page.locator("#status-main")).toContainText("BMSE clipboard: 1 markers");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("BMSE ClipBoard Object Data Format");
    expect(consoleErrors).toEqual([]);
  });
});
