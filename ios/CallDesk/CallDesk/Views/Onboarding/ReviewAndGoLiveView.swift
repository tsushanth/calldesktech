import SwiftUI

struct ReviewAndGoLiveView: View {
    @Bindable var viewModel: OnboardingViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.shield.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(Color.brand)

                    Text("Review & Activate")
                        .font(.title)
                        .fontWeight(.bold)

                    Text("Your AI assistant is ready to go live")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 16)

                if let error = viewModel.error {
                    ErrorBanner(message: error) {
                        viewModel.error = nil
                    }
                }

                // Business summary card
                businessSummaryCard

                // Payment section
                paymentSection

                // Activate button
                PrimaryButton(
                    title: "Activate Now",
                    isLoading: viewModel.isActivating,
                    isDisabled: viewModel.couponCode.trimmingCharacters(in: .whitespaces).isEmpty
                ) {
                    Task { await viewModel.activateWithCoupon() }
                }

                // Pricing note
                Text("$49/month after activation. Cancel anytime.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    viewModel.currentStep = .findBusiness
                } label: {
                    Image(systemName: "chevron.left")
                }
            }
        }
    }

    // MARK: - Business Summary

    private var businessSummaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: viewModel.businessType.icon)
                    .font(.title2)
                    .foregroundStyle(Color.brand)
                    .frame(width: 40, height: 40)
                    .background(Color.brand.opacity(0.1))
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(viewModel.businessName)
                        .font(.headline)
                    Text(viewModel.businessType.displayName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }

            Divider()

            VStack(alignment: .leading, spacing: 6) {
                if !viewModel.businessPhone.isEmpty {
                    Label(viewModel.businessPhone, systemImage: "phone")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if !viewModel.businessAddress.isEmpty {
                    Label(viewModel.businessAddress, systemImage: "mappin")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if !viewModel.businessWebsite.isEmpty {
                    Label(viewModel.businessWebsite, systemImage: "globe")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Payment Section

    private var paymentSection: some View {
        VStack(spacing: 16) {
            Text("Payment")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Apple Pay button placeholder
            // TODO: Integrate Stripe iOS SDK for Apple Pay
            Button {} label: {
                HStack {
                    Image(systemName: "apple.logo")
                    Text("Pay with Apple Pay")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(.black)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            // Divider
            HStack {
                Rectangle().frame(height: 1).foregroundStyle(Color(.systemGray4))
                Text("or use coupon")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Rectangle().frame(height: 1).foregroundStyle(Color(.systemGray4))
            }

            // Coupon code
            VStack(spacing: 8) {
                HStack {
                    TextField("Enter coupon code", text: $viewModel.couponCode)
                        .textInputAutocapitalization(.characters)
                        .padding(12)
                        .background(Color(.systemGray6))
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                    if !viewModel.couponCode.isEmpty {
                        Button {
                            viewModel.couponCode = ""
                            viewModel.couponError = nil
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if let couponError = viewModel.couponError {
                    Text(couponError)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}
