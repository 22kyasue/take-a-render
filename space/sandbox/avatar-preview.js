import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 検証ポーズ。度数、ボーンローカル空間。Blender 側の verify_avatar.py と
// 同じ値を使っており、両者で同じ姿勢になることが正しさの確認になる。
const POSES = {
  rest: {},
  squat: {
    LeftUpLeg: [75, 0, -8], RightUpLeg: [75, 0, 8],
    LeftLeg: [-95, 0, 0], RightLeg: [-95, 0, 0],
    LeftFoot: [22, 0, 0], RightFoot: [22, 0, 0],
    Spine: [14, 0, 0], Spine1: [12, 0, 0], Spine2: [8, 0, 0],
    LeftArm: [-25, 0, 35], RightArm: [-25, 0, -35],
    LeftForeArm: [55, 0, 0], RightForeArm: [55, 0, 0],
  },
  contact: {
    LeftUpLeg: [48, 0, -20], RightUpLeg: [30, 0, 22],
    LeftLeg: [-62, 0, 0], RightLeg: [-40, 0, 0],
    LeftFoot: [14, 0, 0], RightFoot: [10, 0, 0],
    Spine: [10, -14, -8], Spine1: [8, -12, -6], Spine2: [6, -10, -6],
    LeftShoulder: [0, 0, -18], RightShoulder: [0, 0, 12],
    LeftArm: [-30, 0, 70], RightArm: [-10, 0, -50],
    LeftForeArm: [95, 0, 0], RightForeArm: [60, 0, 0],
    Neck: [0, -25, 0], Head: [0, -15, 0],
  },
  kick: {
    RightUpLeg: [-40, 0, 0], RightLeg: [-115, 0, 0], RightFoot: [-30, 0, 0],
    LeftUpLeg: [18, 0, 0], LeftLeg: [-20, 0, 0],
    Spine: [-6, 12, 0], Spine1: [-4, 14, 0], Spine2: [0, 14, 0],
    LeftArm: [-45, 0, 55], RightArm: [40, 0, -30],
    LeftForeArm: [70, 0, 0], RightForeArm: [50, 0, 0],
  },
  // 可動域テーブルが効いていることを見せるための意図的な異常入力。
  // 膝を +60 度（前へ折る方向）に曲げようとしても 0 度で止まる。
  overextend: {
    LeftLeg: [60, 0, 0], RightLeg: [60, 0, 0],
    LeftForeArm: [-60, 0, 0], RightForeArm: [-60, 0, 0],
    LeftUpLeg: [-90, 0, 0], RightUpLeg: [-90, 0, 0],
  },
};

const AXES = ['x', 'y', 'z'];
const DEG = Math.PI / 180;

const canvas = document.getElementById('stage');
const statsPanel = document.getElementById('stats');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090c12);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);

scene.add(new THREE.HemisphereLight(0xdce7ff, 0x1a1f26, 1.2));
const keyLight = new THREE.DirectionalLight(0xffeedd, 3.0);
keyLight.position.set(-2.6, 4.2, 3.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -2;
keyLight.shadow.camera.right = 2;
keyLight.shadow.camera.top = 3;
keyLight.shadow.camera.bottom = -1;
keyLight.shadow.bias = -0.0004;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x6fb0ff, 2.2);
rimLight.position.set(3.2, 2.6, -3.4);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(4, 64),
  new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
scene.add(new THREE.PolarGridHelper(3.5, 8, 7, 64, 0x39414d, 0x2a303a));

const rig = { root: null, bones: new Map(), rest: new Map(), helper: null };
let limits = null;

function clampDegrees(boneName, angles) {
  const table = limits && limits.limits ? limits.limits[boneName] : null;
  if (!table) return angles;
  return angles.map((value, index) => {
    const range = table[AXES[index]];
    if (!range) return value;
    return Math.min(range[1], Math.max(range[0], value));
  });
}

function applyPose(name) {
  const pose = POSES[name] || {};
  const clamped = [];
  for (const [boneName, bone] of rig.bones) {
    const rest = rig.rest.get(boneName);
    const requested = pose[boneName] || [0, 0, 0];
    const allowed = clampDegrees(boneName, requested);
    if (allowed.some((value, index) => value !== requested[index])) {
      clamped.push(`${boneName} ${requested.join('/')} → ${allowed.join('/')}`);
    }
    // glTF のノード回転はレスト姿勢そのもの。可動域はレストからの差分に
    // かかるので、レスト回転に差分を後ろから掛ける。
    const delta = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(allowed[0] * DEG, allowed[1] * DEG, allowed[2] * DEG, 'XYZ'),
    );
    bone.quaternion.copy(rest).multiply(delta);
  }
  rig.root.updateMatrixWorld(true);
  snapToFloor();
  return clamped;
}

