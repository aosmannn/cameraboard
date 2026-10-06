import * as exifr from 'exifr/dist/lite.esm.mjs';
import type { Card } from './types';

export const PINS = ['#d6453d', '#2f7dd1', '#2e9e5b', '#e8b422', '#8e44ad'];

export const blankCard = (i: number): Card => ({
  id: crypto.randomUUID(), rot: +(Math.random() * 6 - 3).toFixed(1), pin: PINS[i % PINS.length],
  img: null, title: '', story: '', date: '', likes: 0, liked: false, meta: {}, lat: null, lng: null, place: ''
});

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
