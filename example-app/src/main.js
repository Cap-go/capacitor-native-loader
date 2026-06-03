import './style.css';
import { NativeLoader } from '@capgo/capacitor-native-loader';

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

const setOutput = (value) => {
  output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

const options = () => {
  const selectedPlacement = placement.value === 'around' || style.value === 'around' ? 'around' : placement.value;

  return {
    id: currentId,
    style: style.value === 'around' ? 'halo' : style.value,
    placement: selectedPlacement,
    message: message.value,
    colors,
    size: 104,
    thickness: 6,
    progress: Number(progress.value) / 100,
    interactionMode: interactionMode.value,
    scrimColor: selectedPlacement === 'fullscreen' ? 'rgba(3, 7, 18, 0.42)' : undefined,
    accessibilityLabel: message.value || 'Loading',
    webView: resizeWebView.checked
      ? {
          mode: 'resize',
          insets: selectedPlacement === 'top' ? { top: 96 } : { bottom: 96 },
          restoreOnHide: true,
        }
      : undefined,
  };
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
