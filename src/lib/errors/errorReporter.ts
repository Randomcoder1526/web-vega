export interface KnownConsoleFailure {
  category: string;
  userMessage: string;
  status?: number;
}

export interface ConsoleIssue {
  scope: string;
  category?: string;
  message: string;
  status?: number;
  details?: Record<string, unknown>;
  dedupeKey?: string;
}

interface GlobalErrorHandlerOptions {
  classifyKnownError?: (error: unknown) => KnownConsoleFailure | null | undefined;
  notifyUnexpected?: (issue: ConsoleIssue) => void;
  dedupeWindowMs?: number;
}

const DEFAULT_DEDUPE_WINDOW_MS = 8_000;
const MAX_RECENT_ISSUES = 200;
interface RecentIssueEntry {
  timestamp: number;
  expiresAt: number;
}

const recentIssues = new Map<string, RecentIssueEntry>();

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    const nested = candidate.message ?? candidate.error ?? candidate.reason;
    if (typeof nested === "string") return nested;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error ?? "Unknown error");
  }
};

export const sanitizeDiagnosticMessage = (message: string): string =>
  String(message || "Unknown error")
    .replace(
      /([?&](?:api[_-]?key|token|access[_-]?token|auth|authorization|signature|sig|secret|password)=)[^&#\s]+/gi,
      "$1<redacted>",
    )
    .slice(0, 1_500);

const normalizeFingerprintMessage = (message: string): string =>
  sanitizeDiagnosticMessage(message)
    .replace(/\b[0-9a-f]{8,}\b/gi, "<id>")
    .replace(/\s+/g, " ")
    .trim();

const makeFingerprint = (issue: ConsoleIssue): string =>
  issue.dedupeKey
    ? [issue.scope, issue.category || "unknown", issue.status || "", issue.dedupeKey].join("|")
    : [
    issue.scope,
    issue.category || "unknown",
    issue.status || "",
    normalizeFingerprintMessage(issue.message),
  ].join("|");

const pruneRecentIssues = (now: number) => {
  for (const [key, entry] of recentIssues) {
    if (entry.expiresAt <= now) recentIssues.delete(key);
  }
  while (recentIssues.size > MAX_RECENT_ISSUES) {
    const oldest = recentIssues.keys().next().value;
    if (!oldest) break;
    recentIssues.delete(oldest);
  }
};

export const shouldEmitIssue = (
  issue: ConsoleIssue,
  now = Date.now(),
  dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
): boolean => {
  pruneRecentIssues(now);
  const fingerprint = makeFingerprint(issue);
  const previous = recentIssues.get(fingerprint);
  if (previous && previous.expiresAt > now) return false;
  recentIssues.set(fingerprint, {
    timestamp: now,
    expiresAt: now + Math.max(1, dedupeWindowMs),
  });
  return true;
};

export const reportHandledIssue = ({
  scope,
  category,
  userMessage,
  error,
  status,
  details,
  dedupeKey,
  dedupeWindowMs,
}: {
  scope: string;
  category: string;
  userMessage: string;
  error?: unknown;
  status?: number;
  details?: Record<string, unknown>;
  dedupeKey?: string;
  dedupeWindowMs?: number;
}): boolean => {
  // Cancelled work is expected during route/source changes and does not need
  // a console entry at all.
  if (category === "aborted") return false;

  const issue: ConsoleIssue = {
    scope,
    category,
    status,
    message: extractErrorMessage(error) || userMessage,
    details,
    dedupeKey,
  };
  if (!shouldEmitIssue(issue, Date.now(), dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS)) return false;

  const compactDetails = {
    ...(status ? { status } : {}),
    message: sanitizeDiagnosticMessage(issue.message),
    ...details,
  };
  console.warn(`[vega:${scope}:${category}] ${userMessage}`, compactDetails);
  return true;
};

export const reportUnexpectedIssue = (
  scope: string,
  error: unknown,
  options: {
    details?: Record<string, unknown>;
    notify?: (issue: ConsoleIssue) => void;
  } = {},
): boolean => {
  const issue: ConsoleIssue = {
    scope,
    category: "unexpected",
    message: extractErrorMessage(error),
    details: options.details,
  };
  if (!shouldEmitIssue(issue)) return false;

  console.error(`[vega:${scope}:unexpected] ${sanitizeDiagnosticMessage(issue.message)}`, {
    ...options.details,
    error,
  });
  options.notify?.(issue);
  return true;
};

export const installGlobalErrorHandlers = (
  options: GlobalErrorHandlerOptions = {},
): (() => void) => {
  if (typeof window === "undefined") return () => {};

  const classifyKnownError = options.classifyKnownError;
  const notifyUnexpected = options.notifyUnexpected;

  const onWindowError = (event: ErrorEvent) => {
    reportUnexpectedIssue("window", event.error || event.message, {
      details: {
        filename: event.filename || undefined,
        line: event.lineno || undefined,
        column: event.colno || undefined,
      },
      notify: notifyUnexpected,
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const failure = classifyKnownError?.(event.reason);
    if (failure && failure.category !== "unknown") {
      reportHandledIssue({
        scope: "promise",
        category: failure.category,
        userMessage: failure.userMessage,
        error: event.reason,
        status: failure.status,
      });
      // The failure has been classified and recorded. Prevent the browser from
      // printing the same rejection and full stack a second time.
      event.preventDefault();
      return;
    }

    reportUnexpectedIssue("promise", event.reason, {
      notify: notifyUnexpected,
    });
  };

  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
};
