const asObject = (value: unknown): Record<string, any> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;

const pickArray = (value: unknown, keys: string[]): unknown[] => {
  if (Array.isArray(value)) return value;
  const object = asObject(value);
  if (!object) return [];
  for (const key of keys) {
    if (Array.isArray(object[key])) return object[key];
  }
  return [];
};

const stringValue = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
};

export const normalizeQuality = (value: unknown): string | undefined => {
  const raw = stringValue(value);
  if (!raw) return undefined;
  const compact = raw.toLowerCase().replace(/\s+/g, "");
  if (/^(4k|uhd|2160p?)$/.test(compact)) return "2160";
  const numeric = compact.match(/(?:^|[^0-9])(360|480|720|1080|1440|2160)(?:p)?(?:$|[^0-9])/);
  if (numeric) return numeric[1];
  return raw;
};

export const normalizeHeaders = (
  value: unknown,
): Record<string, string> | undefined => {
  if (!value) return undefined;
  const result: Record<string, string> = {};

  if (typeof Headers !== "undefined" && value instanceof Headers) {
    value.forEach((headerValue, key) => {
      result[key.toLowerCase()] = headerValue;
    });
  } else if (typeof (value as any)?.forEach === "function") {
    try {
      (value as any).forEach((headerValue: unknown, key: unknown) => {
        if (headerValue != null && key != null) {
          result[String(key).toLowerCase()] = String(headerValue);
        }
      });
    } catch {
      // Fall through to plain-object handling below when available.
    }
  }

  const object = asObject(value);
  if (object) {
    for (const [key, headerValue] of Object.entries(object)) {
      if (headerValue == null || typeof headerValue === "function") continue;
      result[key.toLowerCase()] = Array.isArray(headerValue)
        ? headerValue.map(String).join(", ")
        : String(headerValue);
    }
  }

  return Object.keys(result).length ? result : undefined;
};

const inferStreamType = (link: string, explicit: unknown): string => {
  const type = stringValue(explicit).toLowerCase();
  if (type) {
    if (type === "hls" || type === "application/vnd.apple.mpegurl") return "m3u8";
    if (type === "dash" || type === "mpd" || type === "application/dash+xml") return "mpd";
    return type;
  }
  const lowerLink = link.toLowerCase().split("?")[0];
  if (lowerLink.startsWith("magnet:")) return "torrent";
  if (lowerLink.endsWith(".m3u8")) return "m3u8";
  if (lowerLink.endsWith(".mpd")) return "mpd";
  if (lowerLink.endsWith(".mkv")) return "mkv";
  if (lowerLink.endsWith(".webm")) return "webm";
  if (lowerLink.endsWith(".mov")) return "mov";
  return "mp4";
};

const inferSubtitleType = (uri: string, explicit: unknown): string => {
  const type = stringValue(explicit);
  if (type) return type;
  const lower = uri.toLowerCase().split("?")[0];
  if (lower.endsWith(".srt")) return "application/x-subrip";
  if (lower.endsWith(".ttml") || lower.endsWith(".xml")) {
    return "application/ttml+xml";
  }
  return "text/vtt";
};

const normalizeSubtitles = (value: unknown): any[] | undefined => {
  const list = pickArray(value, ["subtitles", "tracks", "captions", "data"]);
  const normalized = list.flatMap((entry) => {
    const item = asObject(entry);
    if (!item) return [];
    const uri = stringValue(item.uri, item.url, item.file, item.src);
    if (!uri) return [];
    return [
      {
        title: stringValue(item.title, item.label, item.name, item.language, "Subtitle"),
        language: stringValue(item.language, item.lang, item.srclang, "en"),
        type: inferSubtitleType(uri, item.type),
        uri,
      },
    ];
  });
  return normalized.length ? normalized : undefined;
};

const cleanStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const result = value.map((entry) => stringValue(entry)).filter(Boolean);
  return result.length ? result : undefined;
};

