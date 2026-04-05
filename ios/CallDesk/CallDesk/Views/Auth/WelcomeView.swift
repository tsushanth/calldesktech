import AuthenticationServices
import SwiftUI

struct WelcomeView: View {
    @Environment(AuthService.self) private var authService

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Hero
            VStack(spacing: 16) {
                Image(systemName: "phone.badge.checkmark.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(Color.brand)

                Text("CallDesk")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("Your AI receptionist,\nlive in 2 minutes")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()

            // Features
            VStack(spacing: 12) {
                FeatureRow(icon: "phone.arrow.down.left.fill", text: "Never miss a business call")
                FeatureRow(icon: "clock.fill", text: "Available 24/7")
                FeatureRow(icon: "calendar.badge.plus", text: "Books appointments automatically")
            }
            .padding(.horizontal, 32)

            Spacer()

            // Sign in buttons
            VStack(spacing: 12) {
                if let error = authService.error {
                    ErrorBanner(message: error) {
                        authService.error = nil
                    }
                }

                // Sign in with Apple
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    switch result {
                    case .success(let authorization):
                        Task {
                            await authService.handleAppleSignIn(authorization: authorization)
                        }
                    case .failure(let error):
                        authService.error = error.localizedDescription
                    }
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
                .clipShape(RoundedRectangle(cornerRadius: 12))

                // Sign in with Google
                Button {
                    // Google Sign-In will be triggered via GoogleSignIn SDK
                    // For now, placeholder
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "g.circle.fill")
                            .font(.title3)
                        Text("Sign in with Google")
                            .fontWeight(.medium)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Color(.systemGray6))
                    .foregroundStyle(.primary)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color(.systemGray4), lineWidth: 1)
                    )
                }

                if authService.isLoading {
                    ProgressView()
                        .padding(.top, 8)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
    }
}

private struct FeatureRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.body)
                .foregroundStyle(Color.brand)
                .frame(width: 24)
            Text(text)
                .font(.body)
            Spacer()
        }
    }
}
