import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // El backend Express corre en :3000 (npm run dev en packages/backend).
      // En produccion (Dockploy), nginx hace este mismo proxy hacia el
      // servicio "backend" del docker-compose - ver nginx/frontend.conf.
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
