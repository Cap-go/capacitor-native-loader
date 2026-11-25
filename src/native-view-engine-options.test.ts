import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_NATIVE_VIEW_ENGINE_PROJECTION_SELECTOR,
  resolveNativeViewEngineFromShowOptions,
} from './native-view-engine-options';

describe('resolveNativeViewEngineFromShowOptions', () => {
  test('engine stays off by default', () => {
    const result = resolveNativeViewEngineFromShowOptions({ style: 'ring' }, {});
    expect(result.enabled).toBe(false);
    expect(result.projectionSelector).toBe(DEFAULT_NATIVE_VIEW_ENGINE_PROJECTION_SELECTOR);
  });

  test('explicit false keeps engine off', () => {
    const result = resolveNativeViewEngineFromShowOptions(
      { useNativeViewEngine: false },
      { useNativeViewEngine: true },
    );
    expect(result.enabled).toBe(false);
  });

  test('true enables engine and custom selector', () => {
    const result = resolveNativeViewEngineFromShowOptions(
      { useNativeViewEngine: true, nativeViewEngineProjectionSelector: '#slot-a' },
      {},
    );
    expect(result.enabled).toBe(true);
    expect(result.projectionSelector).toBe('#slot-a');
  });

  test('defaults inherit engine flag', () => {
    const result = resolveNativeViewEngineFromShowOptions({}, { useNativeViewEngine: true });
    expect(result.enabled).toBe(true);
  });

  test('defaults inherit projection selector', () => {
    const result = resolveNativeViewEngineFromShowOptions(
      { useNativeViewEngine: true },
      { nativeViewEngineProjectionSelector: '#default-slot' },
    );
    expect(result.projectionSelector).toBe('#default-slot');
  });
});
