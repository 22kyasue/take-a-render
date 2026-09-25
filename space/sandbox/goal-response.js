import { sampleBallTrack } from './ball-track.js';

// Display-only continuation in capture coordinates: goal mouth z=0, back=-1.1.
// Fixed steps make playback speed, seeking and replay produce identical motion.
export function createGoalResponse(track) {
 const last = track.frames.findLastIndex(Boolean), end = last / track.fps;
 const initial = sampleBallTrack(track, end), previous = sampleBallTrack(track, end - 3 / track.fps);
 if (!initial || !previous) return time => sampleBallTrack(track, time);
 const radius = track.radius ?? .105, dt = 1 / 240;
 const p = [...initial.p], velocity = p.map((v, i) => (v - previous.p[i]) * track.fps / 3);
 // Only continue a shot approaching this goal. Never invent motion for other gaps.
 if (p[2] < -1.1 || p[2] > 1 || velocity[2] >= 0) return time => sampleBallTrack(track, time);
 const frames = [[...p]], impacts = [];
 for (let step = 1; step <= 720; step++) {
  velocity[1] -= 9.81 * dt;
  for (let axis = 0; axis < 3; axis++) p[axis] += velocity[axis] * dt;
  const collide = (axis, limit, normal, net) => {
   if ((p[axis] - limit) * normal <= 0 || velocity[axis] * normal <= 0) return;
   const speed = Math.abs(velocity[axis]);
   p[axis] = limit;
   if (net && speed > .5) {
    const n = [0, 0, 0]; n[axis] = normal;
    const contact = [...p]; contact[axis] += normal * radius;
    impacts.push({ time: end + step * dt, p: contact, normal: n, strength: Math.min(.32, speed * .025) });
   }
   velocity[axis] *= net ? -.12 : -.18;
   for (let i = 0; i < 3; i++) if (i !== axis) velocity[i] *= net ? .48 : .75;
  };
  if (p[2] < -radius) {
   collide(2, -1.1 + radius, -1, true);
   collide(0, -1.5 + radius, -1, true);
   collide(0, 1.5 - radius, 1, true);
   collide(1, 2 - radius, 1, true);
  }
  collide(1, radius, -1, false);
  frames.push([...p]);
 }
 return time => {
  if (!Number.isFinite(time) || time <= end) return sampleBallTrack(track, time);
  const index = Math.min((time - end) / dt, frames.length - 1), a = Math.floor(index), b = Math.min(a + 1, frames.length - 1);
  return { p: frames[a].map((v, i) => v + (frames[b][i] - v) * (index - a)), method: 'goal-simulation', impacts: impacts.filter(hit => hit.time <= time), rollTime: end };
 };
}

// Local impulse propagates through the mesh and decays. Front attachments and
// floor anchors stay fixed; shared vertices receive identical displacements.
export function netOffset(point, impacts, time) {
 const displacement = [0, 0, 0];
 const anchor = Math.min(1, Math.max(0, -point[2] / .25)) * Math.min(1, Math.max(0, point[1] / .25));
 for (const hit of impacts) {
  const elapsed = time - hit.time;
  if (elapsed <= 0 || elapsed > 2) continue;
  const distance = Math.hypot(...point.map((v, i) => v - hit.p[i]));
  const arrival = elapsed - distance / 7;
  if (arrival <= 0) continue;
  const pulse = Math.sin(arrival * 17) * Math.exp(-arrival * 3.8);
  const amount = anchor * hit.strength * pulse * Math.exp(-distance * distance / 1.1);
  for (let i = 0; i < 3; i++) displacement[i] += hit.normal[i] * amount;
 }
 return displacement;
}

// A slightly slack hanging net, with continuous seams and fixed mouth/floor.
export function netRestPoint([x, y, z]) {
 const depth = Math.max(0, Math.min(1, -z / 1.1));
 const width = Math.max(0, 1 - (x / 1.5) ** 2);
 const height = Math.max(0, Math.sin(Math.PI * y / 2));
 return [x + .035 * (x / 1.5) * depth * height,
  y - .075 * Math.sin(Math.PI * depth) * width * (y / 2),
  z - .065 * depth * width * height];
}
