import Foundation

enum FunnelTracker {
    private static let oncePrefix = "owlmetry.once."

    static func hasTrackedOnce(_ name: String, defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: oncePrefix + name)
    }

    static func markTrackedOnce(_ name: String, defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: oncePrefix + name)
    }
}
