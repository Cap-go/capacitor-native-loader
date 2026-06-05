#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, '..');
const exampleDir = join(repoDir, 'example-app');
const previewDir = join(repoDir, 'docs', 'previews');
const recordingDir = join(repoDir, '.preview-recordings');
const frameRoot = join(recordingDir, 'frames');
const iosDir = join(exampleDir, 'ios');
const previewLottieFixture = join(scriptDir, 'preview-loading-dots.json');
const styleOrder = ['siri', 'siri-v2', 'chrome', 'ring', 'dots', 'bars', 'wave', 'orbit', 'pulse', 'halo', 'around', 'lottie', 'image'];
const secondsPerDemo = Number(process.env.PREVIEW_SECONDS_PER_DEMO ?? 7);
const firstDemoOffset = Number(process.env.PREVIEW_FIRST_DEMO_OFFSET ?? 3.2);
const framesPerDemo = Number(process.env.PREVIEW_FRAMES_PER_DEMO ?? 10);
const bundleId = JSON.parse(readFileSync(join(exampleDir, 'capacitor.config.json'), 'utf8')).appId;

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoDir,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.stdio ?? 'inherit',
    encoding: 'utf8',
    timeout: options.timeout,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
  return result.stdout ?? '';
};

const hasTool = (command) => {
  const result = spawnSync('zsh', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return result.status === 0;
};

const readJson = (command, args, options = {}) => JSON.parse(run(command, args, { stdio: 'pipe', ...options }));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const screenshotContentScore = (simulatorId, target) => {
  run('xcrun', ['simctl', 'io', simulatorId, 'screenshot', target], { stdio: 'ignore', timeout: 30_000 });
  return Number(
    run('magick', [target, '-gravity', 'center', '-crop', '70%x60%+0+0', '-format', '%[fx:standard_deviation]', 'info:'], {
      stdio: 'pipe',
    })
  );
};

const pickSimulator = () => {
  if (process.env.PREVIEW_SIMULATOR_UDID) {
    return process.env.PREVIEW_SIMULATOR_UDID;
  }

  const booted = readJson('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']);
  for (const devices of Object.values(booted.devices ?? {})) {
    const iphone = devices.find((device) => device.isAvailable && device.name.includes('iPhone'));
    if (iphone) return iphone.udid;
  }

  const available = readJson('xcrun', ['simctl', 'list', 'devices', 'available', '-j']);
  for (const devices of Object.values(available.devices ?? {})) {
    const preferred =
      devices.find((device) => device.isAvailable && device.name.includes('iPhone 17 Pro')) ??
      devices.find((device) => device.isAvailable && device.name.includes('iPhone'));
    if (preferred) return preferred.udid;
  }

  throw new Error('No available iPhone simulator found');
};

const waitForSimulatorBoot = async (simulatorId) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const booted = readJson('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { timeout: 10_000 });
      for (const devices of Object.values(booted.devices ?? {})) {
        if (devices.some((device) => device.udid === simulatorId && device.state === 'Booted')) {
          return;
        }
      }
    } catch {
      // CoreSimulator can briefly reject list calls while it restarts.
    }
    await sleep(1000);
  }
  throw new Error(`Simulator ${simulatorId} did not boot within 60 seconds`);
};

