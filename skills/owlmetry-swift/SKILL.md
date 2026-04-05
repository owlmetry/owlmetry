---
name: owlmetry-swift
version: 0.1.17
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

1. **Skill version**: `curl -sf https://raw.githubusercontent.com/Jasonvdb/owlmetry/main/skills/owlmetry-swift/SKILL.md | head -5` — compare the remote `version:` field to this file's `version:` frontmatter above. If the remote version is newer, ask the user if they want to update.
2. **SDK version**: Read `Package.resolved` for the current resolved revision, then compare against `curl -sf https://api.github.com/repos/Jasonvdb/owlmetry/releases/latest | jq -r .tag_name`. If newer, inform the user.

## Prerequisite

You need an **ingest endpoint** and a **client key** (`owl_client_...`) for an Apple-platform app. Both come from the CLI setup flow.

If the user doesn't have these yet, follow the `/owlmetry-cli` skill first — it handles sign-up, project creation, and app creation. The ingest endpoint is saved to `~/.owlmetry/config.json` (`ingest_endpoint` field) and the client key is returned when creating an app.

> **Any time you need to run an `owlmetry` CLI command** (querying events, creating metrics/funnels, listing apps, etc.), **load the `/owlmetry-cli` skill first**. Do not guess CLI syntax — it has non-obvious subcommand patterns and flags.

## Add Swift Package

**Minimum platforms:** iOS 16.0, macOS 13.0. Zero external dependencies.

### Option A — Package.swift projects

If the project has a `Package.swift`, add the dependency there:

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

Then run `swift package resolve` to fetch the dependency.

### Option B — Xcode projects (.xcodeproj)

For `.xcodeproj`-based projects with no `Package.swift`, add the OwlMetry Swift package by editing `<Project>.xcodeproj/project.pbxproj` directly to add a remote Swift package reference for `https://github.com/Jasonvdb/owlmetry.git` (branch: `main`, product: `OwlMetry`). Do not ask the user to add it manually in Xcode.

### Option C — Ask the user (last resort)

If pbxproj editing fails or the project structure is too complex, ask the user to add the package in Xcode:

1. File > Add Package Dependencies
2. Enter URL: `https://github.com/Jasonvdb/owlmetry.git`
3. Set rule to **Branch** > `main`
4. Add **OwlMetry** to the app target

## Verify Package Integration

After adding the package, resolve dependencies and build:

```bash
xcodebuild -resolvePackageDependencies -project <path>.xcodeproj -quiet
xcodebuild -project <path>.xcodeproj -scheme <SchemeName> -destination 'platform=iOS Simulator,name=iPhone 16' build -quiet
```

If the build succeeds, proceed with configuration. The "No such module 'OwlMetry'" warning in editors (SourceKit) is expected and resolves during a real `xcodebuild`.

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
- `networkTrackingEnabled: Bool` — auto-track URLSession HTTP requests (default: `true`)
- `consoleLogging: Bool` — print events to console/Xcode output (default: `true`)

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

Once `Owl.configure()` is in place and the project builds successfully, **you MUST stop here and ask the user** which area they'd like to instrument first — even if the user's original prompt asked you to "instrument the app." Do not proceed with any code changes until the user chooses. Present these options:

1. **Screen tracking** — Add `.owlScreen("ScreenName")` to every distinct screen in the app. This is the quickest win — automatic screen view and time-on-screen tracking with a single modifier per screen. No CLI setup needed.
2. **Event & error logging** — Audit the codebase for user actions, error handling, and key flows. Add `Owl.info()`, `Owl.warn()`, `Owl.error()` calls at meaningful points. This is SDK-only — no CLI setup required beyond what's already done.
3. **Structured metrics** — Identify operations worth measuring (data loading, image processing, etc.). Add `Owl.startOperation()` / `Owl.recordMetric()` to track durations and success rates. **Requires CLI first:** each metric slug must be defined on the server via `owlmetry metrics create` (use the `/owlmetry-cli` skill) before the SDK can emit events for it.
4. **Funnel tracking** — Identify user journeys (onboarding, checkout, key conversions). Add `Owl.step()` calls at each step to measure drop-off. **Requires CLI first:** the funnel definition (with steps and event filters) must be created via `owlmetry funnels create` (use the `/owlmetry-cli` skill) before tracking makes sense.

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

## Network Request Tracking

The SDK automatically tracks all URLSession HTTP requests made via completion handler APIs. This is **enabled by default** — no code needed beyond `Owl.configure()`. To disable:

```swift
try Owl.configure(
    endpoint: "https://ingest.owlmetry.com",
    apiKey: "owl_client_...",
    networkTrackingEnabled: false
)
```

**What it captures automatically:**
- `_http_method` — GET, POST, etc.
- `_http_url` — sanitized URL (scheme + host + path only, query params stripped for privacy)
- `_http_status` — response status code
- `_http_duration_ms` — request duration in milliseconds
- `_http_response_size` — response body size in bytes
- `_http_error` — error description (failures only)

