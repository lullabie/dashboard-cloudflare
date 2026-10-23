// storage-faults.mjs — TEST HARNESS ONLY.
// Fault hooks for Track D QA preparation. No shipped endpoint. No production import.
// These helpers model fault surfaces with explicit doubles; they are not browser evidence.

export class CountingBroadcastChannel {
  static instances = [];

  static resetCounts() {
    CountingBroadcastChannel.instances = [];
  }

  static activeCount() {
    return CountingBroadcastChannel.instances.filter((channel) => !channel.closed).length;
  }

  static constructionCount() {
    return CountingBroadcastChannel.instances.length;
  }

  static closeCount() {
    return CountingBroadcastChannel.instances.filter((channel) => channel.closed).length;
  }

  constructor(name) {
    this.name = name;
    this.closed = false;
    this.messages = [];
    this.onmessage = null;
    CountingBroadcastChannel.instances.push(this);
  }

  postMessage(message) {
    if (this.closed) throw new Error('BroadcastChannel is closed');
    this.messages.push(message);
    if (typeof this.onmessage === 'function') this.onmessage({ data: message });
  }

  close() {
    this.closed = true;
  }
}

export class FailingBroadcastChannel {
  constructor() {
    const error = new Error('Injected BroadcastChannel construction failure');
    error.name = 'BroadcastChannelConstructionError';
    throw error;
  }
}

// Replace globalThis.BroadcastChannel with a failing constructor for selected constructions.
// Options:
// - failOn: Set<number> of 1-based construction attempts to fail.
// - failFirst: boolean, fail construction attempt 1.
// Returns { restore, attempts }.
export function installBroadcastChannelFault(options = {}) {
  const original = globalThis.BroadcastChannel;
  const failOn = new Set(options.failOn ?? (options.failFirst === false ? [] : [1]));
  let attempts = 0;

  class FaultyBroadcastChannel extends CountingBroadcastChannel {
    constructor(name) {
      attempts += 1;
      if (failOn.has(attempts)) {
        const error = new Error(`Injected BroadcastChannel construction failure on attempt ${attempts}`);
        error.name = 'BroadcastChannelConstructionError';
        throw error;
      }
      super(name);
    }
  }

  globalThis.BroadcastChannel = FaultyBroadcastChannel;

  return {
    attempts: () => attempts,
    restore() {
      if (original === undefined) delete globalThis.BroadcastChannel;
      else globalThis.BroadcastChannel = original;
    },
  };
}

// Explicit readiness gate model for harness checks.
// Production store behavior remains a Phase 2 target; this gate only gives the
// spec a deterministic shape for degraded / ready transitions.
export function createReadinessGate() {
  let state = { status: 'not-initialized', error: null };
  const writes = [];

  return {
    getState: () => ({ ...state }),
    markReady() {
      state = { status: 'ready', error: null };
    },
    markDegraded(error) {
      state = { status: 'degraded', error: error instanceof Error ? error.message : String(error) };
    },
    assertWriteAllowed() {
      if (state.status !== 'ready') {
        const error = new Error(`Write blocked while store status is ${state.status}`);
        error.name = 'StoreNotReadyError';
        error.status = state.status;
        throw error;
      }
    },
    saveForHarness(record) {
      this.assertWriteAllowed();
      writes.push(structuredClone(record));
      return { committed: true, conflict: false, writeCount: writes.length };
    },
    writes: () => structuredClone(writes),
  };
}

// Wrap a notifier so it fails after the caller has already committed.
// The returned function models the required settlement shape: the commit result
// stays committed and the notification error is reported separately.
export function makePostCommitNotificationFailure(notifier = () => {}) {
  return async function notifyAfterCommit(commitResult) {
    let notificationError = null;
    try {
      await notifier(commitResult);
      // Force the harness fault after a successful notifier call as well; the
      // point is the post-commit notification surface, not the notifier itself.
      throw new Error('Injected post-commit notification failure');
    } catch (error) {
      notificationError = error;
    }
    return {
      ...commitResult,
      committed: true,
      notificationError: notificationError.message,
      retryInduced: false,
    };
  };
}

// Minimal IndexedDB request double. It records handlers and lets a test fire
// success, abort or denial explicitly. It does not emulate transaction ordering.
export function createFakeIDBRequest() {
  return {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    onabort: null,
    succeed(result) {
      this.result = result;
      if (typeof this.onsuccess === 'function') this.onsuccess({ target: this });
    },
    fail(error) {
      this.error = error;
      if (typeof this.onerror === 'function') this.onerror({ target: this });
    },
    abort() {
      const error = new Error('Injected IndexedDB transaction abort');
      error.name = 'AbortError';
      this.error = error;
      if (typeof this.onabort === 'function') this.onabort({ target: this });
      if (typeof this.onerror === 'function') this.onerror({ target: this });
    },
  };
}

export function simulateIDBAbort(request = createFakeIDBRequest()) {
  request.abort();
  return request;
}

export function simulateIDBDenial(request = createFakeIDBRequest()) {
  const error = new Error('Injected IndexedDB access denial');
  error.name = 'SecurityError';
  request.fail(error);
  return request;
}

export function simulateIDBQuotaExceeded(request = createFakeIDBRequest()) {
  const error = new Error('Injected IndexedDB quota failure');
  error.name = 'QuotaExceededError';
  request.fail(error);
  return request;
}
