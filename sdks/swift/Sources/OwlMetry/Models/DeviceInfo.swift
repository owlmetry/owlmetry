import Foundation

#if canImport(UIKit)
import UIKit
#endif

struct DeviceInfo: Sendable {
    let platform: OwlPlatform
    let osVersion: String
    let appVersion: String?
    let buildNumber: String?
    let deviceModel: String
    let locale: String

    static func collect() -> DeviceInfo {
        DeviceInfo(
            platform: detectPlatform(),
            osVersion: formatOSVersion(),
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
            buildNumber: Bundle.main.infoDictionary?["CFBundleVersion"] as? String,
            deviceModel: getDeviceModel(),
            locale: Locale.current.identifier
        )
    }

    private static func detectPlatform() -> OwlPlatform {
        #if os(macOS)
        return .macos
        #else
        if ProcessInfo.processInfo.isMacCatalystApp {
            return .macos
        } else if UIDevice.current.userInterfaceIdiom == .pad {
            return .ipados
        } else {
            return .ios
        }
        #endif
    }

    private static func formatOSVersion() -> String {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        return "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
    }

    private static func getDeviceModel() -> String {
        var size = 0
        guard sysctlbyname("hw.machine", nil, &size, nil, 0) == 0, size > 0 else {
            return "Unknown"
        }
        var machine = [CChar](repeating: 0, count: size)
        guard sysctlbyname("hw.machine", &machine, &size, nil, 0) == 0 else {
            return "Unknown"
        }
        return String(cString: machine)
    }
}
