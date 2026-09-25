export interface StreamCandidateLike {
  server?: string;
  link?: string;
  type?: string;
  quality?: string | number;
}

export interface EpisodeCandidateLike {
  title?: string;
  link?: string;
  sourceLink?: string;
  sourceName?: string;
  sourceGroupIndex?: number;
  localFile?: boolean;
  quality?: string | number;
  [key: string]: unknown;
}

export const parseQualityHeight = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (/\b4\s*k\b|\buhd\b/.test(normalized)) return 2160;

  const match = normalized.match(/\b(2160|1440|1080|720|576|540|480|360|240)\s*p?\b/);
  if (match) return Number(match[1]);

  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
};

export const streamCandidateKey = (stream: StreamCandidateLike | null | undefined): string => {
  if (!stream?.link) return "";
  // The link is the primary identity. Type/quality distinguish deliberately
  // different representations while ignoring cosmetic server labels.
  return [stream.link, stream.type || "", String(stream.quality ?? "")].join("|");
};

export const findNextUntriedStream = <T extends StreamCandidateLike>(
  streams: T[],
  current: T | null | undefined,
  attempted: ReadonlySet<string>,
): T | null => {
  const currentKey = streamCandidateKey(current);
  const seenLinks = new Set<string>(current?.link ? [current.link] : []);

  for (const stream of streams || []) {
    if (!stream?.link) continue;
    const key = streamCandidateKey(stream);
    if (!key || key === currentKey || attempted.has(key)) continue;
    // If the same underlying URL appears under multiple server labels, trying
    // it again will almost always reproduce the same failure.
    if (seenLinks.has(stream.link)) continue;
    seenLinks.add(stream.link);
    return stream;
  }
  return null;
};

