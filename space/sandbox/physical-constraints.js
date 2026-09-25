/**
 * 物理制約による姿勢データの補正。
 *
 * 方針: 「現実の物理で説明できない状態は推定の誤りなので、物理が成立する
 * 最小の修正を加える」。姿勢そのもの（関節の相対配置）は実測値として尊重し、
 * 剛体としての平行移動だけで解決する。関節を個別に動かすと、実測でもない
 * 捏造の姿勢を作ってしまうため。
 *
 *   1. 胴体の相互貫通 → 2人を水平に押し離す（体積の不可侵）
 *   2. ボールと脚の貫通 → ボールを脚の外へ押し出す（球の不可侵）
 *
 * 解決できずに残った違反は physics-audit.mjs が検出する。残った違反は
 * 「データが間違っている」ことの証拠として扱い、ここでは隠さない。
 */

// 胴体カプセルの半径。physics-audit.mjs と同じ値を使うこと。
export const TORSO_RADIUS = 0.16;
// 肩や腕が触れる程度の重なりは実際の密着プレーにも存在する。
// 軸間がこの距離を割ったときだけ「体積の貫通」とみなして解消する。
export const MIN_TORSO_GAP = TORSO_RADIUS * 2 * 0.55;

export const BALL_RADIUS = 0.10;
export const LEG_RADIUS = 0.07;

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 線分 p1-q1 と p2-q2 の最近接点対を返す。 */
function closestPoints(p1, q1, p2, q2) {
  const d1 = subtract(q1, p1);
  const d2 = subtract(q2, p2);
  const r = subtract(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  if (a > 1e-9 && e > 1e-9) {
    const c = dot(d1, r);
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
  } else if (a > 1e-9) {
    s = Math.min(1, Math.max(0, -dot(d1, r) / a));
  } else if (e > 1e-9) {
    t = Math.min(1, Math.max(0, f / e));
  }
  return {
    onFirst: [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s],
    onSecond: [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t],
  };
}

function translateActor(pose, offset) {
  const moved = {};
  for (const [joint, value] of Object.entries(pose)) {
    moved[joint] = [value[0] + offset[0], value[1] + offset[1], value[2] + offset[2]];
  }
  return moved;
}

/**
 * 2人の胴体（骨盤〜首のカプセル）が貫通していたら、水平方向に等分に
 * 押し離す。上下方向は接地を壊すので動かさない。
 *
 * 等分に分けるのは、どちらの位置推定がより正しいか判定できないため。
 * 運動量保存的にも、密着した2人が互いに押し合う状況の近似として妥当。
 */
// 上半身の対カプセル。胴体軸1本だけでは、互いに倒れ込んだ姿勢での
// 肩・頭の融合を見逃す。監査(physics-audit)の限界より僅かに広い値。
export const SHOULDER_PAIR_GAP = 0.115 * 2 * 0.62 + 0.006;
export const HEAD_PAIR_GAP = 0.105 * 2 * 0.72 + 0.006;

/**
 * 貫通解消に必要な押しベクトル（morioka側へ+、defender側へ−、各半分）を返す。
 * 胴体軸・肩ライン・頭の3対を検査し、最も深い貫通の対から押し方向を決める。
 * 貫通が無ければ null。押し量を時間方向に平滑化したい呼び出し側のために、
 * 適用と計算を分離してある。
 */
export function computeBodyPush(morioka, defender) {
  const pairs = [
    {
      a: [morioka.pelvis, morioka.neck],
      b: [defender.pelvis, defender.neck],
      minimum: MIN_TORSO_GAP,
    },
    {
      a: [morioka.shoulderL, morioka.shoulderR],
      b: [defender.shoulderL, defender.shoulderR],
      minimum: SHOULDER_PAIR_GAP,
    },
    {
      a: [morioka.head, morioka.head],
      b: [defender.head, defender.head],
      minimum: HEAD_PAIR_GAP,
    },
  ];
  // 背負いの最深部では体が組み合い、対ごとの押し方向が矛盾する
  // （肩対は+x、頭対は−x など）。最深対だけ押すと振動して発散するため、
  // 不足量で重み付けした合成方向へ押す＝平行移動で実現できる最善を取る。
  let sumX = 0;
  let sumZ = 0;
  let maxDeficit = 0;
  for (const pair of pairs) {
    const { onFirst, onSecond } = closestPoints(
      pair.a[0], pair.a[1], pair.b[0], pair.b[1],
    );
    const gapVector = subtract(onFirst, onSecond);
    const gap3d = Math.hypot(...gapVector);
    const deficit = pair.minimum - gap3d;
    if (deficit <= 0) continue;
    maxDeficit = Math.max(maxDeficit, deficit);
    const horizontal = Math.hypot(gapVector[0], gapVector[2]);
    if (horizontal > 1e-6) {
      sumX += (gapVector[0] / horizontal) * deficit;
      sumZ += (gapVector[2] / horizontal) * deficit;
    } else {
      const fallbackX = morioka.pelvis[0] - defender.pelvis[0];
      const fallbackZ = morioka.pelvis[2] - defender.pelvis[2];
      const length = Math.hypot(fallbackX, fallbackZ) || 1;
      sumX += (fallbackX / length) * deficit;
      sumZ += (fallbackZ / length) * deficit;
    }
  }
  if (maxDeficit <= 0) return null;
  const combined = Math.hypot(sumX, sumZ);
  if (combined < 1e-9) return null;   // 完全に打ち消し合う＝平行移動では解けない
  const push = maxDeficit / 2 + 0.005;
  return { x: (sumX / combined) * push, z: (sumZ / combined) * push };
}

export function translateActorBy(pose, offsetX, offsetZ) {
  return translateActor(pose, [offsetX, 0, offsetZ]);
}

export function resolveBodyPenetration(morioka, defender) {
  // 3対（胴/肩/頭）のうち最も深い貫通から順に押し離す。1回の押しで
  // 別の対が僅かに残ることがあるため、収束するまで数回反復する。
  let currentMorioka = morioka;
  let currentDefender = defender;
  let corrected = false;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const push = computeBodyPush(currentMorioka, currentDefender);
    if (!push) break;
    currentMorioka = translateActor(currentMorioka, [push.x, 0, push.z]);
    currentDefender = translateActor(currentDefender, [-push.x, 0, -push.z]);
    corrected = true;
  }
  return {
    morioka: currentMorioka,
    defender: currentDefender,
    corrected,
  };
}

