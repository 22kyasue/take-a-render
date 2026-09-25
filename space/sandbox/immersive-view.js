const panel = document.querySelector('.replay-panel');
const stage = document.getElementById('stage');
const orbit = document.getElementById('touch-orbit');
const toggle = document.createElement('button');
toggle.id = 'immersive-toggle'; toggle.textContent = '全画面 ⛶';
toggle.setAttribute('aria-label', 'サンドボックスを全画面にする');
toggle.setAttribute('aria-pressed', 'false'); stage.append(toggle);
let active = false, scrollY = 0, previousOrbit = false, previousFocus;
const outside = [...document.querySelectorAll('main > :not(.replay-panel), .app-header')];
const priorInert = new Map();
const transport = panel.querySelector('.timeline');
const transportSize = new ResizeObserver(() => {
 panel.style.setProperty('--transport-height', `${transport.getBoundingClientRect().height}px`);
});
transportSize.observe(transport);

function setImmersive(value) {
 if (active === value) return;
 active = value;
 if (active) {
  scrollY = window.scrollY; previousFocus = document.activeElement;
  previousOrbit = orbit.getAttribute('aria-pressed') === 'true';
  if (!previousOrbit) orbit.click();
  for (const element of outside) { priorInert.set(element, element.inert); element.inert = true; }
  document.body.style.setProperty('--immersive-scroll-top', `${-scrollY}px`);
 } else {
  for (const [element, inert] of priorInert) element.inert = inert;
  priorInert.clear();
  if ((orbit.getAttribute('aria-pressed') === 'true') !== previousOrbit) orbit.click();
 }
 document.body.classList.toggle('immersive', active);
 panel.setAttribute('aria-label', active ? '全画面サンドボックス' : 'サンドボックス');
 toggle.textContent = active ? '閉じる ×' : '全画面 ⛶';
 toggle.setAttribute('aria-label', active ? '全画面を閉じる' : 'サンドボックスを全画面にする');
 toggle.setAttribute('aria-pressed', String(active));
 if (active) toggle.focus({preventScroll:true});
 else {
  window.scrollTo(0, scrollY);
  previousFocus?.focus({preventScroll:true});
 }
}

toggle.addEventListener('click', () => setImmersive(!active));
document.addEventListener('keydown', event => {
 if (event.key === 'Escape' && active) { setImmersive(false); event.preventDefault(); }
 if (event.key === 'Tab' && active) {
  const focusable = [...panel.querySelectorAll('button, input, select, a[href]')].filter(element => !element.disabled && element.getClientRects().length > 0);
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { last?.focus(); event.preventDefault(); }
  else if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
 }
});
// CSS fullscreen works on iPhone Safari as well as browsers with no element
// Fullscreen API. The dynamic viewport follows the browser's address bar.
if (matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 600) setImmersive(true);
