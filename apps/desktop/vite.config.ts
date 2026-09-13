import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  // Relative asset URLs: the bundle loads from disk via file:// in Electron
  // (an absolute "/assets/..." base would resolve to the filesystem root) and
  // still resolves correctly over http in the browser e2e harness.
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer-bundle',
    emptyOutDir: true,
  },
});
