import SwiftUI
import OwlMetry

struct ContentView: View {
    @State private var userId = ""
    @State private var customKey = ""
    @State private var customValue = ""
    @State private var logMessage = "Hello from the demo app"
    @State private var greetName = "World"
    @State private var eventLog: [String] = []

    var body: some View {
        NavigationStack {
            Form {
                loggingSection
                trackingSection
                identitySection
                backendDemoSection
                logOutputSection
            }
            .navigationTitle("OwlMetry Demo")
        }
        .onAppear {
            Owl.track("demo_app_opened")
            appendLog("App opened — tracked demo_app_opened")
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

    // MARK: - Tracking

    private var trackingSection: some View {
        Section("Event Tracking") {
            TextField("Key", text: $customKey)
            TextField("Value", text: $customValue)

            Button("Track Event") {
                let attrs = customKey.isEmpty ? nil : [customKey: customValue]
                Owl.track("demo_custom_event", customAttributes: attrs)
                appendLog("[TRACK] demo_custom_event \(attrs?.description ?? "")")
            }

            Button("Track Once") {
                let attrs = customKey.isEmpty ? nil : [customKey: customValue]
                Owl.trackOnce("demo_one_time_event", customAttributes: attrs)
                appendLog("[TRACK ONCE] demo_one_time_event")
            }
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
                Owl.track("backend_greet_tapped", customAttributes: ["name": greetName])
                appendLog("[TRACK] backend_greet_tapped")
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
                Owl.track("backend_checkout_tapped", customAttributes: ["item": "Widget"])
                appendLog("[TRACK] backend_checkout_tapped")
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
