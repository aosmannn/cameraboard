import { defineConfig } from 'vite';

// Two pages: the landing page at / and the app at /app.html.
export default defineConfig({
  build: { rollupOptions: { input: { main: 'index.html', app: 'app.html' } } }
});
