import Foundation
import SwiftUI
import UIKit
import WebKit
import Lottie

// swiftlint:disable file_length
@objc public class NativeLoader: NSObject {
    @objc public static let shared = NativeLoader()

    private var overlayWindow: NativeLoaderWindow?
    private var hostingController: UIHostingController<NativeLoaderRootView>?
    private var defaults: [String: Any] = [:]
    private var timers: [String: Timer] = [:]
    private weak var webView: UIView?
    private var originalWebViewFrame: CGRect?
    private var originalScrollInsets: UIEdgeInsets?
    private var originalScrollIndicatorInsets: UIEdgeInsets?
    private var shouldRestoreWebViewOnHide = true

    @objc public func getPluginVersion() -> String {
        return "native"
    }

    public func configure(defaults: [String: Any]) {
        onMain {
            self.defaults.merge(defaults) { _, new in new }
        }
    }

    @discardableResult
    public func show(options: [String: Any] = [:], webView: UIView? = nil) -> String {
        return onMainSync {
            let merged = self.defaults.merging(options) { _, new in new }
            let item = NativeLoaderItem(options: merged)
            self.webView = webView ?? self.webView

            if let webViewOptions = merged["webView"] as? [String: Any] {
                self.shouldRestoreWebViewOnHide = bool(webViewOptions["restoreOnHide"]) ?? true
                self.setWebViewLayout(options: webViewOptions, webView: self.webView)
            }

            let window = self.ensureOverlayWindow()
            var nextItems = window.items.filter { $0.id != item.id }
            nextItems.append(item)
            window.items = nextItems
            window.blocksTouches = nextItems.contains { $0.interactionMode == .block }
            window.loaderOnlyTouches = nextItems.contains { $0.interactionMode == .loaderOnly }
            window.isHidden = false
            window.makeKey()

            self.scheduleAutoHide(for: item)

            if let label = item.accessibilityLabel, !label.isEmpty {
                UIAccessibility.post(notification: .announcement, argument: label)
            }

            return item.id
        }
    }

    public func update(options: [String: Any]) {
        onMain {
            guard let id = options["id"] as? String else { return }
            guard let window = self.overlayWindow else { return }
            guard let index = window.items.firstIndex(where: { $0.id == id }) else { return }

            let current = window.items[index]
            let item = NativeLoaderItem(options: current.rawOptions.merging(options) { _, new in new })
            var nextItems = window.items
            nextItems[index] = item
            window.items = nextItems
            window.blocksTouches = nextItems.contains { $0.interactionMode == .block }
            window.loaderOnlyTouches = nextItems.contains { $0.interactionMode == .loaderOnly }

            self.scheduleAutoHide(for: item)
        }
    }

    public func setProgress(id: String?, progress: Double) {
        onMain {
            guard let window = self.overlayWindow else { return }
            let targetId = id ?? window.items.last?.id
            guard let targetId, let index = window.items.firstIndex(where: { $0.id == targetId }) else { return }

            var options = window.items[index].rawOptions
            options["progress"] = max(0, min(1, progress))
            var nextItems = window.items
            nextItems[index] = NativeLoaderItem(options: options)
            window.items = nextItems
        }
    }

