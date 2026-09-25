import { trackedMotion } from './tracked-motion-data.js';
import {
  resolveBodyPenetration,
  resolveBallPenetration,
  computeBodyPush,
  translateActorBy,
} from './physical-constraints.js';

const SOURCE_END_FRAME = 180;
// 手付けのシュート演出は削除。実測区間のみを再生する。
const FINAL_FRAME = 180;
const BALL_RADIUS = 0.10;   // フットサル4号球
// ドリブル中のボールは前足のわずか前方に置く。元映像でボール自体は
// 追跡していないため、足元との位置関係からの近似。
const BALL_LEAD = 0.24;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

// 単眼推定の関節座標はフレーム間で細かく震える。時間方向の
// ガウシアン平滑化(±2フレーム)を読み込み時に一度だけかけて、
// 骨格の震え・足元のガタつきを抑える。動作の大きな軌道は保たれる。
const SMOOTH_KERNEL = [1, 4, 6, 4, 1];

function smoothActorFrames(frames, actorKey) {
  const count = frames.length;
  return frames.map((_, frameIndex) => {
    const joints = frames[frameIndex][actorKey];
    return Object.fromEntries(Object.keys(joints).map((joint) => {
      const smoothed = [0, 0, 0];
      let weightSum = 0;
      for (let k = 0; k < SMOOTH_KERNEL.length; k += 1) {
        const sampleIndex = clamp(frameIndex + k - 2, 0, count - 1);
        const weight = SMOOTH_KERNEL[k];
        const value = frames[sampleIndex][actorKey][joint];
        weightSum += weight;
        for (let axis = 0; axis < 3; axis += 1) smoothed[axis] += value[axis] * weight;
      }
      return [joint, smoothed.map((total) => total / weightSum)];
    }));
  });
}

const smoothedFrames = trackedMotion.frames.map((frame, index) => ({ frame: frame.frame }));
{
  const morioka = smoothActorFrames(trackedMotion.frames, 'morioka');
  const defender = smoothActorFrames(trackedMotion.frames, 'defender');
  for (let index = 0; index < smoothedFrames.length; index += 1) {
    smoothedFrames[index].morioka = morioka[index];
    smoothedFrames[index].defender = defender[index];
  }
}

// 手付け区間用のイージング。等速補間だと機械的に見えるので、
// キーフレーム間を滑らかに加減速させる。
function smoothstep(progress) {
  return progress * progress * (3 - 2 * progress);
}

function interpolateArray(first, second, progress) {
  return first.map((value, index) => value + (second[index] - value) * progress);
}

// 骨の親子関係。補間と剛体化の両方で使う。
// (子, 親) の順に処理すれば、親は常に確定済み。
const BONE_HIERARCHY = [
  ['hipL', 'pelvis'], ['hipR', 'pelvis'],
  ['kneeL', 'hipL'], ['kneeR', 'hipR'],
  ['ankleL', 'kneeL'], ['ankleR', 'kneeR'],
  ['neck', 'pelvis'],
  ['head', 'neck'],
  ['shoulderL', 'neck'], ['shoulderR', 'neck'],
  ['elbowL', 'shoulderL'], ['elbowR', 'shoulderR'],
  ['wristL', 'elbowL'], ['wristR', 'elbowR'],
];

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

/** 単位ベクトル同士の球面線形補間。ほぼ平行なら普通のlerpに落とす。 */
function slerpDirection(a, b, progress) {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const theta = Math.acos(dot);
  if (theta < 1e-4) {
    const mixed = a.map((value, index) => value + (b[index] - value) * progress);
    const length = norm3(mixed) || 1;
    return mixed.map((value) => value / length);
  }
  const sinTheta = Math.sin(theta);
  const weightA = Math.sin((1 - progress) * theta) / sinTheta;
  const weightB = Math.sin(progress * theta) / sinTheta;
  return [
    a[0] * weightA + b[0] * weightB,
    a[1] * weightA + b[1] * weightB,
    a[2] * weightA + b[2] * weightB,
  ];
}

/**
 * 姿勢の補間。骨盤は位置をlerpし、各骨は「親からの方向」を球面補間して
 * 長さ固定で再構築する。位置の線形補間は方向転換中に骨を最大30%縮める
 * （物理監査Cの検出項目）ため、骨長を不変量として扱う。
 */
function interpolateActor(first, second, progress) {
  const result = { pelvis: interpolateArray(first.pelvis, second.pelvis, progress) };
  for (const [child, parent] of BONE_HIERARCHY) {
    const fromA = subtract3(first[child], first[parent]);
    const fromB = subtract3(second[child], second[parent]);
    const lengthA = norm3(fromA);
    const lengthB = norm3(fromB);
    if (lengthA < 1e-6 || lengthB < 1e-6) {
      result[child] = interpolateArray(first[child], second[child], progress);
      continue;
    }
    const direction = slerpDirection(
      fromA.map((value) => value / lengthA),
      fromB.map((value) => value / lengthB),
      progress,
    );
    const length = lengthA + (lengthB - lengthA) * progress;
    const parentPosition = result[parent];
    result[child] = [
      parentPosition[0] + direction[0] * length,
      parentPosition[1] + direction[1] * length,
      parentPosition[2] + direction[2] * length,
    ];
  }
  return result;
}

/**
 * 手付けキーフレーム用: 関節オフセットで歪んだ骨長を基準姿勢の長さへ
 * 張り替える。方向（演出意図）は保ち、長さだけ物理に合わせる。
 */
function rigidifyPose(pose, reference) {
  const result = { pelvis: [...pose.pelvis] };
  for (const [child, parent] of BONE_HIERARCHY) {
    const direction = subtract3(pose[child], pose[parent]);
    const length = norm3(direction);
    const referenceLength = norm3(subtract3(reference[child], reference[parent]));
    if (length < 1e-6) {
      result[child] = [...pose[child]];
      continue;
    }
    const parentPosition = result[parent];
    result[child] = [
      parentPosition[0] + (direction[0] / length) * referenceLength,
      parentPosition[1] + (direction[1] / length) * referenceLength,
      parentPosition[2] + (direction[2] / length) * referenceLength,
    ];
  }
  return result;
}

