import { describe, it, expect } from 'vitest';
import { shouldEnableUpdates } from './updateGate';

describe('shouldEnableUpdates', () => {
  it('packaged production build → enabled', () => {
    expect(shouldEnableUpdates({ packaged: true, name: 'MindMap' })).toBe(true);
  });

  // The exact v0.7.5–0.7.7 regression: productName missing → getName()='mind-map'.
  // Production must STILL update (fail-open), not silently disable.
  it('packaged but name regressed to "mind-map" → still enabled (fail-open)', () => {
    expect(shouldEnableUpdates({ packaged: true, name: 'mind-map' })).toBe(true);
  });

  it('the "MindMap Dev" test build → disabled', () => {
    expect(shouldEnableUpdates({ packaged: true, name: 'MindMap Dev' })).toBe(false);
  });

  it('unpackaged (`npm run dev`) → disabled', () => {
    expect(shouldEnableUpdates({ packaged: false, name: 'mind-map' })).toBe(false);
  });

  it('feed override (E2E hook) → enabled regardless of packaging/name', () => {
    expect(shouldEnableUpdates({ packaged: false, name: 'anything', feedOverride: true })).toBe(true);
  });
});
