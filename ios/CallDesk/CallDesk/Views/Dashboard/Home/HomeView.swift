import SwiftUI

struct HomeView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = DashboardViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    if let error = viewModel.error {
                        ErrorBanner(message: error) {
                            viewModel.error = nil
                        }
                    }

                    // Stats grid
                    LazyVGrid(columns: [
                        GridItem(.flexible()),
                        GridItem(.flexible()),
                    ], spacing: 12) {
                        StatCardView(
                            title: "Total Calls",
                            value: "\(viewModel.stats.totalCalls)",
                            icon: "phone.fill",
                            color: .brand
                        )
                        StatCardView(
                            title: "Today",
                            value: "\(viewModel.stats.todayCalls)",
                            icon: "clock.fill",
                            color: .successGreen
                        )
                        StatCardView(
                            title: "Bookings",
                            value: "\(viewModel.stats.totalBookings)",
                            icon: "calendar.badge.plus",
                            color: .purple
                        )
                        StatCardView(
                            title: "Avg Duration",
                            value: formatDuration(viewModel.stats.avgDuration),
                            icon: "timer",
                            color: .orange
                        )
                    }

                    // Phone number
                    if let phoneNumber = appState.currentTenant?.phoneNumber {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Your AI Number")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(phoneNumber)
                                    .font(.headline)
                                    .fontWeight(.semibold)
                            }
                            Spacer()
                            Button {
                                if let url = URL(string: "tel:\(phoneNumber.replacingOccurrences(of: " ", with: ""))") {
                                    UIApplication.shared.open(url)
                                }
                            } label: {
                                Image(systemName: "phone.circle.fill")
                                    .font(.title)
                                    .foregroundStyle(Color.brand)
                            }
                        }
                        .padding()
                        .background(Color.brand.opacity(0.05))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }

                    // Recent calls
                    if !viewModel.recentCalls.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Recent Calls")
                                .font(.headline)

                            ForEach(viewModel.recentCalls) { call in
                                NavigationLink(value: call) {
                                    RecentCallRow(call: call)
                                }
                                .foregroundStyle(.primary)
                            }
                        }
                    } else if !viewModel.isLoading {
                        VStack(spacing: 12) {
                            Image(systemName: "phone.badge.waveform")
                                .font(.largeTitle)
                                .foregroundStyle(.tertiary)
                            Text("No calls yet")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text("Your AI assistant is ready and waiting for calls")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.vertical, 40)
                    }
                }
                .padding()
            }
            .navigationTitle("Dashboard")
            .navigationDestination(for: CallLog.self) { call in
                CallDetailView(callId: call.id)
            }
            .refreshable {
                if let tenantId = appState.tenantId {
                    await viewModel.loadDashboard(tenantId: tenantId)
                }
            }
            .overlay {
                if viewModel.isLoading && viewModel.recentCalls.isEmpty {
                    LoadingView()
                }
            }
            .task {
                if let tenantId = appState.tenantId {
                    await viewModel.loadDashboard(tenantId: tenantId)
                }
            }
        }
    }

    private func formatDuration(_ seconds: Int) -> String {
        if seconds < 60 {
            return "\(seconds)s"
        }
        let minutes = seconds / 60
        let remaining = seconds % 60
        return "\(minutes)m \(remaining)s"
    }
}

struct StatCardView: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundStyle(color)
                Spacer()
            }
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct RecentCallRow: View {
    let call: CallLog

    var body: some View {
        HStack(spacing: 12) {
            // Outcome indicator
            Circle()
                .fill(Color.outcomeColor(call.outcome))
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(call.callerPhone)
                    .font(.body)
                    .fontWeight(.medium)
                if let date = call.createdAt.isoDate {
                    Text(date.relativeFormatted)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                OutcomeBadge(outcome: call.outcome)
                Text(call.formattedDuration)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 8)
    }
}
