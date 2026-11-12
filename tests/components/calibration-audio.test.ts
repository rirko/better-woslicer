import { describe, expect, it, vi } from 'vitest';
import { TapCalibrator } from '../../src/calibration/TapCalibrator';

function audioFixture() {
  const oscillators: {
    frequency: { value: number };
    type: string;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }[] = [];
  const gains: {
    gain: {
      setValueAtTime: ReturnType<typeof vi.fn>;
      exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const clock = {
    currentTime: 0,
    destination: {},
    createOscillator() {
      const node = {
        frequency: { value: 0 },
        type: '',
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      oscillators.push(node);
      return node;
    },
    createGain() {
      const node = {
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(node);
      return node;
    },
  };
  // Partial Web Audio fixture: it implements exactly the methods exercised by the engine.
  return { context: clock as unknown as AudioContext, clock, oscillators, gains };
}

describe('calibration audio session', () => {
  it('schedules at project BPM, measures audio-clock latency and disconnects all nodes', () => {
    const fixture = audioFixture();
    const session = new TapCalibrator(fixture.context);
    session.start(120);
    expect(fixture.oscillators[0].start).toHaveBeenCalledWith(0.2);
    expect(fixture.oscillators[1].start).toHaveBeenCalledWith(0.7);
    fixture.clock.currentTime = 0.23;
    session.tap();
    fixture.clock.currentTime = 0.73;
    session.tap();
    const result = session.finish();
    expect(result.matched).toBe(2);
    expect(result.medianMs).toBeCloseTo(30);
    expect(session.isActive()).toBe(false);
    for (const node of fixture.oscillators) {
      expect(node.stop).toHaveBeenCalledTimes(2);
      expect(node.disconnect).toHaveBeenCalled();
      expect(node.onended).toBeNull();
    }
    for (const node of fixture.gains) expect(node.disconnect).toHaveBeenCalled();
    const count = fixture.oscillators.length;
    fixture.clock.currentTime = 10;
    session.ensureScheduled();
    expect(fixture.oscillators).toHaveLength(count);
  });
  it('rejects invalid BPM without leaving an active session', () => {
    const fixture = audioFixture();
    const session = new TapCalibrator(fixture.context);
    expect(() => session.start(0)).toThrow();
    expect(session.isActive()).toBe(false);
    expect(fixture.oscillators).toHaveLength(0);
  });
});
