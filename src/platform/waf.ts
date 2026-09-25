import {OpenWebViewOptions, OpenWebViewResult} from '../lib/providers/types';
import {useWafStore} from '../lib/zustand/wafStore';
import {headers as commonHeaders} from '../lib/providers/headers';
import {updateGlobalCookies, getGlobalCookies, clearGlobalCookies} from '../lib/providers/cookieStore';

const pickUserAgent = (
  h?: Record<string, string>,
): string | undefined => {
  if (!h) return undefined;
  const key = Object.keys(h).find(k => k.toLowerCase() === 'user-agent');
  return key ? h[key] : undefined;
};

const pendingRequests = new Map<
  string,
  Array<{resolve: (val: any) => void; reject: (err: any) => void}>
>();

export const openWebView = async (
  url: string,
  options?: OpenWebViewOptions,
): Promise<OpenWebViewResult> => {
  if (!url) {
    throw new Error('openWebView: a url is required');
  }

  // A normal website cannot inspect cookies or rendered HTML from another
  // origin after a Cloudflare/WAF challenge. Reusing cookies already captured
  // by Vega is safe, but pretending an empty browser-tab result succeeded makes
  // providers fail later with misleading parsing errors. Fail early instead.
  if (!(window as any).__TAURI_INTERNALS__) {
    const cookies = getGlobalCookies(url) || '';
    if (cookies && (!options?.waitForCookie || cookies.includes(options.waitForCookie))) {
      const cookieMap = cookies.split(';').reduce((acc, pair) => {
        const [name, ...rest] = pair.trim().split('=');
        if (name && rest.length) acc[name] = rest.join('=');
        return acc;
      }, {} as Record<string, string>);
      return {
        data: '',
        cookies,
        cookie: cookies,
        cookieMap,
        url,
        userAgent: pickUserAgent(options?.headers) || navigator.userAgent,
      };
    }

    const host = new URL(url).hostname;
    throw new Error(
      `WEB_WAF_UNSUPPORTED: ${host} requires browser verification that Vega Web cannot complete across origins. Use a provider/API that does not require native WebView cookies, or run this provider in the desktop app.`,
    );
  }

  const hostname = url.includes('://') ? url.split('/')[2] : url;
  const cacheKey = options?.waitForCookie ? `${hostname}:${options.waitForCookie}` : hostname;

  // Request Coalescing: If a WAF solver is already running for this URL,
  // just wait for its result instead of queuing another dialog!
  if (pendingRequests.has(cacheKey)) {
    console.log(`[WAF] Coalescing parallel request for: ${cacheKey}`);
    return new Promise((resolve, reject) => {
      pendingRequests.get(cacheKey)?.push({resolve, reject});
    });
  }

  // Handle force and fast path
  if (!options?.force && options?.waitForCookie) {
    const existingCookies = getGlobalCookies(url);
    if (existingCookies && existingCookies.includes(options.waitForCookie)) {
      // Fast path: we already have the awaited cookie, return it immediately
      const cookieMap = existingCookies.split(';').reduce((acc, curr) => {
        const [k, v] = curr.trim().split('=');
        if (k && v) acc[k] = v;
        return acc;
      }, {} as Record<string, string>);
      
      return {
        data: '',
        cookies: existingCookies,
        cookie: existingCookies,
        cookieMap,
        url,
        userAgent: pickUserAgent(options?.headers) || commonHeaders['User-Agent'],
      };
    }
  } else if (options?.waitForCookie) {
    // If it is forced, clear the bad cookies from the global store before opening
    clearGlobalCookies(url);
  }

  pendingRequests.set(cacheKey, []);

  // Use common headers if not provided
  if (!options) options = {};
  if (!options.headers) options.headers = {};
  if (!pickUserAgent(options.headers)) {
    options.headers['User-Agent'] = commonHeaders['User-Agent'];
  }

  return new Promise((resolve, reject) => {
    console.log('[WAF] Queuing new solver for:', url);

    const wrappedResolve = (result: OpenWebViewResult) => {
      if (result.cookies) {
        updateGlobalCookies(new URL(url).origin, result.cookies, result.expires);
      }
      
      resolve(result);
      const pending = pendingRequests.get(cacheKey) || [];
      pendingRequests.delete(cacheKey);
      pending.forEach(p => p.resolve(result));
    };

    const wrappedReject = (error: any) => {
      reject(error);
      const pending = pendingRequests.get(cacheKey) || [];
      pendingRequests.delete(cacheKey);
      pending.forEach(p => p.reject(error));
    };

    useWafStore.getState().enqueue({
      url,
      ...options,
      resolve: wrappedResolve,
      reject: wrappedReject,
    });
  });
};
