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
        CAPPluginMethod(name: "getPluginVersion", returnType: CAPPluginReturnPromise)
    ]

    private let implementation = NativeLoader.shared

    @objc func configure(_ call: CAPPluginCall) {
        let defaults = call.getObject("defaults") ?? [:]
        implementation.configure(defaults: defaults)
        call.resolve()
    }

    @objc func show(_ call: CAPPluginCall) {
        let id = implementation.show(options: stringOptions(call.options), webView: bridge?.webView)
        call.resolve(["id": id])
    }

    @objc func update(_ call: CAPPluginCall) {
        guard call.getString("id") != nil else {
            call.reject("Missing required parameter: id")
            return
        }
        implementation.update(options: stringOptions(call.options))
        call.resolve()
    }

    @objc func setProgress(_ call: CAPPluginCall) {
        guard let progress = call.getDouble("progress") else {
            call.reject("Missing required parameter: progress")
            return
        }
        implementation.setProgress(id: call.getString("id"), progress: progress)
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
}

private func stringOptions(_ options: [AnyHashable: Any]) -> [String: Any] {
    return options.reduce(into: [String: Any]()) { result, entry in
        guard let key = entry.key as? String else { return }
        result[key] = entry.value
    }
}