const buildAndInstallIosApp = (simulatorId) => {
  const derivedDataPath = join(iosDir, 'DerivedData', 'preview');
  const projectPath = join(iosDir, 'App', 'App.xcodeproj');
  const appPath = join(derivedDataPath, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');

  rmSync(derivedDataPath, { recursive: true, force: true });
  run('xcodebuild', [
    '-project',
    projectPath,
    '-scheme',
    'App',
    '-configuration',
    'Debug',
    '-destination',
    `id=${simulatorId}`,
    '-derivedDataPath',
    derivedDataPath,
    'ENABLE_DEBUG_DYLIB=NO',
    'CODE_SIGNING_ALLOWED=NO',
  ]);

  if (!existsSync(appPath)) {
    throw new Error(`Expected built app at ${appPath}`);
  }

  if (process.env.PREVIEW_STOP_AFTER_XCODE_BUILD === '1') {
    console.log(`Built iOS preview app: ${appPath}`);
    return;
  }

  run('xcrun', ['simctl', 'install', simulatorId, appPath], { timeout: 90_000 });
};

const stripGeneratedXcodeResources = () => {
  const projectFile = join(iosDir, 'App', 'App.xcodeproj', 'project.pbxproj');
  const projectJson = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', projectFile], { stdio: 'pipe' }));
  const objects = projectJson.objects ?? {};
  const removedNames = [
    'Assets.xcassets',
    'Main.storyboard',
    'LaunchScreen.storyboard',
    'public',
    'config.xml',
    'capacitor.config.json',
  ];
  const shouldRemoveResource = (entry) => {
    const fields = [entry.path, entry.name, entry.lastKnownFileType].filter(Boolean).map(String);
    return fields.some((field) => removedNames.some((name) => field.includes(name))) || fields.includes('folder.assetcatalog');
  };

  const removedIds = new Set();
  for (const [id, entry] of Object.entries(objects)) {
    if (shouldRemoveResource(entry)) {
      removedIds.add(id);
      for (const childId of entry.children ?? []) {
        removedIds.add(childId);
      }
    }
  }

  let addedReference = true;
  while (addedReference) {
    addedReference = false;
    for (const [id, entry] of Object.entries(objects)) {
      if (removedIds.has(id)) continue;
      if (removedIds.has(entry.fileRef)) {
        removedIds.add(id);
        addedReference = true;
      }
    }
  }

  for (const id of removedIds) {
    delete objects[id];
  }

  const stripReferences = (value) => {
    if (Array.isArray(value)) {
      return value.filter((entry) => !removedIds.has(String(entry))).map(stripReferences);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stripReferences(entry)]));
    }
    return value;
  };

  projectJson.objects = stripReferences(objects);
  const projectJsonFile = join(recordingDir, 'preview-project.json');
  writeFileSync(projectJsonFile, JSON.stringify(projectJson));
  run('plutil', ['-convert', 'xml1', '-o', projectFile, projectJsonFile], { stdio: 'ignore' });
  rmSync(projectJsonFile, { force: true });

  const plist = join(iosDir, 'App', 'App', 'Info.plist');
  run('/usr/libexec/PlistBuddy', ['-c', 'Delete :UIMainStoryboardFile', plist], { stdio: 'ignore', allowFailure: true });
  run('/usr/libexec/PlistBuddy', ['-c', 'Delete :UILaunchStoryboardName', plist], { stdio: 'ignore', allowFailure: true });
  run('/usr/libexec/PlistBuddy', ['-c', 'Delete :UIApplicationSceneManifest', plist], { stdio: 'ignore', allowFailure: true });
};

