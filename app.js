// =============================================================================
// app.js — ไฟล์หลักของเว็บ 小慈 (อ่านไฟล์นี้ก่อนไฟล์อื่น)
// =============================================================================
//
// ไฟล์นี้ทำอะไร
//   เป็น "ผู้คุมวง" ของทั้งเว็บ: โหลดของทุกอย่าง สร้างหุ่นในโลกจำลอง รับปุ่มจาก
//   ผู้เล่น ส่งให้สมองคิด ขยับมอเตอร์ คำนวณฟิสิกส์ แล้ววาดภาพออกจอ วนแบบนี้ทุกเฟรม
//   ทุกอย่างรันในเบราว์เซอร์ของคนเล่นเอง ไม่มีเซิร์ฟเวอร์ช่วยคำนวณ
//
// ใช้ไลบรารี (ของคนอื่น) อะไรบ้าง   ← เก็บไว้ในโฟลเดอร์ web/vendor/
//   • three.js          วาดภาพ 3D บนจอ (WebGL)
//   • MuJoCo (WASM)     โลกจำลองฟิสิกส์ของ Google DeepMind แปลงให้รันในเบราว์เซอร์ได้
//   • onnxruntime-web   ตัวรันไฟล์สมอง .onnx (โครงข่ายประสาทที่ Pollen Robotics ฝึกไว้)
// และไฟล์ของเราเอง: face.js (สีหน้า) game.js (เกมเตะบอล) sound.js (เสียง) voice.js (สั่งด้วยเสียง)
//
// ไฟล์นี้แบ่งเป็น 9 ส่วน (เรียงจากบนลงล่าง)
//   ส่วนที่ 1  import         ดึงไลบรารีและไฟล์อื่นเข้ามา
//   ส่วนที่ 2  ค่าคงที่         ตั้งค่าต่างๆ: ไฟล์ที่ต้องโหลด ท่ายืนตั้งต้น ความเร็วเดิน ฯลฯ
//   ส่วนที่ 3  ตัวช่วยโหลดไฟล์   ดาวน์โหลดพร้อมแถบ % และเช็กว่าเบราว์เซอร์รองรับไหม
//   ส่วนที่ 4  class Robot     ตัวหุ่น: ข้อมูลร่างกาย สมอง และ "1 รอบการคิด" (สำคัญที่สุด)
//   ส่วนที่ 5  class Driver    แปลงปุ่ม/จอยสติ๊ก เป็นคำสั่งความเร็วให้หุ่น
//   ส่วนที่ 6  buildScene()    สร้างภาพ 3D จากข้อมูลของ MuJoCo และคุมกล้อง
//   ส่วนที่ 7  UI              ข้อความสถานะ ปุ่มต่างๆ คะแนน ไมค์ จอยสติ๊ก หน้าสอนเล่น
//   ส่วนที่ 8  main()          จุดเริ่มโปรแกรม: โหลด → ประกอบทุกส่วน → วงรอบหลัก (game loop)
//   ส่วนที่ 9  QR + error      ปุ่ม QR Code สำหรับมือถือ และหน้าจอแจ้งข้อผิดพลาด
//
// ข้อมูลไหลยังไง (ทุกๆ 0.02 วินาที = 50 ครั้งต่อวินาที)
//
//   ผู้เล่นกดปุ่ม ─▶ Driver.drive() ─▶ Robot.setVel()      "อยากให้เดินหน้า"
//                                          │
//   Robot.step():  observe() ─▶ สมอง ONNX ─▶ ctrl (มุมมอเตอร์ 14 ตัว) ─▶ mj_step ×4
//                  "ตอนนี้ตัวเอียงแค่ไหน"   "ควรขยับขายังไง"            "ฟิสิกส์คำนวณผล"
//                                          │
//   Game.step() ─▶ เช็กบอลเข้าประตู     view.sync() + render() ─▶ ภาพบนจอ
//
// ลองเล่นใน Console (กด F12 ในเบราว์เซอร์ → แท็บ Console) พิมพ์เช่น
//   __sim.robot.push()          ผลักหุ่น
//   __sim.robot.policy          ดูว่าตอนนี้ใช้สมองท่าไหน
//   __sim.game.placeBall(1.4,0) วางบอลในประตู
//
// (โค้ดส่วนคุมหุ่นแปลงมาจาก microduck_rl/scripts/infer_policy.py ของ Pollen Robotics
//  ข้อมูลที่ส่งเข้าสมองมี 61 ค่า เรียงเหมือนตอนฝึกทุกตัว ส่วนมอเตอร์ใช้มอเตอร์ธรรมดาของ
//  MuJoCo แทนโมเดลมอเตอร์ BAM ที่เป็น Python ซึ่งทดสอบแล้วว่าทุกท่ายังทำงานได้)

// =============================================================================
// ส่วนที่ 1: import — ดึงของจากไฟล์อื่นเข้ามาใช้
// =============================================================================
// รูปแบบ  import X from 'ที่อยู่ไฟล์'
// 'three' เป็นชื่อย่อ ส่วนชื่อจริงกำหนดไว้ใน <script type="importmap"> ของ index.html
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import loadMujoco from './vendor/mujoco/mujoco.js';
import * as ort from './vendor/onnxruntime-web/ort.wasm.min.mjs';
import { Face } from './face.js';
import { Game } from './game.js';
import { sfx } from './sound.js';
import { Voice, parseCommand } from './voice.js';
import { Brain } from './brain.js';

// =============================================================================
// ส่วนที่ 2: ค่าคงที่ (const) — "ตั้งค่า" ของทั้งเกม อยากปรับอะไรเริ่มแก้ตรงนี้ได้
// =============================================================================
// const = ตัวแปรที่ตั้งครั้งเดียวแล้วไม่เปลี่ยน   { } = วัตถุ (object) เก็บคู่ ชื่อ: ค่า   [ ] = รายการ (array)

// ตาและแก้มที่ปั้นไว้ในไฟล์หุ่น (สีตาม material 2 ชื่อนี้) จะถูกซ่อน เพราะเว็บวาดสีหน้าที่ขยับได้แทน (face.js)
const FACE_MATERIALS = ['tcu_eye', 'tcu_blush'];

// ไฟล์ที่เว็บต้องโหลด ทั้งหมดอยู่ใน web/assets/ (สคริปต์ tools/build_site.py ก๊อปมาใส่ให้)
const ASSETS = {
  scene: './assets/scene.xml',
  name: './assets/name.txt',
  policies: './assets/policies/',
};
// สมอง 7 ตัว (ไฟล์ .onnx) — ชื่อซ้ายคือชื่อที่โค้ดใช้เรียก ขวาคือชื่อไฟล์จริง
// หุ่นใช้สมองทีละตัวตามสถานการณ์ เช่น ยืนนิ่งใช้ standing เดินใช้ walking
const POLICY_FILES = {
  walking: 'alpha_walking.onnx',
  standing: 'alpha_stand.onnx',
  sit: 'alpha_sitstand.onnx',
  ground_pick: 'alpha_ground_pick.onnx',
  kick_left: 'ball_kick_left.onnx',
  kick_right: 'ball_kick_right.onnx',
  roulade: 'roulade.onnx',
};

// --- ค่าที่ต้องตรงกับตอนฝึกสมอง (คัดลอกมาจาก infer_policy.py) ห้ามแก้เล่น ---------
// ท่ายืนตั้งต้นของมอเตอร์ 14 ตัว (หน่วยเรเดียน) สมองจะตอบเป็น "ขยับเพิ่มจากท่านี้เท่าไหร่"
const DEFAULT_POSE = Float32Array.from([
  0.0, -0.0873, -0.4579, -0.0049, 0.4530,   // left hip yaw/roll/pitch, knee, ankle
  0.3491, 0.3491, 0.0, 0.0,                 // neck pitch, head pitch/yaw/roll
  0.0, 0.0873, 0.4579, 0.0049, -0.4530,     // right leg
]);
const TIMESTEP = 0.005;                     // ฟิสิกส์คำนวณทีละ 0.005 วินาที
const DECIMATION = 4;                       // สมองคิด 1 ครั้ง ต่อฟิสิกส์ 4 ครั้ง
const CONTROL_DT = TIMESTEP * DECIMATION;   // = 0.02 วินาที → สมองคิด 50 ครั้ง/วินาที (50 Hz)
const SWITCH_THRESHOLD = 0.05;              // |velocity command| walking <-> standing
const GROUND_PICK_PERIOD = 4.0;
const GROUND_PICK_END = 0.7;                // phase at which one pick is done
const BEHAVIOR_DURATION = { kick_left: 3.0, kick_right: 3.0, roulade: 2.0 };
const BALL_OFFSET_X = 0.09, BALL_OFFSET_ABS_Y = 0.042, BALL_RADIUS = 0.035;
const PUSH_SPEED = 1.0;
const START_HEIGHT = 0.125;

