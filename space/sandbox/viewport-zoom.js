export function boundedDistance(current, ratio, min, max) {
 if (!Number.isFinite(ratio) || ratio <= 0) return current;
 return Math.max(min, Math.min(max, current * ratio));
}

// Default touch mode keeps one-finger page scrolling, while handling pinch
// locally. In orbit mode, OrbitControls owns all touch gestures instead.
export function installViewportZoom({ canvas, camera, controls, orbitEnabled, zoomIn, zoomOut }) {
 function zoom(ratio) {
  const offset = camera.position.clone().sub(controls.target);
  const distance = offset.length(); if (distance < 1e-6) return;
  const next = boundedDistance(distance, ratio, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(offset.multiplyScalar(next / distance));
  controls.update();
 }
 let previousSpan = null;
 const span = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
 canvas.addEventListener('touchstart', event => {
  if (orbitEnabled() || event.touches.length !== 2) { previousSpan = null; return; }
  if (event.cancelable) event.preventDefault();
  previousSpan = span(event.touches);
 }, { passive: false });
 canvas.addEventListener('touchmove', event => {
  if (orbitEnabled() || event.touches.length !== 2) { previousSpan = null; return; }
  if (event.cancelable) event.preventDefault();
  const nextSpan = span(event.touches);
  if (previousSpan > 1 && nextSpan > 1) zoom(previousSpan / nextSpan);
  previousSpan = nextSpan;
 }, { passive: false });
 const reset = () => { previousSpan = null; };
 canvas.addEventListener('touchend', reset);
 canvas.addEventListener('touchcancel', reset);
 zoomIn.addEventListener('click', () => zoom(.8));
 zoomOut.addEventListener('click', () => zoom(1.25));
 controls.addEventListener('change', () => {
  const distance = camera.position.distanceTo(controls.target);
  canvas.dataset.viewDistance = distance.toFixed(4);
  zoomIn.disabled = distance <= controls.minDistance + .0001;
  zoomOut.disabled = distance >= controls.maxDistance - .0001;
 });
}
