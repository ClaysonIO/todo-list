import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.clayson.quicktodo',
  appName: 'Quick Todo',
  webDir: 'dist',
  android: {
    // Debug tooling adds startup cost; keep it off in release builds.
    webContentsDebuggingEnabled: false,
    // The WebView background is set per light/dark mode in MainActivity.java
    // instead of here, so there is no flash of the wrong colour before paint.
    allowMixedContent: false,
  },
  plugins: {
    CapacitorUpdater: {
      // Capgo live updates. Set autoUpdate to true (and add appId / channel
      // via `npx @capgo/cli init`) once the app is registered on capgo.app.
      // Leaving it off means the app never touches the network on launch.
      autoUpdate: false,
      resetWhenUpdate: true,
      directUpdate: false,
    },
  },
};

export default config;
