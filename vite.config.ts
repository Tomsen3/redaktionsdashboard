import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';

export default defineConfig({
  // '/' passt für eine eigene Domain/Subdomain (z. B. redaktion.singende-krankenhaeuser.de).
  // Läuft die Seite stattdessen unter https://<user>.github.io/<repo>/, muss hier
  // '/<repo>/' eingetragen werden (siehe DEPLOYMENT.md).
  base: '/',
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: 'dist',
  },
});
