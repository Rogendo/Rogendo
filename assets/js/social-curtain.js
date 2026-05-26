const getPointID = (row, column, rows) => column * rows + row;

const smoothstep = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

class Vec2 {
  constructor(x = 0, y = 0) {
    this.reset(x, y);
  }

  reset(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  zero() {
    this.reset(0, 0);
  }

  clone() {
    return new Vec2(this.x, this.y);
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  subtract(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  subtractNew(v) {
    return this.clone().subtract(v);
  }

  get lengthSquared() {
    return this.x ** 2 + this.y ** 2;
  }

  get length() {
    return Math.hypot(this.x, this.y);
  }

  get angle() {
    return Math.atan2(this.y, this.x);
  }
}

class Particle {
  constructor({ x, y, pinned, char }) {
    this.pos = new Vec2(x, y);
    this.oldPos = new Vec2(x, y);
    this.velocity = new Vec2();
    this.acceleration = new Vec2();
    this.gravityVec = new Vec2();
    this.pinned = pinned;
    this.char = char;
  }

  update(delta, config) {
    if (this.pinned) {
      this.acceleration.zero();
      return;
    }

    this.velocity.reset(
      (this.pos.x - this.oldPos.x) * config.damping,
      (this.pos.y - this.oldPos.y) * config.damping
    );

    this.oldPos.reset(this.pos.x, this.pos.y);

    const safeDelta = Math.max(delta, 16);
    const dd = safeDelta ** 2;

    this.gravityVec.reset(0, config.gravity / dd);
    this.applyForce(this.gravityVec);

    this.pos.x += this.velocity.x + this.acceleration.x * dd;
    this.pos.y += this.velocity.y + this.acceleration.y * dd;

    this.acceleration.reset();
  }

  applyForce(v) {
    this.acceleration.add(v);
  }
}

class Constraint {
  constructor({ p1, p2, length, compressFactor, stretchFactor }) {
    this.p1 = p1;
    this.p2 = p2;
    this.length = length;
    this.minLength = length * compressFactor;
    this.maxLength = length * stretchFactor;
  }

  solve() {
    const dx = this.p2.pos.x - this.p1.pos.x;
    const dy = this.p2.pos.y - this.p1.pos.y;
    const distance = Math.hypot(dx, dy);

    if (distance === 0) return;

    let targetLength = this.length;

    if (distance < this.minLength) {
      targetLength = this.minLength;
    } else if (distance > this.maxLength) {
      targetLength = this.maxLength;
    } else {
      return;
    }

    const difference = targetLength - distance;
    const percent = difference / distance / 2;
    const offsetX = dx * percent;
    const offsetY = dy * percent;

    if (!this.p1.pinned) {
      this.p1.pos.x -= offsetX;
      this.p1.pos.y -= offsetY;
    }

    if (!this.p2.pinned) {
      this.p2.pos.x += offsetX;
      this.p2.pos.y += offsetY;
    }
  }
}

class SocialCurtain {
  constructor(container) {
    this.container = container;
    this.links = Array.from(container.querySelectorAll(".social-curtain__link"));
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.pointer = new Vec2(-9999, -9999);
    this.grabRadius = 22;
    this.grabbedParticle = null;
    this.lastDelta = 0;
    this.raf = null;
    this.container.appendChild(this.canvas);

    this.bind();
    this.build();
  }

  bind() {
    this.pointerdown = this.pointerdown.bind(this);
    this.pointerup = this.pointerup.bind(this);
    this.pointermove = this.pointermove.bind(this);
    this.pointerleave = this.pointerleave.bind(this);
    this.resize = this.resize.bind(this);
    this.runloop = this.runloop.bind(this);
    this.refreshTheme = this.refreshTheme.bind(this);

    this.canvas.addEventListener("pointerdown", this.pointerdown);
    window.addEventListener("pointerup", this.pointerup);
    this.canvas.addEventListener("pointermove", this.pointermove);
    this.canvas.addEventListener("pointerleave", this.pointerleave);
    window.addEventListener("resize", this.resize);

    this.themeObserver = new MutationObserver(this.refreshTheme);
    this.themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  build() {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(280, Math.floor(rect.width));
    this.height = Math.max(160, Math.floor(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const gridW = Math.min(64, Math.max(34, Math.floor(this.width / 8)));
    const gridH = Math.min(42, Math.max(22, Math.floor(this.height / 7)));

    this.config = {
      gridW,
      gridH,
      gravity: 0.2,
      damping: 0.99,
      iterationsPerFrame: 5,
      compressFactor: 0.02,
      stretchFactor: 1.12,
      mouseSize: 6200,
      mouseStrength: 4.8,
      cellWidth: this.width / (gridW - 1),
      cellHeight: this.height / (gridH - 1)
    };

    this.prepareCharacters();
    this.createCloth();

    cancelAnimationFrame(this.raf);
    this.lastDelta = 0;
    this.raf = requestAnimationFrame(this.runloop);
  }

  prepareCharacters() {
    const text = "PETER ROGENDO  CODE MODELS DATA  ";
    this.text = text;
    this.charCanvases = {};
    const fontSize = Math.max(10, Math.min(15, this.config.cellHeight * 1.35));

    for (const ch of new Set(text)) {
      if (ch === " ") continue;

      const off = document.createElement("canvas");
      off.width = Math.ceil(fontSize * 1.5);
      off.height = Math.ceil(fontSize * 1.5);

      const octx = off.getContext("2d");
      octx.font = `700 ${fontSize}px monospace`;
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      octx.fillStyle = getComputedStyle(document.body)
        .getPropertyValue("--title-color")
        .trim() || "#222";
      octx.fillText(ch, off.width / 2, off.height / 2);

      this.charCanvases[ch] = off;
    }
  }

  createCloth() {
    const {
      gridW,
      gridH,
      cellWidth,
      cellHeight,
      compressFactor,
      stretchFactor
    } = this.config;

    this.particles = [];
    this.constraints = [];

    for (let i = 0; i < gridW; i++) {
      for (let j = 0; j < gridH; j++) {
        const charIndex = (i + j * gridW) % this.text.length;

        this.particles.push(new Particle({
          x: i * cellWidth,
          y: j * cellHeight,
          pinned: j === 0,
          char: this.text[charIndex] || " "
        }));
      }
    }

    for (let i = 0; i < gridW; i++) {
      for (let j = 0; j < gridH; j++) {
        const p = this.particles[getPointID(j, i, gridH)];

        if (j < gridH - 1) {
          const bottomP = this.particles[getPointID(j + 1, i, gridH)];
          const vertical = new Constraint({
            p1: p,
            p2: bottomP,
            length: cellHeight,
            compressFactor,
            stretchFactor
          });

          this.constraints.push(vertical);
          p.downConstraint = vertical;
        }

        if (i < gridW - 1) {
          this.constraints.push(new Constraint({
            p1: p,
            p2: this.particles[getPointID(j, i + 1, gridH)],
            length: cellWidth,
            compressFactor: 0.6,
            stretchFactor: 4
          }));
        }
      }
    }
  }

  getLocalPointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    return new Vec2(e.clientX - rect.left, e.clientY - rect.top);
  }

  pointerdown(e) {
    const link = this.getLinkAt(e.clientX, e.clientY);

    if (link) {
      window.open(link.href, "_blank", "noopener,noreferrer");
      return;
    }

    this.pointer = this.getLocalPointer(e);
    this.canvas.setPointerCapture(e.pointerId);

    for (const p of this.particles) {
      if (this.pointer.subtractNew(p.pos).length < this.grabRadius) {
        this.grabbedParticle = p;
        this.grabbedParticle.originalPinnedState = this.grabbedParticle.pinned;
        this.grabbedParticle.pinned = true;
        break;
      }
    }
  }

  pointerup() {
    if (this.grabbedParticle) {
      this.grabbedParticle.pinned = this.grabbedParticle.originalPinnedState;
      this.grabbedParticle = null;
    }
  }

  pointermove(e) {
    this.pointer = this.getLocalPointer(e);
    this.updateActiveLink(e.clientX, e.clientY);

    if (this.grabbedParticle) {
      this.grabbedParticle.pos.reset(this.pointer.x, this.pointer.y);
      this.grabbedParticle.oldPos.reset(this.pointer.x, this.pointer.y);
    }

    for (const p of this.particles) {
      const diff = this.pointer.subtractNew(p.pos);
      const ls = diff.lengthSquared;

      if (ls < this.config.mouseSize) {
        const angle = diff.angle - Math.PI;
        const strength = smoothstep(this.config.mouseSize, -2000, ls) * this.config.mouseStrength / 300;
        p.applyForce(new Vec2(Math.cos(angle) * strength, Math.sin(angle) * strength));
      }
    }
  }

  pointerleave() {
    this.pointer.reset(-9999, -9999);
    this.updateActiveLink();
  }

  getLinkAt(x, y) {
    return this.links.find((link) => {
      const rect = link.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
  }

  updateActiveLink(x, y) {
    const activeLink = typeof x === "number" ? this.getLinkAt(x, y) : null;

    this.links.forEach((link) => {
      link.classList.toggle("is-active", link === activeLink);
    });
  }

  drawCurtain() {
    for (const p of this.particles) {
      if (!p.char || p.char === " ") continue;

      const img = this.charCanvases[p.char];
      if (!img) continue;

      const constraint = p.downConstraint;
      const half = img.width / 2;
      let cos = 1;
      let sin = 0;

      if (constraint) {
        const dx = constraint.p2.pos.x - constraint.p1.pos.x;
        const dy = constraint.p2.pos.y - constraint.p1.pos.y;
        const angle = Math.atan2(dy, dx) - Math.PI / 2;
        cos = Math.cos(angle);
        sin = Math.sin(angle);
      }

      this.ctx.setTransform(
        cos * this.dpr,
        sin * this.dpr,
        -sin * this.dpr,
        cos * this.dpr,
        p.pos.x * this.dpr,
        p.pos.y * this.dpr
      );

      this.ctx.drawImage(img, -half, -half);
    }

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  runloop(delta) {
    this.raf = requestAnimationFrame(this.runloop);
    this.ctx.clearRect(0, 0, this.width, this.height);

    const elapsed = this.lastDelta ? delta - this.lastDelta : 16;
    this.lastDelta = delta;

    this.particles.forEach((p) => p.update(elapsed, this.config));

    for (let i = 0; i < this.config.iterationsPerFrame; i++) {
      this.constraints.forEach((constraint) => constraint.solve());
    }

    this.drawCurtain();
  }

  resize() {
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.build(), 120);
  }

  refreshTheme() {
    if (this.config) {
      this.prepareCharacters();
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("social-curtain");

  if (container) {
    new SocialCurtain(container);
  }
});
