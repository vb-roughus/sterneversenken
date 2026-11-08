import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Board,
  Game,
  FLEET,
  SIZE,
  canPlace,
  cellsOf,
  makeRng,
  randomFleet,
  turnFromHistory,
  validateFleet,
  verifyReveal,
} from '../web/js/engine.js';

const RULES = { bonusShot: true, allowTouch: false };

test('cellsOf liefert horizontale und vertikale Zellen', () => {
  assert.deepEqual(cellsOf({ id: 'fighters', x: 2, y: 3, dir: 'h' }), [
    { x: 2, y: 3 },
    { x: 3, y: 3 },
  ]);
  assert.deepEqual(cellsOf({ id: 'frigate', x: 0, y: 7, dir: 'v' }), [
    { x: 0, y: 7 },
    { x: 0, y: 8 },
    { x: 0, y: 9 },
  ]);
});

test('canPlace prüft Rand, Überlappung und Abstand', () => {
  const flag = { id: 'flagship', x: 0, y: 0, dir: 'h' };
  assert.equal(canPlace([], { id: 'flagship', x: 6, y: 0, dir: 'h' }, RULES), false);
  assert.equal(canPlace([flag], { id: 'fighters', x: 0, y: 1, dir: 'h' }, RULES), false);
  assert.equal(canPlace([flag], { id: 'fighters', x: 5, y: 1, dir: 'h' }, RULES), false, 'diagonal');
  assert.equal(canPlace([flag], { id: 'fighters', x: 6, y: 1, dir: 'h' }, RULES), true);
  assert.equal(canPlace([flag], { id: 'fighters', x: 0, y: 1, dir: 'h' }, { ...RULES, allowTouch: true }), true);
  assert.equal(canPlace([flag], { id: 'fighters', x: 4, y: 0, dir: 'v' }, { ...RULES, allowTouch: true }), false);
});

test('randomFleet erzeugt immer gültige Flotten', () => {
  for (let seed = 1; seed <= 300; seed++) {
    for (const allowTouch of [false, true]) {
      const rules = { ...RULES, allowTouch };
      const fleet = randomFleet(rules, makeRng(seed));
      assert.equal(validateFleet(fleet, rules), true, `seed ${seed}`);
    }
  }
});

test('validateFleet erkennt fehlende und doppelte Schiffe', () => {
  const fleet = randomFleet(RULES, makeRng(7));
  assert.equal(validateFleet(fleet.slice(1), RULES), false);
  assert.equal(validateFleet([...fleet.slice(1), { ...fleet[1] }], RULES), false);
  assert.equal(validateFleet([...fleet.slice(1), { ...fleet[0], dir: 'x' }], RULES), false);
});

test('Board meldet Wasser, Treffer und versenkt', () => {
  const board = new Board([{ id: 'fighters', x: 4, y: 4, dir: 'v' }]);
  assert.equal(board.fire(0, 0).result, 'miss');
  assert.equal(board.fire(4, 4).result, 'hit');
  const sunk = board.fire(4, 5);
  assert.equal(sunk.result, 'sunk');
  assert.deepEqual(sunk.ship, { id: 'fighters', x: 4, y: 4, dir: 'v' });
  assert.equal(board.fire(4, 5).repeat, true);
  assert.equal(board.shots.length, 3);
});

test('Zugreihenfolge mit und ohne Bonusschuss', () => {
  const miss = { result: 'miss' };
  const hit = { result: 'hit' };
  // Spieler 0 trifft, darf nochmal, verfehlt -> Spieler 1
  assert.equal(turnFromHistory(0, [[hit], []], RULES), 0);
  assert.equal(turnFromHistory(0, [[hit, miss], []], RULES), 1);
  assert.equal(turnFromHistory(0, [[hit, miss], [miss]], RULES), 0);
  // Ohne Bonusschuss wechselt der Zug immer
  const strict = { ...RULES, bonusShot: false };
  assert.equal(turnFromHistory(0, [[hit], []], strict), 1);
  assert.equal(turnFromHistory(1, [[], [hit]], strict), 0);
  assert.equal(turnFromHistory(0, [[], []], RULES, true), null);
});

test('Komplette Partie endet mit genau einem Sieger', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rng = makeRng(seed);
    const game = new Game({
      rules: RULES,
      first: seed % 2,
      boards: [new Board(randomFleet(RULES, rng)), new Board(randomFleet(RULES, rng))],
    });
    const order = [0, 1].map(() => {
      const cells = [];
      for (let i = 0; i < SIZE * SIZE; i++) cells.push(i);
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }
      return cells;
    });
    let guard = 0;
    while (!game.isOver() && guard++ < 400) {
      const p = game.turn();
      const k = order[p].shift();
      game.fire(p, k % SIZE, Math.floor(k / SIZE));
    }
    assert.equal(game.isOver(), true);
    assert.equal(game.turn(), null);
    const w = game.winner();
    assert.equal(game.boards[1 - w].allSunk(), true);
    assert.equal(game.stats(w).sunk, FLEET.length);
  }
});

test('verifyReveal erkennt geschönte Meldungen', () => {
  const fleet = randomFleet(RULES, makeRng(3));
  const board = new Board(fleet);
  const shots = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < SIZE; x++) shots.push(board.fire(x, y));
  const honest = board.shots;
  assert.equal(verifyReveal(fleet, honest, RULES), true);
  const firstHit = honest.findIndex((s) => s.result === 'hit');
  assert.ok(firstHit >= 0);
  const lied = honest.map((s, i) => (i === firstHit ? { ...s, result: 'miss' } : s));
  assert.equal(verifyReveal(fleet, lied, RULES), false);
});
