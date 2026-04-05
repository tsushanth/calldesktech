import Foundation

enum BusinessType: String, CaseIterable, Codable, Identifiable {
    case autoRepair = "auto_repair"
    case salon
    case medical
    case restaurant
    case plumbing
    case legal
    case realEstate = "real_estate"
    case fitness
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .autoRepair: return "Auto Repair"
        case .salon: return "Salon"
        case .medical: return "Medical"
        case .restaurant: return "Restaurant"
        case .plumbing: return "Plumbing"
        case .legal: return "Legal"
        case .realEstate: return "Real Estate"
        case .fitness: return "Fitness"
        case .other: return "Other"
        }
    }

    var icon: String {
        switch self {
        case .autoRepair: return "car.fill"
        case .salon: return "scissors"
        case .medical: return "cross.case.fill"
        case .restaurant: return "fork.knife"
        case .plumbing: return "wrench.fill"
        case .legal: return "building.columns.fill"
        case .realEstate: return "house.fill"
        case .fitness: return "figure.run"
        case .other: return "building.2.fill"
        }
    }
}

enum CallOutcome: String, CaseIterable, Codable, Identifiable {
    case booked
    case answered
    case transferred
    case voicemail
    case abandoned

    var id: String { rawValue }

    var displayName: String {
        rawValue.capitalized
    }

    var color: String {
        switch self {
        case .booked: return "green"
        case .answered: return "blue"
        case .transferred: return "purple"
        case .voicemail: return "orange"
        case .abandoned: return "red"
        }
    }
}

enum VoiceOption: String, CaseIterable, Identifiable {
    case adrian = "11labs-Adrian"
    case marissa = "11labs-Marissa"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .adrian: return "Adrian"
        case .marissa: return "Marissa"
        }
    }

    var description: String {
        switch self {
        case .adrian: return "Professional male voice"
        case .marissa: return "Friendly female voice"
        }
    }

    var gender: String {
        switch self {
        case .adrian: return "male"
        case .marissa: return "female"
        }
    }
}

enum ToneOption: String, CaseIterable, Identifiable {
    case professional
    case friendly
    case casual

    var id: String { rawValue }

    var displayName: String { rawValue.capitalized }

    var description: String {
        switch self {
        case .professional: return "Formal and business-like"
        case .friendly: return "Warm and approachable"
        case .casual: return "Relaxed and conversational"
        }
    }
}
