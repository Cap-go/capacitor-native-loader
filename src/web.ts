import { WebPlugin } from '@capacitor/core';

import type {
  NativeLoaderConfigureOptions,
  NativeLoaderHideOptions,
  NativeLoaderPlugin,
  NativeLoaderProgressOptions,
  NativeLoaderShowOptions,
  NativeLoaderShowResult,
  NativeLoaderStateResult,
  NativeLoaderUpdateOptions,
  NativeLoaderWebViewLayout,
  PluginVersionResult,
} from './definitions';

interface LoaderRecord {
  element: HTMLElement;
  options: RequiredOptions;
  timer?: ReturnType<typeof setTimeout>;
}

type RequiredOptions = NativeLoaderShowOptions & {
  id: string;
  style: NonNullable<NativeLoaderShowOptions['style']>;
  placement: NonNullable<NativeLoaderShowOptions['placement']>;
  size: number;
  thickness: number;
  speed: number;
  colors: string[];
  interactionMode: NonNullable<NativeLoaderShowOptions['interactionMode']>;
};

const DEFAULT_COLORS = ['#71f6ff', '#8b5cf6', '#ff4ecd', '#fff7ad'];

export class NativeLoaderWeb extends WebPlugin implements NativeLoaderPlugin {
  private root?: HTMLElement;
  private styleElement?: HTMLStyleElement;
  private defaults: NativeLoaderShowOptions = {};
  private records = new Map<string, LoaderRecord>();
  private savedBodyStyle?: Partial<CSSStyleDeclaration>;

  async configure(options: NativeLoaderConfigureOptions): Promise<void> {
    this.defaults = {
      ...this.defaults,
      ...(options.defaults ?? {}),
    };
  }

  async show(options: NativeLoaderShowOptions = {}): Promise<NativeLoaderShowResult> {
    const merged = this.normalizeOptions({
      ...this.defaults,
      ...options,
    });

    const existing = this.records.get(merged.id);
    if (existing) {
      await this.update({ ...merged, id: merged.id });
      return { id: merged.id };
    }

    this.ensureRoot();
    if (merged.webView) {
      await this.setWebViewLayout(merged.webView);
    }

    const element = this.render(merged);
    this.root?.appendChild(element);

    const record: LoaderRecord = {
      element,
      options: merged,
    };
    this.records.set(merged.id, record);
    this.applyInteractionMode();

    if (merged.autoHide && merged.autoHide > 0) {
      record.timer = setTimeout(() => {
        void this.hide({ id: merged.id });
      }, merged.autoHide);
    }

    return { id: merged.id };
  }

  async update(options: NativeLoaderUpdateOptions): Promise<void> {
    const existing = this.records.get(options.id);
    if (!existing) {
      await this.show(options);
      return;
    }

    if (existing.timer) {
      clearTimeout(existing.timer);
    }

    const merged = this.normalizeOptions({
      ...existing.options,
      ...options,
      id: options.id,
    });
    const next = this.render(merged);
    existing.element.replaceWith(next);
    existing.element = next;
    existing.options = merged;

    if (merged.autoHide && merged.autoHide > 0) {
      existing.timer = setTimeout(() => {
        void this.hide({ id: merged.id });
      }, merged.autoHide);
    }

    this.applyInteractionMode();
  }

  async setProgress(options: NativeLoaderProgressOptions): Promise<void> {
    const id = options.id ?? this.currentId();
    if (!id) return;

    const record = this.records.get(id);
    if (!record) return;

    await this.update({
      ...record.options,
      id,
      progress: Math.max(0, Math.min(1, options.progress)),
    });
  }

  async hide(options: NativeLoaderHideOptions = {}): Promise<void> {
    const id = options.id ?? this.currentId();
    if (!id) return;

    const record = this.records.get(id);
    if (!record) return;

    if (record.timer) {
      clearTimeout(record.timer);
    }

    const remove = () => {
      record.element.remove();
      this.records.delete(id);
      this.applyInteractionMode();
      if (this.records.size === 0 && options.restoreWebView !== false) {
        void this.resetWebViewLayout({ animated: options.animated });
      }
    };

    if (options.animated === false) {
      remove();
      return;
    }

    record.element.classList.add('native-loader--leaving');
    window.setTimeout(remove, 180);
  }

