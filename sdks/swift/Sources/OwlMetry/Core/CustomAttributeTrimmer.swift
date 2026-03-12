import Foundation

enum CustomAttributeTrimmer {
    static let maxCustomAttributeValueLength = 200

    static func trim(_ customAttributes: [String: String]?) -> [String: String]? {
        guard let customAttributes else { return nil }
        guard !customAttributes.isEmpty else { return customAttributes }

        return customAttributes.mapValues { value in
            if value.count > maxCustomAttributeValueLength {
                let trimmed = String(value.prefix(maxCustomAttributeValueLength))
                return "\(trimmed) [TRIMMED \(value.count)]"
            }
            return value
        }
    }
}
