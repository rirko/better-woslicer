/**
 * Renderer i18n: English / 中文.
 *
 * Static UI strings are translated by exact-text lookup over the visible chrome
 * (buttons, labels, tabs, hints, modal). Dynamic status-bar messages go through
 * a small pattern translator so common feedback (markers, exports, calibration,
 * band detect) also appears in Chinese. The choice is stored in localStorage.
 */

export type Language = "en" | "zh";
export const LANGUAGES: Language[] = ["en", "zh"];
const STORAGE_KEY = "woslicer.language";

let current: Language = "en";

/** English -> Chinese for static text nodes / titles. */
const ZH: Record<string, string> = {
  Open: "打开",
  Undo: "撤销",
  Redo: "重做",
  Snap: "吸附",
  Quantize: "量化",
  Copy: "复制",
  Paste: "粘贴",
  Mark: "打点",
  Export: "导出",
  Play: "播放",
  Stop: "停止",
  Cue: "提示音",
  Rate: "速率",
  Follow: "跟随",
  Calibrate: "校准",
  Bands: "频段",
  "Band detect": "频段检测",
  Low: "低频",
  Mid: "中频",
  High: "高频",
  Rise: "上升",
  "Min gap": "最小间隔",
  "Snap to grid (off = exact onset)": "吸附网格（关闭=按实际起音）",
  Detect: "检测",
  Source: "源文件",
  Cuts: "切点",
  Output: "输出",
  File: "文件",
  Format: "格式",
  Length: "长度",
  Duration: "时长",
  "Base name": "命名前缀",
  "Clip start no.": "起始编号",
  "FF numbering rule": "FF 编号规则",
  "Export slice at cursor": "导出光标处切片",
  "BMSE clipboard out (V)": "写入 BMSE 剪贴板 (V)",
  "BMSE clipboard in (B)": "读取 BMSE 剪贴板 (B)",
  "Save .wos (T)": "保存 .wos (T)",
  "Load .wos (Y)": "读取 .wos (Y)",
  "Edge detect": "边缘检测",
  "Clear markers (C)": "清除全部切点 (C)",
  "Drop a WAV/OGG anywhere, or press Open.": "拖入 WAV/OGG，或点击“打开”。",
  "No source loaded": "尚未载入音频",
  "Drop a WAV / OGG here or press Open": "拖入 WAV / OGG，或点击“打开”",
  "Empty: drop a WAV/OGG file to begin": "空：拖入 WAV/OGG 文件开始",
  "Tap calibration": "敲击校准",
  Restart: "重试",
  Finish: "完成",
  Apply: "应用",
  Close: "关闭",
  "Scope: whole track (no range selection)": "范围：整轨（未选择区域）",
  "Open WAV/OGG (Ctrl+O)": "打开 WAV/OGG（Ctrl+O）",
  "Undo (Ctrl+Z)": "撤销（Ctrl+Z）",
  "Redo (Ctrl+Shift+Z)": "重做（Ctrl+Shift+Z）",
  "Snap to grid": "吸附到网格",
  "Quantize markers to grid": "量化切点到网格",
  "Copy selected markers (Ctrl+C)": "复制选中的切点（Ctrl+C）",
  "Paste selected markers (Ctrl+V)": "粘贴选中的切点（Ctrl+V）",
  "Toggle marker at cursor (Z)": "光标处切换切点（Z）",
  "Export all slices (Ctrl+Shift+E)": "导出全部切片（Ctrl+Shift+E）",
  "Play / pause (Space)": "播放/暂停（空格）",
  "Follow playhead": "跟随播放头",
  "Tap calibration: continuous quarter-note clicks at the current BPM; tap Enter / , / . to measure your latency":
    "敲击校准：按当前 BPM 持续播放四分音符点击音；用 Enter / , / . 敲击以测量延迟",
  "Band overlay: Low / Mid / High envelopes (display only)": "频段叠加：低/中/高频包络（仅显示）",
  "Zoom out (-)": "缩小（-）",
  "Zoom in (+)": "放大（+）",
};

const TITLE_ZH: Record<string, string> = {
  "Monitor playback rate ([ slow down / ] speed up); markers and exports stay at source time":
    "监听播放速率（[ 减速 / ] 加速）；切点与导出始终按原始时间",
};

