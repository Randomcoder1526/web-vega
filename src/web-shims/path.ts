export async function documentDir() { return "Browser Downloads"; }
export async function downloadDir() { return "Browser Downloads"; }
export async function homeDir() { return "Browser"; }
export async function join(...parts: string[]) { return parts.filter(Boolean).join("/").replace(/\\/g, "/").replace(/\/{2,}/g, "/"); }
export async function basename(path: string) { return path.replace(/\\/g, "/").split("/").pop() || path; }
