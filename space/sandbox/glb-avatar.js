import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Blender製のリグ付きGLBを、既存の追跡データ（関節ワールド座標）で駆動する。
 *
 * 追跡データは単眼推定なので、位置をそのまま骨に流すと骨長が毎フレーム
 * 伸縮して破綻する。そこで「位置」ではなく「方向」だけを使い、骨長は
 * アバター側の実寸を保つ。さらに joint-limits.json の可動域で丸めるので、
 * 推定が乱れても膝が逆に曲がるような人体の外へは出ない。
 *
 * 公開インターフェースは tracked-mannequin.js と同一にしてあるので、
 * 呼び出し側は差し替えるだけでよい。
 */

const AXES = ['x', 'y', 'z'];
const DEG = Math.PI / 180;
const FORWARD = new THREE.Vector3(0, 0, 1);

// ボーン → [始点の関節, 終点の関節]。この向きに骨を合わせる。
const AIM_TARGETS = {
  Spine: ['pelvis', 'neck'],
  Spine1: ['pelvis', 'neck'],
  Spine2: ['pelvis', 'neck'],
  Neck: ['neck', 'head'],
  Head: ['neck', 'head'],

  LeftShoulder: ['neck', 'shoulderL'],
  LeftArm: ['shoulderL', 'elbowL'],
  LeftForeArm: ['elbowL', 'wristL'],
  LeftHand: ['elbowL', 'wristL'],
  RightShoulder: ['neck', 'shoulderR'],
  RightArm: ['shoulderR', 'elbowR'],
  RightForeArm: ['elbowR', 'wristR'],
  RightHand: ['elbowR', 'wristR'],

  LeftUpLeg: ['hipL', 'kneeL'],
  LeftLeg: ['kneeL', 'ankleL'],
  RightUpLeg: ['hipR', 'kneeR'],
  RightLeg: ['kneeR', 'ankleR'],
};

// 足部は元データにつま先が無い。体の前方へ向けて接地させる。
const FOOT_BONES = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];

// 頭部は推定点の性質上そのまま使えない。体の上方向へどれだけ引き戻すか。
const HEAD_BONES = new Set(['Neck', 'Head']);
// 手付けデータは頭の傾きも設計値なので、推定ノイズ対策の強い直立化は
// 不要になった。しゃがみに頭がついてくる程度に弱める。
const HEAD_UPRIGHT_BLEND = 0.88;

function boneAxisFromRest(bone) {
  // 骨の長軸は「子ボーンのレスト位置の向き」。glTF の軸規約に依存せず求まる。
  const child = bone.children.find((node) => node.isBone);
  if (!child) return new THREE.Vector3(0, 1, 0);
  const axis = child.position.clone();
  return axis.lengthSq() < 1e-10 ? new THREE.Vector3(0, 1, 0) : axis.normalize();
}

function forwardAxisFromRest(bone) {
  // レスト姿勢でワールド前方(+Z)に最も近いローカル軸を「前方軸」とする。
  // ロール（骨の捻り）の基準に使う。こちらも規約を仮定しない実測ベース。
  const worldQuaternion = bone.getWorldQuaternion(new THREE.Quaternion());
  let best = null;
  let bestDot = -Infinity;
  for (const [x, y, z] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]) {
    const candidate = new THREE.Vector3(x, y, z);
    const dot = candidate.clone().applyQuaternion(worldQuaternion).dot(FORWARD);
    if (dot > bestDot) {
      bestDot = dot;
      best = candidate;
    }
  }
  return best;
}

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

/**
 * stabilize: 単眼推定のノイズ対策（頭の直立化・足の前方固定・視線）を
 * 有効にするか。手付けのアクロバット（オーバーヘッド等）では、これらが
 * 宙返りと矛盾して体を壊すため false にする。
 */
