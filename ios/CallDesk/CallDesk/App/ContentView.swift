import SwiftUI

struct ContentView: View {
    @Environment(AuthService.self) private var authService
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            if !authService.isAuthenticated {
                WelcomeView()
            } else if !appState.isOnboarded {
                OnboardingContainerView()
            } else {
                DashboardTabView()
            }
        }
        .animation(.easeInOut(duration: 0.3), value: authService.isAuthenticated)
        .animation(.easeInOut(duration: 0.3), value: appState.isOnboarded)
        .task {
            if authService.isAuthenticated {
                await appState.loadTenant()
            }
        }
        .onChange(of: authService.isAuthenticated) { _, isAuthenticated in
            if !isAuthenticated {
                appState.clear()
            }
        }
    }
}
