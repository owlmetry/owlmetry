import Foundation

/// All user-facing strings rendered by `OwlFeedbackView`. Every field is a
/// `LocalizedStringResource` (iOS 16+) so defaults ship localized via the
/// SDK's bundled string catalog while callers can also:
///
/// - Pass plain string literals (`OwlFeedbackStrings(header: "How can we help?", .default)`).
/// - Resolve against their own catalog
///   (`OwlFeedbackStrings(header: LocalizedStringResource("feedback.header", table: "MyApp"))`).
/// - Override a single field via `.default.with(header: "…")`.
public struct OwlFeedbackStrings: Sendable {
    public var header: LocalizedStringResource
    public var footer: LocalizedStringResource
    public var messageSectionTitle: LocalizedStringResource
    public var messagePlaceholder: LocalizedStringResource
    public var contactSectionTitle: LocalizedStringResource
    public var contactSectionFooter: LocalizedStringResource
    public var nameLabel: LocalizedStringResource
    public var namePlaceholder: LocalizedStringResource
    public var emailLabel: LocalizedStringResource
    public var emailPlaceholder: LocalizedStringResource
    public var submitButton: LocalizedStringResource
    public var submittingButton: LocalizedStringResource
    public var cancelButton: LocalizedStringResource
    public var successTitle: LocalizedStringResource
    public var successBody: LocalizedStringResource
    public var errorTitle: LocalizedStringResource
    public var errorBlankMessage: LocalizedStringResource
    public var errorInvalidEmail: LocalizedStringResource
    public var errorGeneric: LocalizedStringResource

    public init(
        header: LocalizedStringResource = .init("owl.feedback.header", defaultValue: "How can we improve?", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        footer: LocalizedStringResource = .init("owl.feedback.footer", defaultValue: "We read every piece of feedback.", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        messageSectionTitle: LocalizedStringResource = .init("owl.feedback.message.section", defaultValue: "Your feedback", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        messagePlaceholder: LocalizedStringResource = .init("owl.feedback.message.placeholder", defaultValue: "Tell us what's on your mind…", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        contactSectionTitle: LocalizedStringResource = .init("owl.feedback.contact.section", defaultValue: "Contact (optional)", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        contactSectionFooter: LocalizedStringResource = .init("owl.feedback.contact.footer", defaultValue: "Leave these blank and we'll still get your feedback.", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        nameLabel: LocalizedStringResource = .init("owl.feedback.name.label", defaultValue: "Name", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        namePlaceholder: LocalizedStringResource = .init("owl.feedback.name.placeholder", defaultValue: "Your name", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        emailLabel: LocalizedStringResource = .init("owl.feedback.email.label", defaultValue: "Email", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        emailPlaceholder: LocalizedStringResource = .init("owl.feedback.email.placeholder", defaultValue: "you@example.com", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        submitButton: LocalizedStringResource = .init("owl.feedback.submit", defaultValue: "Send feedback", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        submittingButton: LocalizedStringResource = .init("owl.feedback.submitting", defaultValue: "Sending…", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        cancelButton: LocalizedStringResource = .init("owl.feedback.cancel", defaultValue: "Cancel", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        successTitle: LocalizedStringResource = .init("owl.feedback.success.title", defaultValue: "Thanks!", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        successBody: LocalizedStringResource = .init("owl.feedback.success.body", defaultValue: "Your feedback made it through.", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        errorTitle: LocalizedStringResource = .init("owl.feedback.error.title", defaultValue: "Couldn't send feedback", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        errorBlankMessage: LocalizedStringResource = .init("owl.feedback.error.blank", defaultValue: "Please write a message first.", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        errorInvalidEmail: LocalizedStringResource = .init("owl.feedback.error.email", defaultValue: "That doesn't look like a valid email.", bundle: .atURL(OwlMetryBundle.resources.bundleURL)),
        errorGeneric: LocalizedStringResource = .init("owl.feedback.error.generic", defaultValue: "Something went wrong. Please try again.", bundle: .atURL(OwlMetryBundle.resources.bundleURL))
    ) {
        self.header = header
        self.footer = footer
        self.messageSectionTitle = messageSectionTitle
        self.messagePlaceholder = messagePlaceholder
        self.contactSectionTitle = contactSectionTitle
        self.contactSectionFooter = contactSectionFooter
        self.nameLabel = nameLabel
        self.namePlaceholder = namePlaceholder
        self.emailLabel = emailLabel
        self.emailPlaceholder = emailPlaceholder
        self.submitButton = submitButton
        self.submittingButton = submittingButton
        self.cancelButton = cancelButton
        self.successTitle = successTitle
        self.successBody = successBody
        self.errorTitle = errorTitle
        self.errorBlankMessage = errorBlankMessage
        self.errorInvalidEmail = errorInvalidEmail
        self.errorGeneric = errorGeneric
    }

    public static let `default` = OwlFeedbackStrings()

    /// Return a copy of this struct with the passed-in fields overridden.
    /// Useful for single-field tweaks: `.default.with(header: "Hi!")`.
    public func with(
        header: LocalizedStringResource? = nil,
        footer: LocalizedStringResource? = nil,
        messageSectionTitle: LocalizedStringResource? = nil,
        messagePlaceholder: LocalizedStringResource? = nil,
        contactSectionTitle: LocalizedStringResource? = nil,
        contactSectionFooter: LocalizedStringResource? = nil,
        nameLabel: LocalizedStringResource? = nil,
        namePlaceholder: LocalizedStringResource? = nil,
        emailLabel: LocalizedStringResource? = nil,
        emailPlaceholder: LocalizedStringResource? = nil,
        submitButton: LocalizedStringResource? = nil,
        submittingButton: LocalizedStringResource? = nil,
        cancelButton: LocalizedStringResource? = nil,
        successTitle: LocalizedStringResource? = nil,
        successBody: LocalizedStringResource? = nil,
        errorTitle: LocalizedStringResource? = nil,
        errorBlankMessage: LocalizedStringResource? = nil,
        errorInvalidEmail: LocalizedStringResource? = nil,
        errorGeneric: LocalizedStringResource? = nil
    ) -> OwlFeedbackStrings {
        var copy = self
        if let header { copy.header = header }
        if let footer { copy.footer = footer }
        if let messageSectionTitle { copy.messageSectionTitle = messageSectionTitle }
        if let messagePlaceholder { copy.messagePlaceholder = messagePlaceholder }
        if let contactSectionTitle { copy.contactSectionTitle = contactSectionTitle }
        if let contactSectionFooter { copy.contactSectionFooter = contactSectionFooter }
        if let nameLabel { copy.nameLabel = nameLabel }
        if let namePlaceholder { copy.namePlaceholder = namePlaceholder }
        if let emailLabel { copy.emailLabel = emailLabel }
        if let emailPlaceholder { copy.emailPlaceholder = emailPlaceholder }
        if let submitButton { copy.submitButton = submitButton }
        if let submittingButton { copy.submittingButton = submittingButton }
        if let cancelButton { copy.cancelButton = cancelButton }
        if let successTitle { copy.successTitle = successTitle }
        if let successBody { copy.successBody = successBody }
        if let errorTitle { copy.errorTitle = errorTitle }
        if let errorBlankMessage { copy.errorBlankMessage = errorBlankMessage }
        if let errorInvalidEmail { copy.errorInvalidEmail = errorInvalidEmail }
        if let errorGeneric { copy.errorGeneric = errorGeneric }
        return copy
    }
}
