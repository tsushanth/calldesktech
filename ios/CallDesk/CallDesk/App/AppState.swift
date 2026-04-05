import Foundation

@Observable
final class AppState {
    var currentUser: User?
    var currentTenant: Tenant?
    var tenantId: String?

    var isOnboarded: Bool {
        currentTenant?.settings?.subscriptionStatus == "active" && currentTenant?.phoneNumber != nil
    }

    var hasBusiness: Bool {
        tenantId != nil
    }

    func loadTenant() async {
        guard let _ = KeychainService.shared.getToken() else { return }

        do {
            let response: BusinessListResponse = try await APIClient.shared.request(
                .get,
                path: "/api/business"
            )

            if let first = response.businesses.first {
                currentTenant = first
                tenantId = first.id
            }
        } catch {
            print("Failed to load tenant: \(error)")
        }
    }

    func setTenant(_ tenant: Tenant) {
        currentTenant = tenant
        tenantId = tenant.id
    }

    func clear() {
        currentUser = nil
        currentTenant = nil
        tenantId = nil
    }
}
