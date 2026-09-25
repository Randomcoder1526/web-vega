import axios, { AxiosHeaders, type AxiosAdapter } from "axios";
import * as cheerio from "cheerio";
import { Crypto } from "../../platform/crypto";
import { headers as commonHeaders } from "../providers/headers";
import { getErrorMessage } from "./providerErrors";

type RpcOperation =
  | "fetch"
  | "getBaseUrl"
  | "openWebView"
  | "kvGet"
  | "kvSet"
  | "kvDelete"
  | "kvKeys"
  | "kvClear";

type HostMessage =
  | {
      type: "invoke";
      token: string;
      moduleCode: string;
      exportName?: string;
      args?: Record<string, unknown>;
      state: Record<string, unknown>;
    }
  | {
      type: "rpc-result";
      token: string;
      id: number;
      result?: unknown;
      error?: string;
    };

type SerializedResponse = {
  status: number;
  statusText: string;
  url: string;
  headers: Array<[string, string]>;
  data: ArrayBuffer;
};

const workerScope = globalThis as typeof globalThis & {
  postMessage: (message: unknown) => void;
};
const sendMessage = workerScope.postMessage.bind(workerScope);
const addMessageListener = workerScope.addEventListener.bind(workerScope);
let activeToken = "";
let nextRpcId = 0;
const pendingRpc = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();

const disableAmbientCapability = (name: string) => {
  try {
    Object.defineProperty(workerScope, name, {
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
  } catch {
    // Some WebView globals are non-configurable; function parameters below still shadow them.
  }
};

[
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "postMessage",
  "importScripts",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "indexedDB",
  "caches",
].forEach(disableAmbientCapability);

const rpc = <T>(operation: RpcOperation, args: unknown): Promise<T> => {
  const id = ++nextRpcId;
  return new Promise<T>((resolve, reject) => {
    pendingRpc.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    sendMessage({ type: "rpc", token: activeToken, id, operation, args });
  });
};

const serializeBody = async (body: BodyInit | null | undefined) => {
  if (body == null) {
    return { data: undefined, contentType: null };
  }
  const serialized = new Response(body);
  return {
    data: await serialized.arrayBuffer(),
    contentType: serialized.headers.get("content-type"),
  };
};

const sandboxFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> => {
  const request = input instanceof Request ? input : undefined;
  const url = request?.url ?? input.toString();
  const headers = new Headers(request?.headers);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const serializedBody = await serializeBody(init.body);
  if (serializedBody.contentType && !headers.has("content-type")) {
    headers.set("Content-Type", serializedBody.contentType);
  }

  const response = await rpc<SerializedResponse>("fetch", {
    url,
    init: {
      method: init.method ?? request?.method,
      headers: Array.from(headers.entries()),
      body: serializedBody.data,
      redirect: init.redirect,
    },
  });

  const webResponse = new Response(response.data, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  // The Response constructor does not let callers set the final URL. Providers
  // frequently inspect response.url after redirects, so mirror the host result.
  Object.defineProperty(webResponse, "url", {
    configurable: true,
    value: response.url || url,
  });
  Object.defineProperty(webResponse, "redirected", {
    configurable: true,
    value: Boolean(response.url && response.url !== url),
  });
  return webResponse;
};

const serializeAxiosParams = (params: unknown, serializer: unknown): string => {
  if (!params) return "";
  const custom = serializer as any;
  if (typeof custom === "function") return String(custom(params) ?? "");
  if (custom && typeof custom.serialize === "function") {
    return String(custom.serialize(params) ?? "");
  }
  if (params instanceof URLSearchParams) return params.toString();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => query.append(key, String(entry)));
    } else {
      query.append(key, String(value));
    }
  }
  return query.toString();
};

const prepareAxiosBody = (data: unknown, headers: Headers): BodyInit | null | undefined => {
  if (data == null || typeof data === "string") return data as string | null | undefined;
  if (data instanceof URLSearchParams) {
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    }
    return data;
  }
  if (typeof FormData !== "undefined" && data instanceof FormData) return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return JSON.stringify(data);
};

