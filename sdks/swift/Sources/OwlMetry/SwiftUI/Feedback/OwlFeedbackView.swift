#if canImport(SwiftUI)
import SwiftUI

/// Where the Submit (and Cancel) actions live.
public enum OwlFeedbackActionsPlacement: Sendable {
    /// Render Submit / Cancel in the enclosing NavigationStack's toolbar.
    /// Use this for sheet and push presentations.
    case toolbar
    /// Render Submit / Cancel as inline rows at the bottom of the form.
    /// Use this when embedding the view in a parent form with no nav bar of its own.
    case inline
}

/// A reusable SwiftUI view that collects free-text feedback (plus optional name
/// and email) and submits it to OwlMetry via `Owl.sendFeedback`.
///
/// The view does not set `.navigationTitle` or wrap itself in a `NavigationStack` —
/// the host decides how to present it. Default actions placement is `.toolbar`,
/// which merges Submit + Cancel into the enclosing nav bar; use `.inline` when
/// embedding the view with no nav bar available.
///
/// After a successful submission the view shows a "Thanks!" alert and, when
/// the user taps OK, pops itself via `@Environment(\.dismiss)` — so sheets
/// close and pushed views pop automatically. `onSubmitted` is still invoked
/// with the receipt for callers that want to log or react to the send.
///
/// ```swift
/// // Sheet
/// .sheet(isPresented: $show) {
///     NavigationStack {
///         OwlFeedbackView(onCancel: { show = false })
///             .navigationTitle("Feedback")
///     }
/// }
///
/// // Pushed onto a NavigationStack
/// NavigationLink("Feedback") { OwlFeedbackView() }
///
/// // Embedded (no enclosing nav bar) — use .inline actions so Submit appears in-form
/// VStack {
///     Text("Tell us what you think")
///     OwlFeedbackView(showsContactFields: false, actionsPlacement: .inline)
/// }
/// ```
///
/// ## Theming
///
/// The Submit button (both the toolbar confirm action and the inline
/// `.borderedProminent` button) reads the SwiftUI environment tint, so you
/// can recolor them from the call site:
///
/// ```swift
/// OwlFeedbackView(onSubmitted: { _ in }, onCancel: {})
///     .tint(.orange)
/// ```
///
/// If you don't apply `.tint()`, the view inherits whichever tint the enclosing
/// `NavigationStack` or your app's accent color provides — so in most apps it
/// will already match your brand without any extra code.
///
/// ## Strings and localization
///
/// Every user-facing string is overridable via `OwlFeedbackStrings`. Defaults
/// ship via the SDK's bundled `Localizable.xcstrings` catalog. See
/// `OwlFeedbackStrings.default.with(header:…)` for per-field overrides.
public struct OwlFeedbackView: View {
    private let showsContactFields: Bool
    private let actionsPlacement: OwlFeedbackActionsPlacement
    private let strings: OwlFeedbackStrings
    private let onSubmitted: ((OwlFeedbackReceipt) -> Void)?
    private let onCancel: (() -> Void)?

    @Environment(\.dismiss) private var dismiss

    @State private var message: String = ""
    @State private var name: String = ""
    @State private var email: String = ""
    @State private var isSubmitting: Bool = false
    @State private var submitted: OwlFeedbackReceipt?
    @State private var errorMessage: String?
    @State private var showNoContactAlert: Bool = false
    @State private var showSuccessAlert: Bool = false

    public init(
        name: String? = nil,
        email: String? = nil,
        showsContactFields: Bool = true,
        actionsPlacement: OwlFeedbackActionsPlacement = .toolbar,
        strings: OwlFeedbackStrings = .default,
        onSubmitted: ((OwlFeedbackReceipt) -> Void)? = nil,
        onCancel: (() -> Void)? = nil
    ) {
        self.showsContactFields = showsContactFields
        self.actionsPlacement = actionsPlacement
        self.strings = strings
        self.onSubmitted = onSubmitted
        self.onCancel = onCancel
        _name = State(initialValue: name ?? "")
        _email = State(initialValue: email ?? "")
    }

