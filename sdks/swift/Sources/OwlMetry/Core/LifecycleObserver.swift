import Foundation
import os

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

final class LifecycleObserver: @unchecked Sendable {
    private let transport: EventTransport
    private let offlineQueue: OfflineQueue
    private let logger = Logger(subsystem: Owl.logSubsystem, category: "lifecycle")
    private var observers: [NSObjectProtocol] = []

    init(transport: EventTransport, offlineQueue: OfflineQueue) {
        self.transport = transport
        self.offlineQueue = offlineQueue
    }

    func start() {
        #if canImport(UIKit) && !os(watchOS)
        observers.append(
            NotificationCenter.default.addObserver(
                forName: UIApplication.didEnterBackgroundNotification,
                object: nil, queue: .main
            ) { [weak self] _ in
                self?.handleBackground()
            }
        )
        observers.append(
            NotificationCenter.default.addObserver(
                forName: UIApplication.willEnterForegroundNotification,
                object: nil, queue: .main
            ) { _ in
                Owl.info("sdk:app_foregrounded")
            }
        )
        observers.append(
            NotificationCenter.default.addObserver(
                forName: UIApplication.willTerminateNotification,
                object: nil, queue: .main
            ) { [weak self] _ in
                self?.handleTermination()
            }
        )
        #elseif canImport(AppKit)
        observers.append(
            NotificationCenter.default.addObserver(
                forName: NSApplication.didBecomeActiveNotification,
                object: nil, queue: .main
            ) { _ in
                Owl.info("sdk:app_foregrounded")
            }
        )
        observers.append(
            NotificationCenter.default.addObserver(
                forName: NSApplication.willTerminateNotification,
                object: nil, queue: .main
            ) { [weak self] _ in
                self?.handleTermination()
            }
        )
        #endif
    }

    func stop() {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers.removeAll()
    }

    #if canImport(UIKit) && !os(watchOS)
    private func handleBackground() {
        let application = UIApplication.shared
        var taskId: UIBackgroundTaskIdentifier = .invalid

        taskId = application.beginBackgroundTask(withName: "owlmetry.flush") { [self] in
            logger.warning("Background flush time expired, persisting to disk")
            Task {
                await self.transport.persistBufferToDisk()
                application.endBackgroundTask(taskId)
            }
        }

        guard taskId != .invalid else {
            // Couldn't acquire background time — persist to disk as best-effort
            Task { await transport.persistBufferToDisk() }
            return
        }

        Owl.info("sdk:app_backgrounded")

        Task {
            await self.transport.flushAll()
            application.endBackgroundTask(taskId)
        }
    }
    #endif

    private func handleTermination() {
        let semaphore = DispatchSemaphore(value: 0)
        Task {
            await self.transport.persistBufferToDisk()
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 2)
    }
}