// --- ความรู้สึกตอนบังคับ (ปรับเล่นได้ ลองเปลี่ยนแล้วรีเฟรชหน้าเว็บดูผล) -------------
const FORWARD = 0.3, BACKWARD = -0.3;       // m/s, the walking policy's range (สมองถูกฝึกมาไม่เกิน ±0.3)
const TURN = 1.5;                           // rad/s; at 1.0 the gait barely turns
const MIN_PRESS = 0.5;                      // s a tap keeps a move going (~15 deg)
const STAND_UP_TIME = 2.0;                  // s the sit/stand policy needs to rise

// Libraries (pinned, in ./vendor). Their .wasm files are fetched here, not by
// the libraries, so the loading bar can show real progress; both accept a
// preloaded binary.
const MUJOCO_WASM = { url: './vendor/mujoco/mujoco.wasm', bytes: 10175239 };
const ORT_BASE = new URL('./vendor/onnxruntime-web/', import.meta.url).href;
const ORT_WASM = { url: `${ORT_BASE}ort-wasm-simd-threaded.wasm`, bytes: 13961845 };
const POLICY_BYTES = 793700;  // each policy file is about this big

// =============================================================================
// ส่วนที่ 3: ตัวช่วยโหลดไฟล์ + แถบ % + เช็กว่าเบราว์เซอร์รองรับไหม
// =============================================================================

// $('ชื่อid') = หา element ในหน้า index.html ที่มี id นั้น (ย่อจาก document.getElementById)
// (id) => ... คือ "arrow function" = ฟังก์ชันแบบสั้น รับ id แล้วคืนค่าทางขวาของ =>
const $ = (id) => document.getElementById(id);

// เปลี่ยนข้อความใต้แถบโหลด
function setLoading(text) {
  $('loading-text').textContent = text;
}

// --- downloads with one combined progress bar --------------------------------
// Map = ตารางเก็บคู่ key→value  ใช้จำว่าแต่ละไฟล์โหลดไปกี่ไบต์แล้ว (loaded) และต้องโหลดทั้งหมดกี่ไบต์ (expected)
const progress = { loaded: new Map(), expected: new Map() };

function showProgress() {
  let loaded = 0, expected = 0;
  for (const [key, e] of progress.expected) {
    expected += e;
    loaded += Math.min(progress.loaded.get(key) || 0, e);
  }
  const pct = expected ? Math.min(99, Math.floor((100 * loaded) / expected)) : 0;
  $('loading-fill').style.width = `${pct}%`;
  $('loading-title').textContent = `載入中 ${pct}%`;
}

// ดาวน์โหลด 1 ไฟล์ แล้วคืน "Promise" (สัญญาว่าจะได้ของทีหลัง เพราะโหลดต้องใช้เวลา)
// ผู้เรียกใช้ต้อง await หรือ .then() เพื่อรอผล
// XMLHttpRequest rather than a streamed fetch: same progress events, and Chrome
// does not report the finished downloads as "aborted" (it did for fetch streams).
function download(url, expectedBytes) {
  progress.expected.set(url, expectedBytes);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.onprogress = (e) => { progress.loaded.set(url, e.loaded); showProgress(); };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) { reject(new Error(`${url} (${xhr.status})`)); return; }
      progress.loaded.set(url, expectedBytes);
      showProgress();
      resolve(new Uint8Array(xhr.response));
    };
    xhr.onerror = () => reject(new Error(`${url}（網路錯誤）`));
    xhr.send();
  });
}

// เบราว์เซอร์ต้องมี WebAssembly (รัน MuJoCo/ONNX) และ WebGL2 (วาด 3D) ถ้าขาดอย่างใดคืนข้อความเหตุผล
function unsupportedReason() {
  if (typeof WebAssembly !== 'object') return '這個瀏覽器不支援 WebAssembly。';
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return '這個瀏覽器（或顯示卡設定）不支援 WebGL 2，無法顯示 3D 畫面。';
  return null;
}

// =============================================================================
// ส่วนที่ 4: class Robot — ตัวหุ่น 1 ตัว (สมอง + ร่างกายในโลกจำลอง)
// =============================================================================
// class = "แม่พิมพ์" ของวัตถุ  new Robot(...) = สร้างหุ่นจากแม่พิมพ์นี้ (ทำใน main() ส่วนที่ 8)
// this.xxx = ข้อมูลที่หุ่นตัวนี้จำไว้   ฟังก์ชันใน class เรียกว่า method เช่น robot.reset()
//
// ความรู้ MuJoCo ที่ต้องใช้ในส่วนนี้
//   model = แบบแปลนที่ไม่เปลี่ยน (มีข้อต่ออะไร หนักเท่าไหร่) โหลดจาก assets/scene.xml
//   data  = สถานะ ณ ตอนนี้ ที่เปลี่ยนทุกขั้นเวลา
//     data.qpos  ตำแหน่ง: 7 ตัวแรกของหุ่นคือ x,y,z + การหมุน (quaternion 4 ตัว) ตามด้วยมุมข้อต่อ
//     data.qvel  ความเร็วของแต่ละอย่าง
//     data.ctrl  คำสั่งมอเตอร์ (มุมที่อยากให้แต่ละข้อหมุนไป) ← เราเขียนค่านี้
//   mj_step(model, data) = เดินเวลาไป 1 ขั้น (0.005 วินาที) แล้วฟิสิกส์คำนวณผลให้
//   ข้อมูลเก็บเป็นแถวตัวเลขยาวๆ เลยต้องจำ "ที่อยู่" (adr) ว่าของแต่ละอย่างอยู่ช่องไหน
//
// สถานะ (state) ของหุ่น: policy บอกว่าตอนนี้ใช้สมองตัวไหน
//   'standing' ยืนนิ่ง   'walking' เดิน/หัน   'sit' นั่ง/ลุก   'ground_pick' ก้มคาบของ
//   'kick_left' / 'kick_right' / 'roulade' ท่าพิเศษที่ทำจนจบเองตามเวลาใน BEHAVIOR_DURATION
// ============================================================================
// Robot: state machine + policy inference (port of PolicyInference)
// ============================================================================
class Robot {
  // constructor = ทำงานครั้งเดียวตอนสร้างหุ่น: จำของที่ได้รับ และหา "ที่อยู่" ของส่วนต่างๆ ในข้อมูล MuJoCo
  constructor(mujoco, model, data, sessions) {
    this.mj = mujoco;
    this.model = model;
    this.data = data;
    this.sessions = sessions;   // สมองทั้ง 7 ตัว เรียกด้วยชื่อ เช่น this.sessions.walking
    // ฟังก์ชันช่วย: หาเลขประจำตัวของสิ่งของจากชื่อในไฟล์ XML เช่น body ชื่อ 'trunk_base' (ลำตัว)
    const id = (type, name) => mujoco.mj_name2id(model, mujoco.mjtObj[type].value, name);

    this.trunk = id('mjOBJ_BODY', 'trunk_base');
    const free = id('mjOBJ_JOINT', 'trunk_base_freejoint');
    this.freeQpos = model.jnt_qposadr[free];
    this.freeQvel = model.jnt_dofadr[free];
    const ball = id('mjOBJ_JOINT', 'ball_free');
    this.ballQpos = ball >= 0 ? model.jnt_qposadr[ball] : -1;
    this.ballQvel = ball >= 0 ? model.jnt_dofadr[ball] : -1;
    this.gyroAdr = model.sensor_adr[id('mjOBJ_SENSOR', 'imu_ang_vel')];

    this.nu = model.nu;   // จำนวนมอเตอร์ = 14 (ขา 5×2 + คอ/หัว 4)
    // หาว่ามอเตอร์แต่ละตัวต่อกับข้อต่อไหน และมุม/ความเร็วของข้อนั้นอยู่ช่องไหนใน qpos/qvel
    const trn = model.actuator_trnid;
    this.jointQpos = [], this.jointQvel = [];
    for (let i = 0; i < this.nu; i++) {
      this.jointQpos.push(model.jnt_qposadr[trn[2 * i]]);
      this.jointQvel.push(model.jnt_dofadr[trn[2 * i]]);
    }
    // ช่องเก็บ "สิ่งที่หุ่นรับรู้" ส่งให้สมอง = 3 + 3 + 14×3 + 13 = 61 ค่า (ดู observe())
    this.obs = new Float32Array(3 + 3 + 3 * this.nu + 13);
    this.simTime = 0;       // seconds of simulation since the page opened (never reset)
    this.pushedAt = -10;
    this.events = [];       // 'sit', 'stand', 'pick', 'kick', 'roll', 'push' for sounds/face
    this.reset();
  }

