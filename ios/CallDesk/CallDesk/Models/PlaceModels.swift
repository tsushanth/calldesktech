import Foundation

struct PlaceSearchResult: Codable, Identifiable, Sendable {
    let placeId: String
    let name: String
    let address: String
    let types: [String]?

    var id: String { placeId }

    enum CodingKeys: String, CodingKey {
        case name, address, types
        case placeId = "place_id"
    }
}

struct PlacesSearchResponse: Codable, Sendable {
    let results: [PlaceSearchResult]
}

struct PlaceDetails: Codable, Sendable {
    let placeId: String
    let name: String?
    let address: String?
    let phone: String?
    let website: String?
    let businessHours: BusinessHours?
    let businessType: String?
    let businessStatus: String?
    let services: [String]?

    enum CodingKeys: String, CodingKey {
        case name, address, phone, website, services
        case placeId = "place_id"
        case businessHours = "business_hours"
        case businessType = "business_type"
        case businessStatus = "business_status"
    }
}