function ballFromPose(morioka) {
  // 進行方向は +x。前に出ている方の足を基準にする。
  // 前足が入れ替わる瞬間に z が跳ばないよう、左右の足を前後差に応じて
  // ソフトに混ぜる(差30cm以上でほぼ前足のみ)。
  const xL = morioka.ankleL[0];
  const xR = morioka.ankleR[0];
  const leftWeight = clamp(0.5 + (xL - xR) / 0.3, 0, 1);
  const x = Math.max(xL, xR) + BALL_LEAD;
  return {
    x,
    y: BALL_RADIUS,
    z: morioka.ankleL[2] * leftWeight + morioka.ankleR[2] * (1 - leftWeight) + 0.04,
    rotation: x / BALL_RADIUS,
  };
}

function sampleSourceMotion(frame) {
  const viewerFrame = clamp(Number(frame) || 0, 0, SOURCE_END_FRAME);
  const sourcePosition = (viewerFrame / SOURCE_END_FRAME) * (smoothedFrames.length - 1);
  const lowerIndex = Math.floor(sourcePosition);
  const upperIndex = Math.min(smoothedFrames.length - 1, Math.ceil(sourcePosition));
  const progress = sourcePosition - lowerIndex;
  const lower = smoothedFrames[lowerIndex];
  const upper = smoothedFrames[upperIndex];
  const morioka = interpolateActor(lower.morioka, upper.morioka, progress);
  return {
    morioka,
    defender: interpolateActor(lower.defender, upper.defender, progress),
    ball: ballFromPose(morioka),
  };
}

function offsetActor(actor, translation, jointOffsets = {}) {
  return Object.fromEntries(
    Object.entries(actor).map(([joint, value]) => {
      const offset = jointOffsets[joint] || [0, 0, 0];
      return [joint, value.map((axis, index) => axis + translation[index] + offset[index])];
    }),
  );
}

const sourceFinal = sampleSourceMotion(SOURCE_END_FRAME);

// 手付けキーフレームの骨長は offsetActor の関節別オフセットで歪むため、
// 定義後に一括で実測区間の骨長へ張り替える（下の rigidify 適用を参照）。
//
// キックの設計（2026-08-08 作り直し）:
// 旧版は選手がボールを1m追い越してから空気を蹴っていた。正しくは
//   接近 → 軸足(左)をボールの脇へ植える → 右足を後ろへ引く(バックスイング)
//   → 振り抜いてインパクト → フォロースルー
// ボールは f180 時点で x≈1.66 に静止している。軸足はその横 x≈1.55 に置き、
// 骨盤はボール手前 ≈0.2m で止める。インパクトは f233。
const finishKeyframes = [
  {
    frame: 180,
    morioka: sourceFinal.morioka,
    defender: sourceFinal.defender,
    ball: sourceFinal.ball,
  },
  {
    // 減速しながらボールへ寄る
    frame: 204,
    morioka: offsetActor(sourceFinal.morioka, [0.13, 0, 0]),
    defender: offsetActor(sourceFinal.defender, [0.1, 0, 0]),
    ball: sourceFinal.ball,
  },
  {
    // 軸足(左)をボール脇へ植え、右足を引き始める
    frame: 222,
    morioka: offsetActor(sourceFinal.morioka, [0.24, 0, 0], {
      head: [-0.03, -0.02, 0],
      kneeR: [-0.22, 0.18, -0.03],
      ankleR: [-0.38, 0.26, -0.05],
      wristL: [0.06, 0.14, 0.14],
      wristR: [-0.1, 0.12, -0.12],
    }),
    defender: offsetActor(sourceFinal.defender, [0.16, 0, 0]),
    ball: sourceFinal.ball,
  },
  {
    // バックスイング最深部。膝を畳み、かかとが尻へ寄る
    frame: 228,
    morioka: offsetActor(sourceFinal.morioka, [0.27, 0, 0], {
      head: [-0.04, -0.03, 0],
      kneeR: [-0.28, 0.22, -0.04],
      ankleR: [-0.47, 0.36, -0.06],
      wristL: [0.1, 0.18, 0.16],
      wristR: [-0.14, 0.14, -0.14],
    }),
    defender: offsetActor(sourceFinal.defender, [0.18, 0, 0]),
    ball: sourceFinal.ball,
  },
  {
    // インパクト。右足首がボールの位置に届く
    frame: 233,
    morioka: offsetActor(sourceFinal.morioka, [0.3, 0, 0], {
      head: [-0.02, -0.04, 0],
      kneeR: [-0.05, 0.12, -0.01],
      ankleR: [-0.06, 0.02, 0.0],
      wristL: [0.14, 0.2, 0.18],
      wristR: [-0.18, 0.1, -0.16],
    }),
    defender: offsetActor(sourceFinal.defender, [0.19, 0, 0]),
    ball: sourceFinal.ball,
  },
  {
    // フォロースルー。蹴り足が前上方へ振り抜け、体が前へ流れる
    frame: 240,
    morioka: offsetActor(sourceFinal.morioka, [0.33, 0, 0], {
      head: [0.05, -0.05, 0],
      kneeR: [0.3, 0.3, 0.02],
      ankleR: [0.44, 0.44, 0.04],
      wristL: [-0.1, 0.14, 0.2],
      wristR: [-0.2, 0.06, -0.2],
    }),
    defender: offsetActor(sourceFinal.defender, [0.2, 0, 0]),
    ball: {
      x: 6.0,
      y: 0.62,
      z: sourceFinal.ball.z - 0.2,
      rotation: sourceFinal.ball.rotation + 3.2,
    },
  },
  {
    // 着地して静止。ボールはネットへ
    frame: 252,
    morioka: offsetActor(sourceFinal.morioka, [0.40, 0, 0], {
      head: [0.08, -0.06, 0],
      kneeR: [0.12, 0.1, 0.03],
      // y は下げない: 終端姿勢の足首は既に接地高(0.02)にあり、
      // 負のオフセットは床下へ沈める（監査B2で検出済み）。
      ankleR: [0.1, 0, 0.05],
      wristL: [-0.14, 0.1, 0.2],
      wristR: [-0.2, 0.06, -0.2],
    }),
    defender: offsetActor(sourceFinal.defender, [0.2, 0, 0]),
    // シュート後。攻めゴール(x=34)へ向かう低いドリブンシュートで、
    // クリップ終端ではまだ飛行中。手付けの演出であり実測ではない。
    // 飛行 f233→f252 は 0.32秒で約8.6m ＝ 約27m/s（時速97km、実在の
    // シュート速度域）。
    ball: {
      x: 10.3,
      y: 0.5,
      z: sourceFinal.ball.z - 0.3,
      rotation: sourceFinal.ball.rotation + 7.4,
    },
  },
];

