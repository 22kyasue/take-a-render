import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

import { createPitch } from './pitch.js';

/**
 * Mixamo製サッカーMoCap素材のビューア。
 *
 * Mixamo の FBX は全クリップが X Bot と同一スケルトン(共通ボーン名)なので、
 * Blenderでのリターゲット無しに、X Bot へ AnimationClip を直接流せる。
 * ここは素材の品鑑定用ページ。athlete.glb への正式リターゲットは
 * Blender 正本パイプラインで行う。
 */

const ASSET_DIR = './assets/mixamo/';

// カテゴリ → ファイル名。ファイル名がそのまま表示名になる。
const CATALOG = {
  '移動(ジョグ)': [
    'jog forward.fbx', 'jog backward.fbx', 'jog strafe left.fbx', 'jog strafe right.fbx',
    'jog forward diagonal.fbx', 'jog forward diagonal (2).fbx',
    'jog backward diagonal.fbx', 'jog backward diagonal (2).fbx',
    'strike foward jog.fbx',
  ],
  'ドリブル・パス・トラップ': [
    'Dribble.fbx', 'Soccer Pass.fbx', 'Receive.fbx', 'receive soccerball.fbx',
    'Soccer Spin.fbx', 'offensive idle.fbx', 'transition.fbx',
  ],
  'シュート・キック': [
    'kick soccerball.fbx', 'kick soccerball (2).fbx', 'soccer penalty kick.fbx',
    'scissor kick.fbx', 'kick up soccerball.fbx',
  ],
  'ヘディング・ジャグリング': [
    'Soccer Header.fbx', 'header soccerball.fbx', 'header soccerball (2).fbx',
    'kneeing soccerball.fbx', 'kneeing soccerball (2).fbx',
    'stall soccerball.fbx', 'stall soccerball (2).fbx', 'stall soccerball (3).fbx', 'stall soccerball (4).fbx',
  ],
  'タックル・転倒': [
    'soccer tackle.fbx', 'soccer tackle (2).fbx', 'soccer tackle (3).fbx',
    'soccer trip.fbx', 'fallen idle.fbx', 'standing up.fbx',
  ],
  'ゴールキーパー': [
    'goalkeeper idle.fbx', 'goalkeeper idle (2).fbx',
    'goalkeeper diving save.fbx', 'goalkeeper diving save (2).fbx',
    'goalkeeper catch.fbx', 'goalkeeper catch (2).fbx', 'goalkeeper catch (3).fbx', 'goalkeeper catch (4).fbx',
    'goalkeeper body block.fbx', 'goalkeeper body block (2).fbx', 'goalkeeper body block (3).fbx',
    'goalkeeper scoop.fbx', 'goalkeeper miss.fbx',
    'goalkeeper sidestep.fbx', 'goalkeeper sidestep (2).fbx',
    'goalkeeper pass.fbx', 'goalkeeper overhand throw.fbx', 'goalkeeper drop kick.fbx',
    'goalkeeper placing ball.fbx', 'goalkeeper placing ball (2).fbx',
    'goalkeeper directing.fbx', 'goalkeeper directing (2).fbx',
  ],
  'その他': ['throw in.fbx'],
};

const elements = {
  canvas: document.querySelector('#stage'),
  list: document.querySelector('#list'),
  hudName: document.querySelector('#hud-name'),
  hudMeta: document.querySelector('#hud-meta'),
  error: document.querySelector('#error'),
};

const loader = new FBXLoader();
const clipCache = new Map();

// ルートモーション(Hipsの水平移動)を除去して、その場で再生する。
// ギャラリーは動きの質を見る場所なので、被写体がフレーム外へ
// 走り去らないことを優先する。垂直方向(ジャンプ・転倒)は残す。
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

async function loadClip(file) {
  if (!clipCache.has(file)) {
    const group = await loader.loadAsync(ASSET_DIR + encodeURIComponent(file));
    const clip = group.animations[0];
    if (!clip) throw new Error(`${file}: アニメーションが見つかりません`);
    clipCache.set(file, stripHorizontalRootMotion(clip));
  }
  return clipCache.get(file);
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
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 300);
  camera.position.set(2.6, 1.6, 3.4);
  const controls = new OrbitControls(camera, elements.canvas);
  controls.target.set(0, 0.95, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.minDistance = 1.2;
  controls.maxDistance = 14;

  const pitch = createPitch(renderer, { attackingGoalX: 9 });
  scene.add(pitch.group);

  elements.hudName.textContent = 'X Bot を読み込み中…';
  const avatar = await loader.loadAsync(`${ASSET_DIR}X%20Bot.fbx`);
  avatar.scale.setScalar(0.01); // Mixamo FBX は cm 単位
  avatar.traverse((object) => {
    if (object.isMesh || object.isSkinnedMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
    }
  });
  scene.add(avatar);

  const mixer = new THREE.AnimationMixer(avatar);
  let currentAction = null;

  async function play(file, button) {
    try {
      elements.hudName.textContent = `${file.replace(/\.fbx$/i, '')} を読み込み中…`;
      const clip = await loadClip(file);
      const action = mixer.clipAction(clip);
      action.reset();
      if (currentAction && currentAction !== action) {
        // クロスフェードで前のクリップから滑らかに引き継ぐ。
        currentAction.crossFadeTo(action.play(), 0.25, true);
      } else {
        action.play();
      }
      currentAction = action;
      elements.hudName.textContent = file.replace(/\.fbx$/i, '');
      elements.hudMeta.textContent = `${clip.duration.toFixed(2)}秒 ・ ループ再生 ・ Mixamo`;
      for (const candidate of elements.list.querySelectorAll('button.clip')) {
        candidate.classList.toggle('active', candidate === button);
      }
    } catch (error) {
      console.error(error);
      elements.error.hidden = false;
      elements.error.textContent = `${file} を再生できませんでした`;
    }
  }

  for (const [category, files] of Object.entries(CATALOG)) {
    const heading = document.createElement('p');
    heading.className = 'cat';
    heading.textContent = category;
    elements.list.append(heading);
    for (const file of files) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'clip';
      button.textContent = file.replace(/\.fbx$/i, '');
      button.addEventListener('click', () => play(file, button));
      elements.list.append(button);
    }
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
    mixer.update(clock.getDelta());
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();
  await play('Dribble.fbx', elements.list.querySelectorAll('button.clip')[9] || null);
}

boot().catch((error) => {
  console.error(error);
  elements.error.hidden = false;
  elements.error.textContent = 'ビューアを開始できませんでした。ネットワークとWebGL対応を確認してください。';
});
