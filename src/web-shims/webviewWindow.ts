type Handler = (event: any) => void;
type CloseHandler = () => void | Promise<void>;

export class WebviewWindow {
  private static readonly instances = new Map<string, WebviewWindow>();

  private child: Window | null = null;
  private readonly onceHandlers = new Map<string, Handler>();
  private readonly closePollers = new Set<number>();

  constructor(
    public label: string,
    options: { url?: string; [key: string]: unknown } = {},
  ) {
    WebviewWindow.instances.set(label, this);
    this.child = window.open(
      options.url || "about:blank",
      "_blank",
      "noopener,noreferrer",
    );
    queueMicrotask(() =>
      this.fire(
        this.child ? "tauri://created" : "tauri://error",
        { payload: this.child ? undefined : "Popup blocked" },
      ),
    );
  }

  static async getByLabel(label: string): Promise<WebviewWindow | null> {
    return WebviewWindow.instances.get(label) ?? null;
  }

  once(event: string, callback: Handler): Promise<() => void> {
    this.onceHandlers.set(event, callback);
    return Promise.resolve(() => this.onceHandlers.delete(event));
  }

  onCloseRequested(callback: CloseHandler): Promise<() => void> {
    const timer = window.setInterval(() => {
      if (this.child?.closed) {
        window.clearInterval(timer);
        this.closePollers.delete(timer);
        void callback();
      }
    }, 250);
    this.closePollers.add(timer);
    return Promise.resolve(() => {
      window.clearInterval(timer);
      this.closePollers.delete(timer);
    });
  }

  async destroy() {
    for (const timer of this.closePollers) window.clearInterval(timer);
    this.closePollers.clear();
    try {
      this.child?.close();
    } catch {}
    this.child = null;
    if (WebviewWindow.instances.get(this.label) === this) {
      WebviewWindow.instances.delete(this.label);
    }
  }

  private fire(event: string, payload: any) {
    const callback = this.onceHandlers.get(event);
    if (callback) callback(payload);
    this.onceHandlers.delete(event);
  }
}