  // วางหุ่นกลับจุดเริ่ม ท่ายืนตั้งต้น (ปุ่ม「重新開始」/ Backspace เรียกฟังก์ชันนี้)
  reset() {
    const { mj, model, data } = this;   // เขียนย่อของ const mj = this.mj; const model = this.model; ...
    mj.mj_resetData(model, data);
    const q = data.qpos;
    q.set([0, 0, START_HEIGHT, 1, 0, 0, 0], this.freeQpos);
    this.jointQpos.forEach((adr, i) => { q[adr] = DEFAULT_POSE[i]; });
    data.ctrl.set(DEFAULT_POSE);
    this.lastAction = new Float32Array(this.nu);
    this.vel = [0, 0, 0];
    this.sitMode = false;
    this.pick = false;
    this.pickPhase = 0;
    this.behavior = null;
    this.behaviorLeft = 0;
    this.policy = 'standing';
    mj.mj_forward(model, data);
  }

  // -- commands (the keyboard/panel side calls these) -------------------------
  // ---- คำสั่งที่ปุ่ม/เสียงเรียกใช้ ------------------------------------------------
  // ตั้งความเร็ว: vx เดินหน้า(+)/ถอย(-) m/s, vy เดินข้าง, wz หันซ้าย(+)/ขวา(-) rad/s
  // ถ้าความเร็วเกือบ 0 ใช้สมองยืน ถ้าไม่ใช่ใช้สมองเดิน (ยกเว้นกำลังทำท่าอื่นอยู่)
  setVel(vx, vy, wz) {
    this.vel = [vx, vy, wz];
    if (this.pick || this.sitMode || this.behavior) return;
    this.policy = Math.hypot(vx, vy, wz) <= SWITCH_THRESHOLD ? 'standing' : 'walking';
  }

  // นั่ง ⇄ ลุก (ใช้สมองตัวเดียว คำสั่งช่องแรก 1 = นั่ง 0 = ยืน)
  // this.events.push(...) = ฝากข้อความ "เพิ่งนั่ง" ไว้ ให้ส่วนเสียง/สีหน้ามาอ่านทีหลัง
  toggleSit() {
    if (this.pick || this.behavior) return;
    this.sitMode = !this.sitMode;
    if (this.sitMode) this.vel = [0, 0, 0];
    this.policy = 'sit';  // standing back up is done by the same policy (flag 0)
    this.events.push(this.sitMode ? 'sit' : 'stand');
  }

  // ก้มคาบของ: สมองตัวนี้ต้องการ "จังหวะ" (phase) ที่นับจาก 0 ขึ้นไป ดู command() และ step()
  triggerPick() {
    if (this.pick || this.sitMode || this.behavior) return;
    this.pick = true;
    this.pickPhase = 0;
    this.policy = 'ground_pick';
    this.events.push('pick');
  }

  // ท่าพิเศษ (เตะซ้าย/เตะขวา/ตีลังกา): สลับไปใช้สมองท่านั้นจนหมดเวลา แล้ว step() จะสลับกลับเอง
  triggerBehavior(name) {
    if (this.behavior || this.pick || this.sitMode) return;
    // The kick policies were trained with the ball set just in front of the
    // kicking foot. In the game the player has to walk up to the ball first:
    // only a ball already close by is nudged into that spot.
    if (name.startsWith('kick') && this.kickReady()) this.placeBall(name);
    this.behavior = name;
    this.behaviorLeft = BEHAVIOR_DURATION[name];
    this.vel = [0, 0, 0];
    this.policy = name;
    this.events.push(name === 'roulade' ? 'roll' : 'kick');
  }

  // ผลัก: ตั้งความเร็วลำตัวไปทิศสุ่ม 1 m/s เหมือนมีคนผลัก (ทดสอบว่าสมองทรงตัวได้ไหม)
  push() {
    const a = Math.random() * 2 * Math.PI;
    const v = this.data.qvel;
    v[this.freeQvel] = PUSH_SPEED * Math.cos(a);
    v[this.freeQvel + 1] = PUSH_SPEED * Math.sin(a);
    this.pushedAt = this.simTime;
    this.events.push('push');
  }

  // get = อ่านได้เหมือนตัวแปร (robot.yaw) แต่คำนวณใหม่ทุกครั้ง
  // yaw = หุ่นหันไปทางไหน (เรเดียน) แปลงจาก quaternion ของลำตัว
  get yaw() {
    const q = this.data.qpos, a = this.freeQpos;
    const [qw, qx, qy, qz] = [q[a + 3], q[a + 4], q[a + 5], q[a + 6]];
    return Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
  }

  // Ball position seen from the robot: [ahead, to its left] in metres.
  ballRelative() {
    if (this.ballQpos < 0) return null;
    const q = this.data.qpos, a = this.freeQpos, b = this.ballQpos;
    const dx = q[b] - q[a], dy = q[b + 1] - q[a + 1], c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return [c * dx + s * dy, -s * dx + c * dy];
  }

  // Which foot could kick the ball right now (null if it is not in front of the feet).
  kickReady() {
    const rel = this.ballRelative();
    if (!rel) return null;
    const [ahead, left] = rel;
    if (ahead < 0.03 || ahead > 0.2 || Math.abs(left) > 0.12) return null;
    return left >= 0 ? 'kick_left' : 'kick_right';
  }

  // วางบอลตรงหน้าเท้าที่จะเตะพอดี (ตำแหน่งเดียวกับตอนฝึกสมองท่าเตะ)
  placeBall(kick) {
    if (this.ballQpos < 0) return;
    const q = this.data.qpos;
    const a = this.freeQpos;
    const yaw = this.yaw;
    const offY = kick === 'kick_right' ? -BALL_OFFSET_ABS_Y : BALL_OFFSET_ABS_Y;
    const bx = q[a] + Math.cos(yaw) * BALL_OFFSET_X - Math.sin(yaw) * offY;
    const by = q[a + 1] + Math.sin(yaw) * BALL_OFFSET_X + Math.cos(yaw) * offY;
    q.set([bx, by, BALL_RADIUS, 1, 0, 0, 0], this.ballQpos);
    this.data.qvel.fill(0, this.ballQvel, this.ballQvel + 6);
  }

  // -- one 20 ms control step ----------------------------------------------
  // ---- หัวใจของโปรเจกต์: 1 รอบการคิด ทุก 0.02 วินาที -------------------------------
  //   command()  "ถูกสั่งให้ทำอะไร" (13 ค่า)
  //   observe()  "ร่างกายตอนนี้เป็นยังไง" + คำสั่ง = 61 ค่า
  //   step()     ส่ง 61 ค่าเข้าสมอง → ได้ 14 ค่า (ขยับมอเตอร์) → ฟิสิกส์เดิน 4 ขั้น

  // คำสั่ง 13 ช่อง: [ความเร็ว 3 ช่อง, ท่าหัว 4 ช่อง, ท่าลำตัว 6 ช่อง] ในเว็บเราใช้แค่ 3 ช่องแรก
  command() {
    const c = new Float32Array(13);  // [twist(3), head pose(4), body pose(6)]
    if (this.behavior) return c;     // kicks/roll were trained on an all-zero command
    if (this.policy === 'walking') c.set(this.vel);
    else if (this.policy === 'sit') c[0] = this.sitMode ? 1 : 0;
    else if (this.policy === 'ground_pick') {
      c[0] = Math.cos(2 * Math.PI * this.pickPhase);
      c[1] = Math.sin(2 * Math.PI * this.pickPhase);
    }
    return c;
  }