export async function loadAvatarFactory({
  modelUrl = './assets/athlete.glb',
  limitsUrl = './joint-limits.json',
  stabilize = true,
} = {}) {
  const [gltf, limits] = await Promise.all([
    new GLTFLoader().loadAsync(modelUrl),
    fetch(limitsUrl).then((response) => {
      if (!response.ok) throw new Error(`joint-limits.json: HTTP ${response.status}`);
      return response.json();
    }),
  ]);

  const template = gltf.scene;
  template.updateMatrixWorld(true);

  // レスト姿勢の実測値。インスタンス間で共有できる静的情報。
  const restInfo = new Map();
  template.traverse((object) => {
    if (!object.isBone) return;
    restInfo.set(object.name, {
      localQuaternion: object.quaternion.clone(),
      boneAxis: boneAxisFromRest(object),
      forwardAxis: forwardAxisFromRest(object),
    });
  });

  function create({ shirtColor, pantsColor, accentColor, label, labelHeight = 0.34 }) {
    const group = new THREE.Group();
    group.name = label;

    const model = cloneSkinned(template);
    model.traverse((object) => {
      if (!object.isMesh && !object.isSkinnedMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      // スキニングでバウンディングボックスが実態とずれるため無効化する。
      object.frustumCulled = false;
      // 選手ごとに色を変えるので、共有マテリアルを複製してから塗る。
      const wasArray = Array.isArray(object.material);
      const recolored = (wasArray ? object.material : [object.material]).map((material) => {
        const copy = material.clone();
        if (copy.name === 'Shirt') copy.color = new THREE.Color(shirtColor);
        if (copy.name === 'Shorts') copy.color = new THREE.Color(pantsColor);
        return copy;
      });
      object.material = wasArray ? recolored : recolored[0];
    });
    group.add(model);

    const bones = new Map();
    model.traverse((object) => {
      if (object.isBone) bones.set(object.name, object);
    });

    const skeletonHelper = new THREE.SkeletonHelper(model);
    skeletonHelper.material.color = new THREE.Color(accentColor);
    skeletonHelper.material.depthTest = false;
    skeletonHelper.material.transparent = true;
    skeletonHelper.renderOrder = 6;
    skeletonHelper.visible = false;
    group.add(skeletonHelper);

    const labelSprite = canvasLabel(label);
    group.add(labelSprite);

    const hips = bones.get('Hips');
    const focusPosition = new THREE.Vector3();

    // 毎フレーム確保しないための作業用ベクトル。
    const tmp = {
      aim: new THREE.Vector3(),
      up: new THREE.Vector3(),
      left: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      current: new THREE.Vector3(),
      projectedA: new THREE.Vector3(),
      projectedB: new THREE.Vector3(),
      start: new THREE.Vector3(),
      end: new THREE.Vector3(),
      worldQuaternion: new THREE.Quaternion(),
      parentQuaternion: new THREE.Quaternion(),
      delta: new THREE.Quaternion(),
      euler: new THREE.Euler(),
      matrix: new THREE.Matrix4(),
      headPosition: new THREE.Vector3(),
      gaze: new THREE.Vector3(),
      strideDirection: new THREE.Vector3(),
    };

    // 追跡データは抽出時に鼻の高さ1.62mを基準として実寸(m)へ較正済みなので、
    // アバターは等倍で置く。以前は脚の長さで縮小していたが、単眼推定は
    // 脚を短く見積もるため、規格サイズのゴートと並べると選手が小さすぎた。
    const footProbe = new THREE.Vector3();
    const GROUND_CLEARANCE = 0.02;

    function clampToLimits(bone) {
      const table = limits.limits[bone.name];
      const rest = restInfo.get(bone.name);
      if (!table || !rest) return;
      tmp.delta.copy(rest.localQuaternion).invert().multiply(bone.quaternion);
      tmp.euler.setFromQuaternion(tmp.delta, 'XYZ');
      let changed = false;
      for (let index = 0; index < AXES.length; index += 1) {
        const range = table[AXES[index]];
        if (!range) continue;
        const axis = AXES[index];
        const degrees = tmp.euler[axis] / DEG;
        const clamped = Math.min(range[1], Math.max(range[0], degrees));
        if (clamped !== degrees) {
          tmp.euler[axis] = clamped * DEG;
          changed = true;
        }
      }
      if (!changed) return;
      tmp.delta.setFromEuler(tmp.euler);
      bone.quaternion.copy(rest.localQuaternion).multiply(tmp.delta);
    }

    function orientBone(boneName, aimDirection, forwardHint) {
      const bone = bones.get(boneName);
      const rest = restInfo.get(boneName);
      if (!bone || !rest || aimDirection.lengthSq() < 1e-8) return;

      // いったんレストへ戻してから、現在のワールド向きを測る。
      bone.quaternion.copy(rest.localQuaternion);
      bone.updateWorldMatrix(false, false);
      bone.getWorldQuaternion(tmp.worldQuaternion);

      tmp.current.copy(rest.boneAxis).applyQuaternion(tmp.worldQuaternion).normalize();
      tmp.delta.setFromUnitVectors(tmp.current, aimDirection);
      tmp.worldQuaternion.premultiply(tmp.delta);

      // 骨の長軸まわりの捻りは向きだけでは決まらない。前方軸を体の前方へ
      // 寄せることで、膝や肘が横向きに曲がるのを防ぐ。
      tmp.current.copy(rest.forwardAxis).applyQuaternion(tmp.worldQuaternion);
      tmp.projectedA.copy(tmp.current)
        .addScaledVector(aimDirection, -tmp.current.dot(aimDirection));
      tmp.projectedB.copy(forwardHint)
        .addScaledVector(aimDirection, -forwardHint.dot(aimDirection));
      if (tmp.projectedA.lengthSq() > 1e-6 && tmp.projectedB.lengthSq() > 1e-6) {
        tmp.delta.setFromUnitVectors(tmp.projectedA.normalize(), tmp.projectedB.normalize());
        tmp.worldQuaternion.premultiply(tmp.delta);
      }

      bone.parent.getWorldQuaternion(tmp.parentQuaternion);
      bone.quaternion.copy(tmp.parentQuaternion.invert()).multiply(tmp.worldQuaternion);
      clampToLimits(bone);
      bone.updateWorldMatrix(false, false);
    }

    /**
     * @param pose 関節ワールド座標
     * @param context 任意。{ gazeTarget: [x,y,z] } を渡すと、首と頭の
     *   ひねりが注視点の方向を向く（可動域の範囲内で）。現実の選手は
     *   ボールと相手を見続けており、正面固定の頭は人形に見える最大要因。
     */
    function applyPose(pose, context = {}) {
      if (!hips) return;

      // 体の基準軸。左右はアバターの +X が選手の左であることに合わせる。
      tmp.left.set(
        pose.hipL[0] - pose.hipR[0],
        pose.hipL[1] - pose.hipR[1],
        pose.hipL[2] - pose.hipR[2],
      ).normalize();
      tmp.up.set(
        pose.neck[0] - pose.pelvis[0],
        pose.neck[1] - pose.pelvis[1],
        pose.neck[2] - pose.pelvis[2],
      ).normalize();
      tmp.forward.crossVectors(tmp.left, tmp.up).normalize();
      tmp.left.crossVectors(tmp.up, tmp.forward).normalize();

      hips.position.fromArray(pose.pelvis);
      tmp.matrix.makeBasis(tmp.left, tmp.up, tmp.forward);
      hips.quaternion.setFromRotationMatrix(tmp.matrix);
      hips.updateWorldMatrix(false, false);

      // 注視方向。頭の前方軸をこちらへ寄せると、顔がボール・相手を追う。
      // 可動域(首±45°)は orientBone 内の clampToLimits が守る。
      let gazeHint = tmp.forward;
      if (context.gazeTarget) {
        tmp.gaze.set(
          context.gazeTarget[0] - pose.head[0],
          0,
          context.gazeTarget[2] - pose.head[2],
        );
        if (tmp.gaze.lengthSq() > 1e-4) {
          // 真下のボールを覗き込みすぎないよう、体の前方と7:3で混ぜる。
          tmp.gaze.normalize().lerp(tmp.forward, 0.3).normalize();
          gazeHint = tmp.gaze;
        }
      }

      for (const [boneName, [startJoint, endJoint]] of Object.entries(AIM_TARGETS)) {
        tmp.start.fromArray(pose[startJoint]);
        tmp.end.fromArray(pose[endJoint]);
        tmp.aim.subVectors(tmp.end, tmp.start).normalize();
        if (stabilize && HEAD_BONES.has(boneName)) {
          // 推定の head は頭頂ではなく顔の中心。そのまま骨の向きにすると
          // 頭が大きく前へ倒れるので、体の上方向へ寄せて傾きを残す程度にする。
          tmp.aim.lerp(tmp.up, HEAD_UPRIGHT_BLEND).normalize();
        }
        orientBone(
          boneName,
          tmp.aim,
          stabilize && HEAD_BONES.has(boneName) ? gazeHint : tmp.forward,
        );
      }

      if (stabilize) {
        // 足の向き。従来は常に「体の前方やや下」で、歩幅と無関係な
        // 滑り足に見えた。下腿(膝→足首)の水平成分と体の前方を混ぜ、
        // さらに足の高さでつま先の下がり（底屈）を変える:
        //   接地中 → ほぼ水平 / スイング中 → つま先が下がる
        for (const side of ['Left', 'Right']) {
          const suffix = side === 'Left' ? 'L' : 'R';
          const knee = pose[`knee${suffix}`];
          const ankle = pose[`ankle${suffix}`];
          const toe = pose[`toe${suffix}`];
          if (toe) {
            // つま先の実測点があれば「足首→つま先」の実方向で駆動する。
            // 背屈・底屈・つま先の向きが推定ではなく計測値になる。
            tmp.aim.set(toe[0] - ankle[0], toe[1] - ankle[1], toe[2] - ankle[2]).normalize();
            orientBone(`${side}Foot`, tmp.aim, tmp.up);
            orientBone(`${side}ToeBase`, tmp.aim, tmp.up);
            continue;
          }
          tmp.strideDirection.set(ankle[0] - knee[0], 0, ankle[2] - knee[2]);
          if (tmp.strideDirection.lengthSq() > 1e-4) {
            tmp.strideDirection.normalize().lerp(tmp.forward, 0.45).normalize();
          } else {
            tmp.strideDirection.copy(tmp.forward);
          }
          const plantarFlex = Math.min(0.7, 0.18 + ankle[1] * 2.4);
          tmp.aim.copy(tmp.strideDirection).addScaledVector(tmp.up, -plantarFlex).normalize();
          orientBone(`${side}Foot`, tmp.aim, tmp.up);
          orientBone(`${side}ToeBase`, tmp.aim, tmp.up);
        }
      } else {
        // アクロバット用: 足はすね(膝→足首)の延長へ（つま先が伸びる）。
        // 宙返り中に「前方やや下」を強制すると足首がねじ切れる。
        for (const side of ['Left', 'Right']) {
          const suffix = side === 'Left' ? 'L' : 'R';
          tmp.aim.set(
            pose[`ankle${suffix}`][0] - pose[`knee${suffix}`][0],
            pose[`ankle${suffix}`][1] - pose[`knee${suffix}`][1],
            pose[`ankle${suffix}`][2] - pose[`knee${suffix}`][2],
          ).normalize();
          orientBone(`${side}Foot`, tmp.aim, tmp.forward);
          orientBone(`${side}ToeBase`, tmp.aim, tmp.forward);
        }
      }

      // 骨長はアバター側の実寸を使うので、骨盤の高さをそのまま採ると足が
      // 床へ潜る。姿勢を決めたあとに、最も低い足が接地するよう根を上下する。
      // アクロバット(stabilize=false)では空中姿勢が主役なので接地補正しない。
      if (stabilize) {
        let lowest = Infinity;
        for (const boneName of ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']) {
          const bone = bones.get(boneName);
          if (!bone) continue;
          bone.getWorldPosition(footProbe);
          lowest = Math.min(lowest, footProbe.y);
        }
        if (Number.isFinite(lowest)) {
          hips.position.y += GROUND_CLEARANCE - lowest;
          hips.updateWorldMatrix(false, true);
        }
      }

      focusPosition.set(
        (pose.pelvis[0] + pose.neck[0]) * 0.5,
        (pose.pelvis[1] + pose.neck[1]) * 0.5,
        (pose.pelvis[2] + pose.neck[2]) * 0.5,
      );
      const head = bones.get('Head');
      if (head) {
        head.getWorldPosition(tmp.headPosition);
        labelSprite.position.copy(tmp.headPosition);
      } else {
        labelSprite.position.fromArray(pose.head);
      }
      labelSprite.position.y += labelHeight;
    }

    function setAnalysisVisible(visible) {
      skeletonHelper.visible = visible;
    }

    function getFocusPosition() {
      return focusPosition.clone();
    }

    return { group, applyPose, setAnalysisVisible, getFocusPosition };
  }

  return { create };
}
