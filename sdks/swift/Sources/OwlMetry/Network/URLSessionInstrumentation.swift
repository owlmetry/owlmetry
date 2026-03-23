#if canImport(ObjectiveC)
import Foundation
import ObjectiveC
import os

/// Automatically tracks URLSession network requests by swizzling `resume()` and
/// `dataTask(with:completionHandler:)`. Emits `sdk:network_request` events with
/// sanitized URLs (query params stripped), HTTP method, status, duration, and size.
///
/// Swizzling is one-time and permanent — event emission is controlled by `isEnabled`.
final class URLSessionInstrumentation: @unchecked Sendable {

    private static let logger = Logger(subsystem: Owl.logSubsystem, category: "network")
    private static var isInstalled = false
    private static var isEnabled = false
    /// Full URL prefixes for the SDK's own ingest and claim endpoints, used to filter them out.
    private static var ingestURLPrefix: String?
    private static var claimURLPrefix: String?
    private static let lock = OSAllocatedUnfairLock(initialState: ())
    private static var startTimeKey: UInt8 = 0

    // MARK: - Public API

    static func install(endpoint: URL) {
        let base = endpoint.absoluteString.hasSuffix("/") ? endpoint.absoluteString : endpoint.absoluteString + "/"
        lock.withLock { _ in
            Self.ingestURLPrefix = base + "v1/ingest"
            Self.claimURLPrefix = base + "v1/identity/claim"
            Self.isEnabled = true
            guard !Self.isInstalled else { return }
            Self.isInstalled = true
            Self.swizzleResume()
            Self.swizzleDataTaskWithURLRequestAndCompletionHandler()
            Self.swizzleDataTaskWithURLAndCompletionHandler()
            Self.logger.info("Network request tracking installed")
        }
    }

    static func disable() {
        lock.withLock { _ in
            Self.isEnabled = false
        }
    }

    // MARK: - Swizzling

    private static func swizzleResume() {
        let selector = #selector(URLSessionTask.resume)
        guard let method = class_getInstanceMethod(URLSessionTask.self, selector) else {
            logger.warning("Could not find URLSessionTask.resume — network tracking disabled")
            return
        }
        let originalImp = method_getImplementation(method)
        typealias ResumeFunc = @convention(c) (AnyObject, Selector) -> Void
        let original = unsafeBitCast(originalImp, to: ResumeFunc.self)

        let block: @convention(block) (AnyObject) -> Void = { task in
            if Self.isEnabled, let urlTask = task as? URLSessionTask,
               let url = urlTask.currentRequest?.url,
               !Self.isOwnRequest(url) {
                let startTime = CFAbsoluteTimeGetCurrent()
                objc_setAssociatedObject(
                    urlTask, &Self.startTimeKey,
                    NSNumber(value: startTime),
                    .OBJC_ASSOCIATION_RETAIN_NONATOMIC
                )
            }
            original(task, selector)
        }
        method_setImplementation(method, imp_implementationWithBlock(block))
    }

    private static func swizzleDataTaskWithURLRequestAndCompletionHandler() {
        let selector = NSSelectorFromString("dataTaskWithRequest:completionHandler:")
        guard let method = class_getInstanceMethod(URLSession.self, selector) else {
            logger.warning("Could not find dataTask(with:completionHandler:) URLRequest overload")
            return
        }
        let originalImp = method_getImplementation(method)
        typealias DataTaskFunc = @convention(c) (AnyObject, Selector, URLRequest, @escaping (Data?, URLResponse?, (any Error)?) -> Void) -> URLSessionDataTask
        let original = unsafeBitCast(originalImp, to: DataTaskFunc.self)

        let block: @convention(block) (AnyObject, URLRequest, @escaping (Data?, URLResponse?, (any Error)?) -> Void) -> URLSessionDataTask = { session, request, handler in
            guard Self.isEnabled,
                  let url = request.url,
                  !Self.isOwnRequest(url) else {
                return original(session, selector, request, handler)
            }

            var taskRef: URLSessionDataTask?
            let wrappedHandler: (Data?, URLResponse?, (any Error)?) -> Void = { data, response, error in
                if let task = taskRef {
                    Self.emitNetworkEvent(for: task, data: data, response: response, error: error)
                }
                handler(data, response, error)
            }
            let task = original(session, selector, request, wrappedHandler)
            taskRef = task
            return task
        }
        method_setImplementation(method, imp_implementationWithBlock(block))
    }

