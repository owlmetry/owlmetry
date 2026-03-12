// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "OwlMetry",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "OwlMetry", targets: ["OwlMetry"]),
    ],
    targets: [
        .target(name: "OwlMetry"),
        .testTarget(name: "OwlMetryTests", dependencies: ["OwlMetry"]),
    ]
)
