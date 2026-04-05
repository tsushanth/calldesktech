import SwiftUI

struct PrimaryButton: View {
    let title: String
    var isLoading: Bool = false
    var isDisabled: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                }
                Text(title)
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(isDisabled ? Color.gray.opacity(0.3) : Color.brand)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(isLoading || isDisabled)
    }
}

struct SecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .fontWeight(.medium)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(Color(.systemGray6))
                .foregroundStyle(.primary)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
}
