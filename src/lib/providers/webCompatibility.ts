import type { ProviderExtension, ProviderModule } from "../storage/extensionStorage";

export type WebCompatibilityLevel =
  | "compatible"
  | "limited"
  | "desktop-only"
  | "unchecked";

export interface WebCompatibilityResult {
  level: WebCompatibilityLevel;
  label: string;
  reason: string;
}

const ZENDA_LIMITED_PROVIDER_HINTS = new Set([
  "vega",
  "drive",
  "4khdhub",
  "1cinevood",
  "katmovies",
  "uhd",
  "movies4u",
  "kmMovies",
  "zeefliz",
  "hdhub4u",
  "luxMovies",
  "eonMovies",
]);

const moduleText = (providerModule?: ProviderModule): string => {
  if (!providerModule) return "";
  return Object.values(providerModule.modules)
    .filter((value): value is string => typeof value === "string")
    .join("\n");
};

const looksLikeTorrentOnlyProvider = (providerValue: string, code: string) => {
  if (providerValue.toLowerCase() === "torrentio") return true;
  const hasTorrentRuntime = /get_torrent_api_port|magnet:\?|\btype\s*:\s*["']torrent["']/i.test(
    code,
  );
  const hasBrowserMedia = /\.m3u8|\.mpd|\.mp4|\.webm|application\/dash\+xml/i.test(
    code,
  );
  return hasTorrentRuntime && !hasBrowserMedia;
};

export const inspectProviderWebCompatibility = (
  providerValue: string,
  providerModule?: ProviderModule,
): WebCompatibilityResult => {
  const code = moduleText(providerModule);

  if (looksLikeTorrentOnlyProvider(providerValue, code)) {
    return {
      level: "desktop-only",
      label: "Desktop only",
      reason:
        "This provider depends on torrent/magnet playback, which a standard browser player cannot open directly.",
    };
  }

  if (code) {
    if (/openWebView|waitForCookie|cf_clearance|cf-mitigated/i.test(code)) {
      return {
        level: "limited",
        label: "Limited on web",
        reason:
          "This provider contains browser-verification/WAF logic. A deployed website cannot read challenge cookies from another origin.",
      };
    }

    if (/\bcurl-cffi-node\b|\btls-impersonate\b|require\(["'](?:fs|path|crypto|zlib|child_process)["']\)/i.test(code)) {
      return {
        level: "limited",
        label: "Limited on web",
        reason:
          "This provider contains native/Node-specific behavior that may not be reproducible inside the browser provider sandbox.",
      };
    }

    return {
      level: "compatible",
      label: "Web compatible",
      reason:
        "No known native-only or cross-origin WAF dependency was detected in the installed provider modules.",
    };
  }

  if (providerValue.toLowerCase() === "torrentio") {
    return {
      level: "desktop-only",
      label: "Desktop only",
      reason:
        "Torrent/magnet playback requires the desktop/native runtime or a separate torrent backend.",
    };
  }

  if (ZENDA_LIMITED_PROVIDER_HINTS.has(providerValue)) {
    return {
      level: "limited",
      label: "Limited on web",
      reason:
        "The current upstream provider is known to use shared extractors or verification flows that may be blocked on deployed web servers.",
    };
  }

  return {
    level: "unchecked",
    label: "Not checked",
    reason: "Install this provider to inspect its downloaded modules for web-runtime compatibility.",
  };
};

export const getProviderWebCompatibility = (
  provider: Pick<ProviderExtension, "value" | "source">,
  providerModule?: ProviderModule,
): WebCompatibilityResult => {
  const author = provider.source?.author?.toLowerCase() || "";
  const result = inspectProviderWebCompatibility(provider.value, providerModule);
  if (providerModule || author.includes("zenda")) return result;
  if (result.level !== "unchecked") return result;
  return {
    ...result,
    reason:
      "Compatibility has not been inspected yet for this custom provider source. Install it to analyze the cached modules.",
  };
};
