<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { ElConfigProvider, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { pinia, localization } from './runtime';
import { createCommands } from './commands';
import ApplicationMenu from './components/ApplicationMenu.vue';
import { getPlatform, getBuildIdentity } from '../platform';
import type { BuildIdentity } from '../platform/contracts';
import type { AppCommand } from './command-types';
import { useEditorStore } from '../slicing/editor-store';
import { useBmhelperStore } from '../bmhelper/store';
import { createWorkspace, provideWorkspace } from '../workspace/workspace';
import { createPlayback, providePlayback } from '../playback';
import TimelineEditor from '../timeline/TimelineEditor.vue';
import PlaybackControls from '../playback/PlaybackControls.vue';
import CalibrationDialog from '../calibration/CalibrationDialog.vue';
import EditorToolbar from './components/EditorToolbar.vue';
import WorkspacePanels from './components/WorkspacePanels.vue';
import StatusBar from './components/StatusBar.vue';
import AboutDialog from './components/AboutDialog.vue';

// Assembly: platform, stores, workspace and playback providers.
const platform = getPlatform();
const editor = useEditorStore(pinia);
const bmhelper = useBmhelperStore(pinia);
bmhelper.bindEditor(editor);
const workspace = createWorkspace({
  platform,
  editor,
  confirmDiscardRecovery,
  confirmRelinkDifference,
  confirmLegacyImport,
});
const playback = createPlayback(editor);
provideWorkspace(workspace);
providePlayback(playback);
// Localized app state.
const { t } = useI18n({ useScope: 'global' });
const { elementLocale } = localization;
const calibrating = ref(false);
const aboutOpen = ref(false);
const closing = ref(false);
const dragActive = ref(false);
const panelGeneration = ref(0);
const identity = shallowRef<BuildIdentity | null>(null);
const bpm = computed(() => {
  void editor.docRevision;
  return editor.doc.bpm;
});
// Command dispatch for menu and toolbar events.
const commands = createCommands({
  editor,
  workspace,
  playback,
  onClose: closeWorkspace,
  onOpenProject: openProject,
  onNewProjectFromWos: newProjectFromWos,
  onAbout: () => {
    aboutOpen.value = true;
  },
});
// Unmount guard, status reporting and command execution.
let disposed = false;
let stopAppearance: (() => void) | undefined;
function report(error: unknown): void {
  if (!disposed)
    editor.setStatus(
      'loadFailed',
      { message: error instanceof Error ? error.message : String(error) },
      true,
    );
}
async function execute(command: AppCommand): Promise<void> {
  try {
    await commands.execute(command);
  } catch (error: unknown) {
    report(error);
  }
}
// Confirmation dialogs; the shared closing lock rejects reentry.
// Shared boolean-confirmation protocol: one closing lock, one MessageBox call,
// cancellation filtered from error reporting. Callers pass pre-translated text.
async function confirmAction(options: {
  body: string;
  title: string;
  confirmButtonText: string;
  cancelButtonText: string;
}): Promise<boolean> {
  if (closing.value) return false;
  closing.value = true;
  try {
    await ElMessageBox.confirm(options.body, options.title, {
      confirmButtonText: options.confirmButtonText,
      cancelButtonText: options.cancelButtonText,
      type: 'warning',
    });
    return !disposed;
  } catch (error: unknown) {
    if (error !== 'cancel' && error !== 'close') report(error);
    return false;
  } finally {
    closing.value = false;
  }
}
async function confirmProjectReplacement(): Promise<boolean> {
  if (!editor.isDirty) return true;
  return confirmAction({
    body: t('chrome.replaceProjectBody'),
    title: t('chrome.replaceProjectTitle'),
    confirmButtonText: t('chrome.replaceProjectOk'),
    cancelButtonText: t('chrome.closeCancel'),
  });
}
async function confirmDiscardRecovery(): Promise<boolean> {
  return confirmAction({
    body: t('chrome.discardRecoveryBody'),
    title: t('chrome.discardRecoveryTitle'),
    confirmButtonText: t('chrome.discardRecoveryOk'),
    cancelButtonText: t('chrome.discardRecoveryCancel'),
  });
}
async function confirmRelinkDifference(difference: {
  current: string;
  selected: string;
}): Promise<boolean> {
  return confirmAction({
    body: t('chrome.relinkDifferenceBody', difference),
    title: t('chrome.relinkDifferenceTitle'),
    confirmButtonText: t('chrome.relinkDifferenceOk'),
    cancelButtonText: t('chrome.relinkDifferenceCancel'),
  });
}
async function confirmLegacyImport(summary: {
  name: string;
  bpm: number;
  shift: number;
  markers: number;
}): Promise<boolean> {
  return confirmAction({
    body: t('chrome.legacyImportBody', summary),
    title: t('chrome.legacyImportTitle'),
    confirmButtonText: t('chrome.legacyImportOk'),
    cancelButtonText: t('chrome.legacyImportCancel'),
  });
}
// Project open and import commands that require confirmation.
async function openProject(): Promise<void> {
  if (await confirmProjectReplacement()) {
    calibrating.value = false;
    await workspace.openProject();
  }
}
async function newProjectFromWos(): Promise<void> {
  if (await confirmProjectReplacement()) {
    calibrating.value = false;
    await workspace.newProjectFromWos();
  }
}
// Keyboard gating, calibration entry and tap offset.
function keydown(event: KeyboardEvent): void {
  if (!calibrating.value && !aboutOpen.value && !closing.value) commands.onKeyDown(event);
}
function calibrate(): void {
  if (!editor.source) {
    editor.setStatus('calibrationNeedsSource', true);
    return;
  }
  playback.stop();
  calibrating.value = true;
}
function applyOffset(offset: number): void {
  if (!Number.isFinite(offset)) return;
  editor.tapOffsetMs = offset;
  editor.setStatus('tapOffsetApplied', { offset });
}
// Workspace close keeps its own lock across confirm, playback stop and full reset.
async function closeWorkspace(): Promise<void> {
  if (closing.value) return;
  closing.value = true;
  try {
    await ElMessageBox.confirm(t('chrome.closeConfirmBody'), t('chrome.closeConfirmTitle'), {
      confirmButtonText: t('chrome.closeOk'),
      cancelButtonText: t('chrome.closeCancel'),
      distinguishCancelAndClose: true,
      type: 'warning',
    });
    if (disposed) return;
    calibrating.value = false;
    playback.stop();
    await workspace.reset();
    bmhelper.reset();
    panelGeneration.value++;
  } catch (error: unknown) {
    if (error !== 'cancel' && error !== 'close') report(error);
  } finally {
    closing.value = false;
  }
}
// Drag and drop of project or audio files.
async function drop(event: DragEvent): Promise<void> {
  event.preventDefault();
  dragActive.value = false;
  const file = event.dataTransfer?.files[0];
  if (file && /\.(wav|ogg|wosdx)$/i.test(file.name)) {
    if (/\.wosdx$/i.test(file.name) && !(await confirmProjectReplacement())) return;
    calibrating.value = false;
    await workspace.openDroppedFile(file);
  }
}
// Lifecycle.
onMounted(() => {
  stopAppearance = localization.syncAppearance(platform, report);
  window.addEventListener('keydown', keydown);
  void getBuildIdentity()
    .then((value) => {
      if (!disposed) identity.value = value;
    })
    .catch(report);
  void workspace.restoreSession().catch(report);
});
onUnmounted(() => {
  disposed = true;
  window.removeEventListener('keydown', keydown);
  stopAppearance?.();
  playback.dispose();
  void workspace.dispose().catch(console.error);
});
</script>

<template>
  <ElConfigProvider :locale="elementLocale">
    <main
      class="app-shell"
      @dragenter.prevent="dragActive = true"
      @dragover.prevent
      @dragleave.self="dragActive = false"
      @drop="drop"
    >
      <!-- menu -->
      <ApplicationMenu @command="execute" />
      <!-- toolbar: file actions, undo, calibration, preferences, document options -->
      <EditorToolbar
        :calibrating="calibrating"
        @command="execute"
        @calibrate="calibrate"
      />
      <!-- workspace: playback strip and timeline on the left, side panels on the right -->
      <section class="workspace">
        <div class="editor-column">
          <div
            class="playback-strip"
            :inert="calibrating"
          >
            <PlaybackControls />
          </div>
          <TimelineEditor class="timeline" />
        </div>
        <WorkspacePanels :key="panelGeneration" />
      </section>
      <!-- status bar -->
      <StatusBar
        :identity="identity"
        @about="aboutOpen = true"
      />
      <!-- dialogs -->
      <CalibrationDialog
        v-model="calibrating"
        :audio-context="playback.getAudioContext()"
        :offset-ms="editor.tapOffsetMs"
        :bpm="bpm"
        @apply="applyOffset"
      />
      <AboutDialog
        v-model="aboutOpen"
        :identity="identity"
      />
      <!-- drop overlay -->
      <div
        v-if="dragActive"
        class="drop-overlay"
      >
        {{ t('chrome.emptySub') }}
      </div>
    </main>
  </ElConfigProvider>
</template>

<style>
@import 'element-plus/dist/index.css';
@import 'element-plus/theme-chalk/dark/css-vars.css';
@import './styles.css';

/*
 * App-owned, intentionally unscoped layout rules moved verbatim from src/app/styles.css.
 * Unscoped on purpose: `.workspace > .side-panel` is a cascade contract crossing the
 * App/WorkspacePanels parent-child boundary and must beat the child's equal-specificity
 * scoped CSS by source order; this position (after every child's scoped CSS) is
 * equivalent to the original styles.css position.
 */

/* App shell: full-height column that hosts menu, toolbar, workspace and status bar. */
.app-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 520px;
}

/* Workspace split: editor column (playback strip + timeline) beside the side panel. */
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 30%);
  flex: 1;
  min-height: 0;
}
.editor-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.playback-strip {
  padding: 8px 10px;
  border-bottom: 1px solid var(--el-border-color);
}
.timeline {
  flex: 1;
  min-height: 180px;
}

/* Drop overlay shown while dragging files onto the window. */
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  border: 3px dashed var(--el-color-primary);
  background: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
  color: var(--el-color-primary);
  font-size: 22px;
  pointer-events: none;
}

/* Narrow window: the side panel becomes a fixed-width column. */
@media (max-width: 900px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr) 310px;
  }
}

/* Very narrow window: workspace stacks vertically; .side-panel is owned by WorkspacePanels.vue. */
@media (max-width: 680px) {
  .app-shell {
    height: auto;
    min-height: 100%;
  }
  .workspace {
    display: flex;
    flex-direction: column;
  }
  .editor-column {
    min-height: 360px;
  }
  .workspace > .side-panel {
    min-height: 250px;
    border-left: 0;
    border-top: 1px solid var(--el-border-color);
  }
}
</style>
