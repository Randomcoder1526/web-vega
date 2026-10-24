import type { ProviderExtension } from "../storage/extensionStorage";
import { extensionStorage } from "../storage/extensionStorage";
import { providerManager } from "../services/ProviderManager";
import { getProviderWebCompatibility } from "./webCompatibility";

export type HealthStatus = "pass" | "empty" | "limited" | "error" | "unchecked";
export type DiagnosticStage = "modules" | "catalog" | "posts" | "metadata" | "episodes" | "streams";
export type DiagnosticStageDetails = Record<DiagnosticStage, string>;

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
  episodesFound: number;
  streamsFound: number;
  stageDetails: DiagnosticStageDetails;
}

const STORAGE_KEY = "vega-provider-health-v2";
const PROVIDER_TEST_TIMEOUT_MS = 35_000;

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
  if (/no posts module|no meta data module|no episode links module|no stream module|module not found/i.test(message)) {
    return { status: "error", reason: "A required provider module is missing." };
  }
  // Never persist third-party error strings: they may contain tokens, URLs,
  // cookies or identifying query parameters.
  return { status: "error", reason: "The provider could not complete this check. Inspect developer diagnostics locally." };
}

const initialStageDetails = (): DiagnosticStageDetails => ({
  modules: "Checking installed modules and version compatibility.",
  catalog: "Not checked yet.",
  posts: "Not checked yet.",
  metadata: "Not checked yet.",
  episodes: "Not checked yet.",
  streams: "Not checked yet. Stream extraction is tested; actual playback is not started.",
});

const asDiagnostic = (result: ProviderDiagnostic): ProviderDiagnostic => ({
  ...result,
  stageDetails: { ...result.stageDetails },
});

/**
 * Explicit user-triggered provider check. It probes catalog, posts, metadata,
 * episode extraction and stream extraction for one representative listing.
 * It never opens media URLs or writes stream URLs, headers or raw exceptions to
 * the persisted diagnostic result.
 */
