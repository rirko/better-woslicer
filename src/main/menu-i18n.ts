/**
 * Native application menu, translated per UI language.
 *
 * Pure by design: it takes the language plus the two things the menu has to do
 * (forward a command id to the renderer, open the About box) and returns a
 * plain template. main.ts owns the Electron objects and calls
 * Menu.buildFromTemplate, so this module stays unit-testable without Electron.
 */

import type { MenuItemConstructorOptions } from "electron";
import type { Language } from "../core/language.js";

export interface MenuStrings {
  file: string;
  openAudio: string;
  openWos: string;
  saveWos: string;
  exportSlice: string;
  exportAll: string;
  exit: string;
  edit: string;
  undo: string;
  redo: string;
  copySelection: string;
  cutSelection: string;
  pasteSelection: string;
  quantizeSelection: string;
  copyMeasure: string;
  cutMeasure: string;
  pasteMeasure: string;
  clearMarkers: string;
  view: string;
  zoomIn: string;
  zoomOut: string;
  help: string;
  about: string;
  aboutMessage: string;
  aboutDetail: string;
}

export const MENU_STRINGS: Record<Language, MenuStrings> = {
  en: {
    file: "File",
    openAudio: "Open WAV/OGG...",
    openWos: "Open .wos...",
    saveWos: "Save .wos...",
    exportSlice: "Export slice WAV...",
    exportAll: "Export all slices...",
    exit: "Exit",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    copySelection: "Copy selected markers",
    cutSelection: "Cut selected markers",
    pasteSelection: "Paste selected markers",
    quantizeSelection: "Quantize selected markers",
    copyMeasure: "Copy measure (legacy)",
    cutMeasure: "Cut measure (legacy)",
    pasteMeasure: "Paste measure (legacy, Ctrl+F)",
    clearMarkers: "Clear all markers",
    view: "View",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    help: "Help",
    about: "About",
    aboutMessage: "woslicer-electron 0.1.0",
    aboutDetail:
      "Electron + TypeScript reimplementation of woslicerIII.\n" +
      "Slice DSP and .wos format are byte-compatible with the original.",
  },
  zh: {
    file: "文件",
    openAudio: "打开 WAV/OGG…",
    openWos: "打开 .wos…",
    saveWos: "保存 .wos…",
    exportSlice: "导出切片 WAV…",
    exportAll: "导出全部切片…",
    exit: "退出",
    edit: "编辑",
    undo: "撤销",
    redo: "重做",
    copySelection: "复制选中切点",
    cutSelection: "剪切选中切点",
    pasteSelection: "粘贴选中切点",
    quantizeSelection: "量化选中切点",
    copyMeasure: "复制小节（旧版）",
    cutMeasure: "剪切小节（旧版）",
    pasteMeasure: "粘贴小节（旧版，Ctrl+F）",
    clearMarkers: "清除全部切点",
    view: "视图",
    zoomIn: "放大",
    zoomOut: "缩小",
    help: "帮助",
    about: "关于",
    aboutMessage: "woslicer-electron 0.1.0",
    aboutDetail:
      "woslicerIII 的 Electron + TypeScript 重写版。\n" +
      "切片 DSP 与 .wos 格式与原版字节兼容。",
  },
  ja: {
    file: "ファイル",
    openAudio: "WAV/OGG を開く…",
    openWos: ".wos を開く…",
    saveWos: ".wos を保存…",
    exportSlice: "スライス WAV を書き出し…",
    exportAll: "すべてのスライスを書き出し…",
    exit: "終了",
    edit: "編集",
    undo: "元に戻す",
    redo: "やり直す",
    copySelection: "選択マーカーをコピー",
    cutSelection: "選択マーカーを切り取り",
    pasteSelection: "選択マーカーを貼り付け",
    quantizeSelection: "選択マーカーをクオンタイズ",
    copyMeasure: "小節をコピー（旧）",
    cutMeasure: "小節を切り取り（旧）",
    pasteMeasure: "小節を貼り付け（旧, Ctrl+F）",
    clearMarkers: "すべてのマーカーを消去",
    view: "表示",
    zoomIn: "拡大",
    zoomOut: "縮小",
    help: "ヘルプ",
    about: "バージョン情報",
    aboutMessage: "woslicer-electron 0.1.0",
    aboutDetail:
      "woslicerIII の Electron + TypeScript 実装。\n" +
      "スライス DSP と .wos 形式はオリジナルとバイト互換です。",
  },
  ko: {
    file: "파일",
    openAudio: "WAV/OGG 열기…",
    openWos: ".wos 열기…",
    saveWos: ".wos 저장…",
    exportSlice: "슬라이스 WAV 내보내기…",
    exportAll: "모든 슬라이스 내보내기…",
    exit: "종료",
    edit: "편집",
    undo: "실행 취소",
    redo: "다시 실행",
    copySelection: "선택한 마커 복사",
    cutSelection: "선택한 마커 잘라내기",
    pasteSelection: "선택한 마커 붙여넣기",
    quantizeSelection: "선택한 마커 양자화",
    copyMeasure: "마디 복사 (레거시)",
    cutMeasure: "마디 잘라내기 (레거시)",
    pasteMeasure: "마디 붙여넣기 (레거시, Ctrl+F)",
    clearMarkers: "모든 마커 지우기",
    view: "보기",
    zoomIn: "확대",
    zoomOut: "축소",
    help: "도움말",
    about: "정보",
    aboutMessage: "woslicer-electron 0.1.0",
    aboutDetail:
      "woslicerIII의 Electron + TypeScript 재구현입니다.\n" +
      "슬라이스 DSP와 .wos 형식은 원본과 바이트 호환입니다.",
  },
};

