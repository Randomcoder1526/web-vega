function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value || "");
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
async function serializeBody(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined;
  const bytes = new Uint8Array(await new Response(body).arrayBuffer());
  let binary = "";
  bytes.forEach((b) => binary += String.fromCharCode(b));
  return btoa(binary);
}
export async function fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const request = input instanceof Request ? input : undefined;
  const url = request?.url || input.toString();
  if (!/^https?:/i.test(url)) return globalThis.fetch(input as any, init);
  const headers: Record<string, string> = {};
  new Headers(request?.headers).forEach((v, k) => headers[k] = v);
  new Headers(init.headers).forEach((v, k) => headers[k] = v);
  const response = await globalThis.fetch("/api/proxy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, method: init.method || request?.method || "GET", headers, bodyBase64: await serializeBody(init.body), redirect: init.redirect || "follow" }),
  });
  if (!response.ok) throw new Error(`Proxy transport failed (${response.status})`);
  const payload = await response.json();
  const safeHeaders = (payload.headers || []).filter(([key]: [string, string]) => key.toLowerCase() !== "set-cookie");
  const bytes = bytesFromBase64(payload.dataBase64);
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(body, { status: payload.status, statusText: payload.statusText, headers: safeHeaders });
}
