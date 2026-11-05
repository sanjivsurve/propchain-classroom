import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Allows access via the Cloudflare quick-tunnel's random *.trycloudflare.com
    // hostname (changes on every tunnel restart) alongside the classroom LAN IP.
    allowedHosts: true
  }
});
