package app.capgo.nativeloader

import android.util.Log
import com.getcapacitor.JSObject
import io.github.webview_native_ui.engine.NativeUIProjection

internal class NativeLoaderEngineBridge(private val plugin: NativeLoaderPlugin) {
    private var projection: NativeUIProjection? = null
    private var activeSelector: String? = null
    private var engineChannelInstalled = false
    private val engineEnabledLoaderIds = mutableSetOf<String>()

    fun registerEngineLoader(id: String, projectionSelector: String) {
        if (projection != null && activeSelector == projectionSelector) {
            engineEnabledLoaderIds.add(id)
            return
        }
        engineEnabledLoaderIds.add(id)

        projection?.close()
        projection = null
        activeSelector = null

        val activity = plugin.activity ?: return
        val webView = plugin.bridge?.webView ?: return

        projection = runCatching {
            if (!engineChannelInstalled) {
                NativeUIProjection.install(webView)
                engineChannelInstalled = true
            }
            NativeUIProjection(
                window = activity.window,
                webView = webView,
                plugin = plugin.pluginHandle.id,
                projectionSelector = projectionSelector,
                receiveListeners = NativeUIProjection.ReceiveListeners(
                    update = listOf("nativeLoaderAppearanceChanged"),
                    projection = NativeUIProjection.ReceiveListeners.Projection(
                        native = listOf("nativeLoaderShown"),
                        web = listOf("nativeLoaderTransitionStarted"),
                        none = listOf("nativeLoaderHidden"),
                    ),
                ),
                failedFallback = NativeUIProjection.FailedFallback.NATIVE,
                view = { NativeLoader.nativeViewEngineSurfaceView() },
            )
        }.onFailure {
            Log.e("NativeLoaderEngineBridge", "Native loader engine projection unavailable", it)
        }.getOrNull()

        if (projection != null) {
            activeSelector = projectionSelector
        }
    }

    fun unregisterEngineLoader(id: String) {
        engineEnabledLoaderIds.remove(id)
        if (engineEnabledLoaderIds.isEmpty()) {
            projection?.close()
            projection = null
            activeSelector = null
        }
    }

    fun isEngineLoader(id: String): Boolean = engineEnabledLoaderIds.contains(id)

    fun hasEngineLoaders(): Boolean = engineEnabledLoaderIds.isNotEmpty()

    fun notifyAppearanceChanged(loaderId: String) {
        if (!isEngineLoader(loaderId)) return
        plugin.emitEngineEvent("nativeLoaderAppearanceChanged", JSObject().put("id", loaderId))
    }

    fun notifyShown(loaderId: String) {
        if (!isEngineLoader(loaderId)) return
        plugin.emitEngineEvent("nativeLoaderShown", JSObject().put("id", loaderId))
    }

    fun notifyHidden(loaderId: String) {
        if (!isEngineLoader(loaderId)) return
        plugin.emitEngineEvent("nativeLoaderHidden", JSObject().put("id", loaderId))
        unregisterEngineLoader(loaderId)
    }

    fun notifyTransitionStarted(loaderId: String) {
        if (!isEngineLoader(loaderId)) return
        plugin.emitEngineEvent("nativeLoaderTransitionStarted", JSObject().put("id", loaderId))
    }

    fun receive(eventName: String, data: JSObject) {
        projection?.receive(eventName, data)
    }

    fun destroy() {
        projection?.close()
        projection = null
        activeSelector = null
        engineEnabledLoaderIds.clear()
    }
}