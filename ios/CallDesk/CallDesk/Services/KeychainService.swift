import Foundation
import Security

final class KeychainService: Sendable {
    static let shared = KeychainService()

    private let tokenKey = "com.calldesk.auth.token"
    private let userKey = "com.calldesk.auth.user"

    private init() {}

    // MARK: - Token

    func saveToken(_ token: String) {
        save(key: tokenKey, data: Data(token.utf8))
    }

    func getToken() -> String? {
        guard let data = load(key: tokenKey) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func deleteToken() {
        delete(key: tokenKey)
    }

    // MARK: - User

    func saveUser(_ user: User) {
        guard let data = try? JSONEncoder().encode(user) else { return }
        save(key: userKey, data: data)
    }

    func getUser() -> User? {
        guard let data = load(key: userKey) else { return nil }
        return try? JSONDecoder().decode(User.self, from: data)
    }

    func deleteUser() {
        delete(key: userKey)
    }

    // MARK: - Clear All

    func clearAll() {
        deleteToken()
        deleteUser()
    }

    // MARK: - Private Helpers

    private func save(key: String, data: Data) {
        // Delete existing item first
        delete(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        SecItemAdd(query as CFDictionary, nil)
    }

    private func load(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    private func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]

        SecItemDelete(query as CFDictionary)
    }
}
