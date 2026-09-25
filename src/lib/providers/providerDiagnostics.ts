import type { ProviderExtension } from "../storage/extensionStorage";
import { extensionStorage } from "../storage/extensionStorage";
import { providerManager } from "../services/ProviderManager";
import { getProviderWebCompatibility } from "./webCompatibility";

export type HealthStatus = "pass" | "empty" | "limited" | "error" | "unchecked";
export interface ProviderDiagnostic {
  provider: string;
  author: string;
  version: string;
  checkedAt: number;
  modules: HealthStatus;
  catalog: HealthStatus;
  posts: HealthStatus;
  metadata: HealthStatus;
  episodes: HealthStatus;
  streams: HealthStatus;
  reason: string;
  postsFound: number;
}

const STORAGE_KEY = "vega-provider-health-v1";
export const providerHealthKey = (provider: Pick<ProviderExtension, "value" | "source">) =>
  `${provider.source?.author || "unknown"}:${provider.value}`;

function readAll(): Record<string, ProviderDiagnostic> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch { return {}; }
}

export function getProviderDiagnostic(provider: ProviderExtension): ProviderDiagnostic | null {
  const cached = readAll()[providerHealthKey(provider)];
  return cached && cached.version === provider.version ? cached : null;
}

function persist(provider: ProviderExtension, diagnostic: ProviderDiagnostic) {
  try {
    const current = readAll();
    current[providerHealthKey(provider)] = diagnostic;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch { /* In private browsing health remains usable during this session. */ }
}

export function diagnosticErrorCategory(error: unknown): { status: HealthStatus; reason: string } {
  const message = String(error instanceof Error ? error.message : error);
  if (/WEB_WAF_UNSUPPORTED|WAF|cloudflare|challenge|captcha/i.test(message)) {
    return { status: "limited", reason: "Interactive site verification is unavailable in this web runtime." };
  }
  if (/\b403\b|forbidden/i.test(message)) {
    return { status: "limited", reason: "Remote server denied access (HTTP 403)." };
  }
  if (/\b429\b|too many requests/i.test(message)) {
    return { status: "limited", reason: "Remote server applied request limits (HTTP 429)." };
  }
  if (/abort|timed? ?out/i.test(message)) {
    return { status: "error", reason: "Request timed out or was cancelled." };
  }
  if (/no posts module|module not found/i.test(message)) {
    return { status: "error", reason: "A required provider module is missing." };
  }
  // Never persist third-party error strings: they may contain tokens, URLs,
  // cookies or identifying query parameters.
  return { status: "error", reason: "The provider could not complete this check. Inspect developer diagnostics locally." };
}

/** Explicit, user-triggered shallow check: NEVER follow streaming/download links. */
export async function testProviderCatalogAndPosts(provider: ProviderExtension): Promise<ProviderDiagnostic> {
  const module = extensionStorage.getProviderModules(provider.value, provider.source?.author);
  const compatible = getProviderWebCompatibility(provider, module || undefined);
  const result: ProviderDiagnostic = {
    provider: provider.display_name,
    author: provider.source?.author || "unknown",
    version: provider.version,
    checkedAt: Date.now(),
    modules: module?.modules.posts && module.modules.meta && module.modules.stream ? "pass" : "error",
    catalog: "unchecked", posts: "unchecked", metadata: "unchecked", episodes: "unchecked", streams: "unchecked",
    postsFound: 0,
    reason: module ? "Only catalog and posts are tested. Playback must be checked separately." : "Provider modules have not been installed.",
  };
  if (result.modules === "error" || !module) {
    result.reason = "Install or repair the required posts, metadata and stream modules.";
    persist(provider, result);
    return result;
  }
  if (module.version !== provider.version) {
    result.modules = "error";
    result.reason = "Installed module version does not match the provider manifest. Update or reinstall this extension.";
    persist(provider, result);
    return result;
  }
  if (extensionStorage.getProviderSource()?.author !== provider.source?.author) {
    result.posts = "unchecked";
    result.reason = "Select this provider's source first, then run the test to avoid testing another copy.";
    persist(provider, result);
    return result;
  }
  if (compatible.level === "desktop-only") {
    result.posts = "limited";
    result.reason = compatible.reason;
    persist(provider, result);
    return result;
  }
  // Keep this check deliberately short and abort network calls on timeout.
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    let filter = "";
    if (module.modules.catalog) {
      try {
        const catalog = await providerManager.getCatalog({ providerValue: provider.value, signal: controller.signal });
        result.catalog = catalog.length ? "pass" : "empty";
        filter = catalog[0]?.filter || "";
      } catch (err) {
        const failure = diagnosticErrorCategory(err);
        result.catalog = failure.status;
        result.reason = failure.reason;
      }
    }
    if (controller.signal.aborted) throw new Error("Request timed out");
    const posts = await providerManager.getPosts({ filter, page: 1, providerValue: provider.value, signal: controller.signal });
    result.postsFound = posts.length;
    result.posts = posts.length ? "pass" : "empty";
    result.reason = posts.length
      ? "Catalog/posts responded. Metadata, episodes, streams and playback are not tested."
      : "Posts request succeeded but returned no items; check catalog and upstream availability.";
  } catch (error) {
    const failure = diagnosticErrorCategory(error);
    result.posts = failure.status;
    result.reason = failure.reason;
  } finally {
    clearTimeout(timeout);
  }
  persist(provider, result);
  return result;
}

/** Safe export only: no module source, links, headers, cookies or raw exceptions. */
export function exportProviderHealth(providers: ProviderExtension[]): string {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    note: "Catalog/posts-only user-triggered checks. No stream/playback verification.",
    providers: providers.map((provider) => getProviderDiagnostic(provider) || {
      provider: provider.display_name,
      version: provider.version,
      checkedAt: null,
      status: "unchecked",
    }),
  }, null, 2);
}
