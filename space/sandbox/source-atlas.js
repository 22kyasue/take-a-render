import { syncSource } from './capture-sources.js';

// Four pre-aligned views share one decoder and one presented video frame.
export function createSourceAtlas() {
 const video = document.createElement('video');
 video.id = 'source-video'; video.muted = true; video.playsInline = true; video.preload = 'auto'; video.loop = true;
 video.src = './proxies/four-angles.mp4'; video.setAttribute('aria-hidden', 'true');
 video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0';
 document.body.append(video);
 const surfaces = new Map(), item = { video, offset: 0 };
 let lastPaint = -1;
 function paint(time = video.currentTime) {
  if (video.readyState < 2) return;
  const width = video.videoWidth / 2, height = video.videoHeight / 2;
  for (const [canvas, slot] of surfaces) {
   canvas.getContext('2d').drawImage(video, slot % 2 * width, Math.floor(slot / 2) * height, width, height, 0, 0, canvas.width, canvas.height);
   canvas.dataset.mediaTime = time.toFixed(4);
  }
  lastPaint = video.currentTime;
 }
 if (video.requestVideoFrameCallback) {
  const frame = (_, metadata) => { paint(metadata.mediaTime); video.requestVideoFrameCallback(frame); };
  video.requestVideoFrameCallback(frame);
 }
 video.addEventListener('seeked', () => paint());
 video.addEventListener('loadeddata', () => paint());
 video.addEventListener('error', () => document.querySelectorAll('.source-error').forEach(element => { element.hidden = false; }));
 return {
  video,
  bind(canvas, slot) { canvas.width = 640; canvas.height = 440; surfaces.set(canvas, slot); paint(); },
  unbind(canvas) { surfaces.delete(canvas); },
  update(master) {
   if (document.hidden) { video.pause(); return; }
   syncSource(item, master);
   if (!video.requestVideoFrameCallback && lastPaint !== video.currentTime) paint();
  },
  retry() { item.failedPlay = false; },
 };
}
