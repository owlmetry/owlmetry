import SwiftUI
import OwlMetry

struct ContentView: View {
    @State private var userId = ""
    @State private var customKey = ""
    @State private var customValue = ""
    @State private var logMessage = "Hello from the demo app"
    @State private var eventLog: [String] = []

    var body: some View {
        NavigationStack {
            Form {
                loggingSection
                trackingSection
                identitySection
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

    private func appendLog(_ message: String) {
        eventLog.append(message)
    }
}

#Preview {
    ContentView()
}
