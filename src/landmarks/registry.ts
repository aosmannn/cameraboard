import type { LandmarkDef } from './types';

/** Phase 1 catalog — coordinates are standard references; verify if you adjust pins. */
export const LANDMARKS: LandmarkDef[] = [
  {
    id: 'eiffel',
    name: 'Eiffel Tower',
    lat: 48.8584,
    lon: 2.2945,
    archetype: 'custom',
    customId: 'eiffel',
    params: {},
    minZoom: 5,
    scale: 42,
  },
  {
    id: 'st-peters-dome',
    name: "St. Peter's Basilica",
    lat: 41.9022,
    lon: 12.4539,
    archetype: 'dome',
    params: { height: 1.05 },
    minZoom: 5,
    scale: 38,
  },
  {
    id: 'giza-pyramid',
    name: 'Great Pyramid of Giza',
    lat: 29.9792,
    lon: 31.1342,
    archetype: 'pyramid',
    params: { height: 1 },
    minZoom: 4,
    scale: 48,
  },
];
