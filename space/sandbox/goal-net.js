import * as THREE from 'three';
import { netOffset, netRestPoint } from './goal-response.js';

// Opaque round cords catch the venue lighting, unlike screen-space wire lines.
export function createGoalNet(group, points, side) {
 const material = new THREE.MeshStandardMaterial({ color: 0xe6e1ce, roughness: .92 });
 const cords = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), material, points.length / 6);
 cords.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 cords.castShadow = true; cords.receiveShadow = true;
 // Deformation remains within the goal; avoid stale instance bounds on seeks.
 cords.frustumCulled = false;
 group.add(cords);
 const rest = [], originals = [];
 for (let i = 0; i < points.length; i += 3) {
  const p = [points[i + 2], points[i + 1], 20 - side * points[i]];
  originals.push(p); rest.push(netRestPoint(p));
 }
 const unique = new Map();
 originals.forEach((p, i) => unique.set(p.map(v => v.toFixed(4)).join(','), i));
 const knots = new THREE.InstancedMesh(new THREE.SphereGeometry(.004, 5, 4), material, unique.size);
 knots.instanceMatrix.setUsage(THREE.DynamicDrawUsage); knots.frustumCulled = false;
 group.add(knots);
 const dummy = new THREE.Object3D(), a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
 let wasActive = true;
 const update = (impacts, time) => {
  const active = side === 1 && impacts.some(hit => time > hit.time && time - hit.time < 2);
  if (!active && !wasActive) return 0;
  wasActive = active;
  let maximum = 0;
  const positions = rest.map((p, i) => {
   const delta = active ? netOffset(originals[i], impacts, time) : [0, 0, 0];
   maximum = Math.max(maximum, Math.hypot(...delta));
   return [side * (20 - p[2] - delta[2]), p[1] + delta[1], p[0] + delta[0]];
  });
  for (let i = 0; i < positions.length; i += 2) {
   a.fromArray(positions[i]); b.fromArray(positions[i + 1]);
   dummy.position.copy(a).add(b).multiplyScalar(.5);
   b.sub(a); const length = b.length();
   dummy.quaternion.setFromUnitVectors(up, b.normalize());
   dummy.scale.set(.0022, length, .0022); dummy.updateMatrix();
   cords.setMatrixAt(i / 2, dummy.matrix);
  }
  let index = 0;
  dummy.quaternion.identity(); dummy.scale.setScalar(1);
  for (const i of unique.values()) {
   dummy.position.fromArray(positions[i]); dummy.updateMatrix(); knots.setMatrixAt(index++, dummy.matrix);
  }
  cords.instanceMatrix.needsUpdate = true; knots.instanceMatrix.needsUpdate = true;
  return maximum;
 };
 update([], 0);
 return update;
}
