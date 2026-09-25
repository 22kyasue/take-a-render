const FINAL_FRAME = 180;

const neutralJoints = {
  pelvis: [0, 0, 0],
  spine: [0, 0, 0],
  neck: [0, 0, 0],
  shoulderL: [0, 0, -0.12],
  shoulderR: [0, 0, 0.12],
  elbowL: [0, 0, -0.18],
  elbowR: [0, 0, 0.18],
  hipL: [0, 0, 0],
  hipR: [0, 0, 0],
  kneeL: [0, 0, 0.08],
  kneeR: [0, 0, -0.08],
  ankleL: [0, 0, 0],
  ankleR: [0, 0, 0],
};

function actor(root, joints = {}) {
  return {
    root,
    joints: Object.fromEntries(
      Object.entries(neutralJoints).map(([name, rotation]) => [
        name,
        joints[name] ? [...joints[name]] : [...rotation],
      ]),
    ),
  };
}

const keyframes = [
  {
    frame: 0,
    morioka: actor(
      { x: -1.7, y: 0, z: 0.45, yaw: 0.08 },
      {
        pelvis: [0.18, 0, -0.06],
        spine: [0.16, -0.08, -0.06],
        shoulderL: [0.1, 0, -0.42],
        shoulderR: [0.04, 0, 0.3],
        hipL: [-0.5, 0, 0.12],
        hipR: [0.28, 0, -0.08],
        kneeL: [0.72, 0, 0],
        kneeR: [0.48, 0, 0],
      },
    ),
    defender: actor(
      { x: 0.15, y: 0, z: 0, yaw: -0.04 },
      {
        pelvis: [0.05, 0, 0],
        spine: [0.03, 0, 0],
        hipL: [-0.12, 0, 0],
        hipR: [0.14, 0, 0],
        kneeL: [0.22, 0, 0],
        kneeR: [0.16, 0, 0],
      },
    ),
    ball: { x: 1.55, y: 0.23, z: -0.25, rotation: 0 },
  },
  {
    frame: 24,
    morioka: actor(
      { x: -1.28, y: 0, z: 0.36, yaw: 0.12 },
      {
        pelvis: [0.2, 0.04, -0.08],
        spine: [0.22, -0.12, -0.08],
        shoulderL: [0.12, 0, -0.5],
        shoulderR: [0.08, 0, 0.42],
        elbowR: [-0.28, 0, 0.35],
        hipL: [0.18, 0, 0.06],
        hipR: [-0.56, 0, -0.08],
        kneeL: [0.48, 0, 0],
        kneeR: [0.78, 0, 0],
      },
    ),
    defender: actor(
      { x: 0.18, y: 0, z: 0, yaw: -0.02 },
      {
        pelvis: [0.08, 0, 0.02],
        spine: [0.08, 0.05, 0.02],
        shoulderL: [0.08, 0, -0.26],
        hipL: [0.16, 0, 0],
        hipR: [-0.16, 0, 0],
        kneeL: [0.36, 0, 0],
        kneeR: [0.3, 0, 0],
      },
    ),
    ball: { x: 1.54, y: 0.23, z: -0.24, rotation: 0.15 },
  },
  {
    frame: 48,
    morioka: actor(
      { x: -0.82, y: 0, z: 0.22, yaw: 0.2 },
      {
        pelvis: [0.24, 0.08, -0.12],
        spine: [0.27, -0.18, -0.12],
        shoulderL: [0.18, 0, -0.64],
        shoulderR: [0.12, 0, 0.54],
        elbowR: [-0.42, 0, 0.44],
        hipL: [-0.38, 0, 0.1],
        hipR: [0.22, 0, -0.1],
        kneeL: [0.7, 0, 0],
        kneeR: [0.58, 0, 0],
      },
    ),
    defender: actor(
      { x: 0.2, y: 0, z: 0, yaw: 0 },
      {
        pelvis: [0.11, -0.03, 0.05],
        spine: [0.13, 0.08, 0.04],
        shoulderL: [0.14, 0, -0.34],
        elbowL: [-0.24, 0, -0.2],
        hipL: [-0.18, 0, 0],
        hipR: [0.18, 0, 0],
        kneeL: [0.42, 0, 0],
        kneeR: [0.36, 0, 0],
      },
    ),
    ball: { x: 1.52, y: 0.23, z: -0.22, rotation: 0.3 },
  },
  {
    frame: 66,
    morioka: actor(
      { x: -0.42, y: 0, z: 0.08, yaw: 0.38 },
      {
        pelvis: [0.27, 0.18, -0.16],
        spine: [0.3, -0.26, -0.18],
        shoulderL: [0.2, 0, -0.78],
        shoulderR: [0.16, 0, 0.68],
        elbowL: [-0.22, 0, -0.34],
        elbowR: [-0.5, 0, 0.48],
        hipL: [0.16, 0, 0.08],
        hipR: [-0.5, 0, -0.12],
        kneeL: [0.62, 0, 0],
        kneeR: [0.82, 0, 0],
      },
    ),
    defender: actor(
      { x: 0.16, y: 0, z: -0.03, yaw: 0.05 },
      {
        pelvis: [0.16, -0.12, 0.08],
        spine: [0.18, 0.16, 0.08],
        shoulderL: [0.16, 0, -0.52],
        elbowL: [-0.38, 0, -0.26],
        hipL: [0.2, 0, 0],
        hipR: [-0.2, 0, 0],
        kneeL: [0.52, 0, 0],
        kneeR: [0.48, 0, 0],
      },
    ),
    ball: { x: 1.5, y: 0.23, z: -0.2, rotation: 0.45 },
  },
  {
    frame: 84,
    morioka: actor(
      { x: -0.05, y: 0, z: -0.08, yaw: 0.58 },
      {
        pelvis: [0.3, 0.28, -0.18],
        spine: [0.34, -0.34, -0.2],
        shoulderL: [0.22, 0, -0.9],
        shoulderR: [0.18, 0, 0.82],
        elbowL: [-0.34, 0, -0.38],
        elbowR: [-0.56, 0, 0.5],
        hipL: [-0.44, 0, 0.1],
        hipR: [0.12, 0, -0.12],
        kneeL: [0.78, 0, 0],
        kneeR: [0.66, 0, 0],
      },
    ),
    defender: actor(
      { x: -0.02, y: 0, z: -0.12, yaw: 0.14 },
      {
        pelvis: [0.2, -0.22, 0.1],
        spine: [0.24, 0.26, 0.1],
        shoulderL: [0.2, 0, -0.66],
        shoulderR: [0.12, 0, 0.38],
        elbowL: [-0.46, 0, -0.3],
        hipL: [-0.24, 0, 0],
        hipR: [0.24, 0, 0],
        kneeL: [0.64, 0, 0],
        kneeR: [0.58, 0, 0],
      },
    ),
    ball: { x: 1.48, y: 0.23, z: -0.18, rotation: 0.65 },
  },
  {
    frame: 108,
    morioka: actor(
      { x: 0.38, y: 0, z: -0.2, yaw: 0.78 },
      {
        pelvis: [0.26, 0.38, -0.14],
        spine: [0.28, -0.42, -0.18],
        shoulderL: [0.18, 0, -0.82],
        shoulderR: [0.12, 0, 0.74],
        elbowL: [-0.42, 0, -0.32],
        elbowR: [-0.5, 0, 0.44],
        hipL: [0.14, 0, 0.08],
        hipR: [-0.38, 0, -0.08],
        kneeL: [0.6, 0, 0],
        kneeR: [0.74, 0, 0],
      },
    ),
    defender: actor(
      { x: -0.18, y: 0, z: -0.25, yaw: 0.26 },
      {
        pelvis: [0.22, -0.3, 0.12],
        spine: [0.28, 0.34, 0.12],
        shoulderL: [0.24, 0, -0.72],
        shoulderR: [0.16, 0, 0.46],
        elbowL: [-0.5, 0, -0.34],
        hipL: [0.18, 0, 0],
        hipR: [-0.18, 0, 0],
        kneeL: [0.58, 0, 0],
        kneeR: [0.7, 0, 0],
      },
    ),
    ball: { x: 1.46, y: 0.23, z: -0.16, rotation: 0.9 },
  },
  {
    frame: 138,
    morioka: actor(
      { x: 0.68, y: 0, z: -0.28, yaw: 0.92 },
      {
        pelvis: [0.22, 0.44, -0.12],
        spine: [0.24, -0.46, -0.15],
        shoulderL: [0.14, 0, -0.74],
        shoulderR: [0.1, 0, 0.62],
        elbowL: [-0.48, 0, -0.28],
        elbowR: [-0.42, 0, 0.38],
        hipL: [-0.26, 0, 0.08],
        hipR: [0.1, 0, -0.06],
        kneeL: [0.62, 0, 0],
        kneeR: [0.52, 0, 0],
      },
    ),
    defender: actor(
      { x: -0.32, y: 0, z: -0.34, yaw: 0.34 },
      {
        pelvis: [0.24, -0.34, 0.1],
        spine: [0.3, 0.38, 0.1],
        shoulderL: [0.26, 0, -0.66],
        shoulderR: [0.18, 0, 0.52],
        elbowL: [-0.46, 0, -0.28],
        elbowR: [-0.3, 0, 0.24],
        hipL: [-0.22, 0, 0],
        hipR: [0.16, 0, 0],
        kneeL: [0.68, 0, 0],
        kneeR: [0.58, 0, 0],
      },
    ),
    ball: { x: 1.44, y: 0.23, z: -0.14, rotation: 1.18 },
  },
  {
    frame: 162,
    morioka: actor(
      { x: 0.82, y: 0, z: -0.3, yaw: 0.98 },
      {
        pelvis: [0.18, 0.46, -0.1],
        spine: [0.2, -0.44, -0.12],
        shoulderL: [0.12, 0, -0.68],
        shoulderR: [0.08, 0, 0.56],
        elbowL: [-0.46, 0, -0.26],
        elbowR: [-0.36, 0, 0.32],
        hipL: [0.08, 0, 0.06],
        hipR: [-0.2, 0, -0.05],
        kneeL: [0.5, 0, 0],
        kneeR: [0.62, 0, 0],
      },
    ),
    defender: actor(
      { x: -0.35, y: 0, z: -0.36, yaw: 0.36 },
      {
        pelvis: [0.22, -0.32, 0.08],
        spine: [0.26, 0.36, 0.08],
        shoulderL: [0.24, 0, -0.58],
        shoulderR: [0.16, 0, 0.46],
        elbowL: [-0.4, 0, -0.24],
        elbowR: [-0.28, 0, 0.2],
        hipL: [0.12, 0, 0],
        hipR: [-0.12, 0, 0],
        kneeL: [0.56, 0, 0],
        kneeR: [0.64, 0, 0],
      },
    ),
    ball: { x: 1.42, y: 0.23, z: -0.12, rotation: 1.4 },
  },
  {
    frame: 180,
    morioka: actor(
      { x: 0.85, y: 0, z: -0.3, yaw: 1.0 },
      {
        pelvis: [0.17, 0.46, -0.1],
        spine: [0.19, -0.44, -0.12],
        shoulderL: [0.12, 0, -0.66],
        shoulderR: [0.08, 0, 0.54],
        elbowL: [-0.44, 0, -0.24],
        elbowR: [-0.34, 0, 0.3],
        hipL: [0.06, 0, 0.05],
        hipR: [-0.18, 0, -0.04],
        kneeL: [0.48, 0, 0],
        kneeR: [0.58, 0, 0],
      },
    ),
    defender: actor(
      { x: -0.35, y: 0, z: -0.36, yaw: 0.36 },
      {
        pelvis: [0.22, -0.32, 0.08],
        spine: [0.26, 0.36, 0.08],
        shoulderL: [0.24, 0, -0.58],
        shoulderR: [0.16, 0, 0.46],
        elbowL: [-0.4, 0, -0.24],
        elbowR: [-0.28, 0, 0.2],
        hipL: [0.12, 0, 0],
        hipR: [-0.12, 0, 0],
        kneeL: [0.56, 0, 0],
        kneeR: [0.64, 0, 0],
      },
    ),
    ball: { x: 1.42, y: 0.23, z: -0.12, rotation: 1.5 },
  },
];

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function interpolateNumber(a, b, t) {
  return a + (b - a) * t;
}

