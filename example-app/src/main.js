import './style.css';
import { Capacitor } from '@capacitor/core';
import { NativeLoader } from '@capgo/capacitor-native-loader';
import lottieJson from './preview-loading-dots.json';

const output = document.getElementById('plugin-output');
const style = document.getElementById('loader-style');
const placement = document.getElementById('loader-placement');
const interactionMode = document.getElementById('interaction-mode');
const message = document.getElementById('loader-message');
const resizeWebView = document.getElementById('resize-webview');
const progress = document.getElementById('loader-progress');
const showButton = document.getElementById('show-loader');
const updateButton = document.getElementById('update-loader');
const progressButton = document.getElementById('set-progress');
const hideButton = document.getElementById('hide-loader');
const versionButton = document.getElementById('get-version');

let currentId;

const colors = ['#71f6ff', '#8b5cf6', '#ff4ecd', '#fff7ad'];
const chromeColors = ['#4285f4', '#34a853', '#fbbc05', '#ea4335'];

const setOutput = (value) => {
  output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

const makeLottieAsset = () => ({
  source: `data:application/json;base64,${btoa(JSON.stringify(lottieJson))}`,
  type: 'lottie',
  loop: true,
  autoPlay: true,
});

const makeImageAsset = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(16, 16, 144, 144);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.46, colors[1]);
  gradient.addColorStop(1, colors[2]);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(80, 80, 56, 0, Math.PI * 2);
  context.fill();
  context.globalCompositeOperation = 'source-over';
  context.strokeStyle = 'rgba(255,255,255,0.72)';
  context.lineWidth = 8;
  context.beginPath();
  context.arc(80, 80, 34, -Math.PI / 2, Math.PI * 1.2);
  context.stroke();

  return {
    source: canvas.toDataURL('image/png'),
    type: 'image',
  };
};

const assetForStyle = (selectedStyle) => {
  if (selectedStyle === 'lottie') return makeLottieAsset();
  if (selectedStyle === 'image') return makeImageAsset();
  return undefined;
};

const options = () => {
  const selectedPlacement =
    placement.value === 'around' || style.value === 'around'
      ? 'around'
      : style.value === 'chrome'
        ? 'top'
        : style.value === 'siri-v2'
          ? 'fullscreen'
          : placement.value;
  const selectedStyle = style.value === 'around' ? 'halo' : style.value;
  const isChrome = selectedStyle === 'chrome';
  const isSiriV2 = selectedStyle === 'siri-v2';

  return {
    id: currentId,
    style: selectedStyle,
    placement: selectedPlacement,
    message: isChrome || isSiriV2 ? '' : message.value,
    colors: isChrome ? chromeColors : colors,
    size: isChrome || isSiriV2 ? 1 : 104,
    thickness: isChrome ? 4 : isSiriV2 ? 10 : 6,
    progress: Number(progress.value) / 100,
    interactionMode: interactionMode.value,
    scrimColor: isSiriV2 ? 'rgba(3, 7, 18, 0.10)' : selectedPlacement === 'fullscreen' ? 'rgba(3, 7, 18, 0.42)' : undefined,
    accessibilityLabel: message.value || 'Loading',
    asset: assetForStyle(selectedStyle),
    webView: resizeWebView.checked
      ? {
          mode: 'resize',
          insets: isSiriV2
            ? { top: 18, right: 18, bottom: 18, left: 18 }
            : selectedPlacement === 'top'
              ? { top: isChrome ? 12 : 96 }
              : { bottom: 96 },
          restoreOnHide: true,
        }
      : undefined,
  };
};

