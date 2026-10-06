// Full-size photo viewer: wheel / pinch to zoom, drag to pan, double-click to zoom in.
const vw = document.getElementById('viewer') as HTMLElement;
const img = document.getElementById('vwImg') as HTMLImageElement;
const z = { s: 1, x: 0, y: 0, min: 1 };
const apply = () => { img.style.transform = `translate(${z.x}px,${z.y}px) scale(${z.s})`; };

function fit() {
  const W = vw.clientWidth, H = vw.clientHeight, w = img.naturalWidth, h = img.naturalHeight;
  if (!w) return;
  img.style.width = w + 'px'; img.style.height = h + 'px';
  z.min = z.s = Math.min(W / w, H / h);
  z.x = (W - w * z.s) / 2; z.y = (H - h * z.s) / 2; apply();
}
function zoomAt(f: number, cx: number, cy: number) {
  const ns = Math.min(z.min * 12, Math.max(z.min, z.s * f)), r = ns / z.s;
  z.x = cx - (cx - z.x) * r; z.y = cy - (cy - z.y) * r; z.s = ns; apply();
}
const centre = (): [number, number] => [vw.clientWidth / 2, vw.clientHeight / 2];

export const viewerIsOpen = () => !vw.hidden;
export const closeViewer = () => { vw.hidden = true; };
export function openViewer(src: string) { vw.hidden = false; img.src = src; if (img.complete) fit(); }

export function initViewer() {
  const $ = (id: string) => document.getElementById(id)!;
  vw.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
  $('zIn').onclick = () => zoomAt(1.4, ...centre());
  $('zOut').onclick = () => zoomAt(1 / 1.4, ...centre());
  $('zReset').onclick = fit;
  $('vwClose').onclick = closeViewer;
  img.onload = fit;
  window.addEventListener('resize', () => { if (!vw.hidden) fit(); });

  const ptrs = new Map<number, PointerEvent>(); let pinch = 0;
  vw.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('button')) return;
    vw.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e); pinch = 0;
  });
  vw.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    ptrs.set(e.pointerId, e);
    if (ptrs.size === 1) { z.x += e.clientX - prev.clientX; z.y += e.clientY - prev.clientY; apply(); }
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch) zoomAt(d / pinch, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      pinch = d;
    }
  });
  for (const t of ['pointerup', 'pointercancel']) vw.addEventListener(t, e => { ptrs.delete((e as PointerEvent).pointerId); pinch = 0; });
  vw.addEventListener('dblclick', e => zoomAt(2, e.clientX, e.clientY));
}