const sandboxAxiosAdapter: AxiosAdapter = async (config) => {
  let url = config.url ?? "";
  if (config.baseURL && !/^https?:/i.test(url)) {
    url = `${config.baseURL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
  }
  const query = serializeAxiosParams(config.params, (config as any).paramsSerializer);
  if (query) url += `${url.includes("?") ? "&" : "?"}${query}`;

  const requestHeaders = new Headers(config.headers as HeadersInit);
  const body = prepareAxiosBody(config.data, requestHeaders);
  const requestPromise = sandboxFetch(url, {
    method: config.method?.toUpperCase(),
    headers: requestHeaders,
    body,
    redirect: config.maxRedirects === 0 ? "manual" : "follow",
  });
  const response =
    typeof config.timeout === "number" && config.timeout > 0
      ? await Promise.race([
          requestPromise,
          new Promise<Response>((_, reject) =>
            setTimeout(() => reject(new Error(`timeout of ${config.timeout}ms exceeded`)), config.timeout),
          ),
        ])
      : await requestPromise;
  const responseHeaders = new AxiosHeaders();
  response.headers.forEach((value, key) => responseHeaders.set(key, value));

  let data: unknown;
  if (config.responseType === "arraybuffer" || config.responseType === "stream") {
    data = await response.arrayBuffer();
  } else if (config.responseType === "blob") {
    data = await response.blob();
  } else {
    const text = await response.text();
    if (config.responseType === "text") {
      data = text;
    } else {
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = text;
      }
    }
  }

  const finalUrl = response.url || url;
  const requestInfo = {
    url: finalUrl,
    responseURL: finalUrl,
    res: { responseUrl: finalUrl },
  };
  const result = {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    config,
    request: requestInfo,
  };

  const validateStatus =
    config.validateStatus ||
    ((status: number) => status >= 200 && status < 300);

  if (!validateStatus(response.status)) {
    const error: any = new Error(
      "Request failed with status code " + response.status,
    );
    error.config = config;
    error.request = requestInfo;
    error.response = result;
    error.isAxiosError = true;
    error.status = response.status;
    throw error;
  }

  return result;
};

axios.defaults.adapter = sandboxAxiosAdapter;

let providerGlobal: Record<string, unknown> = {};
const kvStore = Object.freeze({
  get: <T = unknown>(key: string): Promise<T | undefined> =>
    rpc<T | undefined>("kvGet", { key }),
  set: (key: string, value: unknown): Promise<void> =>
    rpc<void>("kvSet", { key, value }),
  delete: (key: string): Promise<boolean> =>
    rpc<boolean>("kvDelete", { key }),
  keys: (): Promise<string[]> =>
    rpc<string[]>("kvKeys", {}),
  clear: (): Promise<void> =>
    rpc<void>("kvClear", {}),
});

const providerContext = Object.freeze({
  axios,
  cheerio,
  Crypto: Object.freeze(Crypto),
  commonHeaders: { ...commonHeaders },
  getBaseUrl: (providerValue: string) =>
    rpc<string>("getBaseUrl", { providerValue }),
  openWebView: (url: string, options?: unknown) =>
    rpc("openWebView", { url, options }),
  kvStore,
});

const createAwaiter = () =>
  function __awaiter(
    thisArg: unknown,
    args: unknown,
    PromiseConstructor: PromiseConstructor | undefined,
    generator: (...generatorArgs: unknown[]) => Generator,
  ) {
    const Constructor = PromiseConstructor ?? Promise;
    const adopt = (value: unknown) =>
      value instanceof Constructor
        ? value
        : new Constructor((resolve) => resolve(value));
    return new Constructor((resolve, reject) => {
      const fulfilled = (value: unknown) => {
        try {
          step(iterator.next(value));
        } catch (error) {
          reject(error);
        }
      };
      const rejected = (value: unknown) => {
        try {
          step(iterator.throw(value));
        } catch (error) {
          reject(error);
        }
      };
      const step = (result: IteratorResult<unknown>) => {
        if (result.done) resolve(result.value);
        else adopt(result.value).then(fulfilled, rejected);
      };
      const iterator = generator.apply(thisArg, (args as unknown[]) ?? []);
      step(iterator.next());
    });
  };

const PROVIDER_EXPORT_ALIASES: Record<string, string[]> = {
  getStream: ["getStream", "GetStream"],
  getPosts: ["getPosts", "GetHomePosts"],
  getSearchPosts: ["getSearchPosts", "GetSearchPosts"],
  getMeta: ["getMeta", "getMetaData", "GetMetaData"],
  getEpisodes: ["getEpisodes", "getEpisodeLinks", "GetEpisodeLinks"],
  getSettingsSchema: ["getSettingsSchema", "GetSettingsSchema"],
  catalog: ["catalog", "Catalog"],
  genres: ["genres", "Genres"],
};

const resolveProviderExport = (
  moduleExports: Record<string, unknown>,
  exportName: string,
): unknown => {
  const candidates = PROVIDER_EXPORT_ALIASES[exportName] ?? [exportName];
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(moduleExports, candidate)) {
      return moduleExports[candidate];
    }
  }
  return undefined;
};

const executeProvider = async (
  moduleCode: string,
  exportName?: string,
  args: Record<string, unknown> = {},
) => {
  const exports: Record<string, unknown> = {};
  const module = { exports };
  const executeModule = new Function(
    "exports",
    "module",
    "require",
    "console",
    "Promise",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "fetch",
    "__awaiter",
    "providerGlobal",
    "globalThis",
    "self",
    "postMessage",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "Worker",
    "SharedWorker",
    "BroadcastChannel",
    "indexedDB",
    "caches",
    `"use strict";\n${moduleCode}`,
  );

  executeModule(
    exports,
    module,
    () => ({}),
    console,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    sandboxFetch,
    createAwaiter(),
    providerGlobal,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  const moduleExports = module.exports as Record<string, unknown>;
  if (!exportName) return moduleExports;
  const providerExport = resolveProviderExport(moduleExports, exportName);
  if (typeof providerExport === "function") {
    return providerExport({
      ...args,
      signal: new AbortController().signal,
      providerContext,
    });
  }
  if (providerExport !== undefined) return providerExport;
  // Search is optional for some providers; an empty list is more useful than
  // making the whole provider unusable.
  if (exportName === "getSearchPosts") return [];
  throw new Error(`Provider module does not export ${exportName}`);
};

addMessageListener("message", async (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "rpc-result") {
    if (message.token !== activeToken) return;
    const pending = pendingRpc.get(message.id);
    if (!pending) return;
    pendingRpc.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result);
    return;
  }

  if (message.type !== "invoke" || activeToken) return;
  activeToken = message.token;
  providerGlobal = message.state;
  try {
    const result = await executeProvider(
      message.moduleCode,
      message.exportName,
      message.args,
    );
    sendMessage({
      type: "result",
      token: activeToken,
      result,
      state: providerGlobal,
    });
  } catch (error) {
    sendMessage({
      type: "result",
      token: activeToken,
      error: getErrorMessage(error),
    });
  }
});
