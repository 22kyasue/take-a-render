import * as THREE from 'three';

/**
 * フットサルコートをサンドボックス空間に構築する。
 *
 * 特定の施設の再現ではなく、競技規則どおりの寸法で「フットサルコートとして
 * 成立する」空間を作ることを目的にしている。自由視点で回したときに、
 * ラインとゴールが自分の位置を教えてくれる状態を作るのが狙い。
 *
 * 出典はフットサル競技規則（Futsal Laws of the Game）第1条・第2条。
 */

// --- 競技規則の寸法（m） ---
export const PITCH = {
  length: 40,              // 国際試合は38–42m。標準の40mを採用
  width: 20,               // 国際試合は20–25m
  lineWidth: 0.08,         // ライン幅 8cm
  centerCircleRadius: 3,
  penaltyRadius: 6,        // ペナルティエリアの4分円半径（ポスト中心）
  penaltyStraight: 3.16,   // 4分円をつなぐ直線
  penaltyMark: 6,          // 第1ペナルティマーク（ゴールラインから）
  secondPenaltyMark: 10,
  cornerArcRadius: 0.25,
  substitutionZone: 5,     // 交代ゾーンの長さ（ハーフウェイラインの両側）
  substitutionMark: 0.8,   // 交代ゾーンを示す線の長さ（タッチラインをまたぐ）
  goalWidth: 3,            // ポスト内寸
  goalHeight: 2,           // クロスバー下端まで
  goalPost: 0.08,          // ポスト・クロスバーの太さ
  goalDepthTop: 0.8,       // ネットの奥行き（上部）
  goalDepthBottom: 1.0,    // ネットの奥行き（下部）
  runOff: 2.5,             // ラインの外側の余地
};

// アルベド（拡散反射率）として置く色。照明前提なので、映像に写る
// 「日向の芝の見た目の色」よりは暗く、しかし黒くはない値を選ぶ。
const COLORS = {
  turfBase: '#55703f',
  turfLight: '#5f7c45',
  turfDark: '#4a6337',
  line: '#f4f7f1',
  goalFrame: 0xf2f4f6,
  surround: 0x54604a,
  fence: '#c8d4cd',
};

/**
 * コートのラインをキャンバスに実寸で描き、テクスチャとして貼る。
 * 個別のメッシュでラインを作るとZファイティングと継ぎ目が出るため、
 * 1枚のテクスチャに焼く方が確実にきれいに出る。
 */
