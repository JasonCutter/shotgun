import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback) => globalThis.setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = (handle) => globalThis.clearTimeout(handle);
}

afterEach(() => cleanup());
