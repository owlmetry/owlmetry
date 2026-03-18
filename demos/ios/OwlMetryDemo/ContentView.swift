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

    var body: some View {
        NavigationStack {
            Form {
                runFullDemoSection
                loggingSection
                metricsSection
                identitySection
                backendDemoSection
                logOutputSection
            }
            .navigationTitle("OwlMetry Demo")
        }
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

            Button("Attention") {
                Owl.attention(logMessage, screenName: "ContentView")
                appendLog("[ATTENTION] \(logMessage)")
            }
            .tint(.purple)
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

        // 6. iOS error event for investigation
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
