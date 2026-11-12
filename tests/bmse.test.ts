import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BMSE_CLIPBOARD_FORMAT_NAME,
  applyFfSkip,
  bmseBufferToText,
  bmseTextToBuffer,
  buildBmseClipboard,
  parseBmseClipboard,
} from '../src/core/bmse.js';

test('BMSE format name is exact (contract string)', () => {
  assert.equal(BMSE_CLIPBOARD_FORMAT_NAME, 'BMSE ClipBoard Object Data Format');
});

test('built clipboard starts with the header, uses 101-column, 8-digit ticks, CRLF and NUL', () => {
  const text = buildBmseClipboard([384, 408], { startNumber: 1, useFfNumbering: false });
  const lines = text.split('\r\n');
  assert.equal(lines[0], 'BMSE ClipBoard Object Data Format');
  assert.equal(lines[1], '101000003841'); // "101" + "00000384" + "1"
  assert.equal(lines[2], '101000004082');
  assert.equal(lines[3], '\0'); // trailing NUL after the final CRLF
  assert.ok(text.endsWith('\r\n\0'));
});

test('build/parse round-trip preserves marker ticks', () => {
  const ticks = [0, 192, 432, 7944, 49151];
  const text = buildBmseClipboard(ticks, { startNumber: 5, useFfNumbering: false });
  const parsed = parseBmseClipboard(text);
  assert.deepEqual(parsed.ticks, ticks);
  assert.deepEqual(parsed.invalidLines, []);
});

test('FF numbering rule skips numbers where n % 36 == 16', () => {
  assert.equal(applyFfSkip(15, true), 15);
  assert.equal(applyFfSkip(16, true), 36);
  assert.equal(applyFfSkip(15, false), 15);
  assert.equal(applyFfSkip(16, false), 16);

  const text = buildBmseClipboard([0, 192, 384], { startNumber: 15, useFfNumbering: true });
  const parsed = parseBmseClipboard(text);
  // Ticks are unaffected by numbering; verify lines carry the skipped numbers:
  // start 15 -> 15; next would be 16 -> skipped to 36; next 37.
  assert.ok(text.includes('101' + '00000000' + '15' + '\r\n'));
  assert.ok(text.includes('101' + '00000192' + '36' + '\r\n'));
  assert.ok(text.includes('101' + '00000384' + '37' + '\r\n'));
  assert.deepEqual(parsed.ticks, [0, 192, 384]);
});

test('parser rejects text without the exact header', () => {
  assert.throws(() => parseBmseClipboard('some other format\n1010000003841\n'));
  assert.throws(() => parseBmseClipboard(''));
});

test('parser tolerates LF-only input and skips malformed lines', () => {
  const text = [
    'BMSE ClipBoard Object Data Format',
    '101000003841',
    'badline',
    '101000004082',
    '',
  ].join('\n');
  const parsed = parseBmseClipboard(text);
  assert.deepEqual(parsed.ticks, [384, 408]);
  assert.deepEqual(parsed.invalidLines, [2]);
});

test('clipboard byte contract: text->buffer->text preserves every byte (incl. NUL)', () => {
  const text = buildBmseClipboard([0, 192, 384], { startNumber: 1, useFfNumbering: true });
  const bytes = bmseTextToBuffer(text);
  const back = bmseBufferToText(bytes);
  assert.equal(back, text);
  assert.equal(bytes.byteLength, Buffer.byteLength(text, 'utf8'));
  assert.equal(bytes[bytes.byteLength - 1], 0, 'trailing NUL preserved');
  assert.equal(bytes.includes(0x0d), true, 'CR bytes preserved');
});

test('clipboard byte contract: UTF-8 multibyte survives the round-trip', () => {
  const text = 'BMSE ClipBoard Object Data Format\r\n\u30af\u30ea\u30c3\u30d7\u0000';
  const bytes = bmseTextToBuffer(text);
  assert.equal(bmseBufferToText(bytes), text);
});
