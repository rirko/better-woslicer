import type { CueMode } from '../slicing/editor-store';

/** Local synthesized monitoring cues; none of these nodes enters export DSP. */
export function createCueSynth(context: AudioContext) {
  const master = context.createGain();
  master.connect(context.destination);
  const voices = new Set<() => void>();
  let disposed = false;

  function trigger(mode: CueMode): void {
    if (disposed || mode === 'off') return;
    const now = context.currentTime;
    const output = context.createGain();
    const nodes: AudioNode[] = [output];
    const sources: AudioScheduledSourceNode[] = [];
    const duration = mode === 'triangle' ? .95 : mode === 'cowbell' ? .26 : .07;
    output.gain.setValueAtTime(mode === 'triangle' ? .7 : .9, now);
    output.gain.exponentialRampToValueAtTime(.001, now + duration - (mode === 'triangle' ? .05 : .01));
    output.connect(master);
    function oscillator(frequency: number, type: OscillatorType, destination: AudioNode): void {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      oscillator.connect(destination);
      nodes.push(oscillator);
      sources.push(oscillator);
      oscillator.start(now);
      oscillator.stop(now + duration);
    }
    if (mode === 'cowbell') {
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = 2640; filter.Q.value = 1.2;
      filter.connect(output); nodes.push(filter);
      oscillator(560, 'square', filter); oscillator(845, 'square', filter);
    } else if (mode === 'triangle') {
      for (const partial of [{ frequency: 2637, gain: 1 }, { frequency: 3951, gain: .4 }, { frequency: 5274, gain: .2 }]) {
        const gain = context.createGain(); gain.gain.value = partial.gain;
        gain.connect(output); nodes.push(gain);
        oscillator(partial.frequency, 'sine', gain);
      }
    } else {
      oscillator(1568, 'sine', output);
      const length = Math.max(1, Math.floor(context.sampleRate * .01));
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index++) data[index] = (Math.random() * 2 - 1) * (1 - index / length);
      const noise = context.createBufferSource(); noise.buffer = buffer;
      const gain = context.createGain(); gain.gain.value = .35;
      noise.connect(gain); gain.connect(output);
      nodes.push(noise, gain); sources.push(noise); noise.start(now);
    }
    let remaining = sources.length;
    const release = () => {
      for (const source of sources) {
        source.onended = null;
        try { source.stop(); } catch { /* An already ended voice needs only disconnection. */ }
      }
      for (const node of nodes) node.disconnect();
      voices.delete(release);
    };
    voices.add(release);
    for (const source of sources) source.onended = () => { if (--remaining === 0) release(); };
  }
  return {
    trigger,
    setVolume(value: number): void { master.gain.value = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; },
    silence(): void { for (const release of [...voices]) release(); },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const release of [...voices]) release();
      master.disconnect();
    },
  };
}
