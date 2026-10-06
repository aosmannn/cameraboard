# Cameraboard

A world map of your photos (built for a Sony Cyber-shot DSC-V1, works with any camera).

- **Map view:** photos are pins on a world map. Zoom in on a place, click a pin to open its card.
- **Board view:** the same photos as polaroids on a cork board.
- Add photos: EXIF (camera, date, exposure, ISO, GPS if present) is read automatically. The DSC-V1 has no GPS, so search a place or use "Pin on map".
- Each card has a story, date, likes, and a full-size zoomable viewer.
- Data is saved in your browser (IndexedDB). Use Export/Import to back up.

## Code layout (TypeScript + Vite)
- `src/main.ts` app: map, drawer, board view, upload and location flow
- `src/world.ts` the coloured world map, country names, cities and ocean labels
- `src/photo.ts` photo reading: shrink, EXIF, card defaults
- `src/viewer.ts` full-size zoom/pan viewer
- `src/storage.ts` IndexedDB save/load; `src/types.ts` the `Card` shape; `src/style.css` styles

## Run it
```
npm install
npm run dev
```
Open http://localhost:5173

`npm run typecheck` checks the types, `npm run build` makes a production build in `dist/`.

## Working together
Don't commit to `main`. Each person works on their own branch and opens a pull request.
