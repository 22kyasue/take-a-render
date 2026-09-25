import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { createPitch } from './pitch.js';
import { loadAvatarFactory } from './glb-avatar.js';
import { createTrackedMannequin } from './tracked-mannequin.js';

/**
 * v0 パイプライン検証ビューア。
 * Pose2Sim(マルチビュー三角測量)の出力を trc_to_tracked_motion.py で
 * 変換した real-capture-data.json を読み込み、GLBアバターで再生する。
 * これが動けば「多視点映像 → 3D → サンドボックス」の背骨が通る。
 */

const DATA_URL = './real-capture-data.json';

const elements = {
  canvas: document.querySelector('#stage'),
  play: document.querySelector('#play'),
  timeline: document.querySelector('#timeline'),
  time: document.querySelector('#time'),
  meta: document.querySelector('#meta'),
  status: document.querySelector('#status'),
};

function interpolateActor(first, second, progress) {
  const result = {};
  for (const joint of Object.keys(first)) {
    const a = first[joint];
    const b = second[joint] ?? a;
    result[joint] = [0, 1, 2].map((axis) => a[axis] + (b[axis] - a[axis]) * progress);
  }
  return result;
}

async function boot() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    elements.status.textContent = 'real-capture-data.json がまだありません。mocap-v0 のパイプラインを先に実行してください。';
    return;
  }
  const data = await response.json();

  const renderer = new THREE.WebGLRenderer({ canvas: elements.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 300);
  camera.position.set(2.6, 1.7, 3.6);
  const controls = new OrbitControls(camera, elements.canvas);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.52;

  const pitch = createPitch(renderer, { attackingGoalX: 9 });
  scene.add(pitch.group);

  // GLBアバター優先、失敗時は簡易マネキン。
  let actor;
  try {
    const factory = await loadAvatarFactory();
    actor = factory.create({ shirtColor: 0x1d2026, pantsColor: 0x11141a, accentColor: 0xffb545, label: 'CAPTURE', labelHeight: 0.38 });
  } catch (error) {
    console.warn('GLB読み込み失敗。簡易マネキンで表示します。', error);
    actor = createTrackedMannequin({ shirtColor: 0x1d2026, pantsColor: 0x11141a, accentColor: 0xffb545, label: 'CAPTURE', labelHeight: 0.38 });
  }
  scene.add(actor.group);

  // 関節ポイント表示。もも付け根(hip)・膝・足首・かかと・つま先・小趾、
  // 肩・肘・手首まで、データに存在する全関節を点として可視化する。
  const FOOT_JOINTS = new Set(['toeL', 'toeR', 'smallToeL', 'smallToeR', 'heelL', 'heelR', 'ankleL', 'ankleR']);
  const markerGroup = new THREE.Group();
  markerGroup.renderOrder = 7;
  scene.add(markerGroup);
  const jointMarkers = new Map();
  {
    const bodyMaterial = new THREE.MeshBasicMaterial({ color: 0x56c8ff, depthTest: false });
    const footMaterial = new THREE.MeshBasicMaterial({ color: 0xffb545, depthTest: false });
    const geometry = new THREE.SphereGeometry(0.022, 12, 10);
    for (const joint of Object.keys(dataFirstFrameJoints())) {
      const marker = new THREE.Mesh(geometry, FOOT_JOINTS.has(joint) ? footMaterial : bodyMaterial);
      marker.renderOrder = 7;
      markerGroup.add(marker);
      jointMarkers.set(joint, marker);
    }
  }
  function dataFirstFrameJoints() {
    return data.frames[0].actor;
  }
  function updateMarkers(pose) {
    for (const [joint, marker] of jointMarkers) {
      const value = pose[joint];
      if (value) marker.position.set(value[0], value[1], value[2]);
    }
  }
  const markerButton = document.createElement('button');
  markerButton.type = 'button';
  markerButton.textContent = '関節を隠す';
  document.querySelector('.bar').append(markerButton);
  markerButton.addEventListener('click', () => {
    markerGroup.visible = !markerGroup.visible;
    markerButton.textContent = markerGroup.visible ? '関節を隠す' : '関節を表示';
  });

  const frames = data.frames;
  const fps = data.sourceFps || 60;
  const duration = frames.length / fps;
  elements.meta.textContent = `${frames.length} frames ・ ${fps}fps ・ ${duration.toFixed(2)}s ・ Pose2Sim multi-view`;
  elements.status.remove();

  let playing = true;
  let time = 0;

  function applyTime(seconds) {
    const position = Math.min(frames.length - 1, Math.max(0, seconds * fps));
    const lower = Math.floor(position);
    const upper = Math.min(frames.length - 1, lower + 1);
    const pose = interpolateActor(frames[lower].actor, frames[upper].actor, position - lower);
    actor.applyPose(pose);
    updateMarkers(pose);
    elements.timeline.value = String(Math.round((seconds / duration) * 1000));
    elements.time.textContent = `${seconds.toFixed(2)}s`;
  }

  elements.play.addEventListener('click', () => {
    playing = !playing;
    elements.play.textContent = playing ? 'Ⅱ' : '▶';
  });
  elements.timeline.addEventListener('input', () => {
    playing = false;
    elements.play.textContent = '▶';
    time = (Number(elements.timeline.value) / 1000) * duration;
    applyTime(time);
  });

  const clock = new THREE.Clock();
  let lastWidth = 0;
  let lastHeight = 0;

  function animate() {
    const delta = Math.min(clock.getDelta(), 0.1);
    if (playing) {
      time += delta;
      if (time >= duration) time = 0;
      applyTime(time);
    }
    if (elements.canvas.clientWidth !== lastWidth || elements.canvas.clientHeight !== lastHeight) {
      lastWidth = elements.canvas.clientWidth;
      lastHeight = elements.canvas.clientHeight;
      camera.aspect = lastWidth / Math.max(1, lastHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(lastWidth, lastHeight, false);
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  applyTime(0);
  animate();
}

boot().catch((error) => {
  console.error(error);
  elements.status.textContent = 'ビューアを開始できませんでした。コンソールを確認してください。';
});
