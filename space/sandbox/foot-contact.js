import * as THREE from 'three';

const world = bone => bone.getWorldPosition(new THREE.Vector3());
function aim(bone, from, to) {
 if (from.lengthSq()<1e-12 || to.lengthSq()<1e-12) return;
 const rotation = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize()));
 bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
 bone.updateWorldMatrix(false,true);
}
// Rotate the existing leg chain: preserve lengths, root position and shoe angle.
function solveLeg(hip, knee, foot, target) {
 const a=world(hip), b=world(knee), c=world(foot), rotation=foot.getWorldQuaternion(new THREE.Quaternion());
 const upper=a.distanceTo(b), lower=b.distanceTo(c), axis=target.clone().sub(a);
 const distance=THREE.MathUtils.clamp(axis.length(),Math.abs(upper-lower)+1e-5,upper+lower-1e-5);
 axis.normalize(); target=a.clone().addScaledVector(axis,distance);
 const bend=b.clone().sub(a).addScaledVector(axis,-b.clone().sub(a).dot(axis));
 if(bend.lengthSq()<1e-10) return;
 bend.normalize();
 const along=(upper*upper-lower*lower+distance*distance)/(2*distance);
 const desiredKnee=a.clone().addScaledVector(axis,along).addScaledVector(bend,Math.sqrt(Math.max(0,upper*upper-along*along)));
 aim(hip,b.clone().sub(a),desiredKnee.sub(a));
 aim(knee,world(foot).sub(world(knee)),target.sub(world(knee)));
 foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation)); foot.updateWorldMatrix(false,true);
}

export function createFootContact(group,joints) {
 const feet=['Left','Right'].map((side,index)=>{
  const meshes=[];
  group.traverse(o=>{if(o.isSkinnedMesh && o.name.includes(`${index===0?'L':'R'}_Foot_link`)) meshes.push(o);});
  return {hip:joints[side+'UpLeg'],knee:joints[side+'Leg'],foot:joints[side+'Foot'],meshes};
 });
 function sole(entry) {
  let y=Infinity; const v=new THREE.Vector3();
  for(const mesh of entry.meshes) {
   mesh.skeleton.update();
   for(let i=0;i<mesh.geometry.attributes.position.count;i++) {
    mesh.getVertexPosition(i,v).applyMatrix4(mesh.matrixWorld); y=Math.min(y,v.y);
   }
  }
  return Number.isFinite(y)?y:null;
 }
 const measure=()=>feet.map(sole);
 return {measure,apply(){
  const before=measure();
  feet.forEach((entry,i)=>{
   const y=before[i];
   if(y===null || y>.14 || y<-.12) return;
   // Full contact near the floor, smoothly fade out for lifted/swinging feet.
   const weight=1-THREE.MathUtils.smoothstep(y,.035,.14);
   const shift=THREE.MathUtils.clamp((.008-y)*weight,-.09,.09);
   if(Math.abs(shift)<1e-5) return;
   const target=world(entry.foot); target.y+=shift;
   solveLeg(entry.hip,entry.knee,entry.foot,target);
  });
  return {before,after:measure()};
 }};
}
