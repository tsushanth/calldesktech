import SwiftUI

@main
struct CallDeskApp: App {
    @State private var appState = AppState()
    @State private var authService = AuthService.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .environment(authService)
        }
    }
}
