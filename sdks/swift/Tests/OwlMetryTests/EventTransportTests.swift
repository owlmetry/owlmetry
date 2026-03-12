import XCTest
@testable import OwlMetry

final class EventTransportTests: XCTestCase {
    private var tempDir: URL!

    override func setUp() {
        tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        MockURLProtocol.reset()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tempDir)
    }

    func testFlushSendsEventsToServer() async {
        var receivedBody: Data?
        MockURLProtocol.handler = { request in
            receivedBody = request.httpBody ?? request.httpBodyStream.flatMap { stream in
                stream.open()
                let data = Data(reading: stream)
                stream.close()
                return data
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let body = #"{"accepted":1,"rejected":0}"#.data(using: .utf8)!
            return (response, body)
        }

        let transport = makeTransport()
        await transport.enqueue(LogEvent.stub(body: "hello"))
        await transport.flush()

        try? await Task.sleep(nanoseconds: 500_000_000)

        XCTAssertNotNil(receivedBody)
        if let data = receivedBody {
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let events = json?["events"] as? [[String: Any]]
            XCTAssertEqual(events?.count, 1)
            XCTAssertEqual(events?.first?["body"] as? String, "hello")
        }
    }

    func testAuthorizationHeaderSet() async {
        var receivedAuth: String?
        MockURLProtocol.handler = { request in
            receivedAuth = request.value(forHTTPHeaderField: "Authorization")
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let body = #"{"accepted":1,"rejected":0}"#.data(using: .utf8)!
            return (response, body)
        }

        let transport = makeTransport()
        await transport.enqueue(LogEvent.stub(body: "test"))
        await transport.flush()

        try? await Task.sleep(nanoseconds: 500_000_000)

        XCTAssertEqual(receivedAuth, "Bearer owl_client_test123")
    }

    // MARK: - Helpers

    private func makeTransport() -> EventTransport {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: config)

        return EventTransport(
            endpoint: URL(string: "https://api.test.com")!,
            apiKey: "owl_client_test123",
            offlineQueue: OfflineQueue(directory: tempDir),
            networkMonitor: NetworkMonitor(),
            session: session
        )
    }
}

// MARK: - Mock URL Protocol

final class MockURLProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (HTTPURLResponse, Data))?

    static func reset() {
        handler = nil
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            let response = HTTPURLResponse(url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
            return
        }

        let (response, data) = handler(request)
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private extension Data {
    init(reading stream: InputStream) {
        self.init()
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 1024)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: 1024)
            if count > 0 {
                append(buffer, count: count)
            }
        }
    }
}