    public func hide(id: String? = nil, animated: Bool = true, restoreWebView: Bool = true) {
        onMain {
            guard let window = self.overlayWindow else { return }
            let targetId = id ?? window.items.last?.id
            guard let targetId else { return }

            self.timers[targetId]?.invalidate()
            self.timers[targetId] = nil

            let remove = {
                window.items.removeAll { $0.id == targetId }
                window.blocksTouches = window.items.contains { $0.interactionMode == .block }
                window.loaderOnlyTouches = window.items.contains { $0.interactionMode == .loaderOnly }
                if window.items.isEmpty {
                    window.resignKey()
                    window.isHidden = true
                    self.restoreKeyWindow()
                    if restoreWebView && self.shouldRestoreWebViewOnHide {
                        self.resetWebViewLayout(animated: animated)
                    }
                }
            }

            if animated {
                window.leavingIds.insert(targetId)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: remove)
            } else {
                remove()
            }
        }
    }

    public func hideAll(animated: Bool = true, restoreWebView: Bool = true) {
        onMain {
            guard let window = self.overlayWindow else { return }
            self.timers.values.forEach { $0.invalidate() }
            self.timers.removeAll()

            let remove = {
                window.items.removeAll()
                window.leavingIds.removeAll()
                window.blocksTouches = false
                window.loaderOnlyTouches = false
                window.resignKey()
                window.isHidden = true
                self.restoreKeyWindow()
                if restoreWebView && self.shouldRestoreWebViewOnHide {
                    self.resetWebViewLayout(animated: animated)
                }
            }

            if animated {
                window.leavingIds = Set(window.items.map(\.id))
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: remove)
            } else {
                remove()
            }
        }
    }

    public func getState() -> (Bool, [String]) {
        return onMainSync {
            let ids = self.overlayWindow?.items.map(\.id) ?? []
            return (!ids.isEmpty, ids)
        }
    }

    public func setWebViewLayout(options: [String: Any], webView: UIView? = nil) {
        onMain {
            let target = webView ?? self.webView
            guard let target else { return }
            self.webView = target

            let mode = (options["mode"] as? String) ?? "none"
            guard mode != "none" else { return }

            if self.originalWebViewFrame == nil {
                self.originalWebViewFrame = target.frame
            }

            let animated = bool(options["animated"]) ?? true
            let applyFrame = {
                if let frameOptions = options["frame"] as? [String: Any] {
                    target.frame = loaderFrame(from: frameOptions) ?? target.frame
                } else if mode == "resize", let superview = target.superview {
                    let insets = insets(from: options["insets"] as? [String: Any])
                    target.frame = superview.bounds.inset(by: insets)
                }

                if mode == "inset", let scrollView = (target as? WKWebView)?.scrollView {
                    if self.originalScrollInsets == nil {
                        self.originalScrollInsets = scrollView.contentInset
                        self.originalScrollIndicatorInsets = scrollView.scrollIndicatorInsets
                    }
                    let inset = insets(from: options["insets"] as? [String: Any])
                    scrollView.contentInset = inset
                    scrollView.scrollIndicatorInsets = inset
                }
            }

            if animated {
                UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseOut, .allowUserInteraction], animations: applyFrame)
            } else {
                applyFrame()
            }
        }
    }

    public func resetWebViewLayout(animated: Bool = true) {
        onMain {
            guard let target = self.webView else { return }
            let applyFrame = {
                if let original = self.originalWebViewFrame {
                    target.frame = original
                }
                if let scrollView = (target as? WKWebView)?.scrollView {
                    if let contentInset = self.originalScrollInsets {
                        scrollView.contentInset = contentInset
                    }
                    if let indicatorInsets = self.originalScrollIndicatorInsets {
                        scrollView.scrollIndicatorInsets = indicatorInsets
                    }
                }
            }

            if animated {
                UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseOut, .allowUserInteraction], animations: applyFrame)
            } else {
                applyFrame()
            }

            self.originalWebViewFrame = nil
            self.originalScrollInsets = nil
            self.originalScrollIndicatorInsets = nil
        }
    }

    private func ensureOverlayWindow() -> NativeLoaderWindow {
        if let overlayWindow {
            return overlayWindow
        }

        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }) else {
            let fallback = NativeLoaderWindow(frame: UIScreen.main.bounds)
            overlayWindow = fallback
            return fallback
        }

        let window = NativeLoaderWindow(windowScene: scene)
        window.windowLevel = .alert + 2
        window.backgroundColor = .clear
        window.isHidden = true
        window.tag = 1017

        let hosting = UIHostingController(rootView: NativeLoaderRootView(window: window))
        hosting.view.backgroundColor = .clear
        window.rootViewController = hosting

        overlayWindow = window
        hostingController = hosting
        return window
    }

    private func scheduleAutoHide(for item: NativeLoaderItem) {
        timers[item.id]?.invalidate()
        timers[item.id] = nil

        guard let autoHide = item.autoHide, autoHide > 0 else { return }
        let timer = Timer(timeInterval: autoHide / 1000, repeats: false) { [weak self] _ in
            self?.hide(id: item.id)
        }
        RunLoop.main.add(timer, forMode: .common)
        timers[item.id] = timer
    }

    private func restoreKeyWindow() {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.tag != 1017 && !$0.isHidden }?
            .makeKey()
    }

    private func onMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }

    private func onMainSync<T>(_ work: () -> T) -> T {
        if Thread.isMainThread {
            return work()
        }

        var result: T?
        DispatchQueue.main.sync {
            result = work()
        }
        guard let result else {
            fatalError("NativeLoader main-thread sync returned no result")
        }
        return result
    }
}

