import Foundation
import Network
import os

final class NetworkMonitor: Sendable {
    private let monitor: NWPathMonitor
    private let monitorQueue = DispatchQueue(label: "owlmetry.network", qos: .utility)

    private let _isConnected: OSAllocatedUnfairLock<Bool>
    private let _continuation: OSAllocatedUnfairLock<AsyncStream<Bool>.Continuation?>

    let connectivityStream: AsyncStream<Bool>

    var isConnected: Bool {
        _isConnected.withLock { $0 }
    }

    init() {
        let monitor = NWPathMonitor()
        self.monitor = monitor

        _isConnected = OSAllocatedUnfairLock(initialState: true)
        _continuation = OSAllocatedUnfairLock<AsyncStream<Bool>.Continuation?>(initialState: nil)

        let (stream, continuation) = AsyncStream.makeStream(of: Bool.self)
        self.connectivityStream = stream
        _continuation.withLock { $0 = continuation }

        monitor.pathUpdateHandler = { [_isConnected, _continuation] path in
            let connected = path.status == .satisfied
            _isConnected.withLock { $0 = connected }
            _ = _continuation.withLock { $0?.yield(connected) }
        }

        monitor.start(queue: monitorQueue)
    }

    deinit {
        monitor.cancel()
        _continuation.withLock { $0?.finish() }
    }
}