  // สิ่งที่สมองรับรู้ 61 ค่า (ลำดับต้องตรงกับตอนฝึกเป๊ะ ไม่อย่างนั้นสมองจะงง):
  //   [0-2]   ความเร็วการหมุนของลำตัว (จากเซนเซอร์ gyro)
  //   [3-5]   ทิศของแรงโน้มถ่วงเทียบกับลำตัว = "ตัวเอียงไปทางไหน"
  //   [6-19]  มุมข้อต่อ 14 ข้อ (ลบท่าตั้งต้นออก)
  //   [20-33] ความเร็วข้อต่อ 14 ข้อ
  //   [34-47] สิ่งที่สมองสั่งไปรอบที่แล้ว 14 ค่า
  //   [48-60] คำสั่ง 13 ช่อง (จาก command())
  observe() {
    const { data, obs, nu } = this;
    const s = data.sensordata;
    obs[0] = s[this.gyroAdr]; obs[1] = s[this.gyroAdr + 1]; obs[2] = s[this.gyroAdr + 2];
    // gravity [0, 0, -1] seen from the trunk frame (quat_rotate_inverse)
    const xq = data.xquat, k = 4 * this.trunk;
    const w = xq[k], x = xq[k + 1], y = xq[k + 2], z = xq[k + 3];
    const v = [0, 0, -1];
    const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
    obs[3] = v[0] - w * t[0] + (y * t[2] - z * t[1]);
    obs[4] = v[1] - w * t[1] + (z * t[0] - x * t[2]);
    obs[5] = v[2] - w * t[2] + (x * t[1] - y * t[0]);
    const qpos = data.qpos, qvel = data.qvel;
    for (let i = 0; i < nu; i++) {
      obs[6 + i] = qpos[this.jointQpos[i]] - DEFAULT_POSE[i];
      obs[6 + nu + i] = qvel[this.jointQvel[i]];
      obs[6 + 2 * nu + i] = this.lastAction[i];
    }
    obs.set(this.command(), 6 + 3 * nu);
    return obs;
  }

  // async = ฟังก์ชันนี้มีจุดที่ต้อง "รอ" (await) — ตรง session.run ที่ให้สมองคิด
  async step() {
    // 1) เดินนาฬิกาของท่าที่มีเวลาจำกัด ถ้าจบแล้วสลับกลับไปใช้สมองเดิน
    if (this.pick) {
      this.pickPhase += CONTROL_DT / GROUND_PICK_PERIOD;
      if (this.pickPhase >= GROUND_PICK_END) {
        this.pick = false;
        this.vel = [0, 0, 0];
        this.policy = 'walking';  // as infer_policy.py hands back
      }
    }
    if (this.behavior) {
      this.behaviorLeft -= CONTROL_DT;
      if (this.behaviorLeft <= 0) {
        this.behavior = null;
        this.vel = [0, 0, 0];
        this.policy = 'walking';
      }
    }
    // 2) เลือกสมองตามสถานะปัจจุบัน แล้วส่ง 61 ค่าเข้าไปคิด (Tensor = ก้อนตัวเลขขนาด 1×61)
    const session = this.sessions[this.policy];
    const input = new ort.Tensor('float32', Float32Array.from(this.observe()), [1, this.obs.length]);
    const out = await session.run({ [session.inputNames[0]]: input });
    // 3) สมองตอบ 14 ค่า = ขยับแต่ละข้อจากท่าตั้งต้นไปเท่าไหร่ → เขียนลง ctrl ให้มอเตอร์
    const action = out[session.outputNames[0]].data;
    this.lastAction = Float32Array.from(action);
    const ctrl = this.data.ctrl;
    for (let i = 0; i < this.nu; i++) ctrl[i] = DEFAULT_POSE[i] + action[i];
    // 4) ให้ฟิสิกส์เดินเวลา 4 ขั้น × 0.005 วินาที = 0.02 วินาที
    for (let i = 0; i < DECIMATION; i++) this.mj.mj_step(this.model, this.data);
    this.simTime += CONTROL_DT;
  }

  // -- read-outs for the UI -------------------------------------------------
  // ---- ค่าที่ส่วนแสดงผลอ่าน: ตำแหน่งลำตัว [x, y, z] เมตร และ "ล้มหรือยัง" -----------
  get position() {
    const p = this.data.xpos, k = 3 * this.trunk;
    return [p[k], p[k + 1], p[k + 2]];
  }

  get fallen() {
    const upright = this.data.xmat[9 * this.trunk + 8];  // trunk z-axis . world z
    return !this.behavior && !this.sitMode && (upright < 0.5 || this.position[2] < 0.07);
  }
}

// =============================================================================
// ส่วนที่ 5: class Driver — แปลง "ปุ่มที่กดค้างอยู่" เป็นความเร็วส่งให้หุ่น
// =============================================================================
// ปุ่มลูกศร ปุ่มบนจอ จอยสติ๊ก และคำสั่งเสียง ทั้งหมดมาเรียก press()/release() ของที่นี่
// แล้ว drive() (ถูกเรียกทุก 0.02 วินาทีใน main) จะตัดสินว่าจะเดิน/หันเท่าไหร่
//   held  = ทิศที่ถูกกดค้างอยู่ตอนนี้ (Set = กลุ่มของที่ไม่ซ้ำ)
//   until = ถ้าแตะแป๊บเดียว ให้ขยับต่อจนถึงเวลานี้ (อย่างน้อย MIN_PRESS วินาที) → "ขยับทีละนิด"
// ============================================================================
// Input: hold-to-move keys and buttons, taps still move a little
// ============================================================================
class Driver {
  constructor(robot) {
    this.robot = robot;
    this.held = new Set();
    this.until = { up: 0, down: 0, left: 0, right: 0 };
    this.busyUntil = 0;   // ช่วงกำลังลุกจากนั่ง ห้ามสั่งเดิน (ไม่อย่างนั้นล้ม)
  }

  press(dir) {
    if (!this.held.has(dir)) this.until[dir] = performance.now() / 1000 + MIN_PRESS;
    this.held.add(dir);
  }

  release(dir) { this.held.delete(dir); }

  stop() {
    this.held.clear();
    for (const k in this.until) this.until[k] = 0;
    this.robot.setVel(0, 0, 0);
  }

  active(dir, now) { return this.held.has(dir) || now < this.until[dir]; }

  drive() {
    const r = this.robot;
    if (r.behavior || r.pick) return;  // a kick / roll / pick finishes on its own
    const now = performance.now() / 1000;   // เวลาตอนนี้ (วินาที)
    // true - false = 1 ใน JavaScript → fwd เป็น 1 (เดินหน้า) / -1 (ถอย) / 0 (ไม่กด)
    const fwd = this.active('up', now) - this.active('down', now);
    const turn = this.active('left', now) - this.active('right', now);
    if (r.sitMode) {
      if (fwd || turn) { r.toggleSit(); this.busyUntil = now + STAND_UP_TIME; }
      return;
    }
    if (now < this.busyUntil) return;
    const vx = fwd > 0 ? FORWARD : fwd < 0 ? BACKWARD : 0;
    const wz = TURN * turn;
    const [cx, cy, cz] = r.vel;
    if (cx !== vx || cy !== 0 || cz !== wz || (r.policy === 'sit' && (vx || wz))) r.setVel(vx, 0, wz);
  }

  get standingUp() { return performance.now() / 1000 < this.busyUntil; }
}

// =============================================================================
// ส่วนที่ 6: buildScene() — วาดภาพ 3D ด้วย three.js
// =============================================================================
// MuJoCo คำนวณฟิสิกส์แต่ "ไม่วาดภาพ" ในเว็บ เราเลยให้ three.js วาดแทน:
//   1. อ่านทุกชิ้นส่วน (geom) จาก model แล้วสร้างรูปทรง three.js ที่หน้าตาเหมือนกัน (ครั้งเดียว)
//   2. ทุกเฟรม sync() ก๊อปตำแหน่ง/การหมุนล่าสุดของแต่ละชิ้นจาก data มาใส่ภาพ
// ส่วนประกอบของ three.js ที่ใช้:
//   renderer = ตัววาดลง <canvas id="view">   scene = ฉากที่เก็บของทุกชิ้น
//   camera   = กล้อง                          controls = ลากเมาส์/นิ้วหมุนกล้อง (OrbitControls)
//   light    = แสง (ท้องฟ้า + ดวงอาทิตย์ทำเงา)  mesh = รูปทรง (geometry) + ผิว/สี (material)
// ฟังก์ชันนี้คืน "กล่องเครื่องมือ" { sync, follow, render, setQuality, ... } ให้ main() ใช้
// ============================================================================
// Rendering: one three.js mesh per visible MuJoCo geom
// ============================================================================

