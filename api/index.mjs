import { handleRequest } from "../server/index.mjs";

const API_ROUTES = new Set(["health", "proxy", "media"]);

function normalizeApiPath(value) {
  const route = String(value || "").replace(/^\/+|\/+$/g, "");
  return API_ROUTES.has(route) ? route : "";
}

export default async function handler(req, res) {
  const originalUrl = req.url || "/api";
  const parsed = new URL(originalUrl, `https://${req.headers.host || "localhost"}`);
  const route = normalizeApiPath(parsed.searchParams.get("path"));

  if (!route) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Not found" }));
  }

  parsed.searchParams.delete("path");
  const query = parsed.searchParams.toString();
  req.url = `/api/${route}${query ? `?${query}` : ""}`;

  try {
    return await handleRequest(req, res, { serveStaticFallback: false });
  } finally {
    req.url = originalUrl;
  }
}
