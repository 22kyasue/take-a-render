import * as THREE from 'three';

export function photoSurface(material, asset, metres = 2) {
 material.userData.photoSurface = { asset, metres };
 return material;
}

// World-space metres keep photographed grain the same size on every instance,
// including the long thin wall panels and the individual stair treads.
export async function loadPhotoSurfaces(root, renderer) {
 const materials = new Set();
 root.traverse(object => {
  for (const material of [object.material].flat()) if (material?.userData.photoSurface) materials.add(material);
 });
 const cache = new Map(), loader = new THREE.TextureLoader();
 const load = (asset, suffix) => {
  const key = `${asset}-${suffix}`;
  if (!cache.has(key)) cache.set(key, loader.loadAsync(`./assets/environment/scans/${key}.jpg`).then(texture => {
   texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
   texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
   if (suffix === 'Diffuse') texture.colorSpace = THREE.SRGBColorSpace;
   return texture;
  }));
  return cache.get(key);
 };
 await Promise.all([...materials].map(async material => {
  const { asset, metres } = material.userData.photoSurface;
  const [map, normalMap, roughnessMap] = await Promise.all(['Diffuse', 'nor_gl', 'Rough'].map(suffix => load(asset, suffix)));
  material.map = map; material.normalMap = normalMap; material.roughnessMap = roughnessMap;
  material.normalScale.set(.38, .38);
  material.onBeforeCompile = shader => {
   shader.uniforms.photoMetres = { value: metres };
   shader.vertexShader = 'varying vec3 photoPosition; varying vec3 photoNormal;\n' + shader.vertexShader;
   shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
    vec4 photoWorld = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
     photoWorld = instanceMatrix * photoWorld;
    #endif
    photoPosition = (modelMatrix * photoWorld).xyz;
    photoNormal = inverseTransformDirection(transformedNormal, viewMatrix);`);
   shader.fragmentShader = 'varying vec3 photoPosition; varying vec3 photoNormal; uniform float photoMetres;\n' + shader.fragmentShader;
   shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
    vec3 photoAxis = abs(normalize(photoNormal));
    vec2 photoUv = photoAxis.y > max(photoAxis.x, photoAxis.z) ? photoPosition.xz : (photoAxis.x > photoAxis.z ? photoPosition.zy : photoPosition.xy);
    photoUv /= photoMetres;
    ${THREE.ShaderChunk.map_fragment.replaceAll('vMapUv', 'photoUv')}`);
   for (const [chunk, uv] of [['normal_fragment_begin', 'vNormalMapUv'], ['normal_fragment_maps', 'vNormalMapUv'], ['roughnessmap_fragment', 'vRoughnessMapUv']]) {
    shader.fragmentShader = shader.fragmentShader.replace(`#include <${chunk}>`, THREE.ShaderChunk[chunk].replaceAll(uv, 'photoUv'));
   }
  };
  material.customProgramCacheKey = () => 'photo-world-uv-v1';
  material.needsUpdate = true;
 }));
 renderer.domElement.dataset.photoMaterials = String(materials.size);
}
