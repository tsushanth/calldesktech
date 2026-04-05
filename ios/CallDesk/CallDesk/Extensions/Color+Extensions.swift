import SwiftUI

extension Color {
    static let brand = Color(red: 0.2, green: 0.4, blue: 1.0)
    static let brandLight = Color(red: 0.4, green: 0.6, blue: 1.0)
    static let brandDark = Color(red: 0.1, green: 0.25, blue: 0.7)

    static let successGreen = Color(red: 0.2, green: 0.8, blue: 0.4)
    static let warningOrange = Color.orange
    static let errorRed = Color.red

    static func outcomeColor(_ outcome: String?) -> Color {
        guard let outcome, let callOutcome = CallOutcome(rawValue: outcome) else {
            return .secondary
        }
        switch callOutcome {
        case .booked: return .successGreen
        case .answered: return .brand
        case .transferred: return .purple
        case .voicemail: return .warningOrange
        case .abandoned: return .errorRed
        }
    }
}
