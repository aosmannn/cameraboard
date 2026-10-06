# 📍 Cameraboard

**Pin your photos to the world.** Cameraboard turns a folder of photos into an interactive world map. Each picture sits at the place it was taken, and the closer you zoom, the more you see.

### 👉 [Open the live site](https://cameraboard-xi.vercel.app/)

Built for photos from a Sony Cyber-shot DSC-V1, and it works with any camera.

---

## What it does

- **A map we draw ourselves.** Every country gets its own colour on a blue ocean, with no street-map tiles. Country names, major cities and seas appear as you zoom in.
- **Photo pins.** Each photo is a small picture pin. Photos close together group into a numbered circle that splits apart as you zoom.
- **Cards with the full story.** Click a pin to open its card: the photo, a title, a like button, the story behind the shot, the date, camera details and where it was taken.
- **Zoom into the photo.** Open any photo at full size, then scroll or pinch to zoom and drag to pan.
- **Board view.** Switch tabs to see the same photos as polaroids pinned to a cork board.
- **Reads your photo details.** Date, exposure, aperture, ISO and focal length come from the photo's EXIF data. GPS is used when the photo has it.
- **Easy placing.** The DSC-V1 has no GPS, so search a place name or click "Pin on map" and click where the photo was taken.
- **Add many at once.** Pick several photos and they fill the board.
- **Backup.** Export your board to a file and import it again.

## How it works

Everything runs in the browser. Photos are shrunk on upload and saved in the browser's own storage (IndexedDB), so nothing is sent to a server.

> **Heads up:** because photos are stored per browser, two people opening the site see their own boards, not each other's. A shared board needs a backend, which is on the roadmap below.

## Run it on your computer

You need [Node.js](https://nodejs.org).

```bash
git clone https://github.com/aosmannn/cameraboard.git
cd cameraboard
npm install
npm run dev
```

Open http://localhost:5173.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run typecheck` | Check the TypeScript for mistakes |
| `npm run build` | Make a production build in `dist/` |

## Code layout

Built with TypeScript, Vite and [Leaflet](https://leafletjs.com). The world shapes come from [Natural Earth](https://www.naturalearthdata.com) through the `world-atlas` package.

| File | Job |
| --- | --- |
| `src/main.ts` | The app: map, side panel, board view, upload and location flow |
| `src/world.ts` | The coloured world map, country, city and ocean labels |
| `src/photo.ts` | Reads a photo: shrinks it, pulls EXIF, builds a card |
| `src/viewer.ts` | The full-size zoom and pan viewer |
| `src/storage.ts` | Saving and loading in IndexedDB |
| `src/types.ts` | The shape of a card |
| `src/style.css` | All the styling |

## Working together

Don't commit to `main`. Each person works on their own branch and opens a pull request, then the other person reviews and merges it. Pull before you start new work so you don't overwrite each other.

## Roadmap

- [ ] Shared board so friends see the same photos and likes (a backend such as Supabase)
- [ ] Sign-in, so each person's likes and uploads are theirs
- [ ] Photo albums and trips
- [ ] Street-level detail when zoomed in far

## Credits

Map data © [Natural Earth](https://www.naturalearthdata.com) (public domain). Place search by [OpenStreetMap Nominatim](https://nominatim.org).
