/**
 * Built-in native loader renderer.
 *
 * - `siri`: blurred, rotating multi-orb loader inspired by assistant listening UI.
 * - `orbit`: dots orbiting a transparent center.
 * - `ring`: rotating stroked ring.
 * - `pulse`: expanding translucent ripples.
 * - `dots`: three bouncing dots.
 * - `bars`: equalizer-style vertical bars.
 * - `wave`: flowing horizontal wave.
 * - `halo`: glowing radial halo.
 * - `lottie`: native Lottie JSON animation from `asset`.
 * - `image`: native image view from `asset`.
 */
export type NativeLoaderStyle =
  | 'siri'
  | 'orbit'
  | 'ring'
  | 'pulse'
  | 'dots'
  | 'bars'
  | 'wave'
  | 'halo'
  | 'lottie'
  | 'image';

/**
 * Where the loader is anchored in the native window.
 */
export type NativeLoaderPlacement = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'fullscreen' | 'around' | 'custom';

/**
 * How the native overlay handles pointer/touch input while the loader is visible.
 */
export type NativeLoaderInteractionMode = 'passThrough' | 'block' | 'loaderOnly';

/**
 * How platform reduced-motion settings affect animated loaders.
 */
export type NativeLoaderReducedMotionMode = 'system' | 'pause' | 'slow' | 'ignore';

/**
 * Loader asset type.
 */
export type NativeLoaderAssetType = 'lottie' | 'image';

/**
 * How to alter the Capacitor WebView while a loader is visible.
 */
export type NativeLoaderWebViewMode = 'none' | 'resize' | 'inset';

/**
 * Insets in CSS pixels / device-independent points.
 */
export interface NativeLoaderInsets {
  /**
   * Top inset.
   */
  top?: number;

  /**
   * Right inset.
   */
  right?: number;

  /**
   * Bottom inset.
   */
  bottom?: number;

  /**
   * Left inset.
   */
  left?: number;
}

/**
 * Absolute frame in CSS pixels / device-independent points.
 */
export interface NativeLoaderFrame {
  /**
   * Left offset.
   */
  x: number;

  /**
   * Top offset.
   */
  y: number;

  /**
   * Frame width.
   */
  width: number;

  /**
   * Frame height.
   */
  height: number;
}

/**
 * Native file, bundled asset, remote URL, or data URL used by `lottie` and `image` loaders.
 */
export interface NativeLoaderAsset {
  /**
   * Asset path or URL.
   *
   * Supported forms:
   * - app bundle asset name, for example `loader.json`
   * - `file://` URL
   * - `https://` or `http://` URL
   * - `data:application/json;base64,...` for Lottie JSON
   * - `data:image/...;base64,...` for images
   */
  source: string;

  /**
   * Explicit asset type. Defaults to the current loader `style`.
   */
  type?: NativeLoaderAssetType;

  /**
   * Repeat asset animation. Defaults to `true` for Lottie.
   */
  loop?: boolean;

  /**
   * Asset animation speed multiplier. Defaults to `1`.
   */
  speed?: number;

  /**
   * Start asset animation immediately. Defaults to `true`.
   */
  autoPlay?: boolean;
}

/**
 * Native WebView layout mutation.
 */
export interface NativeLoaderWebViewLayout {
  /**
   * Layout mode.
   *
   * `resize` changes the native WebView frame/margins. `inset` changes scroll
   * content inset/padding where the platform supports it. `none` leaves the
   * WebView untouched.
   */
  mode?: NativeLoaderWebViewMode;

  /**
   * Insets applied in `resize` or `inset` mode.
   */
  insets?: NativeLoaderInsets;

  /**
   * Replace the WebView frame instead of using insets. Used only by iOS and
   * by Android parents that support absolute layout params.
   */
  frame?: NativeLoaderFrame;

  /**
   * Restore the previous WebView layout when the loader is hidden. Defaults to `true`.
   */
  restoreOnHide?: boolean;

  /**
   * Animate the layout change where the platform supports it. Defaults to `true`.
   */
  animated?: boolean;
}

/**
 * Loader display options.
 */
export interface NativeLoaderShowOptions {
  /**
   * Stable loader id. A generated id is returned when omitted.
   */
  id?: string;

  /**
   * Built-in style or asset renderer. Defaults to `siri`.
   */
  style?: NativeLoaderStyle;

  /**
   * Native window placement. Defaults to `center`.
   */
  placement?: NativeLoaderPlacement;

  /**
   * Custom frame used when `placement` is `custom`.
   */
  frame?: NativeLoaderFrame;

  /**
   * Optional loading message shown below or near the loader.
   */
  message?: string;

  /**
   * Loader size in points / CSS pixels. Defaults to `96`.
   */
  size?: number;

