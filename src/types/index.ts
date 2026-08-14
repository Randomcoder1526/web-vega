export interface Post {
  title: string;
  link: string;
  image: string;
  provider?: string;
  rating?: string;
  year?: string;
}

export interface Stream {
  server: string;
  link: string;
  type: string;
  quality?: string;
  subtitles?: TextTracks;
  headers?: Record<string, string>;
}

export type TextTracks = {
  title: string;
  language: string;
  type: string;
  uri: string;
}[];

export interface Info {
  title: string;
  image: string;
  synopsis: string;
  imdbId: string;
  type: string;
  tags?: string[];
  cast?: string[];
  rating?: string;
  linkList: Link[];
  name?: string;
  description?: string;
  background?: string;
  poster?: string;
  logo?: string;
  imdbRating?: string;
  year?: string;
  runtime?: string;
  genres?: string[];
  director?: string;
  trailers?: { source: string; name?: string }[];
}

export interface EpisodeLink {
  title: string;
  link: string;
}

export interface Link {
  title: string;
  quality?: string;
  episodesLink?: string;
  directLinks?: {
    title: string;
    link: string;
    type?: 'movie' | 'series';
  }[];
}

export interface Catalog {
  title: string;
  filter: string;
}

export interface HomePageData {
  title: string;
  Posts: Post[];
  filter: string;
  error?: string;
}

export interface ProviderExtension {
  value: string;
  display_name: string;
  source: { author: string; url: string };
  version: string;
  icon: string;
  disabled: boolean;
  type: 'global' | 'english' | 'india' | 'italy' | 'anime' | 'drama';
  installed: boolean;
  installedAt?: number;
  lastUpdated?: number;
}

export interface ProviderModule {
  value: string;
  sourceAuthor?: string;
  version: string;
  modules: {
    posts?: string;
    meta?: string;
    stream?: string;
    catalog?: string;
    episodes?: string;
  };
  cachedAt: number;
}

export interface ProviderSource {
  author: string;
  url: string;
  isDefault?: boolean;
}

export interface WatchListItem {
  title: string;
  poster: string;
  link: string;
  provider: string;
}

export interface WatchHistoryItem {
  id: string;
  title: string;
  poster?: string;
  provider?: string;
  link: string;
  infoLink?: string;
  timestamp?: number;
  duration?: number;
  progress?: number;
  isSeries?: boolean;
  lastPlayed?: number;
  currentTime?: number;
  playbackRate?: number;
  episodeTitle?: string;
  seasonIndex?: number;
  episodeIndex?: number;
  cachedInfoData?: any;
}
