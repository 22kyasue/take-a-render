// Pure pose adapters. Inputs belong to the original MOVE rig and remain read-only.
export function retargetRotation(current, sourceRest, targetRest, alignment) {
 return current.clone().multiply(sourceRest.clone().invert()).multiply(alignment).multiply(targetRest);
}

export function setWorldPose(bone, position, rotation) {
 bone.parent.updateWorldMatrix(true, false);
 bone.position.copy(bone.parent.worldToLocal(position.clone()));
 bone.quaternion.copy(bone.parent.getWorldQuaternion(rotation.clone()).invert().multiply(rotation));
 bone.updateMatrixWorld(true);
}
