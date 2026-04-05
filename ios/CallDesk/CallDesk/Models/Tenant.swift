import Foundation

struct Tenant: Codable, Identifiable, Sendable {
    let id: String
    let userId: String
    let name: String
    let phoneNumber: String?
    let retellAgentId: String?
    let retellLlmId: String?
    let calApiKey: String?
    let calEventTypeId: String?
    let knowledgeBaseId: String?
    let settings: TenantSettings?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, settings
        case userId = "user_id"
        case phoneNumber = "phone_number"
        case retellAgentId = "retell_agent_id"
        case retellLlmId = "retell_llm_id"
        case calApiKey = "cal_api_key"
        case calEventTypeId = "cal_event_type_id"
        case knowledgeBaseId = "knowledge_base_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct TenantSettings: Codable, Sendable {
    var voiceId: String?
    var language: String?
    var businessType: String?
    var description: String?
    var website: String?
    var address: String?
    var phone: String?
    var hours: BusinessHours?
    var email: String?
    var subscriptionStatus: String?
    var activatedAt: String?

    enum CodingKeys: String, CodingKey {
        case voiceId, language, description, website, address, phone, hours, email
        case businessType = "business_type"
        case subscriptionStatus = "subscription_status"
        case activatedAt = "activated_at"
    }
}

typealias BusinessHours = [String: DayHours]

struct DayHours: Codable, Sendable {
    let open: String
    let close: String
    var closed: Bool?
}

struct BusinessListResponse: Codable, Sendable {
    let businesses: [Tenant]
}

struct CreateBusinessRequest: Codable, Sendable {
    let name: String
    var email: String?
    var businessType: String?
    var description: String?
    var website: String?
    var address: String?
    var phone: String?
    var hours: BusinessHours?

    enum CodingKeys: String, CodingKey {
        case name, email, description, website, address, phone, hours
        case businessType = "business_type"
    }
}

struct CreateBusinessResponse: Codable, Sendable {
    let id: String
    let name: String
}

struct GoLiveRequest: Codable, Sendable {
    let businessId: String
    var sessionId: String?
    var couponCode: String?

    enum CodingKeys: String, CodingKey {
        case businessId = "business_id"
        case sessionId = "session_id"
        case couponCode = "coupon_code"
    }
}

struct GoLiveResponse: Codable, Sendable {
    let success: Bool
    let phoneNumber: String?
    let message: String

    enum CodingKeys: String, CodingKey {
        case success, message
        case phoneNumber = "phone_number"
    }
}