// ลายตารางหมากรุกของพื้น: วาดลงผืนผ้าใบ 256×256 แล้วเอาไปปูซ้ำๆ
// พื้นหญ้า: เขียวพื้น + จุดสีเขียวอ่อน/เข้มสุ่มๆ ให้ดูเป็นสนามหญ้าจริง ไม่แบนเรียบ
function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5f9e4a';                      // สีหญ้าพื้น
  g.fillRect(0, 0, 256, 256);
  const speckles = ['rgba(112,176,82,0.55)', 'rgba(74,132,58,0.55)', 'rgba(142,196,112,0.45)'];
  for (let i = 0; i < 2800; i++) {
    g.fillStyle = speckles[Math.floor(Math.random() * speckles.length)];
    const s = 1 + Math.random() * 2.5;
    g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ต้นไม้ง่ายๆ: ลำต้นสูง (ทรงกระบอกสีน้ำตาล) + พุ่มใบซ้อนกันเป็นทรงกรวย — ภาพล้วน หุ่นเดินทะลุได้
function makeTree(x, y, scale, trunkMat, leafMat) {
  const g = new THREE.Group();
  const h = 0.85 * scale;                                          // ลำต้นสูง ให้พุ่มใบลอยชัด ไม่เหมือนเนิน
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * scale, 0.06 * scale, h, 8), trunkMat);
  trunk.rotation.x = Math.PI / 2; trunk.position.z = h / 2;         // ฉากนี้แกน z ชี้ขึ้น
  trunk.castShadow = true;
  g.add(trunk);
  // พุ่มใบ 3 ชั้น ใหญ่→เล็ก ไล่ขึ้นบน = ทรงต้นไม้
  for (const [dz, r] of [[-0.02, 0.30], [0.20, 0.24], [0.38, 0.16]]) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(r * scale, 12, 10), leafMat);
    leaf.position.set(0, 0, h + dz * scale);
    leaf.castShadow = true;
    g.add(leaf);
  }
  g.position.set(x, y, 0);   // ปล่อยให้ three.js อัปเดตเมทริกซ์เอง (ของตกแต่งไม่กี่ชิ้น)
  return g;
}

function buildScene(mujoco, model, canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  // ท้องฟ้ากลางแจ้ง: หมอกจางๆ ให้ขอบพื้นกลืนไปกับฟ้า (โดมฟ้าไล่สีเพิ่มด้านล่าง)
  scene.background = new THREE.Color('#dcecf7');
  scene.fog = new THREE.Fog('#dcecf7', 6, 18);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
  camera.up.set(0, 0, 1);  // MuJoCo is z-up
  const controls = new OrbitControls(camera, renderer.domElement);  // placed by frame() below
  controls.enableDamping = true;
  controls.minDistance = 0.25;
  controls.maxDistance = 3;
  controls.maxPolarAngle = Math.PI * 0.49;

  scene.add(new THREE.HemisphereLight('#e8f1ff', '#27405c', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.1, far: 5 });
  scene.add(sun, sun.target);

  // ---- โดมท้องฟ้าไล่สี (ฟ้าเข้มด้านบน → ขาวจางที่ขอบฟ้า) ----
  {
    const cv = document.createElement('canvas');
    cv.width = 2; cv.height = 256;
    const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#3f86d8');    // กลางฟ้า (zenith)
    grd.addColorStop(0.55, '#8fc0ec');
    grd.addColorStop(1, '#e7f2fb');    // ขอบฟ้า
    g.fillStyle = grd; g.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(30, 32, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    sky.rotation.x = Math.PI / 2;      // ย้ายขั้วโดมจากแกน y ไปแกน z (ฉากนี้ z ชี้ขึ้น)
    sky.matrixAutoUpdate = false; sky.updateMatrix();
    scene.add(sky);
  }

  // ---- ต้นไม้ + พุ่มไม้รอบๆ ให้เป็นสวน (ภาพล้วน ไม่มีฟิสิกส์ วางไว้รอบพื้นที่เดิน) ----
  {
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: '#4c9a3f', roughness: 0.8 });
    const leafMat2 = new THREE.MeshStandardMaterial({ color: '#6cb84f', roughness: 0.8 });
    // ต้นไม้วางเป็นวงรอบ รัศมี 5–8 ม. เป็นฉากหลัง (พื้นที่เดินของหุ่นอยู่ตรงกลาง โล่งๆ)
    const trees = [[5.2, 2.0, 1.2], [-5.0, 3.4, 1.0], [-4.2, -5.0, 1.3], [5.8, -3.2, 1.1],
      [0.6, 6.8, 1.2], [-7.0, -1.2, 1.1], [7.2, 4.8, 1.0], [-2.2, -7.2, 1.15],
      [3.2, -6.4, 1.05], [-6.2, 5.2, 1.0]];
    for (const [x, y, s] of trees) scene.add(makeTree(x, y, s, trunkMat, (Math.round(x) + Math.round(y)) % 2 ? leafMat : leafMat2));
    // พุ่มไม้เตี้ยๆ วางห่างหุ่นหน่อย (รัศมี ~2.5–3.5 ม.)
    for (const [x, y, r] of [[2.8, -2.4, 0.17], [-3.0, 2.2, 0.19], [3.2, 2.8, 0.15], [-2.6, -3.0, 0.16]]) {
      const bush = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), leafMat2);
      bush.position.set(x, y, r * 0.7);
      bush.castShadow = true;
      scene.add(bush);
    }
  }

  // ---- สร้างภาพให้ทุกชิ้นส่วน: ดูชนิดของชิ้น (ทรงกลม กล่อง แคปซูล mesh ฯลฯ) แล้วสร้างรูปทรงแบบเดียวกัน ----
  const T = mujoco.mjtGeom;
  const types = model.geom_type, sizes = model.geom_size, groups = model.geom_group;
  const matid = model.geom_matid, matRgba = model.mat_rgba, matEmission = model.mat_emission;
  const geomRgba = model.geom_rgba;
  const meshes = [];
  for (let i = 0; i < model.ngeom; i++) {
    if (groups[i] >= 3) continue;  // collision shapes stay hidden
    const t = types[i];
    const [sx, sy, sz] = [sizes[3 * i], sizes[3 * i + 1], sizes[3 * i + 2]];
    let geo;
    if (t === T.mjGEOM_PLANE.value) {
      geo = new THREE.PlaneGeometry(40, 40);
    } else if (t === T.mjGEOM_SPHERE.value) {
      geo = new THREE.SphereGeometry(sx, 32, 20);
    } else if (t === T.mjGEOM_ELLIPSOID.value) {
      geo = new THREE.SphereGeometry(1, 32, 20).scale(sx, sy, sz);
    } else if (t === T.mjGEOM_CAPSULE.value) {
      geo = new THREE.CapsuleGeometry(sx, 2 * sy, 8, 20).rotateX(Math.PI / 2);
    } else if (t === T.mjGEOM_CYLINDER.value) {
      geo = new THREE.CylinderGeometry(sx, sx, 2 * sy, 32).rotateX(Math.PI / 2);
    } else if (t === T.mjGEOM_BOX.value) {
      geo = new THREE.BoxGeometry(2 * sx, 2 * sy, 2 * sz);
    } else if (t === T.mjGEOM_MESH.value) {
      // Our generated meshes (rounded boxes, rings), in MuJoCo's compiled mesh frame.
      const id = model.geom_dataid[i];
      const va = model.mesh_vertadr[id], vn = model.mesh_vertnum[id];
      const fa = model.mesh_faceadr[id], fn = model.mesh_facenum[id];
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(model.mesh_vert.slice(3 * va, 3 * (va + vn))), 3));
      geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(model.mesh_face.slice(3 * fa, 3 * (fa + fn))), 1));
      geo.computeVertexNormals();
    } else {
      continue;
    }
    const m = matid[i];
    if (m >= 0 && FACE_MATERIALS.includes(mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_MATERIAL.value, m))) continue;
    const rgba = m >= 0 ? matRgba.slice(4 * m, 4 * m + 4) : geomRgba.slice(4 * i, 4 * i + 4);
    const color = new THREE.Color().setRGB(rgba[0], rgba[1], rgba[2], THREE.SRGBColorSpace);
    const seeThrough = rgba[3] < 1;
    const material = t === T.mjGEOM_PLANE.value
      ? new THREE.MeshStandardMaterial({ map: (() => { const tx = grassTexture(); tx.repeat.set(48, 48); return tx; })(), roughness: 0.95, metalness: 0 })
      : new THREE.MeshStandardMaterial({
        color, roughness: 0.45, metalness: 0.05,
        emissive: color.clone().multiplyScalar(m >= 0 ? matEmission[m] : 0),
        transparent: seeThrough, opacity: rgba[3], depthWrite: !seeThrough, side: seeThrough ? THREE.DoubleSide : THREE.FrontSide,
      });
    const mesh = new THREE.Mesh(geo, material);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = t !== T.mjGEOM_PLANE.value && !seeThrough;
    mesh.receiveShadow = t === T.mjGEOM_PLANE.value;
    scene.add(mesh);
    meshes.push([i, mesh]);
  }

  // ทุกเฟรม: เอาตำแหน่ง (geom_xpos) และการหมุน (geom_xmat เมทริกซ์ 3×3) ของแต่ละชิ้นจาก MuJoCo
  // มาใส่เป็นเมทริกซ์ 4×4 ของภาพ three.js ภาพจึงขยับตามฟิสิกส์
  function sync(data) {
    const xp = data.geom_xpos, xm = data.geom_xmat;
    for (const [i, mesh] of meshes) {
      const p = 3 * i, r = 9 * i;
      mesh.matrix.set(
        xm[r], xm[r + 1], xm[r + 2], xp[p],
        xm[r + 3], xm[r + 4], xm[r + 5], xp[p + 1],
        xm[r + 6], xm[r + 7], xm[r + 8], xp[p + 2],
        0, 0, 0, 1);
    }
  }

  // ---- กล้อง: ตำแหน่งเริ่มต้นตามขนาดจอ + ตามตัวหุ่นไปเรื่อยๆ ----
  // Where the camera starts, relative to the robot. Wide screens look between
  // the robot and the goal 1.3 m ahead so both are in view; tall phone screens
  // are too narrow for that and frame the robot, aiming low so it sits above
  // the buttons at the bottom.
  const FRAMING = {
    wide: { target: [0.85, 0.05, 0.08], camera: [0.2, -2.15, 0.87], fov: 40 },
    tall: { target: [0.15, 0, 0.02], camera: [0.35, -1.2, 0.55], fov: 62 },
  };
  const tracked = new THREE.Vector3();  // smoothed robot position on the floor
  let framing = null;
  function frame(kind) {
    framing = kind;
    const f = FRAMING[kind];
    controls.target.copy(tracked).add(new THREE.Vector3(...f.target));
    camera.position.copy(controls.target).add(new THREE.Vector3(...f.camera));
    camera.fov = f.fov;
    camera.updateProjectionMatrix();
  }

  function follow([x, y]) {
    // Keep orbiting around the robot: move camera and target by how far it went.
    const delta = new THREE.Vector3(x, y, 0).sub(tracked).multiplyScalar(0.15);
    tracked.add(delta);
    controls.target.add(delta);
    camera.position.add(delta);
    sun.position.set(tracked.x + 0.8, tracked.y - 0.5, 1.6);
    sun.target.position.copy(tracked);
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const kind = camera.aspect < 0.9 ? 'tall' : 'wide';
    if (kind !== framing) frame(kind);  // first layout, or the phone was turned
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- คุณภาพภาพ: ความละเอียด (pixel ratio) และเงา ยิ่งต่ำยิ่งลื่นบนเครื่องช้า ----
  // Graphics quality, stepped down automatically on slow devices (see main).
  const QUALITY = {
    high: { ratio: Math.min(window.devicePixelRatio, 1.5), shadows: true },
    medium: { ratio: 1, shadows: false },
    low: { ratio: 0.7, shadows: false },
  };
  let quality = 'high';
  function setQuality(level) {
    quality = level;
    const q = QUALITY[level];
    renderer.setPixelRatio(q.ratio);
    renderer.shadowMap.enabled = q.shadows;
    sun.castShadow = q.shadows;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    resize();
  }

  // คืนเครื่องมือให้ main() ใช้ (ตัวแปรข้างในฟังก์ชันนี้ ข้างนอกมองไม่เห็น ยกเว้นที่คืนออกไป)
  return {
    scene, sync, follow, setQuality,
    get quality() { return quality; },
    render() { controls.update(); renderer.render(scene, camera); },
  };
}

