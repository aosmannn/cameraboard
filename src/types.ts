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
}