  async hideAll(options: NativeLoaderHideOptions = {}): Promise<void> {
    await Promise.all([...this.records.keys()].map((id) => this.hide({ ...options, id })));
  }

  async setWebViewLayout(options: NativeLoaderWebViewLayout): Promise<void> {
    if (!this.savedBodyStyle) {
      const body = document.body;
      this.savedBodyStyle = {
        paddingTop: body.style.paddingTop,
        paddingRight: body.style.paddingRight,
        paddingBottom: body.style.paddingBottom,
        paddingLeft: body.style.paddingLeft,
        transition: body.style.transition,
      };
    }

    if ((options.mode ?? 'none') === 'none') return;

    const body = document.body;
    const insets = options.insets ?? {};
    if (options.animated !== false) {
      body.style.transition = 'padding 180ms ease-out';
    }
    body.style.paddingTop = `${insets.top ?? 0}px`;
    body.style.paddingRight = `${insets.right ?? 0}px`;
    body.style.paddingBottom = `${insets.bottom ?? 0}px`;
    body.style.paddingLeft = `${insets.left ?? 0}px`;
  }

  async resetWebViewLayout(options: { animated?: boolean } = {}): Promise<void> {
    if (!this.savedBodyStyle) return;

    const body = document.body;
    if (options.animated !== false) {
      body.style.transition = 'padding 180ms ease-out';
    }
    body.style.paddingTop = this.savedBodyStyle.paddingTop ?? '';
    body.style.paddingRight = this.savedBodyStyle.paddingRight ?? '';
    body.style.paddingBottom = this.savedBodyStyle.paddingBottom ?? '';
    body.style.paddingLeft = this.savedBodyStyle.paddingLeft ?? '';
    body.style.transition = this.savedBodyStyle.transition ?? '';
    this.savedBodyStyle = undefined;
  }

  async getState(): Promise<NativeLoaderStateResult> {
    return {
      showing: this.records.size > 0,
      ids: [...this.records.keys()],
    };
  }

  async getPluginVersion(): Promise<PluginVersionResult> {
    return {
      version: 'web',
    };
  }

  private normalizeOptions(options: NativeLoaderShowOptions): RequiredOptions {
    return {
      ...options,
      id: options.id || `loader-${Date.now()}-${Math.round(Math.random() * 10000)}`,
      style: options.style ?? 'siri',
      placement: options.placement ?? 'center',
      size: options.size ?? 96,
      thickness: options.thickness ?? 5,
      speed: options.speed ?? 1,
      colors: options.colors?.length ? options.colors : DEFAULT_COLORS,
      interactionMode: options.interactionMode ?? (options.scrimColor ? 'block' : 'passThrough'),
    };
  }

  private currentId(): string | undefined {
    const ids = [...this.records.keys()];
    return ids[ids.length - 1];
  }

  private ensureRoot(): void {
    if (!this.styleElement) {
      this.styleElement = document.createElement('style');
      this.styleElement.textContent = css;
      document.head.appendChild(this.styleElement);
    }

    if (!this.root) {
      this.root = document.createElement('div');
      this.root.className = 'native-loader-root';
      document.body.appendChild(this.root);
    }
  }

  private applyInteractionMode(): void {
    if (!this.root) return;

    const blocks = [...this.records.values()].some((record) => record.options.interactionMode === 'block');
    const loaderOnly = [...this.records.values()].some((record) => record.options.interactionMode === 'loaderOnly');
    this.root.style.pointerEvents = blocks ? 'auto' : 'none';
    this.root.dataset.loaderOnly = loaderOnly ? 'true' : 'false';
  }

  private render(options: RequiredOptions): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `native-loader native-loader-${options.placement} native-loader-style-wrapper-${options.style}`;
    wrapper.dataset.id = options.id;
    wrapper.style.setProperty('--loader-size', `${options.size}px`);
    wrapper.style.setProperty('--loader-thickness', `${options.thickness}px`);
    wrapper.style.setProperty('--loader-speed', `${1 / Math.max(0.1, options.speed)}`);
    wrapper.style.setProperty('--loader-color-1', options.colors[0] ?? DEFAULT_COLORS[0]);
    wrapper.style.setProperty('--loader-color-2', options.colors[1] ?? DEFAULT_COLORS[1]);
    wrapper.style.setProperty('--loader-color-3', options.colors[2] ?? DEFAULT_COLORS[2]);
    wrapper.style.setProperty('--loader-color-4', options.colors[3] ?? DEFAULT_COLORS[3]);

