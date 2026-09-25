function centroid(...points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
}

export function resolveFocusTarget(name, positions) {
  if (name === 'morioka' || name === 'defender' || name === 'ball') {
    return { ...positions[name] };
  }
  return centroid(positions.morioka, positions.defender, positions.ball);
}

export function createCameraController({ THREE, camera, controls }) {
  // 初期視点は実カメラ（ゴール斜め後ろのコート角）と同じ側から。
  // 開いた瞬間に元映像と同じ構図＝手前にゴール、その奥に選手、が見える。
  // 実カメラ(高さ1.5m)より少し引いて高くし、コートの文脈も入れる。
  const defaultPosition = new THREE.Vector3(-13.5, 4.0, 4.5);
  const desiredTarget = new THREE.Vector3(0, 1.15, 0);
  controls.target.copy(desiredTarget);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = true;
  controls.panSpeed = 0.65;
  controls.rotateSpeed = 0.68;
  controls.zoomSpeed = 0.72;
  controls.minDistance = 1.6;
  // コート全体（40m×20m）を俯瞰できるところまで引けるようにする。
  controls.maxDistance = 34;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.025;

  function setFocusTarget(target) {
    desiredTarget.set(target.x, target.y, target.z);
  }

  function resetView() {
    camera.position.copy(defaultPosition);
    controls.target.copy(desiredTarget);
    controls.update();
  }

  function update() {
    controls.target.lerp(desiredTarget, 0.14);
    controls.update();
  }

  return { setFocusTarget, resetView, update };
}
