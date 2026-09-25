export type PlaybackFailureCategory =
  | "aborted"
  | "offline"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "server"
  | "timeout"
  | "hls_network"
  | "hls_media"
  | "decode"
  | "unsupported"
  | "network"
  | "unknown";

export interface PlaybackFailure {
  category: PlaybackFailureCategory;
  message: string;
  userMessage: string;
  retryable: boolean;
  hostBlocked: boolean;
  status?: number;
  raw: unknown;
}

const extractMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const anyError = error as Record<string, unknown>;
    const nested = anyError.message ?? anyError.error ?? anyError.reason;
    if (typeof nested === "string") return nested;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error ?? "Unknown playback error");
  }
};

const extractStatus = (message: string, error: unknown): number | undefined => {
  if (error && typeof error === "object") {
    const candidate = error as any;
    const direct = Number(candidate.status ?? candidate.statusCode ?? candidate.response?.status);
    if (Number.isInteger(direct) && direct >= 100 && direct <= 599) return direct;
  }
  const match = message.match(/(?:HTTP\s+|status(?:\s+code)?\s*[:=]?\s*)([1-5]\d\d)\b/i);
  if (match) return Number(match[1]);
  const loose = message.match(/\b(401|403|404|408|410|425|429|5\d\d)\b/);
  return loose ? Number(loose[1]) : undefined;
};

export const classifyPlaybackError = (error: unknown): PlaybackFailure => {
  const message = extractMessage(error);
  const lower = message.toLowerCase();
  const status = extractStatus(message, error);
  const name = error instanceof Error ? error.name : "";
  const explicitCategory = error && typeof error === "object"
    ? String((error as Record<string, unknown>).category || "") as PlaybackFailureCategory
    : "" as PlaybackFailureCategory;

  if (explicitCategory === "decode") {
    return { category: "decode", message, userMessage: "Your browser could not decode this stream. Vega will try another source.", retryable: false, hostBlocked: false, status, raw: error };
  }
  if (explicitCategory === "unsupported") {
    return { category: "unsupported", message, userMessage: "This stream format is not supported by your browser. Vega will try another source.", retryable: false, hostBlocked: false, status, raw: error };
  }
  if (explicitCategory === "hls_media") {
    return { category: "hls_media", message, userMessage: "The HLS media data could not be decoded. Vega will try another source.", retryable: false, hostBlocked: false, status, raw: error };
  }
  if (explicitCategory === "hls_network") {
    return { category: "hls_network", message, userMessage: "The HLS stream had a network failure. Vega will retry once, then use another source.", retryable: true, hostBlocked: false, status, raw: error };
  }
  if (explicitCategory === "timeout") {
    return { category: "timeout", message, userMessage: "The source took too long to respond. Vega will retry once, then use another source.", retryable: true, hostBlocked: false, status, raw: error };
  }
  if (explicitCategory === "network") {
    return { category: "network", message, userMessage: "The source had a network problem. Vega will retry once, then use another source.", retryable: true, hostBlocked: false, status, raw: error };
  }

  if (/web_waf_unsupported/.test(lower)) {
    return {
      category: "unsupported",
      message,
      userMessage:
        "This provider needs browser verification that the web build cannot complete. Try another provider or use the desktop app for this source.",
      retryable: false,
      hostBlocked: true,
      status: status ?? 403,
      raw: error,
    };
  }

  if (name === "AbortError" || /\babort(?:ed)?\b/.test(lower)) {
    return { category: "aborted", message, userMessage: "Playback request was cancelled.", retryable: false, hostBlocked: false, status, raw: error };
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { category: "offline", message, userMessage: "You appear to be offline. Check your connection and try again.", retryable: false, hostBlocked: false, status, raw: error };
  }

  if (status === 401 || status === 403 || /\b(waf|cloudflare|access denied|forbidden|challenge)\b/.test(lower)) {
    return { category: "forbidden", message, userMessage: "This video host rejected the request. Vega will try another source when available.", retryable: false, hostBlocked: true, status: status ?? 403, raw: error };
  }

  if (status === 404 || status === 410 || /\b(not found|gone|dead link|source expired)\b/.test(lower)) {
    return { category: "not_found", message, userMessage: "This source is no longer available. Vega will try another source when available.", retryable: false, hostBlocked: false, status, raw: error };
  }

  if (status === 429 || /rate.?limit|too many requests/.test(lower)) {
    return { category: "rate_limited", message, userMessage: "This host is rate-limiting requests. Vega will retry once, then use another source.", retryable: true, hostBlocked: false, status: status ?? 429, raw: error };
  }

  if (status === 408 || status === 425 || /\b(timeout|timed out|etimedout|econnaborted)\b/.test(lower)) {
    return { category: "timeout", message, userMessage: "The source took too long to respond. Vega will retry once, then use another source.", retryable: true, hostBlocked: false, status, raw: error };
  }

  if ((status != null && status >= 500) || /\b(service unavailable|bad gateway|gateway timeout|upstream error)\b/.test(lower)) {
    return { category: "server", message, userMessage: "The video host is temporarily unavailable. Vega will retry once, then use another source.", retryable: true, hostBlocked: false, status, raw: error };
  }

  if (/\bhls\b.*\b(network|fragload|levelload|manifestload)|\bnetworkerror\b.*\bhls\b|fragloaderror|levelloaderror|manifestloaderror/i.test(message)) {
    return { category: "hls_network", message, userMessage: "The HLS stream had a network failure. Vega will retry once, then use another source.", retryable: true, hostBlocked: false, status, raw: error };
  }

  if (/\bhls\b.*\b(media|parsing)|mediaerror|fragparsingerror/i.test(message)) {
    return { category: "hls_media", message, userMessage: "The HLS media data could not be decoded. Vega will try another source.", retryable: false, hostBlocked: false, status, raw: error };
  }

  if (/media_err_decode|decode(?:r|d| error)|corrupt media|demux/i.test(message)) {
    return { category: "decode", message, userMessage: "Your browser could not decode this stream. Vega will try another source.", retryable: false, hostBlocked: false, status, raw: error };
  }

  if (/media_err_src_not_supported|not supported|unsupported (?:codec|format|source)|no supported source/i.test(message)) {
    return { category: "unsupported", message, userMessage: "This stream format is not supported by your browser. Vega will try another source.", retryable: false, hostBlocked: false, status, raw: error };
  }

  if (/failed to fetch|network error|networkerror|econnreset|econnrefused|dns|enotfound|socket/i.test(message)) {
    return { category: "network", message, userMessage: "The source had a network problem. Vega will retry once, then use another source.", retryable: true, hostBlocked: false, status, raw: error };
  }

  return { category: "unknown", message, userMessage: message || "This source could not be played. Vega will try another source when available.", retryable: true, hostBlocked: false, status, raw: error };
};

export const shouldRetryPlaybackFailure = (
  error: PlaybackFailure | unknown,
  failureCount: number,
): boolean => {
  const failure = (error && typeof error === "object" && "category" in (error as object))
    ? error as PlaybackFailure
    : classifyPlaybackError(error);
  if (!failure.retryable) return false;
  // Exactly one automatic retry for transient/unknown failures.
  return failureCount < 1;
};
