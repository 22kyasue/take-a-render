export function createPlaybackClock(duration, now = () => performance.now()) {
 const events = new EventTarget();
 let position = 0, anchor = now(), rate = 1, paused = true, ended = false;
 const clock = {
  duration, loop: true,
  addEventListener: (...args) => events.addEventListener(...args),
  get currentTime() {
   if (paused) return position;
   const current = position + (now() - anchor) / 1000 * rate;
   if (current < duration) return current;
   if (clock.loop) { position = current % duration; anchor = now(); return position; }
   position = duration; paused = true; ended = true;
   events.dispatchEvent(new Event('pause')); events.dispatchEvent(new Event('ended'));
   return position;
  },
  set currentTime(value) { position = Math.max(0, Math.min(duration, value)); anchor = now(); ended = false; },
  get playbackRate() { return rate; },
  set playbackRate(value) { const current = clock.currentTime; position = current; anchor = now(); rate = value; },
  get paused() { return paused; },
  get ended() { return ended; },
  play() { if (!paused) return; if (ended) position = 0; anchor = now(); paused = false; ended = false; events.dispatchEvent(new Event('play')); },
  pause() { if (paused) return; position = clock.currentTime; paused = true; events.dispatchEvent(new Event('pause')); },
 };
 return clock;
}
