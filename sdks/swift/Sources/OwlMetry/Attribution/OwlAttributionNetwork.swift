import Foundation

/// Attribution networks supported by OwlMetry.
///
/// Kept internal: the public Swift API is network-specific (each network has
/// its own capture mechanism and data shape) so consumers never need to
/// reference this type directly. The enum exists so internal code — URL path
/// construction, UserDefaults keys, logging — can share a single vocabulary.
///
/// Adding a future network is a new case + a new capture file alongside
/// `AppleSearchAdsAttribution.swift`.
enum OwlAttributionNetwork: String {
    case appleSearchAds = "apple-search-ads"
    // Future: case meta = "meta"
    // Future: case googleAds = "google-ads"
    // Future: case tiktok = "tiktok"

    /// URL slug matching the server route `/v1/identity/attribution/:source`.
    var slug: String { self.rawValue }

    /// Namespace used for per-network UserDefaults state (capture flags,
    /// retry counters). Scoped under `owlmetry.attribution.<slug>.`.
    var userDefaultsNamespace: String { "owlmetry.attribution.\(self.rawValue)" }
}

/// Outcome of a single attribution submission call, returned by the transport
/// so the caller can decide whether to mark "captured" or leave the flag
/// clear for a next-launch retry.
enum AttributionSubmissionResult {
    /// Server resolved the attribution (may still be `attributed: false`).
    case success(attributionSource: String, properties: [String: String])
    /// Upstream network has no record yet — retry on next launch.
    case pending(retryAfterSeconds: Int)
    /// Token rejected by the network; never retry.
    case invalidToken
    /// Transient transport failure after all retries — clear cache, retry on next launch.
    case transportFailure
}
