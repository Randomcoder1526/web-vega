export const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
