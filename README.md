# 📍 Wayframe

**Pin your photos to the world.** Wayframe turns a folder of photos into an interactive world map. Each picture sits at the place it was taken, and the closer you zoom, the more you see.

### 👉 [Open the live site](https://cameraboard-xi.vercel.app/)

Built for photos from a Sony Cyber-shot DSC-V1, and it works with any camera.

---

## What it does

- **Your photos, pinned to a world map.** Every photo hangs from a push pin like a polaroid on a wall. The pin's point is the exact spot it was taken.
- **Stories with red string.** Start a story, then click photos in the order you went. A red string joins them, so a trip reads like a board on the wall: Atlanta → Barcelona → Madrid → Chongqing. Reorder stops, rename or delete a story at any time.
- **Play a story.** The map flies from stop to stop and the string draws itself as you go.
- **A map we draw ourselves, from our own data.** No map service is used. Zoomed out you see countries, big cities and seas. Zoom in and states and provinces appear for the whole world, then more cities, and counties across the US, with names that never overlap. Three styles: Paper, Atlas and Night.
- **Photo cards.** Open a photo for its title, what happened, the date, its place in the story, likes, and the camera details (model, exposure, aperture, ISO, focal length) read from the file.
- **Photos without GPS.** The DSC-V1 has no GPS, so photos not on the map yet wait in a tray, grouped by day. Put a whole day at the place of the nearest photo in time, search a city (works offline), or click the map.
- **Retro look.** Early digicam, warm film or black and white, plus an optional date stamp in the corner.
- **Poster.** Download a printable PNG of a story or all your photos, string included.
- **Backup.** Export to a file and import it again.

## How it works

Everything runs in the browser. Photos are shrunk on upload and saved in the browser's own storage (IndexedDB), so nothing is sent to a server.

> **Heads up:** because photos are stored per browser, two people opening the site see their own boards, not each other's. A shared board needs a backend, which is on the roadmap below.

## Run it on your computer

You need [Node.js](https://nodejs.org).

```bash
git clone https://github.com/aosmannn/wayframe.git
cd wayframe
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

Built with TypeScript, Vite and [Leaflet](https://leafletjs.com) (used only to move and zoom the map). Everything drawn on it comes from the data below.

| File | Job |
| --- | --- |
| `src/main.ts` | The app: polaroids, stories and string, photo panel, upload and location flow |
| `src/world.ts` | The coloured world map: countries, states, counties, themes, and finding which country a point is in |
| `src/labels.ts` | Draws place names without overlaps |
| `src/atlas.ts` | Loads the map data; offline city search and naming |
| `src/photo.ts` | Reads a photo: shrinks it, pulls EXIF, builds a card |
| `src/viewer.ts` | The full-size zoom and pan viewer |
| `src/poster.ts` | The poster image |
| `src/storage.ts` | Saving and loading in IndexedDB |
| `src/types.ts` | The shape of a card |
| `src/style.css` | All the styling |

## Working together

Don't commit to `main`. Each person works on their own branch and opens a pull request, then the other person reviews and merges it. Pull before you start new work so you don't overwrite each other.

## Map data

All in `public/data`, loaded as the map needs it. All public domain.

| File | What | Source |
| --- | --- | --- |
| `world-atlas` package | Country shapes | Natural Earth 1:50m |
| `admin1.json` | 4,596 states, provinces and regions worldwide | Natural Earth 1:10m admin-1, simplified with [mapshaper](https://github.com/mbloch/mapshaper) (`-simplify 6% keep-shapes`) |
| `cities.json` | 7,342 cities with state, country and population | Natural Earth populated places |
| `us-counties.json` | 3,231 US counties | `us-atlas` package |

Not included: streets and buildings. That level of detail needs OpenStreetMap-sized data.

## Roadmap

- [ ] Sign up with a phone number
- [ ] Find friends from your contacts and see their stories

## Credits

Map data © [Natural Earth](https://www.naturalearthdata.com) (public domain). US counties from [us-atlas](https://github.com/topojson/us-atlas) (Census Bureau, public domain).
