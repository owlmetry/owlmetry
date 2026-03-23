---
name: owlmetry-swift
version: 0.1.3
description: >-
  Integrate the OwlMetry Swift SDK into an iOS or macOS app for analytics,
  event tracking, metrics, funnels, and A/B experiments. Use when
  instrumenting a Swift or SwiftUI project with OwlMetry.
allowed-tools: Read, Bash, Grep, Glob
---

## What is OwlMetry?

OwlMetry is a self-hosted analytics platform. The Swift SDK captures events from iOS, iPadOS, and macOS apps and delivers them to the OwlMetry server. It handles buffering, gzip compression, offline queuing, session management, and network monitoring automatically — you just call logging methods and the SDK takes care of delivery.

The SDK is a static `Owl` enum with no external dependencies. All calls are non-blocking (events are buffered and flushed in batches). A single `configure()` call initialises everything.

## Version Check

Run these checks silently. Only inform the user if updates are available.

1. **Skill version**: `curl -sf https://raw.githubusercontent.com/Jasonvdb/owlmetry/main/skills/owlmetry-swift/SKILL.md | head -5` — compare the `version:` field to `0.1.0`. If newer, ask the user if they want to update.
2. **SDK version**: Read `Package.resolved` for the current resolved revision, then compare against `curl -sf https://api.github.com/repos/Jasonvdb/owlmetry/releases/latest | jq -r .tag_name`. If newer, inform the user.

## Prerequisite

You need an **ingest endpoint** and a **client key** (`owl_client_...`) for an Apple-platform app. Both come from the CLI setup flow.

If the user doesn't have these yet, follow the `/owlmetry-cli` skill first — it handles sign-up, project creation, and app creation. The ingest endpoint is saved to `~/.owlmetry/config.json` (`ingest_endpoint` field) and the client key is returned when creating an app.

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

## Verify Package Integration

After adding the package, build the project to verify the dependency resolves and `import OwlMetry` compiles. Do not proceed with configuration until the build succeeds.

If the build fails with a "No such module 'OwlMetry'" error, ask the user to add the package manually in Xcode:

1. Open the `.xcodeproj` or `.xcworkspace` in Xcode
2. Select the project in the navigator (blue icon at the top)
3. Select the app target under "Targets"
4. Go to the "General" tab
5. Scroll to "Frameworks, Libraries, and Embedded Content"
6. Click the **+** button
7. Click "Add Other…" > "Add Package Dependency…"
8. Enter the URL: `https://github.com/Jasonvdb/owlmetry.git`
9. Set "Dependency Rule" to **Branch** → `main`
10. Click "Add Package"
11. Select the **OwlMetry** library and click "Add Package"

Once the user confirms the package is added, retry the build to verify, then proceed with configuration.

## Configure

Configuration must happen once, as early as possible — in the `@main` App `init()` or AppDelegate `didFinishLaunching`. **Do not defer it** to a later point (e.g., after async setup or user consent). The SDK measures app launch time (`_launch_ms`) from process start to the `configure()` call, so placing it early gives an accurate cold-start metric. It also ensures no events are dropped before configuration. Each `configure()` call generates a fresh `session_id` (UUID) that groups all subsequent events together.

```swift
import OwlMetry

@main
struct MyApp: App {
    init() {
        do {
            try Owl.configure(
                endpoint: "https://ingest.owlmetry.com",
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

Auto-detects: bundle ID, debug mode (`#if DEBUG`). Auto-generates: session ID (fresh each launch).

## User Identity (set up during initial configuration)

After adding `Owl.configure()`, find where the app handles authentication and add `Owl.setUser()` / `Owl.clearUser()`. This is part of the basic setup — do it now, before moving on to instrumentation.

Look for the auth state change handler (e.g., Firebase Auth listener, login/logout methods) and add:

```swift
// After successful login — claims all previous anonymous events for this user
Owl.setUser(userId)

// On logout — reverts to anonymous tracking
Owl.clearUser()
```

**Where to find it:** Search for login/logout methods, auth state listeners, or session management code. Look for patterns like setting a user ID on other services (crash reporting, analytics), storing auth tokens, or clearing user state. Place `Owl.setUser()` right after the user ID becomes available. Place `Owl.clearUser()` in the sign-out/logout handler.