export const getWebStreamPriority = (stream: { link?: string; type?: string }): number => {
  const type = stringValue(stream?.type).toLowerCase();
  const link = stringValue(stream?.link).toLowerCase();
  if (type === "m3u8" || link.includes(".m3u8")) return 0;
  if (type === "mpd" || link.includes(".mpd")) return 1;
  if (type === "mp4" || link.includes(".mp4")) return 2;
  if (type === "webm" || link.includes(".webm")) return 3;
  if (type === "mov" || link.includes(".mov")) return 4;
  if (type === "mkv" || link.includes(".mkv")) return 8;
  if (type === "torrent" || link.startsWith("magnet:")) return 9;
  return /^https?:/i.test(link) ? 5 : 7;
};

export const sortStreamsForWebPlayback = <T extends { link?: string; type?: string }>(
  streams: T[],
): T[] =>
  streams
    .map((stream, index) => ({ stream, index, priority: getWebStreamPriority(stream) }))
    .sort((left, right) =>
      left.priority === right.priority
        ? left.index - right.index
        : left.priority - right.priority,
    )
    .map(({ stream }) => stream);

export const normalizeStreamResult = (value: unknown): any[] => {
  const list = pickArray(value, ["streams", "sources", "results", "items", "data"]);
  const seen = new Set<string>();
  const normalized: any[] = [];

  list.forEach((entry, index) => {
    const item = asObject(entry);
    if (!item) return;
    const link = stringValue(item.link, item.url, item.file, item.src, item.playlist);
    if (!link || seen.has(link)) return;
    seen.add(link);

    const stream: Record<string, any> = {
      server: stringValue(item.server, item.name, item.title, item.label) || `Source ${index + 1}`,
      link,
      type: inferStreamType(link, item.type ?? item.format),
    };
    const quality = normalizeQuality(item.quality ?? item.resolution ?? item.label);
    if (quality) stream.quality = quality;
    if (typeof item.tag === "string" && item.tag.trim()) stream.tag = item.tag.trim();
    const tags = cleanStringArray(item.tags);
    if (tags) stream.tags = tags;
    const headers = normalizeHeaders(item.headers ?? item.requestHeaders);
    if (headers) stream.headers = headers;
    const subtitles = normalizeSubtitles(item.subtitles ?? item.captions ?? item.tracks);
    if (subtitles) stream.subtitles = subtitles;
    if (Array.isArray(item.skip)) stream.skip = item.skip;
    if (typeof item.localBaseDir === "string") stream.localBaseDir = item.localBaseDir;
    normalized.push(stream);
  });

  // Preserve the provider's priority order, but do not choose a raw magnet/torrent
  // ahead of a directly browser-fetchable source when both are returned.
  if (normalized.some((stream) => /^https?:/i.test(stream.link))) {
    return normalized
      .map((stream, index) => ({ stream, index }))
      .sort((a, b) => {
        const aTorrent = a.stream.type === "torrent" || a.stream.link.startsWith("magnet:");
        const bTorrent = b.stream.type === "torrent" || b.stream.link.startsWith("magnet:");
        if (aTorrent === bTorrent) return a.index - b.index;
        return aTorrent ? 1 : -1;
      })
      .map(({ stream }) => stream);
  }
  return normalized;
};

export const normalizePostResult = (value: unknown): any[] => {
  const list = pickArray(value, ["posts", "results", "items", "data"]);
  return list.flatMap((entry) => {
    const item = asObject(entry);
    if (!item) return [];
    const title = stringValue(item.title, item.name, item.label);
    const link = stringValue(item.link, item.url, item.href);
    if (!title || !link) return [];
    const post: Record<string, any> = {
      title,
      link,
      image: stringValue(item.image, item.poster, item.thumbnail, item.cover),
    };
    for (const key of ["provider", "tag", "cornerTag"] as const) {
      if (typeof item[key] === "string" && item[key].trim()) post[key] = item[key].trim();
    }
    if (typeof item.aspectRatio === "number" || typeof item.aspectRatio === "string") {
      post.aspectRatio = item.aspectRatio;
    }
    if (typeof item.borderRadius === "number") post.borderRadius = item.borderRadius;
    return [post];
  });
};

export const normalizeCatalogResult = (value: unknown): any[] => {
  const list = pickArray(value, ["catalog", "genres", "results", "items", "data"]);
  return list.flatMap((entry) => {
    const item = asObject(entry);
    if (!item) return [];
    const title = stringValue(item.title, item.name, item.label);
    const filter = stringValue(item.filter, item.value, item.link, item.url);
    if (!title) return [];
    return [{ title, filter }];
  });
};

