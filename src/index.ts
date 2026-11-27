import { registerPlugin } from '@capacitor/core';

import type { NativeLoaderPlugin } from './definitions.js';

const NativeLoader = registerPlugin<NativeLoaderPlugin>('NativeLoader', {
  web: () => import('./web.js').then((m) => new m.NativeLoaderWeb()),
});

export * from './definitions.js';
export { NativeLoader };