const writeNativePreviewApp = () => {
  const appDelegate = join(iosDir, 'App', 'App', 'AppDelegate.swift');
  const demoDurationMs = Math.round(secondsPerDemo * 1000);
  const recordingDelayMs = Math.round(firstDemoOffset * 1000 - 400);
  const swiftStyleOrder = styleOrder.map((style) => `"${style}"`).join(', ');
  const lottiePreviewBase64 = readFileSync(previewLottieFixture).toString('base64');

  writeFileSync(
    appDelegate,
    `import UIKit
import NativeLoaderPlugin

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = NativeLoaderPreviewViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

final class NativeLoaderPreviewViewController: UIViewController {
    private let styleSequence = [${swiftStyleOrder}]
    private lazy var styles: [String] = {
        if let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--native-loader-style=") }) {
            return [String(argument.dropFirst("--native-loader-style=".count))]
        }
        return styleSequence
    }()
    private let demoDuration: TimeInterval = ${demoDurationMs} / 1000
    private let firstDelay: TimeInterval = ${recordingDelayMs} / 1000
    private let colors = ["#71f6ff", "#8b5cf6", "#ff4ecd", "#fff7ad"]
    private let chromeColors = ["#4285f4", "#34a853", "#fbbc05", "#ea4335"]
    private let lottiePreviewBase64 = "${lottiePreviewBase64}"

    private let titleLabel = UILabel()
    private let styleValue = UILabel()
    private let placementValue = UILabel()
    private let modeValue = UILabel()
    private let outputLabel = UILabel()
    private let progressView = UIProgressView(progressViewStyle: .bar)
    private var didStart = false

    override func viewDidLoad() {
        super.viewDidLoad()
        buildDemoUI()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !didStart else { return }
        didStart = true
        let delay = styles.count == 1 ? 0.65 : firstDelay
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.showDemo(at: 0)
        }
    }

    private func buildDemoUI() {
        view.backgroundColor = UIColor(red: 0.025, green: 0.06, blue: 0.12, alpha: 1)

        let gradient = CAGradientLayer()
        gradient.colors = [
            UIColor(red: 0.04, green: 0.08, blue: 0.15, alpha: 1).cgColor,
            UIColor(red: 0.08, green: 0.10, blue: 0.18, alpha: 1).cgColor,
            UIColor(red: 0.03, green: 0.05, blue: 0.10, alpha: 1).cgColor
        ]
        gradient.startPoint = CGPoint(x: 0, y: 0)
        gradient.endPoint = CGPoint(x: 1, y: 1)
        gradient.frame = UIScreen.main.bounds
        view.layer.addSublayer(gradient)

        let container = UIStackView()
        container.axis = .vertical
        container.spacing = 10
        container.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(container)

        let header = UIStackView()
        header.axis = .horizontal
        header.alignment = .center
        header.distribution = .equalSpacing

        titleLabel.text = "Native Loader"
        titleLabel.textColor = .white
        titleLabel.font = UIFont.systemFont(ofSize: 26, weight: .bold)
        titleLabel.adjustsFontSizeToFitWidth = true
        titleLabel.minimumScaleFactor = 0.72
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        header.addArrangedSubview(titleLabel)

        let version = badge("Native API")
        header.addArrangedSubview(version)
        container.addArrangedSubview(header)

        container.addArrangedSubview(row(title: "Style", valueLabel: styleValue))
        container.addArrangedSubview(row(title: "Placement", valueLabel: placementValue))
        container.addArrangedSubview(row(title: "Touches", valueLabel: modeValue))
        container.addArrangedSubview(messageBlock())

        let progressLabel = smallLabel("Progress")
        container.addArrangedSubview(progressLabel)
        progressView.progressTintColor = UIColor(red: 1.0, green: 0.31, blue: 0.80, alpha: 1)
        progressView.trackTintColor = UIColor(white: 1, alpha: 0.12)
        progressView.layer.cornerRadius = 3
        progressView.clipsToBounds = true
        progressView.heightAnchor.constraint(equalToConstant: 5).isActive = true
        container.addArrangedSubview(progressView)

        container.addArrangedSubview(actionRow(["Show", "Update", "Hide"]))

        outputLabel.text = "{\\n  \\"recording\\": true\\n}"
        outputLabel.textColor = UIColor(red: 0.79, green: 0.84, blue: 0.91, alpha: 1)
        outputLabel.numberOfLines = 0
        outputLabel.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        outputLabel.backgroundColor = UIColor(white: 0, alpha: 0.24)
        outputLabel.layer.cornerRadius = 8
        outputLabel.layer.borderWidth = 1
        outputLabel.layer.borderColor = UIColor(white: 1, alpha: 0.12).cgColor
        outputLabel.clipsToBounds = true
        outputLabel.layoutMargins = UIEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
        container.addArrangedSubview(outputLabel)

        NSLayoutConstraint.activate([
            container.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            container.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            container.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 14),
            container.bottomAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16)
        ])

        let initialStyle = styles.first ?? "siri"
        setDemoText(
            style: displayStyle(for: initialStyle),
            placement: placement(for: initialStyle),
            message: message(for: initialStyle)
        )
    }

    private func showDemo(at index: Int) {
        guard index < styles.count else {
            NativeLoader.shared.hideAll(animated: false, restoreWebView: true)
            outputLabel.text = "{\\n  \\"recording\\": \\"done\\"\\n}"
            return
        }

        let style = styles[index]
        let demo = options(for: style, index: index)
        setDemoText(
            style: displayStyle(for: style),
            placement: demo["placement"] as? String ?? "center",
            message: demo["message"] as? String ?? ""
        )
        NativeLoader.shared.hideAll(animated: false, restoreWebView: true)
        _ = NativeLoader.shared.show(options: demo)

        DispatchQueue.main.asyncAfter(deadline: .now() + demoDuration) { [weak self] in
            self?.showDemo(at: index + 1)
        }
    }

    private func options(for style: String, index: Int) -> [String: Any] {
        var options: [String: Any] = [
            "id": "preview-\\(index)",
            "style": style == "around" ? "halo" : style,
            "placement": placement(for: style),
            "message": message(for: style),
            "colors": style == "chrome" ? chromeColors : colors,
            "size": size(for: style),
            "thickness": style == "chrome" ? 4 : (style == "siri-v2" ? 10 : 6),
            "progress": progress(for: style),
            "interactionMode": "loaderOnly",
            "accessibilityLabel": message(for: style)
        ]

        if style == "chrome" {
            options["message"] = ""
            options["size"] = 1
            options["duration"] = 1200
        }
        if style == "siri-v2" {
            options["message"] = ""
            options["size"] = 1
            options["duration"] = 1600
            options["scrimColor"] = "rgba(3, 7, 18, 0.10)"
        }
        if style == "around" {
            options["placement"] = "around"
            options["thickness"] = 8
        }
        if style == "siri" {
            options["scrimColor"] = "rgba(3, 7, 18, 0.18)"
        }
        if style == "lottie" {
            options["asset"] = lottieAsset()
        }
        if style == "image" {
            options["asset"] = imageAsset()
        }
        return options
    }

    private func placement(for style: String) -> String {
        switch style {
        case "siri", "siri-v2": return "fullscreen"
        case "chrome", "wave": return "top"
        case "dots", "image": return "bottom"
        case "around": return "around"
        default: return "center"
        }
    }

    private func message(for style: String) -> String {
        switch style {
        case "siri": return "Siri-style loader"
        case "siri-v2": return ""
        case "chrome": return ""
        case "ring": return "Standard progress"
        case "dots": return "Loading more"
        case "bars": return "Syncing audio"
        case "wave": return "Streaming"
        case "orbit": return "Connecting"
        case "pulse": return "Waiting for device"
        case "halo": return "Preparing"
        case "around": return "Around the screen"
        case "lottie": return "Lottie asset"
        case "image": return "Image asset"
        default: return "Loading"
        }
    }

    private func progress(for style: String) -> Double {
        switch style {
        case "ring": return 0.68
        case "chrome": return 0.42
        default: return 0.36
        }
    }

    private func size(for style: String) -> Int {
        switch style {
        case "siri": return 132
        case "siri-v2": return 1
        case "lottie": return 96
        case "image": return 72
        default: return 112
        }
    }

    private func displayStyle(for style: String) -> String {
        switch style {
        case "chrome": return "Chrome top"
        case "siri-v2": return "Siri v2"
        default: return style.prefix(1).uppercased() + style.dropFirst()
        }
    }

    private func setDemoText(style: String, placement: String, message: String) {
        styleValue.text = style
        placementValue.text = placement.prefix(1).uppercased() + placement.dropFirst()
        modeValue.text = "Loader only"
        progressView.setProgress(Float(progress(for: style.lowercased())), animated: true)
        outputLabel.text = "{\\n  \\"recording\\": true,\\n  \\"style\\": \\"\\(style)\\",\\n  \\"placement\\": \\"\\(placement)\\"\\n}"
    }

    private func lottieAsset() -> [String: Any] {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("native-loader-loading-dots.json")
        if let data = Data(base64Encoded: lottiePreviewBase64) {
            try? data.write(to: url)
        }
        return ["source": url.path, "type": "lottie", "loop": true, "autoPlay": true]
    }

    private func imageAsset() -> [String: Any] {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 160, height: 160))
        let image = renderer.image { context in
            let cgContext = context.cgContext
            let colors = [
                UIColor(red: 0.44, green: 0.96, blue: 1.0, alpha: 1).cgColor,
                UIColor(red: 0.55, green: 0.36, blue: 0.96, alpha: 1).cgColor,
                UIColor(red: 1.0, green: 0.31, blue: 0.80, alpha: 1).cgColor
            ] as CFArray
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 0.46, 1])!
            cgContext.drawLinearGradient(gradient, start: CGPoint(x: 16, y: 16), end: CGPoint(x: 144, y: 144), options: [])
            UIColor(white: 1, alpha: 0.72).setStroke()
            let path = UIBezierPath(arcCenter: CGPoint(x: 80, y: 80), radius: 34, startAngle: -.pi / 2, endAngle: .pi * 1.2, clockwise: true)
            path.lineWidth = 8
            path.stroke()
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("native-loader-image-preview.png")
        try? image.pngData()?.write(to: url)
        return ["source": url.path, "type": "image"]
    }

    private func row(title: String, valueLabel: UILabel) -> UIView {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 5
        stack.addArrangedSubview(smallLabel(title))
        let field = UIView()
        field.backgroundColor = UIColor(red: 0.06, green: 0.09, blue: 0.15, alpha: 0.92)
        field.layer.cornerRadius = 8
        field.layer.borderWidth = 1
        field.layer.borderColor = UIColor(white: 1, alpha: 0.16).cgColor
        valueLabel.textColor = .white
        valueLabel.font = UIFont.systemFont(ofSize: 18, weight: .bold)
        valueLabel.translatesAutoresizingMaskIntoConstraints = false
        field.addSubview(valueLabel)
        field.heightAnchor.constraint(equalToConstant: 40).isActive = true
        NSLayoutConstraint.activate([
            valueLabel.leadingAnchor.constraint(equalTo: field.leadingAnchor, constant: 16),
            valueLabel.trailingAnchor.constraint(equalTo: field.trailingAnchor, constant: -16),
            valueLabel.centerYAnchor.constraint(equalTo: field.centerYAnchor)
        ])
        stack.addArrangedSubview(field)
        return stack
    }

    private func messageBlock() -> UIView {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 5
        stack.addArrangedSubview(smallLabel("Message"))
        let field = UILabel()
        field.text = "Preparing update"
        field.textColor = .white
        field.font = UIFont.systemFont(ofSize: 17, weight: .bold)
        field.backgroundColor = UIColor(red: 0.06, green: 0.09, blue: 0.15, alpha: 0.92)
        field.layer.cornerRadius = 8
        field.layer.borderWidth = 1
        field.layer.borderColor = UIColor(white: 1, alpha: 0.16).cgColor
        field.clipsToBounds = true
        field.heightAnchor.constraint(equalToConstant: 42).isActive = true
        stack.addArrangedSubview(field)
        return stack
    }

    private func actionRow(_ titles: [String]) -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 8
        row.distribution = .fillEqually
        for title in titles {
            row.addArrangedSubview(button(title))
        }
        return row
    }

    private func button(_ title: String) -> UILabel {
        let label = UILabel()
        label.text = title
        label.textAlignment = .center
        label.textColor = UIColor(red: 0.03, green: 0.06, blue: 0.10, alpha: 1)
        label.font = UIFont.systemFont(ofSize: 16, weight: .bold)
        label.backgroundColor = title == "Hide" ? UIColor(red: 1.0, green: 0.31, blue: 0.80, alpha: 1) : UIColor(red: 0.44, green: 0.96, blue: 1, alpha: 1)
        label.layer.cornerRadius = 8
        label.clipsToBounds = true
        label.heightAnchor.constraint(equalToConstant: 42).isActive = true
        return label
    }

    private func badge(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.textAlignment = .center
        label.textColor = UIColor(red: 0.03, green: 0.06, blue: 0.10, alpha: 1)
        label.font = UIFont.systemFont(ofSize: 13, weight: .bold)
        label.backgroundColor = UIColor(red: 1.0, green: 0.97, blue: 0.68, alpha: 1)
        label.layer.cornerRadius = 8
        label.clipsToBounds = true
        label.widthAnchor.constraint(equalToConstant: 92).isActive = true
        label.heightAnchor.constraint(equalToConstant: 34).isActive = true
        return label
    }

    private func smallLabel(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.textColor = UIColor(red: 0.66, green: 0.72, blue: 0.80, alpha: 1)
        label.font = UIFont.systemFont(ofSize: 13, weight: .bold)
        return label
    }
}
`
  );
};