export const normalizeEpisodeResult = (value: unknown): any[] => {
  const list = pickArray(value, ["episodes", "links", "results", "items", "data"]);
  return list.flatMap((entry) => {
    const item = asObject(entry);
    if (!item) return [];
    const link = stringValue(item.link, item.url, item.href);
    if (!link) return [];
    const episode: Record<string, any> = {
      title: stringValue(item.title, item.name, item.label) || "Episode",
      link,
    };
    for (const key of ["id", "sourceLink", "description", "image"] as const) {
      if (typeof item[key] === "string" && item[key]) episode[key] = item[key];
    }
    if (typeof item.quickDownload === "boolean") episode.quickDownload = item.quickDownload;
    if (Array.isArray(item.skip)) episode.skip = item.skip;
    return [episode];
  });
};

const normalizeDirectLinks = (value: unknown): any[] | undefined => {
  const list = pickArray(value, ["directLinks", "links", "results", "items", "data"]);
  const normalized = list.flatMap((entry) => {
    const item = asObject(entry);
    if (!item) return [];
    const link = stringValue(item.link, item.url, item.href);
    if (!link) return [];
    const direct: Record<string, any> = {
      title: stringValue(item.title, item.name, item.label) || "Play",
      link,
    };
    for (const key of ["type", "description", "image"] as const) {
      if (typeof item[key] === "string" && item[key]) direct[key] = item[key];
    }
    if (typeof item.quickDownload === "boolean") direct.quickDownload = item.quickDownload;
    if (Array.isArray(item.skip)) direct.skip = item.skip;
    return [direct];
  });
  return normalized.length ? normalized : undefined;
};

const normalizeLinkList = (value: unknown): any[] => {
  const list = pickArray(value, ["linkList", "links", "sources", "results", "items", "data"]);
  return list.flatMap((entry) => {
    const item = asObject(entry);
    if (!item) return [];
    const link: Record<string, any> = {
      title: stringValue(item.title, item.name, item.label) || "Source",
    };
    const quality = normalizeQuality(item.quality ?? item.resolution ?? item.title);
    if (quality) link.quality = quality;
    const episodesLink = stringValue(item.episodesLink, item.episodeLink, item.url, item.link);
    if (episodesLink) link.episodesLink = episodesLink;
    if (typeof item.quickDownload === "boolean") link.quickDownload = item.quickDownload;
    const directLinks = normalizeDirectLinks(item.directLinks ?? item.direct ?? item.streams);
    if (directLinks) link.directLinks = directLinks;
    return [link];
  });
};

export const normalizeInfoResult = (value: unknown): any => {
  const item = asObject(value) ?? {};
  const image = stringValue(item.image, item.poster, item.thumbnail, item.cover);
  const info: Record<string, any> = {
    title: stringValue(item.title, item.name) || "Untitled",
    image,
    synopsis: stringValue(item.synopsis, item.description, item.plot),
    type: stringValue(item.type, item.contentType, item.mediaType) || "movie",
    linkList: normalizeLinkList(item.linkList ?? item.links ?? item.sources),
  };
  const aliases: Array<[string, unknown]> = [
    ["poster", item.poster],
    ["logo", item.logo],
    ["description", item.description],
    ["year", item.year],
    ["runtime", item.runtime],
    ["imdbId", item.imdbId ?? item.imdb ?? item.imdb_id],
    ["tmdbId", item.tmdbId ?? item.tmdb ?? item.tmdb_id],
    ["webUrl", item.webUrl],
    ["trailerUrl", item.trailerUrl],
    ["rating", item.rating],
  ];
  for (const [key, raw] of aliases) {
    if (raw !== undefined && raw !== null && raw !== "") info[key] = raw;
  }
  for (const key of ["quickDownload", "populateMeta"] as const) {
    if (typeof item[key] === "boolean") info[key] = item[key];
  }
  const tags = cleanStringArray(item.tags ?? item.genres);
  if (tags) info.tags = tags;
  const cast = cleanStringArray(item.cast);
  if (cast) info.cast = cast;
  return info;
};