final class NativeLoaderWindow: UIWindow, ObservableObject {
    @Published var items: [NativeLoaderItem] = []
    @Published var leavingIds: Set<String> = []
    @Published var blocksTouches = false
    @Published var loaderOnlyTouches = false
    @Published var hitFrames: [String: CGRect] = [:]

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard !items.isEmpty else { return false }
        if blocksTouches {
            return true
        }
        if loaderOnlyTouches {
            return hitFrames.values.contains { $0.insetBy(dx: -8, dy: -8).contains(point) }
        }
        return false
    }
}

struct NativeLoaderItem: Identifiable {
    let rawOptions: [String: Any]
    let id: String
    let style: LoaderStyle
    let placement: LoaderPlacement
    let interactionMode: LoaderInteractionMode
    let reducedMotion: LoaderReducedMotionMode
    let frame: CGRect?
    let message: String
    let size: CGFloat
    let thickness: CGFloat
    let duration: Double
    let speed: Double
    let progress: Double?
    let colors: [Color]
    let uiColors: [UIColor]
    let backgroundColor: Color?
    let scrimColor: Color?
    let cornerRadius: CGFloat
    let blurRadius: CGFloat
    let autoHide: Double?
    let accessibilityLabel: String?
    let asset: LoaderAsset?

    init(options: [String: Any]) {
        rawOptions = options
        id = options["id"] as? String ?? "loader-\(UUID().uuidString)"
        style = LoaderStyle(rawValue: (options["style"] as? String) ?? "siri") ?? .siri
        placement = LoaderPlacement(rawValue: (options["placement"] as? String) ?? "center") ?? .center
        let defaultInteractionMode = (options["scrimColor"] as? String) == nil ? "passThrough" : "block"
        interactionMode = LoaderInteractionMode(
            rawValue: (options["interactionMode"] as? String) ?? defaultInteractionMode
        ) ?? .passThrough
        reducedMotion = LoaderReducedMotionMode(rawValue: (options["reducedMotion"] as? String) ?? "system") ?? .system
        frame = loaderFrame(from: options["frame"] as? [String: Any])
        message = options["message"] as? String ?? ""
        size = CGFloat(number(options["size"]) ?? 96)
        thickness = CGFloat(number(options["thickness"]) ?? 5)
        duration = number(options["duration"]) ?? defaultDuration(for: style)
        speed = max(0.1, number(options["speed"]) ?? 1)
        progress = number(options["progress"]).map { max(0, min(1, $0)) }
        uiColors = parseColors(options["colors"] as? [String])
        colors = uiColors.map { Color($0) }
        backgroundColor = color(options["backgroundColor"]).map { Color($0) }
        scrimColor = color(options["scrimColor"]).map { Color($0) }
        cornerRadius = CGFloat(number(options["cornerRadius"]) ?? 24)
        blurRadius = CGFloat(number(options["blurRadius"]) ?? 0)
        autoHide = number(options["autoHide"])
        accessibilityLabel = options["accessibilityLabel"] as? String
        asset = LoaderAsset(options: options["asset"] as? [String: Any], fallbackType: style == .image ? .image : .lottie)
    }
}

enum LoaderStyle: String {
    case siri
    case orbit
    case ring
    case pulse
    case dots
    case bars
    case wave
    case halo
    case lottie
    case image
}

enum LoaderPlacement: String {
    case center
    case top
    case bottom
    case left
    case right
    case fullscreen
    case around
    case custom
}

enum LoaderInteractionMode: String {
    case passThrough
    case block
    case loaderOnly
}

