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

const platform = getPlatform();
const editor = useEditorStore(pinia);
const bmhelper = useBmhelperStore(pinia);
bmhelper.bindEditor(editor);
const workspace = createWorkspace({ platform, editor, confirmDiscardRecovery, confirmRelinkDifference, confirmLegacyImport });
const playback = createPlayback(editor);
provideWorkspace(workspace); providePlayback(playback);
const { t } = useI18n({ useScope: 'global' });
const { elementLocale } = localization;
const calibrating = ref(false), aboutOpen = ref(false), closing = ref(false), dragActive = ref(false);
const panelGeneration = ref(0);
const identity = shallowRef<BuildIdentity | null>(null);
const bpm = computed(() => { void editor.docRevision; return editor.doc.bpm; });
const commands = createCommands({ editor, workspace, playback, onClose: closeWorkspace, onOpenProject: openProject, onNewProjectFromWos: newProjectFromWos, onAbout: () => { aboutOpen.value = true; } });
let disposed = false;
let stopAppearance: (() => void) | undefined;
function report(error: unknown): void { if (!disposed) editor.setStatus('loadFailed', { message: error instanceof Error ? error.message : String(error) }, true); }
async function execute(command: AppCommand): Promise<void> { try { await commands.execute(command); } catch (error: unknown) { report(error); } }
async function confirmProjectReplacement(): Promise<boolean> {
  if (!editor.isDirty) return true;
  if (closing.value) return false;
  closing.value = true;
  try {
    await ElMessageBox.confirm(t('chrome.replaceProjectBody'), t('chrome.replaceProjectTitle'), {
      confirmButtonText: t('chrome.replaceProjectOk'), cancelButtonText: t('chrome.closeCancel'), type: 'warning',
    });
    return !disposed;
  } catch (error: unknown) { if (error !== 'cancel' && error !== 'close') report(error); return false; }
  finally { closing.value = false; }
}
async function confirmDiscardRecovery(): Promise<boolean> {
  if (closing.value) return false;
  closing.value = true;
  try {
    await ElMessageBox.confirm(t('chrome.discardRecoveryBody'), t('chrome.discardRecoveryTitle'), {
      confirmButtonText: t('chrome.discardRecoveryOk'), cancelButtonText: t('chrome.discardRecoveryCancel'), type: 'warning',
    });
    return !disposed;
  } catch (error: unknown) { if (error !== 'cancel' && error !== 'close') report(error); return false; }
  finally { closing.value = false; }
}
async function confirmRelinkDifference(difference: { current: string; selected: string }): Promise<boolean> {
  if (closing.value) return false;
  closing.value = true;
  try {
    await ElMessageBox.confirm(t('chrome.relinkDifferenceBody', difference), t('chrome.relinkDifferenceTitle'), {
      confirmButtonText: t('chrome.relinkDifferenceOk'), cancelButtonText: t('chrome.relinkDifferenceCancel'), type: 'warning',
    });
    return !disposed;
  } catch (error: unknown) { if (error !== 'cancel' && error !== 'close') report(error); return false; }
  finally { closing.value = false; }
}
async function confirmLegacyImport(summary: { name: string; bpm: number; shift: number; markers: number }): Promise<boolean> {
  if (closing.value) return false;
  closing.value = true;
  try {
    await ElMessageBox.confirm(t('chrome.legacyImportBody', summary), t('chrome.legacyImportTitle'), {
      confirmButtonText: t('chrome.legacyImportOk'), cancelButtonText: t('chrome.legacyImportCancel'), type: 'warning',
    });
    return !disposed;
  } catch (error: unknown) { if (error !== 'cancel' && error !== 'close') report(error); return false; }
  finally { closing.value = false; }
}
async function openProject(): Promise<void> {
  if (await confirmProjectReplacement()) { calibrating.value = false; await workspace.openProject(); }
}
async function newProjectFromWos(): Promise<void> {
  if (await confirmProjectReplacement()) { calibrating.value = false; await workspace.newProjectFromWos(); }
}
function keydown(event: KeyboardEvent): void { if (!calibrating.value && !aboutOpen.value && !closing.value) commands.onKeyDown(event); }
function calibrate(): void {
  if (!editor.source) { editor.setStatus('calibrationNeedsSource', true); return; }
  playback.stop(); calibrating.value = true;
}
function applyOffset(offset: number): void {
  if (!Number.isFinite(offset)) return;
  editor.tapOffsetMs = offset;
  editor.setStatus('tapOffsetApplied', { offset });
}
async function closeWorkspace(): Promise<void> {
  if (closing.value) return;
  closing.value = true;
  try {
    await ElMessageBox.confirm(t('chrome.closeConfirmBody'), t('chrome.closeConfirmTitle'), {
      confirmButtonText: t('chrome.closeOk'), cancelButtonText: t('chrome.closeCancel'), distinguishCancelAndClose: true, type: 'warning',
    });
    if (disposed) return;
    calibrating.value = false; playback.stop();
    await workspace.reset();
    bmhelper.reset(); panelGeneration.value++;
  } catch (error: unknown) { if (error !== 'cancel' && error !== 'close') report(error); }
  finally { closing.value = false; }
}
async function drop(event: DragEvent): Promise<void> {
  event.preventDefault(); dragActive.value = false;
  const file = event.dataTransfer?.files[0];
  if (file && /\.(wav|ogg|wosdx)$/i.test(file.name)) {
    if (/\.wosdx$/i.test(file.name) && !await confirmProjectReplacement()) return;
    calibrating.value = false; await workspace.openDroppedFile(file);
  }
}
onMounted(() => {
  stopAppearance = localization.syncAppearance(platform, report);
  window.addEventListener('keydown', keydown);
  void getBuildIdentity().then(value => { if (!disposed) identity.value = value; }).catch(report);
  void workspace.restoreSession().catch(report);
});
onUnmounted(() => {
  disposed = true; window.removeEventListener('keydown', keydown);
  stopAppearance?.();
  playback.dispose(); void workspace.dispose().catch(console.error);
});
</script>

<template>
  <ElConfigProvider :locale="elementLocale">
    <main class="app-shell" @dragenter.prevent="dragActive = true" @dragover.prevent @dragleave.self="dragActive = false" @drop="drop">
      <ApplicationMenu @command="execute" />
      <EditorToolbar :calibrating="calibrating" @command="execute" @calibrate="calibrate" />
      <section class="workspace">
        <div class="editor-column">
          <div class="playback-strip" :inert="calibrating"><PlaybackControls /></div>
          <TimelineEditor class="timeline" />
        </div>
        <WorkspacePanels :key="panelGeneration" :platform="platform" />
      </section>
      <StatusBar :identity="identity" @about="aboutOpen = true" />
      <CalibrationDialog v-model="calibrating" :audio-context="playback.getAudioContext()" :offset-ms="editor.tapOffsetMs" :bpm="bpm" @apply="applyOffset" />
      <AboutDialog v-model="aboutOpen" :identity="identity" />
      <div v-if="dragActive" class="drop-overlay">{{ t('chrome.emptySub') }}</div>
    </main>
  </ElConfigProvider>
</template>

<style>
@import 'element-plus/dist/index.css';
@import 'element-plus/theme-chalk/dark/css-vars.css';
@import './styles.css';
</style>
