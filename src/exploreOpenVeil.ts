export class ExploreOpenVeilController {
  private requestId: string | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  get currentRequestId() {
    return this.requestId;
  }

  begin(requestId: string, timeoutMs: number, onTimeout: (requestId: string) => void) {
    if (this.timeout) clearTimeout(this.timeout);
    this.requestId = requestId;
    this.timeout = setTimeout(() => {
      if (!this.finish(requestId)) return;
      onTimeout(requestId);
    }, timeoutMs);
  }

  finish(requestId: string) {
    if (this.requestId !== requestId) return false;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.requestId = null;
    return true;
  }

  dispose() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.requestId = null;
  }
}

export function createExploreOpenRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `kiosk-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
