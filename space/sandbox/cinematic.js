import * as THREE from 'three';

import { createSandboxScene } from './scene.js';
import { sampleTrackedMotion } from './tracked-motion.js';
import { loadAvatarFactory } from './glb-avatar.js';

/**
 * サッカーゲーム/リプレイ演出の定番文法を、既存の追跡モーションの上に
 * 乗せたシネマティックサンプル。
 *
 * ゲームのカットシーンは概ね次の要素でできている:
 *   1. ショットリスト   — 尺・カメラワーク・再生速度を持つカットの列
 *   2. カメラリグ       — レール移動(ドリー)・被写体追従(トラッキング)・
 *                          周回(オービット)を補間で表現
 *   3. タイムリマップ   — カットごとに再生速度を変える(インパクトはスロー)
 *   4. 演出レイヤー     — レターボックス・キャプション・フェードつなぎ
 * ここではそれを最小構成で全部入れてある。
 */

const FRAME_RATE = 60;
const FINAL_FRAME = 252;

const elements = {
  canvas: document.querySelector('#stage'),
  caption: document.querySelector('#caption'),
  slowmo: document.querySelector('#slowmo'),
  fade: document.querySelector('#fade'),
};

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

// ---- ショットリスト --------------------------------------------------------
// from/to: モーションのフレーム範囲。dur: 実時間の尺(秒)。
// cam(t, ctx): t=0..1 のカット内進行度でカメラを毎フレーム決める。
const SHOTS = [
  {
    name: 'エスタブリッシング',
    caption: '背負いの極意 ― 前へ出てキープ',
    from: 0, to: 70, dur: 3.4,
    cam(t, { focus, camera }) {
      // ワイドから静かに寄るドリーイン。状況説明のカット。
      const d = 8.2 - 2.2 * easeInOut(t);
      camera.position.set(focus.x - d * 0.55, 2.4 - 0.6 * easeInOut(t), focus.z + d);
      camera.lookAt(focus.x, 0.9, focus.z);
    },
  },
  {
    name: 'デュエル',
    caption: '守備者を背中で受け止める',
    from: 70, to: 150, dur: 3.2,
    cam(t, { focus, camera }) {
      // 低いアングルの横トラッキング。体のぶつかり合いを大きく見せる。
      camera.position.set(focus.x + 2.6, 0.75, focus.z + 2.9 - 0.8 * t);
      camera.lookAt(focus.x, 1.0, focus.z);
    },
  },
  {
    name: 'ターン(スロー)',
    caption: '半身で前を取る ― この一歩が意思決定',
    from: 150, to: 200, dur: 4.2,
    slow: true,
    cam(t, { focus, camera }) {
      // スローモーションに合わせて被写体を周回するオービット。
      const angle = Math.PI * 0.15 + t * Math.PI * 0.55;
      const radius = 2.3;
      camera.position.set(
        focus.x + Math.cos(angle) * radius,
        1.15 + 0.35 * Math.sin(t * Math.PI),
        focus.z + Math.sin(angle) * radius,
      );
      camera.lookAt(focus.x, 1.0, focus.z);
    },
  },
  {
    name: 'シュート',
    caption: 'フィニッシュ(3D補完)',
    from: 200, to: 252, dur: 3.4,
    cam(t, { focus, ball, camera }) {
      // ゴール裏からの逆アングル。ボールが飛んでくる定番のリプレイ画。
      camera.position.set(10.4, 1.15, focus.z - 2.2);
      const look = new THREE.Vector3().lerpVectors(
        new THREE.Vector3(focus.x, 1.0, focus.z),
        new THREE.Vector3(ball.x, ball.y, ball.z),
        easeInOut(Math.min(1, t * 1.6)),
      );
      camera.lookAt(look);
    },
  },
];

async function boot() {
  let createActor = null;
  try {
    const factory = await loadAvatarFactory();
    createActor = factory.create;
  } catch (error) {
    console.warn('GLBアバターを読み込めませんでした。簡易マネキンで表示します。', error);
  }
  const sandbox = createSandboxScene(elements.canvas, createActor ? { createActor } : {});

  let shotIndex = 0;
  let shotClock = 0;
  let lastTime = performance.now();

  function applyMotion(frame) {
    const pose = sampleTrackedMotion(frame);
    sandbox.morioka.applyPose(pose.morioka);
    sandbox.defender.applyPose(pose.defender);
    sandbox.ball.position.set(pose.ball.x, pose.ball.y, pose.ball.z);
    sandbox.ball.rotation.set(pose.ball.rotation, 0, pose.ball.rotation * 0.55);
    sandbox.scene.updateMatrixWorld(true);
    return pose;
  }

  function enterShot(index) {
    shotIndex = index % SHOTS.length;
    shotClock = 0;
    const shot = SHOTS[shotIndex];
    elements.caption.textContent = shot.caption;
    elements.caption.classList.add('visible');
    elements.slowmo.classList.toggle('visible', Boolean(shot.slow));
    // カットのつなぎは短いフェード。ハードカットのちらつきを消す。
    elements.fade.style.opacity = '0';
  }

  let lastWidth = 0;
  let lastHeight = 0;

  function animate(now) {
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // resize イベントを取りこぼしても描画が欠けないよう毎フレーム実測する。
    if (elements.canvas.clientWidth !== lastWidth || elements.canvas.clientHeight !== lastHeight) {
      lastWidth = elements.canvas.clientWidth;
      lastHeight = elements.canvas.clientHeight;
      sandbox.resize();
    }

    const shot = SHOTS[shotIndex];
    shotClock += delta;
    const t = Math.min(1, shotClock / shot.dur);

    // タイムリマップ: カット内進行度をモーションフレームへ写像する。
    // スローカットは from→to の幅が狭く尺が長い = 実効速度が落ちる。
    const frame = Math.min(FINAL_FRAME, shot.from + (shot.to - shot.from) * t);
    const pose = applyMotion(frame);

    const moriokaFocus = sandbox.morioka.getFocusPosition();
    shot.cam(t, {
      camera: sandbox.camera,
      focus: moriokaFocus,
      ball: pose.ball,
    });

    // カット終盤でフェードアウト → 次のカットへ。
    if (shot.dur - shotClock < 0.45) {
      elements.fade.style.opacity = String(1 - (shot.dur - shotClock) / 0.45);
      elements.caption.classList.remove('visible');
    }
    if (shotClock >= shot.dur) enterShot(shotIndex + 1);

    sandbox.render();
    requestAnimationFrame(animate);
  }

  window.addEventListener('resize', sandbox.resize, { passive: true });
  enterShot(0);
  requestAnimationFrame(animate);
}

boot().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<p style="position:fixed;inset:auto 0 40vh 0;text-align:center;color:#fff;z-index:9;font:14px system-ui">シネマティックを開始できませんでした。WebGL対応ブラウザで開いてください。</p>',
  );
});
