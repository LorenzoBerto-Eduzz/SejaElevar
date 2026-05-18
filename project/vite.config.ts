import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  build: {
    assetsInlineLimit: 10_000_000,
  },
  plugins: [react()],
});
