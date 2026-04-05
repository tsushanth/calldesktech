import Foundation

@Observable
final class DashboardViewModel {
    var stats = DashboardStats()
    var recentCalls: [CallLog] = []
    var isLoading = false
    var error: String?

    func loadDashboard(tenantId: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let data: DashboardData = try await APIClient.shared.request(
                .get,
                path: "/api/mobile/dashboard",
                queryItems: [URLQueryItem(name: "tenant_id", value: tenantId)]
            )
            stats = data.stats
            recentCalls = data.recentCalls
        } catch {
            self.error = error.localizedDescription
        }
    }
}
