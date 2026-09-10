// Kid robot web simulator: MuJoCo (WASM) physics + the official MicroDuck
// policies (onnxruntime-web) + three.js rendering. Runs entirely in the browser.
//
// The control loop mirrors microduck_rl/scripts/infer_policy.py with
// --new-cmd-obs (61-D observation) and projected gravity; the motors are the
// scene's own position actuators (the Python BAM motor model has no web port;
// every move was checked to still work without it).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import loadMujoco from './vendor/mujoco/mujoco.js';
import * as ort from './vendor/onnxruntime-web/ort.wasm.min.mjs';
import { Face } from './face.js';
import { Game, withGoal } from './game.js';
import { sfx } from './sound.js';
import { Voice } from './voice.js';

// The model's static eyes/cheeks; the web draws animated ones instead (face.js).
const FACE_MATERIALS = ['tcu_eye', 'tcu_blush'];

// Everything is served from this folder (tools/build_site.py puts it there).
const ASSETS = {
  scene: './assets/scene.xml',
  name: './assets/name.txt',
  policies: './assets/policies/',
};
const POLICY_FILES = {
  walking: 'alpha_walking.onnx',
  standing: 'alpha_stand.onnx',
  sit: 'alpha_sitstand.onnx',
  ground_pick: 'alpha_ground_pick.onnx',
  kick_left: 'ball_kick_left.onnx',
  kick_right: 'ball_kick_right.onnx',
  roulade: 'roulade.onnx',
};

// --- constants mirrored from infer_policy.py --------------------------------
const DEFAULT_POSE = Float32Array.from([
  0.0, -0.0873, -0.4579, -0.0049, 0.4530,   // left hip yaw/roll/pitch, knee, ankle
  0.3491, 0.3491, 0.0, 0.0,                 // neck pitch, head pitch/yaw/roll
  0.0, 0.0873, 0.4579, 0.0049, -0.4530,     // right leg
]);
const TIMESTEP = 0.005;
const DECIMATION = 4;
const CONTROL_DT = TIMESTEP * DECIMATION;   // 50 Hz policy
const SWITCH_THRESHOLD = 0.05;              // |velocity command| walking <-> standing
const GROUND_PICK_PERIOD = 4.0;
const GROUND_PICK_END = 0.7;                // phase at which one pick is done
const BEHAVIOR_DURATION = { kick_left: 3.0, kick_right: 3.0, roulade: 2.0 };
const BALL_OFFSET_X = 0.09, BALL_OFFSET_ABS_Y = 0.042, BALL_RADIUS = 0.035;
const PUSH_SPEED = 1.0;
const START_HEIGHT = 0.125;

// --- game-style driving (same feel as duck_easy.py) -------------------------
const FORWARD = 0.3, BACKWARD = -0.3;       // m/s, the walking policy's range
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

const $ = (id) => document.getElementById(id);

function setLoading(text) {
  $('loading-text').textContent = text;
}

// --- downloads with one combined progress bar --------------------------------
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

function unsupportedReason() {
  if (typeof WebAssembly !== 'object') return '這個瀏覽器不支援 WebAssembly。';
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return '這個瀏覽器（或顯示卡設定）不支援 WebGL 2，無法顯示 3D 畫面。';
  return null;
}

// ============================================================================
// Robot: state machine + policy inference (port of PolicyInference)
// ============================================================================
class Robot {
  constructor(mujoco, model, data, sessions) {
    this.mj = mujoco;
    this.model = model;
    this.data = data;
    this.sessions = sessions;
    const id = (type, name) => mujoco.mj_name2id(model, mujoco.mjtObj[type].value, name);

    this.trunk = id('mjOBJ_BODY', 'trunk_base');
    const free = id('mjOBJ_JOINT', 'trunk_base_freejoint');
    this.freeQpos = model.jnt_qposadr[free];
    this.freeQvel = model.jnt_dofadr[free];
    const ball = id('mjOBJ_JOINT', 'ball_free');
    this.ballQpos = ball >= 0 ? model.jnt_qposadr[ball] : -1;
    this.ballQvel = ball >= 0 ? model.jnt_dofadr[ball] : -1;
    this.gyroAdr = model.sensor_adr[id('mjOBJ_SENSOR', 'imu_ang_vel')];

    this.nu = model.nu;
    const trn = model.actuator_trnid;
    this.jointQpos = [], this.jointQvel = [];
    for (let i = 0; i < this.nu; i++) {
      this.jointQpos.push(model.jnt_qposadr[trn[2 * i]]);
      this.jointQvel.push(model.jnt_dofadr[trn[2 * i]]);
    }
    this.obs = new Float32Array(3 + 3 + 3 * this.nu + 13);
    this.simTime = 0;       // seconds of simulation since the page opened (never reset)
    this.pushedAt = -10;
    this.events = [];       // 'sit', 'stand', 'pick', 'kick', 'roll', 'push' for sounds/face
    this.reset();
  }

