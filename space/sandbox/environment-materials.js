import * as THREE from 'three';
import { RGBELoader } from './assets/environment/RGBELoader.js';
import { Reflector } from './assets/environment/Reflector.js';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { loadPhotoSurfaces } from './photo-surfaces.js';
import { createPhotographicGrass } from './photographic-grass.js';

// Local, checksum-verified CC0 scans from Poly Haven; no runtime external calls.
export function enhanceMaterials({ scene, renderer, root, indoor, stadium, ground, floor, material, hemi, sun, lamps }) {
 const path = './assets/environment/';
 const textures = {}, radiance = {}, environments = {};
 let current = 'indoor', high = true;
 const grassBlades = createPhotographicGrass(root, renderer);
 const stadiumTurf = new THREE.Mesh(new THREE.PlaneGeometry(112, 74), new THREE.MeshStandardMaterial({ color: 0xb7caa0, roughness: 1 }));
 stadiumTurf.rotation.x = -Math.PI / 2; stadiumTurf.position.y = -.025; stadiumTurf.receiveShadow = true; stadiumTurf.visible = false; root.add(stadiumTurf);
 const shader = { ...Reflector.ReflectorShader,
  fragmentShader: Reflector.ReflectorShader.fragmentShader.replace(
   'gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );',
   'gl_FragColor = vec4( base.rgb, 0.035 );') };
 const reflection = new Reflector(new THREE.PlaneGeometry(48, 34), { textureWidth: 1024, textureHeight: 768, clipBias: .003, multisample: 0, shader });
 reflection.rotation.x = -Math.PI / 2; reflection.position.y = .004;
 reflection.material.transparent = true; reflection.material.depthWrite = false;
 root.add(reflection);
 const loadMap = async (key, name, color = false, grass = false) => {
  const map = await new THREE.TextureLoader().loadAsync(path + name);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(grass ? 40 / 1.4 : 48 / 1.942, grass ? 20 / 1.4 : 34 / 1.942);
  map.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  if (key === 'color') {
   // Preserve scanned grain while reducing the patchwork contrast of the raw scan.
   const canvas = document.createElement('canvas'); canvas.width = map.image.width; canvas.height = map.image.height;
   const ctx = canvas.getContext('2d'); ctx.drawImage(map.image, 0, 0);
   const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
   for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] = Math.min(255, pixels.data[i] * .62 + 224 * .42);
    pixels.data[i + 1] = Math.min(255, pixels.data[i + 1] * .62 + 186 * .42);
    pixels.data[i + 2] = Math.min(255, pixels.data[i + 2] * .62 + 124 * .42);
   }
   ctx.putImageData(pixels, 0, 0); map.image = canvas; map.needsUpdate = true;
  }
  textures[key] = map;
 };
 const loadHDR = async (type, name) => {
  const hdr = await new RGBELoader().loadAsync(path + name);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  environments[type] = pmrem.fromEquirectangular(hdr);
  pmrem.dispose(); radiance[type] = hdr;
 };
 const loadBenches = async () => {
  const { scene: bench } = await new GLTFLoader().loadAsync(path + 'bench/bench.gltf');
  let bounds = new THREE.Box3().setFromObject(bench);
  const size = bounds.getSize(new THREE.Vector3());
  if (size.z > size.x) bench.rotation.y = Math.PI / 2;
  bounds.setFromObject(bench); const center = bounds.getCenter(new THREE.Vector3());
  bench.position.set(-center.x, -bounds.min.y, -center.z);
  bench.traverse(object => { if (object.isMesh) object.castShadow = object.receiveShadow = true; });
  for (const side of [-1, 1]) for (const x of [-13, 13]) {
   const group = new THREE.Group(); group.add(bench.clone(true));
   group.position.set(x, 0, side * 11.3); group.rotation.y = side > 0 ? Math.PI : 0;
   indoor.add(group);
  }
  renderer.domElement.dataset.scannedBenches = '4';
 };
 function set(type) {
  current = type;
  grassBlades.set(type);
  stadiumTurf.visible = type === 'stadium' && !!textures.grassColor;
  const inside = type === 'indoor';
  material.color.set(inside ? 0xffffff : 0xb7caa0);
  floor.scale.set(inside ? 1.2 : 1, inside ? 1.7 : 1, 1);
  reflection.visible = inside && high && !!textures.color;
  if (inside && textures.color) {
   material.map = textures.color;
   material.normalMap = textures.normal || null;
   material.normalScale.set(.12, .12);
   material.roughnessMap = textures.rough || null;
   material.aoMap = null;
   material.roughness = .58; material.clearcoat = .32; material.clearcoatRoughness = .3;
  } else if (!inside && textures.grassColor) {
   material.map = textures.grassColor; material.normalMap = textures.grassNormal || null;
   material.normalScale.set(.45, .45); material.roughnessMap = null;
   material.aoMap = textures.grassAO || null; material.aoMapIntensity = .65;
   material.roughness = 1; material.clearcoat = 0;
  } else { material.normalMap = null; material.roughnessMap = null; material.aoMap = null; }
  material.envMapIntensity = type === 'stadium' ? .5 : 1;
  material.needsUpdate = true;
  if (environments[type]) scene.environment = environments[type].texture;
  if (!inside && radiance[type]) {
   scene.background = radiance[type];
   scene.backgroundIntensity = type === 'stadium' ? .65 : .8;
   scene.backgroundBlurriness = 0;
  } else { scene.backgroundIntensity = 1; scene.backgroundBlurriness = 0; }
  hemi.intensity = inside ? .5 : type === 'stadium' ? .5 : .65;
  sun.intensity = inside ? .85 : type === 'stadium' ? .8 : 2.4;
  // Let the real stadium panorama read beyond the playable pitch.
  stadium.visible = type === 'stadium' && !radiance.stadium;
  sun.color.set(inside ? 0xfff0df : 0xffe5c5);
  lamps.forEach(light => {
   light.position.y = inside ? 8.45 : 13;
   light.color.set(inside ? 0xfff1da : 0xcce3ff);
   light.intensity = inside ? 260 : type === 'stadium' ? 360 : 0;
  });
  renderer.domElement.dataset.environmentAssets = textures.color && environments[type] ? 'poly-haven' : 'fallback';
 }
 const ready = Promise.allSettled([
  loadMap('color', 'scans/oak_wood_planks-Diffuse.jpg', true), loadMap('normal', 'scans/oak_wood_planks-nor_gl.jpg'),
  loadMap('rough', 'scans/oak_wood_planks-Rough.jpg'),
  loadMap('grassColor', 'grass-Color.jpg', true, true), loadMap('grassNormal', 'grass-NormalGL.jpg', false, true),
  loadMap('grassRough', 'grass-Roughness.jpg', false, true), loadMap('grassAO', 'grass-AmbientOcclusion.jpg', false, true),
  loadHDR('indoor', 'school_hall.hdr'), loadHDR('outdoor', 'noon_grass.hdr'), loadHDR('stadium', 'scans/orlando_stadium.hdr'),
  loadBenches(), loadPhotoSurfaces(root, renderer), grassBlades.ready,
 ]).then(results => {
  const failures = results.filter(r => r.status === 'rejected');
  renderer.domElement.dataset.assetFailures = String(failures.length);
  if (failures.length) console.warn('Some environment assets unavailable', failures.map(r => r.reason));
  if (textures.grassColor) {
   const map = textures.grassColor.clone(); map.repeat.set(112 / 1.4, 74 / 1.4);
   stadiumTurf.material.map = map; stadiumTurf.material.needsUpdate = true;
  }
  set(current);
 });
 return { ready, set, quality(value) { high = value !== 'light'; grassBlades.quality(value); reflection.visible = current === 'indoor' && high && !!textures.color; } };
}
