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
  localFile?: boolean;
  [key: string]: unknown;
}

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
  streams: T[],
  selected: T | null | undefined,
): T | null => {
  const selectedQuality = Number(selected?.quality);
  if (!selected?.link || !Number.isFinite(selectedQuality) || selectedQuality < 1080) {
    return null;
  }

  const candidates = (streams || []).filter((stream) => {
    if (!stream?.link || stream.link === selected.link) return false;
    if (!/^https?:\/\//i.test(stream.link)) return false;
    const quality = Number(stream.quality);
    return Number.isFinite(quality) && quality < selectedQuality;
  });

  if (!candidates.length) return null;

  const preferredOrder = [480, 720, 360];
  for (const preferredQuality of preferredOrder) {
    const match = candidates.find((stream) => Number(stream.quality) === preferredQuality);
    if (match) return match;
  }

  return [...candidates].sort(
    (left, right) => Number(right.quality) - Number(left.quality),
  )[0] || null;
};


export interface LinkGroupLike<T extends EpisodeCandidateLike = EpisodeCandidateLike> {
  title?: string;
  directLinks?: T[];
}

export const buildMovieExtractionQueue = <T extends EpisodeCandidateLike>(
  linkGroups: LinkGroupLike<T>[],
  selected: T | null | undefined,
): T[] => {
  const result: T[] = [];
  const seenLinks = new Set<string>();

  const add = (candidate: T | null | undefined) => {
    if (!candidate) return;
    const link = candidate.sourceLink || candidate.link || "";
    if (!link || seenLinks.has(link)) return;
    seenLinks.add(link);
    result.push(candidate);
  };

  add(selected);
  for (const group of linkGroups || []) {
    for (const candidate of group?.directLinks || []) add(candidate);
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
