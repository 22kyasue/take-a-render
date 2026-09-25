import * as THREE from '../vendor/three.module.js';

export const LIMBS = [
 ['LeftArm', 'LeftForeArm', 5, 7], ['LeftForeArm', 'LeftHand', 7, 9],
 ['RightArm', 'RightForeArm', 6, 8], ['RightForeArm', 'RightHand', 8, 10],
 ['LeftUpLeg', 'LeftLeg', 11, 13], ['LeftLeg', 'LeftFoot', 13, 15],
 ['RightUpLeg', 'RightLeg', 12, 14], ['RightLeg', 'RightFoot', 14, 16],
];

const position = bone => bone.getWorldPosition(new THREE.Vector3());
const midpoint = (a, b) => a.clone().add(b).multiplyScalar(.5);

// Rotate in world space, then convert back through the animated parent.
export function aimBone(bone, current, desired, weight = 1) {
 if (current.lengthSq() < 1e-10 || desired.lengthSq() < 1e-10 || weight <= 0) return;
 const delta = new THREE.Quaternion().setFromUnitVectors(current.clone().normalize(), desired.clone().normalize());
 delta.slerp(new THREE.Quaternion(), 1 - THREE.MathUtils.clamp(weight, 0, 1));
 const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
 const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
 bone.quaternion.copy(parent.invert().multiply(world));
 bone.updateWorldMatrix(false, true);
}

export function directionError(joints, points) {
 const errors = LIMBS.map(([a, b, i, j]) => {
  const current = position(joints[b]).sub(position(joints[a]));
  const target = points[j].clone().sub(points[i]);
  return current.angleTo(target) * 180 / Math.PI;
 });
 return errors.reduce((sum, value) => sum + value, 0) / errors.length;
}

export function applyFourViewPose(joints, points, views, strength = 1) {
 // End-effector orientation has no four-view toe/finger observation. Keep
 // MOVE foot orientation; fingers retain their original local animation.
 const feet = ['LeftFoot', 'RightFoot'].map(name => [name, joints[name].getWorldQuaternion(new THREE.Quaternion())]);
 const hip = midpoint(position(joints.LeftUpLeg), position(joints.RightUpLeg));
 const shoulder = midpoint(position(joints.LeftArm), position(joints.RightArm));
 const targetUp = midpoint(points[5], points[6]).sub(midpoint(points[11], points[12]));
 const torsoViews = Math.min(...[5, 6, 11, 12].map(i => views[i] ?? 0));
 aimBone(joints.Spine, shoulder.sub(hip), targetUp, torsoViews >= 2 ? strength : 0);
 for (const [start, end, a, b] of LIMBS) {
  // One camera cannot constrain depth. Fall back to the MOVE prior there.
  const supported = Math.min(views[a] ?? 0, views[b] ?? 0) >= 2;
  aimBone(joints[start], position(joints[end]).sub(position(joints[start])), points[b].clone().sub(points[a]), supported ? strength : 0);
 }
 for (const [name, rotation] of feet) {
  const bone = joints[name];
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  bone.updateWorldMatrix(false, true);
 }
}
