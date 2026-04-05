import SwiftUI

struct FindBusinessView: View {
    @Bindable var viewModel: OnboardingViewModel
    @State private var locationService = LocationService()

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 8) {
                    Text("Find Your Business")
                        .font(.title)
                        .fontWeight(.bold)

                    Text("Search for your business or enter details manually")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 16)

                if let error = viewModel.error {
                    ErrorBanner(message: error) {
                        viewModel.error = nil
                    }
                }

                if viewModel.isManualEntry {
                    manualEntryForm
                } else {
                    searchSection
                }

                Spacer(minLength: 20)

                // Continue button
                PrimaryButton(
                    title: "Set Up My Assistant",
                    isLoading: viewModel.isCreatingBusiness,
                    isDisabled: !viewModel.canCreateBusiness
                ) {
                    Task { await viewModel.createBusiness() }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .navigationBarTitleDisplayMode(.inline)
        .task {
            locationService.requestPermission()
        }
    }

    // MARK: - Search Section

    private var searchSection: some View {
        VStack(spacing: 16) {
            // Search bar
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search your business name...", text: $viewModel.searchQuery)
                    .textInputAutocapitalization(.words)
                    .onChange(of: viewModel.searchQuery) {
                        viewModel.searchBusinesses()
                    }
                if viewModel.isSearching {
                    ProgressView()
                        .scaleEffect(0.8)
                }
                if !viewModel.searchQuery.isEmpty {
                    Button {
                        viewModel.searchQuery = ""
                        viewModel.searchResults = []
                        viewModel.selectedPlace = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding()
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 12))

            // Search results
            if !viewModel.searchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(viewModel.searchResults) { result in
                        Button {
                            Task { await viewModel.selectPlace(result) }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(result.name)
                                        .font(.body)
                                        .fontWeight(.medium)
                                    Text(result.address)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 12)
                            .padding(.horizontal, 16)
                        }
                        .foregroundStyle(.primary)

                        if result.id != viewModel.searchResults.last?.id {
                            Divider().padding(.leading, 16)
                        }
                    }
                }
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            // Selected business details
            if let place = viewModel.selectedPlace {
                selectedBusinessCard(place)
            }

            // Manual entry link
            Button {
                withAnimation {
                    viewModel.isManualEntry = true
                }
            } label: {
                Text("Can't find your business? Enter manually")
                    .font(.subheadline)
                    .foregroundStyle(Color.brand)
            }
        }
    }

    // MARK: - Selected Business Card

    private func selectedBusinessCard(_ place: PlaceDetails) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Business Found")
                    .font(.headline)
                Spacer()
            }

            VStack(alignment: .leading, spacing: 6) {
                if let name = place.name {
                    Label(name, systemImage: "building.2")
                        .font(.subheadline)
                }
                if let address = place.address {
                    Label(address, systemImage: "mappin")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let phone = place.phone {
                    Label(phone, systemImage: "phone")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let website = place.website {
                    Label(website, systemImage: "globe")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding()
        .background(Color.green.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.green.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Manual Entry Form

    private var manualEntryForm: some View {
        VStack(spacing: 16) {
            Button {
                withAnimation {
                    viewModel.isManualEntry = false
                }
            } label: {
                HStack {
                    Image(systemName: "arrow.left")
                    Text("Back to search")
                }
                .font(.subheadline)
                .foregroundStyle(Color.brand)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            FormField(label: "Business Name *", text: $viewModel.businessName, placeholder: "e.g. Mike's Plumbing")

            VStack(alignment: .leading, spacing: 6) {
                Text("Business Type")
                    .font(.subheadline)
                    .fontWeight(.medium)
                Picker("Type", selection: $viewModel.businessType) {
                    ForEach(BusinessType.allCases) { type in
                        HStack {
                            Image(systemName: type.icon)
                            Text(type.displayName)
                        }
                        .tag(type)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            FormField(label: "Phone Number", text: $viewModel.businessPhone, placeholder: "(555) 123-4567")
                .keyboardType(.phonePad)

            FormField(label: "Website", text: $viewModel.businessWebsite, placeholder: "https://www.example.com")
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)

            FormField(label: "Description", text: $viewModel.businessDescription, placeholder: "What services do you offer?")
        }
    }
}

private struct FormField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.subheadline)
                .fontWeight(.medium)
            TextField(placeholder, text: $text)
                .padding(12)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
}
