import SwiftUI

struct CallsListView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = CallsViewModel()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                filterChips
                searchBar
                callListContent
            }
            .navigationTitle("Calls")
            .navigationDestination(for: CallLog.self) { call in
                CallDetailView(callId: call.id)
            }
            .refreshable {
                await viewModel.refresh()
            }
            .task {
                if let tenantId = appState.tenantId {
                    await viewModel.loadCalls(tenantId: tenantId)
                }
            }
        }
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterChip(title: "All", isSelected: viewModel.selectedOutcome == nil) {
                    Task { await viewModel.filterByOutcome(nil) }
                }
                ForEach(CallOutcome.allCases) { outcome in
                    FilterChip(title: outcome.displayName, isSelected: viewModel.selectedOutcome == outcome) {
                        Task { await viewModel.filterByOutcome(outcome) }
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
    }

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search by phone number...", text: $viewModel.searchQuery)
                .textInputAutocapitalization(.never)
                .onSubmit { Task { await viewModel.search() } }
            if !viewModel.searchQuery.isEmpty {
                Button {
                    viewModel.searchQuery = ""
                    Task { await viewModel.refresh() }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(10)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private var callListContent: some View {
        if viewModel.isLoading && viewModel.calls.isEmpty {
            LoadingView()
        } else if viewModel.calls.isEmpty {
            emptyState
        } else {
            callList
        }
    }

    private var callList: some View {
        List {
            ForEach(viewModel.calls) { call in
                NavigationLink(value: call) {
                    CallRow(call: call)
                }
                .onAppear {
                    if call.id == viewModel.calls.last?.id {
                        Task { await viewModel.loadMore() }
                    }
                }
            }
            if viewModel.isLoadingMore {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
                .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "phone.badge.waveform")
                .font(.largeTitle)
                .foregroundStyle(.tertiary)
            Text("No calls found")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct CallRow: View {
    let call: CallLog

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(call.callerPhone)
                    .font(.body)
                    .fontWeight(.medium)
                if let date = call.createdAt.isoDate {
                    Text(date.shortFormatted)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                OutcomeBadge(outcome: call.outcome)
                Text(call.formattedDuration)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct FilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .fontWeight(isSelected ? .semibold : .regular)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(isSelected ? Color.brand : Color(.systemGray6))
                .foregroundStyle(isSelected ? .white : .primary)
                .clipShape(Capsule())
        }
    }
}
