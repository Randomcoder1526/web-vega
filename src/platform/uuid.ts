/**
 * Generate a UUID v4 in both secure and insecure browser contexts.
 *
 * `crypto.randomUUID()` is restricted to secure contexts in browsers, so it
 * can be missing when Vega Web is opened over plain HTTP from a LAN address.
 * `crypto.getRandomValues()` is more widely available and is sufficient for
 * Vega's request tokens and local device identifiers.
 */
export const createUuid = (): string => {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    // Last-resort compatibility path for very old webviews. Vega only uses
    // these UUIDs as local/request identifiers, never as authentication keys.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};
