export const MAX_GLOBAL_IMAGE_REQUESTS = 2;

interface GlobalImageRequestGate {
  active: number;
  queue: Array<() => void>;
}

declare global {
  var __xobiImageRequestGate: GlobalImageRequestGate | undefined;
}

const globalImageRequestGate = globalThis.__xobiImageRequestGate ??
  (globalThis.__xobiImageRequestGate = { active: 0, queue: [] });

export function acquireGlobalImageRequestSlot(signal: AbortSignal) {
  return new Promise<() => void>((resolve, reject) => {
    let settled = false;
    let released = false;

    const grant = () => {
      if (settled) return;
      if (signal.aborted) {
        settled = true;
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      globalImageRequestGate.active += 1;
      resolve(() => {
        if (released) return;
        released = true;
        globalImageRequestGate.active = Math.max(0, globalImageRequestGate.active - 1);
        globalImageRequestGate.queue.shift()?.();
      });
    };

    const handleAbort = () => {
      if (settled) return;
      settled = true;
      const queueIndex = globalImageRequestGate.queue.indexOf(grant);
      if (queueIndex >= 0) globalImageRequestGate.queue.splice(queueIndex, 1);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };

    if (signal.aborted) {
      handleAbort();
    } else if (globalImageRequestGate.active < MAX_GLOBAL_IMAGE_REQUESTS) {
      grant();
    } else {
      signal.addEventListener('abort', handleAbort, { once: true });
      globalImageRequestGate.queue.push(grant);
    }
  });
}
