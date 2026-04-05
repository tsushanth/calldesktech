import Foundation

struct User: Codable, Identifiable, Sendable {
    let id: String
    let email: String
    let name: String?
}

struct AuthResponse: Codable, Sendable {
    let token: String
    let user: User
    let tenantId: String?
    let hasBusiness: Bool
    let isActivated: Bool

    enum CodingKeys: String, CodingKey {
        case token, user
        case tenantId = "tenant_id"
        case hasBusiness = "has_business"
        case isActivated = "is_activated"
    }
}

struct MobileAuthRequest: Codable, Sendable {
    let provider: String
    let idToken: String
    let name: String?

    enum CodingKeys: String, CodingKey {
        case provider
        case idToken = "id_token"
        case name
    }
}
