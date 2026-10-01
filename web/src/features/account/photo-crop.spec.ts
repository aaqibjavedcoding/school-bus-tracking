import test from 'node:test';
import assert from 'node:assert/strict';
import { cropRect, outputSize } from './photo-crop.ts';
test('crop is a clamped square and output is stable', () => { const r = cropRect(1600, 900, 320, { zoom: 1, offsetX: 9999, offsetY: -9999 }); assert.equal(r.size, 450); assert.ok(r.sx >= 0 && r.sy >= 0); assert.equal(outputSize(), 512); });
