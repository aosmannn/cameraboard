# Wayframe: notes for developers

**Pin your photos to the world.** Wayframe turns a folder of photos into an interactive world map. Each picture sits at the place it was taken, and the closer you zoom, the more you see.

### 👉 [Open the live site](https://cameraboard-xi.vercel.app/)

Made for photos from old cameras with no GPS, such as point-and-shoots, early digicams, DSLRs and film scans, and it works with any camera or phone.

---

## What it does

- **Your photos, pinned to a world map.** Every photo hangs from a push pin like a polaroid on a wall. The pin's point is the exact spot it was taken.
- **Stories with red string.** Start a story, then click photos in the order you went. A red string joins them, so a trip reads like a board on the wall: Atlanta → Barcelona → Madrid → Chongqing. Reorder stops, rename or delete a story at any time.
- **Play a story.** The map flies from stop to stop and the string draws itself as you go.
- **A map we draw ourselves, from our own data.** No map service is used. Zoomed out you see countries, big cities and seas. Zoom in and states and provinces appear for the whole world, then more cities, and counties across the US, with names that never overlap. Three styles: Paper, Atlas and Night.
- **Photo cards.** Open a photo for its title, what happened, the date, its place in the story, likes, and the camera details (model, exposure, aperture, ISO, focal length) read from the file.
- **Photos without GPS.** Many older cameras have no GPS, so photos not on the map yet wait in a tray, grouped by day. Put a whole day at the place of the nearest photo in time, search a city (works offline), or click the map.
- **Retro look.** Early digicam, warm film or black and white, plus an optional date stamp in the corner.
- **Poster.** Download a printable PNG of a story or all your photos, string included.
- **Friends feed.** A "Friends" tab in the left panel lists photos the people you follow chose to share, newest first. Like them, tap a name to see a profile, or press "Show on map" to fly to the spot and light up that story's string.
- **You choose who sees what.** Every photo and story is Private (only you), Friends (people who follow you) or Public (anyone with your link, no account needed). The default is Private. Someone who opens your invite link can look at your public stories right away and sign in to follow you.
- **Accounts and friends (optional).** Sign in with your email and a code we send you. Your photos are saved to your account and come back on any device. Pick a name, and optionally a username. You are invisible to search until you turn on "Let people find me by username". Everyone gets a private invite link and QR code that works even when search is off, and friends can also be found by email. Follow people to see the stories they chose to share on your map in blue string. Likes are real and shared. You can block and report people.
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
| `index.html`, `src/landing.ts` | The landing page with the interactive demo |
| `app.html`, `src/main.ts` | The app: polaroids, stories and string, photo panel, upload and location flow |
| `src/world.ts` | The colored world map: countries, states, counties, themes, and finding which country a point is in |
| `src/labels.ts` | Draws place names without overlaps |
| `src/atlas.ts` | Loads the map data; offline city search and naming |
| `src/cloud.ts` | Sign-in, syncing your photos, friends and likes (Supabase) |
| `scripts/build-cities.mjs` | Rebuilds the place list (Natural Earth plus GeoNames cities of 15,000+ people) |
| `supabase/migrations/` | Database tables, storage bucket and privacy rules, one file per change |
| `supabase/schema.sql` | The same, joined into one file for pasting (`npm run db:schema`) |
| `src/photo.ts` | Reads a photo: shrinks it, pulls EXIF, builds a card |
| `src/viewer.ts` | The full-size zoom and pan viewer |
| `src/poster.ts` | The poster image |
| `src/storage.ts` | Saving and loading in IndexedDB |
| `src/types.ts` | The shape of a card |
| `src/style.css` | All the styling |

## Working together

Don't commit to `main`. Each person works on their own branch and opens a pull request, then the other person reviews and merges it. Pull before you start new work so you don't overwrite each other.

## Accounts setup (Supabase)

