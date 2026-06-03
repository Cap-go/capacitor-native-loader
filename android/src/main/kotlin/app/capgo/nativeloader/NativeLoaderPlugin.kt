package app.capgo.nativeloader

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(name = "NativeLoader")
class NativeLoaderPlugin : Plugin() {

    @PluginMethod
    fun configure(call: PluginCall) {
        val defaults = call.getObject("defaults")?.toMap() ?: emptyMap()
        NativeLoader.configure(defaults)
        call.resolve()
    }

    @PluginMethod
    fun show(call: PluginCall) {
        val id = NativeLoader.show(activity, call.data.toMap(), bridge.webView)
        call.resolve(JSObject().put("id", id))
    }

    @PluginMethod
    fun update(call: PluginCall) {
        if (call.getString("id").isNullOrBlank()) {
            call.reject("Missing required parameter: id")
            return
        }
        NativeLoader.update(call.data.toMap())
        call.resolve()
    }

    @PluginMethod
    fun setProgress(call: PluginCall) {
        val progress = call.getDouble("progress")
        if (progress == null) {
            call.reject("Missing required parameter: progress")
            return
        }
        NativeLoader.setProgress(call.getString("id"), progress)
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

    override fun handleOnDestroy() {
        NativeLoader.hideAll(animated = false, restoreWebView = true)
        super.handleOnDestroy()
    }
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
