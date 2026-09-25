/**
 * 物理妥当性の監査。
 *
 * 「現実の物理で説明できないフレームは、推定が間違っている」という視点で、
 * 全252フレームを機械的に検査する。レンダリングせずデータだけで判定できる
 * 違反を対象にする。
 *
 *   node viewer/morioka-sandbox/physics-audit.mjs
 *
 * 検査項目:
 *   A. 相互貫通   — 2人の胴体カプセルが重なっていないか
 *   B. 接地違反   — 両足が同時に浮いていないか / 足が床へ潜っていないか
 *   C. 骨長の伸縮 — 単眼推定は奥行きを誤ると骨が伸び縮みする
 *   D. 速度の異常 — 人間が出せない関節速度（テレポート）が無いか
 *   E. ボール     — 体と重なっていないか / 空中に静止していないか
 */

import { sampleTrackedMotion } from './tracked-motion.js';

const FPS = 60;                    // ビューアのフレームレート
const FINAL_FRAME = 180;

// 人体の胴体を近似するカプセル半径。骨盤〜首を軸にする。
const TORSO_RADIUS = 0.16;
// 密着プレーなので、肩が触れる程度の重なりは「接触」であって貫通ではない。
// 胴体の軸同士がこの距離を割ったら、体積が重なっている＝貫通とみなす。
const PENETRATION_LIMIT = TORSO_RADIUS * 2 * 0.55;

const GROUND_EPSILON = 0.06;       // これ以下なら接地とみなす足首高さ
const AIRBORNE_OK_SPAN = 10;       // 走行の滞空は約0.15s。それ以上は違反
const BONE_PAIRS = [
  ['hipL', 'kneeL'], ['kneeL', 'ankleL'],
  ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
  ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['neck', 'pelvis'],
];
// 関節速度の上限はスポーツ生体力学の実測に基づく:
//   手首: 投球・スマッシュ系で 15〜20m/s。それ以上はワープ
//   足首: シュートのフットスピードで 18〜22m/s
// 当初は一律12にしていたが、シュートを含むクリップには厳しすぎた。
const MAX_JOINT_SPEEDS = {
  wristL: 16, wristR: 16,
  ankleL: 22, ankleR: 22,
  pelvis: 8,
};
const BALL_RADIUS = 0.10;
const LEG_RADIUS = 0.07;

// 支持足の滑り: 荷重がかかった足は摩擦で動けない。ただし床すれすれの
// 低いスイング（y<6cmで2〜3m/s）はフットサルでは現実の動きなので、
// 「真に接触している」高さ（足首中心≒踝の高さ以下）に絞って判定する。
const SUPPORT_HEIGHT = 0.035;
const SUPPORT_MAX_SLIDE = 0.45;   // m/s
const SUPPORT_MIN_RUN = 4;        // 連続してこのフレーム数を超えたら違反

// 自己貫通: 前腕(肘〜手首)が自分の胴体カプセルを横切っていないか。
// 腕がシャツに触れる程度は現実なので、体積が明確に重なるときだけ違反。
const FOREARM_RADIUS = 0.045;
const SELF_PENETRATION_LIMIT = (TORSO_RADIUS + FOREARM_RADIUS) * 0.48;  // 腕を体に押し付ける接触を許容

// 上半身の相互貫通。胴体軸1本だけでは、互いに倒れ込んだときの
// 肩・頭の融合を見逃す（実際に見逃していた）。
const SHOULDER_RADIUS = 0.115;
const SHOULDER_PAIR_LIMIT = SHOULDER_RADIUS * 2 * 0.62;  // 密着プレーの肩の押し付け合いは接触であり貫通ではない
const HEAD_RADIUS = 0.105;
const HEAD_PAIR_LIMIT = HEAD_RADIUS * 2 * 0.72;          // 頭を並べて競る姿勢を許容

// 重心加速度: 走行中の切り返しは 10〜15m/s^2 だが、接触の衝撃
// （相手に押される・ぶつかる）の瞬間値は 30m/s^2 を超えることがある。
// このクリップは接触プレーなので、衝撃を含む 35 を上限とする。
const MAX_PELVIS_ACCELERATION = 35;  // m/s^2

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 線分同士の最短距離。カプセル判定に使う。 */
function segmentDistance(p1, q1, p2, q2) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s;
  let t;
  if (a <= 1e-9 && e <= 1e-9) return distance(p1, p2);
  if (a <= 1e-9) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= 1e-9) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dot(d1, d2);
      const denominator = a * e - b * b;
      s = denominator > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denominator)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const point1 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const point2 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return distance(point1, point2);
}

