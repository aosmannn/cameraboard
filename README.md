# 📍 Wayframe

**Pin your photos to the world.** Wayframe turns a folder of photos into an interactive world map. Each picture sits at the place it was taken, and the closer you zoom, the more you see.

### 👉 [Open the live site](https://cameraboard-xi.vercel.app/)

Built for photos from a Sony Cyber-shot DSC-V1, and it works with any camera.

---

## What it does

- **A map we draw ourselves, from our own data.** No map service is used. Zoomed out you see every country in its own colour on a blue ocean, with country names, big cities and seas. Zoom in and states and provinces appear for the whole world, then more cities, and counties across the US, each with names that never overlap.
- **Jump to the exact spot.** Opening a photo flies to its location, and "Zoom to exact spot" goes in much closer (you can zoom to level 16). The pin always sits at the exact coordinates.
- **Works offline.** Place search and naming a pin both use the built-in list of 7,300 cities, so nothing is sent anywhere.
- **Real map pins.** Each place gets a pin, with a count when several photos share it. Hover a pin to see its picture, click it to open the card, and zoom in close and the pin's head shows the photo itself. Nearby pins group into a numbered circle that splits apart as you zoom.
- **Cards with the full story.** Click a pin to open its card: the photo, a title, a like button, the story behind the shot, the date, camera details and where it was taken.
- **Zoom into the photo.** Open any photo at full size, then scroll or pinch to zoom and drag to pan.
- **Board view.** Switch tabs to see the same photos as polaroids pinned to a cork board.
- **Reads your photo details.** Date, exposure, aperture, ISO and focal length come from the photo's EXIF data. GPS is used when the photo has it.
- **Easy placing.** The DSC-V1 has no GPS, so search a city (suggestions appear as you type) or click "Pin on map" and click where the photo was taken.
- **Add many at once.** Pick several photos and they fill the board.
- **Timeline playback.** Press play and the map flies from photo to photo in date order.
- **Several photos per place.** Photos in the same spot share one pin with a count. Flip through them in the side panel, and choose which one is the cover.
- **Trips.** Give photos a trip name and filter the map to one trip.
- **Search and filters.** Find photos by words, trip, camera, country or date range. The map, board, playback and poster all follow the filters.
- **Custom pins.** Pick a pin colour and an icon for each place.
- **Four map themes.** Classic, Vintage, Night and Ocean.
- **Countries photographed.** Countries you have photos in light up, with a running count and a Stats page.
- **Shot on.** Each card shows the camera, exposure, aperture, ISO and focal length. The Stats page counts photos per camera.
- **Retro look.** Early digicam, warm film or black and white filters, plus an optional date stamp in the corner like old digital cameras.
- **Place me queue.** Photos with no location are listed by day. Drop a whole day on one place, or use the suggestion from the nearest photo in time.
- **Poster export.** Download a printable PNG of your map with polaroids of your photos.
- **Backup.** Export your board to a file and import it again.

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
| `src/main.ts` | The app: map, side panel, board view, upload and location flow |
| `src/world.ts` | The coloured world map: countries, states, counties, themes, and finding which country a point is in |
| `src/labels.ts` | Draws place names without overlaps |
| `src/atlas.ts` | Loads the map data; offline city search and naming |
| `src/photo.ts` | Reads a photo: shrinks it, pulls EXIF, builds a card |
| `src/viewer.ts` | The full-size zoom and pan viewer |
| `src/filters.ts` | Search and filter rules |
| `src/stats.ts` | The Stats page |
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

- [ ] Shared board so friends see the same photos and likes (a backend such as Supabase)
- [ ] Sign-in, so each person's likes and uploads are theirs

## Credits

Map data © [Natural Earth](https://www.naturalearthdata.com) (public domain). US counties from [us-atlas](https://github.com/topojson/us-atlas) (Census Bureau, public domain).