const encodeFrames = (style, frameDir) => {
  const frames = readdirSync(frameDir)
    .filter((file) => file.endsWith('.png'))
    .sort()
    .map((file) => join(frameDir, file));
  if (frames.length === 0) {
    throw new Error(`No captured frames for ${style}`);
  }

  const contentScores = frames.map((frame) =>
    Number(
      run('magick', [frame, '-gravity', 'center', '-crop', '70%x60%+0+0', '-format', '%[fx:standard_deviation]', 'info:'], {
        stdio: 'pipe',
      })
    )
  );
  const maxContentScore = Math.max(...contentScores);
  if (maxContentScore < 0.045) {
    throw new Error(`Captured ${style} frames look blank (max content score ${maxContentScore.toFixed(4)})`);
  }

  mkdirSync(previewDir, { recursive: true });
  run('magick', [
    '-delay',
    '10',
    '-loop',
    '0',
    ...frames,
    '-resize',
    '360x',
    '-quality',
    '68',
    join(previewDir, `${style}.webp`),
  ]);
};

const captureSimulatorPreviews = async (simulatorId) => {
  rmSync(frameRoot, { recursive: true, force: true });
  mkdirSync(frameRoot, { recursive: true });
  const readinessFrame = join(recordingDir, 'readiness.png');

  run('xcrun', ['simctl', 'terminate', simulatorId, bundleId], { stdio: 'ignore', allowFailure: true });
  run('xcrun', ['simctl', 'launch', simulatorId, bundleId, '--native-loader-style=siri'], { timeout: 30_000 });
  await sleep(3000);
  run('xcrun', ['simctl', 'terminate', simulatorId, bundleId], { stdio: 'ignore', allowFailure: true });
  await sleep(600);

  for (const style of styleOrder) {
    const frameDir = join(frameRoot, style);
    mkdirSync(frameDir, { recursive: true });
    run('xcrun', ['simctl', 'terminate', simulatorId, bundleId], { stdio: 'ignore', allowFailure: true });
    run('xcrun', ['simctl', 'launch', simulatorId, bundleId, `--native-loader-style=${style}`], { timeout: 30_000 });
    await sleep(firstDemoOffset * 1000);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (screenshotContentScore(simulatorId, readinessFrame) >= 0.045) break;
      await sleep(700);
      if (attempt === 7) {
        throw new Error(`Simulator screen stayed blank before capturing ${style}`);
      }
    }
    rmSync(readinessFrame, { force: true });

    for (let frame = 0; frame < framesPerDemo; frame += 1) {
      run('xcrun', [
        'simctl',
        'io',
        simulatorId,
        'screenshot',
        resolve(frameDir, `frame-${String(frame).padStart(3, '0')}.png`),
      ], { stdio: 'ignore', timeout: 30_000 });
      await sleep((secondsPerDemo * 1000 * 0.62) / framesPerDemo);
    }
  }

  run('xcrun', ['simctl', 'terminate', simulatorId, bundleId], { stdio: 'ignore', allowFailure: true });

  for (const style of styleOrder) {
    encodeFrames(style, join(frameRoot, style));
  }
};

