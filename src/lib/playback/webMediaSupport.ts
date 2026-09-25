/** A conservative capability probe. A supported container does NOT guarantee that
 * every codec inside it plays; runtime decoding failures still trigger failover.
 * Keeping this separate from stream ranking also allows us to explain exclusions.
 */
export interface BrowserMediaCapabilities {
  canPlayType: (mime: string) => string;
  mediaSource: boolean;
  nativeHls: boolean;
}
export interface WebPlayableStream { type?: string; link?: string; codec?: string; codecs?: string; }

export const describeWebStream = (
  source: WebPlayableStream,
  capabilities: BrowserMediaCapabilities,
): { playable: boolean; reason: string } => {
  const url = String(source.link || "").toLowerCase().split("?")[0];
  const type = String(source.type || "").toLowerCase();
  if (type === "torrent" || url.startsWith("magnet:")) return {
    playable: false, reason: "Torrent streams need the native desktop player.",
  };
  const codec = String(source.codecs || source.codec || "").trim();
  if (type === "m3u8" || type === "hls" || url.endsWith(".m3u8")) return {
    playable: capabilities.nativeHls || capabilities.mediaSource,
    reason: "HLS requires native browser HLS or Media Source Extensions.",
  };
  if (type === "mpd" || type === "dash" || url.endsWith(".mpd")) return {
    playable: capabilities.mediaSource,
    reason: "DASH requires Media Source Extensions.",
  };
  if (type === "mkv" || url.endsWith(".mkv")) return {
    playable: Boolean(capabilities.canPlayType("video/x-matroska")),
    reason: "This browser does not advertise Matroska container support.",
  };
  if (type === "webm" || url.endsWith(".webm")) return {
    playable: Boolean(capabilities.canPlayType(codec ? `video/webm; codecs="${codec}"` : "video/webm")),
    reason: "This browser does not advertise support for this WebM codec/container.",
  };
  if (type === "mp4" || url.endsWith(".mp4") || type === "m4v") return {
    playable: Boolean(capabilities.canPlayType(codec ? `video/mp4; codecs="${codec}"` : "video/mp4")),
    reason: "This browser does not advertise support for this MP4 codec/container.",
  };
  if (type === "mov" || url.endsWith(".mov")) return {
    playable: Boolean(capabilities.canPlayType("video/quicktime")),
    reason: "This browser does not advertise QuickTime container support.",
  };
  // Unknown direct HTTP sources must be tried, not incorrectly rejected.
  return { playable: /^https?:\/\//i.test(source.link || ""), reason: "Unrecognized media source." };
};

export const detectBrowserMediaCapabilities = (): BrowserMediaCapabilities => {
  if (typeof document === "undefined") return {
    canPlayType: () => "", mediaSource: false, nativeHls: false,
  };
  const probe = document.createElement("video");
  return {
    canPlayType: (mime) => probe.canPlayType(mime),
    mediaSource: typeof MediaSource !== "undefined" &&
      typeof MediaSource.isTypeSupported === "function" &&
      (MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"') ||
       MediaSource.isTypeSupported('video/webm; codecs="vp8"')),
    nativeHls: Boolean(probe.canPlayType("application/vnd.apple.mpegurl")),
  };
};

export const filterBrowserPlayableStreams = <T extends WebPlayableStream>(
  streams: T[],
  capabilities: BrowserMediaCapabilities,
): { playable: T[]; rejected: { server?: string; reason: string }[] } => {
  const playable: T[] = [];
  const rejected: { server?: string; reason: string }[] = [];
  for (const stream of streams) {
    const decision = describeWebStream(stream, capabilities);
    if (decision.playable) playable.push(stream);
    else rejected.push({ reason: decision.reason });
  }
  return { playable, rejected };
};
