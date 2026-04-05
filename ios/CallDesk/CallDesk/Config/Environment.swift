import Foundation

enum AppConfig {
    enum Server {
        #if DEBUG
        static let apiBaseURL = "http://localhost:3000"
        #else
        static let apiBaseURL = "https://calldesktech-REPLACE_WITH_YOUR_URL.a.run.app"
        #endif

        static let appBundleID = "com.calldesk.app"
        static let stripeMerchantID = "merchant.com.calldesk"
        static let stripePublishableKey = "pk_live_REPLACE"
    }
}
