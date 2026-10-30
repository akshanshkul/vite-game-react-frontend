import { defineConfig, loadEnv } from "vite";
import tailwind from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget =
    env.ZEN_API_TARGET ||
    process.env.ZEN_API_TARGET ||
    "http://127.0.0.1:8080";

  return {
    plugins: [
    tailwind(),
    VitePWA({
      registerType: "prompt",
      manifest: {
        name: "Zen Tiles",
        short_name: "Zen Tiles",
        description: "A quiet, offline Mahjong Solitaire garden.",
        id: "/",
        scope: "/",
        start_url: "/?source=pwa",
        theme_color: "#153f36",
        background_color: "#153f36",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        orientation: "portrait",
        categories: ["games", "puzzle"],
        lang: "en",
        shortcuts: [
          {
            name: "Daily challenge",
            short_name: "Daily",
            url: "/?source=pwa",
            icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
          },
        ],
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,json}"],
        maximumFileSizeToCacheInBytes: 4000000,
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "fonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 31536000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { host: "0.0.0.0", proxy: { "/api": apiTarget } },
  preview: { proxy: { "/api": apiTarget } },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "phaser", test: /node_modules\/phaser/ },
            {
              name: "react",
              test: /node_modules\/(react|react-dom|scheduler)/,
            },
          ],
        },
      },
    },
  },
};
});
