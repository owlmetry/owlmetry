import SwiftUI
import OwlMetry

struct ContentView: View {
    @State private var userId = ""
    @State private var customKey = ""
    @State private var customValue = ""
    @State private var logMessage = "Hello from the demo app"
    @State private var greetName = "World"
    @State private var eventLog: [String] = []
    @State private var isRunningDemo = false
    @State private var showFeedbackSheet = false
    @State private var lastFeedbackId: String?

    var body: some View {
        NavigationStack {
            Form {
                runFullDemoSection
                loggingSection
                metricsSection
                funnelDemoSection
                identitySection
                userPropertiesSection
                attributionSection
                feedbackSection
                backendDemoSection
                logOutputSection
            }
            .navigationTitle("OwlMetry Demo")
            .sheet(isPresented: $showFeedbackSheet) {
                NavigationStack {
                    OwlFeedbackView(
                        name: userId.isEmpty ? nil : userId,
                        onSubmitted: { receipt in
                            lastFeedbackId = receipt.id
                            appendLog("[FEEDBACK] sent id=\(receipt.id)")
                            showFeedbackSheet = false
                        },
                        onCancel: { showFeedbackSheet = false }
                    )
                    .navigationTitle("Feedback")
                    #if !os(macOS)
                    .navigationBarTitleDisplayMode(.inline)
                    #endif
                }
            }
        }
        .owlScreen("Home")
        .onAppear {
            Owl.recordMetric("demo_app_opened")
            appendLog("App opened — recorded demo_app_opened")
        }
    }

    // MARK: - Logging

    private var loggingSection: some View {
        Section("Logging") {
            TextField("Message", text: $logMessage)

            Button("Info") {
                Owl.info(logMessage, screenName: "ContentView")
                appendLog("[INFO] \(logMessage)")
            }
            .tint(.blue)

            Button("Debug") {
                Owl.debug(logMessage, screenName: "ContentView")
                appendLog("[DEBUG] \(logMessage)")
            }
            .tint(.gray)

            Button("Warn") {
                Owl.warn(logMessage, screenName: "ContentView")
                appendLog("[WARN] \(logMessage)")
            }
            .tint(.orange)

            Button("Error") {
                Owl.error(logMessage, screenName: "ContentView")
                appendLog("[ERROR] \(logMessage)")
            }
            .tint(.red)

        }
    }

    // MARK: - Metrics

    private var metricsSection: some View {
        Section("Metrics") {
            TextField("Key", text: $customKey)
            TextField("Value", text: $customValue)

            Button("Record Metric") {
                let attrs = customKey.isEmpty ? nil : [customKey: customValue]
                Owl.recordMetric("demo_custom_event", attributes: attrs)
                appendLog("[METRIC] demo_custom_event \(attrs?.description ?? "")")
            }

            Button("Simulate Conversion") {
                let op = Owl.startOperation("photo-conversion", attributes: ["input_format": "heic"])
                appendLog("[METRIC] photo-conversion:start")
                Task {
                    try? await Task.sleep(for: .seconds(1))
                    op.complete(attributes: ["output_format": "jpeg", "output_size": "524288"])
                    appendLog("[METRIC] photo-conversion:complete")
                }
            }
            .tint(.green)

            Button("Simulate Failed Operation") {
                let op = Owl.startOperation("photo-conversion", attributes: ["input_format": "raw"])
                appendLog("[METRIC] photo-conversion:start")
                op.fail(error: "unsupported_format")
                appendLog("[METRIC] photo-conversion:fail")
            }
            .tint(.red)

            Button("Simulate Failure with Attachment") {
                // Demonstrates the attachments: parameter. The "input" is synthesised
                // bytes so the demo does not need a real file — in real code you would
                // pass the actual file that failed to parse/convert.
                let bytes: [UInt8] = Array("fake broken image bytes — demo only".utf8)
                let fakeInput = Data(bytes)
                Owl.error(
                    "photo conversion failed",
                    screenName: "ContentView",
                    attributes: ["input_format": "heic", "stage": "decode"],
                    attachments: [
                        OwlAttachment(data: fakeInput, name: "broken-input.heic",
                                      contentType: "image/heic"),
                    ]
                )
                appendLog("[ERROR+ATTACHMENT] photo conversion failed")
            }
            .tint(.red)
        }
    }

    // MARK: - Funnel Demo

    private var funnelDemoSection: some View {
        Section("Funnel Demo") {
            Button("1. Welcome Screen") {
                Owl.step("welcome-screen")
                appendLog("[STEP] welcome-screen")
            }
            .tint(.purple)

            Button("2. Create Account") {
                Owl.step("create-account")
                appendLog("[STEP] create-account")
            }
            .tint(.purple)

            Button("3. Complete Profile") {
                Owl.step("complete-profile")
                appendLog("[STEP] complete-profile")
            }
            .tint(.purple)

            Button("4. First Post") {
                Owl.step("first-post")
                appendLog("[STEP] first-post")
            }
            .tint(.purple)

            Button("Set Experiment: onboarding=B") {
                Owl.setExperiment("onboarding", variant: "B")
                appendLog("[EXPERIMENT] onboarding = B")
            }
            .tint(.indigo)

            Button("Clear Experiments") {
                Owl.clearExperiments()
                appendLog("[EXPERIMENT] cleared all")
            }
            .tint(.gray)
        }
    }