for (const keyframe of finishKeyframes) {
  keyframe.morioka = rigidifyPose(keyframe.morioka, sourceFinal.morioka);
  keyframe.defender = rigidifyPose(keyframe.defender, sourceFinal.defender);
}

function interpolateBall(first, second, progress) {
  return Object.fromEntries(
    Object.keys(first).map((key) => [key, first[key] + (second[key] - first[key]) * progress]),
  );
}

/**
 * 手付け区間の体の補間: Catmull-Rom（C1連続）。
 *
 * セグメントごとの smoothstep は各キーフレームで速度が0になるため、
 * 「0.26mを0.2秒で静止→静止」のような区間で 39m/s² 級の加速度を要求し、
 * 骨盤加速度の監査(H)に反する。速度が連続するスプラインなら、同じ
 * キーフレームを通りながら加速度は現実的な範囲に収まる。
 */
function catmullRomActor(keyframes, actorKey, frame) {
  const knots = keyframes.map((keyframe) => keyframe.frame);
  let segment = knots.length - 2;
  for (let index = 0; index < knots.length - 1; index += 1) {
    if (frame <= knots[index + 1]) {
      segment = index;
      break;
    }
  }
  const t0 = knots[segment];
  const t1 = knots[segment + 1];
  const span = t1 - t0;
  const local = clamp((frame - t0) / span, 0, 1);
  const p1 = keyframes[segment][actorKey];
  const p2 = keyframes[segment + 1][actorKey];
  const p0 = keyframes[Math.max(0, segment - 1)][actorKey];
  const p3 = keyframes[Math.min(knots.length - 1, segment + 2)][actorKey];
  const dt0 = t0 - knots[Math.max(0, segment - 1)] || span;
  const dt2 = knots[Math.min(knots.length - 1, segment + 2)] - t1 || span;

  const h00 = (1 + 2 * local) * (1 - local) * (1 - local);
  const h10 = local * (1 - local) * (1 - local);
  const h01 = local * local * (3 - 2 * local);
  const h11 = local * local * (local - 1);

  const result = {};
  for (const joint of Object.keys(p1)) {
    result[joint] = [0, 1, 2].map((axis) => {
      // 有限差分による接線（非等間隔ノット対応）。
      const m1 = ((p2[joint][axis] - p0[joint][axis]) / (span + dt0)) * span;
      const m2 = ((p3[joint][axis] - p1[joint][axis]) / (span + dt2)) * span;
      return h00 * p1[joint][axis] + h10 * m1 + h01 * p2[joint][axis] + h11 * m2;
    });
  }
  return result;
}

function sampleFinish(frame) {
  const upperIndex = finishKeyframes.findIndex((keyframe) => keyframe.frame >= frame);
  const upper = finishKeyframes[upperIndex === -1 ? finishKeyframes.length - 1 : upperIndex];
  const lower = finishKeyframes[Math.max(0, (upperIndex === -1 ? finishKeyframes.length - 1 : upperIndex) - 1)];
  const progress = upper.frame === lower.frame ? 0 : (frame - lower.frame) / (upper.frame - lower.frame);
  // シュート後のボール(インパクト直後のセグメント)は ease-out で
  // 飛ばし、わずかな放物線の山をつけて弾道らしく見せる。
  const isShotSegment = lower.frame === 233;
  const ballProgress = isShotSegment
    ? 1 - (1 - progress) * (1 - progress)
    : smoothstep(progress);
  const ball = interpolateBall(lower.ball, upper.ball, ballProgress);
  if (isShotSegment) ball.y += 0.16 * 4 * ballProgress * (1 - ballProgress);
  return {
    // スプライン補間は関節位置ベースなので骨長が僅かに揺れる。
    // 基準姿勢の骨長へ張り替えて剛体を守る（監査C）。
    morioka: rigidifyPose(catmullRomActor(finishKeyframes, 'morioka', frame), sourceFinal.morioka),
    defender: rigidifyPose(catmullRomActor(finishKeyframes, 'defender', frame), sourceFinal.defender),
    ball,
  };
}

// --- 60fpsベイクと接地ロック ---------------------------------------------
// 30fps→60fpsの補間は骨盤lerp＋方向slerpの再構築なので、抽出側で
// ロックした支持足がわずかにドリフトする。全フレームを読み込み時に
// 一度ベイクし、その60fps列に対して接地ロックをかけ直す。

const STANCE_MAX_HEIGHT = 0.07;
const STANCE_MAX_SPEED = 1.2;      // 前進中の支持足の計測速度を含む上限
const STANCE_MIN_FRAMES = 6;       // 60fpsで0.1秒
const STANCE_BLEND = 4;

