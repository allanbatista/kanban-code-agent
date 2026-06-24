import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const port = process.env.PORT ? Number(process.env.PORT) : 8888
const apiPort = process.env.API_PORT ?? process.env.SWARM_PORT ?? "35000"
const apiTarget = `http://127.0.0.1:${apiPort}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __DEV_WS_URL__: JSON.stringify(`ws://127.0.0.1:${apiPort}/ws`),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port,
    proxy: {
      "/api": apiTarget,
      "/ws": {
        target: apiTarget.replace(/^http/, "ws"),
        ws: true,
      },
    },
  },
  preview: { port },
})