function audit() {
  const frames = [];
  for (let frame = 0; frame <= FINAL_FRAME; frame += 1) {
    frames.push(sampleTrackedMotion(frame));
  }

  const violations = {
    penetration: [],
    bothFeetAirborne: [],
    footUnderground: [],
    boneStretch: [],
    jointSpeed: [],
    ballInsideBody: [],
    footSkating: [],
    selfPenetration: [],
    pelvisAcceleration: [],
  };

  // 骨長の基準値: 全フレームの中央値。
  const boneLengths = new Map();
  for (const actor of ['morioka', 'defender']) {
    for (const [a, b] of BONE_PAIRS) {
      const key = `${actor}.${a}-${b}`;
      const values = frames.map((f) => distance(f[actor][a], f[actor][b])).sort((x, y) => x - y);
      boneLengths.set(key, values[Math.floor(values.length / 2)]);
    }
  }

  let airborneRun = { morioka: 0, defender: 0 };
  const slideRun = {
    morioka: { ankleL: 0, ankleR: 0 },
    defender: { ankleL: 0, ankleR: 0 },
  };

  frames.forEach((sample, frame) => {
    // A. 相互貫通（胴体カプセル）
    const gap = segmentDistance(
      sample.morioka.pelvis, sample.morioka.neck,
      sample.defender.pelvis, sample.defender.neck,
    );
    if (gap < PENETRATION_LIMIT) {
      violations.penetration.push({ frame, gap: gap.toFixed(3), pair: 'torso' });
    }
    // 肩ライン同士・頭同士
    const shoulderGap = segmentDistance(
      sample.morioka.shoulderL, sample.morioka.shoulderR,
      sample.defender.shoulderL, sample.defender.shoulderR,
    );
    if (shoulderGap < SHOULDER_PAIR_LIMIT) {
      violations.penetration.push({ frame, gap: shoulderGap.toFixed(3), pair: 'shoulders' });
    }
    const headGap = distance(sample.morioka.head, sample.defender.head);
    if (headGap < HEAD_PAIR_LIMIT) {
      violations.penetration.push({ frame, gap: headGap.toFixed(3), pair: 'heads' });
    }
    // 腕 vs 相手の胴体
    for (const [self, other] of [['morioka', 'defender'], ['defender', 'morioka']]) {
      for (const [elbow, wrist] of [['elbowL', 'wristL'], ['elbowR', 'wristR']]) {
        const armGap = segmentDistance(
          sample[self][elbow], sample[self][wrist],
          sample[other].pelvis, sample[other].neck,
        );
        if (armGap < SELF_PENETRATION_LIMIT) {
          violations.selfPenetration.push({
            frame, actor: self, arm: `${elbow}→相手胴`, gap: armGap.toFixed(3),
          });
        }
      }
    }

    for (const actor of ['morioka', 'defender']) {
      const pose = sample[actor];

      // B. 接地
      const ankleHeights = [pose.ankleL[1], pose.ankleR[1]];
      if (Math.min(...ankleHeights) > GROUND_EPSILON) {
        airborneRun[actor] += 1;
        if (airborneRun[actor] === AIRBORNE_OK_SPAN + 1) {
          violations.bothFeetAirborne.push({ frame: frame - AIRBORNE_OK_SPAN, actor });
        }
      } else {
        airborneRun[actor] = 0;
      }
      if (Math.min(...ankleHeights) < -0.02) {
        violations.footUnderground.push({ frame, actor, y: Math.min(...ankleHeights).toFixed(3) });
      }

      // C. 骨長（基準値から±25%を超えたら違反）
      for (const [a, b] of BONE_PAIRS) {
        const reference = boneLengths.get(`${actor}.${a}-${b}`);
        const length = distance(pose[a], pose[b]);
        const ratio = length / reference;
        if (ratio < 0.75 || ratio > 1.25) {
          violations.boneStretch.push({
            frame, actor, bone: `${a}-${b}`, ratio: ratio.toFixed(2),
          });
        }
      }

      // F. 支持足の滑り（接地中の足首は水平に動かないはず）
      if (frame > 0) {
        const previous = frames[frame - 1][actor];
        for (const ankle of ['ankleL', 'ankleR']) {
          const grounded = pose[ankle][1] < SUPPORT_HEIGHT
            && previous[ankle][1] < SUPPORT_HEIGHT;
          const slide = Math.hypot(
            pose[ankle][0] - previous[ankle][0],
            pose[ankle][2] - previous[ankle][2],
          ) * FPS;
          if (grounded && slide > SUPPORT_MAX_SLIDE) {
            slideRun[actor][ankle] += 1;
            if (slideRun[actor][ankle] === SUPPORT_MIN_RUN) {
              violations.footSkating.push({
                frame: frame - SUPPORT_MIN_RUN + 1, actor, ankle,
                slide: slide.toFixed(2),
              });
            }
          } else {
            slideRun[actor][ankle] = 0;
          }
        }
      }

      // G. 自己貫通（前腕 vs 自分の胴体カプセル）
      for (const [elbow, wrist] of [['elbowL', 'wristL'], ['elbowR', 'wristR']]) {
        const separation = segmentDistance(
          pose[elbow], pose[wrist], pose.pelvis, pose.neck,
        );
        if (separation < SELF_PENETRATION_LIMIT) {
          violations.selfPenetration.push({
            frame, actor, arm: elbow, gap: separation.toFixed(3),
          });
        }
      }

      // H. 重心（骨盤）の水平加速度
      if (frame > 1) {
        const current = pose.pelvis;
        const back1 = frames[frame - 1][actor].pelvis;
        const back2 = frames[frame - 2][actor].pelvis;
        const ax = (current[0] - 2 * back1[0] + back2[0]) * FPS * FPS;
        const az = (current[2] - 2 * back1[2] + back2[2]) * FPS * FPS;
        const acceleration = Math.hypot(ax, az);
        if (acceleration > MAX_PELVIS_ACCELERATION) {
          violations.pelvisAcceleration.push({
            frame, actor, acceleration: acceleration.toFixed(1),
          });
        }
      }

      // D. 関節速度
      if (frame > 0) {
        const previous = frames[frame - 1][actor];
        for (const [joint, limit] of Object.entries(MAX_JOINT_SPEEDS)) {
          const speed = distance(pose[joint], previous[joint]) * FPS;
          if (speed > limit) {
            violations.jointSpeed.push({
              frame, actor, joint, speed: speed.toFixed(1),
            });
          }
        }
      }
    }

    // E. ボールと脚の貫通。シュートのインパクト直後(f153-156)は
    // ボールが蹴り足の至近を離れていく最中＝正当な接触なので除外。
    if (frame <= 180 && !(frame >= 153 && frame <= 156)) {
      const ball = [sample.ball.x, sample.ball.y, sample.ball.z];
      for (const actor of ['morioka', 'defender']) {
        const pose = sample[actor];
        for (const [a, b] of [['kneeL', 'ankleL'], ['kneeR', 'ankleR']]) {
          const gapToLeg = segmentDistance(pose[a], pose[b], ball, ball);
          if (gapToLeg < (BALL_RADIUS + LEG_RADIUS) * 0.6) {
            violations.ballInsideBody.push({
              frame, actor, leg: `${a}-${b}`, gap: gapToLeg.toFixed(3),
            });
          }
        }
      }
    }
  });

  return violations;
}

