import { createAudioProcessor, type AudioRequest } from './audio-jobs';

const process = createAudioProcessor();
// Queue requests: a decode must finish before dependent analysis or rendering.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<AudioRequest>): void => {
  queue = queue.then(async () => {
    const reply = await process(event.data);
    // The worker retains PCM for subsequent slices; only slice output is transferred.
    if (reply.kind === 'slice') self.postMessage(reply, { transfer: [reply.bytes.buffer] });
    else self.postMessage(reply);
  });
};