**Log levels:** `.info` for 2xx/3xx responses, `.warn` for 4xx/5xx, `.error` for network failures (no response).

**Safety:** The SDK's own requests to the OwlMetry ingest endpoint are automatically filtered out. Query parameters are stripped from URLs to prevent accidental logging of tokens or user IDs.

**Coverage:** Tracks requests made with `URLSession.dataTask(with:completionHandler:)` (both URL and URLRequest overloads). Delegate-based and async/await requests are not tracked in this version.

## Log Events

Events are the core unit of data in OwlMetry. Use the four log levels to capture different kinds of information:

- **`info`** — normal operations worth recording: screen views, user actions, feature usage, successful completions. This is your default level.
- **`debug`** — verbose detail useful only during development: cache hits, state transitions, intermediate values. These are filtered out in production data mode.
- **`warn`** — something didn't go as expected but the app can continue: failed validation, precondition checks that fail, slow responses, fallback paths taken, deprecated API usage, missing optional data.
- **`error`** — a caught exception or hard failure inside a `do`/`catch` block: network errors, JSON decode failures, file I/O errors, keychain access failures. Reserve for actual thrown errors, not for anticipated validation outcomes.

Choose **message strings** that are specific and searchable. Prefer `"Failed to load profile image"` over `"error"`. Use `screenName` to tie events to where they happened in the UI. Use `attributes` for structured data you'll want to filter or search on later.

```swift
// In a screen context — pass screenName to tie the event to the screen
Owl.info("User opened settings", screenName: "SettingsView")
Owl.debug("Cache hit", screenName: "HomeView", attributes: ["key": "user_prefs"])
Owl.warn("Invalid email format", screenName: "SignUpView", attributes: ["input": email])

do {
    let profile = try await api.loadProfile(id: userId)
} catch {
    Owl.error("Failed to load profile", screenName: "ProfileView", attributes: ["error": "\(error)"])
}

// Outside a screen context — omit screenName entirely
Owl.info("Background sync completed", attributes: ["items": "\(count)"])
Owl.error("Keychain write failed", attributes: ["error": "\(error)"])
```

All logging methods share the same signature:
```swift
Owl.info(_ message: String, screenName: String? = nil, attributes: [String: String]? = nil)
```

**`screenName` is optional.** Only pass it when the event originates from a specific screen in the UI (e.g., a button tap handler inside a view). **Do NOT pass `screenName`** when logging from utility functions, services, managers, network layers, background tasks, or anywhere that isn't directly tied to a visible screen. Passing a fabricated or guessed screen name is worse than omitting it — it pollutes screen-level analytics.

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
2. **Record** steps client-side with `Owl.step("step-name")`.
3. **Query** analytics to see conversion rates and drop-off between steps.

The step name you pass to `Owl.step()` must match the `step_name` in the funnel definition's `event_filter`. For example, if the step filter is `{"step_name": "welcome-screen"}`, then call `Owl.step("welcome-screen")`.

**Funnel design rules:**
- Each step must be a point that **every user in the funnel passes through** on the way to the goal. If a step is conditional (e.g., paywall only shown to free users), it breaks the chain — users who skip it show as 0% conversion from that point.
- Keep funnels focused on **one flow**. Don't combine "import a model" + "explore features" into one funnel — those are separate journeys with separate goals.
- **Optional interactions are not steps.** Toggling a setting, viewing info, or using a tool are engagement events (log with `Owl.info()`), not funnel progression. A funnel step should represent the user moving closer to the goal.
- Split alternative paths into **separate funnels**. If users can take a screenshot OR record a video, create two funnels — don't put both paths in one.
- Aim for **3-6 steps** per funnel. Too few = no drop-off insight. Too many = noise.

Use `attributes` when you need to segment funnel analytics later (e.g., by signup method or referral source).

```swift
Owl.step("welcome-screen")
Owl.step("create-account", attributes: ["method": "email"])
Owl.step("complete-profile")
Owl.step("first-post")
```

Define matching funnel definitions via `/owlmetry-cli`:
```bash
# Write steps to a JSON file (avoids shell quoting issues)
cat > /tmp/funnel-steps.json << 'EOF'
[
  {"name": "Welcome", "event_filter": {"step_name": "welcome-screen"}},
  {"name": "Account", "event_filter": {"step_name": "create-account"}},
  {"name": "Profile", "event_filter": {"step_name": "complete-profile"}},
  {"name": "First Post", "event_filter": {"step_name": "first-post"}}
]
EOF

owlmetry funnels create --project-id <id> --name "Onboarding" --slug onboarding \
  --steps-file /tmp/funnel-steps.json --format json
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

`duration_ms` and `tracking_id` (UUID) are auto-added.

**Rules for lifecycle operations:**

- **Every `startOperation()` must end** with exactly one `.complete()`, `.fail()`, or `.cancel()`. An operation that starts but never ends creates orphaned metric data with no duration.
- **`.complete()`** — the operation succeeded and produced its intended result.
- **`.fail(error:)`** — the operation attempted work but encountered an error.
- **`.cancel()`** — the operation was intentionally stopped before completion (user cancelled, view disappeared, became irrelevant).
- **Don't start for no-ops** — if the operation is skipped entirely (cache hit, dedup, precondition not met), don't call `startOperation()` at all. Only start when actual work begins.
- **Don't track duration manually** — `duration_ms` is auto-calculated from start to complete/fail/cancel. Never pass a manual duration attribute.
- **Long-lived operations** — if the operation outlives the scope where it was started (e.g., recording that spans a view lifecycle), store the `OwlOperation` handle as a property. Cancel it on cleanup (`.onDisappear`, `deinit`) if it hasn't ended yet:

```swift
// Store handle for operations that span a lifecycle
@State private var recordingOp: OwlOperation?

