import { CAPTURE_SOURCES } from './capture-sources.js';

export function createSourceComparison(master, seek, atlas) {
 const dialog = document.createElement('dialog');
 dialog.setAttribute('aria-label', 'Take Aの4方向比較');
 dialog.className = 'source-comparison';
 dialog.innerHTML = `<div class="comparison-header"><strong>Take A · 4方向の映像</strong><button id="compare-play">再生</button><button id="compare-close">閉じる</button></div><p class="comparison-description">4方向を同じフレームで表示します。撮影時刻の同期補正は推定値です。</p><div id="compare-grid"></div><label class="comparison-transport">比較する時刻 <input id="compare-seek" aria-label="4方向の再生位置" type="range" min="0" max="7.983333" step="0.016667" value="0"></label>`;
 document.body.append(dialog);
 const surfaces = CAPTURE_SOURCES.map((source, slot) => {
  const panel = document.createElement('div'), caption = document.createElement('div'), canvas = document.createElement('canvas');
  caption.textContent = `${source.number} · ${source.label}`;
  canvas.setAttribute('aria-label', `${source.label}のTake A映像`);
  panel.append(caption, canvas); dialog.querySelector('#compare-grid').append(panel);
  return { canvas, slot };
 });
 dialog.querySelector('#compare-close').onclick = () => dialog.close();
 dialog.querySelector('#compare-play').onclick = () => document.getElementById('play').click();
 dialog.querySelector('#compare-seek').oninput = event => seek(Number(event.target.value));
 dialog.addEventListener('close', () => surfaces.forEach(({canvas}) => atlas.unbind(canvas)));
 return {
  update() {
   if (!dialog.open) return;
   dialog.querySelector('#compare-seek').value = master.currentTime;
   dialog.querySelector('#compare-play').textContent = master.paused ? '再生' : '一時停止';
  },
  open() { surfaces.forEach(({canvas,slot}) => atlas.bind(canvas,slot)); dialog.showModal(); },
 };
}
