export interface PhotoMeta {
  camera?: string; exposure?: string; aperture?: string; iso?: number | string;
  focal?: string; size?: string; file?: string;
}

export interface Card {
  id: string;
  rot: number;          // tilt on the cork board, degrees
  pin: string;          // pin color on the cork board
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
  trip: string;         // name of the story this photo belongs to, '' = none
  seq: number;          // position in its story (strings run in this order)
  pinColor: string;     // map pin border color, '' = default
  pinIcon: string;      // emoji badge on the map pin, '' = none
  cover: boolean;       // the photo shown on the pin when several share a place
  look: Look;           // retro photo filter
  stamp: boolean;       // old-digicam date stamp in the corner
  visibility: Visibility; // who can see it: only you, people who follow you, or anyone with your link
  owner: string;        // account id; '' for photos made before signing in
  imgPath: string;      // where the image lives in cloud storage, '' until uploaded
  country: string;      // the country it was taken in, worked out from its location ('' when unknown)
  pinned: boolean;      // shown as a highlight at the top of the owner's profile
}

export type Look = 'none' | 'digicam' | 'film' | 'bw';

export type Visibility = 'private' | 'friends' | 'public';