enum LoaderReducedMotionMode: String {
    case system
    case pause
    case slow
    case ignore
}

enum LoaderAssetType: String {
    case lottie
    case image
}

struct LoaderAsset {
    let source: String
    let type: LoaderAssetType
    let loop: Bool
    let speed: Double
    let autoPlay: Bool

    init?(options: [String: Any]?, fallbackType: LoaderAssetType) {
        guard let options, let source = options["source"] as? String, !source.isEmpty else { return nil }
        self.source = source
        type = LoaderAssetType(rawValue: (options["type"] as? String) ?? fallbackType.rawValue) ?? fallbackType
        loop = bool(options["loop"]) ?? true
        speed = number(options["speed"]) ?? 1
        autoPlay = bool(options["autoPlay"]) ?? true
    }
}

struct NativeLoaderRootView: View {
    @ObservedObject var window: NativeLoaderWindow

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                if let scrim = window.items.last?.scrimColor {
                    scrim.ignoresSafeArea()
                }

                ForEach(window.items) { item in
                    itemView(item, geometry: geometry)
                        .opacity(window.leavingIds.contains(item.id) ? 0 : 1)
                        .scaleEffect(window.leavingIds.contains(item.id) ? 0.98 : 1)
                        .animation(.easeOut(duration: 0.18), value: window.leavingIds)
                }
            }
            .coordinateSpace(name: "NativeLoaderWindow")
            .onPreferenceChange(LoaderFramePreferenceKey.self) { frames in
                window.hitFrames = frames
            }
        }
    }

    @ViewBuilder
    private func itemView(_ item: NativeLoaderItem, geometry: GeometryProxy) -> some View {
        if item.placement == .around {
            AroundLoaderView(item: item)
                .frame(width: geometry.size.width, height: geometry.size.height)
                .ignoresSafeArea()
        } else {
            LoaderCardView(item: item)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment(for: item.placement))
                .padding(padding(for: item.placement, safeArea: geometry.safeAreaInsets))
        }
    }

    private func alignment(for placement: LoaderPlacement) -> Alignment {
        switch placement {
        case .top:
            return .top
        case .bottom:
            return .bottom
        case .left:
            return .leading
        case .right:
            return .trailing
        case .custom:
            return .topLeading
        default:
            return .center
        }
    }

    private func padding(for placement: LoaderPlacement, safeArea: EdgeInsets) -> EdgeInsets {
        switch placement {
        case .top:
            return EdgeInsets(top: max(safeArea.top, 16), leading: 16, bottom: 16, trailing: 16)
        case .bottom:
            return EdgeInsets(top: 16, leading: 16, bottom: max(safeArea.bottom, 16), trailing: 16)
        case .left:
            return EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16)
        case .right:
            return EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16)
        default:
            return EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16)
        }
    }
}

struct LoaderCardView: View {
    let item: NativeLoaderItem

    var body: some View {
        VStack(spacing: item.message.isEmpty ? 0 : 12) {
            LoaderGraphicView(item: item)
                .frame(width: item.size, height: item.size)

            if !item.message.isEmpty {
                Text(item.message)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .frame(
            width: item.placement == .custom ? item.frame?.width : nil,
            height: item.placement == .custom ? item.frame?.height : nil
        )
        .background(cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: item.cornerRadius, style: .continuous))
        .shadow(color: .black.opacity(0.22), radius: 28, x: 0, y: 14)
        .blur(radius: item.blurRadius)
        .offset(x: item.placement == .custom ? (item.frame?.minX ?? 0) : 0, y: item.placement == .custom ? (item.frame?.minY ?? 0) : 0)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(item.accessibilityLabel ?? item.message.ifEmpty("Loading"))
        .background(
            GeometryReader { geo in
                Color.clear.preference(
                    key: LoaderFramePreferenceKey.self,
                    value: [item.id: geo.frame(in: .named("NativeLoaderWindow"))]
                )
            }
        )
    }

    private var cardBackground: some View {
        ZStack {
            (item.backgroundColor ?? Color.black.opacity(0.68))
            RoundedRectangle(cornerRadius: item.cornerRadius, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        }
    }
}

struct AroundLoaderView: View {
    let item: NativeLoaderItem
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation) { context in
            let time = animationTime(context.date, item: item, reduceMotion: reduceMotion)
            let rotation = Angle.degrees(time * 140)
            ZStack {
                Rectangle()
                    .strokeBorder(Color.white.opacity(0.05), lineWidth: item.thickness)
                Rectangle()
                    .trim(from: 0, to: 0.36)
                    .stroke(
                        AngularGradient(colors: item.colors, center: .center),
                        style: StrokeStyle(lineWidth: item.thickness, lineCap: .round, lineJoin: .round)
                    )
                    .rotationEffect(rotation)
                    .padding(item.thickness / 2)

                if !item.message.isEmpty {
                    Text(item.message)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.black.opacity(0.58), in: Capsule())
                }
            }
        }
        .accessibilityLabel(item.accessibilityLabel ?? item.message.ifEmpty("Loading"))
    }
}

