// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapgoCapacitorNativeLoader",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapgoCapacitorNativeLoader",
            targets: ["NativeLoaderPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/airbnb/lottie-spm.git", from: "4.6.0")
    ],
    targets: [
        .target(
            name: "NativeLoaderPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "Lottie", package: "lottie-spm")
            ],
            path: "ios/Sources/NativeLoaderPlugin"),
        .testTarget(
            name: "NativeLoaderPluginTests",
            dependencies: ["NativeLoaderPlugin"],
            path: "ios/Tests/NativeLoaderPluginTests")
    ]
)