function translateTextNode(node: Text): void {
  const raw = node.nodeValue ?? "";
  const trimmed = raw.trim();
  if (!trimmed) return;
  const zh = ZH[trimmed];
  if (!zh) return;
  const start = raw.indexOf(trimmed);
  node.nodeValue = raw.slice(0, start) + zh + raw.slice(start + trimmed.length);
}

/** Applies the current language to the visible chrome. */
export function applyStaticTranslations(): void {
  document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
  const selectors = [
    "button",
    "label",
    "summary",
    ".side-tab",
    ".hint",
    ".empty-title",
    ".empty-sub",
    ".beats-note",
    ".band-field span",
    "span.bands-label",
  ].join(",");
  for (const el of document.querySelectorAll<HTMLElement>(selectors)) {
    if (current === "zh") {
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text);
      }
    } else {
      // Switching back: reverse-map the known Chinese strings.
      const reverse = new Map(Object.entries(ZH).map(([en, zh]) => [zh, en]));
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const text = node as Text;
        const raw = text.nodeValue ?? "";
        const trimmed = raw.trim();
        const en = reverse.get(trimmed);
        if (en) {
          const start = raw.indexOf(trimmed);
          text.nodeValue = raw.slice(0, start) + en + raw.slice(start + trimmed.length);
        }
      }
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>("[title]")) {
    const title = el.getAttribute("title") ?? "";
    if (current === "zh") {
      const zh = TITLE_ZH[title] ?? ZH[title];
      if (zh) el.setAttribute("title", zh);
    }
  }
}

/** Pattern translator for the status bar (English message -> Chinese). */
export function translateStatus(text: string): string {
  if (current !== "zh") return text;
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^Playing$/, () => "播放中"],
    [/^Paused$/, () => "已暂停"],
    [/^Stopped$/, () => "已停止"],
    [/^Break point at tick (\d+)$/, (m) => `已在 tick ${m[1]} 打点`],
    [/^Break point already at tick (\d+)$/, (m) => `tick ${m[1]} 已有切点`],
    [/^Added marker at tick (\d+)$/, (m) => `已在 tick ${m[1]} 添加切点`],
    [/^Marker already at tick (\d+)$/, (m) => `tick ${m[1]} 已有切点`],
    [/^Painted (\d+) marker\(s\)$/, (m) => `已绘制 ${m[1]} 个切点`],
    [/^Erased (\d+) marker\(s\)$/, (m) => `已擦除 ${m[1]} 个切点`],
    [/^Marker toggled at tick (\d+)$/, (m) => `已切换 tick ${m[1]} 的切点`],
    [/^Selected (\d+) marker\(s\)$/, (m) => `已选择 ${m[1]} 个切点`],
    [/^Moved (\d+) marker\(s\) by (-?\d+) ticks$/, (m) => `已移动 ${m[1]} 个切点 ${m[2]} tick`],
    [/^Quantized selected marker\(s\) to grid (\d+)$/, (m) => `已量化选中切点到网格 ${m[1]}`],
    [/^Copied (\d+) marker\(s\) as relative group/, (m) => `已复制 ${m[1]} 个切点（相对位置）`],
    [/^Pasted (\d+) marker\(s\) at tick (\d+)/, (m) => `已在 tick ${m[2]} 粘贴 ${m[1]} 个切点`],
    [/^Exported (\d+) slices/, (m) => `已导出 ${m[1]} 个切片`],
    [/^Exporting (\d+) slices/, (m) => `正在导出 ${m[1]} 个切片…`],
    [/^Band detect: \+(\d+) cuts/, (m) => `频段检测：新增 ${m[1]} 个切点`],
    [/^Band detect: 0 cuts/, () => "频段检测：未检测到切点"],
    [/^Tap offset applied: ([-+0-9.]+) ms/, (m) => `已应用敲击偏移 ${m[1]} ms`],
    [/^Tap calibration finished/, () => "敲击校准完成"],
    [/^Calibration closed$/, () => "校准已关闭"],
    [/^Playback rate: ([\d.]+×?)$/, (m) => `播放速率：${m[1]}`],
    [/^Grid: (\d+) ticks$/, (m) => `网格：${m[1]} tick`],
  ];
  for (const [re, fn] of rules) {
    const match = text.match(re);
    if (match) return text.replace(re, fn(match));
  }
  return text;
}

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // localStorage may be unavailable; the session still switches
  }
  applyStaticTranslations();
}

/** Call once at boot (before DOM wiring) to restore the saved language. */
export function initLanguage(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  current = saved === "zh" ? "zh" : "en";
}
