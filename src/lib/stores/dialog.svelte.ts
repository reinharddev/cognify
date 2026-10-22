// Dialog konfirmasi dan isian buatan sendiri, pengganti confirm() dan prompt() bawaan webview.

interface Request {
  kind: "confirm" | "prompt";
  message: string;
  detail?: string;
  okLabel: string;
  cancelLabel: string;
  danger: boolean;
  value: string;
  resolve: (v: string | boolean | null) => void;
}

export interface DialogOptions {
  detail?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

class DialogStore {
  current = $state<Request | null>(null);

  confirm(message: string, opts: DialogOptions = {}): Promise<boolean> {
    return this.ask({ kind: "confirm", message, value: "", opts }) as Promise<boolean>;
  }

  prompt(message: string, initial = "", opts: DialogOptions = {}): Promise<string | null> {
    return this.ask({ kind: "prompt", message, value: initial, opts }) as Promise<string | null>;
  }

  private ask(r: { kind: Request["kind"]; message: string; value: string; opts: DialogOptions }) {
    this.current?.resolve(r.kind === "confirm" ? false : null);
    return new Promise<string | boolean | null>((resolve) => {
      this.current = {
        kind: r.kind,
        message: r.message,
        detail: r.opts.detail,
        okLabel: r.opts.okLabel ?? (r.opts.danger ? "Hapus" : "OK"),
        cancelLabel: r.opts.cancelLabel ?? "Batal",
        danger: !!r.opts.danger,
        value: r.value,
        resolve,
      };
    });
  }

  answer(ok: boolean) {
    const c = this.current;
    if (!c) return;
    this.current = null;
    c.resolve(c.kind === "confirm" ? ok : ok ? c.value : null);
  }
}

export const dialog = new DialogStore();
