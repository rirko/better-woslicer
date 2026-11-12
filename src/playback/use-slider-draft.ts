import { computed, ref, type ComputedRef, type Ref } from 'vue';

export interface SliderDraft {
  draft: Ref<number | null>;
  displayValue: ComputedRef<number>;
  onUpdate: (value: number | number[]) => void;
  commit: () => void;
}

// One ElSlider draft protocol: drag updates land in a local draft (number
// payloads only), and the release event commits draft ?? bound exactly once.
// The helper manages slider positions only; unit conversion stays with the
// caller. Each call creates an independent draft.
export function useSliderDraft(
  readValue: () => number,
  commitValue: (value: number) => void,
): SliderDraft {
  const draft = ref<number | null>(null);
  const displayValue = computed(() => draft.value ?? readValue());
  function onUpdate(value: number | number[]): void {
    if (typeof value === 'number') draft.value = value;
  }
  function commit(): void {
    const target = draft.value ?? readValue();
    draft.value = null;
    commitValue(target);
  }
  return { draft, displayValue, onUpdate, commit };
}
