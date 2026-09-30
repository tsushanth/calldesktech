'use client';

import BrowserDemoCall from '@/components/demo/BrowserDemoCall';

// The "poc" voice-engine demo call. The implementation lives in
// BrowserDemoCall so /demo/talk can share it.
export default function PocDemoCallPage() {
  return <BrowserDemoCall />;
}