const main = async () => {
  for (const tool of ['bun', 'bunx', 'xcrun', 'magick']) {
    if (!hasTool(tool)) {
      throw new Error(`Missing required tool: ${tool}`);
    }
  }

  mkdirSync(recordingDir, { recursive: true });
  const shouldRecreateIosProject = process.env.PREVIEW_REUSE_NATIVE_PROJECT !== '1';
  if (shouldRecreateIosProject) {
    rmSync(iosDir, { recursive: true, force: true });
  }
  const createdIosProject = !existsSync(iosDir);

  try {
    run('bun', ['run', 'build'], { cwd: repoDir });
    run('bun', ['run', 'build'], {
      cwd: exampleDir,
      env: {
        VITE_NATIVE_LOADER_RECORDING: '1',
        VITE_NATIVE_LOADER_RECORDING_DELAY_MS: String(firstDemoOffset * 1000 - 400),
        VITE_NATIVE_LOADER_DEMO_DURATION_MS: String(secondsPerDemo * 1000),
      },
    });

    if (createdIosProject) {
      run('bunx', ['cap', 'add', 'ios'], { cwd: exampleDir });
    }
    run('bunx', ['cap', 'sync', 'ios'], { cwd: exampleDir });
    stripGeneratedXcodeResources();
    writeNativePreviewApp();

    const simulatorId = pickSimulator();
    if (process.env.PREVIEW_STOP_AFTER_XCODE_BUILD === '1') {
      buildAndInstallIosApp(simulatorId);
      return;
    }

    run('xcrun', ['simctl', 'boot', simulatorId], { stdio: 'ignore', allowFailure: true });
    await waitForSimulatorBoot(simulatorId);
    buildAndInstallIosApp(simulatorId);

    await captureSimulatorPreviews(simulatorId);
    console.log(`Captured ${styleOrder.length} real iOS Simulator preview animations`);
  } finally {
    if ((createdIosProject || shouldRecreateIosProject) && process.env.PREVIEW_KEEP_NATIVE_PROJECT !== '1') {
      rmSync(iosDir, { recursive: true, force: true });
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