  reset() {
    const { mj, model, data } = this;
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
  setVel(vx, vy, wz) {
    this.vel = [vx, vy, wz];
    if (this.pick || this.sitMode || this.behavior) return;
    this.policy = Math.hypot(vx, vy, wz) <= SWITCH_THRESHOLD ? 'standing' : 'walking';
  }

  toggleSit() {
    if (this.pick || this.behavior) return;
    this.sitMode = !this.sitMode;
    if (this.sitMode) this.vel = [0, 0, 0];
    this.policy = 'sit';  // standing back up is done by the same policy (flag 0)
    this.events.push(this.sitMode ? 'sit' : 'stand');
  }

  triggerPick() {
    if (this.pick || this.sitMode || this.behavior) return;
    this.pick = true;
    this.pickPhase = 0;
    this.policy = 'ground_pick';
    this.events.push('pick');
  }

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

  push() {
    const a = Math.random() * 2 * Math.PI;
    const v = this.data.qvel;
    v[this.freeQvel] = PUSH_SPEED * Math.cos(a);
    v[this.freeQvel + 1] = PUSH_SPEED * Math.sin(a);
    this.pushedAt = this.simTime;
    this.events.push('push');
  }

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

  async step() {
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
    const session = this.sessions[this.policy];
    const input = new ort.Tensor('float32', Float32Array.from(this.observe()), [1, this.obs.length]);
    const out = await session.run({ [session.inputNames[0]]: input });
    const action = out[session.outputNames[0]].data;
    this.lastAction = Float32Array.from(action);
    const ctrl = this.data.ctrl;
    for (let i = 0; i < this.nu; i++) ctrl[i] = DEFAULT_POSE[i] + action[i];
    for (let i = 0; i < DECIMATION; i++) this.mj.mj_step(this.model, this.data);
    this.simTime += CONTROL_DT;
  }

  // -- read-outs for the UI -------------------------------------------------
  get position() {
    const p = this.data.xpos, k = 3 * this.trunk;
    return [p[k], p[k + 1], p[k + 2]];
  }

  get fallen() {
    const upright = this.data.xmat[9 * this.trunk + 8];  // trunk z-axis . world z
    return !this.behavior && !this.sitMode && (upright < 0.5 || this.position[2] < 0.07);
  }
}

// ============================================================================
// Input: hold-to-move keys and buttons, taps still move a little
// ============================================================================
class Driver {
  constructor(robot) {
    this.robot = robot;
    this.held = new Set();
    this.until = { up: 0, down: 0, left: 0, right: 0 };
    this.busyUntil = 0;
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
    const now = performance.now() / 1000;
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

// ============================================================================
// Rendering: one three.js mesh per visible MuJoCo geom
// ============================================================================
function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const a = '#335066', b = '#1c3348';
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    g.fillStyle = (i + j) % 2 ? a : b;
    g.fillRect(i * 128, j * 128, 128, 128);
  }
  g.strokeStyle = 'rgba(210,225,240,0.55)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildScene(mujoco, model, canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8fb3d9');
  scene.fog = new THREE.Fog('#8fb3d9', 2.5, 7);

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
      ? new THREE.MeshStandardMaterial({ map: (() => { const tx = checkerTexture(); tx.repeat.set(40, 40); return tx; })(), roughness: 0.85 })
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

  return {
    scene, sync, follow, setQuality,
    get quality() { return quality; },
    render() { controls.update(); renderer.render(scene, camera); },
  };
}

// ============================================================================
// UI
// ============================================================================
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