const recordingDemos = [
  {
    style: 'siri',
    placement: 'fullscreen',
    message: 'Siri-style loader',
    size: 132,
    scrimColor: 'rgba(3, 7, 18, 0.28)',
  },
  {
    style: 'siri-v2',
    placement: 'fullscreen',
    message: '',
    size: 1,
    thickness: 10,
    scrimColor: 'rgba(3, 7, 18, 0.10)',
  },
  {
    style: 'chrome',
    placement: 'top',
    message: '',
    colors: chromeColors,
    size: 1,
    thickness: 10,
  },
  {
    style: 'ring',
    placement: 'center',
    message: 'Standard spinner',
  },
  {
    style: 'dots',
    placement: 'bottom',
    message: 'Loading more',
  },
  {
    style: 'bars',
    placement: 'center',
    message: 'Syncing audio',
  },
  {
    style: 'wave',
    placement: 'top',
    message: 'Streaming',
  },
  {
    style: 'orbit',
    placement: 'center',
    message: 'Connecting',
  },
  {
    style: 'pulse',
    placement: 'center',
    message: 'Waiting for device',
  },
  {
    style: 'halo',
    placement: 'center',
    message: 'Preparing',
  },
  {
    style: 'halo',
    placement: 'around',
    message: 'Around the screen',
    thickness: 8,
  },
  {
    style: 'lottie',
    placement: 'center',
    message: 'Lottie asset',
    asset: makeLottieAsset(),
  },
  {
    style: 'image',
    placement: 'bottom',
    message: 'Image asset',
    asset: makeImageAsset(),
  },
];

const showRecordingDemo = async (demo, index) => {
  currentId = `preview-${index}`;
  style.value = demo.placement === 'around' ? 'around' : demo.style;
  placement.value = demo.placement;
  message.value = demo.message || 'Loading';
  progress.value = String(Math.round((demo.progress ?? 0.42) * 100));
  setOutput({ recording: true, style: style.value, placement: placement.value });

  await NativeLoader.hideAll({ animated: false, restoreWebView: true });
  await NativeLoader.resetWebViewLayout({ animated: false });
  await NativeLoader.show({
    id: currentId,
    colors,
    size: 112,
    thickness: 6,
    duration: demo.style === 'chrome' ? 1200 : demo.style === 'siri-v2' ? 1600 : undefined,
    interactionMode: 'passThrough',
    accessibilityLabel: demo.message || `${demo.style} loader`,
    ...demo,
  });
};

const runRecordingCarousel = async () => {
  document.body.dataset.recording = 'true';
  const initialDelay = Number(import.meta.env.VITE_NATIVE_LOADER_RECORDING_DELAY_MS ?? 3000);
  const demoDuration = Number(import.meta.env.VITE_NATIVE_LOADER_DEMO_DURATION_MS ?? 2400);
  await new Promise((resolve) => setTimeout(resolve, initialDelay));
  for (let index = 0; index < recordingDemos.length; index += 1) {
    await showRecordingDemo(recordingDemos[index], index);
    await new Promise((resolve) => setTimeout(resolve, demoDuration));
  }
  await NativeLoader.hideAll({ animated: false, restoreWebView: true });
  await NativeLoader.resetWebViewLayout({ animated: false });
  setOutput({ recording: 'done' });
};

showButton.addEventListener('click', async () => {
  try {
    const result = await NativeLoader.show(options());
    currentId = result.id;
    setOutput(result);
  } catch (error) {
    setOutput(`Error: ${error?.message ?? error}`);
  }
});

updateButton.addEventListener('click', async () => {
  try {
    if (!currentId) {
      const result = await NativeLoader.show(options());
      currentId = result.id;
      setOutput(result);
      return;
    }

    await NativeLoader.update({ ...options(), id: currentId });
    setOutput(await NativeLoader.getState());
  } catch (error) {
    setOutput(`Error: ${error?.message ?? error}`);
  }
});

progressButton.addEventListener('click', async () => {
  try {
    await NativeLoader.setProgress({
      id: currentId,
      progress: Number(progress.value) / 100,
    });
    setOutput(await NativeLoader.getState());
  } catch (error) {
    setOutput(`Error: ${error?.message ?? error}`);
  }
});

hideButton.addEventListener('click', async () => {
  try {
    await NativeLoader.hide({ id: currentId });
    currentId = undefined;
    setOutput(await NativeLoader.getState());
  } catch (error) {
    setOutput(`Error: ${error?.message ?? error}`);
  }
});

versionButton.addEventListener('click', async () => {
  try {
    setOutput(await NativeLoader.getPluginVersion());
  } catch (error) {
    setOutput(`Error: ${error?.message ?? error}`);
  }
});

if (import.meta.env.VITE_NATIVE_LOADER_RECORDING === '1' && Capacitor.isNativePlatform()) {
  void runRecordingCarousel();
}