const floorProbe = new THREE.Vector3();
const FOOT_BONES = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];
// レスト姿勢での各足ボーンの高さ。骨ごとに床までの距離が違うので、
// 単一のオフセットでは接地しない。差分で見る。
const footRestHeights = new Map();

function captureFootRestHeights() {
  rig.root.updateMatrixWorld(true);
  for (const name of FOOT_BONES) {
    const bone = rig.bones.get(name);
    if (!bone) continue;
    bone.getWorldPosition(floorProbe);
    footRestHeights.set(name, floorProbe.y);
  }
}

function snapToFloor() {
  // スキンメッシュの実変形をCPUで再現するのは高価なので、足部ボーンの
  // レスト高さからの落ち込み量で近似接地させる。可動域検証には十分。
  let drop = Infinity;
  for (const name of FOOT_BONES) {
    const bone = rig.bones.get(name);
    const restHeight = footRestHeights.get(name);
    if (!bone || restHeight === undefined) continue;
    bone.getWorldPosition(floorProbe);
    drop = Math.min(drop, floorProbe.y - rig.root.position.y - restHeight);
  }
  if (Number.isFinite(drop)) rig.root.position.y = -drop;
  rig.root.updateMatrixWorld(true);
}

// --- カメラ操作（軽量なオービット。addons に依存しない） ---
const view = { azimuth: 0.5, polar: 1.32, distance: 3.6, target: new THREE.Vector3(0, 0.95, 0) };
const DEFAULT_VIEW = { ...view, target: view.target.clone() };
let spinning = true;

function updateCamera() {
  const sinPolar = Math.sin(view.polar);
  camera.position.set(
    view.target.x + view.distance * sinPolar * Math.sin(view.azimuth),
    view.target.y + view.distance * Math.cos(view.polar),
    view.target.z + view.distance * sinPolar * Math.cos(view.azimuth),
  );
  camera.lookAt(view.target);
}

let dragging = false;
let lastPointer = { x: 0, y: 0 };

canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  spinning = false;
  document.getElementById('spin').setAttribute('aria-pressed', 'false');
  lastPointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  view.azimuth -= (event.clientX - lastPointer.x) * 0.006;
  view.polar = Math.min(2.9, Math.max(0.22, view.polar - (event.clientY - lastPointer.y) * 0.006));
  lastPointer = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener('pointerup', (event) => {
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  view.distance = Math.min(9, Math.max(1.1, view.distance + event.deltaY * 0.0022));
}, { passive: false });

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width === width && canvas.height === height) return;
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function tick() {
  resize();
  if (spinning) view.azimuth += 0.0042;
  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// --- 読み込み ---
async function loadLimits() {
  try {
    const response = await fetch('./joint-limits.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    limits = await response.json();
  } catch (error) {
    limits = null;
    console.warn('joint-limits.json を読めませんでした。可動域の制限は無効です。', error);
  }
}

function report(extra = '') {
  const boneCount = rig.bones.size;
  const limitCount = limits ? Object.keys(limits.limits).length : 0;
  statsPanel.innerHTML = [
    `ボーン <b>${boneCount}</b> ・ 可動域定義 <b>${limitCount}</b> 関節`,
    extra,
  ].filter(Boolean).join('<br>');
}

async function main() {
  await loadLimits();
  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync('./assets/athlete.glb');
  } catch (error) {
    statsPanel.innerHTML = `<span class="error">athlete.glb を読み込めませんでした: ${error.message}</span>`;
    return;
  }

  rig.root = gltf.scene;
  rig.root.traverse((object) => {
    if (object.isMesh || object.isSkinnedMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
    }
    if (object.isBone) {
      rig.bones.set(object.name, object);
      rig.rest.set(object.name, object.quaternion.clone());
    }
  });
  scene.add(rig.root);

  rig.helper = new THREE.SkeletonHelper(rig.root);
  rig.helper.visible = false;
  rig.helper.material.linewidth = 2;
  scene.add(rig.helper);

  captureFootRestHeights();
  applyPose('rest');
  report();

  document.getElementById('pose').addEventListener('change', (event) => {
    const clamped = applyPose(event.target.value);
    report(clamped.length
      ? `<span style="color:#ffd06b">可動域で丸めた関節 ${clamped.length}:</span><br>${clamped.join('<br>')}`
      : '可動域内。丸めた関節なし');
  });
  document.getElementById('skeleton').addEventListener('click', (event) => {
    const next = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    event.currentTarget.setAttribute('aria-pressed', String(next));
    rig.helper.visible = next;
  });
  document.getElementById('spin').addEventListener('click', (event) => {
    spinning = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    event.currentTarget.setAttribute('aria-pressed', String(spinning));
  });
  document.getElementById('reset').addEventListener('click', () => {
    view.azimuth = DEFAULT_VIEW.azimuth;
    view.polar = DEFAULT_VIEW.polar;
    view.distance = DEFAULT_VIEW.distance;
    view.target.copy(DEFAULT_VIEW.target);
  });
}

main();
tick();
