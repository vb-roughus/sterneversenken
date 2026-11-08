// Eigene Schiffsgrafiken (Draufsicht, Bug nach rechts). Eine Zelle = 100 Einheiten.

const ENGINE = (x, y, r = 7) =>
  `<circle class="glow" cx="${x}" cy="${y}" r="${r}"/><circle class="glow-core" cx="${x}" cy="${y}" r="${r * 0.45}"/>`;

const ART = {
  // Keilförmiges Grosskampfschiff mit Brückenturm am Heck.
  flagship: `
    <polygon class="hull" points="494,50 30,6 18,10 18,90 30,94"/>
    <polygon class="panel" points="494,50 120,30 120,70"/>
    <path class="line" d="M494 50 L30 6 M494 50 L30 94 M440 50 L60 50"/>
    <path class="line" d="M380 39 L380 61 M300 32 L300 68 M220 25 L220 75 M140 18 L140 82"/>
    <rect class="deck" x="56" y="34" width="96" height="32" rx="4"/>
    <rect class="tower" x="70" y="40" width="44" height="20" rx="3"/>
    <circle class="dome" cx="84" cy="34" r="6"/><circle class="dome" cx="84" cy="66" r="6"/>
    ${ENGINE(14, 30, 8)}${ENGINE(12, 50, 10)}${ENGINE(14, 70, 8)}`,

  // Langer Schlachtkreuzer mit Seitengondeln.
  cruiser: `
    <rect class="panel" x="40" y="10" width="150" height="16" rx="6"/>
    <rect class="panel" x="40" y="74" width="150" height="16" rx="6"/>
    <path class="hull" d="M24 32 L290 24 Q388 30 392 50 Q388 70 290 76 L24 68 Z"/>
    <path class="line" d="M60 50 L360 50 M120 30 L120 70 M200 28 L200 72 M280 26 L280 74"/>
    <ellipse class="tower" cx="330" cy="50" rx="26" ry="12"/>
    <circle class="dome" cx="334" cy="50" r="6"/>
    ${ENGINE(26, 18, 6)}${ENGINE(26, 82, 6)}${ENGINE(18, 42, 7)}${ENGINE(18, 58, 7)}`,

  // Fregatte: Antriebsblock hinten, schlanker Hals, Kommandomodul vorn.
  frigate: `
    <rect class="hull" x="18" y="22" width="140" height="56" rx="14"/>
    <rect class="panel" x="40" y="12" width="80" height="14" rx="5"/>
    <rect class="panel" x="40" y="74" width="80" height="14" rx="5"/>
    <rect class="hull" x="150" y="42" width="100" height="16" rx="4"/>
    <path class="hull" d="M240 26 L276 32 Q292 50 276 68 L240 74 Z"/>
    <path class="line" d="M40 50 L150 50 M90 22 L90 78"/>
    <circle class="dome" cx="262" cy="50" r="7"/>
    ${ENGINE(16, 36, 7)}${ENGINE(16, 64, 7)}`,

  // Korvette: Pfeilform mit zwei Triebwerksgondeln.
  corvette: `
    <path class="panel" d="M30 14 L130 14 L150 24 L30 24 Z"/>
    <path class="panel" d="M30 86 L130 86 L150 76 L30 76 Z"/>
    <path class="hull" d="M290 50 L170 20 L40 28 L40 72 L170 80 Z"/>
    <path class="line" d="M290 50 L60 50 M200 28 L200 72 M120 26 L120 74"/>
    <path class="tower" d="M230 50 L190 38 L170 40 L170 60 L190 62 Z"/>
    ${ENGINE(28, 19, 7)}${ENGINE(28, 81, 7)}${ENGINE(36, 50, 9)}`,

  // Zwei Abfangjäger im Verband.
  fighters: `
    <g transform="translate(0,-12)">
      <path class="hull" d="M88 50 L24 22 L34 46 L14 50 L34 54 L24 78 Z"/>
      <circle class="dome" cx="56" cy="50" r="7"/>${ENGINE(16, 50, 5)}
    </g>
    <g transform="translate(96,12)">
      <path class="hull" d="M88 50 L24 22 L34 46 L14 50 L34 54 L24 78 Z"/>
      <circle class="dome" cx="56" cy="50" r="7"/>${ENGINE(16, 50, 5)}
    </g>`,
};

/** SVG-Markup eines Schiffs. dir 'h' = waagrecht, 'v' = senkrecht. */
export function shipSvg(id, size, dir = 'h') {
  const len = size * 100;
  const body = ART[id] || `<rect class="hull" x="10" y="20" width="${len - 20}" height="60" rx="20"/>`;
  if (dir === 'h') {
    return `<svg class="ship-art" viewBox="0 0 ${len} 100" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;
  }
  return `<svg class="ship-art" viewBox="0 0 100 ${len}" preserveAspectRatio="none" aria-hidden="true"><g transform="translate(100,0) rotate(90)">${body}</g></svg>`;
}
