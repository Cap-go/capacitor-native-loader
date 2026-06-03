import XCTest
@testable import NativeLoaderPlugin

class NativeLoaderTests: XCTestCase {
    func testGetPluginVersion() {
        XCTAssertEqual("native", NativeLoader.shared.getPluginVersion())
    }

    func testInitialStateIsHidden() {
        let state = NativeLoader.shared.getState()

        XCTAssertFalse(state.0)
        XCTAssertEqual([], state.1)
    }
}
