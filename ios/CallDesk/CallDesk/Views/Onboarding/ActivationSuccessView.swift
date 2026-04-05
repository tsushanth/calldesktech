import SwiftUI

struct ActivationSuccessView: View {
    let viewModel: OnboardingViewModel
    @Environment(AppState.self) private var appState

    @State private var showConfetti = false

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Success icon
            ZStack {
                Circle()
                    .fill(Color.successGreen.opacity(0.15))
                    .frame(width: 120, height: 120)
                    .scaleEffect(showConfetti ? 1.0 : 0.5)

                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(Color.successGreen)
                    .scaleEffect(showConfetti ? 1.0 : 0.5)
            }
            .animation(.spring(response: 0.5, dampingFraction: 0.6), value: showConfetti)

            // Title
            VStack(spacing: 8) {
                Text("You're Live!")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("Your AI receptionist is now\nanswering calls for \(viewModel.businessName)")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            // Phone number display
            if let phoneNumber = viewModel.provisionedPhoneNumber {
                VStack(spacing: 8) {
                    Text("Your AI Phone Number")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .tracking(1.5)

                    Text(phoneNumber)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.brand)
                }
                .padding(24)
                .frame(maxWidth: .infinity)
                .background(Color.brand.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.brand.opacity(0.2), lineWidth: 1)
                )
                .padding(.horizontal, 8)
            }

            Spacer()

            // Actions
            VStack(spacing: 12) {
                if let phoneNumber = viewModel.provisionedPhoneNumber {
                    // Call it now
                    Button {
                        if let url = URL(string: "tel:\(phoneNumber.replacingOccurrences(of: " ", with: ""))") {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        HStack {
                            Image(systemName: "phone.fill")
                            Text("Call It Now")
                        }
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.successGreen)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }

                // Go to Dashboard
                PrimaryButton(title: "Go to Dashboard") {
                    Task {
                        await appState.loadTenant()
                    }
                }
            }
            .padding(.bottom, 40)
        }
        .padding(.horizontal, 24)
        .navigationBarBackButtonHidden()
        .onAppear {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.7).delay(0.1)) {
                showConfetti = true
            }
            // Haptic feedback
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)
        }
    }
}
