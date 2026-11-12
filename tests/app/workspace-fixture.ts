import { createPinia, disposePinia } from 'pinia';
import { createAudioProcessor, type AudioEngine } from '../../src/audio/audio-jobs';
import { useEditorStore } from '../../src/slicing/editor-store';
import { createWorkspace, type WorkspaceOptions } from '../../src/workspace/workspace';
import { encodeWav16 } from '../../src/core/wav';
import type { Platform, OpenedFile, OutputFile } from '../../src/platform/contracts';

/** Tests use the real DSP dispatcher, replacing only the unavailable browser Worker transport. */
export function processorEngine(): AudioEngine {
  const process = createAudioProcessor(); let id = 0; let disposed = false;
  function active(): void { if (disposed) throw new DOMException('Cancelled', 'AbortError'); }
  return {
    async decode(name, bytes) { active(); const reply = await process({ kind: 'decode', id: ++id, name, bytes }); if (reply.kind !== 'decoded') throw new Error(reply.kind === 'error' ? reply.message : 'Unexpected reply'); return reply; },
    async bands() { active(); const reply = await process({ kind: 'bands', id: ++id }); if (reply.kind !== 'bands') throw new Error('Unexpected reply'); return reply.analysis; },
    async detect(params) { active(); const reply = await process({ kind: 'detect', id: ++id, params }); if (reply.kind !== 'detected') throw new Error('Unexpected reply'); return reply.result; },
    async slice(params) { active(); const reply = await process({ kind: 'slice', id: ++id, params }); if (reply.kind !== 'slice') throw new Error('Unexpected reply'); return reply.bytes; },
    async edges(base) { active(); const reply = await process({ kind: 'edges', id: ++id, base }); if (reply.kind !== 'edges') throw new Error('Unexpected reply'); return reply.ticks; },
    dispose() { disposed = true; },
  };
}
export function audioFile(name = 'tone.wav', frames = 48000): OpenedFile {
  const pcm = Int16Array.from({ length: frames }, (_, i) => Math.round(Math.sin(i / 12) * 16000));
  return { name, reference: `/audio/${name}`, bytes: encodeWav16([pcm], 48000, pcm.length) };
}
export function fixture(createEngine = processorEngine) {
  const pinia = createPinia(), editor = useEditorStore(pinia);
  const saved: OutputFile[] = [], exported: OutputFile[] = [];
  let session: unknown = null;
  let opened: OpenedFile | null = null;
  let clipboard = '';
  const platform: Platform = {
    kind: 'browser',
    async openFile() { return opened; },
    async reopenFile(reference) { if (opened?.reference === reference) return opened; throw new Error('Missing source'); },
    async saveFile(_kind, name, bytes) { saved.push({ name, bytes }); return true; },
    async exportFiles(files) { let count = 0; for await (const file of files) { exported.push(file); count++; } return count; },
    async readClipboard() { return clipboard; }, async writeClipboard(value) { clipboard = value; },
    async readSession() { return session; }, async writeSession(value) { session = value; }, async clearSession() { session = null; },
    async importLegacySession() { return null; },
    async setTheme() {},
  };
  const confirmOptions: {
    confirmDiscardRecovery?: WorkspaceOptions['confirmDiscardRecovery'];
    confirmRelinkDifference?: WorkspaceOptions['confirmRelinkDifference'];
    confirmLegacyImport?: WorkspaceOptions['confirmLegacyImport'];
  } = {};
  const workspace = createWorkspace({
    editor, platform, createEngine,
    confirmDiscardRecovery: block => confirmOptions.confirmDiscardRecovery?.(block) ?? false,
    confirmRelinkDifference: difference => confirmOptions.confirmRelinkDifference?.(difference) ?? false,
    confirmLegacyImport: summary => confirmOptions.confirmLegacyImport?.(summary) ?? false,
  });
  return { pinia, editor, workspace, platform, saved, exported, confirmOptions, get session() { return session; }, set session(value: unknown) { session = value; }, set opened(value: OpenedFile | null) { opened = value; }, async dispose() { await workspace.dispose(); disposePinia(pinia); } };
}
