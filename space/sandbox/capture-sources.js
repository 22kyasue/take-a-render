export const CAPTURE_SOURCES = [
 { id: 'cam1_west', number: '01', label: '西側', color: '#82e6bd', offset: 0 },
 { id: 'cam2_goalback', number: '02', label: 'ゴール裏', color: '#f1be72', offset: .02141 },
 { id: 'cam3_east', number: '03', label: '東側', color: '#8bb9ff', offset: -.00156 },
 { id: 'cam4_side', number: '04', label: 'サイド', color: '#ccabff', offset: .00541 },
];

export function sourceTime(time, offset, duration = 8) {
 return Math.max(0, Math.min(Number.isFinite(duration) ? Math.max(0, duration - .001) : 7.983333, time - offset));
}

export function syncSource(item, master, force = false) {
 const { video, offset } = item;
 if (!video.readyState) return;
 const target = sourceTime(master.currentTime, offset, video.duration);
 const drift = target - video.currentTime;
 const exact = master.paused || force;
 const now = performance.now();
 if (!video.seeking && Math.abs(drift) > (exact ? .012 : .5) && (exact || now - (item.lastSeek ?? -Infinity) > 1000)) {
  video.currentTime = target; item.lastSeek = now;
 }
 // Correct ordinary drift by gently changing speed, not flushing the decoder.
 const correction = exact || Math.abs(drift) < .04 || Math.abs(drift) > .5 ? 1 : 1 + Math.sign(drift) * .05;
 const rate = master.playbackRate * correction;
 if (Math.abs(video.playbackRate - rate) > .001 || !Number.isFinite(video.playbackRate)) video.playbackRate = rate;
 if (master.paused || master.ended) video.pause();
 else if (video.paused && !item.pendingPlay && !item.failedPlay) {
  item.pendingPlay = true;
  video.play().catch(error => { if (error.name !== 'AbortError') { item.failedPlay = true; item.onError?.(); } }).finally(() => { item.pendingPlay = false; });
 }
}
