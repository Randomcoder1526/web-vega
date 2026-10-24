import http from "node:http";
import dns from "node:dns/promises";
import net from "node:net";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT || 4173);
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_PROXY === "true";
const MAX_BODY = 8 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE = process.env.VERCEL
  ? 3 * 1024 * 1024
  : 32 * 1024 * 1024;
const UPSTREAM_HEADER_TIMEOUT_MS = Math.max(50, Number(process.env.UPSTREAM_HEADER_TIMEOUT_MS || 20000));
const UPSTREAM_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const UPSTREAM_MAX_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.UPSTREAM_MAX_ATTEMPTS || 2)));

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": data.length, "cache-control": "no-store" });
  res.end(data);
}
function text(res, status, body) {
  const data = Buffer.from(String(body));
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "content-length": data.length });
  res.end(data);
}
async function readBody(req) {
  if (req.body != null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") return Buffer.from(req.body);
    return Buffer.from(JSON.stringify(req.body));
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error("Request body too large"); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function isPrivateV4(ip) {
  const p = ip.split(".").map(Number); if (p.length !== 4) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}
function isPrivateV6(ip) { const s = ip.toLowerCase(); return s === "::" || s === "::1" || s.startsWith("fc") || s.startsWith("fd") || /^fe[89ab]/.test(s) || s.startsWith("::ffff:127.") || s.startsWith("::ffff:10.") || s.startsWith("::ffff:192.168."); }
async function assertSafeUrl(raw) {
  let url; try { url = new URL(raw); } catch { throw new Error("Invalid URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) proxy targets are allowed");
  if (ALLOW_PRIVATE) return url;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("Private host blocked");
  const family = net.isIP(host);
  if ((family === 4 && isPrivateV4(host)) || (family === 6 && isPrivateV6(host))) throw new Error("Private IP blocked");
  if (!family) {
    const entries = await dns.lookup(host, { all: true, verbatim: true });
    if (!entries.length) throw new Error("Hostname did not resolve");
    for (const e of entries) if ((e.family === 4 && isPrivateV4(e.address)) || (e.family === 6 && isPrivateV6(e.address))) throw new Error("Hostname resolves to a private IP");
  }
  return url;
}
const HOP_HEADERS = new Set(["host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-connection"]);
function requestHeaders(input = {}) { const h = new Headers(); for (const [k,v] of Object.entries(input || {})) if (v != null && !HOP_HEADERS.has(k.toLowerCase())) h.set(k, String(v)); return h; }

// Node fetch has no browser cookie jar. Provider hosts often set a short-lived
// session cookie on one request/redirect and require it on the next one. Keep
// those upstream cookies isolated per Vega browser session instead of sharing
// them globally across users of a public Render deployment.
const PROXY_SESSION_COOKIE = "vega_proxy_session";
const PROXY_SESSION_TTL = 6 * 60 * 60 * 1000;
const MAX_PROXY_SESSIONS = 2000;
const proxySessions = new Map();

function requestCookieMap(header = "") {
  const out = new Map();
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}
function appendSetCookie(res, value) {
  const current = res.getHeader("set-cookie");
  if (!current) res.setHeader("set-cookie", value);
  else if (Array.isArray(current)) res.setHeader("set-cookie", [...current, value]);
  else res.setHeader("set-cookie", [String(current), value]);
}
function pruneProxySessions(now = Date.now()) {
  if (proxySessions.size < MAX_PROXY_SESSIONS) return;
  for (const [id, session] of proxySessions) {
    if (now - session.lastUsed > PROXY_SESSION_TTL) proxySessions.delete(id);
  }
  while (proxySessions.size >= MAX_PROXY_SESSIONS) proxySessions.delete(proxySessions.keys().next().value);
}
function getProxySession(req, res) {
  const now = Date.now();
  const incoming = requestCookieMap(req.headers.cookie || "").get(PROXY_SESSION_COOKIE);
  let id = incoming && /^[a-f0-9-]{20,80}$/i.test(incoming) ? incoming : "";
  let session = id ? proxySessions.get(id) : undefined;
  if (!session || now - session.lastUsed > PROXY_SESSION_TTL) {
    pruneProxySessions(now);
    id = randomUUID();
    session = { lastUsed: now, cookies: new Map() };
    proxySessions.set(id, session);
    const secure = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ? "; Secure" : "";
    appendSetCookie(res, `${PROXY_SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(PROXY_SESSION_TTL / 1000)}${secure}`);
  } else {
    session.lastUsed = now;
  }
  return session.cookies;
}
function responseSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}
function defaultCookiePath(url) {
  const pathName = url.pathname || "/";
  if (!pathName.startsWith("/") || pathName === "/") return "/";
  const end = pathName.lastIndexOf("/");
  return end <= 0 ? "/" : pathName.slice(0, end + 1);
}
function domainMatches(host, domain) { return host === domain || host.endsWith(`.${domain}`); }
function storeResponseCookies(jar, url, headers) {
  if (!jar) return;
  const host = url.hostname.toLowerCase();
  for (const raw of responseSetCookies(headers)) {
    const parts = String(raw).split(";");
    const first = parts.shift() || "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    let domain = host, hostOnly = true, cookiePath = defaultCookiePath(url), secure = false, expiresAt = null;
    for (const part of parts) {
      const [rawKey, ...rawValue] = part.trim().split("=");
      const key = rawKey.toLowerCase();
      const attr = rawValue.join("=").trim();
      if (key === "domain" && attr) {
        const candidate = attr.toLowerCase().replace(/^\./, "");
        if (!domainMatches(host, candidate)) continue;
        domain = candidate; hostOnly = false;
      } else if (key === "path" && attr.startsWith("/")) cookiePath = attr;
      else if (key === "secure") secure = true;
      else if (key === "max-age" && /^-?\d+$/.test(attr)) expiresAt = Date.now() + Number(attr) * 1000;
      else if (key === "expires" && attr && expiresAt == null) { const t = Date.parse(attr); if (Number.isFinite(t)) expiresAt = t; }
    }
    const key = `${domain}\n${cookiePath}\n${name}`;
    if (!value || (expiresAt != null && expiresAt <= Date.now())) jar.delete(key);
    else jar.set(key, { name, value, domain, hostOnly, path: cookiePath, secure, expiresAt });
  }
}
function cookieHeaderFor(jar, url) {
  if (!jar) return "";
  const now = Date.now(), host = url.hostname.toLowerCase(), secure = url.protocol === "https:";
  const matches = [];
  for (const [key, cookie] of jar) {
    if (cookie.expiresAt != null && cookie.expiresAt <= now) { jar.delete(key); continue; }
    if (cookie.secure && !secure) continue;
    if (cookie.hostOnly ? host !== cookie.domain : !domainMatches(host, cookie.domain)) continue;
    if (!url.pathname.startsWith(cookie.path)) continue;
    matches.push(cookie);
  }
  matches.sort((a,b) => b.path.length - a.path.length);
  return matches.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
function mergeCookieHeaders(jarCookie, explicitCookie) {
  const merged = new Map();
  for (const source of [jarCookie, explicitCookie]) {
    for (const [name, value] of requestCookieMap(source)) merged.set(name, value);
  }
  return [...merged].map(([name,value]) => `${name}=${value}`).join("; ");
}
function redirectReferer(previousUrl, nextUrl) {
  if (!previousUrl) return "";
  try { return previousUrl.origin === nextUrl.origin ? previousUrl.toString() : `${previousUrl.origin}/`; } catch { return ""; }
}
async function fetchWithHeaderTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_HEADER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Upstream request timeout after ${UPSTREAM_HEADER_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
async function fetchWithRetry(url, options, jar = null) {
  const method = String(options.method || "GET").toUpperCase();
  const retryable = ["GET","HEAD"].includes(method);
  const attempts = retryable ? UPSTREAM_MAX_ATTEMPTS : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithHeaderTimeout(url, options);
      storeResponseCookies(jar, url, response.headers);
      if (!UPSTREAM_RETRY_STATUSES.has(response.status) || attempt >= attempts) {
        return response;
      }
      try { await response.body?.cancel(); } catch {}
      const retryAfter = Number(response.headers.get("retry-after") || 0);
      await new Promise((resolve) =>
        setTimeout(resolve, retryAfter > 0 ? Math.min(retryAfter * 1000, 1500) : 200 * attempt),
      );
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
  throw lastError || new Error("Upstream request failed");
}

async function safeFetch(raw, options = {}, depth = 0, jar = null, previousUrl = null) {
  const url = await assertSafeUrl(raw);
  const headers = new Headers(options.headers || {});
  const explicitCookie = headers.get("cookie") || "";
  const jarCookie = cookieHeaderFor(jar, url);
  const combinedCookie = mergeCookieHeaders(jarCookie, explicitCookie);
  if (combinedCookie) headers.set("cookie", combinedCookie);
  if (!headers.has("referer") && previousUrl) { const ref = redirectReferer(previousUrl, url); if (ref) headers.set("referer", ref); }
  const response = await fetchWithRetry(url, { ...options, headers, redirect: "manual" }, jar);
  if ([301,302,303,307,308].includes(response.status) && options.redirect !== "manual") {
    if (depth >= 6) throw new Error("Too many redirects"); const loc = response.headers.get("location"); if (!loc) return response;
    const next = new URL(loc, url).toString(); const nextOpts = { ...options, headers: new Headers(options.headers || {}) };
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && String(options.method || "GET").toUpperCase() === "POST")) { nextOpts.method = "GET"; nextOpts.body = undefined; }
    return safeFetch(next, nextOpts, depth + 1, jar, url);
  }
  return response;
}
function headerPairs(headers) { const pairs = []; headers.forEach((v,k) => { if (k.toLowerCase() !== "set-cookie") pairs.push([k,v]); }); if (typeof headers.getSetCookie === "function") { for (const v of headers.getSetCookie()) pairs.push(["set-cookie",v]); } else { const cookie = headers.get("set-cookie"); if (cookie) pairs.push(["set-cookie",cookie]); } return pairs; }
function decodeToken(token) { try { const n = token.replace(/-/g,"+").replace(/_/g,"/"); return JSON.parse(Buffer.from(n + "=".repeat((4-n.length%4)%4), "base64").toString("utf8")); } catch { return {}; } }
function mediaProxyUrl(target, token) { return `/api/media?url=${encodeURIComponent(target)}&h=${encodeURIComponent(token || "")}`; }
function rewriteManifest(input, source, token) {
  const resolve = (value) => { if (!value || /^(data|blob):/i.test(value)) return value; try { return mediaProxyUrl(new URL(value, source).toString(), token); } catch { return value; } };
  return input.split(/\r?\n/).map((line) => {
    if (!line || !line.startsWith("#")) return line ? resolve(line.trim()) : line;
    return line.replace(/URI=("([^"]+)"|'([^']+)'|([^,\s]+))/g, (_m,_a,dq,sq,bare) => { const q = dq != null ? '"' : sq != null ? "'" : ""; return `URI=${q}${resolve(dq ?? sq ?? bare)}${q}`; });
  }).join("\n");
}
function escapeXmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function rewriteDashManifest(input, source) {
  const opening = input.match(/<MPD\b[^>]*>/i);
  if (!opening || opening.index == null) return input;
  let upstreamBase;
  try { upstreamBase = new URL("./", source).toString(); } catch { return input; }

  const openEnd = opening.index + opening[0].length;
  const tail = input.slice(openEnd);
  const firstStructural = tail.search(/<(?:Period|Location|PatchLocation|UTCTiming|ServiceDescription|ProgramInformation)\b/i);
  const headLength = firstStructural >= 0 ? firstStructural : tail.length;
  const rootHead = tail.slice(0, headLength);
  const rootBasePattern = /<BaseURL(?:\s[^>]*)?>([^<]*)<\/BaseURL>/gi;

  let rewrittenHead = rootHead;
  let foundRootBase = false;
  rewrittenHead = rewrittenHead.replace(rootBasePattern, (full, value) => {
    foundRootBase = true;
    const attrs = full.match(/^<BaseURL(\s[^>]*)?>/i)?.[1] || "";
    let absolute = String(value || "").trim();
    try { absolute = new URL(absolute || "./", source).toString(); } catch {}
    return `<BaseURL${attrs}>${escapeXmlText(absolute)}</BaseURL>`;
  });

  if (!foundRootBase) {
    rewrittenHead = `<BaseURL>${escapeXmlText(upstreamBase)}</BaseURL>${rewrittenHead}`;
  }

  let output = input.slice(0, openEnd) + rewrittenHead + tail.slice(headLength);
  output = output.replace(/<Location>([^<]+)<\/Location>/gi, (_match, value) => {
    try { return `<Location>${escapeXmlText(new URL(String(value).trim(), source).toString())}</Location>`; } catch { return _match; }
  });
  output = output.replace(/(<(?:PatchLocation|UTCTiming)\b[^>]*?\b(?:href|value)=)(["'])([^"']+)\2/gi, (match, prefix, quote, value) => {
    try { return `${prefix}${quote}${escapeXmlText(new URL(value, source).toString())}${quote}`; } catch { return match; }
  });
  return output;
}

async function handleProxy(req, res) {
  try {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    if (!body.url) return json(res, 400, { error: "url is required" });
    const method = String(body.method || "GET").toUpperCase();
    const jar = getProxySession(req, res);
    const upstreamHeaders = requestHeaders(body.headers);
    if (!upstreamHeaders.has("user-agent") && req.headers["user-agent"]) upstreamHeaders.set("user-agent", String(req.headers["user-agent"]));
    if (!upstreamHeaders.has("accept-language") && req.headers["accept-language"]) upstreamHeaders.set("accept-language", String(req.headers["accept-language"]));
    const remote = await safeFetch(body.url, { method, headers: upstreamHeaders, body: ["GET","HEAD"].includes(method) || !body.bodyBase64 ? undefined : Buffer.from(body.bodyBase64, "base64"), redirect: body.redirect === "manual" ? "manual" : "follow" }, 0, jar);
    const declaredLength = Number(remote.headers.get("content-length") || 0);
    if (declaredLength > MAX_PROVIDER_RESPONSE) return json(res, 413, { error: "Provider response too large; use media proxy for streams" });
    const bytes = Buffer.from(await remote.arrayBuffer()); if (bytes.length > MAX_PROVIDER_RESPONSE) return json(res, 413, { error: "Provider response too large; use media proxy for streams" });
    return json(res, 200, { status: remote.status, statusText: remote.statusText, url: remote.url || body.url, headers: headerPairs(remote.headers), dataBase64: bytes.toString("base64") });
  } catch (e) { return json(res, 502, { error: e instanceof Error ? e.message : String(e) }); }
}
async function handleMedia(req, res, parsed) {
  try {
    const target = parsed.searchParams.get("url"); if (!target) return text(res, 400, "url is required");
    const jar = getProxySession(req, res);
    const token = parsed.searchParams.get("h") || ""; const h = requestHeaders(decodeToken(token));
    if (!h.has("user-agent") && req.headers["user-agent"]) h.set("user-agent", String(req.headers["user-agent"]));
    if (!h.has("accept-language") && req.headers["accept-language"]) h.set("accept-language", String(req.headers["accept-language"]));
    if (!h.has("accept-encoding")) h.set("accept-encoding", "identity");
    if (req.headers.range) h.set("range", req.headers.range); if (req.headers["if-none-match"]) h.set("if-none-match", req.headers["if-none-match"]); if (req.headers["if-modified-since"]) h.set("if-modified-since", req.headers["if-modified-since"]);
    const remote = await safeFetch(target, { method: req.method === "HEAD" ? "HEAD" : "GET", headers: h, redirect: "follow" }, 0, jar);
    const contentType = remote.headers.get("content-type") || "application/octet-stream";
    const resolvedTarget = remote.url || target;
    const hls = /mpegurl/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(resolvedTarget);
    const dash = /dash\+xml/i.test(contentType) || /\.mpd(?:$|\?)/i.test(resolvedTarget);
    res.statusCode = remote.status;
    const contentEncoding = remote.headers.get("content-encoding");
    for (const key of ["content-type","content-length","content-range","accept-ranges","etag","last-modified","cache-control"]) {
      if (key === "content-length" && contentEncoding) continue;
      const value = remote.headers.get(key);
      if (value) res.setHeader(key, value);
    }
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    const download = parsed.searchParams.get("download"); if (download) res.setHeader("Content-Disposition", `attachment; filename="${path.basename(download).replace(/[\r\n"]/g,"_")}"`);
    if (req.method === "HEAD" || !remote.body) return res.end();
    if (hls && remote.ok) { const rewritten = rewriteManifest(await remote.text(), resolvedTarget, token); res.removeHeader("content-length"); res.setHeader("content-type","application/vnd.apple.mpegurl; charset=utf-8"); res.setHeader("cache-control","no-store"); return res.end(rewritten); }
    if (dash && remote.ok) { const rewritten = rewriteDashManifest(await remote.text(), resolvedTarget); res.removeHeader("content-length"); res.setHeader("content-type","application/dash+xml; charset=utf-8"); res.setHeader("cache-control","no-store"); return res.end(rewritten); }
    Readable.fromWeb(remote.body).pipe(res);
  } catch (e) { return text(res, 502, e instanceof Error ? e.message : String(e)); }
}
const mime = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".woff2":"font/woff2" };
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, ""); if (!rel) rel = "index.html";
  let file = path.resolve(DIST, rel); if (!file.startsWith(DIST + path.sep) && file !== path.join(DIST,"index.html")) return text(res,403,"Forbidden");
  try { const st = await fsp.stat(file); if (st.isDirectory()) file = path.join(file,"index.html"); } catch { file = path.join(DIST,"index.html"); }
  try { const st = await fsp.stat(file); res.statusCode = 200; res.setHeader("content-type", mime[path.extname(file).toLowerCase()] || "application/octet-stream"); res.setHeader("content-length", st.size); if (path.basename(file) !== "index.html") res.setHeader("cache-control","public, max-age=3600"); fs.createReadStream(file).pipe(res); } catch { text(res,404,"Build output not found. Run npm run build first."); }
}
export async function handleRequest(req, res, { serveStaticFallback = true } = {}) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (parsed.pathname === "/api/health") return json(res,200,{ok:true,runtime:"vega-web"});
  if (parsed.pathname === "/api/proxy" && req.method === "POST") return handleProxy(req,res);
  if (parsed.pathname === "/api/media") return handleMedia(req,res,parsed);
  if (!serveStaticFallback) return json(res,404,{error:"Not found"});
  return serveStatic(req,res,parsed.pathname);
}

export function createServer() {
  return http.createServer((req, res) => handleRequest(req, res));
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  createServer().listen(PORT,"0.0.0.0",()=>console.log(`Vega Web listening on http://0.0.0.0:${PORT}`));
}
