type Listener = (event: { payload: any }) => void;
const listeners = new Map<string, Set<Listener>>();
const downloadControllers = new Map<string, AbortController>();

export function listenRuntimeEvent(name: string, cb: Listener): () => void {
  let set = listeners.get(name);
  if (!set) listeners.set(name, (set = new Set()));
  set.add(cb);
  return () => set?.delete(cb);
}
export function emitRuntimeEvent(name: string, payload: any): void {
  listeners.get(name)?.forEach((cb) => { try { cb({ payload }); } catch (e) { console.error(e); } });
}
export function registerDownload(id: string, controller: AbortController) { downloadControllers.set(id, controller); }
export function cancelRuntimeDownload(id: string) { downloadControllers.get(id)?.abort(); downloadControllers.delete(id); }
export function finishRuntimeDownload(id: string) { downloadControllers.delete(id); }
export function encodeHeaders(headers?: Record<string, string> | null): string {
  const bytes = new TextEncoder().encode(JSON.stringify(headers || {}));
  let binary = "";
  bytes.forEach((b) => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export function mediaProxyUrl(url: string, headers?: Record<string, string> | null, downloadName?: string): string {
  if (!/^https?:/i.test(url)) return url;
  const qs = new URLSearchParams({ url, h: encodeHeaders(headers) });
  if (downloadName) qs.set("download", downloadName);
  return `/api/media?${qs}`;
}