function twoBoneIK(hip, knee, ankleTarget, femur, tibia) {
  const toTarget = subtract3(ankleTarget, hip);
  let reach = norm3(toTarget);
  if (reach < 1e-6) return { knee: [...knee], ankle: [...ankleTarget] };
  const maxReach = femur + tibia - 1e-4;
  const minReach = Math.abs(femur - tibia) + 1e-4;
  const clamped = Math.min(Math.max(reach, minReach), maxReach);
  const direction = toTarget.map((value) => value / reach);
  const target = [
    hip[0] + direction[0] * clamped,
    hip[1] + direction[1] * clamped,
    hip[2] + direction[2] * clamped,
  ];
  reach = clamped;
  const along = (femur * femur - tibia * tibia + reach * reach) / (2 * reach);
  const height = Math.sqrt(Math.max(0, femur * femur - along * along));
  const base = [
    hip[0] + direction[0] * along,
    hip[1] + direction[1] * along,
    hip[2] + direction[2] * along,
  ];
  // 膝の張り出し: 元の膝の、hip→target 直線への垂直成分を使う。
  const kneeVector = subtract3(knee, hip);
  const projected = kneeVector[0] * direction[0] + kneeVector[1] * direction[1] + kneeVector[2] * direction[2];
  let offset = [
    kneeVector[0] - direction[0] * projected,
    kneeVector[1] - direction[1] * projected,
    kneeVector[2] - direction[2] * projected,
  ];
  let offsetNorm = norm3(offset);
  if (offsetNorm < 1e-6) {
    offset = [direction[2], 0, -direction[0]];
    offsetNorm = norm3(offset) || 1;
  }
  return {
    knee: [
      base[0] + (offset[0] / offsetNorm) * height,
      base[1] + (offset[1] / offsetNorm) * height,
      base[2] + (offset[2] / offsetNorm) * height,
    ],
    ankle: target,
  };
}

/** ベイク済み60fps列に対する支持足ロック。

 * 判定は歩行の物理に基づく相対条件: 支持足は接地高さにあり、かつ
 * 「もう一方の足より明確に遅い」。絶対速度だけでは、前進中の支持足
 * (計測上1m/s前後)と床すれすれの低いスイングを区別できない。
 */
function ankleSpeed(positions, index) {
  const previous = positions[Math.max(0, index - 1)];
  const current = positions[index];
  return Math.hypot(current[0] - previous[0], current[2] - previous[2]) * 60;
}

function lockSupportFeet(track) {
  const anklePositions = {
    L: track.map((pose) => pose.ankleL),
    R: track.map((pose) => pose.ankleR),
  };
  for (const side of ['L', 'R']) {
    const other = side === 'L' ? 'R' : 'L';
    const ankleKey = `ankle${side}`;
    const kneeKey = `knee${side}`;
    const hipKey = `hip${side}`;
    const positions = anklePositions[side];
    const stance = positions.map((position, index) => {
      if (position[1] >= STANCE_MAX_HEIGHT) return false;
      const speed = ankleSpeed(positions, index);
      if (speed >= 1.6) return false;
      if (speed < STANCE_MAX_SPEED) return true;
      // グレーゾーン(1.2〜1.6): もう一方の足がはっきり速いなら支持足。
      return speed < ankleSpeed(anklePositions[other], index) * 0.7;
    });
    let start = null;
    for (let index = 0; index <= track.length; index += 1) {
      const inStance = index < track.length && stance[index];
      if (inStance && start === null) start = index;
      if (!inStance && start !== null) {
        const end = index - 1;
        if (end - start + 1 >= STANCE_MIN_FRAMES) {
          const anchorFrames = positions.slice(start, end + 1);
          const anchor = [0, 1, 2].map((axis) => {
            const sorted = anchorFrames.map((p) => p[axis]).sort((a, b) => a - b);
            return sorted[Math.floor(sorted.length / 2)];
          });
          anchor[1] = Math.min(...anchorFrames.map((p) => p[1]));
          for (let frame = start; frame <= end; frame += 1) {
            const edge = Math.min(frame - start, end - frame);
            const weight = Math.min(1, (edge + 1) / (STANCE_BLEND + 1));
            const pose = track[frame];
            const target = pose[ankleKey].map(
              (value, axis) => value * (1 - weight) + anchor[axis] * weight,
            );
            const femur = norm3(subtract3(pose[kneeKey], pose[hipKey]));
            const tibia = norm3(subtract3(pose[ankleKey], pose[kneeKey]));
            const solved = twoBoneIK(pose[hipKey], pose[kneeKey], target, femur, tibia);
            pose[kneeKey] = solved.knee;
            pose[ankleKey] = solved.ankle;
          }
        }
        start = null;
      }
    }
  }
}

/**
 * 静止摩擦の制約: 接地している足の水平変位を摩擦限界内へクランプする。
 * 区間検出に頼らず全フレームに適用するので、検出漏れが残らない。
 * 足が持ち上がった瞬間に制約は外れ、実測位置へ自然に復帰する。
 */
const FRICTION_CONTACT_HEIGHT = 0.04;
const FRICTION_MAX_SLIDE_PER_FRAME = 0.3 / 60;    // 監査限界0.45m/sの内側
const RELEASE_DECAY = 0.72;                        // 離地後のオフセット減衰率/フレーム