    if (options.backgroundColor) {
      wrapper.style.setProperty('--loader-bg', options.backgroundColor);
    }
    if (options.scrimColor) {
      wrapper.style.setProperty('--loader-scrim', options.scrimColor);
    }
    if (options.cornerRadius !== undefined) {
      wrapper.style.setProperty('--loader-radius', `${options.cornerRadius}px`);
    }
    if (options.frame && options.placement === 'custom') {
      wrapper.style.left = `${options.frame.x}px`;
      wrapper.style.top = `${options.frame.y}px`;
      wrapper.style.width = `${options.frame.width}px`;
      wrapper.style.height = `${options.frame.height}px`;
    }

    if (options.style === 'chrome' || options.style === 'siri-v2') {
      const edgeLoader = this.renderGraphic(options);
      edgeLoader.setAttribute('role', 'status');
      edgeLoader.setAttribute('aria-live', 'polite');
      edgeLoader.setAttribute('aria-label', options.accessibilityLabel ?? options.message ?? 'Loading');
      wrapper.appendChild(edgeLoader);

      if (options.style === 'siri-v2' && options.message) {
        const message = document.createElement('div');
        message.className = 'native-loader-message native-loader-edge-message';
        message.textContent = options.message;
        wrapper.appendChild(message);
      }
      return wrapper;
    }

    const card = document.createElement('div');
    card.className = 'native-loader-card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.setAttribute('aria-label', options.accessibilityLabel ?? options.message ?? 'Loading');

    card.appendChild(this.renderGraphic(options));

    if (options.message) {
      const message = document.createElement('div');
      message.className = 'native-loader-message';
      message.textContent = options.message;
      card.appendChild(message);
    }

    wrapper.appendChild(card);
    return wrapper;
  }

  private renderGraphic(options: RequiredOptions): HTMLElement {
    if (options.style === 'image' && options.asset?.source) {
      const image = document.createElement('img');
      image.className = 'native-loader-asset';
      image.src = options.asset.source;
      image.alt = '';
      return image;
    }

    const graphic = document.createElement('div');
    graphic.className = `native-loader-graphic native-loader-style-${options.style}`;

    if (options.progress !== undefined) {
      graphic.style.setProperty('--loader-progress', `${Math.max(0, Math.min(1, options.progress)) * 360}deg`);
      graphic.style.setProperty('--loader-progress-ratio', String(Math.max(0, Math.min(1, options.progress))));
      graphic.classList.add('native-loader--determinate');
    }

    const count =
      options.style === 'chrome' || options.style === 'siri-v2'
        ? 0
        : options.style === 'bars'
          ? 5
          : options.style === 'dots'
            ? 3
            : 4;
    for (let index = 0; index < count; index += 1) {
      const child = document.createElement('span');
      child.style.setProperty('--loader-index', String(index));
      graphic.appendChild(child);
    }

    return graphic;
  }
}