// =============================================================================
// ส่วนที่ 7: UI — เชื่อมปุ่มและข้อความในหน้าเว็บ (index.html) เข้ากับหุ่น
// =============================================================================
// หลักการ: หา element ด้วย $('id') หรือ document.querySelectorAll('[data-...]')
// แล้ว addEventListener('click' / 'keydown' / 'pointerdown', ฟังก์ชัน) = "เมื่อเกิดเหตุการณ์นี้ ให้ทำสิ่งนี้"
// ฟังก์ชันในส่วนนี้:
//   statusText()    ข้อความป้ายสถานะตรงกลางบน (ภาษาจีน)
//   wireGame()      ปุ่มท้าทาย 60 วินาที หน้าสรุปผล ปุ่มเสียง
//   wireVoice()     ปุ่มไมค์ + ปุ่ม V + กล่องข้อความเสียง
//   showScore()     อัปเดตตัวเลขคะแนน/เวลา   showResult() เปิดหน้าสรุปผล
//   wireControls()  คีย์บอร์ด ปุ่มบนจอ เต็มจอ กันซูมบนมือถือ
//   wireJoystick()  จอยสติ๊กบนจอสัมผัส      wireTutorial() หน้าสอนเล่น
// ============================================================================
// UI
// ============================================================================

// เลือกข้อความสถานะตามลำดับความสำคัญ: ยิงเข้า > ล้ม > บอลอยู่หน้าเท้า > กำลังทำท่า > นั่ง > เดิน/ยืน
// คืนค่าเป็น [ข้อความ, ชนิด] ชนิดใช้เลือกสีใน CSS (#status[data-kind="..."])
function statusText(robot, driver, name, game) {
  const touch = matchMedia('(pointer: coarse)').matches;
  if (game.celebrating) return ['進球！🎉', 'goal'];
  if (robot.fallen) return [`${name}跌倒了！請按「重新開始」${touch ? '' : '或 Backspace'}`, 'bad'];
  const foot = !robot.behavior && !robot.pick && !robot.sitMode && robot.kickReady();
  if (foot === 'kick_left') return [`球在左腳前面！按「左腳踢球」${touch ? '' : '（K）'}`, 'hint'];
  if (foot === 'kick_right') return [`球在右腳前面！按「右腳踢球」${touch ? '' : '（L）'}`, 'hint'];
  const busy = { ground_pick: '正在低頭撿東西', kick_left: '正在用左腳踢球', kick_right: '正在用右腳踢球', roulade: '正在前滾翻' };
  if (busy[robot.policy]) return [busy[robot.policy], 'busy'];
  if (robot.sitMode) return [`坐著（按「坐下／站起」或${touch ? '推搖桿' : '方向鍵'}站起來）`, 'busy'];
  if (driver.standingUp) return ['正在站起來…', 'busy'];
  const [vx, , wz] = robot.vel;
  const parts = [];
  if (vx > 0) parts.push('前進'); else if (vx < 0) parts.push('後退');
  if (wz > 0) parts.push('左轉'); else if (wz < 0) parts.push('右轉');
  return [parts.length ? parts.join(' + ') : '站著待命', 'ok'];
}

// ปุ่มเปิด/ปิดเสียง (โหมดเกม บอล/ประตู/คะแนน ถูกถอดออกแล้ว เหลือฉากสวนให้เดินเล่น)
function wireSound() {
  const mute = $('mute-btn');
  const showMute = () => { mute.textContent = sfx.muted ? '🔇' : '🔊'; mute.title = sfx.muted ? '開啟音效' : '關閉音效'; };
  mute.addEventListener('click', () => { sfx.toggle(); showMute(); });
  showMute();
}

// Microphone buttons (panel on computers, round button on phones) and the V key.
function wireVoice(robot, driver, game, name) {
  const bubble = $('voice-bubble');
  const buttons = document.querySelectorAll('[data-voice]');
  let hideTimer = null;
  // "สมอง" ของหุ่น — ปกติต่อ AI จริง (LiteLLM ของ慈大 ผ่าน proxy aura-xiaoci)
  // เปลี่ยนโหมดทดสอบได้ทาง URL: ?brain=mock (สมองปลอม) / ?brain=keywords (ตารางคำ)
  const mode = new URLSearchParams(location.search).get('brain') || 'llm';
  const brain = new Brain({
    mode,
    name,
    endpoint: 'https://harmony-ms-cmf.com/api/xiaoci',
    parseCommand,   // เผื่อ AI ต่อไม่ได้ ยังฟังคำสั่งพื้นฐานได้จากตารางคำ
  });
  const pulsing = new Set(['listening', 'heard', 'thinking']);
  const voice = new Voice({
    robot, driver, game, name, brain,
    onState(state, text) {
      for (const b of buttons) b.classList.toggle('listening', pulsing.has(state));
      clearTimeout(hideTimer);
      if (state === 'idle') { bubble.hidden = true; return; }
      const label = { listening: '🎤 ', heard: '「', thinking: '💭 ', reply: `${name}：`, error: '⚠️ ' }[state];
      bubble.textContent = state === 'heard' ? `${label}${text}」` : `${label}${text}`;
      bubble.dataset.kind = state;
      bubble.hidden = false;
      if (state === 'reply' || state === 'error') hideTimer = setTimeout(() => { bubble.hidden = true; }, 4500);
    },
  });
  voice.muted = () => sfx.muted;
  for (const b of buttons) {
    b.title = voice.available ? '點一下，然後說話' : voice.unavailableReason;
    b.addEventListener('click', () => voice.toggle());
  }
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;  // อย่าให้ปุ่มลัดทำงานตอนกำลังพิมพ์ในช่องแชท
    if (!e.repeat && e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) voice.toggle();
  });

  // ช่องพิมพ์คุย (สำหรับทดสอบ / เครื่องที่ใช้ไมค์ไม่ได้) — ส่งข้อความเข้าสมองเดียวกับเสียง
  const form = $('chat-form');
  const input = $('chat-input');
  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      voice.onState('heard', text);
      voice.handle(text);
    });
  }
  return voice;
}