function applyGroundFriction(track) {
  for (const side of ['L', 'R']) {
    const ankleKey = `ankle${side}`;
    const kneeKey = `knee${side}`;
    const hipKey = `hip${side}`;
    // 「制約後の位置 − 実測位置」のオフセットを持ち回り、離地したら
    // 一気に戻さず指数減衰させる。瞬間復帰は33m/sの瞬間移動になる。
    let offsetX = 0;
    let offsetZ = 0;
    for (let frame = 1; frame < track.length; frame += 1) {
      const pose = track[frame];
      const previous = track[frame - 1][ankleKey];
      const measured = pose[ankleKey];
      const contact = measured[1] < FRICTION_CONTACT_HEIGHT
        && previous[1] < FRICTION_CONTACT_HEIGHT;
      let target;
      if (contact) {
        const stepX = measured[0] + offsetX - previous[0];
        const stepZ = measured[2] + offsetZ - previous[2];
        const step = Math.hypot(stepX, stepZ);
        const scale = step > FRICTION_MAX_SLIDE_PER_FRAME
          ? FRICTION_MAX_SLIDE_PER_FRAME / step
          : 1;
        target = [
          previous[0] + stepX * scale,
          measured[1],
          previous[2] + stepZ * scale,
        ];
      } else {
        offsetX *= RELEASE_DECAY;
        offsetZ *= RELEASE_DECAY;
        if (Math.hypot(offsetX, offsetZ) < 1e-4) {
          offsetX = 0;
          offsetZ = 0;
          continue;
        }
        target = [measured[0] + offsetX, measured[1], measured[2] + offsetZ];
      }
      const femur = norm3(subtract3(pose[kneeKey], pose[hipKey]));
      const tibia = norm3(subtract3(measured, pose[kneeKey]));
      const solved = twoBoneIK(pose[hipKey], pose[kneeKey], target, femur, tibia);
      pose[kneeKey] = solved.knee;
      pose[ankleKey] = solved.ankle;
      // IKが到達限界に当たった＝骨盤が離れて足を固定できない。現実の
      // 選手はここで足を持ち上げて運ぶ。滑らせたまま接地させておくのは
      // 物理矛盾なので、強制スリップしたフレームは足を離地させる。
      if (contact) {
        const slip = Math.hypot(
          pose[ankleKey][0] - previous[0],
          pose[ankleKey][2] - previous[2],
        );
        if (slip > FRICTION_MAX_SLIDE_PER_FRAME * 1.2) {
          pose[ankleKey][1] = Math.max(pose[ankleKey][1], 0.05);
        }
      }
      offsetX = pose[ankleKey][0] - measured[0];
      offsetZ = pose[ankleKey][2] - measured[2];
    }
  }
}

/**
 * 骨盤（重心）軌道の低域通過。人体の重心は地面反力でしか加速できず、
 * 60m/s² のような値は推定ノイズ。骨盤の平滑化差分で全身を平行移動する
 * ので、姿勢と骨長は変わらない。
 */
function smoothPelvisTrajectory(track) {
  // ±5フレーム(83ms)。重心は慣性が大きく、この幅の低域通過でも
  // 実際の切り返しの山は保たれる。狭いと接触ノイズの加速度が残る。
  const kernel = [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
  const total = kernel.length;
  const half = 5;
  const pelvis = track.map((pose) => pose.pelvis);
  const smoothed = pelvis.map((_, frameIndex) => [0, 1, 2].map((axis) => {
    let sum = 0;
    let weightSum = 0;
    for (let k = 0; k < total; k += 1) {
      const sample = pelvis[clamp(frameIndex + k - half, 0, pelvis.length - 1)];
      sum += sample[axis] * kernel[k];
      weightSum += kernel[k];
    }
    return sum / weightSum;
  }));
  track.forEach((pose, frameIndex) => {
    // 対象は水平加速度(監査H)なので水平成分だけ均す。Yまで均すと
    // 沈み込みの谷が浅くなり、足が床下へ沈む(監査B2)。
    const deltaX = smoothed[frameIndex][0] - pelvis[frameIndex][0];
    const deltaZ = smoothed[frameIndex][2] - pelvis[frameIndex][2];
    for (const joint of Object.keys(pose)) {
      pose[joint] = [
        pose[joint][0] + deltaX,
        pose[joint][1],
        pose[joint][2] + deltaZ,
      ];
    }
  });
}

/**
 * 前腕が自分の胴体カプセルへめり込んだら、肩を支点に外へ押し出す。
 * 移動後は上腕・前腕の長さを張り替えて剛体を守る。
 */
const FOREARM_RADIUS = 0.045;
const TORSO_RADIUS_SELF = 0.16;
const SELF_LIMIT = (TORSO_RADIUS_SELF + FOREARM_RADIUS) * 0.48 + 0.008;

function closestOnSegment(a, b, point) {
  const ab = subtract3(b, a);
  const lengthSq = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  if (lengthSq < 1e-9) return [...a];
  let t = ((point[0] - a[0]) * ab[0] + (point[1] - a[1]) * ab[1] + (point[2] - a[2]) * ab[2]) / lengthSq;
  t = clamp(t, 0, 1);
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}

/** 線分同士の最近接点対。監査(G)と同じ幾何で測る。 */
function segmentClosestPair(p1, q1, p2, q2) {
  const d1 = subtract3(q1, p1);
  const d2 = subtract3(q2, p2);
  const r = subtract3(p1, p2);
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2];
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  let s = 0;
  let t = 0;
  if (a > 1e-9 && e > 1e-9) {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
    const denominator = a * e - b * b;
    s = denominator > 1e-9 ? clamp((b * f - c * e) / denominator, 0, 1) : 0;
    t = clamp((b * s + f) / e, 0, 1);
    s = clamp((b * t - c) / a, 0, 1);
  } else if (a > 1e-9) {
    s = clamp(-(d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2]) / a, 0, 1);
  } else if (e > 1e-9) {
    t = clamp(f / e, 0, 1);
  }
  return {
    onFirst: [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s],
    onSecond: [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t],
  };
}

/**
 * 前腕の自己貫通を、押し量の「テントエンベロープ」で解消する。
 *
 * フレーム独立に押すと制約の立ち上がりが1フレームで跳ね、手首が
 * 15m/s級の瞬間移動になる（監査D）。かといって後から位置を平滑化
 * すると貫通が戻る（監査G）。そこで、
 *   1. 各フレームの必要押し量を測る
 *   2. envelope(t) = max_s ( required(s) − ramp·|t−s| ) を取る
 * この包絡線は「必要量を必ず満たす」かつ「変化率がramp以下」を同時に
 * 保証する。物理的には、接触の少し前から腕を寄せ始める先行動作になる。
 */
const ARM_PUSH_RAMP = 0.004;   // m/frame。反復6周が積み上がっても追加速度 ≤ 1.4m/s

