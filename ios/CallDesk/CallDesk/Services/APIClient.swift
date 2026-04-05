import Foundation

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case delete = "DELETE"
}

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized
    case serverError(Int, String)
    case decodingError(Error)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .invalidResponse: return "Invalid response from server"
        case .unauthorized: return "Please sign in again"
        case .serverError(let code, let message): return "Server error (\(code)): \(message)"
        case .decodingError(let error): return "Data error: \(error.localizedDescription)"
        case .networkError(let error): return error.localizedDescription
        }
    }
}

struct ErrorResponse: Codable {
    let error: String
}

protocol APIClientProtocol: Sendable {
    func request<T: Decodable>(
        _ method: HTTPMethod,
        path: String,
        body: (any Encodable)?,
        queryItems: [URLQueryItem]?
    ) async throws -> T
}

final class APIClient: APIClientProtocol, @unchecked Sendable {
    static let shared = APIClient()

    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    /// Called when a 401 is received — triggers sign out
    var onUnauthorized: (@Sendable () async -> Void)?

    init(baseURL: URL? = nil) {
        self.baseURL = baseURL ?? URL(string: AppConfig.Server.apiBaseURL)!

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)

        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    func request<T: Decodable>(
        _ method: HTTPMethod,
        path: String,
        body: (any Encodable)? = nil,
        queryItems: [URLQueryItem]? = nil
    ) async throws -> T {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: true
        )!
        if let queryItems, !queryItems.isEmpty {
            components.queryItems = queryItems
        }

        guard let url = components.url else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Inject auth token
        if let token = KeychainService.shared.getToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }

        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                await onUnauthorized?()
                throw APIError.unauthorized
            }
            let errorBody = try? decoder.decode(ErrorResponse.self, from: data)
            throw APIError.serverError(
                httpResponse.statusCode,
                errorBody?.error ?? "Unknown error"
            )
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
}

// MARK: - Type-erased Encodable wrapper

private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        self.encodeClosure = { encoder in
            try value.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}