// ผูกปุ่มทั้งหมด: actions คือตาราง "ชื่อการกระทำ → ฟังก์ชัน" ปุ่มในหน้าเว็บใช้ data-action="y" ฯลฯ
// อยากเพิ่มปุ่มใหม่: ①เพิ่มบรรทัดใน actions ②เพิ่ม <button data-action="ชื่อ"> ใน index.html
function wireControls(robot, driver, name) {
  const actions = {
    y: () => robot.toggleSit(),
    r: () => robot.triggerBehavior('roulade'),
    p: () => robot.push(),
    reset: () => { robot.reset(); driver.stop(); },
    stop: () => driver.stop(),
  };
  for (const el of document.querySelectorAll('.push-label')) el.textContent = `推一下${name}`;

  // Keyboard: arrows hold-to-move; letters trigger moves.
  // ข้ามทั้งหมดถ้ากำลังพิมพ์ในช่องข้อความ (ไม่งั้น Backspace ไปสั่งรีเซ็ต ตัวอักษรไปสั่งท่า
  //  จนลบข้อความไม่ได้และหุ่นกระตุก) — ให้ช่องแชททำงานตามปกติของมัน
  const typing = (e) => e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
  const keyDir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (keyDir[e.key]) { e.preventDefault(); if (!e.repeat) driver.press(keyDir[e.key]); return; }
    if (e.repeat) return;
    if (e.key === ' ') { e.preventDefault(); actions.stop(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); actions.reset(); return; }
    const k = e.key.toLowerCase();
    if (actions[k] && k.length === 1) actions[k]();
  });
  window.addEventListener('keyup', (e) => { if (keyDir[e.key]) driver.release(keyDir[e.key]); });
  window.addEventListener('blur', () => driver.held.clear());

  // On-screen buttons (mouse and touch): hold the arrows, tap the rest.
  for (const btn of document.querySelectorAll('[data-dir]')) {
    const dir = btn.dataset.dir;
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); driver.press(dir); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => driver.release(dir));
  }
  for (const btn of document.querySelectorAll('[data-action]')) {
    btn.addEventListener('click', () => actions[btn.dataset.action]());
  }

  wireJoystick(driver);

  // Phones: no page zoom / long-press menus while playing.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => { if (e.target.closest('button, #joystick, #view')) e.preventDefault(); });

  // Full screen (not offered where the browser cannot do it, e.g. iPhone Safari).
  const root = document.documentElement;
  if (document.fullscreenEnabled && root.requestFullscreen) {
    $('fs-btn').hidden = false;
    $('fs-btn').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    });
  }
}

// Joystick for touch screens: push up to walk, down to back up, sideways to turn.
// It drives the same held directions as the arrow keys, so taps still make a
// small step and holding keeps going.
function wireJoystick(driver) {
  const pad = $('joystick');
  const knob = pad.querySelector('.knob');
  const THRESHOLD = 0.35;  // fraction of the radius before a direction counts
  const mine = new Set();
  let active = null;

  function set(dirs) {
    for (const d of ['up', 'down', 'left', 'right']) {
      if (dirs.has(d) && !mine.has(d)) { mine.add(d); driver.press(d); }
      if (!dirs.has(d) && mine.has(d)) { mine.delete(d); driver.release(d); }
    }
  }

  function move(e) {
    const r = pad.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = e.clientX - (r.left + radius), dy = e.clientY - (r.top + radius);
    const len = Math.hypot(dx, dy), max = radius * 0.62;
    if (len > max) { dx *= max / len; dy *= max / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const fx = dx / max, fy = -dy / max;
    const dirs = new Set();
    if (fy > THRESHOLD) dirs.add('up');
    if (fy < -THRESHOLD) dirs.add('down');
    if (fx < -THRESHOLD) dirs.add('left');
    if (fx > THRESHOLD) dirs.add('right');
    set(dirs);
  }

  function end() {
    active = null;
    knob.style.transform = '';
    set(new Set());
  }

  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    active = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    move(e);
  });
  pad.addEventListener('pointermove', (e) => { if (e.pointerId === active) move(e); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    pad.addEventListener(ev, (e) => { if (e.pointerId === active) end(); });
  }
}

// First-visit how-to-play card; the "?" button brings it back.
function wireTutorial(name) {
  const KEY = 'xiaoci.tutorialSeen';
  $('tutorial-title').textContent = `歡迎來到${name}的世界！`;
  const open = () => { $('tutorial').hidden = false; };
  const close = () => {
    $('tutorial').hidden = true;
    try { localStorage.setItem(KEY, '1'); } catch { /* private mode: just show it again next time */ }
  };
  $('help-btn').addEventListener('click', open);
  $('tutorial-go').addEventListener('click', close);
  $('tutorial').addEventListener('click', (e) => { if (e.target === $('tutorial')) close(); });
  let seen = false;
  try { seen = localStorage.getItem(KEY) === '1'; } catch { /* storage blocked */ }
  if (!seen) open();
}

