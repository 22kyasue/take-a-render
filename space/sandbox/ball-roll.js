import { sampleBallTrack } from './ball-track.js';

const identity = () => [0, 0, 0, 1];

function multiply(a, b) {
 const [x, y, z, w] = a, [bx, by, bz, bw] = b;
 const q = [w * bx + x * bw + y * bz - z * by,
  w * by - x * bz + y * bw + z * bx,
  w * bz + x * by - y * bx + z * bw,
  w * bw - x * bx - y * by - z * bz];
 const length = Math.hypot(...q);
 return q.map(v => v / length);
}

function partialRotation(segment, fraction) {
 const halfAngle = segment.angle * fraction / 2;
 const sine = Math.sin(halfAngle);
 return [segment.axis[0] * sine, 0, segment.axis[2] * sine, Math.cos(halfAngle)];
}

// Integrate once along the recorded path, not once per render frame. Playback
// speed, dropped frames, backward seeking and looping cannot accumulate drift.
export function createBallRollSampler(track, fieldRotation = 0) {
 const radius = track.radius ?? .105;
 if (!(radius > 0) || !Number.isFinite(radius) || !(track.fps > 0)) throw new Error('Invalid rolling track scale');
 const poses = [], segments = [];
 let orientation = identity();
 const cosine = Math.cos(fieldRotation), sine = Math.sin(fieldRotation);
 for (let i = 0; i < track.frames.length; i++) {
  poses.push([...orientation]);
  const a = sampleBallTrack(track, i / track.fps);
  const b = sampleBallTrack(track, (i + 1) / track.fps);
  // Allow 2 cm of reconstruction noise around floor contact. Flying motion
  // keeps its last orientation: airborne spin was not measured in this task.
  if (!a || !b || a.p[1] > radius + .02 || b.p[1] > radius + .02) continue;
  const dx = b.p[0] - a.p[0], dz = b.p[2] - a.p[2];
  const worldX = cosine * dx + sine * dz;
  const worldZ = -sine * dx + cosine * dz;
  const distance = Math.hypot(worldX, worldZ);
  if (distance < 1e-9) continue;
  const segment = { axis: [worldZ / distance, 0, -worldX / distance], angle: distance / radius };
  segments[i] = segment;
  orientation = multiply(partialRotation(segment, 1), orientation);
 }
 return time => {
  if (!sampleBallTrack(track, time)) return null;
  const position = time * track.fps, index = Math.floor(position);
  const segment = segments[index];
  return segment ? multiply(partialRotation(segment, position - index), poses[index]) : [...poses[index]];
 };
}
