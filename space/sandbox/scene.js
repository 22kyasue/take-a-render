import * as THREE from 'three';

import { createTrackedMannequin } from './tracked-mannequin.js';
import { createPitch, PITCH } from './pitch.js';
import { createCameraRig } from './camera-rig.js';

// 映像の実際の位置関係（2026-08-08 修正）:
//   カメラ → 選手 → すぐ後ろ(約6m)にゴール。選手はそのゴールから
//   遠ざかる方向(+x)へ進む。
// 以前は攻めゴールを+9に置いていたため、映像に写る背後のゴールが
// 31m彼方になり、実映像と全く違う空間になっていた。
// 背後のゴールライン = ATTACKING_GOAL_X - 40 = -6（プレー原点の6m後方）。
const ATTACKING_GOAL_X = 34;

export function createSandboxScene(canvas, { createActor = createTrackedMannequin } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // 屋外の快晴を想定した露出。屋内の暗いスタジオ設定から上げてある。
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(42, canvas.clientWidth / canvas.clientHeight, 0.05, 300);
  camera.position.set(1, 3.35, 9);

  const pitch = createPitch(renderer, { attackingGoalX: ATTACKING_GOAL_X });
  scene.add(pitch.group);

  // 撮影カメラの配置（実カメラ＋v2計画）。どこ視点の映像かを示す。
  const cameraRig = createCameraRig({ attackingGoalX: ATTACKING_GOAL_X });
  cameraRig.visible = false;   // 既定OFF（線が多く画面が散らかる）。ボタンで表示
  scene.add(cameraRig);

  const morioka = createActor({
    shirtColor: 0x1d2026,
    pantsColor: 0x11141a,
    accentColor: 0xffb545,
    label: '森岡選手',
    labelHeight: 0.38,
  });
  const defender = createActor({
    shirtColor: 0x49c7df,
    pantsColor: 0x152430,
    accentColor: 0x55e2ff,
    label: '守備者',
    labelHeight: 0.7,
    shortSleeves: true,
  });
  scene.add(morioka.group, defender.group);

  // フットサル4号球。周囲62–64cm、直径約20cm。
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.10, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.46, metalness: 0.02 }),
  );
  ball.castShadow = true;
  scene.add(ball);

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  }

  function render() {
    renderer.render(scene, camera);
  }

  return { scene, camera, renderer, morioka, defender, ball, cameraRig, resize, render };
}