The app talks to the Supabase project `psuykzkrakkdqhulrqig`. Its publishable key is built into `src/cloud.ts`; that key is public by design, and the database rules keep data private. To use a different project, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`).

One-time setup in the Supabase dashboard:

1. **Database:** SQL Editor → New query → paste all of `supabase/schema.sql` → Run (or use the automatic setup below, which does this for you on every change). It creates the tables, the private `photos` storage bucket, and the row level security rules. It is safe to run again.
2. **Email sign-in:** Authentication → Sign In / Providers → Email → on. Leave "Confirm email" on.
3. **Make the emails show a code, not a link:** Authentication → Email Templates. Edit **both** "Confirm signup" (new people get this one) and "Magic Link" (returning people). Put `{{ .Token }}` in the body and remove the link. See `supabase/email-template.html`.
4. **Redirect address:** Authentication → URL Configuration → set Site URL to your live site, and add `https://YOUR-SITE/app.html` (and `http://localhost:5173/app.html`) under Redirect URLs.
5. **More than a few emails an hour:** Supabase's built-in email sender is limited. For real use, add a free sender such as Resend under Project Settings → Authentication → SMTP.

### Database changes apply themselves

Each database change is a file in `supabase/migrations/`. Once the two secrets below are set, pushing a new migration applies it to the live database through the **Database** GitHub Action (`.github/workflows/database.yml`), so you never paste SQL again.