    private static func swizzleDataTaskWithURLAndCompletionHandler() {
        let selector = NSSelectorFromString("dataTaskWithURL:completionHandler:")
        guard let method = class_getInstanceMethod(URLSession.self, selector) else {
            logger.warning("Could not find dataTask(with:completionHandler:) URL overload")
            return
        }
        let originalImp = method_getImplementation(method)
        typealias DataTaskFunc = @convention(c) (AnyObject, Selector, URL, @escaping (Data?, URLResponse?, (any Error)?) -> Void) -> URLSessionDataTask
        let original = unsafeBitCast(originalImp, to: DataTaskFunc.self)

        let block: @convention(block) (AnyObject, URL, @escaping (Data?, URLResponse?, (any Error)?) -> Void) -> URLSessionDataTask = { session, url, handler in
            guard Self.isEnabled,
                  !Self.isOwnRequest(url) else {
                return original(session, selector, url, handler)
            }

            var taskRef: URLSessionDataTask?
            let wrappedHandler: (Data?, URLResponse?, (any Error)?) -> Void = { data, response, error in
                if let task = taskRef {
                    Self.emitNetworkEvent(for: task, data: data, response: response, error: error)
                }
                handler(data, response, error)
            }
            let task = original(session, selector, url, wrappedHandler)
            taskRef = task
            return task
        }
        method_setImplementation(method, imp_implementationWithBlock(block))
    }

    // MARK: - Event Emission

    private static func emitNetworkEvent(
        for task: URLSessionTask,
        data: Data?,
        response: URLResponse?,
        error: (any Error)?
    ) {
        guard isEnabled else { return }

        guard let request = task.originalRequest ?? task.currentRequest,
              let url = request.url else { return }

        // Belt-and-suspenders: skip SDK requests even if resume() check missed
        if isOwnRequest(url) { return }

        let method = request.httpMethod ?? "GET"
        let sanitized = sanitizeURL(url)

        // Compute duration from associated start time
        var attrs: [String: String] = [
            "_http_method": method,
            "_http_url": sanitized,
        ]

        if let startNumber = objc_getAssociatedObject(task, &startTimeKey) as? NSNumber {
            let durationMs = Int((CFAbsoluteTimeGetCurrent() - startNumber.doubleValue) * 1000)
            if durationMs >= 0 {
                attrs["_http_duration_ms"] = String(durationMs)
            }
        }

        if let data {
            attrs["_http_response_size"] = String(data.count)
        }

        if let httpResponse = response as? HTTPURLResponse {
            let status = httpResponse.statusCode
            attrs["_http_status"] = String(status)
            if (200..<400).contains(status) {
                Owl.info("sdk:network_request", customAttributes: attrs)
            } else {
                Owl.warn("sdk:network_request", customAttributes: attrs)
            }
        } else if let error {
            attrs["_http_error"] = String(describing: error)
            Owl.error("sdk:network_request", customAttributes: attrs)
        } else {
            Owl.info("sdk:network_request", customAttributes: attrs)
        }
    }

    // MARK: - Request Filtering

    /// Returns true if the URL matches the SDK's own ingest or identity claim endpoints.
    private static func isOwnRequest(_ url: URL) -> Bool {
        let urlString = url.absoluteString
        if let prefix = ingestURLPrefix, urlString.hasPrefix(prefix) { return true }
        if let prefix = claimURLPrefix, urlString.hasPrefix(prefix) { return true }
        return false
    }

    // MARK: - URL Sanitization

    static func sanitizeURL(_ url: URL) -> String {
        var components = URLComponents()
        components.scheme = url.scheme
        components.host = url.host
        if let port = url.port {
            components.port = port
        }
        components.path = url.path
        return components.string ?? url.absoluteString
    }
}
#endif