// Score card, 60-second challenge, results card, and the sound on/off button.
function wireGame(game, driver) {
  $('challenge-btn').addEventListener('click', () => {
    driver.stop();
    game.startChallenge();
    sfx.play('start');
  });
  $('again-btn').addEventListener('click', () => {
    $('result').hidden = true;
    driver.stop();
    game.startChallenge();
    sfx.play('start');
  });
  $('free-btn').addEventListener('click', () => { $('result').hidden = true; });
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
  const voice = new Voice({
    robot, driver, game, name,
    onState(state, text) {
      for (const b of buttons) b.classList.toggle('listening', state === 'listening' || state === 'heard');
      clearTimeout(hideTimer);
      if (state === 'idle') { bubble.hidden = true; return; }
      const label = { listening: '🎤 ', heard: '「', reply: `${name}：`, error: '⚠️ ' }[state];
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
    if (!e.repeat && e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) voice.toggle();
  });
  return voice;
}

function showScore(game) {
  $('score-num').textContent = game.score;
  const left = game.timeLeft;
  $('timer').hidden = left === null;
  $('challenge-btn').hidden = left !== null;
  if (left !== null) $('timer-num').textContent = Math.ceil(left);
  $('best-num').textContent = game.best;
}

function showResult(game) {
  const { score, record } = game.lastResult;
  $('result-score').textContent = score;
  $('result-best').textContent = game.best;
  $('result-record').hidden = !record;
  $('result').hidden = false;
}

function wireControls(robot, driver, name) {
  const actions = {
    y: () => robot.toggleSit(),
    g: () => robot.triggerPick(),
    k: () => robot.triggerBehavior('kick_left'),
    l: () => robot.triggerBehavior('kick_right'),
    r: () => robot.triggerBehavior('roulade'),
    p: () => robot.push(),
    reset: () => { robot.reset(); driver.stop(); },
    stop: () => driver.stop(),
  };
  for (const el of document.querySelectorAll('.push-label')) el.textContent = `推一下${name}`;

  // Keyboard: arrows hold-to-move; letters trigger moves.
  const keyDir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  window.addEventListener('keydown', (e) => {
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
  const [mujoco] = await Promise.all([mujocoReady, ortReady, ...Object.values(policyBytes)]);

  setLoading('準備動作模型…');
  const sessions = {};
  for (const [key, bytes] of Object.entries(policyBytes)) {
    sessions[key] = await ort.InferenceSession.create(await bytes, { executionProviders: ['wasm'] });
  }

  setLoading('建立場景…');
  // The policies run at 50 Hz on a 5 ms physics step, as in infer_policy.py.
  const xml = withGoal((await xmlText).replace(/<mujoco([^>]*)>/, `<mujoco$1>\n  <option timestep="${TIMESTEP}"/>`));
  const model = mujoco.MjModel.from_xml_string(xml);
  const data = new mujoco.MjData(model);
  const robot = new Robot(mujoco, model, data, sessions);
  const driver = new Driver(robot);
  const game = new Game(robot);
  const view = buildScene(mujoco, model, $('view'));
  const face = new Face(view.scene, mujoco, model);
  wireControls(robot, driver, name);
  wireGame(game, driver);
  const voice = wireVoice(robot, driver, game, name);
  window.__sim = { robot, driver, game, voice, mujoco, model, data };  // handy in the browser console

  $('loading').hidden = true;

  // Sounds and the face react to what just happened.
  const SOUND_OF = { sit: 'sit', stand: 'stand', pick: 'pick', roll: 'roll', push: 'push', hit: 'kick', goal: 'goal' };
  let wasFallen = false;
  function react() {
    for (const e of robot.events.splice(0)) if (SOUND_OF[e]) sfx.play(SOUND_OF[e]);
    for (const e of game.events.splice(0)) {
      if (SOUND_OF[e]) sfx.play(SOUND_OF[e]);
      if (e === 'challenge-end') { sfx.play('end'); driver.stop(); showResult(game); }
    }
    const fallen = robot.fallen;
    if (fallen && !wasFallen) sfx.play('fall');
    wasFallen = fallen;
  }
  function expression() {
    if (game.celebrating) return 'love';
    if (voice.listening) return 'curious';
    if (robot.fallen) return 'down';
    if (robot.policy === 'roulade') return 'dizzy';
    if (robot.behavior) return 'determined';
    if (robot.pick) return 'curious';
    if (robot.sitMode) return 'sleepy';
    if (robot.simTime - robot.pushedAt < 1.2) return 'surprised';
    return 'happy';
  }

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
    showScore(game);
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

main().catch(showError);
offerPhoneQr();
