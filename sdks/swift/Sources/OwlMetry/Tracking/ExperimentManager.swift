import Foundation
import os

/// Keychain-backed experiment variant store. Thread-safe via a serial dispatch queue.
/// Persists experiment assignments as a JSON dictionary in the Keychain so they survive
/// app restarts and reinstalls.
final class ExperimentManager: Sendable {
    static let shared = ExperimentManager()

    private static let logger = Logger(subsystem: Owl.logSubsystem, category: "experiments")
    private static let keychainService = "com.owlmetry.experiments"
    private static let keychainAccount = "assignments"

    private let queue = DispatchQueue(label: "com.owlmetry.experiments.queue")

    /// In-memory cache (access only on `queue`).
    private let _assignments: OSAllocatedUnfairLock<[String: String]>

    private init() {
        _assignments = OSAllocatedUnfairLock(initialState: ExperimentManager.loadFromKeychain())
    }

    // MARK: - Public API

    /// Returns the variant for `name`. On first call, picks a random variant from `options`
    /// and persists it. Subsequent calls return the stored variant (options are ignored).
    func getVariant(_ name: String, options: [String]) -> String {
        _assignments.withLock { assignments in
            if let existing = assignments[name] {
                return existing
            }
            guard !options.isEmpty else {
                Self.logger.warning("getVariant(\"\(name)\") called with empty options array")
                return ""
            }
            let variant = options.randomElement()!
            assignments[name] = variant
            Self.saveToKeychain(assignments)
            return variant
        }
    }

    /// Force-set a specific variant (e.g. from server-side assignment).
    func setExperiment(_ name: String, variant: String) {
        _assignments.withLock { assignments in
            assignments[name] = variant
            Self.saveToKeychain(assignments)
        }
    }

    /// Returns a snapshot of all experiment assignments. Empty dict if none.
    func allExperiments() -> [String: String] {
        _assignments.withLock { $0 }
    }

    /// Remove all experiment assignments from memory and Keychain.
    func clearAll() {
        _assignments.withLock { assignments in
            assignments.removeAll()
            Self.deleteFromKeychain()
        }
    }

    // MARK: - Keychain Operations

    private static func loadFromKeychain() -> [String: String] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return [:]
        }

        do {
            if let dict = try JSONSerialization.jsonObject(with: data) as? [String: String] {
                return dict
            }
        } catch {
            logger.warning("Failed to decode experiments from Keychain: \(error.localizedDescription)")
        }
        return [:]
    }

    private static func saveToKeychain(_ assignments: [String: String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: assignments) else { return }

        // Try to update first
        let searchQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]

        let updateAttributes: [String: Any] = [
            kSecValueData as String: data,
        ]

        let updateStatus = SecItemUpdate(searchQuery as CFDictionary, updateAttributes as CFDictionary)

        if updateStatus == errSecItemNotFound {
            // Item doesn't exist yet — add it
            var addQuery = searchQuery
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            if addStatus != errSecSuccess {
                logger.warning("Failed to save experiments to Keychain (status: \(addStatus))")
            }
        } else if updateStatus != errSecSuccess {
            logger.warning("Failed to update experiments in Keychain (status: \(updateStatus))")
        }
    }

    private static func deleteFromKeychain() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
