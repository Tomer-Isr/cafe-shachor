import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base — под GitHub Pages (репозиторий cafe-shachor)
export default defineConfig({
  base: process.env.GH_PAGES ? '/cafe-shachor/' : '/',
  plugins: [react(), tailwindcss()],
  build: { target: 'es2022' },
})
