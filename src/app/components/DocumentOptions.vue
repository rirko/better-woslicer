<script setup lang="ts">
import { computed } from 'vue';
import { ElCheckbox, ElInputNumber, ElOption, ElSelect } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { GRID_DENSITIES } from '../../core/gridlines';
import { useEditorStore } from '../../slicing/editor-store';
import { FADE_INPUT_LIMITS, GATE_INPUT_LIMITS } from '../../slicing/control-limits';
const editor = useEditorStore();
const { t } = useI18n();
// Document fields are read through docRevision and written via editor transactions.
type Option = 'bpm' | 'shift' | 'fadeoutMs' | 'noisegateDb';
function option(key: Option) {
  return computed({
    get() {
      void editor.docRevision;
      return editor.doc[key];
    },
    set(value: number | undefined) {
      if (typeof value === 'number') editor.setDocumentOptions({ [key]: value });
    },
  });
}
// Bound fields used by the template.
const bpm = option('bpm');
const shift = option('shift');
const fade = option('fadeoutMs');
const gate = option('noisegateDb');

// Session toggle: enables or disables the noisegate without touching its level.
const gateEnabled = computed({
  get: () => editor.noisegateEnabled,
  set: (value: boolean) => editor.setNoisegateEnabled(value),
});
// Grid density is a session property restricted to canonical densities.
function setGrid(value: unknown): void {
  if (typeof value === 'number' && GRID_DENSITIES.includes(value)) editor.grid = value;
}
</script>
<template>
  <div class="document-options">
    <!-- document options row: bpm, grid, snap, shift, fade, gate.
         Labels are inline, so each label text must stay adjacent to its control;
         the folded closing tags below are formatter-mandated. -->
    <label
      >{{ t('chrome.bpmLabel')
      }}<ElInputNumber
        v-model="bpm"
        :aria-label="t('chrome.bpmLabel')"
        :min="0.01"
        :step="0.1"
        :controls="false"
        size="small"
    /></label>
    <label
      >{{ t('chrome.gridLabel')
      }}<ElSelect
        :model-value="editor.grid"
        :aria-label="t('chrome.gridLabel')"
        size="small"
        @update:model-value="setGrid"
        ><ElOption
          v-for="density in GRID_DENSITIES"
          :key="density"
          :value="density"
          :label="String(density)" /></ElSelect
    ></label>
    <ElCheckbox
      v-model="editor.snap"
      :title="t('chrome.titleSnap')"
      >{{ t('chrome.snap') }}</ElCheckbox
    >
    <label
      >{{ t('chrome.shiftLabel')
      }}<ElInputNumber
        v-model="shift"
        :aria-label="t('chrome.shiftLabel')"
        :step="1"
        :controls="false"
        size="small"
    /></label>
    <label
      >{{ t('chrome.fadeLabel')
      }}<ElInputNumber
        v-model="fade"
        :aria-label="t('chrome.fadeLabel')"
        :min="FADE_INPUT_LIMITS.min"
        :max="FADE_INPUT_LIMITS.max"
        :step="1"
        :precision="0"
        :controls="false"
        size="small"
    /></label>
    <label
      >{{ t('chrome.gateLabel')
      }}<ElInputNumber
        v-model="gate"
        :aria-label="t('chrome.gateLabel')"
        :min="GATE_INPUT_LIMITS.min"
        :max="GATE_INPUT_LIMITS.max"
        :step="1"
        :controls="false"
        size="small"
    /></label>
    <ElCheckbox v-model="gateEnabled">{{ t('chrome.gateCheckbox') }}</ElCheckbox>
  </div>
</template>
<style scoped>
.document-options {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
}
label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  white-space: nowrap;
}
.el-input-number {
  width: 84px;
}
.el-select {
  width: 72px;
}
.el-checkbox {
  margin-right: 0;
}
</style>
