import Foundation

/// Public accessor for the SDK's resource bundle. `Bundle.module` is synthesized
/// as internal by SwiftPM, which can't be referenced from default argument
/// values of a public initializer (like `OwlFeedbackStrings.init`). Exposing a
/// public proxy lets callers resolve `LocalizedStringResource` defaults.
public enum OwlMetryBundle {
    /// The bundle that ships with the OwlMetry Swift SDK.
    public static let resources: Bundle = .module
}
