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
            List {
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
                .textFieldStyle(.roundedBorder)

            HStack(spacing: 12) {
                LogButton(label: "Info", color: .blue) {
                    Owl.info(logMessage, screenName: "ContentView")
                    appendLog("[INFO] \(logMessage)")
                }
                LogButton(label: "Debug", color: .gray) {
                    Owl.debug(logMessage, screenName: "ContentView")
                    appendLog("[DEBUG] \(logMessage)")
                }
                LogButton(label: "Warn", color: .orange) {
                    Owl.warn(logMessage, screenName: "ContentView")
                    appendLog("[WARN] \(logMessage)")
                }
                LogButton(label: "Error", color: .red) {
                    Owl.error(logMessage, screenName: "ContentView")
                    appendLog("[ERROR] \(logMessage)")
                }
                LogButton(label: "Attn", color: .purple) {
                    Owl.attention(logMessage, screenName: "ContentView")
                    appendLog("[ATTENTION] \(logMessage)")
                }
            }
        }
    }

    // MARK: - Tracking

    private var trackingSection: some View {
        Section("Event Tracking") {
            HStack(spacing: 8) {
                TextField("Key", text: $customKey)
                    .textFieldStyle(.roundedBorder)
                TextField("Value", text: $customValue)
                    .textFieldStyle(.roundedBorder)
            }

            HStack(spacing: 12) {
                Button("Track Event") {
                    let attrs = customKey.isEmpty ? nil : [customKey: customValue]
                    Owl.track("demo_custom_event", customAttributes: attrs)
                    appendLog("[TRACK] demo_custom_event \(attrs?.description ?? "")")
                }
                .buttonStyle(.borderedProminent)

                Button("Track Once") {
                    let attrs = customKey.isEmpty ? nil : [customKey: customValue]
                    Owl.trackOnce("demo_one_time_event", customAttributes: attrs)
                    appendLog("[TRACK ONCE] demo_one_time_event")
                }
                .buttonStyle(.bordered)
            }
        }
    }

    // MARK: - Identity

    private var identitySection: some View {
        Section("Identity") {
            TextField("User ID", text: $userId)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            HStack(spacing: 12) {
                Button("Set User") {
                    guard !userId.isEmpty else { return }
                    Owl.setUser(userId)
                    appendLog("Set user: \(userId)")
                }
                .buttonStyle(.borderedProminent)
                .disabled(userId.isEmpty)

                Button("Clear User") {
                    Owl.clearUser()
                    appendLog("Cleared user (kept anon ID)")
                }
                .buttonStyle(.bordered)

                Button("Clear + New Anon") {
                    Owl.clearUser(newAnonymousId: true)
                    appendLog("Cleared user + new anonymous ID")
                }
                .buttonStyle(.bordered)
                .tint(.red)
            }
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

struct LogButton: View {
    let label: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(label, action: action)
            .buttonStyle(.bordered)
            .tint(color)
    }
}

#Preview {
    ContentView()
}
