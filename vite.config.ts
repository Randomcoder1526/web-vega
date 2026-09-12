import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const tmdbApiKey = env.TMDB_API_KEY || env.VITE_TMDB_API_KEY || "";
  const proxyApiUrl =
    env.PROXY_API_URL ||
    env.VITE_PROXY_API_URL ||
    env.META_PROXY_URL ||
    env.VITE_META_PROXY_URL ||
    "";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@tauri-apps/api/core": path.resolve(__dirname, "src/web-shims/core.ts"),
        "@tauri-apps/api/event": path.resolve(__dirname, "src/web-shims/event.ts"),
        "@tauri-apps/api/path": path.resolve(__dirname, "src/web-shims/path.ts"),
        "@tauri-apps/api/window": path.resolve(__dirname, "src/web-shims/window.ts"),
        "@tauri-apps/api/dpi": path.resolve(__dirname, "src/web-shims/dpi.ts"),
        "@tauri-apps/api/app": path.resolve(__dirname, "src/web-shims/app.ts"),
        "@tauri-apps/api/webviewWindow": path.resolve(__dirname, "src/web-shims/webviewWindow.ts"),
        "@tauri-apps/plugin-http": path.resolve(__dirname, "src/web-shims/http.ts"),
        "@tauri-apps/plugin-dialog": path.resolve(__dirname, "src/web-shims/dialog.ts"),
        "@tauri-apps/plugin-opener": path.resolve(__dirname, "src/web-shims/opener.ts"),
        "@tauri-apps/plugin-updater": path.resolve(__dirname, "src/web-shims/updater.ts"),
        "tauri-plugin-libmpv-api": path.resolve(__dirname, "src/web-shims/mpv.ts"),
      },
    },
    define: {
      "import.meta.env.VITE_TMDB_API_KEY": JSON.stringify(tmdbApiKey),
      "import.meta.env.VITE_PROXY_API_URL": JSON.stringify(proxyApiUrl),
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:4174",
          changeOrigin: false,
        },
      },
    },
  };
});
