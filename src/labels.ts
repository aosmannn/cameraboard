// Draws map names (countries, states, cities, counties, seas) on one canvas, skipping any name that would
// overlap one already drawn, so the map stays readable at every zoom.
import L from 'leaflet';

export type Kind = 'sea' | 'country' | 'city' | 'state' | 'county';
export interface Item { text: string; lat: number; lng: number; min: number; max: number; size?: number }
export interface LabelColors { text: string; halo: string; sea: string }

const ORDER: Kind[] = ['sea', 'country', 'city', 'state', 'county'];

export class Labels {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private items: Record<Kind, Item[]> = { sea: [], country: [], city: [], state: [], county: [] };
  private raf = 0;
  private colors: LabelColors = { text: '#222', halo: '#fff', sea: '#357' };

  constructor(private map: L.Map) {
    map.createPane('labelPane').style.zIndex = '450';
    const pane = map.getPane('labelPane')!;
    pane.style.pointerEvents = 'none';
    pane.append(this.canvas);
    map.on('move zoom moveend zoomend resize viewreset', () => this.schedule());
    map.on('zoomanim', () => { this.canvas.style.opacity = '0'; });
    map.on('zoomend', () => { this.canvas.style.opacity = '1'; });
    this.schedule();
  }

  set(kind: Kind, items: Item[]) { this.items[kind] = items; this.schedule(); }
  setColors(c: LabelColors) { this.colors = c; this.schedule(); }
  private schedule() { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(() => this.draw()); }

  private draw() {
    const { map, ctx, canvas } = this;
    const size = map.getSize(), dpr = window.devicePixelRatio || 1;
    if (canvas.width !== size.x * dpr || canvas.height !== size.y * dpr) {
      canvas.width = size.x * dpr; canvas.height = size.y * dpr;
      canvas.style.width = size.x + 'px'; canvas.style.height = size.y + 'px';
    }
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    const z = map.getZoom(), b = map.getBounds().pad(0.05);
    const south = b.getSouth(), north = b.getNorth(), west = b.getWest(), east = b.getEast();
    const { text, halo, sea } = this.colors;

    // spatial hash of drawn label boxes
    const CELL = 80, grid = new Map<string, number[][]>();
    const free = (x0: number, y0: number, x1: number, y1: number) => {
      for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
        for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++)
          for (const r of grid.get(gx + ',' + gy) ?? []) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false;
      return true;
    };
    const claim = (x0: number, y0: number, x1: number, y1: number) => {
      const r = [x0, y0, x1, y1];
      for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
        for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
          const k = gx + ',' + gy; (grid.get(k) ?? grid.set(k, []).get(k)!).push(r);
        }
    };

    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const kind of ORDER) {
      for (const it of this.items[kind]) {
        if (z < it.min || z > it.max || it.lat < south || it.lat > north || it.lng < west || it.lng > east) continue;
        const p = map.latLngToContainerPoint([it.lat, it.lng]);
        let font = '', fill = text, label = it.text, dot = false, space = '0px';
        if (kind === 'country') { font = '700 12px "DM Sans", sans-serif'; label = label.toUpperCase(); space = '1.4px'; }
        else if (kind === 'state') { font = '500 10.5px "DM Sans", sans-serif'; label = label.toUpperCase(); space = '1.1px'; fill = text + 'b8'; }
        else if (kind === 'city') { font = `${(it.size ?? 12) > 13 ? 600 : 500} ${it.size ?? 12}px "DM Sans", sans-serif`; dot = true; }
        else if (kind === 'county') { font = '400 10px "DM Sans", sans-serif'; fill = text + '99'; }
        else { font = 'italic 500 13px "DM Sans", serif'; fill = sea; space = '2px'; }
        ctx.font = font; (ctx as any).letterSpacing = space;
        const w = ctx.measureText(label).width, h = 14;
        const x0 = dot ? p.x + 6 : p.x - w / 2, y0 = p.y - h / 2;
        const bx0 = dot ? p.x - 4 : x0 - 3, bx1 = x0 + w + 3;
        if (!free(bx0, y0 - 1, bx1, y0 + h + 1)) continue;
        claim(bx0, y0 - 1, bx1, y0 + h + 1);
        if (dot) {
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, 7); ctx.fillStyle = text; ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = halo; ctx.stroke();
        }
        ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.strokeText(label, x0, p.y);
        ctx.fillStyle = fill; ctx.fillText(label, x0, p.y);
      }
    }
  }
}
