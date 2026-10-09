import type L from 'leaflet';
import { LANDMARKS, MIN_LANDMARK_ZOOM, byId } from './registry';

export { LANDMARKS };

/**
 * Three.js is big, so it only downloads once someone zooms in far enough to
 * see a landmark (or opens one from search). Everything else loads at once.
 */
export function initLandmarks(map: L.Map) {
  let layerStarted = false;
  const showOnMap = (id: string) => {
    const def = byId(id);
    if (def) map.flyTo([def.lat, def.lon], Math.max(map.getZoom(), def.minZoom + 2), { duration: 1.2 });
  };
  const open = (id: string) => { void import('./viewer3d').then(m => m.openViewer(id, showOnMap)); };
  const start = () => {
    if (layerStarted || map.getZoom() < MIN_LANDMARK_ZOOM) return;
    layerStarted = true;
    void import('./layer').then(m => { new m.LandmarkLayer(map, open); });
  };
  map.on('zoomend moveend', start);
  start();
  return { flyTo: showOnMap, open };
}
