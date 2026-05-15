import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// Vite dev server: bind to 0.0.0.0 so the dev container forwards it,
// proxy /api/* and /terminal/ to the FastAPI uvicorn on :8000.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 51730,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8000',
      '/terminal': { target: 'http://localhost:8000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
