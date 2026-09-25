import * as THREE from 'three';
import { photoSurface } from './photo-surfaces.js';

// Architectural detail only: no player, ball, court or collision coordinates.
export function addHallDetails({ indoor, roof, box, tube, steel }) {
 const finish = (color, roughness = .75, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
 const plaster = photoSurface(finish(0xe7e4da), 'grey_plaster', 2.5), dark = finish(0x394247, .48, .45);
 const aluminium = finish(0xa0a7a4, .35, .72), timber = photoSurface(finish(0xffffff), 'oak_wood_planks', 2);
 const rubber = finish(0x333c3a, .95), concrete = photoSurface(finish(0xd1d1ca, .92), 'concrete_floor', 2.08);
 const lens = new THREE.MeshStandardMaterial({ color: 0xf6f2df, emissive: 0xfff3db, emissiveIntensity: 2.1, roughness: .28 });
 const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
 const ctx = canvas.getContext('2d');
 ctx.fillStyle = '#c5c3b7'; ctx.fillRect(0, 0, 512, 512);
 // Recessed perforations: a shared texture avoids thousands of little meshes.
 ctx.fillStyle = '#85867b';
 for (let y = 8; y < 512; y += 16) for (let x = 8; x < 512; x += 16) { ctx.beginPath(); ctx.arc(x, y, 1.3, 0, Math.PI * 2); ctx.fill(); }
 const acousticMap = new THREE.CanvasTexture(canvas); acousticMap.colorSpace = THREE.SRGBColorSpace;
 acousticMap.wrapS = acousticMap.wrapT = THREE.RepeatWrapping; acousticMap.repeat.set(2, 1);
 const acoustic = new THREE.MeshStandardMaterial({ map: acousticMap, roughness: .95 });
 const initialIndoor = new Set(indoor.children), initialRoof = new Set(roof.children);
 for (const side of [-1, 1]) {
  // An actual gallery fascia, expansion joints and wall-mounted acoustic panels.
  box(indoor, [49.4, .15, .2], [0, 3.13, side * 18.7], aluminium);
  box(indoor, [49.4, .22, .15], [0, .11, side * 18.64], rubber);
  for (let x = -22; x <= 22; x += 4) {
   box(indoor, [3.65, 1.28, .12], [x, 3.94, side * 18.76], acoustic);
   box(indoor, [.035, 1.3, .14], [x, 3.94, side * 18.65], aluminium);
   // Window jambs, crossbars and projecting sill replace floating blue rectangles.
   for (const dx of [-1.5, 0, 1.5]) box(indoor, [.055, 2.3, .21], [x + dx, 6, side * 18.66], aluminium);
   for (const y of [4.85, 6, 7.15]) box(indoor, [3.05, .065, .21], [x, y, side * 18.66], aluminium);
   box(indoor, [3.2, .12, .4], [x, 4.8, side * 18.62], plaster);
   box(indoor, [.42, .22, .5], [x, .15, side * 18.35], concrete);
  }
  // End walls: timber impact lining, panel seams and a padded base.
  box(indoor, [.14, 3.1, 37.4], [side * 24.76, 1.55, 0], timber);
  box(indoor, [.18, .18, 37.4], [side * 24.64, .09, 0], rubber);
  for (let y = .32; y < 3.1; y += .24) box(indoor, [.025, .013, 37.4], [side * 24.67, y, 0], dark);
  for (let z = -18; z <= 18; z += 3) {
   box(indoor, [.04, 3.1, .024], [side * 24.65, 1.55, z], dark);
   box(indoor, [.13, 1.6, 2.8], [side * 24.72, 4.25, z], acoustic);
  }
  // Recessed service vents above the end-wall lining.
  for (const z of [-13, 0, 13]) {
   box(indoor, [.17, .7, 2.4], [side * 24.56, 6.3, z], dark);
   for (let y = 6.03; y < 6.6; y += .09) box(indoor, [.23, .028, 2.32], [side * 24.44, y, z], aluminium);
  }
  // Stepped aisles, with non-slip nosings, between the seating blocks.
  for (const x of [-14.5, 0, 14.5]) {
   for (let step = 0; step < 8; step++) {
    const h = .225 + step * .26, z = side * (12.65 + step * .44);
    box(indoor, [1.1, h, .44], [x, h / 2, z], concrete);
    box(indoor, [1.08, .018, .06], [x, h + .012, z - side * .17], rubber);
   }
  }
 }
 // Triangulated roof trusses, longitudinal bracing, suspended linear luminaires.
 for (let x = -24; x <= 24; x += 6) {
  for (let z = -18; z < 18; z += 3) {
   const top = 11 - Math.abs(z) * 2 / 19;
   tube(roof, [x, 9, z], [x, top, z], .038, steel);
   tube(roof, [x, 9, z], [x, 11 - Math.abs(z + 3) * 2 / 19, z + 3], .035, steel);
  }
 }
 for (const z of [-10, 0, 10]) {
  tube(roof, [-24, 10.75, z], [24, 10.75, z], .055, aluminium);
  for (const x of [-18, -9, 0, 9, 18]) {
   for (const dx of [-1.1, 1.1]) tube(roof, [x + dx, 10.75, z], [x + dx, 8.75, z], .009, dark);
   box(roof, [2.65, .16, .36], [x, 8.67, z], dark);
   box(roof, [2.5, .025, .27], [x, 8.575, z], lens);
  }
 }
 // A fixed venue clock/scoreboard: architectural equipment, not playback UI.
 const board = document.createElement('canvas'); board.width = 1024; board.height = 384;
 const b = board.getContext('2d'); b.fillStyle = '#101918'; b.fillRect(0, 0, 1024, 384);
 b.textAlign = 'center'; b.fillStyle = '#9aa8a1'; b.font = '28px sans-serif';
 b.fillText('HOME', 180, 75); b.fillText('GUEST', 844, 75); b.fillText('PERIOD', 512, 310);
 b.fillStyle = '#e8b957'; b.font = '100px monospace'; b.fillText('0', 180, 210); b.fillText('0', 844, 210); b.fillText('20:00', 512, 195);
 b.fillStyle = '#9aa8a1'; b.font = '35px monospace'; b.fillText('1', 512, 358);
 const boardMap = new THREE.CanvasTexture(board); boardMap.colorSpace = THREE.SRGBColorSpace;
 box(indoor, [.2, 2.15, 5.7], [-24.5, 7.15, 0], dark);
 const face = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.95), new THREE.MeshBasicMaterial({ map: boardMap }));
 face.rotation.y = Math.PI / 2; face.position.set(-24.38, 7.15, 0); indoor.add(face);
 // Batch repeated architectural parts into one draw per material/primitive.
 // Only meshes owned by this module are included; goals and nets stay untouched.
 for (const [group, initial] of [[indoor, initialIndoor], [roof, initialRoof]]) {
  const batches = new Map();
  for (const mesh of group.children) {
   if (initial.has(mesh) || !mesh.isMesh || mesh === face) continue;
   const kind = mesh.geometry.type;
   if (kind !== 'BoxGeometry' && kind !== 'CylinderGeometry') continue;
   const key = `${mesh.material.uuid}:${kind}`;
   if (!batches.has(key)) batches.set(key, []);
   batches.get(key).push(mesh);
  }
  for (const meshes of batches.values()) {
   const isBox = meshes[0].geometry.type === 'BoxGeometry';
   const geometry = isBox ? new THREE.BoxGeometry(1, 1, 1) : new THREE.CylinderGeometry(1, 1, 1, 8);
   const batch = new THREE.InstancedMesh(geometry, meshes[0].material, meshes.length);
   meshes.forEach((mesh, i) => {
    const p = mesh.geometry.parameters;
    mesh.scale.set(isBox ? p.width : p.radiusTop, p.height, isBox ? p.depth : p.radiusBottom);
    mesh.updateMatrix(); batch.setMatrixAt(i, mesh.matrix); group.remove(mesh); mesh.geometry.dispose();
   });
   batch.castShadow = batch.receiveShadow = true; group.add(batch);
  }
 }
}
