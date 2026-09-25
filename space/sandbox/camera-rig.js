import * as THREE from 'three';

/**
 * 撮影カメラの配置とフラスタム（視野の四角錐）を3D空間に描く。
 *
 * 「この3Dはどこ視点の映像から作られたのか」を見せるための可視化。
 * v1の実カメラ1台を実線・不透明で、v2計画の多視点カメラを半透明で
 * 区別する。フラスタムの向き・画角は演出ではなく、実カメラは元映像の
 * 実際の視点（サイドライン外・手持ち高さ・選手を追ってパン）に合わせる。
 */

const FRUSTUM_LENGTH = 7.5;

function makeLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(8, 11, 18, 0.9)';
  const width = context.measureText(text).width;
  context.fillRect(0, 0, 512, 112);
  context.strokeStyle = color;
  context.lineWidth = 6;
  context.strokeRect(3, 3, 506, 106);
  context.fillStyle = '#ffffff';
  context.font = '700 44px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 256, 58);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false,
  }));
  sprite.scale.set(1.3, 0.29, 1);
  sprite.renderOrder = 8;
  return sprite;
}

/**
 * 1台分のカメラ表現: 本体・フラスタム線・半透明の視野面・ラベル。
 */
function makeCameraMarker({
  name, position, target, color,
  fovDegrees = 46, aspect = 16 / 9, planned = false,
}) {
  const group = new THREE.Group();
  group.name = `カメラ:${name}`;
  const origin = new THREE.Vector3(...position);
  const lookAt = new THREE.Vector3(...target);

  // 視線の基底
  const forward = lookAt.clone().sub(origin).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const halfHeight = Math.tan(THREE.MathUtils.degToRad(fovDegrees / 2)) * FRUSTUM_LENGTH;
  const halfWidth = halfHeight * aspect;
  const center = origin.clone().addScaledVector(forward, FRUSTUM_LENGTH);
  const corners = [
    center.clone().addScaledVector(right, -halfWidth).addScaledVector(up, halfHeight),
    center.clone().addScaledVector(right, halfWidth).addScaledVector(up, halfHeight),
    center.clone().addScaledVector(right, halfWidth).addScaledVector(up, -halfHeight),
    center.clone().addScaledVector(right, -halfWidth).addScaledVector(up, -halfHeight),
  ];

  // フラスタムの稜線と遠方矩形
  const linePoints = [];
  for (const corner of corners) linePoints.push(origin, corner);
  for (let index = 0; index < 4; index += 1) {
    linePoints.push(corners[index], corners[(index + 1) % 4]);
  }
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
  const line = new THREE.LineSegments(
    lineGeometry,
    new THREE.LineBasicMaterial({
      color, transparent: true, opacity: planned ? 0.35 : 0.9, depthWrite: false,
    }),
  );
  line.renderOrder = 7;
  group.add(line);

  // 半透明の視野面（横4面）。参考画像の「色付きの膜」の表現。
  const faceGeometry = new THREE.BufferGeometry();
  const facePositions = [];
  for (let index = 0; index < 4; index += 1) {
    const a = corners[index];
    const b = corners[(index + 1) % 4];
    facePositions.push(
      origin.x, origin.y, origin.z, a.x, a.y, a.z, b.x, b.y, b.z,
    );
  }
  faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(facePositions, 3));
  faceGeometry.computeVertexNormals();
  const faces = new THREE.Mesh(
    faceGeometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: planned ? 0.045 : 0.09,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  faces.renderOrder = 6;
  group.add(faces);

  // カメラ本体（小さな箱＋レンズ筒）
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: planned ? 0x3a4148 : 0x14171c,
    roughness: 0.5,
    transparent: planned,
    opacity: planned ? 0.65 : 1,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.3), bodyMaterial);
  body.position.copy(origin);
  body.lookAt(lookAt);
  group.add(body);
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.12, 16),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.35, transparent: planned, opacity: planned ? 0.65 : 1,
    }),
  );
  lens.position.copy(origin).addScaledVector(forward, 0.2);
  lens.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
  group.add(lens);

  // 三脚（実カメラのみ。計画カメラは浮かせたままにして区別）
  if (!planned && origin.y > 0.3) {
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6 });
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.03, origin.y, 8), legMaterial,
    );
    pole.position.set(origin.x, origin.y / 2, origin.z);
    group.add(pole);
  }

  const label = makeLabel(planned ? `${name}（v2計画）` : name, `#${color.toString(16).padStart(6, '0')}`);
  label.position.copy(origin).add(new THREE.Vector3(0, 0.55, 0));
  group.add(label);

  return group;
}

/**
 * このデモのカメラ配置。
 * 実カメラ: 元映像の視点。サイドライン外(z+)・手持ち高さ1.5m・
 *           プレー（原点付近→+x方向）を見る。撮影者の影が映像に
 *           写り込んでいたことから、太陽を背にした位置。
 * v2計画:   逆サイド・両ゴール裏・俯瞰の4台で全周をカバーする案。
 */
export function createCameraRig({ attackingGoalX = 9 } = {}) {
  const group = new THREE.Group();
  group.name = '撮影カメラ配置';

  const playCenter = [0.8, 0.9, 0];

  // 実カメラの位置は映像から幾何的に逆算した:
  //   映像内のゴール(幅3m)のピクセルスケールは選手の約1.8倍
  //   → ゴールは選手よりカメラに約2倍近い
  //   → カメラはサイドラインではなく「ゴールの斜め後ろ（コート角付近）」
  //     から、ゴールの脇を抜けてコート奥の選手を撮っている。
  // 序盤はゴールが選手の右に写り、選手が前進(+x)するとゴールを追い越して
  // 画面左へ流れる、という映像の変化ともこの配置は一致する。
  group.add(makeCameraMarker({
    name: '実カメラ（この映像）',
    position: [-11, 1.5, 2.5],
    target: [0.8, 0.9, -0.5],
    color: 0xffb545,
    fovDegrees: 50,
    planned: false,
  }));

  group.add(makeCameraMarker({
    name: '逆サイド',
    position: [0.8, 2.2, -8.2],
    target: playCenter,
    color: 0x55e2ff,
    planned: true,
  }));
  group.add(makeCameraMarker({
    name: 'ゴール裏（映像のゴール側）',
    position: [-8.5, 2.0, 0],
    target: playCenter,
    color: 0xff6ec7,
    planned: true,
  }));
  group.add(makeCameraMarker({
    name: '攻め側ゴール裏',
    position: [attackingGoalX + 2.5, 2.2, 0],
    target: playCenter,
    color: 0x8f7bff,
    fovDegrees: 30,
    planned: true,
  }));
  group.add(makeCameraMarker({
    name: '俯瞰',
    position: [0.8, 9.0, 4.5],
    target: playCenter,
    color: 0x6ee7a0,
    fovDegrees: 60,
    planned: true,
  }));

  return group;
}
