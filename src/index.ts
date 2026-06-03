import { registerPlugin } from '@capacitor/core';

import type { NativeLoaderPlugin } from './definitions';

const NativeLoader = registerPlugin<NativeLoaderPlugin>('NativeLoader', {
  web: () => import('./web').then((m) => new m.NativeLoaderWeb()),
});

export * from './definitions';
export { NativeLoader };
