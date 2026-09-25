import * as THREE from 'three';
import { enhanceMaterials } from './environment-materials.js';
import { createGoalNet } from './goal-net.js';
import { addHallDetails } from './hall-details.js';
import { photoSurface } from './photo-surfaces.js';

const UP = new THREE.Vector3(0, 1, 0);
const mat = (color, roughness = .6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
function box(group, size, position, material) {
 const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
 mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
}
function tube(group, a, b, radius, material) {
 const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), d = bv.clone().sub(av);
 const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, d.length(), 8), material);
 mesh.position.copy(av).add(bv).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(UP, d.normalize()); mesh.castShadow = true; group.add(mesh); return mesh;
}
function texture(kind) {
 const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024;
 const ctx = canvas.getContext('2d'); let seed = 731;
 const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
 if (kind === 'wood') {
  ctx.fillStyle = '#b8894d'; ctx.fillRect(0, 0, 2048, 1024);
  for (let row = 0; row < 80; row++) for (let col = -1; col < 10; col++) {
   const x = col * 240 + (row % 3) * 80, y = row * 13;
   ctx.fillStyle = `hsl(35, ${42 + random() * 12}%, ${49 + random() * 14}%)`; ctx.fillRect(x, y, 239, 12);
   for (let k = 0; k < 5; k++) { ctx.strokeStyle = `rgba(65,35,12,${random() * .13})`; ctx.beginPath(); ctx.moveTo(x, y + k * 2); ctx.bezierCurveTo(x + 60, y + k * 2 + 3, x + 170, y + k * 2 - 1, x + 239, y + k * 2); ctx.stroke(); }
  }
 } else {
  ctx.fillStyle = '#477b38'; ctx.fillRect(0, 0, 2048, 1024);
  for (let x = 0; x < 2048; x += 128) { ctx.fillStyle = x % 256 ? '#477b38' : '#54893f'; ctx.fillRect(x, 0, 128, 1024); }
  for (let i = 0; i < 150000; i++) { ctx.fillStyle = random() > .5 ? '#ffffff18' : '#09250a24'; ctx.fillRect(random() * 2048, random() * 1024, 1, 1 + random() * 3); }
 }
 const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; return map;
}
function goal(group, side) {
 const frame = mat(0xe9edf0, .3), red = mat(0xb52629, .4), x = side * 20, back = side * 21.1;
 tube(group, [x, 0, -1.5], [x, 2, -1.5], .04, frame); tube(group, [x, 0, 1.5], [x, 2, 1.5], .04, frame); tube(group, [x, 2, -1.5], [x, 2, 1.5], .04, frame);
 for (const z of [-1.5, 1.5]) { tube(group, [x, 2, z], [back, .08, z], .023, frame); tube(group, [x, .04, z], [back, .04, z], .023, frame); for (let y = .2; y < 2; y += .4) tube(group, [x, y, z], [x, y + .18, z], .041, red); }
 const points = [], line = (a, b) => {
  const count = Math.ceil(Math.hypot(...a.map((v, i) => b[i] - v)) / .1);
  for (let j = 0; j < count; j++) for (const t of [j / count, (j + 1) / count]) points.push(...a.map((v, i) => v + (b[i] - v) * t));
 };
 for (let z = -1.5; z <= 1.501; z += .1) { line([x, 2, z], [back, 2, z]); line([back, 0, z], [back, 2, z]); }
 for (let y = 0; y <= 2.001; y += .1) { line([back, y, -1.5], [back, y, 1.5]); for (const z of [-1.5, 1.5]) line([x, y, z], [back, y, z]); }
 for (let d = 0; d <= 1.101; d += .1) { line([x + side * d, 2, -1.5], [x + side * d, 2, 1.5]); for (const z of [-1.5, 1.5]) line([x + side * d, 0, z], [x + side * d, 2, z]); }
 return createGoalNet(group, points, side);
}
function markings(group) {
 const white = mat(0xf4f0d9, .65);
 const line = (a, b, width = .075) => { const av = new THREE.Vector3(a[0], .012, a[1]), bv = new THREE.Vector3(b[0], .012, b[1]), d = bv.clone().sub(av); const m = new THREE.Mesh(new THREE.PlaneGeometry(d.length(), width), white); m.rotation.set(-Math.PI / 2, 0, -Math.atan2(d.z, d.x)); m.position.copy(av).add(bv).multiplyScalar(.5); group.add(m); };
 const arc = (cx, cz, radius, start, end) => { for (let i = 0; i < 64; i++) { const a = start + (end - start) * i / 64, b = start + (end - start) * (i + 1) / 64; line([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius], [cx + Math.cos(b) * radius, cz + Math.sin(b) * radius]); } };
 line([-20, -10], [20, -10]); line([-20, 10], [20, 10]); line([-20, -10], [-20, 10]); line([20, -10], [20, 10]); line([0, -10], [0, 10]); arc(0, 0, 3, 0, Math.PI * 2);
 for (const s of [-1, 1]) {
  const pts = [];
  for (let i = 0; i <= 32; i++) { const a = Math.PI / 2 * i / 32; pts.push([s * (20 - 6 * Math.sin(a)), -1.5 - 6 * Math.cos(a)]); }
  pts.push([s * 14, 1.5]);
  for (let i = 0; i <= 32; i++) { const a = Math.PI / 2 * i / 32; pts.push([s * (20 - 6 * Math.cos(a)), 1.5 + 6 * Math.sin(a)]); }
  for (let i = 1; i < pts.length; i++) line(pts[i - 1], pts[i]);
  for (const x of [s * 14, s * 10]) { const spot = new THREE.Mesh(new THREE.CircleGeometry(.09, 20), white); spot.rotation.x = -Math.PI / 2; spot.position.set(x, .014, 0); group.add(spot); }
 }
}
function seatGeometry(width, height, depth, radius) {
 const shape = new THREE.Shape(), x = -width / 2, y = -height / 2;
 shape.moveTo(x + radius, y); shape.lineTo(x + width - radius, y);
 shape.quadraticCurveTo(x + width, y, x + width, y + radius);
 shape.lineTo(x + width, y + height - radius); shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
 shape.lineTo(x + radius, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - radius);
 shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y);
 const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .006, bevelThickness: .006, bevelSegments: 2, steps: 1, curveSegments: 4 });
 geometry.translate(0, 0, -depth / 2); return geometry;
}
function seats(group, rows, color) {
 const concrete = rows === 4 ? photoSurface(mat(0xd8b17d, .78), 'oak_wood_planks', 2) : photoSurface(mat(0xd1d1ca, .92), 'concrete_floor', 2.08), material = mat(color, .57), count = rows * 68 * 2;
 const seat = seatGeometry(.45, .43, .055, .065); seat.rotateX(-Math.PI / 2);
 const mesh = new THREE.InstancedMesh(seat, material, count);
 const backs = new THREE.InstancedMesh(seatGeometry(.45, .37, .05, .06), material, count);
 const supports = new THREE.InstancedMesh(new THREE.BoxGeometry(.055, .25, .38), mat(0x343d3c, .5, .6), count);
 const matrix = new THREE.Matrix4(), dummy = new THREE.Object3D(); let n = 0;
 for (const side of [-1, 1]) for (let r = 0; r < rows; r++) {
  const spans = rows === 4 ? [[-23, -15.05], [-13.95, -.55], [.55, 13.95], [15.05, 23]] : [[-23, 23]];
  for (const [start, end] of spans) box(group, [end - start, .45 + r * .52, .86], [(start + end) / 2, (.45 + r * .52) / 2, side * (13 + r * .88)], concrete);
  for (let col = 0; col < 68; col++) {
   const x = -22 + col * .65, y = .62 + r * .52, z = side * (13 + r * .88);
   if (rows === 4 && [-14.5, 0, 14.5].some(aisle => Math.abs(x - aisle) < .83)) continue;
   matrix.makeTranslation(x, y, z); mesh.setMatrixAt(n, matrix);
   matrix.makeTranslation(x, y - .13, z); supports.setMatrixAt(n, matrix);
   const shade = new THREE.Color().setScalar(.88 + ((col * 7 + r * 3) % 11) * .021);
   mesh.setColorAt(n, shade); backs.setColorAt(n, shade);
   dummy.position.set(x, y + .2, z + side * .2); dummy.rotation.x = side * -.12; dummy.updateMatrix(); backs.setMatrixAt(n++, dummy.matrix);
  }
 }
 mesh.count = backs.count = supports.count = n;
 mesh.receiveShadow = backs.receiveShadow = supports.receiveShadow = true; mesh.castShadow = backs.castShadow = true; group.add(mesh, backs, supports);
}
function boardTexture() {
 const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 128; const c = canvas.getContext('2d'); c.fillStyle = '#14283e'; c.fillRect(0, 0, 2048, 128); c.fillStyle = '#d6e4f4'; c.font = 'bold 44px sans-serif'; for (let i = 0; i < 4; i++) c.fillText('TAKE A  /  FUTSAL', 35 + i * 512, 81); const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function createEnvironment(scene, renderer) {
 const root = new THREE.Group(); scene.add(root);
 const wood = texture('wood'), grass = texture('grass');
 const courtMaterial = new THREE.MeshPhysicalMaterial({ map: wood, roughness: .29, clearcoat: .65, clearcoatRoughness: .23 });
 const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), courtMaterial); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; root.add(floor);
 const apron = box(root, [48, .15, 27], [0, -.095, 0], photoSurface(mat(0x8d9390, .9), 'concrete_floor', 2.08)); markings(root); const updateNet = goal(root, 1); goal(root, -1);
 const indoor = new THREE.Group(), outdoor = new THREE.Group(), stadium = new THREE.Group(); root.add(indoor, outdoor, stadium);
 const roof = new THREE.Group(); indoor.add(roof);
 const green = mat(0x1e3a3f, .82), pilasterDark = mat(0x0e1113, .5, .3), capRail = mat(0x0d1012, .5), skirt = mat(0x050607, .85);
 const wall = photoSurface(mat(0xefe9da, .94), 'grey_plaster', 2.5), steel = photoSurface(mat(0x999f9b, .65, .55), 'metal_plate', .5), panels = photoSurface(mat(0xffffff, .75), 'oak_wood_planks', 2);
 for (const s of [-1, 1]) {
  box(indoor, [50, 9, .25], [0, 4.5, s * 19], wall); box(indoor, [.25, 9, 38], [s * 25, 4.5, 0], wall);
  box(indoor, [50, 2.6, .15], [0, 1.3, s * 18.8], green); box(indoor, [50, .04, .18], [0, 2.62, s * 18.78], capRail); box(indoor, [50, .24, .2], [0, .12, s * 18.76], skirt);
  for (let x = -22; x <= 22; x += 4) { box(indoor, [.28, 10, .28], [x, 5, s * 18.4], pilasterDark); box(indoor, [2.9, 2.2, .09], [x, 6, s * 18.8], new THREE.MeshStandardMaterial({ color: 0xb4c5c7, emissive: 0xb4c5c7, emissiveIntensity: .35, roughness: .24, metalness: .18 })); }
 }
 for (let x = -24; x <= 24; x += 6) { tube(roof, [x, 9, -19], [x, 11, 0], .09, steel); tube(roof, [x, 11, 0], [x, 9, 19], .09, steel); tube(roof, [x, 9, -19], [x, 9, 19], .06, steel); }
 seats(indoor, 4, 0xb8824a); seats(stadium, 13, 0x31537c);
 // Roof, acoustic battens, safety rails and inset doors give the hall real scale.
 const roofMaterial = mat(0x6e5540, .85), railMaterial = mat(0xa8afb2, .32, .7);
 const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(50, 38), roofMaterial);
 // Render the underside only so orbiting above the venue gives a cutaway view.
 ceiling.rotation.x = Math.PI / 2; ceiling.position.y = 11.2;
 ceiling.castShadow = ceiling.receiveShadow = true; roof.add(ceiling);
 for (let x = -24; x <= 24; x += 2) box(roof, [.055, .13, 38], [x, 11.05, 0], steel);
 for (const s of [-1, 1]) {
  for (let x = -24; x < 24; x += 1.2) box(indoor, [.02, 2.6, .03], [x, 1.3, s * 18.7], mat(0x0a1214, .9));
  tube(indoor, [-22.5, 1.05, s * 12.45], [22.5, 1.05, s * 12.45], .025, railMaterial);
  for (let x = -22.5; x <= 22.5; x += 3) tube(indoor, [x, .1, s * 12.45], [x, 1.05, s * 12.45], .025, railMaterial);
  for (const z of [-8, 8]) {
   box(indoor, [.12, 2.5, 1.75], [s * 24.57, 1.25, z], steel);
   box(indoor, [.13, 2.3, 1.55], [s * 24.47, 1.15, z], mat(0x455965, .62));
   tube(indoor, [s * 24.35, 1.05, z - .5], [s * 24.35, 1.05, z + .5], .025, railMaterial);
   box(indoor, [.12, .22, .7], [s * 24.45, 2.8, z], new THREE.MeshBasicMaterial({ color: 0x66ba92 }));
  }
 }
 addHallDetails({ indoor, roof, box, tube, steel });
 const ad = new THREE.MeshBasicMaterial({ map: boardTexture() });
 for (const s of [-1, 1]) {
  box(stadium, [46, .8, .08], [0, .45, s * 11.9], ad);
  box(stadium, [49, .18, 8], [0, 10, s * 20], steel);
  box(stadium, [50, 1.1, .14], [0, 9.8, s * 24], mat(0x24364d));
 }
 const ground = box(outdoor, [100, .08, 90], [0, -.17, 0], photoSurface(mat(0xffffff, 1), 'leafy_grass', 2));
 const fence = new THREE.Group(); outdoor.add(fence); const netPoints = [];
 for (const z of [-13.5, 13.5]) {
  for (let x = -24; x <= 24; x += 3) tube(fence, [x, 0, z], [x, 4, z], .035, steel);
  for (let x = -24; x <= 24; x += .3) netPoints.push(x, 0, z, x, 4, z);
  for (let y = .3; y < 4; y += .3) netPoints.push(-24, y, z, 24, y, z);
 }
 const netGeo = new THREE.BufferGeometry(); netGeo.setAttribute('position', new THREE.Float32BufferAttribute(netPoints, 3)); fence.add(new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: 0x899795, transparent: true, opacity: .25 })));
 // The outdoor tree line comes from the photographed HDRI.
 const hemi = new THREE.HemisphereLight(0xdbe7ff, 0x484136, 1.6); scene.add(hemi);
 const sun = new THREE.DirectionalLight(0xffebce, 3); sun.position.set(-10, 18, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 21, bottom: -21, near: .1, far: 70 }); sun.shadow.bias = -.0003; sun.shadow.normalBias = .025; scene.add(sun);
 const lamps = [];
 for (const x of [-16, 16]) for (const z of [-12, 12]) {
  const light = new THREE.SpotLight(0xcce3ff, 550, 60, .8, .7, 2); light.position.set(x, 13, z); light.target.position.set(x * .5, 0, 0); scene.add(light, light.target); lamps.push(light);
  tube(stadium, [x, 0, z], [x, 13, z], .075, steel); box(stadium, [1.4, .12, .55], [x, 13, z], new THREE.MeshBasicMaterial({ color: 0xe3f3ff }));
 }
 const envScene = new THREE.Scene(); const room = new THREE.Mesh(new THREE.BoxGeometry(60, 30, 60), new THREE.MeshBasicMaterial({ color: 0x7c8a9a, side: THREE.BackSide })); envScene.add(room);
 for (const x of [-12, 12]) { const panel = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4), side: THREE.DoubleSide })); panel.position.set(x, 12, 0); panel.rotation.x = Math.PI / 2; envScene.add(panel); }
 const pmrem = new THREE.PMREMGenerator(renderer), environment = pmrem.fromScene(envScene, .06); scene.environment = environment.texture; pmrem.dispose(); envScene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
 const enhanced = enhanceMaterials({ scene, renderer, root, indoor, stadium, ground, floor, material: courtMaterial, hemi, sun, lamps });
 function set(type) {
  apron.visible = type !== 'stadium';
  indoor.visible = type === 'indoor'; outdoor.visible = type === 'outdoor'; stadium.visible = type === 'stadium';
  courtMaterial.map = type === 'indoor' ? wood : grass; courtMaterial.roughness = type === 'indoor' ? .3 : .91; courtMaterial.clearcoat = type === 'indoor' ? .65 : 0; courtMaterial.needsUpdate = true;
  const color = type === 'outdoor' ? 0xb8d1e0 : type === 'stadium' ? 0x091321 : 0x4d5864; scene.background = new THREE.Color(color); scene.fog = new THREE.Fog(color, type === 'stadium' ? 24 : 45, type === 'stadium' ? 95 : 140);
  hemi.intensity = type === 'stadium' ? .55 : type === 'outdoor' ? 2.1 : 1.5; sun.intensity = type === 'stadium' ? .5 : type === 'outdoor' ? 3.2 : 2.2; lamps.forEach(l => l.intensity = type === 'outdoor' ? 0 : type === 'stadium' ? 850 : 280);
  enhanced.set(type);
 }
 set('indoor'); return { set, updateNet, ready: enhanced.ready, quality: enhanced.quality, view(type) { roof.visible = type !== 'top' && type !== 'wide'; } };
}