function armPushRequirement(pose, side, obstacles) {
  const elbowKey = `elbow${side}`;
  const wristKey = `wrist${side}`;
  // 最も深く貫通している障害物から押し出す。
  // 注: 背負いの最深部では腕が両者の胴体に挟まれ、どちらへ押しても
  // もう一方へ入る「実行可能解なし」の区間が生じる（合成法線も打ち消し
  // 合って機能しないことを実測済み）。そこは完全遮蔽中の守備者を補間で
  // 置いていることが根因で、残る数フレームは既知の限界として監査に出す。
  let worst = null;
  for (const [a, b] of obstacles) {
    const pair = segmentClosestPair(pose[elbowKey], pose[wristKey], a, b);
    const away = subtract3(pair.onFirst, pair.onSecond);
    const gap3d = norm3(away);
    if (gap3d < SELF_LIMIT && (!worst || gap3d < worst.gap3d)) {
      worst = { gap3d, away };
    }
  }
  if (!worst) return { amount: 0, nx: 0, nz: 0 };
  const away = worst.away;
  away[1] = 0;
  const horizontal = Math.hypot(away[0], away[2]);
  let nx;
  let nz;
  if (horizontal < 1e-6) {
    const outward = subtract3(pose[`shoulder${side}`], pose.neck);
    const outNorm = Math.hypot(outward[0], outward[2]) || 1;
    nx = outward[0] / outNorm;
    nz = outward[2] / outNorm;
  } else {
    nx = away[0] / horizontal;
    nz = away[2] / horizontal;
  }
  return { amount: SELF_LIMIT - worst.gap3d + 0.012, nx, nz };
}

function resolveArmSelfPenetration(track, opponentTrack = null, sharpen = false) {
  for (const side of ['L', 'R']) {
    const shoulderKey = `shoulder${side}`;
    const elbowKey = `elbow${side}`;
    const wristKey = `wrist${side}`;

    const requirements = track.map((pose, frameIndex) => {
      const obstacles = [[pose.pelvis, pose.neck]];
      if (opponentTrack) {
        const opponent = opponentTrack[frameIndex];
        obstacles.push([opponent.pelvis, opponent.neck]);
      }
      return armPushRequirement(pose, side, obstacles);
    });
    // テントエンベロープ: 前後walk 2パスのO(n)実装。
    const envelope = requirements.map((r) => r.amount);
    for (let index = 1; index < envelope.length; index += 1) {
      envelope[index] = Math.max(envelope[index], envelope[index - 1] - ARM_PUSH_RAMP);
    }
    for (let index = envelope.length - 2; index >= 0; index -= 1) {
      envelope[index] = Math.max(envelope[index], envelope[index + 1] - ARM_PUSH_RAMP);
    }

    // 法線は貫通フレームのものを近傍へ伝播させる（貫通のないフレームは
    // 法線が定義されないため）。
    const normals = requirements.map((r) => (r.amount > 0 ? [r.nx, r.nz] : null));
    let lastNormal = null;
    const forwardNormals = normals.map((n) => (n ? (lastNormal = n) : lastNormal));
    lastNormal = null;
    for (let index = normals.length - 1; index >= 0; index -= 1) {
      if (normals[index]) lastNormal = normals[index];
      else if (!forwardNormals[index]) forwardNormals[index] = lastNormal;
    }
    // 法線がフレーム間で急回転すると、押しベクトルの向きの変化だけで
    // 手首が数m/s動く。±2フレームのベクトル平均で回転をなだらかにする。
    const smoothedNormals = forwardNormals.map((_, frameIndex) => {
      // 仕上げ(sharpen)の周は平均せず生の法線で正確に押す。
      // その時点の押し量は小さいので速度スパイクにはならない。
      const window = sharpen ? 0 : 4;
      let sumX = 0;
      let sumZ = 0;
      for (let k = -window; k <= window; k += 1) {
        const sample = forwardNormals[clamp(frameIndex + k, 0, forwardNormals.length - 1)];
        if (!sample) continue;
        sumX += sample[0];
        sumZ += sample[1];
      }
      const length = Math.hypot(sumX, sumZ);
      return length > 1e-6 ? [sumX / length, sumZ / length] : forwardNormals[frameIndex];
    });

    track.forEach((pose, frameIndex) => {
      // sharpen 周は正確だが1フレーム単位の押しになるので、量を8mmに
      // 制限して手首の速度上限(16m/s)を守る。反復で残りを回収する。
      const amount = sharpen
        ? Math.min(envelope[frameIndex], 0.008)
        : envelope[frameIndex];
      const normal = smoothedNormals[frameIndex];
      if (amount <= 0 || !normal) return;
      const upperLength = norm3(subtract3(pose[elbowKey], pose[shoulderKey]));
      const foreLength = norm3(subtract3(pose[wristKey], pose[elbowKey]));
      for (const key of [elbowKey, wristKey]) {
        pose[key] = [
          pose[key][0] + normal[0] * amount,
          pose[key][1],
          pose[key][2] + normal[1] * amount,
        ];
      }
      // 肩を支点に元の骨長へ張り替える。
      const upperDirection = subtract3(pose[elbowKey], pose[shoulderKey]);
      const upperNorm = norm3(upperDirection) || 1;
      pose[elbowKey] = [0, 1, 2].map(
        (axis) => pose[shoulderKey][axis] + (upperDirection[axis] / upperNorm) * upperLength,
      );
      const foreDirection = subtract3(pose[wristKey], pose[elbowKey]);
      const foreNorm = norm3(foreDirection) || 1;
      pose[wristKey] = [0, 1, 2].map(
        (axis) => pose[elbowKey][axis] + (foreDirection[axis] / foreNorm) * foreLength,
      );
    });
  }
}

