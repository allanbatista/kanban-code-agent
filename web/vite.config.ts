import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const port = process.env.PORT ? Number(process.env.PORT) : 8888
const apiPort = process.env.API_PORT ? Number(process.env.API_PORT) : 35000

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/ws": {
        target: `ws://localhost:${apiPort}`,
        ws: true,
      },
    },
  },
  preview: { port },
})
