import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { AnimationPlayer, FINAL_FRAME } from './animation-player.js';
import { createCameraController, resolveFocusTarget } from './camera-controller.js';
import { createSandboxScene } from './scene.js';
import { sampleTrackedMotion } from './tracked-motion.js';
import { loadAvatarFactory } from './glb-avatar.js';
import { createReplayDirector, replaySpeedAt } from './replay-director.js';

const elements = {
  canvas: document.querySelector('#sandbox'),
  play: document.querySelector('#play'),
  previous: document.querySelector('#previous'),
  next: document.querySelector('#next'),
  timeline: document.querySelector('#timeline'),
  frame: document.querySelector('#frame'),
  time: document.querySelector('#time-current'),
  status: document.querySelector('.status'),
  statusText: document.querySelector('#status-text'),
  focus: document.querySelector('#focus'),
  analysis: document.querySelector('#analysis'),
  resetView: document.querySelector('#reset-view'),
  speedButtons: [...document.querySelectorAll('[data-speed]')],
  error: document.querySelector('#error'),
  sourceVideo: document.querySelector('#source-video'),
  sourceAudio: document.querySelector('#source-audio'),
  phase: document.querySelector('#phase'),
  techToggle: document.querySelector('#tech-toggle'),
  techPanel: document.querySelector('#tech-panel'),
  cameraRigToggle: document.querySelector('#camera-rig'),
  replayButton: document.querySelector('#replay'),
  replayHud: document.querySelector('#replay-hud'),
  replayCaption: document.querySelector('#replay-caption'),
  replayStat: document.querySelector('#replay-stat'),
  replaySpeed: document.querySelector('#replay-speed'),
};

// 元映像の実尺。ここまでは動画を主時計として3Dを同期し、これ以降は
// 手付けの3D補完区間になる。クリップを差し替えたらこの値も合わせる。
const SOURCE_SECONDS = 2.9;

function formatTime(seconds) {
  return `0:${seconds.toFixed(2).padStart(5, '0')}`;
}

