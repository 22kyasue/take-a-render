import { createFullscreen } from './fullscreen.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const frame = $('#spaceFrame');
let currentChapter = 'intro';
const fullscreen = createFullscreen(() => ({ cams: $('#camWorkspace'), space: $('#space'), film: $('#player') }[currentChapter] || document.documentElement));

function selectButtons(selector, predicate) {
  $$(selector).forEach(button => {
    const active = predicate(button);
    button.classList.toggle('on', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function notify(message) {
  const notice = $('#fullscreenNotice');
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { notice.hidden = true; }, 4500);
}

// Four cameras share a transport and stay on the same source time.
const cams = $$('.cam video');
const camSeek = $('#camSeek'), camPlayButton = $('#camPlay');
let camPlayback = 0;
function refreshCams() {
  const duration = Number.isFinite(cams[0].duration) ? cams[0].duration : 8;
  camSeek.max = duration;
  camSeek.value = cams[0].currentTime;
  $('#camTime').innerHTML = `${cams[0].currentTime.toFixed(2)} <span>/ ${duration.toFixed(2)} s</span>`;
  const playing = !cams[0].paused;
  camPlayButton.textContent = playing ? 'Ⅱ' : '▶';
  camPlayButton.setAttribute('aria-label', playing ? '4視点を一時停止' : '4視点を再生');
}
function pauseCams() {
  camPlayback++;
  cams.forEach(video => video.pause());
  refreshCams();
}
async function playCams() {
  const version = ++camPlayback;
  try {
    await Promise.all(cams.map(video => video.play()));
    if (version !== camPlayback || currentChapter !== 'cams') return;
    refreshCams();
  } catch (error) {
    if (version !== camPlayback) return;
    pauseCams();
    if (error.name !== 'AbortError') notify('映像を読み込めませんでした。もう一度再生してください。');
  }
}
camPlayButton.addEventListener('click', () => cams[0].paused ? playCams() : pauseCams());
camSeek.addEventListener('input', () => {
  const time = Number(camSeek.value);
  pauseCams();
  cams.forEach(video => { video.currentTime = time; });
  refreshCams();
});
$$('#camSpeed button').forEach(button => button.addEventListener('click', () => {
  cams.forEach(video => { video.playbackRate = Number(button.dataset.speed); });
  selectButtons('#camSpeed button', candidate => candidate === button);
}));
cams[0].addEventListener('timeupdate', () => {
  refreshCams();
  cams.slice(1).forEach(video => {
    if (video.readyState >= 1 && Math.abs(video.currentTime - cams[0].currentTime) > .08) video.currentTime = cams[0].currentTime;
  });
});
cams[0].addEventListener('ended', () => {
  if (currentChapter !== 'cams') return;
  cams.forEach(video => { video.currentTime = 0; });
  playCams();
});
$$('.cam video').forEach(video => video.addEventListener('click', () => cams[0].paused ? playCams() : pauseCams()));

// Unreal film: keep the original A/B comparison and frame stepping.
const A = $('#vA'), B = $('#vB'), player = $('#player'), scrub = $('#scrub');
const FPS = 30, LAST_FRAME = 149;
let mode = 'A', main = A, filmPlayback = 0;
function refreshFilm() {
  scrub.value = Math.min(LAST_FRAME, Math.round(main.currentTime * FPS));
  $('#time').innerHTML = `${main.currentTime.toFixed(2)} <span>/ 5.00 s</span>`;
  player.classList.toggle('playing', !main.paused);
  $('#play').textContent = main.paused ? '▶' : 'Ⅱ';
  $('#play').setAttribute('aria-label', main.paused ? 'Unreal映像を再生' : 'Unreal映像を一時停止');
}
function pauseFilm() { filmPlayback++; [A, B].forEach(video => video.pause()); refreshFilm(); }
async function playFilm() {
  const version = ++filmPlayback;
  try {
    await Promise.all((mode === 'AB' ? [A, B] : [main]).map(video => video.play()));
  } catch (error) {
    if (version !== filmPlayback) return;
    pauseFilm();
    if (error.name !== 'AbortError') notify('映像を読み込めませんでした。もう一度再生してください。');
  }
}
function toggleFilm() { main.paused ? playFilm() : pauseFilm(); }
function seekFilm(frameNumber) {
  const time = Math.max(0, Math.min(LAST_FRAME, frameNumber)) / FPS + .001;
  [A, B].forEach(video => { video.currentTime = time; });
  refreshFilm();
}
function stepFilm(delta) { pauseFilm(); seekFilm(Math.round(main.currentTime * FPS) + delta); }
function setMode(nextMode) {
  const time = main.currentTime, playing = !main.paused;
  pauseFilm();
  mode = nextMode;
  main = mode === 'B' ? B : A;
  player.classList.toggle('compare', mode === 'AB');
  A.style.display = mode === 'B' ? 'none' : 'block';
  B.style.display = mode === 'A' ? 'none' : 'block';
  B.style.clipPath = mode === 'AB' ? `inset(0 0 0 ${$('#wipe').getAttribute('aria-valuenow')}%)` : 'none';
  [A, B].forEach(video => { video.currentTime = time; });
  selectButtons('#source button', button => button.dataset.src === mode);
  if (playing) playFilm();
  refreshFilm();
}
$('#bigplay').addEventListener('click', playFilm);
$('#play').addEventListener('click', toggleFilm);
$('#prev').addEventListener('click', () => stepFilm(-1));
$('#next').addEventListener('click', () => stepFilm(1));
[A, B].forEach(video => {
  video.addEventListener('click', toggleFilm);
  video.addEventListener('dblclick', () => fullscreen.toggle(player));
  ['timeupdate', 'play', 'pause', 'seeked', 'loadedmetadata'].forEach(event => video.addEventListener(event, refreshFilm));
});
A.addEventListener('timeupdate', () => {
  if (mode === 'AB' && B.readyState >= 1 && Math.abs(B.currentTime - A.currentTime) > .08) B.currentTime = A.currentTime;
});
scrub.addEventListener('input', () => { const value = Number(scrub.value); pauseFilm(); seekFilm(value); });
$$('#speed button').forEach(button => button.addEventListener('click', () => {
  [A, B].forEach(video => { video.playbackRate = Number(button.dataset.speed); });
  selectButtons('#speed button', candidate => candidate === button);
}));
$$('#source button').forEach(button => button.addEventListener('click', () => setMode(button.dataset.src)));
const wipe = $('#wipe');
function setWipe(percent) {
  const value = Math.max(2, Math.min(98, percent));
  wipe.style.left = `${value}%`;
  B.style.clipPath = `inset(0 0 0 ${value}%)`;
  wipe.setAttribute('aria-valuenow', String(Math.round(value)));
}
wipe.addEventListener('pointerdown', event => { wipe.setPointerCapture(event.pointerId); });
wipe.addEventListener('pointermove', event => {
  if (!wipe.hasPointerCapture(event.pointerId)) return;
  const bounds = wipe.parentElement.getBoundingClientRect();
  setWipe((event.clientX - bounds.left) / bounds.width * 100);
});
wipe.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  setWipe(Number(wipe.getAttribute('aria-valuenow')) + (event.key === 'ArrowRight' ? 2 : -2));
});

// Keep the existing 3D runtime; make its replay fill the embedded viewport.
frame.addEventListener('load', () => {
  const content = frame.contentDocument;
  if (!content) return;
  const enableOrbit = () => {
    const orbit = content.getElementById('touch-orbit');
    const play = content.getElementById('play');
    if (!orbit || !play || play.disabled) return false;
    if (orbit.getAttribute('aria-pressed') !== 'true') orbit.click();
    return true;
  };
  if (!enableOrbit()) {
    const ready = new MutationObserver(() => { if (enableOrbit()) ready.disconnect(); });
    ready.observe(content.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  }
  const collapseCoaching = () => {
    const panel = content.querySelector('.coach-panel');
    if (!panel || panel.closest('details')) return Boolean(panel);
    const details = content.createElement('details');
    details.className = 'embedded-coach';
    const summary = content.createElement('summary');
    summary.textContent = 'プレーの解説';
    details.append(summary);
    panel.before(details);
    details.append(panel);
    return true;
  };
  if (!collapseCoaching()) {
    const observer = new MutationObserver(() => { if (collapseCoaching()) observer.disconnect(); });
    observer.observe(content.body, { childList: true, subtree: true });
  }
  content.addEventListener('keydown', event => {
    if (event.key === 'Escape') fullscreen.exit();
  });
});
function pauseSpace() {
  const content = frame.contentDocument;
  const play = content?.getElementById('play');
  if (play && play.textContent.includes('停止')) play.click();
  content?.querySelectorAll('video').forEach(video => video.pause());
}
function go(chapter, gesture = false) {
  // Old shared orbit links land on the retained Unreal film.
  if (chapter === 'orbit') chapter = 'film';
  if (!['intro', 'cams', 'space', 'film'].includes(chapter)) chapter = 'intro';
  if (currentChapter !== chapter) fullscreen.exit();
  currentChapter = chapter;
  $$('.chapter').forEach(section => { section.hidden = section.id !== chapter; section.classList.toggle('on', section.id === chapter); });
  $$('.tab').forEach(link => {
    const active = link.dataset.ch === chapter;
    link.classList.toggle('on', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  if (chapter !== 'cams') pauseCams();
  if (chapter !== 'film') pauseFilm();
  if (chapter !== 'space') pauseSpace();
  if (chapter === 'space' && !frame.getAttribute('src')) frame.src = frame.dataset.src;
  if (location.hash !== `#${chapter}`) history.replaceState(null, '', `#${chapter}`);
  window.scrollTo(0, 0);
  fullscreen.refresh();
  if (chapter === 'space') fullscreen.enter($('#space'), { native: gesture });
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[href="#space"]');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  go('space', true);
});
window.addEventListener('hashchange', () => go(location.hash.slice(1)));
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest('input,select,textarea,button,a,[contenteditable=true],[role=slider]')) return;
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); fullscreen.toggle(); return; }
  if (currentChapter === 'film') {
    if (event.code === 'Space') { event.preventDefault(); toggleFilm(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); stepFilm(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); stepFilm(1); }
    else if (event.key.toLowerCase() === 'c') setMode(mode === 'AB' ? 'A' : 'AB');
  } else if (currentChapter === 'cams' && event.code === 'Space') {
    event.preventDefault(); cams[0].paused ? playCams() : pauseCams();
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { pauseCams(); pauseFilm(); pauseSpace(); } });
go(location.hash.slice(1));
