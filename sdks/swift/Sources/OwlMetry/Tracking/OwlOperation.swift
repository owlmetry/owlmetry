import Foundation

/// Tracks a metric operation lifecycle (start → complete/fail/cancel).
/// Created by `Owl.startOperation()` — do not instantiate directly.
public final class Operation: Sendable {
    public let trackingId: String
    let metric: String
    let startTime: ContinuousClock.Instant

    init(metric: String) {
        self.trackingId = UUID().uuidString
        self.metric = metric
        self.startTime = ContinuousClock.now
    }

    /// Complete the operation successfully. Auto-adds duration_ms.
    public func complete(
        attributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        var attrs = attributes ?? [:]
        attrs["tracking_id"] = trackingId
        attrs["duration_ms"] = String(durationMs())
        Owl.info("metric:\(metric):complete", customAttributes: attrs, file: file, function: function, line: line)
    }

    /// Record a failed operation. Auto-adds duration_ms + error.
    public func fail(
        error: String,
        attributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        var attrs = attributes ?? [:]
        attrs["tracking_id"] = trackingId
        attrs["duration_ms"] = String(durationMs())
        attrs["error"] = error
        Owl.error("metric:\(metric):fail", customAttributes: attrs, file: file, function: function, line: line)
    }

    /// Cancel the operation. Auto-adds duration_ms.
    public func cancel(
        attributes: [String: String]? = nil,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        var attrs = attributes ?? [:]
        attrs["tracking_id"] = trackingId
        attrs["duration_ms"] = String(durationMs())
        Owl.info("metric:\(metric):cancel", customAttributes: attrs, file: file, function: function, line: line)
    }

    private func durationMs() -> Int {
        let elapsed = ContinuousClock.now - startTime
        return Int(elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000)
    }
}
