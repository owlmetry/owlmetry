import Foundation
import os

enum IdentityManager {
    static let anonymousIdPrefix = "owl_anon_"

    private static let logger = Logger(subsystem: Owl.logSubsystem, category: "identity")

    private static let keychainService = "com.owlmetry.sdk"
    private static let keychainAnonymousIdKey = "anonymousId"
    private static let userDefaultsUserIdKey = "owlmetry.userId"

    // MARK: - Anonymous ID (Keychain-backed, survives reinstalls)

    static func anonymousId() -> String {
        if let existing = readFromKeychain() {
            return existing
        }
        let newId = generateAnonymousId()
        writeToKeychain(newId)
        return newId
    }

    static func resetAnonymousId() -> String {
        deleteFromKeychain()
        let newId = generateAnonymousId()
        writeToKeychain(newId)
        return newId
    }

    private static func generateAnonymousId() -> String {
        "\(anonymousIdPrefix)\(UUID().uuidString)"
    }

    // MARK: - Real User ID (UserDefaults-backed)

    static func savedUserId() -> String? {
        UserDefaults.standard.string(forKey: userDefaultsUserIdKey)
    }

    static func saveUserId(_ id: String) {
        UserDefaults.standard.set(id, forKey: userDefaultsUserIdKey)
    }

    static func clearUserId() {
        UserDefaults.standard.removeObject(forKey: userDefaultsUserIdKey)
    }

    // MARK: - Keychain Operations

    private static func readFromKeychain() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAnonymousIdKey,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private static func writeToKeychain(_ value: String) {
        guard let data = value.data(using: .utf8) else { return }

        // Delete any existing entry first
        deleteFromKeychain()

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAnonymousIdKey,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        if status != errSecSuccess {
            logger.warning("Failed to write anonymous ID to Keychain (status: \(status))")
        }
    }

    private static func deleteFromKeychain() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAnonymousIdKey,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
