const URL_IN_MESSAGE_RE = /https?:\/\/[^\s|)\]}>'"]+/gi;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const nested = value.message ?? value.error ?? value.reason;
    if (typeof nested === "string") return nested;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error ?? "");
  }
};

/**
 * Provider errors often include both the original mirror and the upstream host
 * that actually rejected extraction. Prefer the last HTTP(S) URL because the
 * extractor usually appends the final failing URL near the end of its message.
 */
export const extractBlockedHost = (error: unknown): string | null => {
  const message = errorMessage(error);
  const urls = message.match(URL_IN_MESSAGE_RE) || [];
  for (let index = urls.length - 1; index >= 0; index -= 1) {
    try {
      return new URL(urls[index]).hostname.toLowerCase();
    } catch {
      // Ignore malformed diagnostic fragments and keep scanning.
    }
  }
  return null;
};

interface HostBlockEntry {
  count: number;
  firstSeenAt: number;
  blockedUntil: number;
}

export interface HostBlockRecord {
  provider: string;
  host: string;
  count: number;
  tripped: boolean;
  blockedUntil: number;
}

export interface HostBlockRegistry {
  record: (provider: string, host: string, now?: number) => HostBlockRecord;
  isBlocked: (provider: string, host: string, now?: number) => boolean;
  reset: (provider?: string) => void;
}

export const createHostBlockRegistry = ({
  threshold = 2,
  ttlMs = 5 * 60_000,
}: {
  threshold?: number;
  ttlMs?: number;
} = {}): HostBlockRegistry => {
  const entries = new Map<string, HostBlockEntry>();
  const safeThreshold = Math.max(1, Math.floor(threshold));
  const safeTtlMs = Math.max(1_000, Math.floor(ttlMs));
  const keyFor = (provider: string, host: string) =>
    `${provider.trim().toLowerCase()}|${host.trim().toLowerCase()}`;

  const purgeExpired = (now: number) => {
    for (const [key, entry] of entries) {
      if (entry.blockedUntil <= now) entries.delete(key);
    }
  };

  return {
    record(provider, host, now = Date.now()) {
      purgeExpired(now);
      const normalizedProvider = provider.trim().toLowerCase() || "unknown";
      const normalizedHost = host.trim().toLowerCase();
      const key = keyFor(normalizedProvider, normalizedHost);
      const previous = entries.get(key);
      const count = (previous?.count || 0) + 1;
      const tripped = count >= safeThreshold;
      const entry: HostBlockEntry = {
        count,
        firstSeenAt: previous?.firstSeenAt ?? now,
        blockedUntil: tripped ? now + safeTtlMs : now + safeTtlMs,
      };
      entries.set(key, entry);
      return {
        provider: normalizedProvider,
        host: normalizedHost,
        count,
        tripped,
        blockedUntil: entry.blockedUntil,
      };
    },

    isBlocked(provider, host, now = Date.now()) {
      purgeExpired(now);
      const entry = entries.get(keyFor(provider, host));
      return Boolean(entry && entry.count >= safeThreshold && entry.blockedUntil > now);
    },

    reset(provider) {
      if (!provider) {
        entries.clear();
        return;
      }
      const prefix = `${provider.trim().toLowerCase()}|`;
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },
  };
};
