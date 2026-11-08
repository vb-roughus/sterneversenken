import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, makeRng, randomFleet, SIZE } from '../web/js/engine.js';
import { chooseShot, AI_LEVELS } from '../web/js/ai.js';

const RULES = { bonusShot: true, allowTouch: false };

function play(level, seed, rules = RULES) {
  const rng = makeRng(seed);
  const board = new Board(randomFleet(rules, rng));
  const tracking = new Board(null);
  let shots = 0;
  while (!board.allSunk()) {
    const { x, y } = chooseShot(tracking, rules, level, rng);
    assert.equal(tracking.shotAt(x, y), null, `${level} schiesst doppelt auf ${x},${y}`);
    const res = board.fire(x, y);
    tracking.record(res);
    shots++;
    assert.ok(shots <= SIZE * SIZE, 'zu viele Schüsse');
  }
  return shots;
}

for (const { id } of AI_LEVELS) {
  test(`KI "${id}" versenkt jede Flotte ohne Doppelschüsse`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      play(id, seed);
      play(id, seed, { ...RULES, allowTouch: true });
    }
  });
}

test('Schwierigkeitsstufen sind spürbar unterschiedlich', () => {
  const avg = (level) => {
    let total = 0;
    for (let seed = 1; seed <= 60; seed++) total += play(level, seed);
    return total / 60;
  };
  const easy = avg('easy');
  const normal = avg('normal');
  const hard = avg('hard');
  assert.ok(easy > normal, `easy ${easy} > normal ${normal}`);
  assert.ok(normal > hard, `normal ${normal} > hard ${hard}`);
});
