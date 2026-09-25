import * as THREE from 'three';
import { CAPTURE_SOURCES } from './capture-sources.js';
import { createSourceAtlas } from './source-atlas.js';
import { createCaptureCamera } from './capture-camera.js';

const $ = id => document.getElementById(id);
const cameraIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="13" height="12" rx="3"/><path d="m15 10 6-4v12l-6-4"/></svg>';

// One metre has the same size on both map axes; these are the 3D field axes.
function mapPoint(position) { return { x: (position.x + 2) / 26 * 100, y: (position.z + 13) / 26 * 100 }; }

export function createSourceWall() {
 const atlas = createSourceAtlas();
 for (const source of CAPTURE_SOURCES) {
  const card = document.createElement('button');
  card.className = 'source-card'; card.dataset.source = source.id;
  card.style.setProperty('--camera-color', source.color);
  card.setAttribute('aria-label', `CAM ${source.number} ${source.label}の映像を固定`);
  card.setAttribute('aria-pressed', 'false');
  card.innerHTML = `<span class="feed-state">CAM ${source.number}</span><canvas class="source-frame" aria-label="${source.label}の元映像"></canvas><span class="feed-caption"><span><span class="camera-number">${source.number}</span> ${source.label}</span><span class="feed-arrow">↗</span></span><span class="source-error" hidden role="status">映像を読み込めませんでした</span>`;
  atlas.bind(card.querySelector('canvas'), Number(source.number) - 1);
  $('source-grid').append(card);
 }
 return atlas;
}

