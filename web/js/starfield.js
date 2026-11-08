// Animierter Sternenhimmel mit Sprung-Effekt (Sterne werden zu Lichtstreifen).

export class Starfield {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.stars = [];
    this.warp = 0; // 0 = ruhig, 1 = voller Sprung
    this.warpTarget = 0;
    this.running = false;
    this.last = 0;
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.running = false;
      else this.start();
    });
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(260, (this.w * this.h) / 2600));
    this.stars = Array.from({ length: count }, () => this.spawn(true));
  }

  spawn(anywhere) {
    // Sterne im 3D-Raum vor der Kamera; z = Tiefe.
    return {
      x: (Math.random() * 2 - 1) * this.w,
      y: (Math.random() * 2 - 1) * this.h,
      z: anywhere ? Math.random() * 1000 + 1 : 1000,
      pz: 0,
      tw: Math.random() * Math.PI * 2,
      hue: Math.random() < 0.15 ? (Math.random() < 0.5 ? 210 : 40) : 0,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** Sprung-Effekt für `ms` Millisekunden. */
  jump(ms = 1400) {
    if (this.reduced) return Promise.resolve();
    this.warpTarget = 1;
    return new Promise((resolve) => {
      setTimeout(() => {
        this.warpTarget = 0;
        resolve();
      }, ms);
    });
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(50, now - this.last) / 16.67;
    this.last = now;
    this.warp += (this.warpTarget - this.warp) * (this.warpTarget > this.warp ? 0.05 : 0.04) * dt;
    const { g, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    g.fillStyle = `rgba(3, 5, 12, ${0.85 - this.warp * 0.55})`;
    g.fillRect(0, 0, w, h);
    const speed = (this.reduced ? 0.15 : 0.6) + this.warp * 38;
    for (const s of this.stars) {
      s.pz = s.z;
      s.z -= speed * dt;
      if (s.z < 1) {
        Object.assign(s, this.spawn(false));
        s.pz = s.z;
        continue;
      }
      const k = 260 / s.z;
      const x = cx + s.x * k * 0.5;
      const y = cy + s.y * k * 0.5;
      if (x < -50 || x > w + 50 || y < -50 || y > h + 50) {
        Object.assign(s, this.spawn(false));
        continue;
      }
      s.tw += 0.05 * dt;
      const size = Math.max(0.4, (1 - s.z / 1000) * 2.2);
      const alpha = Math.min(1, (1 - s.z / 1000) * 1.3) * (0.75 + Math.sin(s.tw) * 0.25);
      const color = s.hue ? `hsla(${s.hue}, 80%, 80%, ${alpha})` : `rgba(235, 240, 255, ${alpha})`;
      if (this.warp > 0.05) {
        const pk = 260 / s.pz;
        const px = cx + s.x * pk * 0.5;
        const py = cy + s.y * pk * 0.5;
        g.strokeStyle = s.hue ? color : `rgba(200, 225, 255, ${alpha})`;
        g.lineWidth = size;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(x, y);
        g.stroke();
      } else {
        g.fillStyle = color;
        g.fillRect(x, y, size, size);
      }
    }
    requestAnimationFrame(this.frame);
  }
}
