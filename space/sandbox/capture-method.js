import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

import { createPitch } from './pitch.js';

/**
 * 制作手法の説明デモ。
 * 半面ピッチを4台のカメラリグで囲み、
 *   STEP1: 4点同時撮影(リグと画角の可視化)
 *   STEP2: 3D復元(骨格表示)
 *   STEP3: 自由視点(通常レンダリング + オービット)
 * を1つの空間で切り替えて見せる。選手はMixamo公開モーション。
 */

const ASSET_DIR = './assets/mixamo/';
// アタッキングハーフの中央付近でプレーさせる。
const ACTION_POINT = new THREE.Vector3(4.5, 0, 0);
// プレーを取り囲む4台。実運用の「半面を囲む」配置を模す。
const CAMERA_RIGS = [
  { id: 'cam1', label: 'CAM 01', position: new THREE.Vector3(10.5, 1.7, 7.5) },
  { id: 'cam2', label: 'CAM 02', position: new THREE.Vector3(10.5, 1.7, -7.5) },
  { id: 'cam3', label: 'CAM 03', position: new THREE.Vector3(-1.5, 1.7, 7.5) },
  { id: 'cam4', label: 'CAM 04', position: new THREE.Vector3(-1.5, 1.7, -7.5) },
];
// シナリオで使うクリップ。移動は playerGroup 側で行い、クリップはその場再生。
// soccer tackle(スライディング)と soccer trip(タックルに足を取られて転倒)は
// Mixamo 上で対になるよう収録されたペア。接触シーンはこの2本を同期再生する。
const PLAYLIST = [
  'Dribble.fbx', 'kick soccerball.fbx', 'offensive idle.fbx',
  'soccer tackle.fbx', 'soccer trip.fbx', 'standing up.fbx',
  'Soccer Spin.fbx',
];

const elements = {
  canvas: document.querySelector('#stage'),
  steps: [...document.querySelectorAll('.step')],
  camButtons: [...document.querySelectorAll('[data-cam]')],
  hudTitle: document.querySelector('#hud-title'),
  hudSub: document.querySelector('#hud-sub'),
};

function stripHorizontalRootMotion(clip) {
  const track = clip.tracks.find((candidate) => /Hips\.position$/.test(candidate.name));
  if (!track) return clip;
  const values = track.values;
  const baseX = values[0];
  const baseZ = values[2];
  for (let index = 0; index < values.length; index += 3) {
    values[index] = baseX;
    values[index + 2] = baseZ;
  }
  return clip;
}

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(9, 12, 18, 0.85)';
  context.fillRect(0, 0, 256, 96);
  context.strokeStyle = '#ffb545';
  context.lineWidth = 4;
  context.strokeRect(2, 2, 252, 92);
  context.fillStyle = '#ffffff';
  context.font = '700 38px system-ui';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(1.15, 0.43, 1);
  sprite.renderOrder = 8;
  return sprite;
}

// 三脚 + カメラ本体 + 画角(視錐台ライン)のリグを1台つくる。
function makeCameraRig({ label, position }, lookTarget) {
  const rig = new THREE.Group();
  rig.position.copy(position);

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.5 });
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4150, roughness: 0.7 });
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, position.y, 6), legMaterial);
    leg.position.set(Math.cos(angle) * 0.26, -position.y / 2, Math.sin(angle) * 0.26);
    leg.rotation.z = Math.cos(angle) * 0.22;
    leg.rotation.x = -Math.sin(angle) * 0.22;
    rig.add(leg);
  }
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.44), bodyMaterial);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.18, 16), bodyMaterial);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -0.3;
  const head = new THREE.Group();
  head.add(body, lens);
  // レンズ・画角は -Z 側に付けてあるので、カメラ規約(-Zが視線)の
  // 回転を Matrix4.lookAt で直接作る。Object3D.lookAt は通常オブジェクト
  // だと +Z をターゲットへ向けてしまい、真逆を向く。
  const localTarget = lookTarget.clone().add(new THREE.Vector3(0, 1.0, 0)).sub(position);
  head.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), localTarget, new THREE.Vector3(0, 1, 0)),
  );
  rig.add(head);

  // 画角の可視化。短めの錐体で「向き」を示す。長すぎるとライン同士が
  // ピッチ全面で交差してノイズになる。
  const frustumLength = 3.2;
  const origin = new THREE.Vector3(0, 0, 0);
  const points = [];
  const corners = [[-1, -0.6], [1, -0.6], [1, 0.6], [-1, 0.6]]
    .map(([sx, sy]) => new THREE.Vector3(sx * 0.95, sy * 0.6, -frustumLength));
  for (const corner of corners) points.push(origin.clone(), corner);
  for (let index = 0; index < corners.length; index += 1) {
    points.push(corners[index].clone(), corners[(index + 1) % corners.length].clone());
  }
  const frustum = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0xffb545, transparent: true, opacity: 0.55 }),
  );
  head.add(frustum);

  const sprite = makeLabel(label);
  sprite.position.y = 0.55;
  rig.add(sprite);

  return { rig, head, frustum };
}

