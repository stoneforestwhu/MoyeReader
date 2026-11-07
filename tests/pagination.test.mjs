import test from 'node:test';
import assert from 'node:assert/strict';
import { pageTurnTarget } from '../src/pagination.mjs';

test('fractional DPI rounding cannot skip the last spread of a chapter', () => {
  const step = 1133, contentWidth = 14729;
  // The old relative scroll reached this position and incorrectly left the chapter.
  assert.equal(pageTurnTarget(12466.667, step, contentWidth, step, 1), 13596);
  for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
    let position = 0, turns = 0;
    while (true) {
      const target = pageTurnTarget(position, step, contentWidth, step, 1);
      if (target === null) break;
      position = Math.round(target * scale) / scale;
      assert.ok(++turns <= 12);
    }
    assert.equal(turns, 12);
    assert.ok(Math.abs(position - 13596) < 1);
  }
});

test('a partial final page remains reachable in both directions', () => {
  assert.equal(pageTurnTarget(2000, 1000, 3500, 1000, 1), 2500);
  assert.equal(pageTurnTarget(2500, 1000, 3500, 1000, 1), null);
  assert.equal(pageTurnTarget(2500, 1000, 3500, 1000, -1), 2000);
});

test('reverse pagination snaps rounding error to the page grid and reaches chapter start', () => {
  assert.equal(pageTurnTarget(2266.667, 1133, 14729, 1133, -1), 1133);
  assert.equal(pageTurnTarget(1133.333, 1133, 14729, 1133, -1), 0);
  assert.equal(pageTurnTarget(0.333, 1133, 14729, 1133, -1), null);
  assert.equal(pageTurnTarget(0, 1133, 1133, 1133, 1), null);
});
