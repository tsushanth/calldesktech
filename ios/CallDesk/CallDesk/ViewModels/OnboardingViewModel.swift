import Foundation

@Observable
final class OnboardingViewModel {
    enum Step: Int, CaseIterable {
        case findBusiness = 0
        case reviewAndGoLive = 1
        case success = 2
    }

    // MARK: - Navigation
    var currentStep: Step = .findBusiness

    // MARK: - Business Search
    var searchQuery = ""
    var searchResults: [PlaceSearchResult] = []
    var selectedPlace: PlaceDetails?
    var isSearching = false

    // MARK: - Manual Entry Fallback
    var isManualEntry = false
    var businessName = ""
    var businessType: BusinessType = .other
    var businessPhone = ""
    var businessEmail = ""
    var businessWebsite = ""
    var businessAddress = ""
    var businessDescription = ""
    var businessHours: BusinessHours?

    // MARK: - Payment / Activation
    var couponCode = ""
    var couponError: String?
    var isPaying = false

    // MARK: - Result
    var tenantId: String?
    var provisionedPhoneNumber: String?
    var isCreatingBusiness = false
    var isActivating = false

    // MARK: - Errors
    var error: String?

    private var searchTask: Task<Void, Never>?

    // MARK: - Business Search

    func searchBusinesses() {
        searchTask?.cancel()

        guard searchQuery.count >= 2 else {
            searchResults = []
            return
        }

        searchTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }

            isSearching = true
            defer { isSearching = false }

            do {
                let response: PlacesSearchResponse = try await APIClient.shared.request(
                    .get,
                    path: "/api/places/search",
                    queryItems: [URLQueryItem(name: "query", value: searchQuery)]
                )
                if !Task.isCancelled {
                    searchResults = response.results
                }
            } catch {
                // Silently fail — search suggestions are non-critical
            }
        }
    }

    func selectPlace(_ result: PlaceSearchResult) async {
        error = nil
        do {
            let details: PlaceDetails = try await APIClient.shared.request(
                .get,
                path: "/api/places/details",
                queryItems: [URLQueryItem(name: "place_id", value: result.placeId)]
            )
            selectedPlace = details
            businessName = details.name ?? result.name
            businessPhone = details.phone ?? ""
            businessWebsite = details.website ?? ""
            businessAddress = details.address ?? result.address
            businessHours = details.businessHours

            if let type = details.businessType?.lowercased() {
                businessType = BusinessType(rawValue: type) ?? .other
            }

            searchResults = []
            searchQuery = businessName
        } catch {
            self.error = "Failed to load business details"
        }
    }

    // MARK: - Create Business

    var canCreateBusiness: Bool {
        !businessName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    func createBusiness() async {
        guard canCreateBusiness else { return }

        isCreatingBusiness = true
        error = nil
        defer { isCreatingBusiness = false }

        do {
            let request = CreateBusinessRequest(
                name: businessName.trimmingCharacters(in: .whitespaces),
                email: businessEmail.isEmpty ? nil : businessEmail,
                businessType: businessType.rawValue,
                description: businessDescription.isEmpty ? nil : businessDescription,
                website: businessWebsite.isEmpty ? nil : businessWebsite,
                address: businessAddress.isEmpty ? nil : businessAddress,
                phone: businessPhone.isEmpty ? nil : businessPhone,
                hours: businessHours
            )

            let response: CreateBusinessResponse = try await APIClient.shared.request(
                .post,
                path: "/api/business",
                body: request
            )

            tenantId = response.id
            currentStep = .reviewAndGoLive
        } catch let apiError as APIError {
            error = apiError.localizedDescription
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Activation

    func activateWithCoupon() async {
        guard !couponCode.trimmingCharacters(in: .whitespaces).isEmpty,
              let tenantId else {
            couponError = "Please enter a coupon code"
            return
        }

        isActivating = true
        couponError = nil
        error = nil
        defer { isActivating = false }

        do {
            let request = GoLiveRequest(
                businessId: tenantId,
                couponCode: couponCode.trimmingCharacters(in: .whitespaces).uppercased()
            )

            let response: GoLiveResponse = try await APIClient.shared.request(
                .post,
                path: "/api/go-live",
                body: request
            )

            if response.success {
                provisionedPhoneNumber = response.phoneNumber
                currentStep = .success
            } else {
                error = response.message
            }
        } catch let apiError as APIError {
            if case .serverError(400, let message) = apiError {
                couponError = message
            } else {
                error = apiError.localizedDescription
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
