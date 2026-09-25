import * as THREE from 'three';

/**
 * シネマティックリプレイの演出台本。
 *
 * EA FC系リプレイの演出文法をこのプレーに合わせて組む:
 *   追従ショット → 接触でゆっくり回り込む → シュートでスローモー →
 *   着弾をゴールサイドから。
 * カメラ位置・注視・再生速度をフレームで台本化し、再生中は
 * OrbitControls を止めてこの台本がカメラを支配する。
 */

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// 台本。frame はビューアの60fpsフレーム。
// position: ワールド座標 / target: 'players'(2人の中間) | 'ball' | [x,y,z]
const SHOTS = [
  // 1. ロー・トラッキング: 低い位置から接近を追う
  { frame: 0, position: [-2.6, 1.0, 4.6], target: 'players', fov: 42 },
  { frame: 55, position: [-0.4, 0.9, 3.9], target: 'players', fov: 42 },
  // 2. 接触: ゆっくり回り込む（背負いの姿勢を見せ場に）
  { frame: 80, position: [1.6, 1.3, 3.2], target: 'players', fov: 40 },
  { frame: 120, position: [3.0, 1.5, 0.6], target: 'players', fov: 40 },
  { frame: 140, position: [2.6, 1.2, -1.8], target: 'players', fov: 40 },
  // 3. シュート: 低いアングルでボール越しにゴールを見る
  { frame: 150, position: [2.4, 0.6, -0.6], target: 'ball', fov: 46 },
  { frame: 162, position: [0.6, 0.7, 1.8], target: 'ball', fov: 46 },
  // 4. 着弾: ゴールサイドからネットが揺れる画
  { frame: 169, position: [-4.6, 0.9, 2.6], target: 'ball', fov: 44 },
  { frame: 180, position: [-5.4, 1.1, 3.0], target: 'ball', fov: 44 },
];

// 再生速度カーブ。スローモーはインパクト前後。
const SPEED_SEGMENTS = [
  { from: 0, to: 138, speed: 1.0 },
  { from: 138, to: 148, speed: 0.55 },   // ワインドアップで少し落とす
  { from: 148, to: 168, speed: 0.28 },   // キック〜飛行はスローモー
  { from: 168, to: 180, speed: 0.7 },    // 着弾
];

export function replaySpeedAt(frame) {
  for (const segment of SPEED_SEGMENTS) {
    if (frame >= segment.from && frame < segment.to) return segment.speed;
  }
  return 1.0;
}

/** 実時間でのリプレイ全長（秒）。HUDの進捗表示に使う。 */
export function replayDurationSeconds() {
  let total = 0;
  for (const segment of SPEED_SEGMENTS) {
    total += (segment.to - segment.from) / 60 / segment.speed;
  }
  return total;
}

function findSegment(frame) {
  for (let index = 0; index < SHOTS.length - 1; index += 1) {
    if (frame <= SHOTS[index + 1].frame) return index;
  }
  return SHOTS.length - 2;
}

export function createReplayDirector({ camera }) {
  const targetPoint = new THREE.Vector3();
  const positionA = new THREE.Vector3();
  const positionB = new THREE.Vector3();

  /**
   * 指定フレームのカメラを台本どおりに設定する。
   * resolveTarget(name) は 'players' | 'ball' のワールド座標を返す。
   */
  function apply(frame, resolveTarget) {
    const index = findSegment(frame);
    const a = SHOTS[index];
    const b = SHOTS[index + 1];
    const t = smooth(Math.min(1, Math.max(0, (frame - a.frame) / (b.frame - a.frame))));

    positionA.fromArray(a.position);
    positionB.fromArray(b.position);
    camera.position.lerpVectors(positionA, positionB, t);

    const targetA = Array.isArray(a.target) ? a.target : resolveTarget(a.target);
    const targetB = Array.isArray(b.target) ? b.target : resolveTarget(b.target);
    targetPoint.set(
      lerp(targetA[0], targetB[0], t),
      lerp(targetA[1], targetB[1], t),
      lerp(targetA[2], targetB[2], t),
    );
    camera.lookAt(targetPoint);

    const fov = lerp(a.fov ?? 42, b.fov ?? 42, t);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  return { apply };
}
