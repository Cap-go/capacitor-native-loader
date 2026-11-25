# Cap-go/website patch (native-loader engine option)

Apply on `src/content/docs/docs/plugins/native-loader/index.mdx` (add section after Usage overview):

```mdx
## WebView Native UI Engine

Set `useNativeViewEngine: true` on `show()` when a DOM slot should own loader projection with [`@webview-native-ui/engine`](https://github.com/webview-native-ui/engine/). Supply a container matching `nativeViewEngineProjectionSelector` (default `#native-loader-engine-slot`).

Call `setNativeViewEnginePresentation({ presentation: 'web' })` before a Web modal covers the loader, then `presentation: 'native'` when the modal dismisses. Defaults to `false` for unchanged legacy behavior.

CocoaPods apps need a direct npm dependency on `@webview-native-ui/engine@1.0.11` plus the local `WebViewNativeUIEngine` pod path. See the plugin README engine section.
```

Add to `src/config/plugins.ts` only if missing keywords (no change expected).

Add tutorial note in `src/content/plugins-tutorials/en/capacitor-native-loader.md` if present.