The SDK automatically flushes buffered events before claiming identity, so anonymous events from before login are retroactively linked to the user.

## Next Steps — Codebase Instrumentation

Once `Owl.configure()` is in place and the project builds successfully, **you MUST stop here and ask the user** which area they'd like to instrument first — even if the user's original prompt asked you to "instrument the app." Do not proceed with any code changes until the user chooses. Present these three options:

1. **Event & error logging** — Audit the codebase for user actions, screen views, error handling, and key flows. Add `Owl.info()`, `Owl.warn()`, `Owl.error()` calls at meaningful points. This is SDK-only — no CLI setup required beyond what's already done.
2. **Structured metrics** — Identify operations worth measuring (network requests, data loading, image processing, etc.). Add `Owl.startOperation()` / `Owl.recordMetric()` to track durations and success rates. **Requires CLI first:** each metric slug must be defined on the server via `owlmetry metrics create` (use the `/owlmetry-cli` skill) before the SDK can emit events for it.
3. **Funnel tracking** — Identify user journeys (onboarding, checkout, key conversions). Add `Owl.track()` calls at each step to measure drop-off. **Requires CLI first:** the funnel definition (with steps and event filters) must be created via `owlmetry funnels create` (use the `/owlmetry-cli` skill) before tracking makes sense.

After the user chooses, do a thorough audit of the entire codebase to find all relevant locations, then present a summary of proposed changes before making any edits.

## Screen Tracking (`.owlScreen()`)

The SDK provides a SwiftUI view modifier that automatically tracks screen appearances and time-on-screen with zero manual event calls.

```swift
struct HomeView: View {
    var body: some View {
        VStack { ... }
            .owlScreen("Home")
    }
}

struct SettingsView: View {
    var body: some View {
        Form { ... }
            .owlScreen("Settings")
    }
}
```

**What it does automatically:**
- On appear: emits `sdk:screen_appeared` (info level) with `screenName` set — included in production data
- On disappear: emits `sdk:screen_disappeared` (debug level) with `screenName` set and `_duration_ms` attribute — only visible in dev data mode

**Where to place it:** Attach `.owlScreen("ScreenName")` to the outermost view of each screen — typically on the `NavigationStack`, `Form`, `ScrollView`, or root `VStack`. Use it on every distinct screen in the app. Choose names that are short, readable, and consistent (e.g., `"Home"`, `"Settings"`, `"Profile"`, `"Checkout"`).

**Prefer `.owlScreen()` over manual `Owl.info()` for screen views** — it handles both appear and disappear with duration tracking. Use manual `Owl.info()` with `screenName:` only for events within a screen (button taps, state changes), not for screen appearances themselves.

## Log Events

Events are the core unit of data in OwlMetry. Use the four log levels to capture different kinds of information:

- **`info`** — normal operations worth recording: screen views, user actions, feature usage, successful completions. This is your default level.
- **`debug`** — verbose detail useful only during development: cache hits, state transitions, intermediate values. These are filtered out in production data mode.
- **`warn`** — something unexpected that the app recovered from: slow responses, fallback paths taken, retries needed.
- **`error`** — something failed: network errors, parse failures, missing data, caught exceptions.

Choose **message strings** that are specific and searchable. Prefer `"Failed to load profile image"` over `"error"`. Use `screenName` to tie events to where they happened in the UI. Use `customAttributes` for structured data you'll want to filter or search on later.

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

**Avoid logging PII** (emails, phone numbers, passwords) or high-frequency events (every frame, every scroll position). Focus on actions and outcomes.

## User Identity

Identity connects events to real users. Before `setUser()` is called, all events are tagged with an anonymous ID (`owl_anon_...`). After login, calling `setUser()` does two things:

1. Tags all future events with the real user ID.
2. Retroactively claims all previous anonymous events for that user (server-side), so you get a complete history.

Call `setUser()` right after successful authentication. Call `clearUser()` on logout to revert to anonymous tracking.

```swift
// After login — claims all previous anonymous events
Owl.setUser("user_123")

// On logout — reverts to anonymous tracking
Owl.clearUser()

// On logout with fresh anonymous ID
Owl.clearUser(newAnonymousId: true)
```

