import Foundation

@Observable
final class CallsViewModel {
    var calls: [CallLog] = []
    var totalCount = 0
    var isLoading = false
    var isLoadingMore = false
    var error: String?

    var selectedOutcome: CallOutcome?
    var searchQuery = ""

    private let pageSize = 20
    private var currentOffset = 0
    private var tenantId: String?

    var hasMore: Bool {
        calls.count < totalCount
    }

    func loadCalls(tenantId: String) async {
        self.tenantId = tenantId
        currentOffset = 0
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let response = try await fetchCalls(offset: 0)
            calls = response.calls
            totalCount = response.total
            currentOffset = response.calls.count
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadMore() async {
        guard hasMore, !isLoadingMore, let tenantId else { return }
        _ = tenantId
        isLoadingMore = true
        defer { isLoadingMore = false }

        do {
            let response = try await fetchCalls(offset: currentOffset)
            calls.append(contentsOf: response.calls)
            currentOffset += response.calls.count
        } catch {
            // Silently fail on load more
        }
    }

    func refresh() async {
        guard let tenantId else { return }
        await loadCalls(tenantId: tenantId)
    }

    func filterByOutcome(_ outcome: CallOutcome?) async {
        selectedOutcome = outcome
        guard let tenantId else { return }
        await loadCalls(tenantId: tenantId)
    }

    func search() async {
        guard let tenantId else { return }
        await loadCalls(tenantId: tenantId)
    }

    private func fetchCalls(offset: Int) async throws -> CallsPageResponse {
        var queryItems = [
            URLQueryItem(name: "tenant_id", value: tenantId),
            URLQueryItem(name: "limit", value: "\(pageSize)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
        ]

        if let outcome = selectedOutcome {
            queryItems.append(URLQueryItem(name: "outcome", value: outcome.rawValue))
        }

        if !searchQuery.isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: searchQuery))
        }

        return try await APIClient.shared.request(
            .get,
            path: "/api/mobile/calls",
            queryItems: queryItems
        )
    }
}
