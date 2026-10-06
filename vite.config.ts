import { defineConfig, type Plugin } from 'vite';

// Pages: the home page at /, the map app at /app.html, and the site pages below.
// Clean addresses (/explore, /s/<id>?t=<story>, /u/<name>, /cameras/<camera>) are served by the same files in
// development, in preview and on Vercel (see vercel.json). Keep the two lists in step.
const ROUTES: [RegExp, string][] = [
  [/^\/explore\/?$/, '/explore.html'],
  [/^\/privacy\/?$/, '/privacy.html'],
  [/^\/terms\/?$/, '/terms.html'],
  [/^\/cameras(\/[^/]*)?\/?$/, '/cameras.html'],
  [/^\/s\/[^/]+\/?$/, '/story.html'],
  [/^\/u\/[^/]+\/?$/, '/profile.html']
];
const cleanUrls = (): Plugin => {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const [path, query] = (req.url ?? '').split('?');
    const hit = ROUTES.find(([re]) => re.test(path));
    if (hit) req.url = hit[1] + (query ? '?' + query : '');
    next();
  };
  return { name: 'wayframe-clean-urls', configureServer: s => { s.middlewares.use(rewrite); }, configurePreviewServer: s => { s.middlewares.use(rewrite); } };
};

export default defineConfig({
  plugins: [cleanUrls()],
  build: {
    rollupOptions: {
      input: { main: 'index.html', app: 'app.html', explore: 'explore.html', story: 'story.html', profile: 'profile.html', cameras: 'cameras.html', privacy: 'privacy.html', terms: 'terms.html' }
    }
  }
});
