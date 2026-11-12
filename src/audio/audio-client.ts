import type { AudioEngine, AudioReply, AudioRequest } from './audio-jobs';

export function createAudioEngine(): AudioEngine {
  const worker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' });
  let sequence = 0;
  let disposed = false;
  const pending = new Map<number, { resolve: (reply: AudioReply) => void; reject: (error: Error) => void }>();
  function fail(error: Error): void { for (const task of pending.values()) task.reject(error); pending.clear(); }
  worker.onmessage = (event: MessageEvent<AudioReply>) => {
    const reply = event.data;
    const task = pending.get(reply.id);
    if (!task) return;
    pending.delete(reply.id);
    if (reply.kind === 'error') task.reject(new Error(reply.message));
    else task.resolve(reply);
  };
  worker.onerror = event => { disposed = true; worker.terminate(); fail(new Error(event.message || 'Audio worker failed')); };
  worker.onmessageerror = () => { disposed = true; worker.terminate(); fail(new Error('Invalid audio worker message')); };
  function request(message: AudioRequest): Promise<AudioReply> {
    if (disposed) return Promise.reject(new DOMException('Audio task cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
      pending.set(message.id, { resolve, reject });
      try { worker.postMessage(message); } catch (error) { pending.delete(message.id); reject(error); }
    });
  }
  return {
    async decode(name, bytes) { const reply = await request({ kind: 'decode', id: ++sequence, name, bytes }); if (reply.kind !== 'decoded') throw new Error('Unexpected decode response'); return reply; },
    async bands() { const reply = await request({ kind: 'bands', id: ++sequence }); if (reply.kind !== 'bands') throw new Error('Unexpected analysis response'); return reply.analysis; },
    async detect(params) { const reply = await request({ kind: 'detect', id: ++sequence, params }); if (reply.kind !== 'detected') throw new Error('Unexpected detection response'); return reply.result; },
    async slice(params) { const reply = await request({ kind: 'slice', id: ++sequence, params }); if (reply.kind !== 'slice') throw new Error('Unexpected slice response'); return reply.bytes; },
    async edges(base) { const reply = await request({ kind: 'edges', id: ++sequence, base }); if (reply.kind !== 'edges') throw new Error('Unexpected edge response'); return reply.ticks; },
    dispose() { if (disposed) return; disposed = true; worker.terminate(); fail(new DOMException('Audio task cancelled', 'AbortError')); },
  };
}
