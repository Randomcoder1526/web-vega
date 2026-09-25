import {cacheStorageService} from '../storage';

// Keep this helper aligned with the current Zenda-Cross provider contract.
const URLS_ENDPOINT =
  'https://raw.githubusercontent.com/Zenda-Cross/vega-providers/refs/heads/main/urls.json';
const LEGACY_URLS_ENDPOINT =
  'https://himanshu8443.github.io/providers/modflix.json';
const expireTime = 60 * 60 * 1000;

const providerAliases: Record<string, string[]> = {
  vega: ['Vega'],
  hdhub4u: ['hdhub'],
  mod: ['Moviesmod'],
  uhd: ['UhdMovies'],
  world4u: ['w4u'],
  katmovies: ['kat'],
  luxmovies: ['lux'],
  topmovies: ['Topmovies'],
  kmmovies: ['kmmovies'],
  skymoviehd: ['skymovieshd'],
  joya9tv: ['joya9tv'],
};

const findProviderUrl = (data: any, providerValue: string): string => {
  if (!data || typeof data !== 'object') return '';
  const raw = String(providerValue || '').trim();
  if (!raw) return '';

  const candidates = [
    raw,
    ...(providerAliases[raw.toLowerCase()] || []),
  ];

  for (const candidate of candidates) {
    const direct = data[candidate]?.url;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
  }

  const lower = raw.toLowerCase();
  for (const [key, entry] of Object.entries<any>(data)) {
    if (
      key.toLowerCase() === lower ||
      String(entry?.name || '').toLowerCase() === lower
    ) {
      const url = entry?.url;
      if (typeof url === 'string' && url.trim()) return url.trim();
    }
  }
  return '';
};

const fetchUrlMap = async (endpoint: string): Promise<any> => {
  const response = await fetch(endpoint, {cache: 'no-store'});
  if (!response.ok) {
    throw new Error(`URL configuration request failed: ${response.status}`);
  }
  return response.json();
};

export const getBaseUrl = async (providerValue: string) => {
  const cacheKey = 'CacheBaseUrl' + providerValue;
  const timeKey = 'baseUrlTime' + providerValue;
  const cachedUrl = cacheStorageService.getString(cacheKey);
  const cachedTime = cacheStorageService.getObject<number>(timeKey);

  if (cachedUrl && cachedTime && Date.now() - cachedTime < expireTime) {
    return cachedUrl;
  }

  let lastError: unknown;
  for (const endpoint of [URLS_ENDPOINT, LEGACY_URLS_ENDPOINT]) {
    try {
      const data = await fetchUrlMap(endpoint);
      const baseUrl = findProviderUrl(data, providerValue);
      if (!baseUrl) continue;
      cacheStorageService.setString(cacheKey, baseUrl);
      cacheStorageService.setObject(timeKey, Date.now());
      return baseUrl;
    } catch (error) {
      lastError = error;
    }
  }

  if (cachedUrl) {
    console.warn(`Using stale baseUrl for ${providerValue}`, lastError);
    return cachedUrl;
  }

  console.error(`Error fetching baseUrl: ${providerValue}`, lastError);
  return '';
};
