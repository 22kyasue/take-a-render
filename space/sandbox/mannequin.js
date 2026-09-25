import * as THREE from 'three';

const JOINT_NAMES = [
  'pelvis', 'spine', 'neck',
  'shoulderL', 'shoulderR', 'elbowL', 'elbowR',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR',
];

function applyEuler(object, rotation = [0, 0, 0]) {
  object.rotation.set(rotation[0], rotation[1], rotation[2]);
}

function createSegment(length, radiusTop, radiusBottom, material, analysisMaterial) {
  const pivot = new THREE.Group();
  const geometry = new THREE.CylinderGeometry(radiusBottom, radiusTop, length, 16);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  pivot.add(mesh);

  const analysis = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusBottom + 0.018, radiusTop + 0.018, length, 10),
    analysisMaterial,
  );
  analysis.position.copy(mesh.position);
  analysis.visible = false;
  pivot.add(analysis);
  pivot.userData.analysisMesh = analysis;
  return pivot;
}

function createMarker(material, size = 0.075) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 12), material);
  marker.visible = false;
  marker.renderOrder = 5;
  return marker;
}

export function createMannequin({ color, accentColor, label }) {
  const group = new THREE.Group();
  group.name = label;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.54,
    metalness: 0.04,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.62),
    roughness: 0.62,
    metalness: 0.02,
  });
  const skinMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9bdc8,
    roughness: 0.66,
  });
  const analysisMaterial = new THREE.MeshBasicMaterial({
    color: accentColor,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
  });

  const joints = Object.fromEntries(JOINT_NAMES.map((name) => [name, new THREE.Group()]));
  const analysisObjects = [];

  group.add(joints.pelvis);
  joints.pelvis.position.y = 1.02;

  const pelvisMesh = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.28, 0.3), darkMaterial);
  pelvisMesh.position.y = 0.04;
  pelvisMesh.castShadow = true;
  joints.pelvis.add(pelvisMesh);

  joints.pelvis.add(joints.spine);
  joints.spine.position.y = 0.18;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.31, 0.54, 8, 18), bodyMaterial);
  torso.position.y = 0.42;
  torso.scale.set(1.18, 1, 0.78);
  torso.castShadow = true;
  joints.spine.add(torso);

  joints.spine.add(joints.neck);
  joints.neck.position.y = 0.83;
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.12, 0.16, 14), skinMaterial);
  neckMesh.position.y = 0.08;
  joints.neck.add(neckMesh);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.205, 20, 18), skinMaterial);
  head.scale.set(0.82, 1.08, 0.88);
  head.position.y = 0.31;
  head.castShadow = true;
  joints.neck.add(head);

  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? -1 : 1;
    const shoulder = joints[`shoulder${side}`];
    const elbow = joints[`elbow${side}`];
    joints.spine.add(shoulder);
    shoulder.position.set(sign * 0.43, 0.67, 0);
    shoulder.add(createSegment(0.52, 0.13, 0.105, bodyMaterial, analysisMaterial));
    shoulder.add(elbow);
    elbow.position.y = -0.52;
    elbow.add(createSegment(0.46, 0.105, 0.075, darkMaterial, analysisMaterial));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 12), skinMaterial);
    hand.position.y = -0.5;
    hand.scale.set(0.78, 1.18, 0.72);
    elbow.add(hand);

    const hip = joints[`hip${side}`];
    const knee = joints[`knee${side}`];
    const ankle = joints[`ankle${side}`];
    joints.pelvis.add(hip);
    hip.position.set(sign * 0.2, -0.04, 0);
    hip.add(createSegment(0.61, 0.16, 0.125, bodyMaterial, analysisMaterial));
    hip.add(knee);
    knee.position.y = -0.61;
    knee.add(createSegment(0.57, 0.125, 0.09, darkMaterial, analysisMaterial));
    knee.add(ankle);
    ankle.position.y = -0.57;
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.22, 5, 12), darkMaterial);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(0, -0.055, 0.13);
    foot.scale.set(1.05, 1, 0.84);
    foot.castShadow = true;
    ankle.add(foot);
  }

  for (const joint of Object.values(joints)) {
    const marker = createMarker(analysisMaterial, joint === joints.pelvis ? 0.085 : 0.068);
    joint.add(marker);
    analysisObjects.push(marker);
    joint.traverse((object) => {
      if (object.userData.analysisMesh) analysisObjects.push(object.userData.analysisMesh);
    });
  }

  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 128;
  const context = labelCanvas.getContext('2d');
  context.fillStyle = 'rgba(8, 11, 18, 0.78)';
  context.beginPath();
  context.roundRect(8, 8, 496, 112, 32);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = '700 46px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 256, 64);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: labelTexture,
    transparent: true,
    depthTest: false,
  }));
  labelSprite.position.set(0, 2.55, 0);
  labelSprite.scale.set(1.5, 0.375, 1);
  group.add(labelSprite);

  function applyPose(pose) {
    group.position.set(pose.root.x, pose.root.y, pose.root.z);
    group.rotation.y = pose.root.yaw;
    for (const [name, rotation] of Object.entries(pose.joints)) {
      applyEuler(joints[name], rotation);
    }
  }

  function setAnalysisVisible(visible) {
    for (const object of analysisObjects) object.visible = visible;
  }

  function getFocusPosition() {
    const world = new THREE.Vector3();
    joints.spine.getWorldPosition(world);
    world.y += 0.18;
    return world;
  }

  return { group, applyPose, setAnalysisVisible, getFocusPosition };
}

