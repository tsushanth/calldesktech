import Foundation

@Observable
final class KnowledgeViewModel {
    var knowledgeBases: [KnowledgeBase] = []
    var selectedKB: KnowledgeBase?
    var items: [KnowledgeItem] = []
    var isLoading = false
    var error: String?

    // Add KB sheet
    var showAddKBSheet = false
    var newKBName = ""
    var newKBSourceType = "manual"
    var newKBSourceUrl = ""
    var isCreatingKB = false

    // Add FAQ sheet
    var showAddFAQSheet = false
    var newQuestion = ""
    var newAnswer = ""
    var isAddingFAQ = false

    func loadKnowledgeBases(tenantId: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let response: KnowledgeBasesResponse = try await APIClient.shared.request(
                .get,
                path: "/api/tenants/\(tenantId)/knowledge"
            )
            knowledgeBases = response.knowledgeBases

            // Auto-select first KB
            if selectedKB == nil, let first = knowledgeBases.first {
                selectedKB = first
                items = first.knowledgeItems ?? []
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func selectKB(_ kb: KnowledgeBase) {
        selectedKB = kb
        items = kb.knowledgeItems ?? []
    }

    func createKnowledgeBase(tenantId: String) async {
        guard !newKBName.trimmingCharacters(in: .whitespaces).isEmpty else { return }

        isCreatingKB = true
        defer { isCreatingKB = false }

        do {
            let request = CreateKnowledgeBaseRequest(
                name: newKBName.trimmingCharacters(in: .whitespaces),
                sourceType: newKBSourceType,
                sourceUrl: newKBSourceUrl.isEmpty ? nil : newKBSourceUrl
            )

            let _: KnowledgeBase = try await APIClient.shared.request(
                .post,
                path: "/api/tenants/\(tenantId)/knowledge",
                body: request
            )

            // Reset form
            newKBName = ""
            newKBSourceUrl = ""
            showAddKBSheet = false

            // Reload
            await loadKnowledgeBases(tenantId: tenantId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func addFAQ(tenantId: String) async {
        guard let kb = selectedKB,
              !newQuestion.trimmingCharacters(in: .whitespaces).isEmpty,
              !newAnswer.trimmingCharacters(in: .whitespaces).isEmpty else { return }

        isAddingFAQ = true
        defer { isAddingFAQ = false }

        do {
            let request = CreateKnowledgeBaseRequest(
                name: kb.name,
                sourceType: "manual",
                items: [FAQItem(
                    question: newQuestion.trimmingCharacters(in: .whitespaces),
                    answer: newAnswer.trimmingCharacters(in: .whitespaces)
                )]
            )

            let _: KnowledgeBase = try await APIClient.shared.request(
                .post,
                path: "/api/tenants/\(tenantId)/knowledge",
                body: request
            )

            // Reset form
            newQuestion = ""
            newAnswer = ""
            showAddFAQSheet = false

            // Reload
            await loadKnowledgeBases(tenantId: tenantId)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