struct LoaderGraphicView: View {
    let item: NativeLoaderItem
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        switch item.style {
        case .lottie:
            if let asset = item.asset {
                NativeLottieView(asset: asset)
            } else {
                RingLoader(item: item, reduceMotion: reduceMotion)
            }
        case .image:
            if let asset = item.asset {
                NativeImageLoaderView(asset: asset)
            } else {
                HaloLoader(item: item, reduceMotion: reduceMotion)
            }
        case .siri:
            SiriLoader(item: item, reduceMotion: reduceMotion)
        case .orbit:
            OrbitLoader(item: item, reduceMotion: reduceMotion)
        case .ring:
            RingLoader(item: item, reduceMotion: reduceMotion)
        case .pulse:
            PulseLoader(item: item, reduceMotion: reduceMotion)
        case .dots:
            DotsLoader(item: item, reduceMotion: reduceMotion)
        case .bars:
            BarsLoader(item: item, reduceMotion: reduceMotion)
        case .wave:
            WaveLoader(item: item, reduceMotion: reduceMotion)
        case .halo:
            HaloLoader(item: item, reduceMotion: reduceMotion)
        }
    }
}

struct SiriLoader: View {
    let item: NativeLoaderItem
    let reduceMotion: Bool

    var body: some View {
        TimelineView(.animation) { context in
            let time = animationTime(context.date, item: item, reduceMotion: reduceMotion)
            ZStack {
                ForEach(0..<4, id: \.self) { index in
                    let angle = time * 1.8 + Double(index) * .pi / 2
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    item.colors[index % item.colors.count],
                                    item.colors[(index + 1) % item.colors.count].opacity(0.35),
                                    .clear
                                ],
                                center: .center,
                                startRadius: 1,
                                endRadius: item.size * 0.42
                            )
                        )
                        .frame(width: item.size * 0.74, height: item.size * 0.74)
                        .blur(radius: item.size * 0.05)
                        .scaleEffect(0.76 + 0.2 * sin(angle + Double(index)))
                        .offset(
                            x: cos(angle) * item.size * 0.11,
                            y: sin(angle * 1.1) * item.size * 0.11
                        )
                        .blendMode(.screen)
                }
                Circle()
                    .stroke(Color.white.opacity(0.18), lineWidth: 1)
                    .frame(width: item.size * 0.78, height: item.size * 0.78)
            }
        }
    }
}

struct OrbitLoader: View {
    let item: NativeLoaderItem
    let reduceMotion: Bool

    var body: some View {
        TimelineView(.animation) { context in
            let time = animationTime(context.date, item: item, reduceMotion: reduceMotion)
            ZStack {
                Circle()
                    .stroke(item.colors[0].opacity(0.16), lineWidth: item.thickness)
                    .frame(width: item.size * 0.72, height: item.size * 0.72)

                ForEach(0..<6, id: \.self) { index in
                    let angle = time * 2.4 + Double(index) * .pi / 3
                    let color = item.colors[index % item.colors.count]
                    let dotSize = item.size * 0.12
                    let xOffset = CGFloat(cos(angle)) * item.size * 0.36
                    let yOffset = CGFloat(sin(angle)) * item.size * 0.36
                    let opacity = 0.35 + 0.65 * Double(index + 1) / 6
                    Circle()
                        .fill(color)
                        .frame(width: dotSize, height: dotSize)
                        .offset(x: xOffset, y: yOffset)
                        .opacity(opacity)
                }
            }
        }
    }
}

