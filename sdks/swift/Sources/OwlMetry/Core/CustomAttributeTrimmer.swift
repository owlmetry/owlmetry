import Foundation

enum CustomAttributeTrimmer {
    static let maxCustomAttributeValueLength = 200

    static func trim(_ customAttributes: [String: String]?) -> [String: String]? {
        guard let customAttributes else { return nil }
        guard !customAttributes.isEmpty else { return customAttributes }

        return customAttributes.mapValues { value in
            if value.count > maxCustomAttributeValueLength {
                return String(value.prefix(maxCustomAttributeValueLength))
            }
            return value
        }
    }
}
