import { COACHING_CUES, cueAt } from './coaching-cues.js';

export function createCoaching({master, seek}) {
 const panel = document.createElement('section');
 panel.className = 'coach-panel'; panel.setAttribute('aria-label', '場面ごとの解説');
 panel.innerHTML = `<div class="coach-toolbar"><span class="coach-label">PLAY NOTES <strong>解説</strong></span><div class="coach-modes" role="group" aria-label="解説の表示方法"><button data-coach-mode="card">カード</button><button data-coach-mode="subtitle">字幕</button><button data-coach-mode="steps">ステップ</button><button data-coach-mode="off">非表示</button></div></div><div class="coach-content"><div class="coach-card"><div class="coach-meta"><span class="coach-position"></span><span class="coach-time"></span></div><h2 class="coach-title"></h2><p class="coach-copy"></p></div><ol class="coach-steps" aria-label="5つの解説"></ol><div class="coach-navigation"><button class="coach-start">解説から再生 ↗</button><span>時刻を選んで、止めて読む</span></div><div class="coach-cues" role="group" aria-label="解説の時刻"></div></div>`;
 document.querySelector('.replay-panel').append(panel);
 const modes = ['card','subtitle','steps','off'];
 let mode = 'card', active = -2, lastDisabled;
 try { const stored = localStorage.getItem('take-a-coaching-mode'); if (modes.includes(stored)) mode = stored; } catch {}
 const caption = document.createElement('div'); caption.className = 'coach-subtitle'; caption.hidden = true;
 document.getElementById('stage').append(caption);
 const sourceCaption = document.createElement('div'); sourceCaption.className = 'coach-source-caption'; sourceCaption.hidden = true;
 document.querySelector('.source-transport').before(sourceCaption);
 const previewCaption = document.createElement('div'); previewCaption.className = 'coach-source-caption'; previewCaption.hidden = true;
 document.getElementById('preview-video').after(previewCaption);
 const comparisonCaption = document.createElement('div'); comparisonCaption.className = 'coach-source-caption'; comparisonCaption.hidden = true;
 document.getElementById('compare-grid').after(comparisonCaption);
 const captions = [caption,sourceCaption,previewCaption,comparisonCaption];
 const cueButtons = [], stepButtons = [];
 const number = i => String(i + 1).padStart(2,'0');
 for (const [i,cue] of COACHING_CUES.entries()) {
  const button = document.createElement('button');
  button.textContent = `${number(i)} · ${cue.time.toFixed(2)}`;
  button.setAttribute('aria-label', `${cue.time.toFixed(2)}秒 ${cue.title}で停止`);
  button.onclick = () => { seek(cue.time); update(); };
  panel.querySelector('.coach-cues').append(button); cueButtons.push(button);
  const row = document.createElement('li'), step = document.createElement('button');
  step.innerHTML = `<span class="coach-step-index">${number(i)}</span><span><strong>${cue.title}</strong><span class="coach-step-copy">${cue.text}</span></span><time>${cue.time.toFixed(2)}</time>`;
  step.setAttribute('aria-label', `${cue.time.toFixed(2)}秒 ${cue.text} この場面で停止`);
  step.onclick = button.onclick; row.append(step); panel.querySelector('.coach-steps').append(row); stepButtons.push(step);
 }
 panel.querySelector('.coach-start').onclick = () => {
  if (document.getElementById('play').disabled) return;
  seek(COACHING_CUES[0].time); master.play(); update();
 };
 function setMode(value) {
  mode = value; panel.dataset.mode = mode;
  document.querySelector('.replay-panel').dataset.coaching = mode;
  for (const button of panel.querySelectorAll('[data-coach-mode]')) button.setAttribute('aria-pressed', String(button.dataset.coachMode === mode));
  try { localStorage.setItem('take-a-coaching-mode', mode); } catch {}
  active = -2; update();
 }
 panel.querySelectorAll('[data-coach-mode]').forEach(button => button.onclick = () => setMode(button.dataset.coachMode));
 function update() {
  const disabled = document.getElementById('play').disabled;
  if (disabled !== lastDisabled) {
   lastDisabled = disabled;
   for (const button of [...cueButtons,...stepButtons,panel.querySelector('.coach-start')]) button.disabled = disabled;
  }
  const index = cueAt(master.currentTime);
  if (index === active) return;
  active = index; panel.dataset.activeCue = String(index);
  const cue = COACHING_CUES[index];
  panel.querySelector('.coach-position').textContent = cue ? `POINT ${number(index)} / 05` : '5つのプレーポイント';
  panel.querySelector('.coach-time').textContent = cue ? `${cue.time.toFixed(2)} s` : 'START 4.36 s';
  panel.querySelector('.coach-title').textContent = cue?.title ?? '動きの理由を、場面ごとに。';
  panel.querySelector('.coach-copy').textContent = cue?.text ?? '4.36秒から解説が切り替わります。時刻を選ぶと、その場面で止めて確認できます。';
  for (const [i,button] of [...cueButtons.entries(),...stepButtons.entries()]) {
   if (i === index) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
  }
  for (const surface of captions) {
   surface.hidden = !cue || mode === 'off' || (surface === caption && mode !== 'subtitle');
   surface.textContent = cue ? `${number(index)}  ${cue.text}` : '';
  }
 }
 // Fullscreen has overlay controls; measure their actual height so captions
 // stay above them after rotation, text wrapping and viewport changes.
 const replay = document.querySelector('.replay-panel'), timeline = document.querySelector('.timeline'), views = document.querySelector('.viewbar');
 const measure = () => {
  replay.style.setProperty('--coach-controls-height', `${timeline.getBoundingClientRect().height + views.getBoundingClientRect().height + 32}px`);
  replay.style.setProperty('--coach-timeline-height', `${timeline.getBoundingClientRect().height}px`);
  replay.style.setProperty('--coach-panel-height', `${panel.getBoundingClientRect().height}px`);
 };
 const observer = new ResizeObserver(measure); [panel,timeline,views].forEach(element => observer.observe(element));
 setMode(mode);
 return {update};
}
