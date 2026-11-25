import Capacitor
import UIKit
import WebViewNativeUIEngine

final class NativeLoaderEngineBridge {
    private weak var plugin: NativeLoaderPlugin?
    private var projection: NativeUIProjection?
    private var activeSelector: String?
    private var engineEnabledLoaderIds = Set<String>()

    init(plugin: NativeLoaderPlugin) {
        self.plugin = plugin
    }

    func registerEngineLoader(id: String, projectionSelector: String) {
        engineEnabledLoaderIds.insert(id)
        if projection != nil, activeSelector == projectionSelector {
            return
        }

        projection?.destroy()
        projection = nil
        activeSelector = nil

        guard let plugin else { return }
        do {
            projection = try NativeUIProjection(
                webView: plugin.bridge?.webView,
                plugin: plugin.jsName,
                projectionSelector: projectionSelector,
                receiveListeners: .init(
                    update: ["nativeLoaderAppearanceChanged"],
                    projection: .init(
                        native: ["nativeLoaderShown"],
                        web: ["nativeLoaderTransitionStarted"],
                        none: ["nativeLoaderHidden"]
                    )
                ),
                failedFallback: .native,
                view: { NativeLoader.shared.nativeViewEngineSurfaceView() }
            )
            activeSelector = projectionSelector
        } catch {
            CAPLog.print("Native loader engine projection unavailable: \(error)")
        }
    }

    func unregisterEngineLoader(id: String) {
        engineEnabledLoaderIds.remove(id)
        if engineEnabledLoaderIds.isEmpty {
            projection?.destroy()
            projection = nil
            activeSelector = nil
        }
    }

    func isEngineLoader(id: String) -> Bool {
        engineEnabledLoaderIds.contains(id)
    }

    func hasEngineLoaders() -> Bool {
        !engineEnabledLoaderIds.isEmpty
    }

    func notifyAppearanceChanged(loaderId: String) {
        guard isEngineLoader(id: loaderId) else { return }
        plugin?.emitEngineEvent("nativeLoaderAppearanceChanged", data: ["id": loaderId])
    }

    func notifyShown(loaderId: String) {
        guard isEngineLoader(id: loaderId) else { return }
        plugin?.emitEngineEvent("nativeLoaderShown", data: ["id": loaderId])
    }

    func notifyHidden(loaderId: String) {
        guard isEngineLoader(id: loaderId) else { return }
        plugin?.emitEngineEvent("nativeLoaderHidden", data: ["id": loaderId])
        unregisterEngineLoader(id: loaderId)
    }

    func notifyTransitionStarted(loaderId: String) {
        guard isEngineLoader(id: loaderId) else { return }
        plugin?.emitEngineEvent("nativeLoaderTransitionStarted", data: ["id": loaderId])
    }

    func receive(eventName: String, data: [String: Any]?) {
        projection?.receive(eventName, data: data)
    }

    func destroy() {
        projection?.destroy()
        projection = nil
        activeSelector = nil
        engineEnabledLoaderIds.removeAll()
    }
}