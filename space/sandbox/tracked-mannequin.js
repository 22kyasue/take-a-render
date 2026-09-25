import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

function canvasLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(8, 11, 18, 0.84)';
  context.fillRect(8, 8, 496, 112);
  context.fillStyle = '#ffffff';
  context.font = '700 46px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  }));
  sprite.scale.set(1.34, 0.335, 1);
  return sprite;
}

function segmentMaterial(type, materials, shortSleeves) {
  if (type === 'pants') return materials.pants;
  if (type === 'forearm' && shortSleeves) return materials.skin;
  return materials.shirt;
}

export function createTrackedMannequin({ shirtColor, pantsColor, accentColor, label, labelHeight = 0.39, shortSleeves = false }) {
  const group = new THREE.Group();
  group.name = label;
  const materials = {
    shirt: new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.62, metalness: 0.01 }),
    pants: new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.72, metalness: 0.01 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xbec2ca, roughness: 0.72 }),
    analysis: new THREE.MeshBasicMaterial({ color: accentColor, depthTest: false, transparent: true, opacity: 0.95 }),
  };
  const segmentSpecs = [
    ['neck', 'pelvis', 0.255, 'shirt'],
    ['shoulderL', 'shoulderR', 0.13, 'shirt'],
    ['hipL', 'hipR', 0.14, 'pants'],
    ['shoulderL', 'elbowL', 0.105, 'shirt'],
    ['elbowL', 'wristL', 0.082, 'forearm'],
    ['shoulderR', 'elbowR', 0.105, 'shirt'],
    ['elbowR', 'wristR', 0.082, 'forearm'],
    ['hipL', 'kneeL', 0.135, 'pants'],
    ['kneeL', 'ankleL', 0.105, 'pants'],
    ['hipR', 'kneeR', 0.135, 'pants'],
    ['kneeR', 'ankleR', 0.105, 'pants'],
  ];
  const segments = segmentSpecs.map(([start, end, radius, type]) => {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.84, radius, 1, 16),
      segmentMaterial(type, materials, shortSleeves),
    );
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const overlay = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1, 8),
      materials.analysis,
    );
    overlay.visible = false;
    overlay.renderOrder = 6;
    group.add(overlay);
    return { start, end, body, overlay };
  });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 22, 18), materials.skin);
  head.scale.set(0.82, 1.08, 0.9);
  head.castShadow = true;
  group.add(head);
  const hands = ['wristL', 'wristR'].map((joint) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 12), materials.skin);
    mesh.castShadow = true;
    group.add(mesh);
    return { joint, mesh };
  });
  const feet = ['ankleL', 'ankleR'].map((joint) => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 5, 12), materials.pants);
    mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    group.add(mesh);
    return { joint, mesh };
  });
  const markers = Object.fromEntries(
    ['head', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'pelvis', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']
      .map((joint) => {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), materials.analysis);
        marker.visible = false;
        marker.renderOrder = 7;
        group.add(marker);
        return [joint, marker];
      }),
  );
  const labelSprite = canvasLabel(label);
  group.add(labelSprite);
  const focusPosition = new THREE.Vector3();
  const startVector = new THREE.Vector3();
  const endVector = new THREE.Vector3();
  const direction = new THREE.Vector3();

  function positionSegment(segment, pose) {
    startVector.fromArray(pose[segment.start]);
    endVector.fromArray(pose[segment.end]);
    direction.subVectors(endVector, startVector);
    const length = Math.max(0.01, direction.length());
    direction.normalize();
    for (const mesh of [segment.body, segment.overlay]) {
      mesh.position.copy(startVector).add(endVector).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(UP, direction);
      mesh.scale.set(1, length, 1);
    }
  }

  function applyPose(pose) {
    for (const segment of segments) positionSegment(segment, pose);
    head.position.fromArray(pose.head);
    for (const hand of hands) hand.mesh.position.fromArray(pose[hand.joint]);
    for (const foot of feet) {
      foot.mesh.position.fromArray(pose[foot.joint]);
      foot.mesh.position.y += 0.06;
    }
    for (const [joint, marker] of Object.entries(markers)) marker.position.fromArray(pose[joint]);
    labelSprite.position.fromArray(pose.head);
    labelSprite.position.y += labelHeight;
    focusPosition.fromArray(pose.pelvis).add(new THREE.Vector3().fromArray(pose.neck)).multiplyScalar(0.5);
  }

  function setAnalysisVisible(visible) {
    for (const segment of segments) segment.overlay.visible = visible;
    for (const marker of Object.values(markers)) marker.visible = visible;
  }

  function getFocusPosition() {
    return focusPosition.clone();
  }

  return { group, applyPose, setAnalysisVisible, getFocusPosition };
}
