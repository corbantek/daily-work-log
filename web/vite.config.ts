import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const apiPort = process.env.API_PORT || '4747'
const webPort = Number(process.env.WEB_PORT || 4748)

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    strictPort: true, // fail loudly instead of silently moving to another port
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