export const findFallbackAudioStream = <T extends StreamCandidateLike>(
  streams: T[] | null | undefined,
  selected: T | null | undefined,
): T | null => {
  if (!streams?.length) return null;
  const selectedQuality = parseQualityHeight(selected?.quality);
  if (!selected?.link || selectedQuality === null || selectedQuality < 1080) {
    return null;
  }

  const candidates = (streams || []).filter((stream) => {
    if (!stream?.link || stream.link === selected.link) return false;
    if (!/^https?:\/\//i.test(stream.link)) return false;
    const quality = parseQualityHeight(stream.quality);
    return quality !== null && quality < selectedQuality;
  });

  if (!candidates.length) return null;

  const preferredOrder = [480, 720, 360];
  for (const preferredQuality of preferredOrder) {
    const match = candidates.find(
      (stream) => parseQualityHeight(stream.quality) === preferredQuality,
    );
    if (match) return match;
  }

  return [...candidates].sort(
    (left, right) =>
      (parseQualityHeight(right.quality) || 0) -
      (parseQualityHeight(left.quality) || 0),
  )[0] || null;
};


export interface LinkGroupLike<T extends EpisodeCandidateLike = EpisodeCandidateLike> {
  title?: string;
  quality?: string | number;
  episodesLink?: string;
  directLinks?: T[];
}

export const getSourceDisplayName = (
  source: LinkGroupLike | EpisodeCandidateLike | null | undefined,
  index = 0,
): string => {
  const title = typeof source?.title === "string" ? source.title.trim() : "";
  if (title) return title;

  const sourceName =
    typeof (source as EpisodeCandidateLike | undefined)?.sourceName === "string"
      ? (source as EpisodeCandidateLike).sourceName?.trim() || ""
      : "";
  if (sourceName) return sourceName;

  const quality = source?.quality;
  if (quality !== undefined && quality !== null && String(quality).trim()) {
    const raw = String(quality).trim();
    const height = parseQualityHeight(raw);
    if (height === 2160 && /4\s*k/i.test(raw)) return "4K";
    return /p$/i.test(raw) || /k$/i.test(raw) ? raw : `${raw}p`;
  }

  const group = source as LinkGroupLike | undefined;
  const candidate = source as EpisodeCandidateLike | undefined;
  const possibleUrl =
    group?.episodesLink ||
    group?.directLinks?.[0]?.sourceLink ||
    group?.directLinks?.[0]?.link ||
    candidate?.sourceLink ||
    candidate?.link ||
    "";
  if (possibleUrl) {
    try {
      const url = new URL(possibleUrl);
      const hostname = url.hostname.replace(/^www\./i, "").trim();
      if (hostname) return hostname;
    } catch {
      // Provider identifiers are sometimes not URLs. Fall back to a stable label.
    }
  }

  return `Source ${index + 1}`;
};

const candidateLink = (candidate: EpisodeCandidateLike | null | undefined) =>
  candidate?.sourceLink || candidate?.link || "";

const withGroupQuality = <T extends EpisodeCandidateLike>(
  candidate: T,
  group?: LinkGroupLike<T>,
  groupIndex?: number,
): T => {
  const quality =
    parseQualityHeight(candidate.quality) ??
    parseQualityHeight(group?.quality) ??
    parseQualityHeight(group?.title);
  const sourceName = candidate.sourceName?.trim() ||
    (group ? getSourceDisplayName(group, groupIndex ?? 0) : "");
  return {
    ...candidate,
    ...(quality === null ? {} : { quality: String(quality) }),
    ...(sourceName ? { sourceName } : {}),
    ...(groupIndex === undefined ? {} : { sourceGroupIndex: groupIndex }),
  } as T;
};

export const buildMovieExtractionQueue = <T extends EpisodeCandidateLike>(
  linkGroups: LinkGroupLike<T>[],
  selected: T | null | undefined,
): T[] => {
  const result: T[] = [];
  const seenLinks = new Set<string>();

  const add = (
    candidate: T | null | undefined,
    group?: LinkGroupLike<T>,
    groupIndex?: number,
  ) => {
    if (!candidate) return;
    const link = candidateLink(candidate);
    if (!link || seenLinks.has(link)) return;
    seenLinks.add(link);
    result.push(withGroupQuality(candidate, group, groupIndex));
  };

  const selectedLink = candidateLink(selected);
  const selectedGroupIndex = (linkGroups || []).findIndex((group) =>
    (group?.directLinks || []).some((candidate) => candidateLink(candidate) === selectedLink),
  );
  const selectedGroup = selectedGroupIndex >= 0 ? linkGroups[selectedGroupIndex] : undefined;

  add(selected, selectedGroup, selectedGroupIndex >= 0 ? selectedGroupIndex : undefined);
  for (const [groupIndex, group] of (linkGroups || []).entries()) {
    for (const candidate of group?.directLinks || []) add(candidate, group, groupIndex);
  }

  return result;
};

export const findNextMovieMirror = <T extends EpisodeCandidateLike>(
  episodeList: T[],
  activeIndex: number,
  attemptedLinks: ReadonlySet<string>,
  type: string,
): { index: number; episode: T } | null => {
  if (String(type || "").toLowerCase() !== "movie") return null;
  if (!Array.isArray(episodeList) || episodeList.length < 2) return null;

  const current = episodeList[activeIndex];
  const currentLink = current?.sourceLink || current?.link || "";
  const seen = new Set<string>(currentLink ? [currentLink] : []);

  // Prefer later mirrors first so fallback follows the order presented by the
  // provider, then wrap to earlier entries.
  const order = [
    ...Array.from({ length: episodeList.length - activeIndex - 1 }, (_, i) => activeIndex + 1 + i),
    ...Array.from({ length: activeIndex }, (_, i) => i),
  ];

  for (const index of order) {
    const episode = episodeList[index];
    if (!episode || episode.localFile) continue;
    const link = episode.sourceLink || episode.link || "";
    if (!link || seen.has(link) || attemptedLinks.has(link)) continue;
    seen.add(link);
    return { index, episode };
  }
  return null;
};