func startRecording() {
    recordingOp = Owl.startOperation("video-recording")
    // ... begin recording
}

func stopRecording(url: URL) {
    recordingOp?.complete(attributes: ["format": "mp4"])
    recordingOp = nil
}

func onError(_ error: Error) {
    recordingOp?.fail(error: error.localizedDescription)
    recordingOp = nil
}

// Safety net: cancel if view disappears mid-operation
.onDisappear {
    recordingOp?.cancel()
    recordingOp = nil
}
```

Create the metric definition first:
```bash
owlmetry metrics create --project-id <id> --name "Photo Upload" --slug photo-upload --lifecycle --format json
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

## User Properties

Attach custom key-value metadata to the current user. Properties are merged server-side — existing keys not in your call are preserved.

```swift
Owl.setUserProperties([
    "plan": "premium",
    "org": "acme",
])
```

Set a value to `""` to delete a key. All values must be strings. Max 50 properties per user, 50-char keys, 200-char values.

Properties follow the current user identity. If the user is anonymous, properties are set on the anonymous user and merged into the real user on `Owl.setUser()`.

Use for user-level data that changes infrequently (subscription status, plan tier, company). For event-specific data, use `attributes` on events instead.

**RevenueCat integration prompt** — copy-paste to set up subscription tracking:

```
Connect RevenueCat to my OwlMetry project so I can see paid vs free users:

1. Use `/owlmetry-cli` to add the RevenueCat integration with my RC V2 secret API key
   (needs Customer information → Customers Configuration → Read only, everything else No access).
2. Show me the webhook setup values from the output so I can paste them into RevenueCat.
3. After I confirm the webhook is live, run a bulk sync to backfill existing subscribers.
4. Add Owl.setUserProperties() calls in my RevenueCat Purchases delegate or
   StoreKit transaction handler so the dashboard updates immediately when a user
   subscribes, without waiting for RevenueCat's webhook.
```

## What the SDK Tracks Automatically

Do not re-implement any of these — they are built into the SDK and emitted without any code:

- **`sdk:configured`** — emitted on `Owl.configure()`
- **`sdk:backgrounded`** / **`sdk:foregrounded`** — app state transitions
- **`sdk:shutdown`** — on `Owl.shutdown()`
- **`session_id`** — fresh UUID per `configure()` call, included on every event
- **`_launch_time_ms`** — app launch time, included in the `session_started` event
- **`_connection`** — network type (wifi, cellular, etc.), included on every event
- **Device model, OS version, locale** — included on every event
- **`is_dev`** — automatically `true` in DEBUG builds

You do NOT need to manually track app launch, app foreground/background, session start, network type, or device info. These are already covered.

## Instrumentation Strategy

When instrumenting a new app, follow this priority:

**Always instrument (events — no CLI setup needed):**
- Screen views (`.owlScreen("ScreenName")` on every distinct screen)
- Authentication events (login, logout, signup)
- Caught exceptions (`error` in `catch` blocks, error handlers)
- Validation failures and pre-checks (`warn` for bad input, missing optional data, fallback paths)
- Core business actions (purchase, share, create, delete)

**Instrument when relevant (metrics — requires CLI `owlmetry metrics create` first):**
- Lifecycle metrics for operations where duration matters: image uploads, API calls, data syncs, video encoding
- Single-shot metrics for point-in-time values: app cold-start time, memory usage, items in cart

**Instrument when relevant (funnels — requires CLI `owlmetry funnels create` first):**
- Multi-step flows you want to measure conversion on: onboarding, checkout, activation
- A/B experiments when testing alternative UI or flows

**Where to place calls:**
- Screen views: `.owlScreen("Name")` on the outermost view of each screen (SwiftUI), `viewDidAppear` in UIKit
- User actions: button action handlers, gesture callbacks — pass `screenName` since you know which screen the user is on
- Errors: `catch` blocks, `Result.failure` handlers — pass `screenName` only if the error is caught inside a view; omit it if caught in a service, manager, or utility
- Services, utilities, background tasks: log freely but **never pass `screenName`** — these are not screen-bound
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
- `sdk:network_request` (info/warn/error) — URLSession HTTP requests with method, URL, status, duration (enabled by default, disable with `networkTrackingEnabled: false`)
