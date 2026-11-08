// Computergegner für den Trainingsmodus. Sieht nur, was ein Mensch auch sehen würde:
// die eigenen Schüsse samt Ergebnis und die Lage versenkter Schiffe.

import { SIZE, FLEET, cellsOf, inBounds } from './engine.js';

export const AI_LEVELS = [
  { id: 'easy', name: 'Kadett' },
  { id: 'normal', name: 'Kommandant' },
  { id: 'hard', name: 'Admiral' },
];

const key = (x, y) => y * SIZE + x;
const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function analyse(board, rules) {
  const shot = new Set(board.shots.map((s) => key(s.x, s.y)));
  const sunkCells = new Set();
  for (const ship of board.sunkShips()) for (const c of cellsOf(ship)) sunkCells.add(key(c.x, c.y));
  const blocked = board.blockedAround(rules);
  const openHits = board.shots.filter((s) => s.result !== 'miss' && !sunkCells.has(key(s.x, s.y)));
  const candidates = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const k = key(x, y);
      if (!shot.has(k) && !blocked.has(k)) candidates.push({ x, y });
    }
  }
  // Notfall: sollte nie leer sein, solange das Spiel läuft.
  if (!candidates.length) {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!shot.has(key(x, y))) candidates.push({ x, y });
  }
  const remaining = FLEET.filter((d) => !board.isSunk(d.id));
  return { shot, sunkCells, blocked, openHits, candidates, remaining };
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

function isFree(info, x, y) {
  const k = key(x, y);
  return inBounds(x, y) && !info.shot.has(k) && !info.blocked.has(k);
}

function neighborsOfHits(info) {
  const out = [];
  for (const h of info.openHits) {
    for (const [dx, dy] of NEIGHBORS) {
      if (isFree(info, h.x + dx, h.y + dy)) out.push({ x: h.x + dx, y: h.y + dy });
    }
  }
  return out;
}

function lineTargets(info) {
  // Liegen mindestens zwei offene Treffer in einer Linie, deren Enden verlängern.
  const hits = new Set(info.openHits.map((h) => key(h.x, h.y)));
  const out = [];
  for (const h of info.openHits) {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ]) {
      if (!hits.has(key(h.x + dx, h.y + dy)) || !inBounds(h.x + dx, h.y + dy)) continue;
      let ax = h.x;
      let ay = h.y;
      while (inBounds(ax - dx, ay - dy) && hits.has(key(ax - dx, ay - dy))) {
        ax -= dx;
        ay -= dy;
      }
      let bx = h.x;
      let by = h.y;
      while (inBounds(bx + dx, by + dy) && hits.has(key(bx + dx, by + dy))) {
        bx += dx;
        by += dy;
      }
      if (isFree(info, ax - dx, ay - dy)) out.push({ x: ax - dx, y: ay - dy });
      if (isFree(info, bx + dx, by + dy)) out.push({ x: bx + dx, y: by + dy });
    }
  }
  return out;
}

function densityMap(info) {
  const heat = new Float64Array(SIZE * SIZE);
  const hitSet = new Set(info.openHits.map((h) => key(h.x, h.y)));
  const targeting = hitSet.size > 0;
  for (const def of info.remaining) {
    for (const dir of ['h', 'v']) {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const cells = cellsOf({ id: def.id, size: def.size, x, y, dir });
          let ok = true;
          let covered = 0;
          for (const c of cells) {
            const k = key(c.x, c.y);
            if (!inBounds(c.x, c.y) || info.sunkCells.has(k) || info.blocked.has(k)) {
              ok = false;
              break;
            }
            if (info.shot.has(k)) {
              if (hitSet.has(k)) covered++;
              else {
                ok = false;
                break;
              }
            }
          }
          if (!ok) continue;
          if (targeting && covered === 0) continue;
          const weight = targeting ? Math.pow(30, covered) : 1;
          for (const c of cells) {
            const k = key(c.x, c.y);
            if (!info.shot.has(k)) heat[k] += weight;
          }
        }
      }
    }
  }
  return heat;
}

/** Nächstes Ziel wählen. `board` ist das Feld des Gegners (aus Sicht der KI). */
export function chooseShot(board, rules, level = 'normal', rng = Math.random) {
  const info = analyse(board, rules);

  if (level === 'easy') {
    const near = neighborsOfHits(info);
    if (near.length && rng() < 0.55) return pick(near, rng);
    return pick(info.candidates, rng);
  }

  if (level === 'normal') {
    const line = lineTargets(info);
    if (line.length) return pick(line, rng);
    const near = neighborsOfHits(info);
    if (near.length) return pick(near, rng);
    const minSize = Math.min(...info.remaining.map((d) => d.size));
    const parity = info.candidates.filter((c) => (c.x + c.y) % minSize === 0);
    return pick(parity.length ? parity : info.candidates, rng);
  }

  const heat = densityMap(info);
  let best = -1;
  let bestCells = [];
  for (const c of info.candidates) {
    const h = heat[key(c.x, c.y)];
    if (h > best) {
      best = h;
      bestCells = [c];
    } else if (h === best) {
      bestCells.push(c);
    }
  }
  return pick(bestCells.length ? bestCells : info.candidates, rng);
}
