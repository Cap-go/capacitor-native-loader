import Foundation
import Capacitor

@objc(NativeLoaderPlugin)
public class NativeLoaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeLoaderPlugin"
    public let jsName = "NativeLoader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setProgress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWebViewLayout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resetWebViewLayout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPluginVersion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNativeViewEnginePresentation", returnType: CAPPluginReturnPromise)
    ]

    private let implementation = NativeLoader.shared
    private lazy var engineBridge = NativeLoaderEngineBridge(plugin: self)

    public override func load() {
        implementation.onLoaderHidden = { [weak self] id in
            self?.engineBridge.notifyHidden(loaderId: id)
        }
    }

    @objc func configure(_ call: CAPPluginCall) {
        let defaults = call.getObject("defaults") ?? [:]
        implementation.configure(defaults: defaults)
        call.resolve()
    }

    @objc func show(_ call: CAPPluginCall) {
        let options = stringOptions(call.options)
        let merged = implementation.mergedShowOptions(options)
        let engineConfig = nativeViewEngineConfig(from: merged)
        let id = implementation.show(options: options, webView: bridge?.webView)
        if engineConfig.enabled {
            engineBridge.registerEngineLoader(id: id, projectionSelector: engineConfig.projectionSelector)
            engineBridge.notifyShown(loaderId: id)
        } else if engineBridge.isEngineLoader(id: id) {
            engineBridge.unregisterEngineLoader(id: id)
        }
        call.resolve(["id": id])
    }

    @objc func update(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing required parameter: id")
            return
        }
        let options = stringOptions(call.options)
        let currentOptions = implementation.rawOptionsForLoader(id: id) ?? [:]
        let merged = implementation.mergedShowOptions(currentOptions.merging(options) { _, new in new })
        let engineConfig = nativeViewEngineConfig(from: merged)
        let isVisible = implementation.getState().1.contains(id)

        if options.keys.contains("useNativeViewEngine") {
            let wasEngine = engineBridge.isEngineLoader(id: id)
            if engineConfig.enabled, isVisible {
                engineBridge.registerEngineLoader(id: id, projectionSelector: engineConfig.projectionSelector)
                if !wasEngine {
                    engineBridge.notifyShown(loaderId: id)
                }
            } else if options["useNativeViewEngine"] as? Bool == false {
                engineBridge.unregisterEngineLoader(id: id)
            }
        }

        implementation.update(options: options)
        if engineBridge.isEngineLoader(id: id), isVisible {
            engineBridge.notifyAppearanceChanged(loaderId: id)
        }
        call.resolve()
    }

    @objc func setProgress(_ call: CAPPluginCall) {
        guard let progress = call.getDouble("progress") else {
            call.reject("Missing required parameter: progress")
            return
        }
        let id = call.getString("id")
        implementation.setProgress(id: id, progress: progress)
        let targetId = id ?? implementation.getState().1.last
        if let targetId, engineBridge.isEngineLoader(id: targetId) {
            engineBridge.notifyAppearanceChanged(loaderId: targetId)
        }
        call.resolve()
    }

    @objc func hide(_ call: CAPPluginCall) {
        implementation.hide(
            id: call.getString("id"),
            animated: call.getBool("animated") ?? true,
            restoreWebView: call.getBool("restoreWebView") ?? true
        )
        call.resolve()
    }

    @objc func hideAll(_ call: CAPPluginCall) {
        implementation.hideAll(
            animated: call.getBool("animated") ?? true,
            restoreWebView: call.getBool("restoreWebView") ?? true
        )
        call.resolve()
    }

    @objc func setWebViewLayout(_ call: CAPPluginCall) {
        implementation.setWebViewLayout(options: stringOptions(call.options), webView: bridge?.webView)
        call.resolve()
    }

    @objc func resetWebViewLayout(_ call: CAPPluginCall) {
        implementation.resetWebViewLayout(animated: call.getBool("animated") ?? true)
        call.resolve()
    }

    @objc func getState(_ call: CAPPluginCall) {
        let state = implementation.getState()
        call.resolve([
            "showing": state.0,
            "ids": state.1
        ])
    }

    @objc func getPluginVersion(_ call: CAPPluginCall) {
        call.resolve([
            "version": implementation.getPluginVersion()
        ])
    }

    @objc func setNativeViewEnginePresentation(_ call: CAPPluginCall) {
        guard let presentation = call.getString("presentation"), presentation == "native" || presentation == "web" else {
            call.reject("Missing or invalid presentation")
            return
        }
        let engineIds = stateIds().filter { engineBridge.isEngineLoader(id: $0) }
        let id = call.getString("id") ?? engineIds.last
        guard let id, engineBridge.isEngineLoader(id: id) else {
            call.resolve()
            return
        }
        switch presentation {
        case "web":
            engineBridge.notifyTransitionStarted(loaderId: id)
        case "native":
            engineBridge.notifyShown(loaderId: id)
        default:
            break
        }
        call.resolve()
    }

    func emitEngineEvent(_ eventName: String, data: [String: Any]) {
        notifyListeners(eventName, data: data, retainUntilConsumed: false)
    }

    public override func notifyListeners(_ eventName: String, data: [String: Any]?, retainUntilConsumed: Bool) {
        if engineBridge.hasEngineLoaders() {
            engineBridge.receive(eventName: eventName, data: data)
        }
        super.notifyListeners(eventName, data: data, retainUntilConsumed: retainUntilConsumed)
    }

    deinit {
        engineBridge.destroy()
    }

    private func stateIds() -> [String] {
        implementation.getState().1
    }
}

private let defaultNativeViewEngineSelector = "#native-loader-engine-slot"

private func nativeViewEngineConfig(from options: [String: Any]) -> (enabled: Bool, projectionSelector: String) {
    let enabled = (options["useNativeViewEngine"] as? Bool) ?? (options["useNativeViewEngine"] as? NSNumber)?.boolValue ?? false
    let custom = (options["nativeViewEngineProjectionSelector"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let selector = (custom?.isEmpty == false) ? custom! : defaultNativeViewEngineSelector
    return (enabled, selector)
}

private func stringOptions(_ options: [AnyHashable: Any]) -> [String: Any] {
    return options.reduce(into: [String: Any]()) { result, entry in
        guard let key = entry.key as? String else { return }
        result[key] = entry.value
    }
}