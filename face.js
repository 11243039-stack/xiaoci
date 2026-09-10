// Animated face on the robot's screen: a canvas drawn every few frames and
// shown on a plane that follows the "face" site of the model.
//
// Expressions: happy (◠ ◠, the default), sleepy, curious, determined, dizzy,
// knocked-down, surprised and love (after a goal).

import * as THREE from 'three';

// Screen area the drawing covers, metres (the screen is 94 x 66 mm with round corners).
const WIDTH = 0.084, HEIGHT = 0.057;
const PX = 512, PY = Math.round(PX * HEIGHT / WIDTH);
const MM = PX / (WIDTH * 1000);  // canvas pixels per millimetre
const CYAN = '#9ef2ff', PINK = 'rgba(255, 140, 170, 0.85)', HEART = '#ff5c8a';

export class Face {
  constructor(scene, mujoco, model) {
    this.siteId = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE.value, 'face');
    this.canvas = document.createElement('canvas');
    this.canvas.width = PX;
    this.canvas.height = PY;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, HEIGHT), material);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    // plane x -> site +y (the robot's left = the viewer's right), plane y -> site +z, normal -> site +x
    this.basis = new THREE.Matrix4().set(0, 0, 1, 0.0004, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
    this.site = new THREE.Matrix4();
    this.expression = 'happy';
    this.look = 0;
    this.bounce = 0;
    this.time = 0;
    this.nextBlink = 2;
    this.lastDraw = -1;
  }

  // Place the plane on the screen. xpos/xmat come straight from MjData.
  sync(data) {
    if (this.siteId < 0) return;
    const p = data.site_xpos, m = data.site_xmat, i = this.siteId;
    this.site.set(
      m[9 * i], m[9 * i + 1], m[9 * i + 2], p[3 * i],
      m[9 * i + 3], m[9 * i + 4], m[9 * i + 5], p[3 * i + 1],
      m[9 * i + 6], m[9 * i + 7], m[9 * i + 8], p[3 * i + 2],
      0, 0, 0, 1);
    this.mesh.matrix.multiplyMatrices(this.site, this.basis);
  }

  // expression: one of the names above; look: -1 (its right) .. 1 (its left); walking: bool
  update(dt, expression, look = 0, walking = false) {
    this.time += dt;
    this.expression = expression;
    this.look += (look - this.look) * Math.min(1, dt * 6);
    this.bounce = walking ? Math.sin(this.time * 11) * 3 : this.bounce * 0.8;
    if (this.time - this.lastDraw < 1 / 20) return;  // 20 redraws a second is plenty
    this.lastDraw = this.time;
    this.draw();
    this.texture.needsUpdate = true;
  }

  draw() {
    const g = this.ctx, t = this.time;
    g.clearRect(0, 0, PX, PY);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const cx = PX / 2 + this.look * 16, cy = PY / 2 - 7 * MM + this.bounce;
    const ex = 20 * MM;  // eye spacing from the centre
    let blink = false;
    if (t > this.nextBlink) {
      blink = true;
      if (t > this.nextBlink + 0.13) this.nextBlink = t + 2.5 + Math.random() * 3;
    }
    const glow = (color, blur = 18) => { g.shadowColor = color; g.shadowBlur = blur; };
    const stroke = (color, width) => { g.strokeStyle = color; g.lineWidth = width; glow(color); };

    const e = this.expression;
    if (e !== 'dizzy' && e !== 'down') this.cheeks(cx, cy);

    for (const side of [-1, 1]) {
      const x = cx + side * ex;
      g.beginPath();
      if (e === 'love') {
        this.heart(x, cy + 2, 16 * MM + Math.sin(t * 8) * 4);
        continue;
      }
      if (blink && (e === 'happy' || e === 'curious')) {
        stroke(CYAN, 4.6 * MM);
        g.moveTo(x - 7 * MM, cy); g.lineTo(x + 7 * MM, cy);
      } else if (e === 'happy') {                      // ◠
        stroke(CYAN, 4.6 * MM);
        g.arc(x, cy + 4 * MM, 8.5 * MM, Math.PI * 1.12, Math.PI * 1.88);
      } else if (e === 'sleepy') {                     // ‿ low and flat
        stroke(CYAN, 4 * MM);
        g.arc(x, cy - 1 * MM, 7.5 * MM, Math.PI * 0.2, Math.PI * 0.8);
      } else if (e === 'curious') {                    // ● looking down
        glow(CYAN); g.fillStyle = CYAN;
        g.ellipse(x, cy + 5 * MM, 5.5 * MM, 7.5 * MM, 0, 0, Math.PI * 2);
        g.fill();
      } else if (e === 'determined') {                 // > <
        stroke(CYAN, 4.4 * MM);
        g.moveTo(x - side * 6 * MM, cy - 6 * MM);
        g.lineTo(x + side * 5 * MM, cy);
        g.lineTo(x - side * 6 * MM, cy + 6 * MM);
      } else if (e === 'dizzy') {                      // spirals
        stroke(CYAN, 3 * MM);
        const spin = t * 9 * side;
        for (let a = 0; a < Math.PI * 5; a += 0.2) {
          const r = a * 0.62 * MM;
          const px = x + Math.cos(a + spin) * r, py = cy + Math.sin(a + spin) * r;
          if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
      } else if (e === 'down') {                       // × ×
        stroke(CYAN, 4.2 * MM);
        const s = 6 * MM;
        g.moveTo(x - s, cy - s); g.lineTo(x + s, cy + s);
        g.moveTo(x + s, cy - s); g.lineTo(x - s, cy + s);
      } else if (e === 'surprised') {                  // O O
        stroke(CYAN, 3.6 * MM);
        g.arc(x, cy, 8 * MM, 0, Math.PI * 2);
      }
      g.stroke();
    }

    if (e === 'surprised') {                           // small "o" mouth
      g.beginPath(); stroke(CYAN, 2.6 * MM);
      g.arc(cx, cy + 16 * MM, 3.2 * MM, 0, Math.PI * 2); g.stroke();
    }
    if (e === 'sleepy') {                              // floating z's
      g.shadowBlur = 8; g.fillStyle = CYAN;
      for (let k = 0; k < 3; k++) {
        const phase = (t * 0.6 + k / 3) % 1;
        g.globalAlpha = 1 - phase;
        g.font = `bold ${Math.round((6 + phase * 6) * MM)}px sans-serif`;
        g.fillText('z', cx + ex + 10 * MM + phase * 10 * MM, cy - 6 * MM - phase * 14 * MM);
      }
      g.globalAlpha = 1;
    }
    if (e === 'down') {                                // sweat drop
      g.beginPath(); glow('#7fd3ff', 10); g.fillStyle = '#7fd3ff';
      const sx = cx + ex + 13 * MM, sy = cy - 9 * MM + (t * 12 % 8);
      g.moveTo(sx, sy - 4 * MM);
      g.quadraticCurveTo(sx + 3 * MM, sy + 1 * MM, sx, sy + 2.5 * MM);
      g.quadraticCurveTo(sx - 3 * MM, sy + 1 * MM, sx, sy - 4 * MM);
      g.fill();
    }
  }

  cheeks(cx, cy) {
    const g = this.ctx;
    g.shadowColor = PINK; g.shadowBlur = 14; g.fillStyle = PINK;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + side * 33 * MM, cy + 9 * MM, 6 * MM, 3.4 * MM, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  heart(x, y, s) {
    const g = this.ctx;
    g.shadowColor = HEART; g.shadowBlur = 20; g.fillStyle = HEART;
    g.beginPath();
    g.moveTo(x, y + s * 0.55);
    g.bezierCurveTo(x - s * 1.1, y - s * 0.1, x - s * 0.55, y - s * 0.95, x, y - s * 0.35);
    g.bezierCurveTo(x + s * 0.55, y - s * 0.95, x + s * 1.1, y - s * 0.1, x, y + s * 0.55);
    g.fill();
  }
}
