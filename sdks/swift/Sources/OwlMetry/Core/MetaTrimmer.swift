import Foundation

enum MetaTrimmer {
    static let maxMetaValueLength = 200

    static func trim(_ meta: [String: String]?) -> [String: String]? {
        guard let meta else { return nil }
        guard !meta.isEmpty else { return meta }

        return meta.mapValues { value in
            if value.count > maxMetaValueLength {
                let trimmed = String(value.prefix(maxMetaValueLength))
                return "\(trimmed) [TRIMMED \(value.count)]"
            }
            return value
        }
    }
}