    public var body: some View {
        formContent
            .safeAreaInset(edge: .bottom, spacing: 0) {
                inlineActionsBar
            }
            .toolbar {
                if actionsPlacement == .toolbar, submitted == nil {
                    if onCancel != nil {
                        ToolbarItem(placement: .cancellationAction) {
                            Button { onCancel?() } label: {
                                Text(strings.cancelButton)
                            }
                            .disabled(isSubmitting)
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Group {
                            if isSubmitting {
                                ProgressView()
                            } else {
                                Button {
                                    onSubmitTapped()
                                } label: {
                                    Text(strings.submitButton).fontWeight(.semibold)
                                }
                                .disabled(!canSubmit)
                            }
                        }
                    }
                }
            }
            .alert(Text(strings.errorTitle), isPresented: errorAlertBinding, actions: {
                Button(role: .cancel) { errorMessage = nil } label: { Text("OK") }
            }, message: {
                if let errorMessage { Text(errorMessage) } else { EmptyView() }
            })
            .alert(Text(strings.noContactAlertTitle), isPresented: $showNoContactAlert, actions: {
                Button(role: .destructive) {
                    Task { await submit() }
                } label: {
                    Text(strings.noContactSubmitAnyway)
                }
                Button(role: .cancel) {} label: {
                    Text(strings.noContactAddDetails)
                }
            }, message: {
                Text(strings.noContactAlertMessage)
            })
            .alert(Text(strings.successTitle), isPresented: $showSuccessAlert, actions: {
                Button(role: .cancel) {
                    if let receipt = submitted {
                        onSubmitted?(receipt)
                    }
                    dismiss()
                } label: {
                    Text("OK")
                }
            }, message: {
                Text(strings.successBody)
            })
    }

    @ViewBuilder
    private var inlineActionsBar: some View {
        if actionsPlacement == .inline, submitted == nil {
            VStack(spacing: 10) {
                Button {
                    onSubmitTapped()
                } label: {
                    HStack(spacing: 6) {
                        if isSubmitting {
                            ProgressView()
                            Text(strings.submittingButton)
                        } else {
                            Text(strings.submitButton)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                #if !os(macOS)
                .controlSize(.large)
                #endif
                .disabled(isSubmitting || !canSubmit)

                if let onCancel {
                    Button(role: .cancel) { onCancel() } label: {
                        Text(strings.cancelButton)
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(isSubmitting)
                    #if !os(macOS)
                    .controlSize(.large)
                    #endif
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 8)
            .background(.bar)
        }
    }

    @ViewBuilder
    private var formContent: some View {
        Form {
            Section {
                ZStack(alignment: .topLeading) {
                    if message.isEmpty {
                        Text(strings.messagePlaceholder)
                            .foregroundStyle(.tertiary)
                            .padding(.top, 8)
                            .padding(.leading, 4)
                            .allowsHitTesting(false)
                    }
                    TextEditor(text: $message)
                        .frame(minHeight: 140)
                        .scrollContentBackground(.hidden)
                }
                .disabled(isSubmitting || submitted != nil)
            } header: {
                Text(strings.header)
            } footer: {
                Text(strings.footer)
            }

            if showsContactFields {
                Section {
                    TextField(
                        String(localized: strings.namePlaceholder),
                        text: $name
                    )
                    #if !os(macOS)
                    .textContentType(.name)
                    #endif
                    .disableAutocorrection(true)
                    .disabled(isSubmitting || submitted != nil)

                    TextField(
                        String(localized: strings.emailPlaceholder),
                        text: $email
                    )
                    #if !os(macOS)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .textContentType(.emailAddress)
                    #endif
                    .disableAutocorrection(true)
                    .disabled(isSubmitting || submitted != nil)
                } header: {
                    Text(strings.contactSectionTitle)
                } footer: {
                    Text(strings.contactSectionFooter)
                }
            }

        }
    }

    private var canSubmit: Bool {
        !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )
    }

    private func onSubmitTapped() {
        let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedMessage.isEmpty else {
            errorMessage = String(localized: strings.errorBlankMessage)
            return
        }

        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)

        if showsContactFields {
            if (trimmedName.isEmpty && !trimmedEmail.isEmpty) || (!trimmedName.isEmpty && trimmedEmail.isEmpty) {
                errorMessage = String(localized: strings.errorIncompleteContact)
                return
            }

            if !trimmedEmail.isEmpty, !isValidEmail(trimmedEmail) {
                errorMessage = String(localized: strings.errorInvalidEmail)
                return
            }

            if trimmedName.isEmpty && trimmedEmail.isEmpty {
                showNoContactAlert = true
                return
            }
        }

        Task { await submit() }
    }

    private func submit() async {
        let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)

        isSubmitting = true
        defer { isSubmitting = false }

        do {
            let receipt = try await Owl.sendFeedback(
                message: trimmedMessage,
                name: trimmedName.isEmpty ? nil : trimmedName,
                email: trimmedEmail.isEmpty ? nil : trimmedEmail
            )
            submitted = receipt
            showSuccessAlert = true
        } catch let error as OwlFeedbackError {
            switch error {
            case .emptyMessage:
                errorMessage = String(localized: strings.errorBlankMessage)
            case .serverError, .transportFailure, .notConfigured:
                errorMessage = error.localizedDescription
            }
        } catch {
            errorMessage = String(localized: strings.errorGeneric)
        }
    }

    private func isValidEmail(_ s: String) -> Bool {
        let range = NSRange(s.startIndex..., in: s)
        return Self.emailRegex.firstMatch(in: s, range: range) != nil
    }

    private static let emailRegex = try! NSRegularExpression(
        pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
    )
}

#Preview {
    NavigationStack {
        OwlFeedbackView(
            onSubmitted: { _ in },
            onCancel: {}
        )
        .navigationTitle("Feedback")
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
#endif