    // MARK: - Identity

    private var identitySection: some View {
        Section("Identity") {
            TextField("User ID", text: $userId)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            Button("Set User") {
                guard !userId.isEmpty else { return }
                Owl.setUser(userId)
                appendLog("Set user: \(userId)")
            }
            .disabled(userId.isEmpty)

            Button("Clear User") {
                Owl.clearUser()
                appendLog("Cleared user (kept anon ID)")
            }

            Button("Clear + New Anonymous ID") {
                Owl.clearUser(newAnonymousId: true)
                appendLog("Cleared user + new anonymous ID")
            }
            .tint(.red)
        }
    }

    // MARK: - User Properties

    private var userPropertiesSection: some View {
        Section("User Properties") {
            TextField("Key", text: $customKey)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            TextField("Value", text: $customValue)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            Button("Set Property") {
                guard !customKey.isEmpty else { return }
                Owl.setUserProperties([customKey: customValue])
                appendLog("[PROPS] \(customKey) = \(customValue.isEmpty ? "(deleted)" : customValue)")
                customKey = ""
                customValue = ""
            }
            .disabled(customKey.isEmpty)

            Button("Set Demo Properties") {
                Owl.setUserProperties([
                    "plan": "premium",
                    "rc_subscriber": "true",
                    "rc_product": "monthly_pro",
                ])
                appendLog("[PROPS] plan=premium, rc_subscriber=true, rc_product=monthly_pro")
            }
            .tint(.purple)
        }
    }

    // MARK: - Attribution

    /// Attribution is auto-captured on `Owl.configure()`. The controls here
    /// are for poking at it in development: force a dev-mode submission
    /// without relying on AdServices, or clear the "captured" flag so the
    /// next app launch re-attempts capture.
    private var attributionSection: some View {
        Section("Attribution") {
            Text("Auto-captures Apple Search Ads attribution on app launch. Set OWLMETRY_MOCK_ADSERVICES_TOKEN in the scheme to exercise the real code path in the simulator.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button("Submit Mock Attribution (dev)") {
                Task {
                    let result = await postDevMockAttribution(devMock: "attributed")
                    appendLog("[ATTRIBUTION] submit mock → \(result)")
                }
            }
            .tint(.purple)

            Button("Submit Mock (unattributed)") {
                Task {
                    let result = await postDevMockAttribution(devMock: "unattributed")
                    appendLog("[ATTRIBUTION] submit mock unattributed → \(result)")
                }
            }
            .tint(.gray)

            Button("Reset Capture Flag") {
                Owl.resetAppleSearchAdsAttributionCapture()
                appendLog("[ATTRIBUTION] reset capture flag; relaunch to re-attempt auto-capture")
            }
            .tint(.orange)
        }
    }

