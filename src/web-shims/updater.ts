export type WebUpdateEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished"; data: Record<string, never> };

export interface WebUpdate {
  version: string;
  body?: string | null;
  downloadAndInstall(
    callback?: (event: WebUpdateEvent) => void,
  ): Promise<void>;
}

export async function check(_options?: unknown): Promise<WebUpdate | null> {
  return null;
}
