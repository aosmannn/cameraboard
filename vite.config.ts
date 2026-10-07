import { defineConfig } from 'vite';

// Two pages: the landing page at / and the app at /app.html.
export default defineConfig({
  server: { host: true, port: 4319, strictPort: true },
  build: { rollupOptions: { input: { main: 'index.html', app: 'app.html' } } }
});
