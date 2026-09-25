// Viewport and input capability also cover rotation and iPad split-screen.
export function displayProfile({width, height, touch, dpr = 1, quality = 'auto', stageWidth = 0, stageHeight = 0}) {
 const kind = touch ? (Math.min(width, height) < 600 ? 'phone' : 'tablet') : 'desktop';
 const shadows = quality === 'high' || (quality === 'auto' && kind === 'desktop');
 const cap = quality === 'light' ? .9 : quality === 'high' ? 1.75 : kind === 'phone' ? 1.25 : 1.5;
 const budget = touch ? 1500000 : 2500000;
 const area = stageWidth * stageHeight;
 const pixelRatio = Math.min(dpr, cap, area > 0 ? Math.sqrt(budget / area) : cap);
 return {kind, shadows, pixelRatio};
}
