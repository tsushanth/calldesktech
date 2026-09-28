export const metadata = {
  title: 'SMS Notifications — CallDeskTech',
  description: 'Sign up for SMS notifications from CallDeskTech. Text START to receive updates about your AI receptionist.',
};

export default function SmsOptInPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">SMS Notifications</h1>
          <p className="text-gray-600 mt-1">
            Get updates about your AI receptionist from CallDeskTech.
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-6 mb-6">
          <p className="text-sm text-blue-800 font-medium mb-2">How to opt in</p>
          <p className="text-gray-900 text-lg font-semibold">
            Text <span className="text-blue-600">START</span> to{' '}
            <span className="text-blue-600">+1 (855) 915-2245</span>
          </p>
          <p className="text-sm text-gray-600 mt-2">
            You will receive automated SMS messages related to your AI receptionist setup, 
            trial status, and account updates.
          </p>
        </div>

        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h2 className="font-semibold text-gray-900">What you will receive</h2>
            <ul className="list-disc list-inside mt-1 space-y-1 text-gray-600">
              <li>Confirmation when your AI receptionist is ready</li>
              <li>Links to your dashboard and trial settings</li>
              <li>Support responses when you text us</li>
            </ul>
          </div>

          <div>
            <h2 className="font-semibold text-gray-900">Message frequency</h2>
            <p className="text-gray-600 mt-1">
              Messages are sent only when you contact us or when there is an update 
              related to your account. Message and data rates may apply.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-gray-900">Opt out</h2>
            <p className="text-gray-600 mt-1">
              You can cancel SMS notifications at any time by texting{' '}
              <span className="font-medium text-gray-900">STOP</span> to{' '}
              <span className="font-medium text-gray-900">+1 (855) 915-2245</span>.
              You may also text <span className="font-medium text-gray-900">HELP</span> for assistance.
            </p>
          </div>

          <div>
            <h2 className="font-semibold text-gray-900">Legal</h2>
            <p className="text-gray-600 mt-1">
              CallDeskTech is a service of{' '}
              <span className="font-medium text-gray-900">KreativeKoalaSolutions LLC</span>.
            </p>
            <div className="flex gap-4 mt-2">
              <a href="/privacy" className="text-blue-600 hover:underline">
                Privacy Policy
              </a>
              <a href="/terms" className="text-blue-600 hover:underline">
                Terms of Service
              </a>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200 text-xs text-gray-400">
          <p>
            By texting START, you consent to receive automated SMS messages from 
            CallDeskTech at +1 (855) 915-2245. Message and data rates may apply. 
            Text STOP to cancel, HELP for help.
          </p>
        </div>
      </div>
    </div>
  );
}
