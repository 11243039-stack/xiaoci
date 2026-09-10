// 踢球射門: a goal on the field, goals are counted, and a 60-second challenge
// with a best score kept in this browser.

// Kicks curl ~12 degrees toward the kicking foot's side; a 70 cm wide goal lets
// a straight-on kick from the start spot go in with either foot.
const GOAL = { x: 1.3, y: 0, halfWidth: 0.35, height: 0.22, depth: 0.18 };
const CHALLENGE_SECONDS = 60;
const BALL_RADIUS = 0.035;
const BALL_DAMPING = 0.99;      // per 20 ms step on the ground: a kick from the start spot
                                // reaches the goal (at 0.985 it stopped at 1.15 m)
const RESPAWN_DELAY = 1.5;      // s after a goal before the ball comes back
const CELEBRATE = 2.0;          // s of heart eyes after a goal
const FIELD_LIMIT = 3.0;        // m from the centre before a lost ball is brought back
const BEST_KEY = 'xiaoci.bestGoals';

// Static goal (posts + net) added to the scene before it is compiled. The robot
// and the ball both bump into it; the net is see-through.
export function withGoal(xml) {
  const { x, y, halfWidth: w, height: h, depth: d } = GOAL;
  const net = 'rgba="0.95 0.97 1 0.28"';
  const goal = `
    <body name="goal" pos="${x} ${y} 0">
      <geom name="goal_post_l" type="capsule" fromto="0 ${w} 0 0 ${w} ${h}" size="0.012" rgba="1 1 1 1"/>
      <geom name="goal_post_r" type="capsule" fromto="0 ${-w} 0 0 ${-w} ${h}" size="0.012" rgba="1 1 1 1"/>
      <geom name="goal_bar" type="capsule" fromto="0 ${-w} ${h} 0 ${w} ${h}" size="0.012" rgba="1 1 1 1"/>
      <geom name="goal_net_back" type="box" pos="${d} 0 ${h / 2}" size="0.004 ${w} ${h / 2}" ${net}/>
      <geom name="goal_net_l" type="box" pos="${d / 2} ${w} ${h / 2}" size="${d / 2} 0.004 ${h / 2}" ${net}/>
      <geom name="goal_net_r" type="box" pos="${d / 2} ${-w} ${h / 2}" size="${d / 2} 0.004 ${h / 2}" ${net}/>
      <geom name="goal_net_top" type="box" pos="${d / 2} 0 ${h}" size="${d / 2} ${w} 0.004" ${net}/>
      <geom name="goal_line" type="box" pos="0 0 0.0006" size="0.006 ${w} 0.0005" rgba="1 1 1 1" contype="0" conaffinity="0"/>
    </body>
  `;
  return xml.replace('</worldbody>', `${goal}</worldbody>`);
}

export class Game {
  constructor(robot) {
    this.robot = robot;
    this.score = 0;
    this.best = 0;
    try { this.best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { /* storage blocked */ }
    this.challengeEnd = null;   // sim time the challenge ends, or null in free play
    this.celebrateUntil = -1;
    this.respawnAt = null;
    this.lastBallSpeed = 0;
    this.events = [];           // 'goal', 'hit', 'challenge-end' for the UI to react to
  }

  get celebrating() { return this.robot.simTime < this.celebrateUntil; }
  get timeLeft() { return this.challengeEnd === null ? null : Math.max(0, this.challengeEnd - this.robot.simTime); }

  ball() {
    const r = this.robot, q = r.data.qpos, v = r.data.qvel;
    return {
      x: q[r.ballQpos], y: q[r.ballQpos + 1], z: q[r.ballQpos + 2],
      speed: Math.hypot(v[r.ballQvel], v[r.ballQvel + 1], v[r.ballQvel + 2]),
    };
  }

  placeBall(x, y) {
    const r = this.robot;
    r.data.qpos.set([x, y, BALL_RADIUS, 1, 0, 0, 0], r.ballQpos);
    r.data.qvel.fill(0, r.ballQvel, r.ballQvel + 6);
  }

  respawnBall() {
    const [rx, ry] = this.robot.position;
    for (let i = 0; i < 30; i++) {
      const x = 0.15 + Math.random() * 0.7, y = -0.45 + Math.random() * 0.9;
      if (Math.hypot(x - rx, y - ry) > 0.28) { this.placeBall(x, y); return; }
    }
    this.placeBall(0.3, 0);
  }

  // Called after every 20 ms control step.
  step() {
    const r = this.robot;
    if (r.ballQpos < 0) return;
    const b = this.ball();
    const t = r.simTime;

    // Let a rolling ball slow down (MuJoCo has no rolling resistance here).
    if (b.z < BALL_RADIUS + 0.004) {
      const v = r.data.qvel;
      for (let k = 0; k < 6; k++) v[r.ballQvel + k] *= BALL_DAMPING;
    }
    if (b.speed - this.lastBallSpeed > 0.45) this.events.push('hit');  // something kicked it
    this.lastBallSpeed = b.speed;

    if (this.respawnAt !== null && t >= this.respawnAt) {
      this.respawnAt = null;
      this.respawnBall();
      return;
    }
    const lx = b.x - GOAL.x, ly = b.y - GOAL.y;
    const inGoal = lx > 0.015 && lx < GOAL.depth - 0.005 && Math.abs(ly) < GOAL.halfWidth - 0.012 && b.z < GOAL.height;
    if (inGoal && this.respawnAt === null) {
      this.score++;
      this.celebrateUntil = t + CELEBRATE;
      this.respawnAt = t + RESPAWN_DELAY;
      this.events.push('goal');
    } else if (Math.hypot(b.x, b.y) > FIELD_LIMIT || b.z < -0.1) {
      this.respawnBall();
    }

    if (this.challengeEnd !== null && t >= this.challengeEnd) {
      this.challengeEnd = null;
      this.lastResult = { score: this.score, record: this.score > this.best };
      if (this.lastResult.record) {
        this.best = this.score;
        try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* storage blocked */ }
      }
      this.events.push('challenge-end');
    }
  }

  startChallenge() {
    this.robot.reset();
    this.score = 0;
    this.respawnAt = null;
    this.celebrateUntil = -1;
    this.challengeEnd = this.robot.simTime + CHALLENGE_SECONDS;
  }

  stopChallenge() { this.challengeEnd = null; }
}
