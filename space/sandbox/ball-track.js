// Sample observed motion without extrapolating across unknown intervals.
export function sampleBallTrack(track, time) {
 if (!track || !Number.isFinite(time) || time < 0) return null;
 const position = time * track.fps;
 const index = Math.floor(position);
 const a = track.frames[index];
 if (!a) return null;
 const b = track.frames[index + 1];
 const alpha = position - index;
 const p = b ? a.p.map((v, axis) => v + (b.p[axis] - v) * alpha) : [...a.p];
 // The camera reconstruction has a small common floor-height offset. Preserve
 // original measured coordinates in JSON; apply this correction only to display.
 const radius = track.radius ?? .105;
 p[1] = Math.max(radius, p[1] + (track.display_floor_offset ?? 0));
 return { p, method: a.method, n_views: a.n_views };
}
