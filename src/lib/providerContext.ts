import Axios from 'axios';
import * as cheerio from 'cheerio';

const getBaseUrlFromRemote = async (providerValue: string): Promise<string> => {
  try {
    const url = 'https://himanshu8443.github.io/providers/modflix.json';
    const response = await Axios.get(`/vega-proxy?url=${encodeURIComponent(url)}`, { timeout: 10000 });
    const data = response.data;
    if (data && data[providerValue] && data[providerValue].url) {
      return data[providerValue].url;
    }
    return '';
  } catch (error) {
    console.error(`Error fetching baseUrl for ${providerValue}:`, error);
    return '';
  }
};

const baseUrlCache = new Map<string, { url: string; time: number }>();
const BASE_URL_EXPIRY = 60 * 60 * 1000;

const getBaseUrl = async (providerValue: string): Promise<string> => {
  const cached = baseUrlCache.get(providerValue);
  if (cached && Date.now() - cached.time < BASE_URL_EXPIRY) {
    return cached.url;
  }
  const url = await getBaseUrlFromRemote(providerValue);
  if (url) {
    baseUrlCache.set(providerValue, { url, time: Date.now() });
  }
  return url;
};

const commonHeaders: Record<string, string> = {
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: '*/*',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

const FORBIDDEN_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'feature-policy',
  'host',
  'keep-alive',
  'origin',
  'permissions-policy',
  'proxy-accept',
  'proxy-connection',
  'public-key-pins',
  'referer',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
  'x-requested-with',
]);

function createSafeAxios() {
  const instance = Axios.create();
  const BYPASS_DOMAINS: string[] = [];

  instance.interceptors.request.use((config) => {
    const originalUrl = config.url;
    if (originalUrl && /^https?:\/\//.test(originalUrl)) {
      try {
        const parsed = new URL(originalUrl);
        if (!BYPASS_DOMAINS.includes(parsed.hostname)) {
          config.url = `/vega-proxy?url=${encodeURIComponent(originalUrl)}`;
        }
      } catch { /* keep original url */ }
    }
    if (config.headers) {
      for (const key of Object.keys(config.headers)) {
        if (FORBIDDEN_HEADERS.has(key.toLowerCase())) {
          delete config.headers[key];
        }
      }
    }
    return config;
  });

  return instance;
}

const safeAxios = createSafeAxios();

const cryptoDigest = async (data: string, algorithm: string): Promise<string> => {
  const algoMap: Record<string, string> = {
    'MD5': 'SHA-256',
    'SHA-1': 'SHA-1',
    'SHA-256': 'SHA-256',
    'SHA-384': 'SHA-384',
    'SHA-512': 'SHA-512',
  };
  const algo = algoMap[algorithm] || algorithm;
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest(algo, dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

const Crypto = {
  digest: cryptoDigest,
  digestStringAsync: async (algorithm: string, data: string): Promise<string> => {
    return cryptoDigest(data, algorithm);
  },
  randomUUID: () => crypto.randomUUID(),
};

const openWebView = async (url: string, _options?: any) => {
  try {
    const response = await safeAxios.get(url, { timeout: 30000 });
    return {
      data: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
      cookies: '',
      cookieMap: {} as Record<string, string>,
      userAgent: navigator.userAgent,
      url,
    };
  } catch {
    return {
      data: '',
      cookies: '',
      cookieMap: {} as Record<string, string>,
      userAgent: navigator.userAgent,
      url,
    };
  }
};

export const providerContext = {
  axios: safeAxios,
  cheerio,
  Crypto,
  getBaseUrl,
  commonHeaders,
  openWebView,
};