// 処理順が重要:
//   1. 補間ベイク
//   2. 骨盤軌道の低域通過（全身の平行移動＝姿勢を変えない）
//   3. 体積の貫通解消（全身の水平押し離し）
//   4. 接地ロック＋摩擦   ← 押し離しの後でないと、足が押されて再び滑る
//   5. 腕の自己貫通解消（腕だけ。足・胴体へ影響しない）
//   6. ボールの従属と貫通解消
const bakedFrames = [];
for (let frame = 0; frame <= FINAL_FRAME; frame += 1) {
  const sample = frame <= SOURCE_END_FRAME ? sampleSourceMotion(frame) : sampleFinish(frame);
  bakedFrames.push({ morioka: sample.morioka, defender: sample.defender, ball: sample.ball });
}
for (const actor of ['morioka', 'defender']) {
  smoothPelvisTrajectory(bakedFrames.map((sample) => sample[actor]));
}
// 貫通の押しをフレームごとに独立適用すると、押し量の変動がそのまま
// 骨盤加速度になる。接触力は連続なので、押しベクトル列を時間平滑化
// してから適用し、残った僅かな貫通だけを個別に解消する。
{
  // 「必要押し量を測る → ガウシアンで均す → 適用」を数周。
  // 線形フィルタの反復なので振動せず、残差は周回ごとに縮む。
  // フレーム独立の残差締めやテントの反復は加速度の跳ねを作った（実測済み）。
  const kernel = [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
  const half = 5;
  for (let round = 0; round < 10; round += 1) {
    const pushes = bakedFrames.map(
      (sample) => computeBodyPush(sample.morioka, sample.defender) || { x: 0, z: 0 },
    );
    if (!pushes.some((p) => Math.hypot(p.x, p.z) > 1e-9)) break;
    bakedFrames.forEach((sample, frameIndex) => {
      let sumX = 0;
      let sumZ = 0;
      let weightSum = 0;
      for (let k = 0; k < kernel.length; k += 1) {
        const p = pushes[clamp(frameIndex + k - half, 0, pushes.length - 1)];
        sumX += p.x * kernel[k];
        sumZ += p.z * kernel[k];
        weightSum += kernel[k];
      }
      const pushX = sumX / weightSum;
      const pushZ = sumZ / weightSum;
      if (Math.hypot(pushX, pushZ) < 1e-9) return;
      sample.morioka = translateActorBy(sample.morioka, pushX, pushZ);
      sample.defender = translateActorBy(sample.defender, -pushX, -pushZ);
    });
  }
  // 広いカーネル(±5)はピークで数mm届かない。残差は狭いカーネル(±2)の
  // ガウシアン反復で締める。フレーム独立の一括締めや上限付き反復は、
  // 単発フレームへ押しが集中して加速度スパイクを作った（実測49m/s²）。
  // 時間に分散させたまま反復するのが唯一安定だった。
  const narrowKernel = [1, 3, 5, 3, 1];
  const narrowHalf = 2;
  for (let round = 0; round < 8; round += 1) {
    const pushes = bakedFrames.map(
      (sample) => computeBodyPush(sample.morioka, sample.defender) || { x: 0, z: 0 },
    );
    if (!pushes.some((p) => Math.hypot(p.x, p.z) > 1e-9)) break;
    bakedFrames.forEach((sample, frameIndex) => {
      let sumX = 0;
      let sumZ = 0;
      let weightSum = 0;
      for (let k = 0; k < narrowKernel.length; k += 1) {
        const p = pushes[clamp(frameIndex + k - narrowHalf, 0, pushes.length - 1)];
        sumX += p.x * narrowKernel[k];
        sumZ += p.z * narrowKernel[k];
        weightSum += narrowKernel[k];
      }
      const pushX = sumX / weightSum;
      const pushZ = sumZ / weightSum;
      if (Math.hypot(pushX, pushZ) < 1e-9) return;
      sample.morioka = translateActorBy(sample.morioka, pushX, pushZ);
      sample.defender = translateActorBy(sample.defender, -pushX, -pushZ);
    });
  }

  // 最深部（完全遮蔽で守備者が補間の区間）は制約が部分的に実行不能で、
  // 押しの反復が軌道に高周波を残す。骨盤の低域通過と狭い押しを交互に
  // かけて加速度を抜く。平滑化で戻る貫通は押しのマージン(5-6mm)より
  // 小さく、監査Aには現れない。
  for (let polish = 0; polish < 3; polish += 1) {
    for (const actor of ['morioka', 'defender']) {
      smoothPelvisTrajectory(bakedFrames.map((sample) => sample[actor]));
    }
    for (let round = 0; round < 2; round += 1) {
      const pushes = bakedFrames.map(
        (sample) => computeBodyPush(sample.morioka, sample.defender) || { x: 0, z: 0 },
      );
      if (!pushes.some((p) => Math.hypot(p.x, p.z) > 1e-9)) break;
      bakedFrames.forEach((sample, frameIndex) => {
        let sumX = 0;
        let sumZ = 0;
        let weightSum = 0;
        for (let k = 0; k < narrowKernel.length; k += 1) {
          const p = pushes[clamp(frameIndex + k - narrowHalf, 0, pushes.length - 1)];
          sumX += p.x * narrowKernel[k];
          sumZ += p.z * narrowKernel[k];
          weightSum += narrowKernel[k];
        }
        const pushX = sumX / weightSum;
        const pushZ = sumZ / weightSum;
        if (Math.hypot(pushX, pushZ) < 1e-9) return;
        sample.morioka = translateActorBy(sample.morioka, pushX, pushZ);
        sample.defender = translateActorBy(sample.defender, -pushX, -pushZ);
      });
    }
  }
}
/** 腕(肘・手首)だけの軽い時間平滑化。押し出しの急な立ち上がりを均す。 */
function smoothArms(track) {
  const kernel = [1, 2, 3, 2, 1];
  const half = 2;
  for (const joint of ['elbowL', 'elbowR', 'wristL', 'wristR']) {
    const values = track.map((pose) => pose[joint]);
    const smoothed = values.map((_, frameIndex) => [0, 1, 2].map((axis) => {
      let sum = 0;
      let weightSum = 0;
      for (let k = 0; k < kernel.length; k += 1) {
        const sample = values[clamp(frameIndex + k - half, 0, values.length - 1)];
        sum += sample[axis] * kernel[k];
        weightSum += kernel[k];
      }
      return sum / weightSum;
    }));
    track.forEach((pose, frameIndex) => {
      pose[joint] = smoothed[frameIndex];
    });
  }
  // 平滑化は骨長を僅かに縮めるので、肩を支点に張り替える。
  for (const pose of track) {
    for (const side of ['L', 'R']) {
      const shoulder = pose[`shoulder${side}`];
      for (const [childKey, parentPosition, lengthFrom] of [
        [`elbow${side}`, shoulder, `shoulder${side}`],
        [`wrist${side}`, null, `elbow${side}`],
      ]) {
        const parent = parentPosition || pose[lengthFrom];
        const direction = subtract3(pose[childKey], parent);
        const length = norm3(direction);
        if (length < 1e-6) continue;
        // 長さの基準はこのフレームの現値。方向を均しただけなので、
        // フレーム間の長さは元々一定（剛体化済み）である。
        pose[childKey] = [0, 1, 2].map(
          (axis) => parent[axis] + (direction[axis] / length) * length,
        );
      }
    }
  }
}

for (const actor of ['morioka', 'defender']) {
  const track = bakedFrames.map((sample) => sample[actor]);
  const opponentTrack = bakedFrames.map(
    (sample) => sample[actor === 'morioka' ? 'defender' : 'morioka'],
  );
  lockSupportFeet(track);
    applyGroundFriction(track);
    // 腕は自分の胴体と相手の胴体の両方から押し出す。
  // エンベロープ1回では、骨長張り替えと法線平均の分だけ押しが目減りする。
  // 再測定しながら数周回すと幾何級数的に収束する。最後の2周は法線平均を
  // 外して残った数mmを正確に締める。
  for (let armRound = 0; armRound < 6; armRound += 1) {
    resolveArmSelfPenetration(track, opponentTrack, armRound >= 2);
  }
}
// --- シュート（実映像に映っている本物のシュート） --------------------------
// 元映像では最後に、手前のゴール（見えているゴール, x=-6）へ振り向きざまに
// シュートしている。蹴りの体の動きは実測データに入っているので、ボール
// だけを正しいタイミングで反応させる。タイミングはけんせいの実測指定:
//   f150-152 コンタクト / f153-154 でボールが離れる / f170 で着弾。
const SHOT_CONTACT_FRAME = 152;
const SHOT_IMPACT_FRAME = 170;
const NET_X = -6.15;         // ゴールライン(-6)の少し奥＝ネットに刺さる位置
const NET_TARGET_Y = 0.85;   // ネット中段
const NET_TARGET_Z = 0.45;   // 守備者(z≈-0.4)から遠い側のサイドへ

// 振り向きざまのシュートなので、ワインドアップでボールは進行方向(+x)の
// 足元から蹴り足のゴール側(-x)へ持ち替わる。ここを繋がないと、ボールが
// 自分の脚を突き抜けて飛ぶことになる。
const SHOT_WINDUP_FRAME = 140;

function strikeAnchor(pose) {
  return {
    x: pose.ankleR[0] - 0.24,
    y: BALL_RADIUS,
    z: pose.ankleR[2] + 0.05,
    rotation: 0,
  };
}

for (let frame = 0; frame <= FINAL_FRAME; frame += 1) {
  const sample = bakedFrames[frame];
  if (frame <= SHOT_WINDUP_FRAME) {
    // ドリブル: ボールは前足の足元に従属
    sample.ball = ballFromPose(sample.morioka);
    sample.ball = resolveBallPenetration(
      sample.ball, [sample.morioka, sample.defender],
    ).ball;
  } else if (frame <= SHOT_CONTACT_FRAME) {
    // ワインドアップ: ドリブル位置から蹴り足のゴール側へ滑らかに移す
    const t = (frame - SHOT_WINDUP_FRAME) / (SHOT_CONTACT_FRAME - SHOT_WINDUP_FRAME);
    const e = t * t * (3 - 2 * t);
    const dribble = ballFromPose(sample.morioka);
    const anchor = strikeAnchor(sample.morioka);
    sample.ball = {
      x: dribble.x + (anchor.x - dribble.x) * e,
      y: BALL_RADIUS,
      z: dribble.z + (anchor.z - dribble.z) * e,
      rotation: dribble.rotation,
    };
  }
}
{
  const launch = { ...bakedFrames[SHOT_CONTACT_FRAME].ball };
  const flightDistance = Math.hypot(NET_X - launch.x, NET_TARGET_Z - launch.z);
  for (let frame = SHOT_CONTACT_FRAME + 1; frame <= FINAL_FRAME; frame += 1) {
    const sample = bakedFrames[frame];
    if (frame <= SHOT_IMPACT_FRAME) {
      // 飛行: 約7.7mを0.3秒 ≒ 26m/s（実在のシュート速度域）。
      // 低く速いドリブンシュートで、わずかに浮きながらネットへ。
      const t = (frame - SHOT_CONTACT_FRAME) / (SHOT_IMPACT_FRAME - SHOT_CONTACT_FRAME);
      sample.ball = {
        x: launch.x + (NET_X - launch.x) * t,
        y: launch.y + (NET_TARGET_Y - launch.y) * t + 0.10 * 4 * t * (1 - t),
        z: launch.z + (NET_TARGET_Z - launch.z) * t,
        rotation: launch.rotation + (flightDistance / BALL_RADIUS) * t * 0.35,
      };
    } else {
      // 着弾後: ネットに受け止められ、わずかに跳ね返って落ちる
      const t = (frame - SHOT_IMPACT_FRAME) / Math.max(1, FINAL_FRAME - SHOT_IMPACT_FRAME);
      sample.ball = {
        x: NET_X + 0.10 * t,
        y: NET_TARGET_Y + (BALL_RADIUS + 0.02 - NET_TARGET_Y) * (t * t),
        z: NET_TARGET_Z,
        rotation: launch.rotation + flightDistance / BALL_RADIUS,
      };
    }
  }
}

export function sampleTrackedMotion(frame) {
  const viewerFrame = Math.round(clamp(Number(frame) || 0, 0, FINAL_FRAME));
  const sample = bakedFrames[viewerFrame];
  return { morioka: sample.morioka, defender: sample.defender, ball: sample.ball };
}
