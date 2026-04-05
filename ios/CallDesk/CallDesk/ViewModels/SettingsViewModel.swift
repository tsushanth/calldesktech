import Foundation
import UIKit

@Observable
final class SettingsViewModel {
    var tenant: Tenant?
    var isLoading = false
    var isSaving = false
    var error: String?
    var saveSuccess = false

    // Editable fields
    var businessName = ""
    var selectedVoice: VoiceOption = .adrian
    var selectedTone: ToneOption = .professional

    func loadSettings(tenantId: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let loadedTenant: Tenant = try await APIClient.shared.request(
                .get,
                path: "/api/mobile/settings",
                queryItems: [URLQueryItem(name: "tenant_id", value: tenantId)]
            )
            tenant = loadedTenant
            businessName = loadedTenant.name

            if let voiceId = loadedTenant.settings?.voiceId,
               let voice = VoiceOption(rawValue: voiceId) {
                selectedVoice = voice
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func saveSettings(tenantId: String) async {
        isSaving = true
        error = nil
        saveSuccess = false
        defer { isSaving = false }

        do {
            struct UpdateRequest: Codable {
                let tenant_id: String
                let name: String
                let settings: SettingsUpdate
            }

            struct SettingsUpdate: Codable {
                let voiceId: String
                let tone: String
            }

            let request = UpdateRequest(
                tenant_id: tenantId,
                name: businessName.trimmingCharacters(in: .whitespaces),
                settings: SettingsUpdate(
                    voiceId: selectedVoice.rawValue,
                    tone: selectedTone.rawValue
                )
            )

            let updated: Tenant = try await APIClient.shared.request(
                .put,
                path: "/api/mobile/settings",
                body: request
            )

            tenant = updated
            saveSuccess = true

            // Haptic feedback
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