struct RingLoader: View {
    let item: NativeLoaderItem
    let reduceMotion: Bool

    var body: some View {
        TimelineView(.animation) { context in
            let time = animationTime(context.date, item: item, reduceMotion: reduceMotion)
            ZStack {
                Circle()
                    .stroke(item.colors[0].opacity(0.14), lineWidth: item.thickness)
                Circle()
                    .trim(from: 0, to: CGFloat(item.progress ?? 0.72))
                    .stroke(
                        AngularGradient(colors: item.colors, center: .center),
                        style: StrokeStyle(lineWidth: item.thickness, lineCap: .round)
                    )
                    .rotationEffect(.degrees(item.progress == nil ? time * 180 : -90))
            }
            .padding(item.thickness)
        }
    }
}

struct PulseLoader: View {
    let item: NativeLoaderItem
    let reduceMotion: Bool

    var body: some View {
        TimelineView(.animation) { context in
            let time = animationTime(context.date, item: item, reduceMotion: reduceMotion)
            ZStack {
                ForEach(0..<4, id: \.self) { index in
                    let phase = (time / 1.35 + Double(index) * 0.18).truncatingRemainder(dividingBy: 1)
                    Circle()
                        .stroke(item.colors[index % item.colors.count], lineWidth: item.thickness)
                        .scaleEffect(0.18 + phase * 1.15)
                        .opacity(1 - phase)
                }
            }
            .padding(item.thickness * 2)
        }
    }
}

struct DotsLoader: View {
    let item: NativeLoaderItem
    let reduceMotion: Bool

    var body: some View {
        TimelineView(.animation) { context in
            let time = animationTime(context.date, item: item, reduceMotion: reduceMotion)
            HStack(spacing: item.size * 0.08) {
                ForEach(0..<3, id: \.self) { index in
                    let signal = sin(time * 4 + Double(index) * 0.8)
                    let yOffset = CGFloat(signal) * item.size * 0.12
                    let dotSize = item.size * 0.18
                    let opacity = 0.55 + 0.45 * (signal + 1) / 2
                    let color = item.colors[index % item.colors.count]
                    Circle()
                        .fill(color)
                        .frame(width: dotSize, height: dotSize)
                        .offset(y: yOffset)
                        .opacity(opacity)
                }
            }
        }
    }
}

struct BarsLoader: View {
    let item: NativeLoaderItem
    let reduceMotion: Bool

    var body: some View {
        TimelineView(.animation) { context in
            let time = animationTime(context.date, item: item, reduceMotion: reduceMotion)
            HStack(alignment: .center, spacing: item.size * 0.055) {
                ForEach(0..<5, id: \.self) { index in
                    let scale = 0.35 + 0.65 * (sin(time * 4.2 + Double(index) * 0.72) + 1) / 2
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [item.colors[index % item.colors.count], item.colors[(index + 1) % item.colors.count]],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: item.size * 0.095, height: item.size * 0.62 * scale)
                }
            }
        }
    }
}

struct WaveLoader: View {
    let item: NativeLoaderItem
    let reduceMotion: Bool

    var body: some View {
        TimelineView(.animation) { context in
            let time = animationTime(context.date, item: item, reduceMotion: reduceMotion)
            Canvas { canvas, size in
                var path = Path()
                let midY = size.height / 2
                for xValue in stride(from: 0, through: size.width, by: 2) {
                    let progress = xValue / size.width
                    let yValue = midY + sin(progress * .pi * 2 + time * 3.2) * size.height * 0.18
                    if xValue == 0 {
                        path.move(to: CGPoint(x: xValue, y: yValue))
                    } else {
                        path.addLine(to: CGPoint(x: xValue, y: yValue))
                    }
                }
                canvas.stroke(path, with: .linearGradient(
                    Gradient(colors: item.colors),
                    startPoint: CGPoint(x: 0, y: midY),
                    endPoint: CGPoint(x: size.width, y: midY)
                ), style: StrokeStyle(lineWidth: item.thickness, lineCap: .round))
            }
        }
    }
}

