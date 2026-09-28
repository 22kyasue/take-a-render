// A shared exit path for native fullscreen and page-contained expansion.
export function createFullscreen(currentTarget) {
  const root = document.documentElement;
  const buttons = [...document.querySelectorAll('[data-fullscreen]')];
  let expanded = null, previousFocus = null, savedScroll = 0, requestEpoch = 0, pending = false;
  const inertElements = new Map();
  const nativeElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const targetFor = button => button.dataset.fullscreen === 'current' ? currentTarget() : document.getElementById(button.dataset.fullscreen);
  function refresh() {
    const active = nativeElement() || expanded;
    for (const button of buttons) {
      const on = Boolean(active && (active === root || active === targetFor(button)));
      button.setAttribute('aria-pressed', String(on));
      button.querySelector('span').textContent = on ? '全画面を閉じる' : '全画面';
      button.setAttribute('aria-label', on ? '全画面を閉じる' : '全画面で見る');
    }
  }
  function isolate(target) {
    // Only siblings along the ancestor path become inert, never the target.
    for (let node = target; node && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement?.children || []) {
        if (sibling !== node && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) {
          inertElements.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
    }
  }
  function expand(target) {
    expanded = target;
    target.classList.add('expanded');
    root.classList.add('in-app-fullscreen');
    isolate(target);
    refresh();
    target.querySelector('[data-fullscreen]')?.focus({ preventScroll: true });
    const notice = document.getElementById('fullscreenNotice');
    if (notice) {
      target === root ? document.body.append(notice) : target.append(notice);
      notice.inert = false;
      notice.textContent = 'このブラウザではページ内で拡大表示しています。';
      notice.hidden = false;
      clearTimeout(expand.timer);
      expand.timer = setTimeout(() => { notice.hidden = true; }, 4000);
    }
  }
  function restore() {
    for (const [element, prior] of inertElements) element.inert = prior;
    inertElements.clear();
    const notice = document.getElementById('fullscreenNotice');
    if (notice) { notice.hidden = true; document.body.append(notice); }
    window.scrollTo(0, savedScroll);
    previousFocus?.focus({ preventScroll: true });
    previousFocus = null;
    refresh();
  }
  async function exit() {
    requestEpoch++;
    pending = false;
    if (expanded) {
      expanded.classList.remove('expanded');
      expanded = null;
      root.classList.remove('in-app-fullscreen');
      restore();
    }
    if (nativeElement()) {
      try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
      catch { refresh(); }
    }
  }
  async function enter(target = currentTarget(), options = {}) {
    if (nativeElement() === target || expanded === target) return;
    if (nativeElement() || expanded) await exit();
    const epoch = ++requestEpoch;
    previousFocus = document.activeElement;
    savedScroll = window.scrollY;
    const request = target.requestFullscreen || target.webkitRequestFullscreen;
    if (!request || options.native === false) { expand(target); return; }
    pending = true;
    try {
      await request.call(target, { navigationUI: 'hide' });
      if (epoch !== requestEpoch) {
        if (nativeElement() === target) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        return;
      }
      refresh();
      target.querySelector('[data-fullscreen]')?.focus({ preventScroll: true });
    } catch { if (epoch === requestEpoch) expand(target); }
    finally { if (epoch === requestEpoch) pending = false; }
  }
  async function toggle(target = currentTarget()) {
    if (nativeElement() || expanded || pending) { await exit(); return; }
    await enter(target);
  }
  buttons.forEach(button => button.addEventListener('click', () => toggle(targetFor(button))));
  function onChange() {
    if (!nativeElement() && !expanded) restore();
    else refresh();
  }
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && expanded) { event.preventDefault(); exit(); }
    if (event.key === 'Tab' && expanded) {
      const focusable = [...expanded.querySelectorAll('button,a[href],input,select,iframe,[tabindex="0"]')].filter(element => !element.disabled && !element.closest('[inert]') && element.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  refresh();
  return { toggle, enter, exit, refresh };
}
