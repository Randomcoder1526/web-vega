import { listenRuntimeEvent } from "./runtime";
export async function listen<T = any>(event: string, handler: (event: { payload: T }) => void) { return listenRuntimeEvent(event, handler as any); }
export async function emit() {}
