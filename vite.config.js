import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* `npm run dev` serves the page on 5174; `npm run api` serves the api/
   functions on 3101, and /api requests are passed through to it. */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { "/api": { target: "http://localhost:3101", changeOrigin: true } },
  },
});
