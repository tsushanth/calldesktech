import SwiftUI

struct DashboardTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }
                .tag(0)

            CallsListView()
                .tabItem {
                    Label("Calls", systemImage: "phone.fill")
                }
                .tag(1)

            KnowledgeView()
                .tabItem {
                    Label("Knowledge", systemImage: "book.fill")
                }
                .tag(2)

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
                .tag(3)
        }
        .tint(Color.brand)
    }
}
