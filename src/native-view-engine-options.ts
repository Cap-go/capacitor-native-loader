import type { NativeLoaderShowOptions } from './definitions';

export const DEFAULT_NATIVE_VIEW_ENGINE_PROJECTION_SELECTOR = '#native-loader-engine-slot';

export function resolveNativeViewEngineFromShowOptions(
  options: NativeLoaderShowOptions = {},
  defaults: NativeLoaderShowOptions = {},
): { enabled: boolean; projectionSelector: string } {
  const merged: NativeLoaderShowOptions = { ...defaults, ...options };
  const enabled = merged.useNativeViewEngine === true;
  const custom = merged.nativeViewEngineProjectionSelector?.trim();
  const projectionSelector = custom && custom.length > 0 ? custom : DEFAULT_NATIVE_VIEW_ENGINE_PROJECTION_SELECTOR;
  return { enabled, projectionSelector };
}