async function boot() {
  const renderer = new THREE.WebGLRenderer({ canvas: elements.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 300);
  camera.position.set(17, 9, 14);
  const controls = new OrbitControls(camera, elements.canvas);
  controls.target.copy(ACTION_POINT).setY(1.0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.minDistance = 1.5;
  controls.maxDistance = 40;

  const pitch = createPitch(renderer, { attackingGoalX: 9 });
  scene.add(pitch.group);

  const lookTarget = ACTION_POINT.clone();
  const rigs = CAMERA_RIGS.map((config) => {
    const built = makeCameraRig(config, lookTarget);
    scene.add(built.rig);
    return { ...config, ...built };
  });

  // 選手(Mixamo X Bot)。playerGroup がピッチ上の位置と向きを持ち、
  // その中でアバターがその場モーションを再生する(ゲームの標準構成)。
  const loader = new FBXLoader();
  const playerGroup = new THREE.Group();
  scene.add(playerGroup);
  const avatar = await loader.loadAsync(`${ASSET_DIR}X%20Bot.fbx`);
  avatar.scale.setScalar(0.01);
  avatar.traverse((object) => {
    if (object.isMesh || object.isSkinnedMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
    }
  });
  playerGroup.add(avatar);

  const skeletonHelper = new THREE.SkeletonHelper(avatar);
  skeletonHelper.material.color = new THREE.Color(0x56c8ff);
  skeletonHelper.material.depthTest = false;
  skeletonHelper.renderOrder = 6;
  skeletonHelper.visible = false;
  scene.add(skeletonHelper);

  // フットサル4号球。
  const BALL_RADIUS = 0.10;
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.46, metalness: 0.02 }),
  );
  ball.castShadow = true;
  scene.add(ball);

  // 守備者。もう1体の X Bot を読み込み、ユニフォーム色を変えて区別する。
  const defenderGroup = new THREE.Group();
  scene.add(defenderGroup);
  const defenderAvatar = await loader.loadAsync(`${ASSET_DIR}X%20Bot.fbx`);
  defenderAvatar.scale.setScalar(0.01);
  defenderAvatar.traverse((object) => {
    if (object.isMesh || object.isSkinnedMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      object.material = materials.map((material) => {
        const copy = material.clone();
        copy.color = new THREE.Color(0x49c7df);
        return copy;
      });
      if (!Array.isArray(object.material) || object.material.length === 1) {
        object.material = object.material[0] ?? object.material;
      }
    }
  });
  defenderGroup.add(defenderAvatar);

  const mixer = new THREE.AnimationMixer(avatar);
  const defenderMixer = new THREE.AnimationMixer(defenderAvatar);
  // 移動クリップ(ドリブル等)はルートモーションを剥がして親グループで動かす。
  // 接触系(タックル・転倒・立ち上がり)は滑り込み・倒れ込みの移動が本体なので
  // 生のルートモーションのまま再生し、終了時に移動分を親へ焼き込む。
  const clips = new Map();
  const rawClips = new Map();
  const RAW_FILES = new Set(['soccer tackle.fbx', 'soccer trip.fbx', 'standing up.fbx']);
  for (const file of PLAYLIST) {
    const group = await loader.loadAsync(ASSET_DIR + encodeURIComponent(file));
    if (RAW_FILES.has(file)) rawClips.set(file, group.animations[0]);
    else clips.set(file, stripHorizontalRootMotion(group.animations[0]));
  }
  function makePlayer(targetMixer) {
    let current = null;
    return function play(file, { loop = true, immediate = false, timeScale = 1 } = {}) {
      const clip = clips.get(file) ?? rawClips.get(file);
      const action = targetMixer.clipAction(clip);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = !loop;
      action.reset();
      action.timeScale = timeScale;
      if (immediate) {
        // ルート焼き込み直後はクロスフェード禁止。旧クリップのルート
        // オフセットが混ざると位置が二重に飛ぶため、即時切替する。
        if (current && current !== action) current.stop();
        action.play();
      } else if (current && current !== action) {
        current.crossFadeTo(action.play(), 0.25, true);
      } else {
        action.play();
      }
      current = action;
      return action;
    };
  }
  const playClip = makePlayer(mixer);
  const playDefenderClip = makePlayer(defenderMixer);

  // 生クリップで動いた分を親グループへ焼き込む。骨盤のワールド水平位置を
  // 親の位置に移し、アバターは原点へ戻す(切替のズレはクロスフェードで吸収)。
  function bakeRootOffset(group, targetAvatar) {
    const hips = targetAvatar.getObjectByName('mixamorigHips');
    if (!hips) return;
    const world = hips.getWorldPosition(new THREE.Vector3());
    group.position.x = world.x;
    group.position.z = world.z;
  }

  // ---- 元映像「背負いの極意｜前へ出てキープ」の再現ループ ----
  // ①背負い: ゴールへ背を向けてキープ、守備者は背中から圧をかける
  // ②前へ出る: 背負ったまま少しずつゴール方向へ体を押し込む
  // ③ターン: Soccer Spin で反転して前を取る
  // ④フィニッシュ: シュート → ゴール
  const SHIELD_START = new THREE.Vector3(3.6, 0, 0.3);   // 背負い開始位置
  const SHIELD_PUSH_SPEED = 0.32;                        // 前へ出る速さ (m/s)
  const SHIELD_DURATION = 2.8;                           // 背負いキープの尺
  const GOAL = new THREE.Vector3(9.05, 0.8, 0.3);

  const scenario = {
    // shield → turn → shootWindup → ballFlight → celebrate → reset
    phase: 'shield',
    phaseClock: 0,
    shotStart: new THREE.Vector3(),
    turnStartYaw: 0,
  };
  const forward = new THREE.Vector3();
  const ballSpin = { angle: 0 };
  const spinDuration = clips.get('Soccer Spin.fbx').duration;

  function startShield() {
    scenario.phase = 'shield';
    scenario.phaseClock = 0;
    // 攻撃者はゴールへ背を向ける(-x向き)。ボールはゴールと反対の足元。
    playerGroup.position.copy(SHIELD_START);
    playerGroup.rotation.y = Math.atan2(-1, 0); // -x方向
    ball.position.set(SHIELD_START.x - 0.32, BALL_RADIUS, SHIELD_START.z + 0.05);
    playClip('offensive idle.fbx', { immediate: true });
    // 守備者は攻撃者の背中(ゴール側)から密着して圧をかける。
    defenderGroup.position.set(SHIELD_START.x + 0.62, 0, SHIELD_START.z - 0.08);
    defenderGroup.rotation.y = Math.atan2(-1, 0); // 攻撃者の背中を向く
    playDefenderClip('offensive idle.fbx', { immediate: true });
  }

  function updateScenario(delta) {
    scenario.phaseClock += delta;

    if (scenario.phase === 'shield') {
      // 背負ったままゴール方向(+x)へじわじわ押し込む。守備者も下がる。
      playerGroup.position.x += SHIELD_PUSH_SPEED * delta;
      defenderGroup.position.x += SHIELD_PUSH_SPEED * delta;
      ball.position.x += SHIELD_PUSH_SPEED * delta;
      // 体を左右に揺らして駆け引きを出す。
      const sway = Math.sin(scenario.phaseClock * 2.6) * 0.06;
      playerGroup.position.z = SHIELD_START.z + sway;
      defenderGroup.position.z = SHIELD_START.z - 0.08 + sway * 0.7;
      ball.position.z = SHIELD_START.z + 0.05 + sway;
      if (scenario.phaseClock >= SHIELD_DURATION) {
        scenario.phase = 'turn';
        scenario.phaseClock = 0;
        scenario.turnStartYaw = playerGroup.rotation.y;
        playClip('Soccer Spin.fbx', { loop: false, timeScale: 1.2 });
      }
    } else if (scenario.phase === 'turn') {
      // スピンに合わせて半回転し、ゴールへ正対する。
      const progress = Math.min(1, scenario.phaseClock / (spinDuration / 1.2));
      const eased = progress * progress * (3 - 2 * progress);
      playerGroup.rotation.y = scenario.turnStartYaw + Math.PI * eased;
      // ボールを体の反対側(ゴール側)へ持ち替える。
      const carry = Math.sin(eased * Math.PI * 0.5);
      ball.position.x = playerGroup.position.x + (-0.32 + 0.72 * carry);
      ball.position.y = BALL_RADIUS;
      // 守備者は置き去りにされ、半歩遅れて向き直る。
      defenderGroup.rotation.y += (Math.atan2(1, 0) - defenderGroup.rotation.y) * Math.min(1, delta * 2.2);
      if (progress >= 1) {
        scenario.phase = 'shootWindup';
        scenario.phaseClock = 0;
        const toGoal = new THREE.Vector3().subVectors(GOAL, playerGroup.position);
        playerGroup.rotation.y = Math.atan2(toGoal.x, toGoal.z);
        playClip('kick soccerball.fbx', { loop: false, timeScale: 1.15 });
      }
    } else if (scenario.phase === 'shootWindup') {
      // キックのインパクト付近でボールを射出する。
      if (scenario.phaseClock >= 0.54) {
        scenario.phase = 'ballFlight';
        scenario.phaseClock = 0;
        scenario.shotStart.copy(ball.position);
      }
    } else if (scenario.phase === 'ballFlight') {
      // フットサルのシュートは約4.5mを0.35秒前後で通過する。
      const t = Math.min(1, scenario.phaseClock / 0.35);
      const eased = 1 - (1 - t) * (1 - t);
      ball.position.lerpVectors(scenario.shotStart, GOAL, eased);
      ball.position.y = scenario.shotStart.y + (GOAL.y - scenario.shotStart.y) * eased + 0.5 * Math.sin(eased * Math.PI) * 0.4;
      ballSpin.angle += 30 * delta;
      ball.rotation.x = ballSpin.angle;
      if (t >= 1) {
        scenario.phase = 'celebrate';
        scenario.phaseClock = 0;
        ball.position.copy(GOAL).setY(BALL_RADIUS); // ネット内に落ちる
        playClip('offensive idle.fbx');
      }
    } else if (scenario.phase === 'celebrate') {
      if (scenario.phaseClock >= 1.6) startShield();
    }
  }

  startShield();
  // デバッグ用: シナリオ状態を外から観察できるようにする。
  window.__scenario = scenario;

  // ---- ステップ切り替え ----
  const STEP_STATES = {
    capture: {
      title: 'STEP 01 ― 4点同時撮影',
      sub: 'CAM 01–04 の配置と画角。撮影範囲が重なるように置く',
      rigsVisible: true, skeleton: false, cam: 'free',
    },
    reconstruct: {
      title: 'STEP 02 ― 3D復元(トラッキング)',
      sub: '4本の映像から関節を推定し、骨格モーションに統合する',
      rigsVisible: true, skeleton: true, cam: 'top',
    },
    freeview: {
      title: 'STEP 03 ― 自由視点サンドボックス',
      sub: 'ドラッグで360°回転。どの角度からでも体の使い方を観察できる',
      rigsVisible: false, skeleton: false, cam: 'free',
    },
  };

  function setCamera(name) {
    for (const button of elements.camButtons) button.classList.toggle('active', button.dataset.cam === name);
    const rig = rigs.find((candidate) => candidate.id === name);
    if (rig) {
      camera.position.copy(rig.position);
      controls.target.copy(ACTION_POINT).setY(1.0);
    } else if (name === 'top') {
      camera.position.set(ACTION_POINT.x + 0.01, 17, 0.01);
      controls.target.copy(ACTION_POINT).setY(0);
    } else {
      camera.position.set(17, 9, 14);
      controls.target.copy(ACTION_POINT).setY(1.0);
    }
    controls.update();
  }

  function setStep(name) {
    const state = STEP_STATES[name];
    if (!state) return;
    for (const step of elements.steps) step.classList.toggle('active', step.dataset.step === name);
    elements.hudTitle.textContent = state.title;
    elements.hudSub.textContent = state.sub;
    for (const rig of rigs) rig.rig.visible = state.rigsVisible;
    skeletonHelper.visible = state.skeleton;
    setCamera(state.cam);
  }

  for (const step of elements.steps) {
    step.addEventListener('click', () => setStep(step.dataset.step));
  }
  for (const button of elements.camButtons) {
    button.addEventListener('click', () => setCamera(button.dataset.cam));
  }

  const clock = new THREE.Clock();
  let lastWidth = 0;
  let lastHeight = 0;

  function animate() {
    if (elements.canvas.clientWidth !== lastWidth || elements.canvas.clientHeight !== lastHeight) {
      lastWidth = elements.canvas.clientWidth;
      lastHeight = elements.canvas.clientHeight;
      camera.aspect = lastWidth / Math.max(1, lastHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(lastWidth, lastHeight, false);
    }
    const delta = Math.min(clock.getDelta(), 0.1);
    mixer.update(delta);
    defenderMixer.update(delta);
    updateScenario(delta);

    // カメラは定点。動かさないこと自体が「固定4視点の合成で3Dを作る」
    // という手法の表現になっている。
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  setStep('capture');
  animate();
}

boot().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<p style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);color:#ff9a9a;z-index:9">デモを開始できませんでした。ネットワークとWebGL対応を確認してください。</p>',
  );
});
