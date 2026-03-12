import Compression
import Foundation

enum GzipError: Error {
    case compressionFailed
}

extension Data {
    /// Compresses data using gzip format (RFC 1952).
    func gzipped() throws -> Data {
        guard !isEmpty else { return self }

        // Compress with zlib (raw deflate)
        let sourceSize = count
        let destinationSize = sourceSize + sourceSize / 10 + 128 // generous buffer
        var destinationBuffer = [UInt8](repeating: 0, count: destinationSize)

        let compressedSize = withUnsafeBytes { sourcePtr in
            compression_encode_buffer(
                &destinationBuffer,
                destinationSize,
                sourcePtr.bindMemory(to: UInt8.self).baseAddress!,
                sourceSize,
                nil,
                COMPRESSION_ZLIB
            )
        }

        guard compressedSize > 0 else { throw GzipError.compressionFailed }

        // Build gzip: header + deflate payload + trailer
        var result = Data(capacity: 10 + compressedSize + 8)

        // 10-byte gzip header
        result.append(contentsOf: [
            0x1F, 0x8B, // magic
            0x08,       // method: deflate
            0x00,       // flags
            0x00, 0x00, 0x00, 0x00, // mtime
            0x00,       // extra flags
            0x03,       // OS: Unix
        ] as [UInt8])

        // Compressed data
        result.append(contentsOf: destinationBuffer[0..<compressedSize])

        // 8-byte trailer: CRC32 + original size (both little-endian)
        let crc = crc32(of: self)
        result.append(UInt8(crc & 0xFF))
        result.append(UInt8((crc >> 8) & 0xFF))
        result.append(UInt8((crc >> 16) & 0xFF))
        result.append(UInt8((crc >> 24) & 0xFF))

        let size = UInt32(truncatingIfNeeded: sourceSize)
        result.append(UInt8(size & 0xFF))
        result.append(UInt8((size >> 8) & 0xFF))
        result.append(UInt8((size >> 16) & 0xFF))
        result.append(UInt8((size >> 24) & 0xFF))

        return result
    }

    private func crc32(of data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        data.withUnsafeBytes { ptr in
            let bytes = ptr.bindMemory(to: UInt8.self)
            for byte in bytes {
                let index = Int((crc ^ UInt32(byte)) & 0xFF)
                crc = Self.crc32Table[index] ^ (crc >> 8)
            }
        }
        return crc ^ 0xFFFF_FFFF
    }

    // Standard CRC-32 lookup table (polynomial 0xEDB88320)
    // swiftlint:disable comma
    private static let crc32Table: [UInt32] = {
        (0..<256).map { i -> UInt32 in
            var c = UInt32(i)
            for _ in 0..<8 {
                c = (c & 1 != 0) ? (0xEDB88320 ^ (c >> 1)) : (c >> 1)
            }
            return c
        }
    }()
    // swiftlint:enable comma
}
