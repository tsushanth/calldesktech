import Foundation

struct CallLog: Codable, Identifiable, Hashable, Sendable {
    static func == (lhs: CallLog, rhs: CallLog) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    let id: String
    let tenantId: String
    let retellCallId: String
    let callerPhone: String
    let outcome: String?
    let durationSeconds: Int
    let transcript: [TranscriptEntry]?
    let extractedData: [String: AnyCodable]?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, outcome, transcript
        case tenantId = "tenant_id"
        case retellCallId = "retell_call_id"
        case callerPhone = "caller_phone"
        case durationSeconds = "duration_seconds"
        case extractedData = "extracted_data"
        case createdAt = "created_at"
    }

    var formattedDuration: String {
        let minutes = durationSeconds / 60
        let seconds = durationSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    var outcomeEnum: CallOutcome? {
        guard let outcome else { return nil }
        return CallOutcome(rawValue: outcome)
    }

    var createdDate: Date? {
        ISO8601DateFormatter().date(from: createdAt)
    }
}

struct TranscriptEntry: Codable, Sendable, Identifiable {
    let role: String
    let content: String

    var id: String { "\(role)-\(content.prefix(20))" }
}

struct TranscriptResponse: Codable, Sendable {
    let callId: String
    let tenantId: String
    let businessName: String
    let duration: Int
    let startedAt: String?
    let endedAt: String?
    let transcript: [TranscriptTurn]
    let summary: String?
    let callerIntent: String?
    let actionsDemonstrated: [String]?
    let callerInsights: CallerInsights?
    let turnCount: Int

    enum CodingKeys: String, CodingKey {
        case duration, transcript, summary
        case callId = "call_id"
        case tenantId = "tenant_id"
        case businessName = "business_name"
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case callerIntent = "caller_intent"
        case actionsDemonstrated = "actions_demonstrated"
        case callerInsights = "caller_insights"
        case turnCount = "turn_count"
    }
}

struct TranscriptTurn: Codable, Sendable, Identifiable {
    let role: String
    let text: String
    let timestamp: String?
    let turnNumber: Int?

    var id: String { "\(role)-\(turnNumber ?? 0)" }

    enum CodingKeys: String, CodingKey {
        case role, text, timestamp
        case turnNumber = "turn_number"
    }
}

struct CallerInsights: Codable, Sendable {
    let sentiment: String?
    let urgency: String?
    let decisionStyle: String?
    let purchaseIntent: String?
    let priceSensitivity: String?
    let keyConcerns: [String]?
    let upsellOpportunities: [String]?
    let followUpRecommendation: String?
    let callerProfileSummary: String?

    enum CodingKeys: String, CodingKey {
        case sentiment, urgency
        case decisionStyle = "decision_style"
        case purchaseIntent = "purchase_intent"
        case priceSensitivity = "price_sensitivity"
        case keyConcerns = "key_concerns"
        case upsellOpportunities = "upsell_opportunities"
        case followUpRecommendation = "follow_up_recommendation"
        case callerProfileSummary = "caller_profile_summary"
    }
}

struct DashboardData: Codable, Sendable {
    let stats: DashboardStats
    let recentCalls: [CallLog]

    enum CodingKeys: String, CodingKey {
        case stats
        case recentCalls = "recent_calls"
    }
}

struct DashboardStats: Codable, Sendable {
    var totalCalls: Int = 0
    var todayCalls: Int = 0
    var totalBookings: Int = 0
    var avgDuration: Int = 0

    enum CodingKeys: String, CodingKey {
        case totalCalls = "total_calls"
        case todayCalls = "today_calls"
        case totalBookings = "total_bookings"
        case avgDuration = "avg_duration"
    }
}

struct CallsPageResponse: Codable, Sendable {
    let calls: [CallLog]
    let total: Int
}

/// A type-erased Codable wrapper for JSON values
struct AnyCodable: Codable, @unchecked Sendable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            value = string
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else {
            value = ""
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let string = value as? String {
            try container.encode(string)
        } else if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let bool = value as? Bool {
            try container.encode(bool)
        }
    }
}
