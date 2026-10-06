export interface PhotoMeta {
  camera?: string; exposure?: string; aperture?: string; iso?: number | string;
  focal?: string; size?: string; file?: string;
}

export interface Card {
  id: string;
  rot: number;          // tilt on the cork board, degrees
  pin: string;          // pin colour on the cork board
  img: string | null;   // data URL, null = empty placeholder
  title: string;
  story: string;
  date: string;         // datetime-local string
  likes: number;
  liked: boolean;
  meta: PhotoMeta;
  lat: number | null;
  lng: number | null;
  place: string;
  trip: string;         // trip / album name, '' = none
  pinColor: string;     // map pin border colour, '' = default
  pinIcon: string;      // emoji badge on the map pin, '' = none
  cover: boolean;       // the photo shown on the pin when several share a place
  look: Look;           // retro photo filter
  stamp: boolean;       // old-digicam date stamp in the corner
}

export type Look = 'none' | 'digicam' | 'film' | 'bw';
