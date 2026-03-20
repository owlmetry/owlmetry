---
name: owlmetry-swift
version: 0.1.0
description: >-
  Integrate the OwlMetry Swift SDK into an iOS or macOS app for analytics,
  event tracking, metrics, funnels, and A/B experiments. Use when
  instrumenting a Swift or SwiftUI project with OwlMetry.
allowed-tools: Read, Bash, Grep, Glob
---

## Version Check

Run these checks silently. Only inform the user if updates are available.

1. **Skill version**: `curl -sf https://raw.githubusercontent.com/Jasonvdb/owlmetry/main/skills/owlmetry-swift/SKILL.md | head -5` — compare the `version:` field to `0.1.0`. If newer, ask the user if they want to update.
2. **SDK version**: Read `Package.resolved` for the current resolved revision, then compare against `curl -sf https://api.github.com/repos/Jasonvdb/owlmetry/releases/latest | jq -r .tag_name`. If newer, inform the user.

## Prerequisite

You need an OwlMetry endpoint URL and a `client_key` (starts with `owl_client_...`) for an app with `platform: apple`.

If the user doesn't have these yet, invoke `/owlmetry-cli` first to:
1. Sign up or log in
2. Create a project (if needed)
3. Create an app with `--platform apple --bundle-id <bundle-id>`
4. Note the `client_key` from the app creation response

## Add Swift Package

**Swift Package Manager (Package.swift):**
```swift
dependencies: [
    .package(url: "https://github.com/Jasonvdb/owlmetry.git", branch: "main")
]
```
Add to your target:
```swift
.target(name: "YourApp", dependencies: [
    .product(name: "OwlMetry", package: "owlmetry")
])
```

**Xcode:** File > Add Package Dependencies > enter `https://github.com/Jasonvdb/owlmetry.git`, select branch `main`, add `OwlMetry` to your target.

**Minimum platforms:** iOS 16.0, macOS 13.0. Zero external dependencies.

## Configure

Place configuration in your `@main` App init or AppDelegate `didFinishLaunching`:

```swift
import OwlMetry

@main
struct MyApp: App {
    init() {
        do {
            try Owl.configure(
                endpoint: "https://api.owlmetry.com",
                apiKey: "owl_client_..."
            )
        } catch {
            print("OwlMetry configuration failed: \(error)")
        }
    }
    // ...
}
```

**Parameters:**
- `endpoint: String` — server URL (required)
- `apiKey: String` — client key, must start with `owl_client_` (required)
- `flushOnBackground: Bool` — auto-flush when app backgrounds (default: `true`)
- `compressionEnabled: Bool` — gzip request bodies (default: `true`)

Auto-detects: bundle ID, session ID (fresh each launch), debug mode (`#if DEBUG`).

## Log Events

```swift
Owl.info("User opened settings", screenName: "SettingsView")
Owl.debug("Cache hit", screenName: "HomeView", customAttributes: ["key": "user_prefs"])
Owl.warn("Slow network response", customAttributes: ["latency_ms": "1200"])
Owl.error("Failed to load profile", screenName: "ProfileView")
```

All logging methods share the same signature:
```swift
Owl.info(_ message: String, screenName: String? = nil, customAttributes: [String: String]? = nil)
```

Source file, function, and line are auto-captured.

## User Identity

```swift
// After login — claims all previous anonymous events
Owl.setUser("user_123")

// On logout — reverts to anonymous tracking
Owl.clearUser()

// On logout with fresh anonymous ID
Owl.clearUser(newAnonymousId: true)
```

**Important:** The SDK automatically flushes buffered events before claiming identity. Anonymous events are retroactively linked to the user ID server-side.

## Funnel Tracking

```swift
Owl.track("welcome-screen")
Owl.track("create-account", attributes: ["method": "email"])
Owl.track("complete-profile")
Owl.track("first-post")
```

Each `track()` call emits an info-level event with message `"track:<stepName>"`. Define matching funnel definitions via `/owlmetry-cli`:
```bash
owlmetry funnels create --project <id> --name "Onboarding" --slug onboarding \
  --steps '[{"name":"Welcome","event_filter":{"message":"track:welcome-screen"}},{"name":"Account","event_filter":{"message":"track:create-account"}},{"name":"Profile","event_filter":{"message":"track:complete-profile"}},{"name":"First Post","event_filter":{"message":"track:first-post"}}]' \
  --format json
```

## Structured Metrics

### Lifecycle operations (start → complete/fail/cancel)

```swift
let op = Owl.startOperation("photo-upload", attributes: ["format": "heic"])

// On success:
op.complete(attributes: ["size_bytes": "524288"])

// On failure:
op.fail(error: "timeout", attributes: ["retry_count": "3"])

// On cancellation:
op.cancel(attributes: ["reason": "user_cancelled"])
```

`duration_ms` and `tracking_id` (UUID) are auto-added. Create the metric definition first:
```bash
owlmetry metrics create --project <id> --name "Photo Upload" --slug photo-upload --lifecycle --format json
```

### Single-shot measurements

```swift
Owl.recordMetric("app-cold-start", attributes: ["screen": "home"])
```

**Slug rules:** lowercase letters, numbers, hyphens only. Invalid slugs are auto-corrected with a console warning.

## A/B Experiments

```swift
// Random assignment on first call, persisted to Keychain thereafter
let variant = Owl.getVariant("checkout-redesign", options: ["control", "variant-a", "variant-b"])

// Force-set a variant (e.g., from server config)
Owl.setExperiment("checkout-redesign", variant: "variant-a")

// Clear all assignments
Owl.clearExperiments()
```

- Assignments persist in Keychain (`com.owlmetry.experiments`).
- All events automatically include an `experiments` field with current assignments.
- Query funnel analytics segmented by variant via CLI: `owlmetry funnels query <slug> --project <id> --group-by experiment:checkout-redesign`

## Lifecycle

```swift
// In your app's termination handler or ScenePhase .background
await Owl.shutdown()
```

`flushOnBackground: true` (default) handles most cases automatically. Call `shutdown()` explicitly only if you need to guarantee delivery at a specific point.

## Auto-Captured Data

Every event automatically includes:
- `session_id` — fresh UUID per `configure()` call
- Device model, OS version, locale
- `app_version`, `build_number` (from bundle)
- `is_debug` — `true` in DEBUG builds
- `_connection` — network type (wifi, cellular, ethernet, offline) via `NWPathMonitor`
- `experiments` — current A/B experiment assignments
- `environment` — specific runtime (ios, ipados, macos)
