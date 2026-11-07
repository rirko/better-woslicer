import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dbToAmp,
  ampToDb,
  sliderToDb,
  dbToSlider,
  DEFAULT_PLAYBACK_DB,
  DEFAULT_CUE_DB,
  VOLUME_SLIDER_RANGE_DB,
} from "../src/core/volume.js";

test("dB to amplitude follows the 20*log10 convention", () => {
  assert.equal(dbToAmp(0), 1);
  assert.ok(Math.abs(dbToAmp(-10) - 0.3162) < 0.001);
  assert.ok(Math.abs(dbToAmp(-6) - 0.5012) < 0.001);
});

test("ampToDb inverts dbToAmp", () => {
  for (const db of [0, -6, -10, -60]) {
    assert.ok(Math.abs(ampToDb(dbToAmp(db)) - db) < 1e-9, `db ${db}`);
  }
});

test("slider positions map onto the -60..0 dB fader range", () => {
  assert.equal(sliderToDb(100), 0);
  assert.equal(sliderToDb(0), -VOLUME_SLIDER_RANGE_DB);
  assert.equal(sliderToDb(50), -VOLUME_SLIDER_RANGE_DB / 2);
  assert.equal(dbToSlider(0), 100);
  assert.equal(dbToSlider(-VOLUME_SLIDER_RANGE_DB), 0);
  // Round trip at the product defaults.
  for (const db of [DEFAULT_PLAYBACK_DB, DEFAULT_CUE_DB]) {
    const position = dbToSlider(db);
    assert.ok(Math.abs(sliderToDb(position) - db) < 1e-9, `db ${db}`);
  }
});

test("product defaults are -10 dB (monitor) and -6 dB (cue)", () => {
  assert.equal(DEFAULT_PLAYBACK_DB, -10);
  assert.equal(DEFAULT_CUE_DB, -6);
  assert.ok(Math.abs(dbToAmp(DEFAULT_PLAYBACK_DB) - 0.3162) < 0.001);
  assert.ok(Math.abs(dbToAmp(DEFAULT_CUE_DB) - 0.5012) < 0.001);
});
