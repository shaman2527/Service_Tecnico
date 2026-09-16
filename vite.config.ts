import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // src-tauri lo vigila el CLI de Tauri, no Vite.
      // Los `.tmpdir/*.tmp` son los temporales que dejan los editores/agentes al guardar:
      // si el watcher intenta vigilarlos, Vite MUERE con EBUSY (resource busy or locked)
      // y con él `tauri dev` (lección 2026-09-16).
      ignored: ['**/src-tauri/**', '**/.*.tmpdir/**', '**/*.tmp', '**/.*.tmp'],
    },
  },
})
