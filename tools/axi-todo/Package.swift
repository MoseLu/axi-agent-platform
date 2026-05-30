// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "AxiTodo",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .library(name: "AxiTodoKit", targets: ["AxiTodoKit"]),
        .executable(name: "AxiTodoDesktop", targets: ["AxiTodoDesktop"]),
        .executable(name: "AxiTodoStoreSmokeTests", targets: ["AxiTodoStoreSmokeTests"]),
    ],
    targets: [
        .target(name: "AxiTodoKit"),
        .executableTarget(
            name: "AxiTodoDesktop",
            dependencies: ["AxiTodoKit"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
            ]
        ),
        .executableTarget(
            name: "AxiTodoStoreSmokeTests",
            dependencies: ["AxiTodoKit"]
        ),
    ]
)
