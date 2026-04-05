import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(AuthService.self) private var authService
    @State private var viewModel = SettingsViewModel()
    @State private var showSignOutConfirm = false

    var body: some View {
        NavigationStack {
            Form {
                // Business Info
                Section("Business Information") {
                    HStack {
                        Text("Name")
                        Spacer()
                        TextField("Business Name", text: $viewModel.businessName)
                            .multilineTextAlignment(.trailing)
                    }

                    if let phone = viewModel.tenant?.phoneNumber {
                        HStack {
                            Text("AI Phone Number")
                            Spacer()
                            Text(phone)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let address = viewModel.tenant?.settings?.address {
                        HStack {
                            Text("Address")
                            Spacer()
                            Text(address)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.trailing)
                        }
                    }

                    if let type = viewModel.tenant?.settings?.businessType {
                        HStack {
                            Text("Type")
                            Spacer()
                            Text(BusinessType(rawValue: type)?.displayName ?? type.capitalized)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                // Voice Configuration
                Section("AI Voice") {
                    ForEach(VoiceOption.allCases) { voice in
                        Button {
                            viewModel.selectedVoice = voice
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(voice.displayName)
                                        .font(.body)
                                    Text(voice.description)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if viewModel.selectedVoice == voice {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Color.brand)
                                }
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }

                // Tone
                Section("Conversation Tone") {
                    ForEach(ToneOption.allCases) { tone in
                        Button {
                            viewModel.selectedTone = tone
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(tone.displayName)
                                        .font(.body)
                                    Text(tone.description)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if viewModel.selectedTone == tone {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Color.brand)
                                }
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }

                // Subscription
                Section("Subscription") {
                    HStack {
                        Text("Plan")
                        Spacer()
                        Text("$49/month")
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Text("Status")
                        Spacer()
                        Text(viewModel.tenant?.settings?.subscriptionStatus?.capitalized ?? "Unknown")
                            .foregroundStyle(
                                viewModel.tenant?.settings?.subscriptionStatus == "active" ? .green : .secondary
                            )
                    }
                    if let activatedAt = viewModel.tenant?.settings?.activatedAt,
                       let date = activatedAt.isoDate {
                        HStack {
                            Text("Active Since")
                            Spacer()
                            Text(date.shortFormatted)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                // Save button
                Section {
                    PrimaryButton(
                        title: viewModel.saveSuccess ? "Saved" : "Save Changes",
                        isLoading: viewModel.isSaving
                    ) {
                        if let tenantId = appState.tenantId {
                            Task { await viewModel.saveSettings(tenantId: tenantId) }
                        }
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

                // Account
                Section {
                    if let user = authService.currentUser {
                        HStack {
                            Text("Signed in as")
                            Spacer()
                            Text(user.email)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }

                    Button(role: .destructive) {
                        showSignOutConfirm = true
                    } label: {
                        HStack {
                            Spacer()
                            Text("Sign Out")
                            Spacer()
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .overlay {
                if viewModel.isLoading {
                    LoadingView()
                }
            }
            .alert("Sign Out", isPresented: $showSignOutConfirm) {
                Button("Sign Out", role: .destructive) {
                    authService.signOut()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Are you sure you want to sign out?")
            }
            .task {
                if let tenantId = appState.tenantId {
                    await viewModel.loadSettings(tenantId: tenantId)
                }
            }
        }
    }
}
