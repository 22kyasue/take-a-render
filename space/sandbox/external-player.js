import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { retargetRotation, setWorldPose } from './player-retarget.js';
import { clone } from './assets/environment/SkeletonUtils.js';

import { playerMapping as mapping } from './player-mapping.js';
const templates = new Map();

const ends = { lShldrBend:'lForearmBend',rShldrBend:'rForearmBend',lForearmBend:'lHand',rForearmBend:'rHand',
 lThighBend:'lShin',rThighBend:'rShin',lShin:'lFoot',rShin:'rFoot',lFoot:'lToe',rFoot:'rToe',
 lHand:'lMid1',rHand:'rMid1' };
for (const side of ['l','r']) for (const finger of ['Thumb','Index','Mid','Ring','Pinky']) {
 for (let i=1;i<3;i++) ends[`${side}${finger}${i}`]=`${side}${finger}${i+1}`;
}
const position = object => object.getWorldPosition(new THREE.Vector3());
const rotation = object => object.getWorldQuaternion(new THREE.Quaternion());

export function captureMoveRest(source) {
 const sourceNodes = {};
 const names=[...new Set(Object.values(mapping))];
 source.updateWorldMatrix(true,true);
 source.traverse(object => { if (!object.isMesh && !object.name.startsWith('visual')) { const name=names.find(name=>object.name.endsWith(name)); if(name) sourceNodes[name]=object; } });
 const sourceRest = Object.fromEntries(Object.entries(sourceNodes).map(([name,bone]) => [name,{p:position(bone),q:rotation(bone)}]));
 return {sourceNodes,sourceRest};
}

export async function attachExternalPlayer({ group, source, bind, color, variant = 'geek3dom' }) {
 const {sourceNodes,sourceRest}=bind;
 const url = variant === 'studio' ? './assets/players/studio-player.glb' : './assets/players/geek3dom-player.glb';
 if (!templates.has(url)) templates.set(url, new GLTFLoader().loadAsync(url));
 const model = clone((await templates.get(url)).scene);
 const wrapper = new THREE.Group(); wrapper.name='external-player'; wrapper.add(model);
 const bones = {}; model.traverse(object => { if(object.isBone) bones[object.name]=object; });
 for(const name of Object.keys(mapping)) {
  if(!bones[name] || !sourceRest[mapping[name]]) throw new Error(`Player joint unavailable: ${name}`);
 }
 wrapper.updateMatrixWorld(true);
 const srcSpan = sourceRest.LeftArm.p.distanceTo(sourceRest.RightArm.p);
 const dstSpan = position(bones.lShldrBend).distanceTo(position(bones.rShldrBend));
 if(!(srcSpan>.05 && dstSpan>.05)) throw new Error('Invalid player shoulder span');
 wrapper.scale.setScalar(srcSpan/dstSpan);
 wrapper.updateMatrixWorld(true);
 wrapper.position.copy(sourceRest.Hips.p).sub(position(bones.hip));
 wrapper.updateMatrixWorld(true);
 const targetRest = Object.fromEntries(Object.entries(bones).map(([name,bone]) => [name,{p:position(bone),q:rotation(bone)}]));
 const links = [];
 model.traverse(bone => {
  const src = mapping[bone.name]; if(!src || !sourceNodes[src]) return;
  const end = ends[bone.name], align = new THREE.Quaternion();
  if(end && targetRest[end] && sourceRest[mapping[end]]) {
   const from=targetRest[end].p.clone().sub(targetRest[bone.name].p).normalize();
   const to=sourceRest[mapping[end]].p.clone().sub(sourceRest[src].p).normalize();
   align.setFromUnitVectors(from,to);
  }
  links.push({bone,src:sourceNodes[src],rest:sourceRest[src].q,target:targetRest[bone.name].q,align});
 });
 model.traverse(object => {
  if(!object.isMesh) return;
  object.castShadow=true; object.receiveShadow=true; object.frustumCulled=false;
  object.material=Array.isArray(object.material)?object.material.map(mat=>mat.clone()):object.material.clone();
  for(const mat of Array.isArray(object.material)?object.material:[object.material]) {
   mat.metalness=0;
   if(mat.name.startsWith('T-Shirt') || mat.name === 'Studio Jersey') {
    mat.onBeforeCompile=shader=>{
     shader.uniforms.teamColor={value:new THREE.Color(color)};
     shader.fragmentShader='uniform vec3 teamColor;\n'+shader.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\n diffuseColor.rgb = vec3(max(max(diffuseColor.r,diffuseColor.g),diffuseColor.b)) * teamColor;');
    };
    mat.customProgramCacheKey=()=> 'team-shirt-v1';
   }
  }
 });
 const oldMeshes=[]; source.traverse(object=>{if(object.isMesh) oldMeshes.push(object);});
 const api = {
  setVisible(value) { wrapper.visible=value; for(const mesh of oldMeshes) mesh.visible=!value; },
  update() {
   let wristError=0;
   for(const link of links) {
    const p=position(link.src);
    // MOVE's clavicle roots share the neck origin. Keep the human collar
    // roots slightly lateral and the neck above the shoulder line.
    if(link.bone.name === 'lCollar' || link.bone.name === 'rCollar') {
     p.lerp(position(sourceNodes[link.bone.name === 'lCollar' ? 'LeftArm' : 'RightArm']), .25);
    }
    if(link.bone.name === 'neckLower') p.lerp(position(sourceNodes.Head), .4);
    const q=retargetRotation(rotation(link.src),link.rest,link.target,link.align);
    setWorldPose(link.bone,p,q);
    if(/^[lr]Hand$/.test(link.bone.name)) wristError=Math.max(wristError,position(link.bone).distanceTo(p));
   }
   return wristError;
  },
 };
 // Attach only after initialization succeeds: a failure leaves the MOVE view intact.
 group.add(wrapper);
 api.setVisible(true);
 return api;
}
