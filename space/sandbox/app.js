import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { createEnvironment } from './environment.js';
import { directionError } from './multiview-pose.js';
import { createSourceComparison } from './source-comparison.js';
import { createSourceWall, createCaptureWorkspace } from './capture-workspace.js';
import { createBallRollSampler } from './ball-roll.js';
import { createGoalResponse } from './goal-response.js';
import { installViewportZoom } from './viewport-zoom.js';
import { attachExternalPlayer, captureMoveRest } from './external-player.js';
import { createPlaybackClock } from './playback-clock.js';
import { displayProfile } from './display-profile.js';
import { createFootContact } from './foot-contact.js';
import { createCoaching } from './coaching.js';

const $ = id => document.getElementById(id);
const sourceAtlas = createSourceWall();
// Keep playback available when the surrounding UI moves the source preview.
const video = $('source-video') || document.createElement('video'), stage = $('stage');
if (!video.isConnected) {
 video.id = 'source-video'; video.src = '../cam1_west.mp4'; video.muted = true;
 video.playsInline = true; video.preload = 'auto'; video.hidden = true; document.body.append(video);
}
const playback = createPlaybackClock(8);
const sourceComparison = createSourceComparison(playback, t => seek(t), sourceAtlas);
const coaching = createCoaching({master:playback,seek:t => seek(t)});
$('four-sources').onclick = () => sourceComparison.open();
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ canvas: $('canvas'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(43, 1, .05, 250);
const controls = new OrbitControls(camera, $('canvas')); controls.enableDamping = true; controls.minDistance = 1.7; controls.maxDistance = 85; controls.maxPolarAngle = Math.PI / 2 - .015;
let touchOrbit = false;
$('canvas').style.touchAction = 'pan-y'; controls.enableZoom = true; controls.zoomToCursor = true;
$('canvas').addEventListener('pointerdown', event => {
 if (event.pointerType === 'touch' && !touchOrbit) event.stopImmediatePropagation();
}, { capture: true });
$('touch-orbit').onclick = () => {
 touchOrbit = !touchOrbit;
 $('canvas').style.touchAction = touchOrbit ? 'none' : 'pan-y';
 $('touch-orbit').setAttribute('aria-pressed', String(touchOrbit));
 $('touch-orbit').textContent = touchOrbit ? '回転を終了 ✓' : '指で3Dを回転';
};
installViewportZoom({ canvas: $('canvas'), camera, controls, orbitEnabled: () => touchOrbit, zoomIn: $('zoom-in'), zoomOut: $('zoom-out') });
const environment = createEnvironment(scene, renderer);
// Place the reconstructed goal (z = 0) at the virtual goal (x = 20).
const fieldRotation = -Math.PI / 2;
const up = new THREE.Vector3(0, 1, 0);
const offset = new THREE.Vector3(20, 0, 0);
const players = {}, opponentVersions = {}; let data, ballTrack, sampleBallRoll, sampleGoalResponse, ready = false, lastTime = -1, lastCenter = null, currentView = 'capture';
const vector = p => new THREE.Vector3(...p);
function fieldPoint(p) { return vector(p).applyAxisAngle(up, fieldRotation).add(offset); }
const captureWorkspace = createCaptureWorkspace({ scene, camera, controls, stage, master: playback, atlas: sourceAtlas, toWorld: fieldPoint, onView: () => {
 currentView = 'source'; document.querySelectorAll('[data-view]').forEach(button => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false'); });
} });
function point(f, role, joint) { return fieldPoint(f[role][joint]); }
function average(a, b) { return a.clone().add(b).multiplyScalar(.5); }
function node(model, suffix) { let found; model.traverse(o => { if (o.name.endsWith(suffix) && !o.name.startsWith('visual')) found = o; }); if (!found) throw new Error(`MOVE joint missing: ${suffix}`); return found; }
function world(object) { return object.getWorldPosition(new THREE.Vector3()); }

async function loadPlayer(role, url, color, sourceOffset = 0) {
 const gltf = await new GLTFLoader().loadAsync(url);
 if (!gltf.animations.length) throw new Error(`MOVE animation missing: ${role}`);
 const group = new THREE.Group(); group.add(gltf.scene); scene.add(group);
 const bind = captureMoveRest(gltf.scene);
 // MOVE frame zero is the export bind pose, not an observed human pose.
 const firstMotionTime = 1 / 60;
 const mixer = new THREE.AnimationMixer(gltf.scene); for (const clip of gltf.animations) mixer.clipAction(clip).play(); mixer.setTime(firstMotionTime);
 const joints = Object.fromEntries(['Spine', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot'].map(name => [name, node(gltf.scene, name)]));
 gltf.scene.traverse(o => {
  if (!o.isMesh) return;
  o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
  const materials = Array.isArray(o.material) ? o.material : [o.material];
  const copies = materials.map(source => { const m = source.clone(); if (m.color && m.color.r + m.color.g + m.color.b > 1.25) { m.color.set(color); m.roughness = .47; m.metalness = .08; } return m; });
  o.material = Array.isArray(o.material) ? copies : copies[0];
 });
 group.updateMatrixWorld(true);
 const measuredLeg = world(joints.LeftUpLeg).distanceTo(world(joints.LeftLeg)) + world(joints.LeftLeg).distanceTo(world(joints.LeftFoot));
 const p = data.frames[0][role]; const targetLeg = vector(p[11]).distanceTo(vector(p[13])) + vector(p[13]).distanceTo(vector(p[15]));
 if (!(measuredLeg > .2 && measuredLeg < 3)) throw new Error(`Unexpected MOVE scale: ${role}`);
 const scale = THREE.MathUtils.clamp(targetLeg / measuredLeg, .6, 1.6);
 const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128; const ctx = shadowCanvas.getContext('2d'); const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 64); gradient.addColorStop(0, '#050a0d88'); gradient.addColorStop(1, '#050a0d00'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
 const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
 let external;
 // Explicit preview keeps the existing default and other sessions intact.
 const variant = new URLSearchParams(location.search).get('playerCandidate');
 try { if(['geek3dom','studio'].includes(variant)) external = await attachExternalPlayer({group, source:gltf.scene, bind, color, variant}); }
 catch(error) { $('canvas').dataset.externalPlayerError=error.message; console.warn('External player unavailable; using MOVE model',error); }
 return { group, mixer, joints, scale, shadow, sourceOffset, firstMotionTime, external, contact: createFootContact(group,joints), duration: Math.min(...gltf.animations.map(a => a.duration)) };
}
const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xf5efdc, roughness: .52 });
const ball = new THREE.Mesh(new THREE.SphereGeometry(.105, 24, 16), ballMaterial); ball.castShadow = true; scene.add(ball);
for (const direction of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const patch = new THREE.Mesh(new THREE.CircleGeometry(.035, 5), new THREE.MeshStandardMaterial({ color: 0x20282b })); patch.position.set(...direction).multiplyScalar(.103); patch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vector(direction)); ball.add(patch); }
function alignPlayer(player, frame, role, t) {
 if (player.moveRotations) for (const [name, rotation] of Object.entries(player.moveRotations)) player.joints[name].quaternion.copy(rotation);
 player.group.position.set(0, 0, 0); player.group.rotation.set(0, 0, 0); player.group.scale.setScalar(1);
 const sourceTime = t + player.sourceOffset;
 player.mixer.setTime(Math.max(player.firstMotionTime, Math.min(sourceTime, player.duration - .0001))); player.group.updateMatrixWorld(true);
 player.moveRotations = Object.fromEntries(Object.entries(player.joints).map(([name, bone]) => [name, bone.quaternion.clone()]));
 const hip = average(world(player.joints.LeftUpLeg), world(player.joints.RightUpLeg));
 const direction = world(player.joints.LeftArm).sub(world(player.joints.RightArm));
 const targetDirection = vector(frame[role][5]).sub(vector(frame[role][6])).applyAxisAngle(up, fieldRotation);
 const yaw = Math.atan2(direction.z, direction.x) - Math.atan2(targetDirection.z, targetDirection.x);
 player.group.rotation.y = yaw; player.group.scale.setScalar(player.scale);
 const targetHip = average(point(frame, role, 11), point(frame, role, 12));
 const rotatedHip = hip.multiplyScalar(player.scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
 player.group.position.copy(targetHip).sub(rotatedHip); player.group.updateMatrixWorld(true);
 const contact = $('foot-contact')?.value !== 'original' ? player.contact.apply() : {before:player.contact.measure(),after:player.contact.measure()};
 $('canvas').dataset[`${role}SoleBefore`] = JSON.stringify(contact.before);
 $('canvas').dataset[`${role}SoleAfter`] = JSON.stringify(contact.after);
 if (playback.paused) {
 const targets = frame[role].map(fieldPoint);
 const before = directionError(player.joints, targets);
 $('canvas').dataset[`${role}DirectionBefore`] = before.toFixed(2);
 $('canvas').dataset[`${role}DirectionAfter`] = directionError(player.joints, targets).toFixed(2);
 const actualHip = average(world(player.joints.LeftUpLeg), world(player.joints.RightUpLeg));
 $('canvas').dataset[`${role}HipError`] = actualHip.distanceTo(targetHip).toFixed(6);
 if (role === 'morioka') $('canvas').dataset.frontPose = JSON.stringify(Object.values(player.joints).flatMap(bone => [...world(bone).toArray(), ...bone.getWorldQuaternion(new THREE.Quaternion()).toArray()]));
 }
 player.shadow.position.set(targetHip.x, .018, targetHip.z); player.shadow.visible = player.group.visible;
 if(player.external) $('canvas').dataset[`${role}MeshWristError`] = player.external.update().toFixed(8);
}
function time() { return Math.max(0, Math.min(7.983333, playback.currentTime || 0)); }
function centerAt(t) { const f = data.frames[Math.min(479, Math.round(t * 60))]; return average(point(f, 'morioka', 11), point(f, 'opponent', 11)).setY(.95); }
function pose(t) {
 if (!ready || t === lastTime) return;
 lastTime = t; const frame = data.frames[Math.min(479, Math.round(t * 60))];
 for (const [role, player] of Object.entries(players)) alignPlayer(player, frame, role, t);
 const center = centerAt(t);
 captureWorkspace.updatePlayers(average(point(frame, 'morioka', 11), point(frame, 'morioka', 12)), average(point(frame, 'opponent', 11), point(frame, 'opponent', 12)));
 if ($('follow').checked && lastCenter) { const delta = center.clone().sub(lastCenter); camera.position.add(delta); controls.target.add(delta); }
 lastCenter = center;
 const trackedBall = sampleGoalResponse(t);
 $('canvas').dataset.netDisplacement = environment.updateNet(trackedBall?.impacts ?? [], t).toFixed(4);
 ball.visible = $('show-ball').checked && !!trackedBall;
 if (trackedBall) {
  ball.position.copy(fieldPoint(trackedBall.p));
  ball.quaternion.fromArray(sampleBallRoll(trackedBall.rollTime ?? t));
 }
 $('canvas').dataset.ballRotation = trackedBall ? JSON.stringify(ball.quaternion.toArray()) : '';
 $('canvas').dataset.ballVisible = String(ball.visible);
 $('canvas').dataset.ballMethod = trackedBall?.method ?? 'unobserved';
 $('canvas').dataset.ballPosition = trackedBall ? JSON.stringify(trackedBall.p) : '';
 $('seek').value = t; $('clock').textContent = `${t.toFixed(2)} / 8.00`;
 $('phase').textContent = t < 4.43 ? '位置取り · 相手を背負う' : t < 4.7 ? 'フィード · トラップ' : t < 5.36 ? 'キープ' : t < 6.3 ? '右足で持ち出す' : t < 6.7 ? '右足シュート' : 'フォロースルー';
 $('canvas').dataset.frame = String(Math.round(t * 60));
}
function setView(type) {
 if (!ready) return;
 currentView = type;
 environment.view(type === 'capture' ? 'top' : type);
 const target = centerAt(time());
 const positions = { close: [3.7, 1.9, 4.6], opposite: [-3.7, 1.9, -4.6], sideline: [0, 4.8, 11], goal: [9, 2.3, 0], wide: [33, 28, 39], top: [.01, 58, .01] };
 if (type === 'capture') {
  target.set(14.7, 0, .2); $('follow').checked = false;
  const distance = 16.5 / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(camera.aspect, 1.25);
  camera.position.copy(target).add(new THREE.Vector3(-.35, .86, .37).normalize().multiplyScalar(distance));
  controls.target.copy(target); controls.update();
 } else {
  if (type === 'wide' || type === 'top') { target.set(0, 0, 0); $('follow').checked = false; } else $('follow').checked = true;
  controls.target.copy(target); camera.position.copy(target).add(vector(positions[type])); controls.update();
 }
 document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === type); button.setAttribute('aria-pressed', String(button.dataset.view === type)); });
}
function seek(t) { playback.pause(); playback.currentTime = Math.max(0, Math.min(7.983333, t)); lastTime = -1; pose(playback.currentTime); }
$('sources-seek').oninput = event => seek(Number(event.target.value));
$('sources-play').onclick = $('preview-play').onclick = () => $('play').click();
$('play').onclick = async () => { if (!ready) return; if (playback.paused) { if (time() > 7.95) playback.currentTime = 0; try { await playback.play(); } catch { $('status').textContent = '再生できません。もう一度再生を押してください。'; } } else playback.pause(); };
playback.addEventListener('play', () => { $('play').textContent = '一時停止'; });
playback.addEventListener('pause', () => { $('play').textContent = '再生'; });
playback.loop = true; playback.playbackRate = Number($('speed').value);
video.onerror = () => { $('status').textContent = '西側の映像を読み込めません。3Dと他の映像は再生できます。'; };
$('seek').oninput = e => seek(Number(e.target.value)); $('speed').onchange = e => playback.playbackRate = Number(e.target.value); $('loop').onchange = e => playback.loop = e.target.checked;
document.querySelectorAll('[data-time]').forEach(b => b.onclick = () => seek(Number(b.dataset.time)));
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
$('environment').onchange = e => { environment.set(e.target.value); $('venue-label').textContent = { indoor: 'INDOOR ARENA', outdoor: 'OPEN AIR FIELD', stadium: 'PHOTO STADIUM' }[e.target.value]; $('canvas').dataset.environment = e.target.value; };
$('exposure').oninput = e => renderer.toneMappingExposure = Number(e.target.value);
function applyDisplayProfile() {
 const bounds = stage.getBoundingClientRect();
 const profile = displayProfile({width:innerWidth,height:innerHeight,touch:matchMedia('(pointer: coarse)').matches,
  dpr:devicePixelRatio,quality:$('quality').value,stageWidth:bounds.width,stageHeight:bounds.height});
 renderer.setPixelRatio(profile.pixelRatio); renderer.shadowMap.enabled = profile.shadows;
 environment.quality(profile.shadows ? 'high' : 'light');
 stage.dataset.displayProfile = profile.kind;
 stage.dataset.pixelRatio = profile.pixelRatio.toFixed(3);
}
$('quality').onchange = applyDisplayProfile;
matchMedia('(pointer: coarse)').addEventListener('change', applyDisplayProfile);
$('show-opponent').onchange = e => { if (players.opponent) { players.opponent.group.visible = e.target.checked; players.opponent.shadow.visible = e.target.checked; } };
$('show-morioka').onchange = e => { if (players.morioka) { players.morioka.group.visible = e.target.checked; players.morioka.shadow.visible = e.target.checked; } };
$('show-ball').onchange = () => { lastTime = -1; pose(time()); };
$('pose-mode').onchange = () => selectOpponent();
function selectOpponent() {
 if (!ready) return;
 if (!opponentVersions[$('pose-mode').value]) $('pose-mode').value = 'improved';
 for (const model of Object.values(opponentVersions).filter(Boolean)) { model.group.visible = false; model.shadow.visible = false; }
 players.opponent = opponentVersions[$('pose-mode').value];
 players.opponent.group.visible = $('show-opponent').checked;
 lastTime = -1; pose(time()); updatePoseLabel();
}
function updatePoseLabel() {
 const labels = { improved: `後ろの人：${opponentVersions.goalback ? 'ゴール裏・東側・サイド' : '東側・サイド'}のMOVE動作を統合`, move: '後ろの人：修正前（サイドのMOVE）', goalback: '後ろの人：ゴール裏のMOVE', east: '後ろの人：東側のMOVE' };
 $('status').textContent = labels[$('pose-mode').value] + '／前の人の動作は共通';
 $('canvas').dataset.poseMode = $('pose-mode').value;
}
$('snapshot').onclick = () => { renderer.render(scene, camera); const link = document.createElement('a'); link.download = `take-a-${$('environment').value}-${time().toFixed(2)}.png`; link.href = renderer.domElement.toDataURL('image/png'); link.click(); };
const observer = new ResizeObserver(() => { const { width, height } = stage.getBoundingClientRect(); applyDisplayProfile(); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }); observer.observe(stage);
let stageVisible = true;
const visibilityObserver = new IntersectionObserver(([entry]) => { stageVisible = entry.isIntersecting; });
visibilityObserver.observe(stage);
let lastRender = -Infinity;
function render(now = 0) {
 requestAnimationFrame(render);
 if (document.hidden || now - lastRender < 1000 / 30) return;
 lastRender = now;
 if (ready) pose(time()); sourceComparison.update(); coaching.update(); controls.update(); captureWorkspace.update();
 // Keep all playback clocks running while giving the GPU to the source videos
 // when the user scrolls past the 3D scene.
 if (stageVisible) renderer.render(scene, camera);
}
render();
try {
 const response = await fetch('../motion.json'); if (!response.ok) throw new Error('Take A motion unavailable'); data = await response.json(); if (data.frames.length !== 480) throw new Error('Take A frame count mismatch');
 const ballResponse = await fetch('./ball-track.json'); if (!ballResponse.ok) throw new Error('Ball track unavailable'); ballTrack = await ballResponse.json();
 if (ballTrack.frames.length !== 480 || ballTrack.fps !== 60) throw new Error('Ball track timing mismatch');
 sampleBallRoll = createBallRollSampler(ballTrack, fieldRotation);
 sampleGoalResponse = createGoalResponse(ballTrack);
 const manifest = await (await fetch('./variants.json')).json();
 document.querySelector('option[value="goalback"]').disabled = !manifest.goalback;
 const loaded = await Promise.all([loadPlayer('morioka', '../paid-ai/main_glb.glb', 0xe8bd39), loadPlayer('opponent', './opponent.glb', 0x379cc5, -.00541), loadPlayer('opponent', './opponent-improved.glb', 0x379cc5), manifest.goalback ? loadPlayer('opponent', './opponent-goalback.glb', 0x379cc5, -.02141) : null, loadPlayer('opponent', './opponent-east.glb', 0x379cc5, .00156)]);
 [players.morioka, opponentVersions.move, opponentVersions.improved, opponentVersions.goalback, opponentVersions.east] = loaded;
 const contactLabel=document.createElement('label'); contactLabel.htmlFor='foot-contact'; contactLabel.textContent='足の接地';
 const contactSelect=document.createElement('select'); contactSelect.id='foot-contact';
 contactSelect.add(new Option('床との接地を調整','corrected')); contactSelect.add(new Option('元のMOVE動作と比較','original'));
 $('pose-mode').before(contactLabel,contactSelect);
 contactSelect.onchange=()=>{lastTime=-1;pose(time());};
 if(loaded.some(player=>player?.external)) {
 const meshLabel=document.createElement('label'); meshLabel.htmlFor='player-mesh'; meshLabel.textContent='人物の見た目';
 const meshSelect=document.createElement('select'); meshSelect.id='player-mesh';
 for(const [value,text] of [['external',new URLSearchParams(location.search).get('playerCandidate')==='studio' ? 'Studio改作 · 半袖ユニフォーム' : 'ユニフォーム姿 · 外部製モデル'],['move','MOVEモデル · 比較用']]) { const option=new Option(text,value); meshSelect.add(option); }
 const externalReady=loaded.filter(Boolean).every(player=>player.external);
 if(!externalReady) { meshSelect.value='move'; meshSelect.options[0].disabled=true; for(const player of loaded.filter(Boolean)) player.external?.setVisible(false); }
 $('pose-mode').before(meshLabel,meshSelect);
 meshSelect.onchange=()=>{ for(const player of loaded.filter(Boolean)) player.external?.setVisible(meshSelect.value==='external'); };
 const meshCredit=document.createElement('small'); meshCredit.textContent=new URLSearchParams(location.search).get('playerCandidate')==='studio' ? 'Studio改作：髪・服・表面を調整。人体・骨格の原作：Geek3Dom / CGTrader。本人の容姿の再現ではありません。' : '人物素材：Geek3Dom / CGTrader。汎用モデルで、本人の顔・体型の再現ではありません。';
 if(!externalReady) meshCredit.textContent='外部人物素材を読み込めなかったため、MOVEモデルを表示しています。';
 meshSelect.after(meshCredit);
 }
 $('canvas').dataset.externalPlayers=String(loaded.filter(player=>player?.external).length);
 await environment.ready;
 if (!manifest.goalback) {
  document.querySelector('option[value="goalback"]').disabled = true;
  document.querySelector('option[value="goalback"]').textContent = 'ゴール裏のMOVE（処理中）';
  document.querySelector('option[value="improved"]').textContent = '改善版 · 東側・サイドを統合';
  $('method-note').textContent = '前の人は同じMOVE動作を保持。後ろの人だけ、東側とサイドから個別処理した動きを統合。ゴール裏の追加処理は待機中です。4映像の推定を照合に使ったローカル統合で、MOVEの4カメラ一括処理ではありません。接触・指先の精度は未確定です。';
 }
 players.morioka.group.visible = $('show-morioka').checked;
 captureWorkspace.build(data.cameras || [], centerAt(2.97));
 ready = true; selectOpponent(); setView(currentView); seek(2.97); $('loading').hidden = true; $('play').disabled = false; $('canvas').dataset.ready = 'true'; $('canvas').dataset.environment = 'indoor';
 if (new URLSearchParams(location.search).get('playerCandidate') === 'studio') {
  setView('opposite');
  camera.position.sub(controls.target).multiplyScalar(.62).add(controls.target);
  controls.update();
 }
 const cost = await fetch('./cost.json'); if (cost.ok) { const value = await cost.json(); $('cost').textContent = `今回の追加 $${value.new_charge.toFixed(2)} · 累計 $${value.total_spend.toFixed(2)} / $2`; }
 $('cost').textContent += ' · ボール追跡 $0.26 / $1';
 $('method-note').append(' ボールは4映像のローカル追跡（4.38〜6.65秒）。短い遮蔽区間は補間し、追跡終了後はネットへの衝突・落下を表示用にシミュレーションしています。較正・実寸は推定で、床高は表示用に補正しています。Moveのボール追跡試験は失敗し、この軌道には使用していません。');
 $('method-note').append(' 足元は既存MOVE出力を使い、床に近い靴底だけを表示用に補正。腰の位置と靴の向きを保ち、元の動作に切り替えて比較できます。');
} catch (error) { $('loading').textContent = `読み込みに失敗しました：${error.message}`; $('status').textContent = '表示できません。ページを再読み込みしてください。'; }
