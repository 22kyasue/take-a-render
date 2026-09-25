import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';

export function createPhotographicGrass(root, renderer) {
 const group = new THREE.Group(); root.add(group); group.visible = false;
 let current = 'indoor', high = true;
 const ready = Promise.all([
  new GLTFLoader().loadAsync('./assets/environment/scans/bermuda/grass.gltf'),
  new THREE.TextureLoader().loadAsync('./assets/environment/scans/bermuda/textures/alpha.png'),
 ]).then(([{ scene }, alpha]) => {
  alpha.flipY = false;
  const variants = ['grass_bermuda_01_small_a', 'grass_bermuda_01_small_b', 'grass_bermuda_01_small_c'];
  let seed = 681;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const dummy = new THREE.Object3D();
  for (const name of variants) {
   const source = scene.getObjectByName(name);
   if (!source?.isMesh) throw new Error(`Missing grass mesh: ${name}`);
   const material = source.material.clone(); material.side = THREE.DoubleSide;
   material.alphaMap = alpha; material.alphaTest = .45;
   material.roughnessMap = null; material.roughness = .98; material.envMapIntensity = .65;
   material.normalScale.set(.3, .3);
   const mesh = new THREE.InstancedMesh(source.geometry, material, 16000);
   for (let i = 0; i < mesh.count; i++) {
    const x = random() * 39.8 - 19.9, z = random() * 19.8 - 9.9;
    dummy.position.set(x, .001, z); dummy.rotation.y = random() * Math.PI * 2;
    dummy.scale.setScalar(.7 + random() * .5); dummy.scale.y *= .75; dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    const shade = new THREE.Color().setScalar(.8 + random() * .35); mesh.setColorAt(i, shade);
   }
   mesh.receiveShadow = true; group.add(mesh);
  }
  renderer.domElement.dataset.grassTufts = '48000';
 });
 const set = type => { current = type; group.visible = type !== 'indoor' && high; };
 return { ready, set, quality(value) { high = value !== 'light'; set(current); } };
}
