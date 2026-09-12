export type Size = { width: number; height: number };
export type Position = { x: number; y: number };

export const ProgressBarStatus = {
  None: "none",
  Normal: "normal",
  Indeterminate: "indeterminate",
  Paused: "paused",
  Error: "error",
} as const;

export type ProgressBarStatus =
  (typeof ProgressBarStatus)[keyof typeof ProgressBarStatus];

export interface ProgressBarOptions {
  status?: ProgressBarStatus;
  progress?: number;
}

type ResizeCallback = (event?: Event) => void;

const currentWindow = {
  async minimize() {},
  async maximize() {},
  async unmaximize() {},
  async toggleMaximize() {},
  async close() {
    history.back();
  },
  async isMaximized() {
    return false;
  },
  async setFullscreen(value: boolean) {
    if (value && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    } else if (!value && document.fullscreenElement) {
      await document.exitFullscreen?.();
    }
  },
  async isFullscreen() {
    return !!document.fullscreenElement;
  },
  async setAlwaysOnTop(_value: boolean) {},
  async isAlwaysOnTop() {
    return false;
  },
  async setPosition(_position: Position) {},
  async setSize(_size: Size) {},
  async startDragging() {},
  async innerPosition(): Promise<Position> {
    return { x: screenX || 0, y: screenY || 0 };
  },
  async innerSize(): Promise<Size> {
    return { width: innerWidth, height: innerHeight };
  },
  async setProgressBar(_options: ProgressBarOptions) {},
  async setDecorations(_decorations: boolean) {},
  async onResized(callback: ResizeCallback): Promise<() => void> {
    const handler = (event: Event) => callback(event);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  },
  async outerPosition(): Promise<Position> {
    return { x: screenX || 0, y: screenY || 0 };
  },
  async outerSize(): Promise<Size> {
    return {
      width: outerWidth || innerWidth,
      height: outerHeight || innerHeight,
    };
  },
};

export function getCurrentWindow() {
  return currentWindow;
}

export async function currentMonitor() {
  return {
    position: { x: 0, y: 0 },
    size: { width: screen.availWidth, height: screen.availHeight },
    scaleFactor: window.devicePixelRatio || 1,
  };
}