export async function testProviderCatalogAndPosts(
  provider: ProviderExtension,
  onProgress?: (diagnostic: ProviderDiagnostic) => void,
): Promise<ProviderDiagnostic> {
  const module = extensionStorage.getProviderModules(provider.value, provider.source?.author);
  const compatible = getProviderWebCompatibility(provider, module || undefined);
  const result: ProviderDiagnostic = {
    provider: provider.display_name,
    author: provider.source?.author || "unknown",
    version: provider.version,
    checkedAt: Date.now(),
    modules: module?.modules.posts && module.modules.meta && module.modules.stream ? "pass" : "error",
    catalog: "unchecked",
    posts: "unchecked",
    metadata: "unchecked",
    episodes: "unchecked",
    streams: "unchecked",
    postsFound: 0,
    episodesFound: 0,
    streamsFound: 0,
    reason: module ? "Provider tests have not completed." : "Provider modules have not been installed.",
    stageDetails: initialStageDetails(),
  };

  const publish = () => {
    result.checkedAt = Date.now();
    persist(provider, result);
    onProgress?.(asDiagnostic(result));
  };

  const modules = module?.modules;
  const requiredModulesReady = Boolean(modules?.posts && modules?.meta && modules?.stream);
  result.modules = requiredModulesReady ? "pass" : "error";
  result.stageDetails.modules = requiredModulesReady
    ? "Posts, metadata and stream modules are installed."
    : "One or more required posts, metadata or stream modules are missing.";

  if (!module || !modules || !requiredModulesReady) {
    result.reason = "Install or repair the provider modules, then run the test again.";
    result.catalog = modules?.catalog ? "unchecked" : "empty";
    result.stageDetails.catalog = modules?.catalog ? "Waiting for module repair." : "This provider has no catalog module.";
    result.stageDetails.posts = "Skipped because required modules are missing.";
    result.stageDetails.metadata = "Skipped because required modules are missing.";
    result.stageDetails.episodes = "Skipped because required modules are missing.";
    result.stageDetails.streams = "Skipped because required modules are missing.";
    publish();
    return result;
  }

  if (module.version !== provider.version) {
    result.modules = "error";
    result.stageDetails.modules = "Installed module version does not match the provider manifest.";
    result.reason = "Update or reinstall this extension before testing it.";
    publish();
    return result;
  }

  if (extensionStorage.getProviderSource()?.author !== provider.source?.author) {
    result.posts = "unchecked";
    result.reason = "Select this provider's source first, then run the test to avoid testing another copy.";
    result.stageDetails.posts = result.reason;
    publish();
    return result;
  }

  if (compatible.level === "desktop-only") {
    result.posts = "limited";
    result.metadata = "limited";
    result.episodes = "limited";
    result.streams = "limited";
    result.reason = compatible.reason;
    result.stageDetails.posts = compatible.reason;
    result.stageDetails.metadata = compatible.reason;
    result.stageDetails.episodes = compatible.reason;
    result.stageDetails.streams = "Stream extraction requires the desktop runtime for this provider.";
    publish();
    return result;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PROVIDER_TEST_TIMEOUT_MS);
  let firstPost: { title?: string; link?: string } | null = null;
  let info: any = null;
  let episodes: Array<{ link?: string; title?: string }> = [];
  let catalogFilter = "";
  const safeLinks = (value: unknown): Array<{ link?: string; episodesLink?: string; directLinks?: Array<{ link?: string }> }> =>
    Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") : [];

  try {
    if (modules.catalog) {
      try {
        const catalog = await providerManager.getCatalog({ providerValue: provider.value, signal: controller.signal });
        result.catalog = catalog.length ? "pass" : "empty";
        catalogFilter = catalog[0]?.filter || "";
        result.stageDetails.catalog = catalog.length
          ? `Catalog responded with ${catalog.length} section(s).`
          : "Catalog request succeeded but returned no sections.";
      } catch (error) {
        const failure = diagnosticErrorCategory(error);
        result.catalog = failure.status;
        result.stageDetails.catalog = failure.reason;
      }
    } else {
      result.catalog = "empty";
      result.stageDetails.catalog = "This provider does not expose a catalog module; a search/posts-only provider may still work.";
    }
    publish();
    if (controller.signal.aborted) throw new Error("Request timed out");

    const posts = await providerManager.getPosts({
      filter: catalogFilter,
      page: 1,
      providerValue: provider.value,
      signal: controller.signal,
    });
    result.postsFound = posts.length;
    result.posts = posts.length ? "pass" : "empty";
    firstPost = posts.find((post) => typeof post?.link === "string" && post.link.trim()) || null;
    result.stageDetails.posts = posts.length
      ? `Posts endpoint responded with ${posts.length} item(s).`
      : "Posts request succeeded but returned no items.";
    if (posts.length && !firstPost) {
      result.stageDetails.posts = "Posts were returned, but none contained a usable detail link for deeper checks.";
    }
    publish();

    if (!firstPost?.link) {
      result.metadata = "unchecked";
      result.episodes = "unchecked";
      result.streams = "unchecked";
      result.stageDetails.metadata = "Needs at least one post with a detail link.";
      result.stageDetails.episodes = "Needs a sample listing or episode link.";
      result.stageDetails.streams = "Needs a sample playable link; no media was opened.";
      result.reason = "Catalog/posts check finished, but there was no usable sample link for metadata, episodes or streams.";
      publish();
      return result;
    }

    try {
      info = await providerManager.getMetaData({
        link: firstPost.link,
        provider: provider.value,
        signal: controller.signal,
      });
      const infoLooksUseful = Boolean(
        info && (info.title || info.synopsis || info.image || (Array.isArray(info.linkList) && info.linkList.length)),
      );
      result.metadata = infoLooksUseful ? "pass" : "empty";
      result.stageDetails.metadata = infoLooksUseful
        ? `Metadata responded${info.title ? ` for “${String(info.title).slice(0, 100)}”` : " with usable fields"}.`
        : "Metadata request succeeded but returned no usable details.";
    } catch (error) {
      const failure = diagnosticErrorCategory(error);
      result.metadata = failure.status;
      result.stageDetails.metadata = failure.reason;
    }
    publish();

    const linkList = safeLinks(info?.linkList);
    const episodeIndex = linkList.find((entry) => typeof entry.episodesLink === "string" && entry.episodesLink.trim());
    const directCandidates = linkList.flatMap((entry) => Array.isArray(entry.directLinks) ? entry.directLinks : []);
    const firstDirect = directCandidates.find((entry) => typeof entry?.link === "string" && entry.link.trim());
    const contentType = String(info?.type || "").toLowerCase();
    const looksSeries = /series|tv|anime|show|episode/.test(contentType) || Boolean(episodeIndex?.episodesLink);

    if (modules.episodes && episodeIndex?.episodesLink) {
      try {
        episodes = await providerManager.getEpisodes({
          url: episodeIndex.episodesLink,
          providerValue: provider.value,
          signal: controller.signal,
        });
        result.episodesFound = episodes.length;
        result.episodes = episodes.length ? "pass" : "empty";
        result.stageDetails.episodes = episodes.length
          ? `Episode extraction returned ${episodes.length} episode(s).`
          : "Episode extraction succeeded but returned no episodes.";
      } catch (error) {
        const failure = diagnosticErrorCategory(error);
        result.episodes = failure.status;
        result.stageDetails.episodes = failure.reason;
      }
    } else if (!modules.episodes) {
      result.episodes = "limited";
      result.stageDetails.episodes = "No episodes module is installed. Movie-only sources may still be supported.";
    } else if (!looksSeries) {
      result.episodes = "empty";
      result.stageDetails.episodes = "No episode-list link was found in this sample; it may be a movie source.";
    } else {
      result.episodes = "unchecked";
      result.stageDetails.episodes = "Metadata did not provide an episode-list link for this sample.";
    }
    publish();

    const sampleStreamLink = episodes.find((episode) => typeof episode?.link === "string" && episode.link.trim())?.link
      || firstDirect?.link
      || (!looksSeries ? firstPost.link : undefined);
    if (!sampleStreamLink) {
      result.streams = "unchecked";
      result.stageDetails.streams = "No representative episode/direct link was available, so stream extraction was not run.";
    } else if (controller.signal.aborted) {
      throw new Error("Request timed out");
    } else {
      try {
        const streams = await providerManager.getStream({
          link: sampleStreamLink,
          type: looksSeries ? "series" : "movie",
          signal: controller.signal,
          providerValue: provider.value,
          isDownload: false,
        });
        result.streamsFound = streams.length;
        result.streams = streams.length ? "pass" : "empty";
        result.stageDetails.streams = streams.length
          ? `Stream extraction returned ${streams.length} candidate(s). Playback and media URLs were not opened.`
          : "Stream extractor responded but returned no playable candidates.";
      } catch (error) {
        const failure = diagnosticErrorCategory(error);
        result.streams = failure.status;
        result.stageDetails.streams = failure.reason;
      }
    }
    result.reason = summarizeResult(result);
    publish();
  } catch (error) {
    const failure = diagnosticErrorCategory(error);
    if (result.posts === "unchecked") {
      result.posts = failure.status;
      result.stageDetails.posts = failure.reason;
    } else if (result.metadata === "unchecked") {
      result.metadata = failure.status;
      result.stageDetails.metadata = failure.reason;
    } else if (result.episodes === "unchecked") {
      result.episodes = failure.status;
      result.stageDetails.episodes = failure.reason;
    } else if (result.streams === "unchecked") {
      result.streams = failure.status;
      result.stageDetails.streams = failure.reason;
    }
    result.reason = summarizeResult(result);
    publish();
  } finally {
    clearTimeout(timeout);
  }

  return result;
}

