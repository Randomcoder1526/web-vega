import { cancelRuntimeDownload, emitRuntimeEvent, finishRuntimeDownload, mediaProxyUrl, registerDownload } from "./runtime";
function base64ToBytes(value: string): number[] { const binary = atob(value || ""); return Array.from(binary, (ch) => ch.charCodeAt(0)); }
function arrayToBase64(value: number[]): string { let binary = ""; value.forEach((b) => binary += String.fromCharCode(b)); return btoa(binary); }
function textToBase64(value: string): string { const bytes = new TextEncoder().encode(value); let binary = ""; bytes.forEach((b) => binary += String.fromCharCode(b)); return btoa(binary); }
function filenameFromPath(path = "download.bin") { return path.replace(/\\/g, "/").split("/").pop() || "download.bin"; }
function triggerDownload(url: string, filename: string) { const a = document.createElement("a"); a.href = url; a.download = filename; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); }
export async function invoke<T = any>(command: string, payload: any = {}): Promise<T> {
  const args = payload?.args ?? payload;
  switch (command) {
    case "doh_fetch": {
      const bodyBase64 = Array.isArray(args.body) ? arrayToBase64(args.body) : typeof args.body === "string" ? textToBase64(args.body) : undefined;
      const res = await fetch("/api/proxy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: args.url, method: args.method || "GET", headers: args.headers || {}, bodyBase64, redirect: args.max_redirects === 0 ? "manual" : "follow" }) });
      if (!res.ok) throw new Error(`Web proxy failed (${res.status})`);
      const data = await res.json();
      return { status: data.status, status_text: data.statusText, url: data.url, headers: data.headers, data: base64ToBytes(data.dataBase64) } as T;
    }
    case "start_download": {
      const sourceUrl = String(args.url || "");
      if (args.videoType === "m3u8" || /\.m3u8(?:$|\?)/i.test(sourceUrl)) {
        throw new Error("Direct HLS download is not available in the browser build. Choose a direct MP4/WebM source for downloading.");
      }
      const id = String(args.id); const controller = new AbortController(); registerDownload(id, controller);
      const filename = filenameFromPath(args.filePath); const url = mediaProxyUrl(sourceUrl, args.headers, filename);
      queueMicrotask(() => { if (controller.signal.aborted) return; triggerDownload(url, filename); emitRuntimeEvent("download-progress", { id, downloaded: 1, total: 1, speed: 0 }); emitRuntimeEvent("download-complete", { id, final_path: filename }); finishRuntimeDownload(id); });
      return undefined as T;
    }
    case "pause_download": case "cancel_download": cancelRuntimeDownload(String(args.id)); return undefined as T;
    case "save_subtitle": {
      const blobUrl = URL.createObjectURL(new Blob([String(args.content || "")], { type: "text/plain;charset=utf-8" }));
      triggerDownload(blobUrl, filenameFromPath(args.path || "subtitle.vtt")); setTimeout(() => URL.revokeObjectURL(blobUrl), 10000); return undefined as T;
    }
    case "get_stream_proxy_port": return null as T;
    case "get_torrent_api_port": throw new Error("Torrent streaming is not available in a standard web browser.");
    case "get_local_stream_url": return String(args.filePath || "") as T;
    case "generate_video_thumbnail": return null as T;
    case "diagnose_mpv_initialization": return "Vega Web uses the browser media engine instead of native MPV." as T;
    case "get_cookies_for_url": return [] as T;
    case "read_sync_manifests": return [] as T;
    case "list_download_subtitles": return [] as T;
    case "resolve_sync_media_path": return null as T;
    case "write_sync_manifest": case "toggle_devtools": case "ensure_window_in_work_area": case "set_player_fullscreen": return undefined as T;
    case "open_external_player": if (args.url) window.open(args.url, "_blank", "noopener,noreferrer"); return undefined as T;
    default: console.debug(`[Vega Web] Native command not needed: ${command}`, args); return undefined as T;
  }
}
