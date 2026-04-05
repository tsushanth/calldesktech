import SwiftUI

struct OnboardingContainerView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = OnboardingViewModel()

    var body: some View {
        NavigationStack {
            Group {
                switch viewModel.currentStep {
                case .findBusiness:
                    FindBusinessView(viewModel: viewModel)
                case .reviewAndGoLive:
                    ReviewAndGoLiveView(viewModel: viewModel)
                case .success:
                    ActivationSuccessView(viewModel: viewModel)
                }
            }
            .animation(.easeInOut(duration: 0.3), value: viewModel.currentStep)
        }
        .task {
            // If user already has a business but hasn't activated, skip to review
            if appState.hasBusiness && !appState.isOnboarded {
                viewModel.tenantId = appState.tenantId
                if let tenant = appState.currentTenant {
                    viewModel.businessName = tenant.name
                    viewModel.currentStep = .reviewAndGoLive
                }
            }
        }
    }
}