function interpolateArray(a, b, t) {
  return a.map((value, index) => interpolateNumber(value, b[index], t));
}

function interpolateActor(a, b, t) {
  const root = Object.fromEntries(
    Object.keys(a.root).map((key) => [key, interpolateNumber(a.root[key], b.root[key], t)]),
  );
  const joints = Object.fromEntries(
    Object.keys(a.joints).map((name) => [
      name,
      interpolateArray(a.joints[name], b.joints[name], t),
    ]),
  );
  return { root, joints };
}

function interpolateBall(a, b, t) {
  return Object.fromEntries(
    Object.keys(a).map((key) => [key, interpolateNumber(a[key], b[key], t)]),
  );
}

export function sampleScenePose(frame) {
  const clampedFrame = Math.min(FINAL_FRAME, Math.max(0, Number(frame) || 0));
  const upperIndex = keyframes.findIndex((keyframe) => keyframe.frame >= clampedFrame);
  const upper = keyframes[upperIndex === -1 ? keyframes.length - 1 : upperIndex];
  const lower = keyframes[Math.max(0, (upperIndex === -1 ? keyframes.length - 1 : upperIndex) - 1)];

  if (lower.frame === upper.frame) {
    return {
      morioka: interpolateActor(lower.morioka, upper.morioka, 0),
      defender: interpolateActor(lower.defender, upper.defender, 0),
      ball: interpolateBall(lower.ball, upper.ball, 0),
    };
  }

  const progress = smoothstep((clampedFrame - lower.frame) / (upper.frame - lower.frame));
  return {
    morioka: interpolateActor(lower.morioka, upper.morioka, progress),
    defender: interpolateActor(lower.defender, upper.defender, progress),
    ball: interpolateBall(lower.ball, upper.ball, progress),
  };
}

