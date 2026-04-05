import SwiftUI

struct CallDetailView: View {
    let callId: String

    @State private var call: CallLog?
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading {
                LoadingView()
            } else if let call {
                ScrollView {
                    VStack(spacing: 20) {
                        // Header card
                        headerCard(call)

                        // Transcript
                        if let transcript = call.transcript, !transcript.isEmpty {
                            transcriptSection(transcript)
                        }
                    }
                    .padding()
                }
            } else if let error {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Call Details")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadCall() }
    }

    // MARK: - Header

    private func headerCard(_ call: CallLog) -> some View {
        VStack(spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(call.callerPhone)
                        .font(.title3)
                        .fontWeight(.bold)
                    if let date = call.createdAt.isoDate {
                        Text(date.shortFormatted)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                OutcomeBadge(outcome: call.outcome)
            }

            Divider()

            HStack(spacing: 24) {
                VStack(spacing: 4) {
                    Text("Duration")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(call.formattedDuration)
                        .font(.body)
                        .fontWeight(.medium)
                }

                VStack(spacing: 4) {
                    Text("Outcome")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(call.outcome?.capitalized ?? "Unknown")
                        .font(.body)
                        .fontWeight(.medium)
                }

                Spacer()

                // Call back button
                Button {
                    if let url = URL(string: "tel:\(call.callerPhone.replacingOccurrences(of: " ", with: ""))") {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Label("Call Back", systemImage: "phone.fill")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.brand)
                        .foregroundStyle(.white)
                        .clipShape(Capsule())
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Transcript

    private func transcriptSection(_ transcript: [TranscriptEntry]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Transcript")
                .font(.headline)

            ForEach(transcript) { entry in
                HStack(alignment: .top, spacing: 8) {
                    if entry.role == "agent" || entry.role == "assistant" {
                        agentBubble(entry.content)
                        Spacer(minLength: 40)
                    } else {
                        Spacer(minLength: 40)
                        userBubble(entry.content)
                    }
                }
            }
        }
    }

    private func agentBubble(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("AI Assistant")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(text)
                .font(.subheadline)
                .padding(12)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    private func userBubble(_ text: String) -> some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text("Caller")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.white)
                .padding(12)
                .background(Color.brand)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: - Data Loading

    private func loadCall() async {
        isLoading = true
        defer { isLoading = false }

        do {
            call = try await APIClient.shared.request(
                .get,
                path: "/api/mobile/calls/\(callId)"
            )
        } catch {
            self.error = error.localizedDescription
        }
    }
}