export function createCaptureWorkspace({ scene, camera, controls, stage, master, toWorld, onView, atlas }) {
 const root = new THREE.Group(); scene.add(root);
 const preview = $('camera-preview'), previewVideo = $('preview-video');
 const feeds = CAPTURE_SOURCES.map(source => ({ ...source, card: document.querySelector('[data-source="' + source.id + '"]') }));
 let stations = [], active = null, pinned = false, closeTimer, lastSync = 0;
 const projected = new THREE.Vector3(), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();

 function paintSelection() {
  for (const item of feeds) {
   const selected = item.id === active?.id;
   item.card.classList.toggle('selected', selected);
   item.card.setAttribute('aria-pressed', String(selected && pinned));
  }
  for (const item of stations) {
   const selected = item.id === active?.id;
   item.marker.classList.toggle('selected', selected); item.map.classList.toggle('selected', selected);
   item.marker.setAttribute('aria-pressed', String(selected && pinned)); item.map.setAttribute('aria-pressed', String(selected && pinned));
   item.sight.visible = selected;
   item.mapLine.style.opacity = selected ? '.65' : '0';
  }
 }
 function close() { clearTimeout(closeTimer); active = null; pinned = false; preview.hidden = true; atlas.unbind(previewVideo); paintSelection(); }
 function delayClose() { clearTimeout(closeTimer); if (!pinned) closeTimer = setTimeout(close, 220); }
 function placePreview(anchor) {
  if (matchMedia('(max-width: 1400px), (pointer: coarse)').matches) {
   preview.style.left = ''; preview.style.top = ''; return;
  }
  const bounds = { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
  const width = preview.offsetWidth, height = preview.offsetHeight;
  let x = bounds.width - width - 20, y = bounds.height - height - 20;
  if (anchor?.classList.contains('camera-marker')) {
   const rect = anchor.getBoundingClientRect();
   x = rect.left - bounds.left + rect.width + 14;
   if (x + width > bounds.width - 12) x = rect.left - bounds.left - width - 14;
   y = rect.top - bounds.top - height / 3;
  }
  preview.style.left = `${Math.max(12, Math.min(x, bounds.width - width - 12))}px`;
  preview.style.top = `${Math.max(12, Math.min(y, bounds.height - height - 20))}px`;
 }
 function show(source, pin = false, anchor = null) {
  clearTimeout(closeTimer);
  if (pinned && !pin) return;
  if (pin && pinned && active?.id === source.id) { close(); return; }
  const changed = active?.id !== source.id;
  active = source; pinned = pin;
  preview.hidden = false; preview.style.setProperty('--camera-color', source.color);
  $('preview-title').textContent = `CAM ${source.number} / ${source.label}`;
  $('preview-mode').textContent = pinned ? '固定中 · × または Esc で閉じる' : 'ホバープレビュー · クリックで固定';
  if (changed) {
   atlas.bind(previewVideo, Number(source.number) - 1);
   $('preview-error').textContent = '';
   previewVideo.setAttribute('aria-label', `${source.label}の拡大映像`);
  }
  $('preview-view').disabled = !stations.some(item => item.id === source.id);
  placePreview(anchor); paintSelection();

 }
 function wire(button, source) {
  button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') show(source, false, button); });
  button.addEventListener('pointerleave', delayClose);
  button.addEventListener('focus', () => { if (button.matches(':focus-visible')) show(source, false, button); });
  button.addEventListener('blur', delayClose);
  button.addEventListener('click', () => show(source, true, button));
 }
 feeds.forEach(item => wire(item.card, item));
 preview.addEventListener('pointerenter', () => clearTimeout(closeTimer));
 preview.addEventListener('pointerleave', delayClose);
 preview.addEventListener('focusin', () => clearTimeout(closeTimer));
 preview.addEventListener('focusout', event => { if (!preview.contains(event.relatedTarget)) delayClose(); });
 $('preview-close').onclick = close;
 document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
 master.addEventListener('play', () => atlas.retry());
 $('preview-view').onclick = () => {
  const station = stations.find(item => item.id === active?.id); if (!station) return;
  camera.position.copy(station.position); controls.target.copy(station.target); controls.update();
  $('follow').checked = false; onView(); close();
  stage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
 };

 function build(cameras, target) {
  $('camera-map').innerHTML = `<svg viewBox="-2 -13 26 26" aria-label="20m × 20mの仮想ハーフコート" role="img"><g fill="none" stroke="#59786e" stroke-width=".06"><path d="M0 -10H20V10H0Z"/><path d="M0 -3A3 3 0 0 1 0 3"/><path d="M20 -7.5A6 6 0 0 0 14 -1.5V1.5A6 6 0 0 0 20 7.5"/><path d="M20 -1.5H21V1.5H20" stroke="#acbcb4"/><circle cx="14" cy="0" r=".1"/><path d="M1 11.5H6M1 11.2V11.8M6 11.2V11.8" stroke="#9fb3aa"/></g><text x="3.5" y="12.5" fill="#9fb3aa" font-size=".65" text-anchor="middle">5 m（仮想コート基準）</text><text x="10" y="-11.4" fill="#7c9389" font-size=".7" text-anchor="middle">HALF COURT / 20 × 20 m</text><g id="map-sight-lines"></g><circle id="map-morioka" r=".23" fill="#edc648" stroke="#102019" stroke-width=".07"/><circle id="map-opponent" r=".23" fill="#48a7eb" stroke="#102019" stroke-width=".07"/></svg>`;
  for (const source of CAPTURE_SOURCES) {
   const capture = cameras.find(item => item.id === source.id); if (!capture) continue;
   const position = toWorld(capture.center);
   const { group, head } = createCaptureCamera(THREE, { position, target, color: source.color }); root.add(group);
   const sight = new THREE.Line(new THREE.BufferGeometry().setFromPoints([position, target]), new THREE.LineDashedMaterial({ color: source.color, dashSize: .2, gapSize: .12, transparent: true, opacity: .65 }));
   sight.computeLineDistances(); sight.visible = false; root.add(sight);
   group.traverse(object => { object.userData.sourceId = source.id; });
   const marker = document.createElement('button'); marker.className = 'camera-marker';
   marker.dataset.camera = source.id;
   marker.dataset.aimError = THREE.MathUtils.radToDeg(head.getWorldDirection(new THREE.Vector3()).angleTo(target.clone().sub(position).normalize())).toFixed(6); marker.style.setProperty('--camera-color', source.color);
   marker.setAttribute('aria-label', `CAM ${source.number} ${source.label}のカメラ`); marker.setAttribute('aria-pressed', 'false');
   marker.innerHTML = `${cameraIcon}<span class="camera-number">${source.number}</span><span class="marker-name">${source.label}</span>`;
   $('camera-labels').append(marker); wire(marker, source);
   const map = document.createElement('button'); map.className = 'map-camera'; map.textContent = source.number;
   map.setAttribute('aria-label', `マップ CAM ${source.number} ${source.label}`); map.setAttribute('aria-pressed', 'false');
   map.style.setProperty('--camera-color', source.color);
   const mapped = mapPoint(position);
   map.style.left = `${mapped.x}%`; map.style.top = `${mapped.y}%`;
   $('camera-map').append(map); wire(map, source);
   const mapLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
   for (const [key, value] of Object.entries({ x1: position.x, y1: position.z, x2: target.x, y2: target.z, stroke: source.color, 'stroke-width': .07, 'stroke-dasharray': '.2 .2' })) mapLine.setAttribute(key, value);
   mapLine.style.opacity = '0'; $('map-sight-lines').append(mapLine);
   const register = document.createElement('button'); register.className = 'camera-register-row'; register.style.setProperty('--camera-color', source.color);
   register.innerHTML = `<span class="camera-number">${source.number}</span><span>${source.label}</span><span>高さ 約${position.y.toFixed(1)} m</span><span>↗</span>`;
   register.setAttribute('aria-label', `${source.label}の元映像を表示`); $('camera-register').append(register); wire(register, source);
   stations.push({ ...source, position, target: target.clone(), group, marker, map, sight, mapLine });
  }
 }
 const canvas = $('canvas');
 canvas.addEventListener('pointermove', event => {
  if (event.buttons || pinned) return;
  const bounds = canvas.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(stations.map(item => item.group), true)[0];
  const station = hit && stations.find(item => item.id === hit.object.userData.sourceId);
  canvas.style.cursor = station ? 'pointer' : '';
  if (station) show(station, false, station.marker); else delayClose();
 });
 canvas.addEventListener('pointerleave', delayClose);
 canvas.addEventListener('click', event => {
  if (pinned || !active || event.defaultPrevented || canvas.style.cursor !== 'pointer') return;
  show(active, true);
 });
 return {
  build,
  updatePlayers(morioka, opponent) {
   for (const [id, position] of [['map-morioka', morioka], ['map-opponent', opponent]]) {
    const dot = $(id); if (dot) { dot.setAttribute('cx', position.x); dot.setAttribute('cy', position.z); }
   }
  },
  update() {
   camera.updateMatrixWorld();
   for (const item of stations) {
    projected.copy(item.position); projected.y += .7; projected.project(camera);
    const visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < .94 && Math.abs(projected.y) < .94;
    item.marker.hidden = !visible;
    if (visible) { item.marker.style.left = `${(projected.x + 1) / 2 * stage.clientWidth}px`; item.marker.style.top = `${(1 - projected.y) / 2 * stage.clientHeight}px`; }
   }
   const now = performance.now(); if (now - lastSync < 50) return; lastSync = now;
   $('sources-play').disabled = $('play').disabled;
   $('preview-play').disabled = $('play').disabled;
   $('sources-play').textContent = $('preview-play').textContent = master.paused ? '再生' : '一時停止';
   $('sources-seek').value = master.currentTime;
   $('sources-clock').textContent = `${master.currentTime.toFixed(2)} / 8.00`;
   atlas.update(master);
  },
 };
}
