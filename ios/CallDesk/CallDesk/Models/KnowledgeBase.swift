import Foundation

struct KnowledgeBase: Codable, Identifiable, Sendable {
    let id: String
    let tenantId: String
    let name: String
    let sourceType: String
    let sourceUrl: String?
    let retellKbId: String?
    let createdAt: String
    var knowledgeItems: [KnowledgeItem]?

    enum CodingKeys: String, CodingKey {
        case id, name
        case tenantId = "tenant_id"
        case sourceType = "source_type"
        case sourceUrl = "source_url"
        case retellKbId = "retell_kb_id"
        case createdAt = "created_at"
        case knowledgeItems = "knowledge_items"
    }
}

struct KnowledgeItem: Codable, Identifiable, Sendable {
    let id: String
    let knowledgeBaseId: String
    let question: String
    let answer: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, question, answer
        case knowledgeBaseId = "knowledge_base_id"
        case createdAt = "created_at"
    }
}

struct KnowledgeBasesResponse: Codable, Sendable {
    let knowledgeBases: [KnowledgeBase]
}

struct CreateKnowledgeBaseRequest: Codable, Sendable {
    let name: String
    let sourceType: String
    var sourceUrl: String?
    var items: [FAQItem]?

    enum CodingKeys: String, CodingKey {
        case name, items
        case sourceType = "sourceType"
        case sourceUrl = "sourceUrl"
    }
}

struct FAQItem: Codable, Sendable {
    let question: String
    let answer: String
}