export interface MenuHandlers {
  /** Forwards a menu command id to the renderer. */
  send(action: string): void;
  /** Opens the localized About box. */
  showAbout(): void;
}

/** Builds the localized application menu template. */
export function menuTemplate(lang: Language, handlers: MenuHandlers): MenuItemConstructorOptions[] {
  const t = MENU_STRINGS[lang];
  return [
    {
      label: t.file,
      submenu: [
        { label: t.openAudio, accelerator: "CmdOrCtrl+O", click: () => handlers.send("open-audio") },
        { label: t.openWos, accelerator: "CmdOrCtrl+Shift+O", click: () => handlers.send("open-wos") },
        { label: t.saveWos, accelerator: "CmdOrCtrl+S", click: () => handlers.send("save-wos") },
        { type: "separator" },
        { label: t.exportSlice, accelerator: "CmdOrCtrl+E", click: () => handlers.send("export-slice") },
        { label: t.exportAll, accelerator: "CmdOrCtrl+Shift+E", click: () => handlers.send("export-all") },
        { type: "separator" },
        { label: t.exit, role: "quit" },
      ],
    },
    {
      label: t.edit,
      submenu: [
        { label: t.undo, accelerator: "CmdOrCtrl+Z", click: () => handlers.send("undo") },
        { label: t.redo, accelerator: "CmdOrCtrl+Shift+Z", click: () => handlers.send("redo") },
        { type: "separator" },
        { label: t.copySelection, accelerator: "CmdOrCtrl+C", click: () => handlers.send("copy-selection") },
        { label: t.cutSelection, accelerator: "CmdOrCtrl+X", click: () => handlers.send("cut-selection") },
        { label: t.pasteSelection, accelerator: "CmdOrCtrl+V", click: () => handlers.send("paste-selection") },
        { label: t.quantizeSelection, click: () => handlers.send("quantize") },
        { type: "separator" },
        // Legacy compatibility aliases (original woslicerIII measure model).
        { label: t.copyMeasure, click: () => handlers.send("measure-copy") },
        { label: t.cutMeasure, click: () => handlers.send("measure-cut") },
        { label: t.pasteMeasure, click: () => handlers.send("measure-paste") },
        { type: "separator" },
        { label: t.clearMarkers, click: () => handlers.send("clear-markers") },
      ],
    },
    {
      label: t.view,
      submenu: [
        { label: t.zoomIn, accelerator: "CmdOrCtrl+=", click: () => handlers.send("zoom-in") },
        { label: t.zoomOut, accelerator: "CmdOrCtrl+-", click: () => handlers.send("zoom-out") },
      ],
    },
    {
      label: t.help,
      submenu: [{ label: t.about, click: () => handlers.showAbout() }],
    },
  ];
}
