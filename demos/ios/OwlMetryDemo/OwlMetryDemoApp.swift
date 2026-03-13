import SwiftUI
import OwlMetry

@main
struct OwlMetryDemoApp: App {
    init() {
        do {
            try Owl.configure(
                endpoint: "http://localhost:4000",
                apiKey: "owl_client_REPLACE_WITH_YOUR_KEY"
            )
        } catch {
            print("OwlMetry configuration failed: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