const css = `
.native-loader-root {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
}

.native-loader {
  position: absolute;
  inset: 0;
  display: flex;
  padding: max(env(safe-area-inset-top), 16px) 16px max(env(safe-area-inset-bottom), 16px);
  background: var(--loader-scrim, transparent);
  opacity: 1;
  transition: opacity 180ms ease-out, transform 180ms ease-out;
}

.native-loader-root[data-loader-only='true'] .native-loader-card {
  pointer-events: auto;
}

.native-loader--leaving {
  opacity: 0;
  transform: scale(0.98);
}

.native-loader-center,
.native-loader-fullscreen {
  align-items: center;
  justify-content: center;
}

.native-loader-top {
  align-items: flex-start;
  justify-content: center;
}

.native-loader-style-wrapper-chrome {
  align-items: flex-start;
  justify-content: stretch;
  padding: max(env(safe-area-inset-top), 0px) 0 0;
}

.native-loader-style-wrapper-siri-v2 {
  align-items: stretch;
  justify-content: stretch;
  padding: 0;
}

.native-loader-bottom {
  align-items: flex-end;
  justify-content: center;
}

.native-loader-left {
  align-items: center;
  justify-content: flex-start;
}

.native-loader-right {
  align-items: center;
  justify-content: flex-end;
}

.native-loader-around {
  align-items: stretch;
  justify-content: stretch;
}

.native-loader-custom {
  inset: auto;
  padding: 0;
  align-items: center;
  justify-content: center;
}

.native-loader-card {
  display: grid;
  place-items: center;
  gap: 12px;
  min-width: calc(var(--loader-size) + 36px);
  min-height: calc(var(--loader-size) + 36px);
  padding: 18px;
  border-radius: var(--loader-radius, 24px);
  color: white;
  background: var(--loader-bg, rgba(10, 12, 18, 0.68));
  box-shadow: 0 16px 50px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(20px) saturate(130%);
}

.native-loader-around .native-loader-card {
  width: 100%;
  min-height: 100%;
  border-radius: 0;
  background: transparent;
  box-shadow: inset 0 0 0 var(--loader-thickness) color-mix(in srgb, var(--loader-color-1), transparent 45%);
}

.native-loader-message {
  max-width: 260px;
  font: 600 14px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-align: center;
}

.native-loader-edge-message {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: min(280px, calc(100vw - 48px));
  padding: 10px 16px;
  border-radius: 999px;
  color: white;
  background: rgba(10, 12, 18, 0.58);
  transform: translate(-50%, -50%);
}

.native-loader-graphic,
.native-loader-asset {
  width: var(--loader-size);
  height: var(--loader-size);
}

.native-loader-asset {
  object-fit: contain;
}

.native-loader-graphic {
  position: relative;
}

.native-loader-style-chrome {
  width: 100%;
  height: max(var(--loader-thickness), 3px);
  min-height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--loader-color-1), transparent 82%);
  box-shadow: 0 0 18px color-mix(in srgb, var(--loader-color-2), transparent 62%);
}

.native-loader-style-chrome::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--loader-color-1), var(--loader-color-2), var(--loader-color-3));
  box-shadow: 0 0 16px color-mix(in srgb, var(--loader-color-2), transparent 38%);
  animation: native-loader-chrome calc(1200ms * var(--loader-speed)) ease-in-out infinite;
}

.native-loader-style-chrome.native-loader--determinate::before {
  width: 100%;
  animation: none;
  transform: scaleX(var(--loader-progress-ratio, 0));
  transform-origin: left center;
}

@property --native-loader-siri-v2-angle {
  syntax: "<angle>";
  initial-value: 0deg;
  inherits: false;
}

.native-loader-style-siri-v2 {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 0;
  overflow: hidden;
}

.native-loader-style-siri-v2::before,
.native-loader-style-siri-v2::after {
  content: "";
  position: absolute;
  border-radius: clamp(34px, 7vmin, 68px);
  padding: var(--loader-thickness);
  background: conic-gradient(
    from var(--native-loader-siri-v2-angle),
    var(--loader-color-1),
    var(--loader-color-2),
    var(--loader-color-3),
    var(--loader-color-4),
    var(--loader-color-1)
  );
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  animation: native-loader-siri-v2 calc(1600ms * var(--loader-speed)) linear infinite;
}

.native-loader-style-siri-v2::before {
  inset: calc(var(--loader-thickness) * -2.4);
  padding: calc(var(--loader-thickness) * 4);
  filter: blur(calc(var(--loader-thickness) * 2.2));
  opacity: 0.94;
}

.native-loader-style-siri-v2::after {
  inset: 0;
  padding: max(8px, calc(var(--loader-thickness) * 1.15));
  opacity: 0.88;
}

.native-loader-style-siri span {
  position: absolute;
  inset: 18%;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 30%, var(--loader-color-1), var(--loader-color-2) 48%, transparent 70%);
  filter: blur(7px);
  mix-blend-mode: screen;
  animation: native-loader-orb calc(1500ms * var(--loader-speed)) ease-in-out infinite;
  animation-delay: calc(var(--loader-index) * -180ms);
  transform-origin: calc(50% + var(--loader-index) * 8%) 50%;
}

.native-loader-style-orbit span,
.native-loader-style-dots span {
  position: absolute;
  width: 18%;
  height: 18%;
  border-radius: 999px;
  background: var(--loader-color-1);
}

.native-loader-style-orbit {
  animation: native-loader-spin calc(1100ms * var(--loader-speed)) linear infinite;
}

.native-loader-style-orbit span {
  left: 41%;
  top: 4%;
  transform: rotate(calc(var(--loader-index) * 90deg)) translateY(calc(var(--loader-size) * 0.38));
  transform-origin: 50% calc(var(--loader-size) * 0.46);
}

.native-loader-style-ring::before {
  content: "";
  position: absolute;
  inset: 8%;
  border-radius: 999px;
  border: var(--loader-thickness) solid color-mix(in srgb, var(--loader-color-1), transparent 78%);
  border-top-color: var(--loader-color-1);
  border-right-color: var(--loader-color-2);
  animation: native-loader-spin calc(900ms * var(--loader-speed)) linear infinite;
}

.native-loader-style-pulse span {
  position: absolute;
  inset: 18%;
  border-radius: 999px;
  border: var(--loader-thickness) solid var(--loader-color-1);
  animation: native-loader-pulse calc(1500ms * var(--loader-speed)) ease-out infinite;
  animation-delay: calc(var(--loader-index) * 220ms);
}

.native-loader-style-dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10%;
}

.native-loader-style-dots span {
  position: static;
  animation: native-loader-bounce calc(760ms * var(--loader-speed)) ease-in-out infinite;
  animation-delay: calc(var(--loader-index) * 110ms);
}

.native-loader-style-bars {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8%;
}

.native-loader-style-bars span {
  width: 10%;
  height: 58%;
  border-radius: 999px;
  background: linear-gradient(var(--loader-color-1), var(--loader-color-2));
  animation: native-loader-bars calc(780ms * var(--loader-speed)) ease-in-out infinite;
  animation-delay: calc(var(--loader-index) * 90ms);
}

.native-loader-style-wave::before,
.native-loader-style-halo::before,
.native-loader-style-lottie::before {
  content: "";
  position: absolute;
  inset: 12%;
  border-radius: 999px;
  background: conic-gradient(from 0deg, var(--loader-color-1), var(--loader-color-2), var(--loader-color-3), var(--loader-color-1));
  mask: radial-gradient(circle, transparent 48%, black 50%);
  animation: native-loader-spin calc(1200ms * var(--loader-speed)) linear infinite;
}

.native-loader-style-wave::after {
  content: "";
  position: absolute;
  left: 8%;
  right: 8%;
  top: 48%;
  height: var(--loader-thickness);
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, var(--loader-color-1), var(--loader-color-3), transparent);
  animation: native-loader-wave calc(1300ms * var(--loader-speed)) ease-in-out infinite;
}

.native-loader-style-halo::before {
  filter: blur(10px);
  mask: none;
  opacity: 0.85;
}

@media (prefers-reduced-motion: reduce) {
  .native-loader-graphic,
  .native-loader-graphic *,
  .native-loader-graphic::before,
  .native-loader-graphic::after {
    animation-duration: 3000ms !important;
  }
}

@keyframes native-loader-spin {
  to { transform: rotate(360deg); }
}

@keyframes native-loader-orb {
  0%, 100% { transform: rotate(0deg) scale(0.78); opacity: 0.7; }
  50% { transform: rotate(180deg) scale(1.08); opacity: 1; }
}

@keyframes native-loader-pulse {
  0% { transform: scale(0.2); opacity: 0.85; }
  100% { transform: scale(1.75); opacity: 0; }
}

@keyframes native-loader-bounce {
  0%, 100% { transform: translateY(22%); opacity: 0.45; }
  50% { transform: translateY(-22%); opacity: 1; }
}

@keyframes native-loader-bars {
  0%, 100% { transform: scaleY(0.36); opacity: 0.45; }
  50% { transform: scaleY(1); opacity: 1; }
}

@keyframes native-loader-wave {
  0%, 100% { transform: translateY(-120%) scaleX(0.6); opacity: 0.45; }
  50% { transform: translateY(120%) scaleX(1); opacity: 1; }
}

@keyframes native-loader-chrome {
  0% { transform: translateX(-110%) scaleX(0.72); opacity: 0.62; }
  46% { transform: translateX(128%) scaleX(1.18); opacity: 1; }
  100% { transform: translateX(250%) scaleX(0.8); opacity: 0.72; }
}

@keyframes native-loader-siri-v2 {
  to { --native-loader-siri-v2-angle: 360deg; }
}
`;
