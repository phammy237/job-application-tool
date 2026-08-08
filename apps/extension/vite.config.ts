import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  server: {
    // crxjs's dev-server HMR needs a fixed, known port for the extension to reconnect to.
    port: 5173,
    strictPort: true,
  },
});
