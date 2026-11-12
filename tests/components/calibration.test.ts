import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, disposePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { setupI18n } from '../../src/i18n/setup';
import CalibrationDialog from '../../src/calibration/CalibrationDialog.vue';

const calls = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
  tap: vi.fn(),
  schedule: vi.fn(),
  matched: 0,
}));
vi.mock('../../src/calibration/TapCalibrator', () => ({
  TapCalibrator: class {
    start(bpm: number) {
      calls.start(bpm);
    }
    cancel() {
      calls.cancel();
    }
    tap() {
      calls.tap();
      calls.matched++;
    }
    ensureScheduled() {
      calls.schedule();
    }
    currentResult() {
      return {
        total: calls.matched,
        matched: calls.matched,
        medianMs: 31.4,
        meanMs: 31.4,
        stdMs: 0,
        offsetsMs: [],
      };
    }
    elapsedBeats() {
      return 3;
    }
    finish() {
      return this.currentResult();
    }
  },
}));

enableAutoUnmount(afterEach);
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  calls.matched = 0;
});
function setup() {
  vi.useFakeTimers();
  const pinia = createPinia();
  const translation = setupI18n(pinia, { storage: null, locales: ['en'] });
  // The audio scheduler is mocked; this fixture represents only the state the dialog reads.
  const context = { state: 'running' } as AudioContext;
  const wrapper = mount(CalibrationDialog, {
    props: { modelValue: true, audioContext: context, offsetMs: 0, bpm: 150 },
    global: {
      plugins: [pinia, translation.i18n],
      stubs: {
        ElButton: {
          props: ['disabled'],
          template: '<button :disabled="disabled"><slot /></button>',
        },
        ElDialog: { template: '<div><slot /><slot name="footer" /></div>' },
      },
    },
  });
  return {
    wrapper,
    dispose() {
      wrapper.unmount();
      translation.stop();
      disposePinia(pinia);
    },
  };
}

describe('tap calibration dialog', () => {
  it('owns tap keys, ignores repeat, applies the median, and cancels scheduling on close', async () => {
    const instance = setup();
    const timelineKey = vi.fn();
    window.addEventListener('keydown', timelineKey);
    expect(calls.start).toHaveBeenCalledWith(150);
    for (const key of ['Enter', ',', '.'])
      window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true }));
    await nextTick();
    expect(calls.tap).toHaveBeenCalledTimes(3);
    expect(timelineKey).not.toHaveBeenCalled();
    const apply = instance.wrapper.findAll('button').find((button) => button.text() === 'Apply');
    expect(apply).toBeDefined();
    await apply?.trigger('click');
    expect(instance.wrapper.emitted('apply')).toEqual([[31]]);
    expect(instance.wrapper.emitted('update:modelValue')).toEqual([[false]]);
    const scheduled = calls.schedule.mock.calls.length;
    vi.runOnlyPendingTimers();
    expect(calls.schedule).toHaveBeenCalledTimes(scheduled);
    expect(vi.getTimerCount()).toBe(0);
    expect(calls.cancel).toHaveBeenCalled();
    instance.dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(timelineKey).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', timelineKey);
  });
  it('freezes results on Finish, keeps marker keys isolated, and cleans Escape/unmount', async () => {
    const instance = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const finish = instance.wrapper.findAll('button').find((button) => button.text() === 'Finish');
    await finish?.trigger('click');
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '.' }));
    expect(calls.tap).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(instance.wrapper.emitted('update:modelValue')).toEqual([[false]]);
    expect(instance.wrapper.emitted('apply')).toBeUndefined();
    instance.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops the active session when the parent closes it', async () => {
    const instance = setup();
    await instance.wrapper.setProps({ modelValue: false });
    expect(vi.getTimerCount()).toBe(0);
    expect(calls.cancel).toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(calls.tap).not.toHaveBeenCalled();
    instance.dispose();
  });
});
