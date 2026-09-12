// =============================================================================
// sound.js — เสียงประกอบ ที่เบราว์เซอร์ "สังเคราะห์" เอง ไม่มีไฟล์เสียงเลย
// =============================================================================
//
// หลักการ: Web Audio API ของเบราว์เซอร์สร้างคลื่นเสียงได้เอง
//   tone()  = เสียงโน้ต 1 ตัว: ความถี่ (Hz ยิ่งสูงเสียงยิ่งแหลม) นานเท่าไหร่ ดังแค่ไหน เลื่อนเสียงได้
//   noise() = เสียงซ่า (สุ่มตัวเลข) ใช้ทำเสียงเตะ/เสียงลม
// เสียงแต่ละแบบ (ในตาราง EFFECTS) คือการเอา tone/noise หลายๆ ตัวมาเรียงเวลากัน
//   เช่น goal = โน้ต โด-มี-ซอล-โด (523, 659, 784, 1047 Hz) ห่างกันตัวละ 0.09 วินาที
//
// ไฟล์นี้แบ่งเป็น 3 ส่วน
//   ส่วนที่ 1  audio() / tone() / noise(): เครื่องมือทำเสียงพื้นฐาน
//   ส่วนที่ 2  EFFECTS: ตารางเสียงทั้งหมด (click, kick, goal, fall, sit, ...)   ← แต่งเสียงใหม่ตรงนี้
//   ส่วนที่ 3  sfx: ที่ไฟล์อื่นเรียกใช้  sfx.play('goal') / sfx.toggle() ปิดเปิดเสียง (จำไว้ใน localStorage)
//
// ต่อกับไฟล์อื่น: app.js เรียก sfx.play(...) เมื่อมีเหตุการณ์ และปุ่ม 🔊 เรียก sfx.toggle()
// หมายเหตุ: เบราว์เซอร์ยอมให้เว็บเล่นเสียงหลังผู้เล่นแตะ/คลิกแล้วเท่านั้น เลยสร้างตัวเล่นเสียงตอนใช้ครั้งแรก
//
// Tiny synthesized sound effects (Web Audio): no sound files to download.
// Browsers only allow audio after the player touches/clicks something, so the
// context is created lazily on the first effect.

const KEY = 'xiaoci.muted';
let ctx = null;
let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch { /* storage blocked */ }

// ---- ส่วนที่ 1: เครื่องมือทำเสียง ---------------------------------------------------------
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, length, { type = 'sine', gain = 0.18, slideTo = null } = {}) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const amp = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + length);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  osc.connect(amp).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + length + 0.02);
}

function noise(start, length, gain = 0.12, lowpass = 1200) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * length), a.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = lowpass;
  const amp = a.createGain();
  amp.gain.value = gain;
  src.connect(filter).connect(amp).connect(a.destination);
  src.start(t0);
}

// ---- ส่วนที่ 2: ตารางเสียง ---- tone(ความถี่Hz, เริ่มที่วินาที, ยาวกี่วินาที, {ชนิดคลื่น, ความดัง, เลื่อนไปที่Hz})
const EFFECTS = {
  click: () => tone(880, 0, 0.05, { type: 'triangle', gain: 0.08 }),
  kick: () => { tone(160, 0, 0.14, { slideTo: 60, gain: 0.35 }); noise(0, 0.06, 0.15, 900); },
  goal: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, { type: 'triangle', gain: 0.2 })),
  fall: () => tone(420, 0, 0.45, { type: 'sawtooth', slideTo: 140, gain: 0.07 }),
  sit: () => { tone(520, 0, 0.12, { gain: 0.12 }); tone(390, 0.1, 0.18, { gain: 0.12 }); },
  stand: () => { tone(390, 0, 0.12, { gain: 0.12 }); tone(520, 0.1, 0.18, { gain: 0.12 }); },
  roll: () => noise(0, 0.5, 0.12, 2400),
  push: () => tone(300, 0, 0.18, { type: 'square', slideTo: 600, gain: 0.05 }),
  pick: () => tone(660, 0, 0.1, { type: 'triangle', gain: 0.1 }),
  start: () => [0, 0.25, 0.5].forEach((s, i) => tone(i < 2 ? 660 : 990, s, 0.15, { type: 'square', gain: 0.06 })),
  end: () => [784, 659, 523].forEach((f, i) => tone(f, i * 0.14, 0.25, { type: 'triangle', gain: 0.18 })),
};

// ---- ส่วนที่ 3: ที่ไฟล์อื่นเรียกใช้ -----------------------------------------------------
export const sfx = {
  play(name) {
    if (!muted && EFFECTS[name]) EFFECTS[name]();
  },
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* storage blocked */ }
    if (!muted) sfx.play('click');
    return muted;
  },
};
