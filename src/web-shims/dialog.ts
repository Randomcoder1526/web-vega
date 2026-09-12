interface DialogOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
  [key: string]: unknown;
}

export async function ask(
  text: string,
  _options?: DialogOptions,
): Promise<boolean> {
  return confirm(text);
}

export async function message(
  text: string,
  _options?: DialogOptions,
): Promise<void> {
  alert(text);
}

export async function open(options: any = {}): Promise<string | string[] | null> {
  if (options.directory) {
    alert(
      "Vega Web uses your browser's normal Downloads location because websites cannot access arbitrary folder paths.",
    );
    return "browser-downloads";
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = !!options.multiple;
    const exts = options.filters?.flatMap((f: any) => f.extensions || []) || [];
    if (exts.length) {
      input.accept = exts.map((extension: string) => `.${extension}`).join(",");
    }
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = () => {
      const urls = Array.from(input.files || []).map((file) =>
        URL.createObjectURL(file),
      );
      input.remove();
      resolve(options.multiple ? urls : urls[0] || null);
    };
    input.oncancel = () => {
      input.remove();
      resolve(null);
    };
    input.click();
  });
}

export async function save(_options?: unknown): Promise<string | null> {
  return null;
}