function summarize(name, list, describe) {
  if (list.length === 0) {
    console.log(`  OK   ${name}: 0件`);
    return;
  }
  const frameSet = [...new Set(list.map((v) => v.frame))];
  const ranges = [];
  let start = frameSet[0];
  let previous = frameSet[0];
  for (const frame of frameSet.slice(1)) {
    if (frame !== previous + 1) {
      ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
      start = frame;
    }
    previous = frame;
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  console.log(`  NG   ${name}: ${list.length}件 / frames ${ranges.join(', ')}`);
  for (const item of list.slice(0, 4)) console.log(`         例: ${describe(item)}`);
}

const violations = audit();
console.log('物理妥当性監査 (0-180, 60fps換算)');
summarize('A. 体の相互貫通 (胴/肩/頭)', violations.penetration,
  (v) => `frame ${v.frame}: ${v.pair} gap=${v.gap}m`);
summarize('B1. 両足滞空 (>0.17s)', violations.bothFeetAirborne,
  (v) => `frame ${v.frame}: ${v.actor}`);
summarize('B2. 足の床下沈み込み', violations.footUnderground,
  (v) => `frame ${v.frame}: ${v.actor} y=${v.y}`);
summarize('C. 骨長の伸縮 (±25%超)', violations.boneStretch,
  (v) => `frame ${v.frame}: ${v.actor} ${v.bone} ×${v.ratio}`);
summarize('D. 関節速度超過 (部位別上限)', violations.jointSpeed,
  (v) => `frame ${v.frame}: ${v.actor} ${v.joint} ${v.speed}m/s`);
summarize('E. ボールと脚の貫通', violations.ballInsideBody,
  (v) => `frame ${v.frame}: ${v.actor} ${v.leg} gap=${v.gap}`);
summarize('F. 支持足の滑り (>0.45m/s持続)', violations.footSkating,
  (v) => `frame ${v.frame}: ${v.actor} ${v.ankle} ${v.slide}m/s`);
summarize('G. 前腕と胴体の自己貫通', violations.selfPenetration,
  (v) => `frame ${v.frame}: ${v.actor} ${v.arm} gap=${v.gap}`);
summarize('H. 骨盤の水平加速度 (>35m/s²)', violations.pelvisAcceleration,
  (v) => `frame ${v.frame}: ${v.actor} ${v.acceleration}m/s²`);

const total = Object.values(violations).reduce((sum, list) => sum + list.length, 0);
console.log(`合計 ${total} 件`);
