'use client';

import { useState } from 'react';

export default function TrialStartPage() {
  const [step, setStep] = useState<'form' | 'creating' | 'done' | 'error'>('form');
  const [companyName, setCompanyName] = useState('');
  const [greeting, setGreeting] = useState('');
  const [transferNumber, setTransferNumber] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<{ assigned_number?: string; trial_id?: string; dashboard_url?: string }>({});
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStep('creating');
    setError('');

    try {
      const res = await fetch('/api/trial/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          greeting: greeting || undefined,
          transfer_number: transferNumber,
          timezone,
          email: email || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create trial');
      }

      setResult(data);
      setStep('done');
    } catch (err: any) {
      setError(err.message);
      setStep('error');
    }
  }

  if (step === 'creating') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold">Creating your AI receptionist...</h2>
          <p className="text-gray-500 mt-2">This takes about 30 seconds</p>
        </div>
      </div>
    );
  }

  if (step === 'done' && result.assigned_number) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <h2 className="text-2xl font-bold mb-2">Your AI is live!</h2>
          <p className="text-gray-600 mb-6">Call this number to test your AI receptionist:</p>
          <div className="text-3xl font-mono font-bold text-blue-600 mb-6">
            {result.assigned_number}
          </div>
          <a
            href={result.dashboard_url}
            className="block w-full bg-blue-600 text-white rounded-lg py-3 font-medium hover:bg-blue-700 transition"
          >
            View Dashboard
          </a>
          <p className="text-sm text-gray-400 mt-4">
            Trial ID: {result.trial_id}
          </p>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-500 text-5xl mb-4">✗</div>
          <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
          <p className="text-red-600 mb-6">{error}</p>
          <button
            onClick={() => setStep('form')}
            className="bg-blue-600 text-white rounded-lg px-6 py-3 font-medium hover:bg-blue-700 transition"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold mb-2 text-gray-900">Free AI Receptionist</h1>
        <p className="text-gray-600 mb-6">Set up in 2 minutes. No credit card needed.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-900">Business Name *</label>
            <input
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Dental"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-900">AI Greeting</label>
            <input
              type="text"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder={`Hi, this is ${companyName || 'your business'}. How can I help you?`}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">Leave blank for a default greeting</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-900">Transfer Number *</label>
            <input
              type="tel"
              required
              value={transferNumber}
              onChange={(e) => setTransferNumber(e.target.value)}
              placeholder="415-555-1234"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">Where urgent calls go</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-900">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="America/New_York">Eastern (ET)</option>
              <option value="America/Chicago">Central (CT)</option>
              <option value="America/Denver">Mountain (MT)</option>
              <option value="America/Los_Angeles">Pacific (PT)</option>
              <option value="America/Phoenix">Arizona (MST)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-900">Email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white rounded-lg py-3 font-medium hover:bg-blue-700 transition"
          >
            Create My AI Receptionist
          </button>
        </form>
      </div>
    </div>
  );
}
