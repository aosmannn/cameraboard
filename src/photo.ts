import * as exifr from 'exifr/dist/lite.esm.mjs';
import type { Card } from './types';

export const PINS = ['#d6453d', '#2f7dd1', '#2e9e5b', '#e8b422', '#8e44ad'];

export const blankCard = (i: number): Card => ({
  id: crypto.randomUUID(), rot: +(Math.random() * 6 - 3).toFixed(1), pin: PINS[i % PINS.length],
  img: null, title: '', story: '', date: '', likes: 0, liked: false, meta: {}, lat: null, lng: null, place: '',
  trip: '', seq: 0, pinColor: '', pinIcon: '', cover: false, look: 'none', stamp: false,
  shared: false, owner: '', imgPath: ''
});

/** Fills in fields that older saved boards don't have. */
export const normalize = (c: Partial<Card>, i: number): Card => ({ ...blankCard(i), ...c });

const fmtExposure = (t?: number) => !t ? '' : t >= 1 ? t + ' s' : '1/' + Math.round(1 / t) + ' s';

async function readExif(file: File) {
  try {
    return await exifr.parse(file, { gps: true, pick: ['Make', 'Model', 'DateTimeOriginal', 'ExposureTime',
      'FNumber', 'ISO', 'FocalLength', 'latitude', 'longitude'] }) || {};
  } catch { return {}; }
}

function downscale(file: File, max = 1800): Promise<{ data: string; w: number; h: number }> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.width, im.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
      cv.getContext('2d')!.drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      res({ data: cv.toDataURL('image/jpeg', 0.86), w: im.width, h: im.height });
    };
    im.onerror = () => rej(new Error('Could not read image'));
    im.src = url;
  });
}

const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Reads a photo file into a card: shrinks the image and copies EXIF details. */
export async function fillCard(c: Card, f: File): Promise<void> {
  const [ex, img] = await Promise.all([readExif(f), downscale(f)]);
  c.img = img.data;
  c.meta = { camera: [ex.Make, ex.Model].filter(Boolean).join(' '), exposure: fmtExposure(ex.ExposureTime),
    aperture: ex.FNumber ? 'f/' + ex.FNumber : '', iso: ex.ISO || '', focal: ex.FocalLength ? ex.FocalLength + ' mm' : '',
    size: `${img.w} × ${img.h}`, file: f.name };
  c.date = toLocalInput(new Date(ex.DateTimeOriginal || f.lastModified));
  if (ex.latitude != null) { c.lat = ex.latitude; c.lng = ex.longitude; c.place = c.place || 'From photo GPS'; }
  if (!c.title) c.title = f.name.replace(/\.[^.]+$/, '');
}

export const cameraName = (c: Card) => c.meta?.camera?.trim() || 'Unknown camera';
export const dayOf = (c: Card) => c.date ? c.date.slice(0, 10) : '';
export const timeOf = (c: Card) => c.date ? new Date(c.date).getTime() : 0;

/** Old digicams burned the date into the corner, like  '26 10 06 */
export function stampText(c: Card): string {
  if (!c.date) return '';
  const d = new Date(c.date);
  const p = (n: number) => String(n).padStart(2, '0');
  return `'${String(d.getFullYear()).slice(2)} ${p(d.getMonth() + 1)} ${p(d.getDate())}`;
}

/** Two cards are "at the same place" when they fall in the same ~1 km grid cell. */
export const placeKey = (c: Card) => `${c.lat!.toFixed(2)},${c.lng!.toFixed(2)}`;
