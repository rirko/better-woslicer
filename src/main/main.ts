/**
 * Electron main process.
 *
 * Security posture (contract):
 *  - contextIsolation: true, nodeIntegration: false, sandbox: true
 *  - strict CSP on the renderer, no remote content
 *  - navigation and window.open are blocked
 *  - all IPC handlers validate their arguments before touching the filesystem
 */

import { app, BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, Menu, nativeTheme } from "electron";
import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import {
  CHANNELS,
  hasAudioExtension,
  validateDirectoryPath,
  validateExportRequest,
  validateWavOutputPath,
  validateWosFilePath,
} from "./channels.js";
import { parseWav, encodeWav16 } from "../core/wav.js";
import { decodeOgg } from "../core/ogg.js";
import { renderSlice } from "../core/slicer.js";
import { TimeBase, tickToSampleExport } from "../core/timebase.js";
import { BMSE_CLIPBOARD_FORMAT_NAME, bmseBufferToText, bmseTextToBuffer } from "../core/bmse.js";
import { isLanguage, languageFromLocale, type Language } from "../core/language.js";
import { MENU_STRINGS, menuTemplate } from "./menu-i18n.js";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // Dark window chrome: the default frame follows the (light) system theme
  // and showed a white title strip. Forcing the dark native theme turns the
  // title bar, the File/Edit/View/Help menu bar and the window controls dark.
  // titleBarStyle "hidden" + titleBarOverlay was evaluated and rejected: on
  // Windows it removes the native menu bar entirely, and none of
  // setMenuBarVisibility(true), autoHideMenuBar: false or setMenu() bring it
  // back — which broke the "native menus stay visible and usable" rule.
  nativeTheme.themeSource = "dark";
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0E1013",
    title: "woslicer-electron",
    webPreferences: {
      // Sandboxed preloads cannot require relative modules, so the build
      // inlines channels.js into this single-file bundle (bundle-preload.js).
      preload: path.join(__dirname, "preload.bundle.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  // Block navigation and popups entirely (single-page tool).
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

  void mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

interface LoadedSource {
  path: string;
  sampleRate: number;
  channels: number;
  length: number;
  data: Int16Array[];
}

let currentSource: LoadedSource | null = null;

function sourceExists(p: string): boolean {
  try {
    return fsSync.existsSync(p);
  } catch {
    return false;
  }
}

function requireSource(): LoadedSource {
  if (!currentSource) throw new Error("no audio source loaded");
  // Drag-and-dropped sources are fully decoded in memory (path "dropped:<name>")
  // and can be exported without the original file existing on disk.
  if (!currentSource.path.startsWith("dropped:") && !sourceExists(currentSource.path)) {
    throw new Error(`source file is missing on disk: ${currentSource.path}`);
  }
  return currentSource;
}

function asSource(src: LoadedSource) {
  return { sampleRate: src.sampleRate, channels: src.channels, length: src.length, data: src.data };
}

/** Loads a .wav/.ogg file; returns the transferable representation. */
async function loadAudioFile(filePath: unknown): Promise<unknown> {
  if (typeof filePath !== "string" || !hasAudioExtension(filePath)) {
    throw new Error(`unsupported audio file: ${String(filePath)}`);
  }
  const resolved = path.resolve(filePath);
  const bytes = await fs.readFile(resolved);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const decoded = resolved.toLowerCase().endsWith(".ogg")
    ? await decodeOgg(new Uint8Array(arrayBuffer))
    : parseWav(arrayBuffer);

  currentSource = {
    path: resolved,
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    length: decoded.length,
    data: decoded.data,
  };

  // Copy into plain ArrayBuffers for the structured-clone IPC trip.
  const channelData = decoded.data.map(
    (ch) => ch.buffer.slice(ch.byteOffset, ch.byteOffset + ch.byteLength) as ArrayBuffer
  );
  return {
    path: resolved,
    name: path.basename(resolved, path.extname(resolved)),
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    length: decoded.length,
    channelData,
  };
}

interface ExportAllRequest {
  dirPath: string;
  baseName: string;
  bpm: number;
  shift: number;
  fadeoutMs: number;
  noisegateDb: number;
  markers: number[];
}

function parseExportAllRequest(input: unknown): ExportAllRequest {
  if (typeof input !== "object" || input === null) throw new Error("exportAll requires a request object");
  const req = input as Record<string, unknown>;
  const dirPath = validateDirectoryPath(req.dirPath);
  if (!Array.isArray(req.markers) || !req.markers.every((m) => Number.isSafeInteger(m) && m >= 0 && m < 49152)) {
    throw new Error("exportAll requires markers as an array of tick integers in [0, 49152)");
  }
  for (const key of ["bpm", "shift", "fadeoutMs", "noisegateDb"] as const) {
    if (typeof req[key] !== "number" || !Number.isFinite(req[key] as number)) {
      throw new Error(`exportAll field ${key} must be a finite number`);
    }
  }
  // The original Cut() takes a double dB value; keep full precision here.
  const noisegateDb = req.noisegateDb as number;
  const baseName =
    typeof req.baseName === "string" && req.baseName.trim()
      ? req.baseName.replace(/[^\w.-]/g, "_")
      : "slice";
  return {
    dirPath: path.resolve(dirPath),
    baseName,
    bpm: req.bpm as number,
    shift: req.shift as number,
    fadeoutMs: Math.trunc(req.fadeoutMs as number),
    noisegateDb,
    markers: (req.markers as unknown[]).map((m) => Math.trunc(m as number)),
  };
}

function registerIpcHandlers(): void {
  // The renderer owns the persisted UI language; the native menu follows it.
  // Unknown values are rejected so a bad renderer cannot blank the menu.
  ipcMain.handle(CHANNELS.setLanguage, (_event, lang: unknown) => {
    if (!isLanguage(lang)) throw new Error("unsupported UI language: " + String(lang));
    if (lang === uiLanguage) return;
    uiLanguage = lang;
    rebuildMenu();
  });

  ipcMain.handle(CHANNELS.openFileDialog, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Load WAV / OGG",
      filters: [{ name: "wave files", extensions: ["wav", "ogg"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(CHANNELS.openWosDialog, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Load .wos",
      filters: [{ name: "wos files", extensions: ["wos"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(CHANNELS.saveWosDialog, async (_event, suggestedName: unknown) => {
    if (!mainWindow) return null;
    const name = typeof suggestedName === "string" && suggestedName.trim() ? suggestedName : "untitled.wos";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save .wos",
      defaultPath: name.endsWith(".wos") ? name : name + ".wos",
      filters: [{ name: "wos files", extensions: ["wos"] }],
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });

  ipcMain.handle(CHANNELS.exportSliceDialog, async (_event, suggestedName: unknown) => {
    if (!mainWindow) return null;
    const name = typeof suggestedName === "string" && suggestedName.trim() ? suggestedName : "slice.wav";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export slice WAV",
      defaultPath: name,
      filters: [{ name: "wave files", extensions: ["wav"] }],
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });

  ipcMain.handle(CHANNELS.exportAllDialog, async (_event, suggestedDir: unknown) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose export folder",
      defaultPath: typeof suggestedDir === "string" ? suggestedDir : undefined,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(CHANNELS.readAudioFile, (_event, filePath: unknown) => loadAudioFile(filePath));

  // Drag-and-drop path: the sandboxed renderer reads the File as an
  // ArrayBuffer and posts it here; only the extension is trusted from the name.
  ipcMain.handle(CHANNELS.decodeAudioBuffer, async (_event, name: unknown, buffer: unknown) => {
    if (typeof name !== "string") throw new Error("file name required");
    const bytes =
      buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer)
        : ArrayBuffer.isView(buffer)
          ? new Uint8Array((buffer as unknown as ArrayBufferView).buffer)
          : null;
    if (!bytes) throw new Error("audio payload must be an ArrayBuffer");
    const lower = name.toLowerCase();
    const decoded = lower.endsWith(".ogg")
      ? await decodeOgg(bytes)
      : parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    if (!lower.endsWith(".ogg") && !lower.endsWith(".wav")) {
      throw new Error(`unsupported audio file: ${name}`);
    }
    currentSource = {
      path: `dropped:${name}`,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      length: decoded.length,
      data: decoded.data,
    };
    const channelData = decoded.data.map(
      (ch) => ch.buffer.slice(ch.byteOffset, ch.byteOffset + ch.byteLength) as ArrayBuffer
    );
    return {
      path: currentSource.path,
      name: name.replace(/\.(wav|ogg)$/i, ""),
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      length: decoded.length,
      channelData,
    };
  });

  ipcMain.handle(CHANNELS.readWosFile, async (_event, filePath: unknown) => {
    const safePath = validateWosFilePath(filePath);
    return fs.readFile(path.resolve(safePath));
  });

  // Atomic write: stage to a temp file next to the target, then rename over
  // it, so a crash mid-write can never truncate an existing .wos project.
  ipcMain.handle(CHANNELS.writeWosFile, async (_event, filePath: unknown, bytes: unknown) => {
    const safePath = path.resolve(validateWosFilePath(filePath));
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 6168) {
      throw new Error(
        `.wos payload must be 6168 bytes (got ${bytes instanceof Uint8Array ? bytes.byteLength : typeof bytes})`
      );
    }
    const tempPath = `${safePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, bytes);
    try {
      await fs.rename(tempPath, safePath);
    } catch (err) {
      await fs.rm(tempPath, { force: true });
      throw err;
    }
  });

  ipcMain.handle(CHANNELS.exportSlice, (_event, request: unknown) => {
    const valid = validateExportRequest(request);
    const outputPath = path.resolve(validateWavOutputPath(valid.filePath));
    const src = requireSource();
    const rendered = renderSlice(asSource(src), {
      start: valid.start,
      end: valid.end,
      fadeoutMs: valid.fadeoutMs,
      noisegateDb: valid.noisegateDb,
    });
    return fs.writeFile(outputPath, encodeWav16(rendered.channelsData, rendered.sampleRate, rendered.length));
  });

  ipcMain.handle(CHANNELS.exportAll, async (_event, request: unknown) => {
    const parsed = parseExportAllRequest(request);
    const src = requireSource();
    const base: TimeBase = { bpm: parsed.bpm, shift: parsed.shift, sampleRate: src.sampleRate };
    const written: string[] = [];
    const sorted = [...parsed.markers].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      const startSample = tickToSampleExport(sorted[i], base);
      if (startSample > src.length) {
        // Original DoPrev: "元waveファイルの参照外です。" (start out of range).
        throw new Error(
          `slice ${i} (tick ${sorted[i]}) starts at sample ${startSample}, beyond the end of the source (${src.length} frames)`
        );
      }
      const endSample = i + 1 < sorted.length ? tickToSampleExport(sorted[i + 1], base) : src.length;
      const rendered = renderSlice(asSource(src), {
        start: startSample,
        end: endSample,
        fadeoutMs: parsed.fadeoutMs,
        noisegateDb: parsed.noisegateDb,
      });
      const fileName = `${parsed.baseName}_${String(i).padStart(3, "0")}.wav`;
      await fs.writeFile(path.join(parsed.dirPath, fileName), encodeWav16(rendered.channelsData, rendered.sampleRate, rendered.length));
      written.push(fileName);
    }
    return { written };
  });

  // BMSE clipboard: the exact custom format name carries the raw payload
  // bytes (UTF-8 incl. trailing NUL) via a ClipboardItem; the payload is ALSO
  // mirrored as text/plain because the original BMSE reads DataFormats.Text.
  ipcMain.handle(CHANNELS.writeClipboard, async (_event, text: unknown) => {
    if (typeof text !== "string") throw new Error("clipboard payload must be a string");
    const bytes = bmseTextToBuffer(text);
    const item = new ClipboardItem({
      [BMSE_CLIPBOARD_FORMAT_NAME]: new Blob([new Uint8Array(bytes)]),
      "text/plain": text,
    });
    await clipboard.write([item]);
  });

  ipcMain.handle(CHANNELS.readClipboard, async () => {
    try {
      const items = await clipboard.read();
      const item = items.find((i) => i.types.includes(BMSE_CLIPBOARD_FORMAT_NAME));
      if (item) {
        const blob = await item.getType(BMSE_CLIPBOARD_FORMAT_NAME);
        return bmseBufferToText(new Uint8Array(await blob.arrayBuffer()));
      }
    } catch {
      // custom format unavailable: fall through to plain text
    }
    return clipboard.readText();
  });
}

interface AppMenuAction {
  (action: string): void;
}

/** UI language of the native menu; the renderer is the source of truth. */
let uiLanguage: Language = "en";

const sendMenuAction: AppMenuAction = (action) => {
  mainWindow?.webContents.send(CHANNELS.menuAction, action);
};

function showAboutDialog(): void {
  const t = MENU_STRINGS[uiLanguage];
  void dialog.showMessageBox({
    type: "info",
    title: "woslicer-electron",
    message: t.aboutMessage,
    detail: t.aboutDetail,
  });
}

/**
 * (Re)builds the native application menu in the active UI language. Runs on
 * boot and again on every language change pushed from the renderer, so the
 * File/Edit/View/Help bar never lags behind the window.
 */
function rebuildMenu(): void {
  const template = menuTemplate(uiLanguage, { send: sendMenuAction, showAbout: showAboutDialog });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}


// Defensive: block navigation from any web contents created in this app.
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (e) => e.preventDefault());
});

void app.whenReady().then(() => {
  // First menu paint follows the OS locale; the renderer then pushes the
  // persisted choice, so a restart keeps the user's language.
  uiLanguage = languageFromLocale(app.getLocale());
  registerIpcHandlers();
  rebuildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