**Important:** The SDK automatically flushes buffered events before claiming identity.

## Funnel Tracking

Funnels measure how users progress through a multi-step flow (onboarding, checkout, activation) and where they drop off. The system has three parts:

1. **Define** the funnel server-side (via CLI or API) with ordered steps and event filters.
2. **Track** steps client-side with `Owl.track("step-name")` — each call emits an event with message `"track:step-name"`.
3. **Query** analytics to see conversion rates and drop-off between steps.

Choose step names that match the `event_filter` in your funnel definition. For example, if the step filter is `{"message": "track:welcome-screen"}`, then call `Owl.track("welcome-screen")`.

Use `attributes` when you need to segment funnel analytics later (e.g., by signup method or referral source).

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

Use structured metrics instead of plain log events when you want aggregated statistics (averages, percentiles, error rates) rather than just a list of individual events. Metrics give you `p50`, `p95`, `p99` latencies, success/failure rates, and trend data over time.

**Decision: lifecycle vs single-shot:**
- **Lifecycle** — when you're measuring something with a duration (start → end). Examples: image upload, API call, video encoding, onboarding flow. The SDK auto-tracks `duration_ms`.
- **Single-shot** — when you're recording a point-in-time value. Examples: app cold-start time, memory usage, items in cart at checkout.

The metric definition must exist on the server **before** the SDK emits events for that slug. Create it via CLI first.

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

OwlMetry provides lightweight client-side A/B testing. The flow is:

1. **Assign a variant**: `getVariant("experiment-name", options: ["control", "variant-a"])` randomly picks a variant on first call.
2. **Render conditionally**: use the returned variant string to show different UI.
3. **Events are auto-tagged**: all subsequent events include the experiment assignment in their `experiments` field.
4. **Analyse**: query funnel or metric data segmented by variant to compare performance.

`getVariant()` persists the assignment in Keychain, so the same user always sees the same variant across launches. Use `setExperiment()` to force a specific variant (e.g., from a server-side feature flag system). Use `clearExperiments()` to reset all assignments (e.g., for testing).

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

## Instrumentation Strategy

When instrumenting a new app, follow this priority:

**Always instrument (events — no CLI setup needed):**
- Screen views (`.owlScreen("ScreenName")` on every distinct screen)
- App launch / cold start (`info` in `init()` or `didFinishLaunching`)
- Authentication events (login, logout, signup)
- Errors and failures (`error` in `catch` blocks, error handlers)
- Core business actions (purchase, share, create, delete)

**Instrument when relevant (metrics — requires CLI `owlmetry metrics create` first):**
- Lifecycle metrics for operations where duration matters: image uploads, API calls, data syncs, video encoding
- Single-shot metrics for point-in-time values: app cold-start time, memory usage, items in cart

**Instrument when relevant (funnels — requires CLI `owlmetry funnels create` first):**
- Multi-step flows you want to measure conversion on: onboarding, checkout, activation
- A/B experiments when testing alternative UI or flows

**Where to place calls:**
- Screen views: `.owlScreen("Name")` on the outermost view of each screen (SwiftUI), `viewDidAppear` in UIKit
- User actions: button action handlers, gesture callbacks
- Errors: `catch` blocks, `Result.failure` handlers
- Metrics: wrap the async operation between `startOperation()` and `complete()`/`fail()`

**What NOT to instrument:**
- PII (emails, phone numbers, passwords, tokens)
- Every UI interaction (every tap, every scroll)
- High-frequency timer events
- Sensitive business data (prices, payment details)

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
- `is_dev` — `true` in DEBUG builds
- `_connection` — network type (wifi, cellular, ethernet, offline) via `NWPathMonitor`
- `experiments` — current A/B experiment assignments
- `environment` — specific runtime (ios, ipados, macos)

**Auto-emitted lifecycle events** (no manual calls needed):
- `sdk:session_started` — on `configure()`, includes `_launch_ms` (time from process start to configure)
- `sdk:app_foregrounded` — when app enters foreground
- `sdk:app_backgrounded` — when app enters background
- `sdk:screen_appeared` (info) / `sdk:screen_disappeared` (debug) — when using `.owlScreen()` modifier (disappear includes `_duration_ms`)