  /**
   * Thickness for ring, edge, and progress loaders. Defaults to `5`.
   */
  thickness?: number;

  /**
   * Animation duration in milliseconds for one cycle. Defaults vary by style.
   */
  duration?: number;

  /**
   * Animation speed multiplier. Defaults to `1`.
   */
  speed?: number;

  /**
   * Determinate progress from `0` to `1`. Omit for indeterminate loaders.
   */
  progress?: number;

  /**
   * Loader colors. Built-in loaders use the first colors as gradient stops.
   */
  colors?: string[];

  /**
   * Container background color.
   */
  backgroundColor?: string;

  /**
   * Fullscreen scrim color. Used by `fullscreen` and `around` placements when set.
   */
  scrimColor?: string;

  /**
   * Corner radius for the floating container. Defaults to `24`.
   */
  cornerRadius?: number;

  /**
   * Native blur radius where supported. Defaults to `0`.
   */
  blurRadius?: number;

  /**
   * Hide automatically after this many milliseconds.
   */
  autoHide?: number;

  /**
   * Touch handling for the overlay. Defaults to `passThrough` unless `scrimColor` is set.
   */
  interactionMode?: NativeLoaderInteractionMode;

  /**
   * Reduced motion behavior. Defaults to `system`.
   */
  reducedMotion?: NativeLoaderReducedMotionMode;

  /**
   * Accessibility label announced when the loader appears.
   */
  accessibilityLabel?: string;

  /**
   * Asset configuration for `lottie` and `image` loaders.
   */
  asset?: NativeLoaderAsset;

  /**
   * Optional native WebView layout mutation while the loader is visible.
   */
  webView?: NativeLoaderWebViewLayout;
}

/**
 * Update an existing loader. Any omitted property keeps its current value.
 */
export interface NativeLoaderUpdateOptions extends NativeLoaderShowOptions {
  /**
   * Loader id to update.
   */
  id: string;
}

/**
 * Hide options.
 */
export interface NativeLoaderHideOptions {
  /**
   * Loader id. When omitted, the top-most/current loader is hidden.
   */
  id?: string;

  /**
   * Animate dismissal. Defaults to `true`.
   */
  animated?: boolean;

  /**
   * Restore WebView layout immediately. Defaults to `true`.
   */
  restoreWebView?: boolean;
}

/**
 * Progress update options.
 */
export interface NativeLoaderProgressOptions {
  /**
   * Loader id. When omitted, the top-most/current loader receives progress.
   */
  id?: string;

  /**
   * Determinate progress from `0` to `1`.
   */
  progress: number;
}

/**
 * Global defaults applied to future `show` calls.
 */
export interface NativeLoaderConfigureOptions {
  /**
   * Default show options.
   */
  defaults?: NativeLoaderShowOptions;
}

/**
 * Show result.
 */
export interface NativeLoaderShowResult {
  /**
   * Loader id that can be passed to `update`, `setProgress`, or `hide`.
   */
  id: string;
}

/**
 * Current loader state.
 */
export interface NativeLoaderStateResult {
  /**
   * Whether at least one loader is visible.
   */
  showing: boolean;

  /**
   * Visible loader ids from oldest to newest.
   */
  ids: string[];
}

/**
 * Plugin version payload.
 */
export interface PluginVersionResult {
  /**
   * Version identifier returned by the platform implementation.
   */
  version: string;
}

/**
 * Native loader controller.
 */
export interface NativeLoaderPlugin {
  /**
   * Configure defaults used by future `show` calls.
   */
  configure(options: NativeLoaderConfigureOptions): Promise<void>;

  /**
   * Show a native loader.
   */
  show(options?: NativeLoaderShowOptions): Promise<NativeLoaderShowResult>;

  /**
   * Update an existing native loader.
   */
  update(options: NativeLoaderUpdateOptions): Promise<void>;

  /**
   * Update determinate progress for a visible loader.
   */
  setProgress(options: NativeLoaderProgressOptions): Promise<void>;

  /**
   * Hide one loader.
   */
  hide(options?: NativeLoaderHideOptions): Promise<void>;

  /**
   * Hide every visible loader.
   */
  hideAll(options?: NativeLoaderHideOptions): Promise<void>;

  /**
   * Apply a native WebView layout change without showing a loader.
   */
  setWebViewLayout(options: NativeLoaderWebViewLayout): Promise<void>;

  /**
   * Restore the WebView layout captured before `setWebViewLayout` or `show`.
   */
  resetWebViewLayout(options?: { animated?: boolean }): Promise<void>;

  /**
   * Read current loader state.
   */
  getState(): Promise<NativeLoaderStateResult>;

  /**
   * Returns the platform implementation version marker.
   */
  getPluginVersion(): Promise<PluginVersionResult>;
}