struct HaloLoader: View {
    let item: NativeLoaderItem
    let reduceMotion: Bool

    var body: some View {
        TimelineView(.animation) { context in
            let time = animationTime(context.date, item: item, reduceMotion: reduceMotion)
            ZStack {
                Circle()
                    .fill(AngularGradient(colors: item.colors, center: .center))
                    .blur(radius: item.size * 0.08)
                    .rotationEffect(.degrees(time * 120))
                    .opacity(0.9)
                Circle()
                    .fill(Color.black.opacity(0.46))
                    .padding(item.thickness * 2.5)
                Circle()
                    .stroke(Color.white.opacity(0.16), lineWidth: 1)
                    .padding(item.thickness)
            }
        }
    }
}

struct NativeLottieView: UIViewRepresentable {
    let asset: LoaderAsset

    func makeUIView(context: Context) -> LottieAnimationView {
        let view = LottieAnimationView()
        view.backgroundColor = .clear
        view.contentMode = .scaleAspectFit
        view.loopMode = asset.loop ? .loop : .playOnce
        view.animationSpeed = CGFloat(asset.speed)
        load(asset: asset, into: view)
        return view
    }

    func updateUIView(_ view: LottieAnimationView, context: Context) {
        view.loopMode = asset.loop ? .loop : .playOnce
        view.animationSpeed = CGFloat(asset.speed)
        if asset.autoPlay && !view.isAnimationPlaying {
            view.play()
        } else if !asset.autoPlay {
            view.pause()
        }
    }

    private func load(asset: LoaderAsset, into view: LottieAnimationView) {
        let source = asset.source
        if source.hasPrefix("data:"), let data = dataFromDataUrl(source) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("native-loader-\(UUID().uuidString).json")
            try? data.write(to: url)
            view.animation = LottieAnimation.filepath(url.path)
            if asset.autoPlay { view.play() }
            return
        }

        if let url = URL(string: source), url.scheme == "http" || url.scheme == "https" {
            LottieAnimation.loadedFrom(url: url, closure: { animation in
                view.animation = animation
                if asset.autoPlay {
                    view.play()
                }
            })
            return
        }

        if let url = URL(string: source), url.isFileURL {
            view.animation = LottieAnimation.filepath(url.path)
        } else if FileManager.default.fileExists(atPath: source) {
            view.animation = LottieAnimation.filepath(source)
        } else {
            let name = (source as NSString).deletingPathExtension
            view.animation = LottieAnimation.named(name)
        }

        if asset.autoPlay {
            view.play()
        }
    }
}

struct NativeImageLoaderView: UIViewRepresentable {
    let asset: LoaderAsset

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView()
        view.backgroundColor = .clear
        view.contentMode = .scaleAspectFit
        view.image = image(from: asset.source)
        return view
    }

    func updateUIView(_ view: UIImageView, context: Context) {
        if view.image == nil {
            view.image = image(from: asset.source)
        }
    }

    private func image(from source: String) -> UIImage? {
        if source.hasPrefix("data:"), let data = dataFromDataUrl(source) {
            return UIImage(data: data)
        }
        if let url = URL(string: source), url.isFileURL {
            return UIImage(contentsOfFile: url.path)
        }
        if FileManager.default.fileExists(atPath: source) {
            return UIImage(contentsOfFile: source)
        }
        return UIImage(named: source)
    }
}

struct LoaderFramePreferenceKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]

    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue()) { _, new in new }
    }
}

private func animationTime(_ date: Date, item: NativeLoaderItem, reduceMotion: Bool) -> Double {
    if item.reducedMotion == .pause || (reduceMotion && item.reducedMotion == .system) {
        return 0
    }
    let speed = reduceMotion && item.reducedMotion == .slow ? max(0.1, item.speed * 0.35) : item.speed
    return date.timeIntervalSinceReferenceDate * speed * (1000 / item.duration)
}

