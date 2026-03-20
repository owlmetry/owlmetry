import Foundation
import Network
import os

final class NetworkMonitor: Sendable {
    enum NetworkStatus: String, Sendable {
        case wifi
        case cellular
        case ethernet
        case offline
        case unknown
    }

    private let monitor: NWPathMonitor
    private let monitorQueue = DispatchQueue(label: "owlmetry.network", qos: .utility)

    private let _status: OSAllocatedUnfairLock<NetworkStatus>

    var status: NetworkStatus {
        _status.withLock { $0 }
    }

    var isConnected: Bool {
        status != .offline
    }

    init() {
        let monitor = NWPathMonitor()
        self.monitor = monitor

        _status = OSAllocatedUnfairLock(initialState: .unknown)

        monitor.pathUpdateHandler = { [_status] path in
            let newStatus: NetworkStatus
            if path.status != .satisfied {
                newStatus = .offline
            } else if path.usesInterfaceType(.wifi) {
                newStatus = .wifi
            } else if path.usesInterfaceType(.cellular) {
                newStatus = .cellular
            } else if path.usesInterfaceType(.wiredEthernet) {
                newStatus = .ethernet
            } else {
                newStatus = .unknown
            }
            _status.withLock { $0 = newStatus }
        }

        monitor.start(queue: monitorQueue)
    }

    deinit {
        monitor.cancel()
    }
}