    private func postDevMockAttribution(devMock: String) async -> String {
        let baseURL = "http://localhost:4000"
        guard let url = URL(string: "\(baseURL)/v1/identity/attribution/apple-search-ads") else {
            return "bad url"
        }
        guard let currentUser = Owl.currentUserId else {
            return "Owl not configured"
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer owl_client_demo_000000000000000000000000000000000000000000", forHTTPHeaderField: "Authorization")
        let body: [String: String] = [
            "user_id": currentUser,
            "attribution_token": "ignored-in-mock",
            "dev_mock": devMock,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let text = String(data: data, encoding: .utf8) ?? ""
            return "\(status): \(text.prefix(200))"
        } catch {
            return "error: \(error.localizedDescription)"
        }
    }

    // MARK: - Feedback

    private var feedbackSection: some View {
        Section("Feedback") {
            Button {
                showFeedbackSheet = true
            } label: {
                Label("Send Feedback (Sheet)", systemImage: "envelope")
            }
            .tint(.cyan)

            NavigationLink {
                OwlFeedbackView(
                    name: userId.isEmpty ? nil : userId,
                    onSubmitted: { receipt in
                        lastFeedbackId = receipt.id
                        appendLog("[FEEDBACK] sent id=\(receipt.id)")
                    }
                )
                .navigationTitle("Feedback")
                #if !os(macOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
            } label: {
                Label("Send Feedback (Push)", systemImage: "arrow.turn.down.right")
            }

            NavigationLink {
                // Embedded usage: no nav toolbar of its own, so actions render inline.
                OwlFeedbackView(
                    showsContactFields: false,
                    actionsPlacement: .inline,
                    onSubmitted: { receipt in
                        lastFeedbackId = receipt.id
                        appendLog("[FEEDBACK] sent id=\(receipt.id)")
                    }
                )
                .navigationTitle("Feedback (embedded)")
                #if !os(macOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
            } label: {
                Label("Send Feedback (Embedded)", systemImage: "square.stack.3d.down.right")
            }

            if let lastFeedbackId {
                Text("Last feedback id: \(lastFeedbackId)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
    }

    // MARK: - Backend Demo

    private var backendDemoSection: some View {
        Section("Backend Demo") {
            TextField("Name", text: $greetName)
                .autocorrectionDisabled()

            Button("Greet") {
                Owl.recordMetric("backend_greet_tapped", attributes: ["name": greetName])
                appendLog("[METRIC] backend_greet_tapped")
                Task {
                    let result = await callBackend(
                        path: "/api/greet",
                        body: ["name": greetName, "userId": userId.isEmpty ? nil : userId]
                    )
                    appendLog("[BACKEND] \(result)")
                }
            }
            .tint(.green)

            Button("Checkout (simulated failure)") {
                Owl.recordMetric("backend_checkout_tapped", attributes: ["item": "Widget"])
                appendLog("[METRIC] backend_checkout_tapped")
                Task {
                    let result = await callBackend(
                        path: "/api/checkout",
                        body: ["item": "Widget", "userId": userId.isEmpty ? nil : userId]
                    )
                    appendLog("[BACKEND] \(result)")
                }
            }
            .tint(.orange)
        }
    }

    // MARK: - Full Demo

    private var runFullDemoSection: some View {
        Section("Full Demo") {
            Button {
                guard !isRunningDemo else { return }
                isRunningDemo = true
                Task {
                    await runFullDemo()
                    isRunningDemo = false
                }
            } label: {
                HStack {
                    Text("Run Full Demo")
                    Spacer()
                    if isRunningDemo {
                        ProgressView()
                    }
                }
            }
            .disabled(isRunningDemo)
            .tint(.indigo)
        }
    }

    private func runFullDemo() async {
        appendLog("— Full Demo Started —")

        // 1. iOS info event
        Owl.info("Demo started", screenName: "ContentView")
        appendLog("[INFO] Demo started")

        // 2. Record a metric
        Owl.recordMetric("demo_full_test")
        appendLog("[METRIC] demo_full_test")

        // 2b. Lifecycle metric
        let op = Owl.startOperation("demo-operation")
        appendLog("[METRIC] demo-operation:start")
        try? await Task.sleep(for: .milliseconds(500))
        op.complete(attributes: ["result": "success"])
        appendLog("[METRIC] demo-operation:complete")

        // 3. Backend greet → 2 info events server-side
        let greetResult = await callBackend(
            path: "/api/greet",
            body: ["name": "OwlBot"]
        )
        appendLog("[BACKEND] greet: \(greetResult)")

        // 4. Pause between backend calls
        try? await Task.sleep(for: .seconds(1))

        // 5. Backend checkout → info + warn + error server-side
        let checkoutResult = await callBackend(
            path: "/api/checkout",
            body: ["item": "Premium Plan"]
        )
        appendLog("[BACKEND] checkout: \(checkoutResult)")

        // 6. Funnel demo: simulate onboarding flow
        Owl.setExperiment("onboarding", variant: "A")
        appendLog("[EXPERIMENT] onboarding = A")
        Owl.step("welcome-screen")
        appendLog("[STEP] welcome-screen")
        try? await Task.sleep(for: .milliseconds(300))
        Owl.step("create-account")
        appendLog("[STEP] create-account")
        try? await Task.sleep(for: .milliseconds(300))
        Owl.step("complete-profile")
        appendLog("[STEP] complete-profile")

        // 7. User properties
        Owl.setUserProperties(["plan": "premium", "rc_subscriber": "true"])
        appendLog("[PROPS] plan=premium, rc_subscriber=true")
        try? await Task.sleep(for: .milliseconds(500))

        // 8. iOS error event for investigation
        Owl.error("Simulated client crash", screenName: "ContentView")
        appendLog("[ERROR] Simulated client crash")

        appendLog("— Full Demo Complete —")
    }

    // MARK: - Log Output

    private var logOutputSection: some View {
        Section("Event Log") {
            if eventLog.isEmpty {
                Text("No events sent yet")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(eventLog.reversed().enumerated()), id: \.offset) { _, entry in
                    Text(entry)
                        .font(.caption)
                        .monospaced()
                }
            }
        }
    }

    private func callBackend(path: String, body: [String: String?]) async -> String {
        guard let url = URL(string: "http://localhost:4007\(path)") else {
            return "Invalid URL"
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let sessionId = Owl.sessionId {
            request.setValue(sessionId, forHTTPHeaderField: "X-Owl-Session-Id")
        }

        let filtered = body.compactMapValues { $0 }
        request.httpBody = try? JSONSerialization.data(withJSONObject: filtered)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let text = String(data: data, encoding: .utf8) ?? "No body"
            return "\(status): \(text)"
        } catch {
            return "Error: \(error.localizedDescription)"
        }
    }

    private func appendLog(_ message: String) {
        eventLog.append(message)
    }
}

#Preview {
    ContentView()
}
