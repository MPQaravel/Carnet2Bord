import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Build « fichier unique » : tout le frontend (JS+CSS) est inliné dans un seul
// index.html autonome -> carnet-de-bord.html, ouvrable par double-clic dans un
// navigateur, sans Node ni serveur (stockage localStorage, météo via Open-Meteo).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  clearScreen: false,
  build: {
    target: "es2021",
    outDir: "dist-single",
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000,
  },
});