async function boot() {
  // GLBアバターを優先し、取得できなければ従来の簡易マネキンで動かす。
  // 見た目は落ちるが、デモが完全に止まるよりよい。
  let createActor = null;
  try {
    const factory = await loadAvatarFactory();
    createActor = factory.create;
  } catch (error) {
    console.warn('GLBアバターを読み込めませんでした。簡易マネキンで表示します。', error);
  }
  const disclaimer = document.querySelector('.prototype-disclaimer');
  if (disclaimer && createActor) {
    disclaimer.textContent = 'v1: 単眼カメラ1本からの推定（奥行き・遮蔽は原理的制約）｜本番構成は多視点撮影＋選手モーショントラッキングを予定';
  }

  const sandbox = createSandboxScene(elements.canvas, createActor ? { createActor } : {});
  const controls = new OrbitControls(sandbox.camera, elements.canvas);
  const cameraController = createCameraController({ THREE, camera: sandbox.camera, controls });
  const player = new AnimationPlayer();
  const director = createReplayDirector({ camera: sandbox.camera });
  let analysisVisible = false;
  let lastTime = performance.now();

  // --- シネマティックリプレイ ---
  let replayActive = false;
  let replayFrame = 0;

  function replayCaptionFor(frame) {
    if (frame < 55) return '仕掛ける';
    if (frame < 140) return '背負いで前へ';
    if (frame < 152) return '反転';
    return 'シュート！';
  }

  function ballSpeedKmh(frame) {
    if (frame < 1) return 0;
    const current = sampleTrackedMotion(frame).ball;
    const previous = sampleTrackedMotion(frame - 1).ball;
    const distance = Math.hypot(
      current.x - previous.x, current.y - previous.y, current.z - previous.z,
    );
    return distance * 60 * 3.6;
  }

  function resolveReplayTarget(name) {
    if (name === 'ball') {
      const position = sandbox.ball.position;
      return [position.x, position.y, position.z];
    }
    const morioka = sandbox.morioka.getFocusPosition();
    const defender = sandbox.defender.getFocusPosition();
    return [
      (morioka.x + defender.x) / 2,
      (morioka.y + defender.y) / 2,
      (morioka.z + defender.z) / 2,
    ];
  }

  function startReplay() {
    replayActive = true;
    replayFrame = 0;
    player.pause();
    elements.sourceVideo.pause();
    controls.enabled = false;
    elements.replayButton.setAttribute('aria-pressed', 'true');
    elements.replayHud.hidden = false;
    elements.replayStat.hidden = true;
  }

  function stopReplay() {
    replayActive = false;
    controls.enabled = true;
    elements.replayButton.setAttribute('aria-pressed', 'false');
    elements.replayHud.hidden = true;
    sandbox.camera.fov = 42;
    sandbox.camera.updateProjectionMatrix();
    cameraController.resetView();
  }

  function applyFrame(frame) {
    const pose = sampleTrackedMotion(frame);
    // 視線: 森岡選手はボールを、守備者は森岡選手を見る。
    // 簡易マネキンは第2引数を無視するので互換のまま。
    sandbox.morioka.applyPose(pose.morioka, {
      gazeTarget: [pose.ball.x, pose.ball.y, pose.ball.z],
    });
    sandbox.defender.applyPose(pose.defender, {
      gazeTarget: pose.morioka.neck,
    });
    sandbox.ball.position.set(pose.ball.x, pose.ball.y, pose.ball.z);
    sandbox.ball.rotation.set(pose.ball.rotation, 0, pose.ball.rotation * 0.55);

    sandbox.scene.updateMatrixWorld(true);
    const ballPosition = sandbox.ball.getWorldPosition(new THREE.Vector3());
    const focusTarget = resolveFocusTarget(elements.focus.value, {
      morioka: sandbox.morioka.getFocusPosition(),
      defender: sandbox.defender.getFocusPosition(),
      ball: ballPosition,
    });
    cameraController.setFocusTarget(focusTarget);
  }

  function updateUI(snapshot) {
    elements.timeline.value = String(snapshot.frame);
    elements.frame.textContent = String(snapshot.frame).padStart(3, '0');
    elements.time.textContent = formatTime(snapshot.time);
    elements.play.textContent = snapshot.playing ? 'Ⅱ' : '▶';
    elements.play.setAttribute('aria-label', snapshot.playing ? '一時停止' : '再生');
    elements.status.classList.toggle('playing', snapshot.playing);
    elements.phase.textContent = '映像参考・推定';
    elements.statusText.textContent = snapshot.ended
      ? 'クリップ終了'
      : snapshot.playing ? '同期再生中' : '一時停止中';
  }

  function syncSourceVideo(snapshot) {
    const sourceTime = Math.min(SOURCE_SECONDS, snapshot.time);
    elements.sourceVideo.playbackRate = snapshot.speed;
    if (snapshot.playing && snapshot.time < SOURCE_SECONDS) {
      if (elements.sourceVideo.currentTime === 0 && sourceTime > 0.1) {
        elements.sourceVideo.currentTime = sourceTime;
      }
      if (elements.sourceVideo.paused) elements.sourceVideo.play().catch(() => {});
    } else {
      elements.sourceVideo.pause();
      if (Math.abs(elements.sourceVideo.currentTime - sourceTime) > 0.04) {
        elements.sourceVideo.currentTime = sourceTime;
      }
    }
  }

  function refresh() {
    const snapshot = player.snapshot();
    applyFrame(snapshot.frame);
    updateUI(snapshot);
    syncSourceVideo(snapshot);
  }

  elements.play.addEventListener('click', () => {
    const snapshot = player.snapshot();
    if (snapshot.playing) {
      if (snapshot.time < SOURCE_SECONDS && elements.sourceVideo.currentTime > 0) {
        player.syncTime(elements.sourceVideo.currentTime);
      }
      player.pause();
    } else {
      player.play();
    }
    refresh();
  });
  elements.previous.addEventListener('click', () => { player.stepFrames(-1); refresh(); });
  elements.next.addEventListener('click', () => { player.stepFrames(1); refresh(); });
  elements.timeline.addEventListener('input', () => { player.seekFrame(Number(elements.timeline.value)); refresh(); });
  elements.focus.addEventListener('change', refresh);
  elements.resetView.addEventListener('click', () => cameraController.resetView());
  elements.analysis.addEventListener('click', () => {
    analysisVisible = !analysisVisible;
    sandbox.morioka.setAnalysisVisible(analysisVisible);
    sandbox.defender.setAnalysisVisible(analysisVisible);
    elements.analysis.setAttribute('aria-pressed', String(analysisVisible));
    elements.analysis.textContent = analysisVisible ? '骨格を隠す' : '骨格を表示';
  });
  elements.cameraRigToggle.addEventListener('click', () => {
    const visible = !sandbox.cameraRig.visible;
    sandbox.cameraRig.visible = visible;
    elements.cameraRigToggle.setAttribute('aria-pressed', String(visible));
  });
  elements.replayButton.addEventListener('click', () => {
    if (replayActive) stopReplay();
    else startReplay();
  });
  elements.techToggle.addEventListener('click', () => {
    const open = elements.techPanel.hidden;
    elements.techPanel.hidden = !open;
    elements.techToggle.setAttribute('aria-pressed', String(open));
  });
  elements.sourceAudio.addEventListener('click', () => {
    elements.sourceVideo.muted = !elements.sourceVideo.muted;
    const audioEnabled = !elements.sourceVideo.muted;
    elements.sourceAudio.setAttribute('aria-pressed', String(audioEnabled));
    elements.sourceAudio.textContent = audioEnabled ? '音声ON' : '音声OFF';
  });
  for (const button of elements.speedButtons) {
    button.addEventListener('click', () => {
      player.setSpeed(Number(button.dataset.speed));
      elements.sourceVideo.playbackRate = player.snapshot().speed;
      for (const candidate of elements.speedButtons) candidate.classList.toggle('active', candidate === button);
    });
  }

  window.addEventListener('resize', sandbox.resize, { passive: true });
  elements.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    elements.error.hidden = false;
    elements.error.textContent = '3D表示が一時停止しました。ページを再読み込みしてください。';
  });

  function animate(now) {
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (replayActive) {
      // リプレイ台本がフレームとカメラを支配する
      replayFrame += delta * 60 * replaySpeedAt(replayFrame);
      const frame = Math.min(180, Math.round(replayFrame));
      player.seekFrame(frame);
      const snapshot = player.snapshot();
      applyFrame(frame);
      updateUI(snapshot);
      director.apply(Math.min(180, replayFrame), resolveReplayTarget);
      elements.replayCaption.textContent = replayCaptionFor(frame);
      if (frame >= 153) {
        elements.replayStat.hidden = false;
        elements.replaySpeed.innerHTML = `${ballSpeedKmh(Math.min(frame, 168)).toFixed(1)}<small>km/h</small>`;
      }
      sandbox.render();
      if (replayFrame >= 180) stopReplay();
      requestAnimationFrame(animate);
      return;
    }

    let snapshot = player.update(delta);
    if (
      snapshot.playing
      && snapshot.time <= SOURCE_SECONDS
      && !elements.sourceVideo.paused
      && !elements.sourceVideo.ended
      // 動画がまだバッファできていない間に currentTime(=0) へ同期すると
      // 3Dが frame 0 で固まる。再生可能になるまでは3D側の時計で進める。
      && elements.sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && elements.sourceVideo.currentTime > 0
    ) {
      snapshot = player.syncTime(elements.sourceVideo.currentTime);
    }
    applyFrame(snapshot.frame);
    updateUI(snapshot);
    syncSourceVideo(snapshot);
    cameraController.update();
    sandbox.render();
    requestAnimationFrame(animate);
  }

  refresh();
  cameraController.resetView();
  requestAnimationFrame(animate);
}

boot().catch((error) => {
  console.error(error);
  elements.error.hidden = false;
  elements.error.textContent = '3Dビューを開始できませんでした。WebGL対応ブラウザとネットワーク接続を確認してください。';
});