function createPitchTexture(renderer) {
  const pixelsPerMeter = 96;
  const canvas = document.createElement('canvas');
  canvas.width = PITCH.length * pixelsPerMeter;
  canvas.height = PITCH.width * pixelsPerMeter;
  const context = canvas.getContext('2d');
  const toX = (meters) => (meters + PITCH.length / 2) * pixelsPerMeter;
  const toY = (meters) => (meters + PITCH.width / 2) * pixelsPerMeter;
  const scale = (meters) => meters * pixelsPerMeter;

  context.fillStyle = COLORS.turfBase;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // 人工芝の色ムラ。均一な単色だと平面が板に見える。
  // 大きいぼやけた斑は「雲の影」に見えるため、中間スケールの斑を
  // 少量＋細かい斑を大量、の2層で芝の質感に寄せる。
  for (let index = 0; index < 350; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = 30 + Math.random() * 80;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, Math.random() > 0.5 ? COLORS.turfLight : COLORS.turfDark);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.globalAlpha = 0.09;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let index = 0; index < 5200; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = 3 + Math.random() * 14;
    context.fillStyle = Math.random() > 0.5 ? COLORS.turfLight : COLORS.turfDark;
    context.globalAlpha = 0.10;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  context.strokeStyle = COLORS.line;
  context.fillStyle = COLORS.line;
  context.lineWidth = scale(PITCH.lineWidth);
  context.lineCap = 'butt';

  const halfLength = PITCH.length / 2;
  const halfWidth = PITCH.width / 2;

  // タッチライン・ゴールライン
  context.strokeRect(
    toX(-halfLength), toY(-halfWidth),
    scale(PITCH.length), scale(PITCH.width),
  );

  // ハーフウェイラインとセンターサークル
  context.beginPath();
  context.moveTo(toX(0), toY(-halfWidth));
  context.lineTo(toX(0), toY(halfWidth));
  context.stroke();
  context.beginPath();
  context.arc(toX(0), toY(0), scale(PITCH.centerCircleRadius), 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(toX(0), toY(0), scale(0.1), 0, Math.PI * 2);
  context.fill();

  // 両ゴール側の標識
  for (const side of [-1, 1]) {
    const goalLine = side * halfLength;
    const postOffset = PITCH.goalWidth / 2;

    // ペナルティエリア: 各ポストを中心とする半径6mの4分円を、
    // ゴールラインと平行な3.16mの直線でつなぐ。
    for (const post of [-1, 1]) {
      const centerY = post * postOffset;
      const start = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      const end = side > 0 ? Math.PI : Math.PI * 1.5;
      context.beginPath();
      context.arc(
        toX(goalLine), toY(centerY), scale(PITCH.penaltyRadius),
        post > 0 ? start : (side > 0 ? Math.PI : Math.PI * 0.5),
        post > 0 ? end : (side > 0 ? Math.PI * 1.5 : Math.PI),
      );
      context.stroke();
    }
    context.beginPath();
    context.moveTo(toX(goalLine - side * PITCH.penaltyRadius), toY(-PITCH.penaltyStraight / 2));
    context.lineTo(toX(goalLine - side * PITCH.penaltyRadius), toY(PITCH.penaltyStraight / 2));
    context.stroke();

    // ペナルティマークとセカンドペナルティマーク
    for (const distance of [PITCH.penaltyMark, PITCH.secondPenaltyMark]) {
      context.beginPath();
      context.arc(toX(goalLine - side * distance), toY(0), scale(0.09), 0, Math.PI * 2);
      context.fill();
    }

    // コーナーアーク
    for (const corner of [-1, 1]) {
      context.beginPath();
      context.arc(
        toX(goalLine), toY(corner * halfWidth), scale(PITCH.cornerArcRadius),
        0, Math.PI * 2,
      );
      context.stroke();
    }

    // 交代ゾーン（ベンチ側のタッチラインのみ）
    for (const distance of [PITCH.substitutionZone, PITCH.substitutionZone * 2]) {
      const x = toX(side * distance);
      context.beginPath();
      context.moveTo(x, toY(-halfWidth - PITCH.substitutionMark / 2));
      context.lineTo(x, toY(-halfWidth + PITCH.substitutionMark / 2));
      context.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

/** 網目のテクスチャ。ゴールネットとフェンスに使う。 */
function createMeshTexture({ cell, thickness, color, repeat }) {
  const canvas = document.createElement('canvas');
  canvas.width = cell;
  canvas.height = cell;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, cell, cell);
  context.strokeStyle = color;
  context.lineWidth = thickness;
  context.beginPath();
  context.moveTo(0, cell / 2);
  context.lineTo(cell, cell / 2);
  context.moveTo(cell / 2, 0);
  context.lineTo(cell / 2, cell);
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  return texture;
}

/**
 * 規則どおりのフットサルゴール。
 * 内寸 3m × 2m、ポスト8cm角、ネットは上部0.8m・下部1.0mの奥行きを持つ。
 * `facing` はゴールが開いている向き（-1 なら -x 方向を向き、ネットは +x へ伸びる）。
 */
function createGoal(goalLineX, facing) {
  const goal = new THREE.Group();
  goal.name = 'ゴール';
  const post = PITCH.goalPost;
  const halfGoal = PITCH.goalWidth / 2;
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: COLORS.goalFrame, roughness: 0.42, metalness: 0.15,
  });

  // フレームは実物どおり丸パイプ。2点間をつなぐチューブとして置く。
  function tube(from, to, radius, material) {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const length = start.distanceTo(end);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 14),
      material,
    );
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      end.clone().sub(start).normalize(),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    goal.add(mesh);
    return mesh;
  }

  const radius = post / 2;
  const top = PITCH.goalHeight;
  // 左右ポスト(クロスバー内寸3m・高さ2mを維持)
  tube([0, 0, -(halfGoal + radius)], [0, top + radius, -(halfGoal + radius)], radius, frameMaterial);
  tube([0, 0, halfGoal + radius], [0, top + radius, halfGoal + radius], radius, frameMaterial);
  // クロスバー
  tube([0, top + radius, -(halfGoal + radius * 2)], [0, top + radius, halfGoal + radius * 2], radius, frameMaterial);

  // ネットを支える後方フレーム。クロスバー上端から斜め後下方へ落ち、
  // 地面の後方バーで受けるフットサルゴールの標準形。
  const backTop = -facing * PITCH.goalDepthTop;
  const backBottom = -facing * PITCH.goalDepthBottom;
  const supportMaterial = new THREE.MeshStandardMaterial({
    color: COLORS.goalFrame, roughness: 0.5, metalness: 0.1,
  });
  const supportRadius = 0.025;
  for (const side of [-1, 1]) {
    // 上部支持: クロスバー端 → 後方上端
    tube(
      [0, top, side * halfGoal],
      [backTop, top * 0.55, side * halfGoal],
      supportRadius, supportMaterial,
    );
    // 後方支持: 上端 → 地面の後方コーナー
    tube(
      [backTop, top * 0.55, side * halfGoal],
      [backBottom, 0.03, side * halfGoal],
      supportRadius, supportMaterial,
    );
    // 底面サイドバー: ポスト脚 → 後方コーナー
    tube(
      [0, 0.03, side * halfGoal],
      [backBottom, 0.03, side * halfGoal],
      supportRadius, supportMaterial,
    );
  }
  // 地面の後方バー
  tube(
    [backBottom, 0.03, -halfGoal],
    [backBottom, 0.03, halfGoal],
    supportRadius, supportMaterial,
  );

  // ネット。上部と下部で奥行きが違うので、背面は傾いた面になる。
  const netTexture = createMeshTexture({
    cell: 64, thickness: 2, color: '#ffffff', repeat: 1,
  });
  const netMaterial = new THREE.MeshStandardMaterial({
    map: netTexture,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 0.9,
    color: 0xf4f6f8,
  });

  function netPanel(corners, repeatU, repeatV) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([
      ...corners[0], ...corners[1], ...corners[2],
      ...corners[0], ...corners[2], ...corners[3],
    ]);
    const uvs = new Float32Array([
      0, 0, repeatU, 0, repeatU, repeatV,
      0, 0, repeatU, repeatV, 0, repeatV,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, netMaterial);
    mesh.castShadow = false;
    goal.add(mesh);
  }

  // ネットは支持フレームに沿って張る。目は10cm角相当。
  const CELLS_PER_METER = 10;
  // 上面(クロスバー → 後方上端へ下る斜面)
  netPanel([
    [0, top, -halfGoal], [0, top, halfGoal],
    [backTop, top * 0.55, halfGoal], [backTop, top * 0.55, -halfGoal],
  ], PITCH.goalWidth * CELLS_PER_METER, 1.0 * CELLS_PER_METER);
  // 背面(後方上端 → 地面の後方バー)
  netPanel([
    [backTop, top * 0.55, -halfGoal], [backTop, top * 0.55, halfGoal],
    [backBottom, 0.03, halfGoal], [backBottom, 0.03, -halfGoal],
  ], PITCH.goalWidth * CELLS_PER_METER, 1.2 * CELLS_PER_METER);
  // 側面
  for (const side of [-1, 1]) {
    netPanel([
      [0, top, side * halfGoal], [backTop, top * 0.55, side * halfGoal],
      [backBottom, 0.03, side * halfGoal], [0, 0.03, side * halfGoal],
    ], PITCH.goalDepthBottom * CELLS_PER_METER, top * CELLS_PER_METER);
  }

  goal.position.x = goalLineX;
  return goal;
}

