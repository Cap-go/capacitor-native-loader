package app.capgo.nativeloader

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject

private const val DEFAULT_NATIVE_VIEW_ENGINE_SELECTOR = "#native-loader-engine-slot"

@CapacitorPlugin(name = "NativeLoader")
class NativeLoaderPlugin : Plugin() {
    private val engineBridge = NativeLoaderEngineBridge(this)

    override fun load() {
        super.load()
        NativeLoader.onLoaderHidden = { id ->
            engineBridge.notifyHidden(id)
        }
    }

    @PluginMethod
    fun configure(call: PluginCall) {
        val defaults = call.getObject("defaults")?.toMap() ?: emptyMap()
        NativeLoader.configure(defaults)
        call.resolve()
    }

    @PluginMethod
    fun show(call: PluginCall) {
        val options = call.data.toMap()
        val merged = NativeLoader.mergedShowOptions(options)
        val engineConfig = nativeViewEngineConfig(merged)
        val id = NativeLoader.show(activity, options, bridge.webView)
        if (engineConfig.enabled) {
            engineBridge.registerEngineLoader(id, engineConfig.projectionSelector)
            engineBridge.notifyShown(id)
        }
        call.resolve(JSObject().put("id", id))
    }

    @PluginMethod
    fun update(call: PluginCall) {
        if (call.getString("id").isNullOrBlank()) {
            call.reject("Missing required parameter: id")
            return
        }
        val id = call.getString("id")!!
        val options = call.data.toMap()
        val merged = NativeLoader.mergedShowOptions(options)
        val engineConfig = nativeViewEngineConfig(merged)
        val isVisible = NativeLoader.getState().second.contains(id)

        if (options.containsKey("useNativeViewEngine")) {
            when {
                engineConfig.enabled && isVisible ->
                    engineBridge.registerEngineLoader(id, engineConfig.projectionSelector)
                !engineConfig.enabled ->
                    engineBridge.unregisterEngineLoader(id)
            }
        }

        NativeLoader.update(options)
        if (engineBridge.isEngineLoader(id) && isVisible) {
            engineBridge.notifyAppearanceChanged(id)
        }
        call.resolve()
    }

    @PluginMethod
    fun setProgress(call: PluginCall) {
        val progress = call.getDouble("progress")
        if (progress == null) {
            call.reject("Missing required parameter: progress")
            return
        }
        val id = call.getString("id")
        NativeLoader.setProgress(id, progress)
        val targetId = id ?: NativeLoader.getState().second.lastOrNull()
        if (targetId != null && engineBridge.isEngineLoader(targetId)) {
            engineBridge.notifyAppearanceChanged(targetId)
        }
        call.resolve()
    }

    @PluginMethod
    fun hide(call: PluginCall) {
        NativeLoader.hide(
            id = call.getString("id"),
            animated = call.getBoolean("animated") ?: true,
            restoreWebView = call.getBoolean("restoreWebView") ?: true,
        )
        call.resolve()
    }

    @PluginMethod
    fun hideAll(call: PluginCall) {
        NativeLoader.hideAll(
            animated = call.getBoolean("animated") ?: true,
            restoreWebView = call.getBoolean("restoreWebView") ?: true,
        )
        call.resolve()
    }

    @PluginMethod
    fun setWebViewLayout(call: PluginCall) {
        NativeLoader.setWebViewLayout(call.data.toMap(), bridge.webView)
        call.resolve()
    }

    @PluginMethod
    fun resetWebViewLayout(call: PluginCall) {
        NativeLoader.resetWebViewLayout(call.getBoolean("animated") ?: true)
        call.resolve()
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        val state = NativeLoader.getState()
        call.resolve(JSObject().put("showing", state.first).put("ids", JSArray(state.second)))
    }

    @PluginMethod
    fun getPluginVersion(call: PluginCall) {
        call.resolve(JSObject().put("version", NativeLoader.getPluginVersion()))
    }

    @PluginMethod
    fun setNativeViewEnginePresentation(call: PluginCall) {
        val presentation = call.getString("presentation")
        if (presentation != "native" && presentation != "web") {
            call.reject("Missing or invalid presentation")
            return
        }
        val engineIds = NativeLoader.getState().second.filter { engineBridge.isEngineLoader(it) }
        val id = call.getString("id") ?: engineIds.lastOrNull()
        if (id == null || !engineBridge.isEngineLoader(id)) {
            call.resolve()
            return
        }
        when (presentation) {
            "web" -> engineBridge.notifyTransitionStarted(id)
            "native" -> engineBridge.notifyShown(id)
        }
        call.resolve()
    }

    internal fun emitEngineEvent(eventName: String, data: JSObject) {
        notifyListeners(eventName, data)
    }

    override fun notifyListeners(eventName: String, data: JSObject, retainUntilConsumed: Boolean) {
        if (engineBridge.hasEngineLoaders()) {
            engineBridge.receive(eventName, data)
        }
        super.notifyListeners(eventName, data, retainUntilConsumed)
    }

    override fun handleOnDestroy() {
        engineBridge.destroy()
        NativeLoader.hideAll(animated = false, restoreWebView = true)
        super.handleOnDestroy()
    }
}

private data class NativeViewEngineConfig(val enabled: Boolean, val projectionSelector: String)

private fun nativeViewEngineConfig(options: Map<String, Any?>): NativeViewEngineConfig {
    val enabled = when (val value = options["useNativeViewEngine"]) {
        is Boolean -> value
        is Number -> value.toInt() != 0
        else -> false
    }
    val custom = (options["nativeViewEngineProjectionSelector"] as? String)?.trim()
    val selector = if (!custom.isNullOrEmpty()) custom else DEFAULT_NATIVE_VIEW_ENGINE_SELECTOR
    return NativeViewEngineConfig(enabled, selector)
}

private fun JSONObject.toMap(): Map<String, Any?> {
    val output = mutableMapOf<String, Any?>()
    keys().forEach { key ->
        output[key] = normalizeJsonValue(opt(key))
    }
    return output
}

private fun JSONArray.toListValue(): List<Any?> {
    return (0 until length()).map { index ->
        normalizeJsonValue(opt(index))
    }
}

private fun normalizeJsonValue(value: Any?): Any? {
    return when (value) {
        JSONObject.NULL -> null
        is JSONObject -> value.toMap()
        is JSONArray -> value.toListValue()
        else -> value
    }
}