import type { CapacitorConfig } from '@capacitor/cli';

import pkg from './package.json';

const config: CapacitorConfig = {
  "appId": "app.capgo.nativeloader.example",
  "appName": "Native Loader Example",
  "webDir": "dist",
  "plugins": {
    "CapacitorUpdater": {
      "appId": "app.capgo.nativeloader.example",
      "autoUpdate": true,
      "autoSplashscreen": true,
      "directUpdate": "always",
      "defaultChannel": "production",
      "version": pkg.version
    }
  }
};

export default config;