/**
 * ボールが下腿（膝〜足首カプセル）へめり込んでいたら、ボール側を押し出す。
 * ボールは足元推定の従属値なので、選手ではなくボールを動かすのが正しい。
 */
export function resolveBallPenetration(ball, actors) {
  let position = [ball.x, ball.y, ball.z];
  let corrected = false;
  const minimumGap = BALL_RADIUS + LEG_RADIUS;
  // 4本の脚を1周しただけだと、後の脚から押し出されて先の脚へ再侵入する
  // ことがある。全カプセルに対して安定するまで数回反復する。
  for (let iteration = 0; iteration < 3; iteration += 1) {
    let movedThisPass = false;
    for (const pose of actors) {
      for (const [upper, lower] of [['kneeL', 'ankleL'], ['kneeR', 'ankleR']]) {
        const { onFirst } = closestPoints(pose[upper], pose[lower], position, position);
        const away = subtract(position, onFirst);
        const gap = Math.hypot(...away);
        if (gap >= minimumGap || gap < 1e-6) continue;
        // 接地しているボールは床に沿ってしか動けない。下向きに押すと
        // 床クランプで押し戻されて再侵入するため、水平方向へ転がして逃がす。
        if (position[1] <= BALL_RADIUS + 0.01) away[1] = 0;
        const horizontal = Math.hypot(away[0], away[1], away[2]);
        if (horizontal < 1e-6) continue;
        const target = minimumGap + 0.002;
        // 水平のみの移動で3D距離 target を満たすのに必要な移動量。
        const vertical = onFirst[1] - position[1];
        const needed = Math.sqrt(Math.max(0, target * target - vertical * vertical));
        const current = Math.hypot(position[0] - onFirst[0], position[2] - onFirst[2]);
        const push = away[1] === 0 ? Math.max(0, needed - current) : target - gap;
        position = [
          position[0] + (away[0] / horizontal) * push,
          position[1] + (away[1] / horizontal) * push,
          position[2] + (away[2] / horizontal) * push,
        ];
        corrected = true;
        movedThisPass = true;
      }
    }
    if (!movedThisPass) break;
  }
  if (!corrected) return { ball, corrected };
  // 押し出しで浮いたり潜ったりしないよう、接地高さは保つ。
  return {
    ball: { ...ball, x: position[0], y: Math.max(BALL_RADIUS, position[1]), z: position[2] },
    corrected,
  };
}