// =============================================================================
// ส่วนที่ 8: main() — จุดเริ่มต้นของโปรแกรม
// =============================================================================
// ลำดับงาน:
//   ① เช็กเบราว์เซอร์ → ② อ่านชื่อหุ่น + หน้าสอนเล่น → ③ ดาวน์โหลดทุกไฟล์พร้อมกัน (แถบ %)
//   ④ เตรียมสมอง 7 ตัว → ⑤ สร้างโลก MuJoCo (ใส่ประตูฟุตบอล) → ⑥ สร้างหุ่น เกม ภาพ สีหน้า และผูกปุ่ม
//   ⑦ ปิดหน้าโหลด → ⑧ เริ่ม "วงรอบหลัก" frame() ที่เบราว์เซอร์เรียกประมาณ 60 ครั้งต่อวินาที
// await = "รอให้งานนี้เสร็จก่อนค่อยทำบรรทัดต่อไป" ใช้ได้ในฟังก์ชันที่ประกาศว่า async
// ============================================================================
// Boot
// ============================================================================
async function main() {
  const reason = unsupportedReason();
  if (reason) throw new Error(`${reason}請改用最新版的 Chrome、Edge 或 Safari。`);

  const name = await fetch(ASSETS.name).then((r) => (r.ok ? r.text() : '機器人')).then((t) => t.trim() || '機器人')
    .catch(() => '機器人');
  document.title = `${name}・機器人模擬`;
  $('robot-name').textContent = name;
  wireTutorial(name);

  // Everything downloads at once behind one progress bar.
  setLoading('下載物理引擎、動作模型與場景…');
  const xmlText = fetch(ASSETS.scene).then((r) => {
    if (!r.ok) throw new Error(`${ASSETS.scene} (${r.status})`);
    return r.text();
  });
  const mujocoReady = download(MUJOCO_WASM.url, MUJOCO_WASM.bytes)
    .then((bin) => loadMujoco({ wasmBinary: bin.buffer }));
  const ortReady = download(ORT_WASM.url, ORT_WASM.bytes).then((bin) => {
    ort.env.wasm.numThreads = 1;      // no cross-origin isolation needed
    ort.env.wasm.wasmPaths = ORT_BASE;  // its small JS glue still comes from here
    ort.env.wasm.wasmBinary = bin;
  });
  const policyBytes = Object.fromEntries(Object.entries(POLICY_FILES).map(
    ([key, file]) => [key, download(ASSETS.policies + file, POLICY_BYTES)]));
  // Promise.all = รอทุกงานดาวน์โหลดเสร็จพร้อมกัน (โหลดขนานกันเร็วกว่าทีละไฟล์)
  const [mujoco] = await Promise.all([mujocoReady, ortReady, ...Object.values(policyBytes)]);

  setLoading('準備動作模型…');
  const sessions = {};
  for (const [key, bytes] of Object.entries(policyBytes)) {
    sessions[key] = await ort.InferenceSession.create(await bytes, { executionProviders: ['wasm'] });
  }

  setLoading('建立場景…');
  // The policies run at 50 Hz on a 5 ms physics step, as in infer_policy.py.
  const xml = (await xmlText).replace(/<mujoco([^>]*)>/, `<mujoco$1>\n  <option timestep="${TIMESTEP}"/>`);
  // ประกอบทุกชิ้นส่วนเข้าด้วยกัน (แต่ละตัวมาจากส่วนที่ 4–7 และไฟล์ face/game/voice)
  const model = mujoco.MjModel.from_xml_string(xml);
  const data = new mujoco.MjData(model);
  const robot = new Robot(mujoco, model, data, sessions);
  const driver = new Driver(robot);
  const game = new Game(robot);
  const view = buildScene(mujoco, model, $('view'));
  const face = new Face(view.scene, mujoco, model);
  wireControls(robot, driver, name);
  wireSound();
  const voice = wireVoice(robot, driver, game, name);
  window.__sim = { robot, driver, game, voice, brain: voice.brain, mujoco, model, data };  // handy in the browser console

  $('loading').hidden = true;

  // Sounds and the face react to what just happened.
  // หุ่นกับเกมฝาก "เหตุการณ์" ไว้ใน events (เช่น 'kick', 'goal') ตรงนี้หยิบออกมาเล่นเสียงทีละอัน
  const SOUND_OF = { sit: 'sit', stand: 'stand', pick: 'pick', roll: 'roll', push: 'push', hit: 'kick', goal: 'goal' };
  let wasFallen = false;
  function react() {
    for (const e of robot.events.splice(0)) if (SOUND_OF[e]) sfx.play(SOUND_OF[e]);
    const fallen = robot.fallen;
    if (fallen && !wasFallen) sfx.play('fall');
    wasFallen = fallen;
  }
  // เลือกสีหน้าตามสถานการณ์ (ชื่อสีหน้าต้องมีใน face.js) อันบนสุดที่เป็นจริงชนะ
  function expression() {
    if (game.celebrating) return 'love';
    if (robot.fallen) return 'down';
    if (voice.thinking) return 'curious';          // กำลังรอสมองคิด
    if (voice.listening) return 'curious';         // กำลังฟังเสียง
    // ท่าที่กำลังทำอยู่จริงชนะสีหน้าที่ AI สั่ง (เช่นตอนตีลังกาต้องหน้าตาลาย ไม่ใช่หน้ายิ้ม)
    if (robot.policy === 'roulade') return 'dizzy';
    if (robot.behavior) return 'determined';
    if (robot.pick) return 'curious';
    if (robot.sitMode) return 'sleepy';
    if (robot.simTime - robot.pushedAt < 1.2) return 'surprised';
    const mood = voice.activeMood();               // สีหน้าที่ AI สั่งล่าสุด (ค้าง ~4 วิ) เติมตอนยืนเฉย
    if (mood) return mood;
    return 'happy';
  }

  // ---- วงรอบหลัก (game loop) --------------------------------------------------------
  // requestAnimationFrame(frame) = "ขอให้เรียก frame() อีกทีตอนจอพร้อมวาดภาพถัดไป" (~60 ครั้ง/วินาที)
  // แต่สมองต้องคิดทุก 0.02 วินาทีพอดี (50 ครั้ง/วินาที) เลยนับเวลาจริงแล้ว "ตามให้ทัน":
  // เฟรมนี้ถึงเวลาคิดกี่รอบก็คิดเท่านั้น (ไม่เกิน 6 รอบ ถ้าเครื่องช้ามากก็ปล่อยให้ช้าลง)
  // ในแต่ละเฟรม: ①คิด+ฟิสิกส์ ②เสียง/เหตุการณ์ ③อัปเดตภาพและสีหน้า ④ข้อความสถานะ/คะแนน ⑤วัด FPS ปรับคุณภาพ
  // Fixed 50 Hz control, catching up with real time; slow machines just run slower.
  let simTime = 0, wallStart = performance.now() / 1000, stepping = false;
  let frames = 0, fpsClock = performance.now(), speedSim = 0;
  // Auto quality: after a short warm-up, step down while frames are slow.
  let slowSeconds = 0, secondsRun = 0;
  const QUALITY_NAME = { high: '高畫質', medium: '中畫質', low: '低畫質' };
  async function frame() {
    requestAnimationFrame(frame);
    if (!stepping) {
      stepping = true;
      try {
        const wall = performance.now() / 1000 - wallStart;
        if (wall - simTime > 0.25) { wallStart += wall - simTime - 0.25; }  // tab was hidden / too slow
        const target = performance.now() / 1000 - wallStart;
        let n = 0;
        while (simTime + CONTROL_DT <= target && n < 6) {
          driver.drive();
          await robot.step();
          game.step();
          simTime += CONTROL_DT;
          speedSim += CONTROL_DT;
          n++;
        }
      } catch (err) {
        showError(err);
        return;
      } finally {
        stepping = false;
      }
    }
    react();
    const now = performance.now();
    view.sync(data);
    face.sync(data);
    face.update((now - (frame.last || now)) / 1000, expression(), Math.sign(robot.vel[2]), Math.abs(robot.vel[0]) > 0);
    frame.last = now;
    view.follow(robot.position);
    view.render();
    const [text, kind] = statusText(robot, driver, name, game);
    const st = $('status');
    if (st.textContent !== text) st.textContent = text;
    st.dataset.kind = kind;
    frames++;
    if (now - fpsClock > 1000) {
      const fps = frames * 1000 / (now - fpsClock);
      const speed = speedSim * 1000 / (now - fpsClock);
      secondsRun++;
      if (secondsRun > 2 && !document.hidden) {
        slowSeconds = fps < 40 || speed < 0.9 ? slowSeconds + 1 : 0;
        if (slowSeconds >= 3 && view.quality !== 'low') {
          view.setQuality(view.quality === 'high' ? 'medium' : 'low');
          slowSeconds = 0;
        }
      }
      $('perf').textContent = `${Math.round(fps)} FPS・模擬速度 ${Math.round(100 * speed)}%・${QUALITY_NAME[view.quality]}`;
      frames = 0; speedSim = 0; fpsClock = now;
    }
  }
  requestAnimationFrame(frame);
}

// =============================================================================
// ส่วนที่ 9: ปุ่ม QR สำหรับมือถือ + หน้าจอแจ้ง error + สั่งเริ่มโปรแกรม
// =============================================================================
// QR code for phones:
//  - on this computer under tools/serve.py --lan: the address phones on the same Wi-Fi use;
//  - on a public https site: the page's own address, to share it.
async function offerPhoneQr() {
  let url = null;
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    try {
      url = ((await (await fetch('/__lan.json')).json()).urls || [])[0] || null;
    } catch { /* not served by tools/serve.py --lan */ }
  } else if (location.protocol === 'https:') {
    url = location.href.split('#')[0];
    $('phone-btn').textContent = '📱 分享給朋友';
    $('phone-title').textContent = '分享給朋友';
    $('phone-note').textContent = '用手機相機掃描這個 QR Code，就能在手機上玩。';
  }
  if (!url) return;
  $('phone-btn').hidden = false;
  $('phone-btn').addEventListener('click', async () => {
    if (!window.qrcode) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = './vendor/qrcode-generator/qrcode.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    $('phone-url').textContent = url;
    $('phone').hidden = false;
  });
  $('phone-close').addEventListener('click', () => { $('phone').hidden = true; });
  $('phone').addEventListener('click', (e) => { if (e.target === $('phone')) $('phone').hidden = true; });
}

function showError(err) {
  console.error(err);
  $('loading').hidden = false;
  $('loading').classList.add('error');
  $('loading-title').textContent = '無法開始';
  const offline = !navigator.onLine ? '（沒有網路連線？第一次需要上網下載）' : '';
  setLoading(`發生錯誤：${err.message || err}${offline}`);
}

// สองบรรทัดสุดท้ายนี้คือที่ที่ทุกอย่าง "เริ่มจริง" (บรรทัดข้างบนแค่ประกาศฟังก์ชันไว้)
// .catch(showError) = ถ้า main() พังตรงไหน ให้แสดงข้อความ error บนจอแทนที่จะเงียบหาย
main().catch(showError);
offerPhoneQr();