1. Make an access token at <https://supabase.com/dashboard/account/tokens>.
2. Find the database password in Supabase under Project Settings → Database (reset it there if you've lost it).
3. In GitHub: Settings → Secrets and variables → Actions → New repository secret. Add `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`.
4. Run the **Database** action once from the Actions tab to bring the database up to date.

To change the database later, add `supabase/migrations/<YYYYMMDDHHMMSS>_what_it_does.sql`, push, and run `npm run db:schema` to refresh `supabase/schema.sql`. From a computer you can also run `SUPABASE_ACCESS_TOKEN=… SUPABASE_DB_PASSWORD=… npx supabase link --project-ref psuykzkrakkdqhulrqig && npm run db:push`.

Sharing the site with people:

- **Vercel must not ask visitors to sign in to Vercel.** In the Vercel project: Settings → Deployment Protection → turn **Vercel Authentication** off (or set it to protect only preview deployments). Branch and preview addresses like `cameraboard-xxxx-yourteam.vercel.app` are protected by default, which is what shows "Log in to Vercel".
- **Use one public address for invite links.** Set `VITE_PUBLIC_URL` to your production address (for example `https://cameraboard-xi.vercel.app`) under Vercel → Settings → Environment Variables, then redeploy. Invite links and QR codes then always use it, even if you copy them from a preview page.
- **What a visitor sees without signing in:** the app itself (they can add photos and make stories on their own device), and on an invite link, the name of the person who invited them plus that person's Public stories. Friends-only and Private photos need a sign-in and a follow.

How privacy works:

- Every table has row level security. You see your own photos, plus photos that people you follow set to Friends or Public. Signed-out visitors can only fetch a person's Public photos, through their invite link, and can open only those images.
- Nobody can be found by username unless they turned that on, and they need a username first. Searches are limited to 30 a minute.
- Other people's profile rows can't be read directly. Names and usernames come through database functions that only reveal a username to people who chose to be discoverable.
- Invite links use a random code, so they work without a username. Make a new link and the old one stops working.
- Profiles show a name and a username, with no follower counts or bios. Mutual friends only show when the other person is discoverable.
- Blocking removes the follow in both directions and hides you from each other. Reports are stored for you to read in the Supabase dashboard.
- Finding friends by email sends one-way hashes to a database function that only returns people who have an account. The addresses aren't saved.
- Image files live in a private bucket and are shown through links that expire after an hour.

## Map data

All in `public/data`, loaded as the map needs it. Natural Earth and US Census data are public domain; the relief pictures come from open elevation data and are credited on the Credits page.

| File | What | Source |
| --- | --- | --- |
| `world-atlas` package | Country shapes | Natural Earth 1:50m |
| `admin1.json` | 4,596 states, provinces and regions worldwide | Natural Earth 1:10m admin-1, simplified with [mapshaper](https://github.com/mbloch/mapshaper) (`-simplify 6% keep-shapes`) |
| `cities.json` | 7,342 cities with state, country and population | Natural Earth populated places |
| `us-counties.json` | 3,231 US counties | `us-atlas` package |
| `nature.json` | Lakes, rivers, deserts, mountain ranges, peaks | Natural Earth (`scripts/build-nature.mjs`) |
| `biomes.png` | Climate zones for the Terrain colors | Natural Earth II land cover, by Steven (@vcanp) |
| `relief-shade.webp`, `relief-height.webp` | Hillshade and heights for the shaded relief and sea depth | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (SRTM, GMTED2010, ETOPO1 and others, see their [data sources](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md)), baked by `scripts/build-relief.mjs` |

Not included: streets and buildings. That level of detail needs OpenStreetMap-sized data, which is too big to ship with the app.

## Roadmap

- [ ] Comments on friends' photos
- [ ] Approve followers before they see your shared photos

## Credits

Map data © [Natural Earth](https://www.naturalearthdata.com) (public domain). US counties from [us-atlas](https://github.com/topojson/us-atlas) (Census Bureau, public domain).


## Data credits

- Map shapes and populated places: [Natural Earth](https://www.naturalearthdata.com), public domain.
- Extra city names and populations: [GeoNames](https://www.geonames.org), CC BY 4.0, via the MIT-licensed `all-the-cities` package.
- US counties: us-atlas (US Census).

## Map styles and the Terrain theme

The map runs only on data that ships with the app; no outside map service is called while you use it.

- **Land colors** (Terrain): `public/data/biomes.png` is a world grid of climate zones (desert, steppe, savanna, forests, tundra, ice...) made from Natural Earth II land cover. `ZoneLayer` in `src/world.ts` colors the land by zone and clips it to the country shapes.
- **Mountains, rivers, lakes, deserts** (all styles): `public/data/nature.json`, drawn by `src/nature.ts`.
- **Shaded relief** (`src/relief.ts`): two small pictures cover the whole world in Web Mercator, so a map tile is just a rectangle of them.
  - `relief-shade.webp` (4096 px, grey): hillshade, light from the north-west.
  - `relief-height.webp` (2048 px, grey): height in metres as a signed square root (0 = deepest sea, 255 = highest peak; `metres()` decodes it).
  - In Terrain, `ZoneLayer` lights each 2 px pixel-art cell with the shade picture in a few dithered steps, turns the highest ground to bare rock and snow (the snow line sinks towards the poles), and fades the effect out as you zoom past what the pictures can show (about zoom 6).
  - In every style, `SeaLayer` shades the sea by depth (light shelves, dark deep ocean; in Terrain as pixel-art bands). In Paper, Atlas and Night, `ShadeLayer` lays a faint sun and shadow over the land.
  - If the pictures are missing the map still works, just without relief.
- Rebuild the pictures with `node scripts/build-relief.mjs` (needs `cwebp` from `brew install webp`; it downloads AWS Terrain Tiles once, at zoom 4, and bakes them). Only run it when you want to change the data; the result is checked in. The two images total about 0.7 MB and are loaded after the map is up.

Posters use the climate-zone colors only (see `src/poster.ts`).

## Panning around the globe

The map has no sideways limit. Tile layers (relief, shading) repeat on their own; vector layers do not, so countries, states, counties, the country outline, labels, photo pins and yarn are each drawn three times, one world to the left (-360), the middle and the right (+360). After every move the map centre is wrapped back into -180..180 (`map.on('moveend')` in `src/main.ts`), which is invisible because the copies look identical. Flights use `nearLng()` to take the short way round, and clicks are wrapped with `map.wrapLatLng` before they are used as real coordinates. Nothing on the running map calls an outside map service.

## Cameras and the camera ranking

`/cameras` (`cameras.html`, `src/cameras.ts`) lists the cameras people shot community photos on, as cards with a cover photo, ranked by how many photos were taken with them: today, this week (from Monday), this month, this year, or all time. It counts public photos from people who turned on the community gallery, minus people you have blocked. A photo counts for the day it was taken (`taken_at`), not the day it was uploaded. Each camera has its own page at `/cameras/<camera>`.

All time uses `explore_cameras()`. The other periods use the database function `camera_leaderboard(from_day, to_day)` (migration `20261008000000_camera_leaderboard.sql`; run `npm run db:push` once). The page sends local dates, so "today" follows the visitor's own clock. Until the migration is applied, `cloud.cameraLeaderboard` counts from the newest 768 community photos instead and says so.

## Keeping Explore and Cameras fast

The community pages start with two network steps (the list, then signing the image links) and then download full photos, so they used to show "Loading…" for a second or more. To feel instant:

- `src/cache.ts` remembers the last community data in `localStorage` (public data only, never private photos), for up to 50 minutes because signed image links last an hour. Explore and Cameras draw from it at once and then refresh quietly, redrawing only if something changed.
- `signPaths` in `src/cloud.ts` reuses a signed link until shortly before it expires. The same image keeps the same address, so the browser's own cache serves it.
- `cloud.warmCommunity()` fetches the first page of Explore and Cameras (and the first photos) when a site page has settled, and when the pointer reaches a nav link, so the next tab opens already filled.
- On a first visit, placeholder cards show instead of "Loading…".

## Motion between tabs and pages

- Drop-down lists use `src/dropdown.ts` instead of the browser's `<select>` (whose pop-up can't be animated): the list fades and slides open, the arrow turns, and it works with the keyboard (arrows, Home/End, Enter, Escape, typing a letter). Explore's camera filter is the first user.

- Pill tab bars (Explore's Photos/Stories, the Cameras periods) have a highlight that glides to the chosen tab (`slideTabs` in `src/site.ts`), and the content under them fades out and the new content fades in (`swapContent`).
- The site header's highlight is one pill that glides to the link you click (Explore, Cameras, Map) before the page changes (`glideNav` in `src/site.ts`; about 150 ms). It is not used in the narrow drop-down menu. Pages also fade into each other with cross-page view transitions (`@view-transition` in `src/site.css` and `src/style.css`); browsers without them (for example Firefox) get a short fade-in of the page instead. Everything is turned off for people who prefer reduced motion.
## Likes and comments

Under other people's photos there is a heart and a comment thread (`src/reactions.ts`, styles in `src/reactions.css`). It appears in the Explore photo viewer (also used on profile, story and camera pages), and in the map's photo panel as a comments section under the existing heart.

Who can like or comment on a photo is decided in the database by `can_see_photo(pid)` (migration `20261008010000_likes_and_comments.sql`; run `npm run db:push` once): the owner, people who follow the owner (friends and public photos), and anyone signed in for photos the owner listed in the community gallery. Blocked people never see each other's reactions. Private photos are never reachable.

- Comments are read through `photo_comments(pid)` (adds names, hides blocked people; works without signing in for community gallery photos) and counted with `reaction_counts(ids)`. There is deliberately no select policy on the `comments` table.
- 1 to 500 characters, at most 8 a minute per person. The photo's owner can remove any comment on their photo; everyone can remove their own.
- Comment text is always inserted as text, never as HTML.
- Each polaroid on the Explore and camera walls has its own heart on the caption row (`heartFor` in `src/gallery-ui.ts`); one `reaction_counts` call fills all of them. The `wf-like` event keeps a polaroid's heart and the viewer's heart in step.
- Until the migration is applied the heart and comments show a short "needs the latest database update" message instead of failing quietly.