function summarizeResult(result: ProviderDiagnostic): string {
  const stages: Array<[string, HealthStatus]> = [
    ["catalog", result.catalog],
    ["posts", result.posts],
    ["metadata", result.metadata],
    ["episodes", result.episodes],
    ["streams", result.streams],
  ];
  const failed = stages.filter(([, status]) => status === "error" || status === "limited");
  const unchecked = stages.filter(([, status]) => status === "unchecked");
  if (failed.length) return `Needs attention: ${failed.map(([name, status]) => `${name} ${status}`).join(", ")}.`;
  if (unchecked.length) return `Partially tested: ${unchecked.map(([name]) => name).join(", ")} still unchecked.`;
  if (stages.some(([, status]) => status === "empty")) return "Tests finished; one or more stages returned no matching data.";
  return "All provider extraction checks passed. Actual playback is not tested.";
}

/** Safe export only: no module source, media links, headers, cookies or raw exceptions. */
export function exportProviderHealth(providers: ProviderExtension[]): string {
  return JSON.stringify({
    version: 2,
    exportedAt: new Date().toISOString(),
    note: "User-triggered catalog, posts, metadata, episodes and stream-extraction checks. Actual playback is not tested.",
    providers: providers.map((provider) => getProviderDiagnostic(provider) || {
      provider: provider.display_name,
      version: provider.version,
      checkedAt: null,
      status: "unchecked",
    }),
  }, null, 2);
}