private func defaultDuration(for style: LoaderStyle) -> Double {
    switch style {
    case .siri:
        return 1500
    case .pulse:
        return 1350
    case .dots, .bars:
        return 780
    default:
        return 1100
    }
}

private func parseColors(_ values: [String]?) -> [UIColor] {
    let parsed = values?.compactMap { color($0) } ?? []
    if parsed.isEmpty {
        return [
            UIColor(red: 0.44, green: 0.96, blue: 1.0, alpha: 1),
            UIColor(red: 0.55, green: 0.36, blue: 0.96, alpha: 1),
            UIColor(red: 1.0, green: 0.31, blue: 0.80, alpha: 1),
            UIColor(red: 1.0, green: 0.97, blue: 0.68, alpha: 1)
        ]
    }
    return parsed
}

private func color(_ value: Any?) -> UIColor? {
    guard let string = value as? String else { return nil }
    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasPrefix("#") {
        return hexColor(trimmed)
    }
    if trimmed.lowercased().hasPrefix("rgba(") {
        return rgbaColor(trimmed)
    }
    if trimmed.lowercased().hasPrefix("rgb(") {
        return rgbColor(trimmed)
    }
    return nil
}

private func hexColor(_ value: String) -> UIColor? {
    let hex = String(value.dropFirst())
    let expanded: String
    switch hex.count {
    case 3:
        expanded = hex.map { "\($0)\($0)" }.joined() + "ff"
    case 4:
        expanded = hex.map { "\($0)\($0)" }.joined()
    case 6:
        expanded = hex + "ff"
    case 8:
        expanded = hex
    default:
        return nil
    }

    guard let raw = UInt64(expanded, radix: 16) else { return nil }
    let red = CGFloat((raw & 0xff000000) >> 24) / 255
    let green = CGFloat((raw & 0x00ff0000) >> 16) / 255
    let blue = CGFloat((raw & 0x0000ff00) >> 8) / 255
    let alpha = CGFloat(raw & 0x000000ff) / 255
    return UIColor(red: red, green: green, blue: blue, alpha: alpha)
}

private func rgbColor(_ value: String) -> UIColor? {
    let parts = value
        .replacingOccurrences(of: "rgb(", with: "")
        .replacingOccurrences(of: ")", with: "")
        .split(separator: ",")
        .compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard parts.count == 3 else { return nil }
    return UIColor(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: 1)
}

private func rgbaColor(_ value: String) -> UIColor? {
    let parts = value
        .replacingOccurrences(of: "rgba(", with: "")
        .replacingOccurrences(of: ")", with: "")
        .split(separator: ",")
        .compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard parts.count == 4 else { return nil }
    return UIColor(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: parts[3])
}

private func insets(from options: [String: Any]?) -> UIEdgeInsets {
    guard let options else { return .zero }
    return UIEdgeInsets(
        top: CGFloat(number(options["top"]) ?? 0),
        left: CGFloat(number(options["left"]) ?? 0),
        bottom: CGFloat(number(options["bottom"]) ?? 0),
        right: CGFloat(number(options["right"]) ?? 0)
    )
}

private func loaderFrame(from options: [String: Any]?) -> CGRect? {
    guard let options,
          let xValue = number(options["x"]),
          let yValue = number(options["y"]),
          let widthValue = number(options["width"]),
          let heightValue = number(options["height"]) else { return nil }
    return CGRect(x: xValue, y: yValue, width: widthValue, height: heightValue)
}

private func number(_ value: Any?) -> Double? {
    if let number = value as? NSNumber {
        return number.doubleValue
    }
    return value as? Double
}

private func bool(_ value: Any?) -> Bool? {
    if let value = value as? Bool {
        return value
    }
    return (value as? NSNumber)?.boolValue
}

private func dataFromDataUrl(_ source: String) -> Data? {
    guard let comma = source.firstIndex(of: ",") else { return nil }
    let payload = String(source[source.index(after: comma)...])
    return Data(base64Encoded: payload)
}

private extension String {
    func ifEmpty(_ fallback: String) -> String {
        isEmpty ? fallback : self
    }
}
// swiftlint:enable file_length
