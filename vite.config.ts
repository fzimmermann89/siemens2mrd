import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const buildDate = new Date();
const buildVersion = `0.${String(buildDate.getFullYear()).slice(-2)}${String(buildDate.getMonth() + 1).padStart(2, "0")}${String(buildDate.getDate()).padStart(2, "0")}`;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion)
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["THIRD_PARTY_NOTICES.md", "pwa-192.png", "pwa-512.png"],
      manifest: {
        name: "siemens to mrd",
        short_name: "siemens2mrd",
        description: "Convert Siemens raw data to ISMRMRD, edit headers, and merge data with meta information offline.",
        theme_color: "#0a0e14",
        background_color: "#0a0e14",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,wasm,xml,xsl,md}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    })
  ],
  server: {
    host: "0.0.0.0",
    port: 5173
  }
});
