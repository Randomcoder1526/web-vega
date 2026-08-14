export interface IStorageService {
  getString(key: string): string | undefined;
  setString(key: string, value: string): void;
  getBool(key: string, defaultValue?: boolean): boolean;
  setBool(key: string, value: boolean): void;
  getNumber(key: string): number | undefined;
  setNumber(key: string, value: number): void;
  getObject<T>(key: string): T | undefined;
  setObject<T>(key: string, value: T): void;
  getArray<T>(key: string): T[] | undefined;
  setArray<T>(key: string, value: T[]): void;
  delete(key: string): void;
  contains(key: string): boolean;
  clearAll(): void;
}

export class WebStorageService implements IStorageService {
  private prefix: string;

  constructor(instanceId?: string) {
    this.prefix = instanceId ? `vega_${instanceId}_` : 'vega_';
  }

  getString(key: string): string | undefined {
    try {
      return localStorage.getItem(this.prefix + key) ?? undefined;
    } catch {
      return undefined;
    }
  }

  setString(key: string, value: string): void {
    try {
      localStorage.setItem(this.prefix + key, value);
    } catch (e) {
      console.error('Storage write failed:', e);
    }
  }

  getBool(key: string, defaultValue?: boolean): boolean {
    try {
      const val = localStorage.getItem(this.prefix + key);
      if (val === null) return defaultValue ?? false;
      return val === 'true';
    } catch {
      return defaultValue ?? false;
    }
  }

  setBool(key: string, value: boolean): void {
    try {
      localStorage.setItem(this.prefix + key, String(value));
    } catch (e) {
      console.error('Storage write failed:', e);
    }
  }

  getNumber(key: string): number | undefined {
    const val = localStorage.getItem(this.prefix + key);
    if (val === null) return undefined;
    const num = Number(val);
    return isNaN(num) ? undefined : num;
  }

  setNumber(key: string, value: number): void {
    try {
      localStorage.setItem(this.prefix + key, String(value));
    } catch (e) {
      console.error('Storage write failed:', e);
    }
  }

  getObject<T>(key: string): T | undefined {
    const json = localStorage.getItem(this.prefix + key);
    if (!json) return undefined;
    try {
      return JSON.parse(json) as T;
    } catch {
      return undefined;
    }
  }

  setObject<T>(key: string, value: T): void {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (e) {
      console.error('Storage write failed:', e);
    }
  }

  getArray<T>(key: string): T[] | undefined {
    return this.getObject<T[]>(key);
  }

  setArray<T>(key: string, value: T[]): void {
    this.setObject(key, value);
  }

  delete(key: string): void {
    localStorage.removeItem(this.prefix + key);
  }

  contains(key: string): boolean {
    return localStorage.getItem(this.prefix + key) !== null;
  }

  clearAll(): void {
    const keys = Object.keys(localStorage);
    keys.forEach((k) => {
      if (k.startsWith(this.prefix)) {
        localStorage.removeItem(k);
      }
    });
  }
}

export const mainStorage: IStorageService = new WebStorageService();
export const cacheStorage: IStorageService = new WebStorageService('cache');