/** 空。単色背景だと屋外に見えないので、地平線に向けて明るくする。 */
function createSky() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0.0, '#2f6ea8');
  gradient.addColorStop(0.45, '#79b4dd');
  gradient.addColorStop(0.72, '#c3ddef');
  gradient.addColorStop(1.0, '#dfe7ec');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 8, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 20),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false }),
  );
  sky.name = '空';
  return sky;
}

/**
 * コート・ゴール・フェンス・空・昼光をまとめて作る。
 * `attackingGoalX` は選手が向かうゴールライン（+x 側）の位置。
 * プレーの座標に合わせてコート全体をずらすため、原点はコート中心ではない。
 */
export function createPitch(renderer, { attackingGoalX = 9 } = {}) {
  const group = new THREE.Group();
  group.name = 'フットサルコート';
  // コート中心を、攻撃側ゴールラインから半分の長さだけ戻した位置に置く。
  const centerX = attackingGoalX - PITCH.length / 2;

  const court = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH.length, PITCH.width),
    new THREE.MeshStandardMaterial({
      map: createPitchTexture(renderer),
      roughness: 0.97,
      metalness: 0,
    }),
  );
  court.rotation.x = -Math.PI / 2;
  court.position.x = centerX;
  court.receiveShadow = true;
  group.add(court);

  // ラインの外側の余地。ここが無いとコートが宙に浮いて見える。
  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH.length + PITCH.runOff * 2 + 40, PITCH.width + PITCH.runOff * 2 + 40),
    new THREE.MeshStandardMaterial({ color: COLORS.surround, roughness: 1 }),
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.set(centerX, -0.012, 0);
  surround.receiveShadow = true;
  group.add(surround);

  const attackingGoal = createGoal(attackingGoalX, -1);
  const defendingGoal = createGoal(attackingGoalX - PITCH.length, 1);
  group.add(attackingGoal, defendingGoal);

  // 防球フェンス。実在感のために入れるが、自由視点の妨げにならないよう
  // 網目を細かくせず、半透明にしてある。
  const fenceHeight = 4;
  const fenceTexture = createMeshTexture({
    cell: 64, thickness: 3, color: COLORS.fence, repeat: 1,
  });
  const fenceMaterial = new THREE.MeshBasicMaterial({
    map: fenceTexture,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fenceSpans = [
    [PITCH.length + PITCH.runOff * 2, 0, PITCH.width / 2 + PITCH.runOff, 0],
    [PITCH.length + PITCH.runOff * 2, 0, -(PITCH.width / 2 + PITCH.runOff), 0],
    [PITCH.width + PITCH.runOff * 2, PITCH.length / 2 + PITCH.runOff, 0, Math.PI / 2],
    [PITCH.width + PITCH.runOff * 2, -(PITCH.length / 2 + PITCH.runOff), 0, Math.PI / 2],
  ];
  for (const [span, offsetX, offsetZ, rotation] of fenceSpans) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(span, fenceHeight), fenceMaterial);
    panel.position.set(centerX + offsetX, fenceHeight / 2, offsetZ);
    panel.rotation.y = rotation;
    // 網目を実寸(5cm)にすると遠景で潰れて灰色の壁になり、自由視点の
    // 邪魔になる。0.5m相当まで粗くして「金網がある」ことだけ伝える。
    const texture = fenceTexture.clone();
    texture.needsUpdate = true;
    texture.repeat.set(span / 0.5, fenceHeight / 0.5);
    panel.material = fenceMaterial.clone();
    panel.material.map = texture;
    panel.renderOrder = 2;
    group.add(panel);
  }

  // フェンスの四隅と辺の支柱。パネルの継ぎ目を隠し、金網の実在感を出す。
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x5a6a60, roughness: 0.7 });
  const halfLengthOut = PITCH.length / 2 + PITCH.runOff;
  const halfWidthOut = PITCH.width / 2 + PITCH.runOff;
  const postPositions = [];
  for (const x of [-halfLengthOut, -halfLengthOut / 2, 0, halfLengthOut / 2, halfLengthOut]) {
    postPositions.push([x, halfWidthOut], [x, -halfWidthOut]);
  }
  for (const z of [-halfWidthOut / 2, 0, halfWidthOut / 2]) {
    postPositions.push([halfLengthOut, z], [-halfLengthOut, z]);
  }
  for (const [x, z] of postPositions) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, fenceHeight, 0.09), postMaterial);
    post.position.set(centerX + x, fenceHeight / 2, z);
    post.castShadow = true;
    group.add(post);
  }

  group.add(createSky());

  // --- 昼光 ---
  // 元映像は冬の快晴、太陽はカメラ背後やや左、高度およそ30度。
  const sun = new THREE.DirectionalLight(0xfff2e0, 3.4);
  sun.position.set(-9, 13, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // シャドウカメラの外側は深度がクランプされ、床に大きな暗い帯が出る。
  // コートの見える範囲を確実に覆う大きさにする。
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  group.add(sun);
  group.add(sun.target);

  // 青空からの回り込み。影の中が真っ黒にならないようにする。
  const ambient = new THREE.HemisphereLight(0xa8ccf0, 0x3e4a33, 1.35);
  group.add(ambient);

  return { group, sun, court, attackingGoal, defendingGoal, centerX };
}
