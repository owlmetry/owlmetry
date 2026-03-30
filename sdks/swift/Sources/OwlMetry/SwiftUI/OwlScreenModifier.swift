#if canImport(SwiftUI)
import SwiftUI

/// A view modifier that automatically tracks screen appearances and
/// time-on-screen. Emits `sdk:screen_appeared` (info) on appear with the
/// given `screenName`, and `sdk:screen_disappeared` (debug) on disappear with
/// a `_duration_ms` attribute recording how long the screen was visible.
private struct OwlScreenModifier: ViewModifier {
    let screenName: String
    @State private var appearedAt: Date?

    func body(content: Content) -> some View {
        content
            .onAppear {
                appearedAt = Date()
                Owl.info("sdk:screen_appeared", screenName: screenName)
            }
            .onDisappear {
                var attributes: [String: String]? = nil
                if let appearedAt {
                    let durationMs = Int(Date().timeIntervalSince(appearedAt) * 1000)
                    attributes = ["_duration_ms": String(durationMs)]
                }
                Owl.debug("sdk:screen_disappeared", screenName: screenName, attributes: attributes)
                appearedAt = nil
            }
    }
}

public extension View {
    /// Automatically tracks screen appearances and time-on-screen.
    ///
    /// Attach to the outermost view of each screen:
    /// ```swift
    /// struct HomeView: View {
    ///     var body: some View {
    ///         VStack { ... }
    ///             .owlScreen("Home")
    ///     }
    /// }
    /// ```
    ///
    /// On appear, emits an `sdk:screen_appeared` event with the given
    /// `screenName`. On disappear, emits `sdk:screen_disappeared` with
    /// a `_duration_ms` attribute recording how long the screen was visible.
    func owlScreen(_ name: String) -> some View {
        modifier(OwlScreenModifier(screenName: name))
    }
}
#endif
