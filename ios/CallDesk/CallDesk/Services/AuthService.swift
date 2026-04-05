import AuthenticationServices
import Foundation

@Observable
final class AuthService {
    static let shared = AuthService()

    private(set) var isAuthenticated = false
    private(set) var currentUser: User?
    private(set) var isLoading = false
    var error: String?

    private init() {
        // Restore session from keychain
        if KeychainService.shared.getToken() != nil {
            self.currentUser = KeychainService.shared.getUser()
            self.isAuthenticated = true
        }

        // Wire up 401 handler
        APIClient.shared.onUnauthorized = { [weak self] in
            await MainActor.run {
                self?.signOut()
            }
        }
    }

    // MARK: - Sign In with Apple

    func handleAppleSignIn(authorization: ASAuthorization) async {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identityToken = credential.identityToken,
              let tokenString = String(data: identityToken, encoding: .utf8) else {
            error = "Failed to get Apple ID credential"
            return
        }

        let fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
            .compactMap { $0 }
            .joined(separator: " ")

        await authenticate(
            provider: "apple",
            idToken: tokenString,
            name: fullName.isEmpty ? nil : fullName
        )
    }

    // MARK: - Sign In with Google

    func handleGoogleSignIn(idToken: String, name: String?) async {
        await authenticate(provider: "google", idToken: idToken, name: name)
    }

    // MARK: - Sign Out

    func signOut() {
        KeychainService.shared.clearAll()
        isAuthenticated = false
        currentUser = nil
    }

    // MARK: - Private

    private func authenticate(provider: String, idToken: String, name: String?) async {
        isLoading = true
        error = nil

        defer { isLoading = false }

        do {
            let request = MobileAuthRequest(
                provider: provider,
                idToken: idToken,
                name: name
            )

            let response: AuthResponse = try await APIClient.shared.request(
                .post,
                path: "/api/auth/mobile",
                body: request
            )

            KeychainService.shared.saveToken(response.token)
            KeychainService.shared.saveUser(response.user)

            currentUser = response.user
            isAuthenticated = true
        } catch let apiError as APIError {
            error = apiError.localizedDescription
        } catch {
            self.error = error.localizedDescription
        }
    }
}
