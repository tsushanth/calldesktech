'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api, type TranscriptResponse } from '@/lib/api';
import { formatPhoneE164 } from '@/lib/utils';
import { type DemoProfileId, DEMO_PROFILES } from '@/lib/constants';

// Demo type
type DemoType = 'sample' | 'focused' | null;

// Business hours type
interface BusinessHoursDay {
  open: string;
  close: string;
  closed?: boolean;
}

type BusinessHours = Record<string, BusinessHoursDay>;

// State interface
interface OnboardingState {
  // Tenant/Business info
  tenantId: string | null;
  businessName: string;
  ownerPhone: string;
  ownerEmail: string;
  selectedProfileId: DemoProfileId | null;
  demoType: DemoType;

  // Extended business info
  businessWebsite: string;
  businessAddress: string;
  businessPhone: string;
  businessDescription: string;
  servicesOffered: string[];
  businessHours: BusinessHours | null;

  // Voice/persona configuration
  selectedVoice: string;
  selectedTone: string;

  // Onboarding progress
  onboardingStep: number;
  onboardingComplete: boolean;

  // Call state
  callId: string | null;
  callStatus: string;
  callDuration: number;
  isCallInProgress: boolean;

  // Transcript state
  transcript: TranscriptResponse | null;

  // Subscription state
  isSubscribed: boolean;
  assignedPhoneNumber: string | null;

  // UI state
  isLoading: boolean;
  error: string | null;
  isHydrated: boolean;
}

// Actions interface
interface OnboardingActions {
  // Setters
  setTenantId: (id: string | null) => void;
  setBusinessName: (name: string) => void;
  setOwnerPhone: (phone: string) => void;
  setOwnerEmail: (email: string) => void;
  setDemoType: (type: DemoType) => void;
  selectProfile: (profileId: DemoProfileId) => void;
  setSelectedProfileId: (profileId: DemoProfileId | null) => void;

  // Extended business setters
  setBusinessWebsite: (website: string) => void;
  setBusinessAddress: (address: string) => void;
  setBusinessPhone: (phone: string) => void;
  setBusinessDescription: (description: string) => void;
  setServicesOffered: (services: string[]) => void;
  setBusinessHours: (hours: BusinessHours) => void;

  // Voice/persona setters
  setSelectedVoice: (voice: string) => void;
  setSelectedTone: (tone: string) => void;

  // Subscription setters
  setAssignedPhoneNumber: (phone: string | null) => void;
  setIsSubscribed: (subscribed: boolean) => void;

  // Onboarding progress
  setOnboardingStep: (step: number) => void;

  // Business operations
  createTenantAndStartDemo: () => Promise<void>;
  retryDemoCall: () => Promise<void>;

  // Call polling
  startCallPolling: () => void;
  stopCallPolling: () => void;
  checkCallStatus: () => Promise<void>;

  // Test call (for onboarding)
  startTestCall: (phone: string) => Promise<void>;

  // Transcript
  fetchTranscript: () => Promise<void>;

  // Utilities
  clearError: () => void;
  reset: () => void;
}

type OnboardingContextType = OnboardingState & OnboardingActions;

const OnboardingContext = createContext<OnboardingContextType | null>(null);

// Storage keys
const STORAGE_KEYS = {
  tenantId: 'calldesk_tenant_id',
  businessName: 'calldesk_business_name',
  ownerPhone: 'calldesk_owner_phone',
  ownerEmail: 'calldesk_owner_email',
  demoType: 'calldesk_demo_type',
  isSubscribed: 'calldesk_is_subscribed',
  assignedPhoneNumber: 'calldesk_assigned_phone',
  callId: 'calldesk_call_id',
  selectedProfileId: 'calldesk_selected_profile',
  businessWebsite: 'calldesk_business_website',
  businessAddress: 'calldesk_business_address',
  businessPhone: 'calldesk_business_phone',
  businessDescription: 'calldesk_business_description',
  servicesOffered: 'calldesk_services_offered',
  businessHours: 'calldesk_business_hours',
  selectedVoice: 'calldesk_selected_voice',
  selectedTone: 'calldesk_selected_tone',
  onboardingStep: 'calldesk_onboarding_step',
  onboardingComplete: 'calldesk_onboarding_complete',
};

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // State
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [demoType, setDemoType] = useState<DemoType>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<DemoProfileId | null>(null);

  // Extended business info
  const [businessWebsite, setBusinessWebsite] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [servicesOffered, setServicesOffered] = useState<string[]>([]);
  const [businessHours, setBusinessHours] = useState<BusinessHours | null>(null);

  // Voice/persona
  const [selectedVoice, setSelectedVoice] = useState('11labs-Adrian');
  const [selectedTone, setSelectedTone] = useState('professional');

  // Onboarding progress
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  const [callId, setCallId] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState('');
  const [callDuration, setCallDuration] = useState(0);
  const [isCallInProgress, setIsCallInProgress] = useState(false);

  // The polling interval (below) is created once and lives for the interval's
  // whole lifetime, closing over whatever `checkCallStatus` reference existed
  // at creation time. If that happens on a render where `callId` is still
  // null (a real race — the "Call Me Now" flow sets callId and starts polling
  // in quick succession), the interval keeps calling a stale, permanently-null
  // callId forever, silently no-oping every tick — the call finishes on
  // Retell's side but the UI never advances. Mirroring callId into a ref that
  // checkCallStatus reads from sidesteps the closure entirely: the interval
  // always sees whatever callId is current, regardless of when it was created.
  const callIdRef = useRef<string | null>(null);
  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [assignedPhoneNumber, setAssignedPhoneNumber] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  // Load saved state from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedTenantId = localStorage.getItem(STORAGE_KEYS.tenantId);
    const savedBusinessName = localStorage.getItem(STORAGE_KEYS.businessName);
    const savedOwnerPhone = localStorage.getItem(STORAGE_KEYS.ownerPhone);
    const savedOwnerEmail = localStorage.getItem(STORAGE_KEYS.ownerEmail);
    const savedDemoType = localStorage.getItem(STORAGE_KEYS.demoType);
    const savedIsSubscribed = localStorage.getItem(STORAGE_KEYS.isSubscribed);
    const savedPhoneNumber = localStorage.getItem(STORAGE_KEYS.assignedPhoneNumber);
    const savedCallId = localStorage.getItem(STORAGE_KEYS.callId);
    const savedProfileId = localStorage.getItem(STORAGE_KEYS.selectedProfileId);

    // Extended business info
    const savedWebsite = localStorage.getItem(STORAGE_KEYS.businessWebsite);
    const savedAddress = localStorage.getItem(STORAGE_KEYS.businessAddress);
    const savedBusinessPhone = localStorage.getItem(STORAGE_KEYS.businessPhone);
    const savedDescription = localStorage.getItem(STORAGE_KEYS.businessDescription);
    const savedServices = localStorage.getItem(STORAGE_KEYS.servicesOffered);
    const savedHours = localStorage.getItem(STORAGE_KEYS.businessHours);

    // Voice/persona
    const savedVoice = localStorage.getItem(STORAGE_KEYS.selectedVoice);
    const savedTone = localStorage.getItem(STORAGE_KEYS.selectedTone);

    // Onboarding
    const savedStep = localStorage.getItem(STORAGE_KEYS.onboardingStep);
    const savedComplete = localStorage.getItem(STORAGE_KEYS.onboardingComplete);

    if (savedTenantId) setTenantId(savedTenantId);
    if (savedBusinessName) setBusinessName(savedBusinessName);
    if (savedOwnerPhone) setOwnerPhone(savedOwnerPhone);
    if (savedOwnerEmail) setOwnerEmail(savedOwnerEmail);
    if (savedDemoType) setDemoType(savedDemoType as DemoType);
    if (savedIsSubscribed === 'true') setIsSubscribed(true);
    if (savedPhoneNumber) setAssignedPhoneNumber(savedPhoneNumber);
    if (savedCallId) setCallId(savedCallId);
    if (savedProfileId) setSelectedProfileId(savedProfileId as DemoProfileId);

    // Extended business info
    if (savedWebsite) setBusinessWebsite(savedWebsite);
    if (savedAddress) setBusinessAddress(savedAddress);
    if (savedBusinessPhone) setBusinessPhone(savedBusinessPhone);
    if (savedDescription) setBusinessDescription(savedDescription);
    if (savedServices) setServicesOffered(JSON.parse(savedServices));
    if (savedHours) setBusinessHours(JSON.parse(savedHours));

    // Voice/persona
    if (savedVoice) setSelectedVoice(savedVoice);
    if (savedTone) setSelectedTone(savedTone);

    // Onboarding
    if (savedStep) setOnboardingStep(parseInt(savedStep, 10));
    if (savedComplete === 'true') setOnboardingComplete(true);

    setIsHydrated(true);
  }, []);

  // Save state to localStorage when it changes
  useEffect(() => {
    if (typeof window === 'undefined' || !isHydrated) return;

    const saveOrRemove = (key: string, value: string | null | undefined) => {
      if (value) {
        localStorage.setItem(key, value);
      } else {
        localStorage.removeItem(key);
      }
    };

    saveOrRemove(STORAGE_KEYS.tenantId, tenantId);
    saveOrRemove(STORAGE_KEYS.businessName, businessName);
    saveOrRemove(STORAGE_KEYS.ownerPhone, ownerPhone);
    saveOrRemove(STORAGE_KEYS.ownerEmail, ownerEmail);
    saveOrRemove(STORAGE_KEYS.demoType, demoType);
    localStorage.setItem(STORAGE_KEYS.isSubscribed, String(isSubscribed));
    saveOrRemove(STORAGE_KEYS.assignedPhoneNumber, assignedPhoneNumber);
    saveOrRemove(STORAGE_KEYS.callId, callId);
    saveOrRemove(STORAGE_KEYS.selectedProfileId, selectedProfileId);

    // Extended business info
    saveOrRemove(STORAGE_KEYS.businessWebsite, businessWebsite);
    saveOrRemove(STORAGE_KEYS.businessAddress, businessAddress);
    saveOrRemove(STORAGE_KEYS.businessPhone, businessPhone);
    saveOrRemove(STORAGE_KEYS.businessDescription, businessDescription);
    if (servicesOffered.length) {
      localStorage.setItem(STORAGE_KEYS.servicesOffered, JSON.stringify(servicesOffered));
    } else {
      localStorage.removeItem(STORAGE_KEYS.servicesOffered);
    }
    if (businessHours) {
      localStorage.setItem(STORAGE_KEYS.businessHours, JSON.stringify(businessHours));
    } else {
      localStorage.removeItem(STORAGE_KEYS.businessHours);
    }

    // Voice/persona
    if (selectedVoice) localStorage.setItem(STORAGE_KEYS.selectedVoice, selectedVoice);
    if (selectedTone) localStorage.setItem(STORAGE_KEYS.selectedTone, selectedTone);

    // Onboarding
    localStorage.setItem(STORAGE_KEYS.onboardingStep, String(onboardingStep));
    localStorage.setItem(STORAGE_KEYS.onboardingComplete, String(onboardingComplete));
  }, [tenantId, businessName, ownerPhone, ownerEmail, demoType, isSubscribed, assignedPhoneNumber, callId, selectedProfileId, businessWebsite, businessAddress, businessPhone, businessDescription, servicesOffered, businessHours, selectedVoice, selectedTone, onboardingStep, onboardingComplete, isHydrated]);

  // Profile selection (for sample demos)
  const selectProfile = useCallback((profileId: DemoProfileId) => {
    setSelectedProfileId(profileId);
    setDemoType('sample');
    const profile = DEMO_PROFILES[profileId];
    if (profile) {
      setBusinessName(profile.businessName);
    }
  }, []);

  // Create tenant and start demo call
  const createTenantAndStartDemo = useCallback(async () => {
    const isFocusedDemo = demoType === 'focused';

    if (isFocusedDemo) {
      if (!businessName || !ownerPhone) {
        setError('Please enter your business name and phone number');
        return;
      }
    } else {
      if (!selectedProfileId || !ownerPhone) {
        setError('Please select a business type and enter your phone number');
        return;
      }
    }

    setIsLoading(true);
    setError(null);

    // Clear previous call state
    setCallId(null);
    setCallStatus('');
    setCallDuration(0);

    try {
      if (isFocusedDemo) {
        // For focused demos, create a new tenant with the user's business info
        const demoUserId = `demo_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        const tenantResponse = await api.createTenant({
          name: businessName,
          userId: demoUserId,
          areaCode: undefined,
        });

        setTenantId(tenantResponse.id);
        if (tenantResponse.phone_number) {
          setAssignedPhoneNumber(tenantResponse.phone_number);
        }

        // Start demo call with the new tenant
        const callResponse = await api.initiateDemoCall({
          tenant_id: tenantResponse.id,
          phone_number: formatPhoneE164(ownerPhone),
        });

        setCallId(callResponse.call_id);
        setCallStatus(callResponse.status);
        setIsCallInProgress(true);
        router.push('/demo/focused/call');
      } else {
        // For sample demos, use the pre-configured static demo agent
        const callResponse = await api.initiateDemoCall({
          profile_id: selectedProfileId!,
          phone_number: formatPhoneE164(ownerPhone),
        });

        setCallId(callResponse.call_id);
        setCallStatus(callResponse.status);
        setIsCallInProgress(true);
        router.push('/demo/sample/call');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start demo');
    } finally {
      setIsLoading(false);
    }
  }, [selectedProfileId, ownerPhone, businessName, demoType, router]);

  // Retry demo call
  const retryDemoCall = useCallback(async () => {
    const isFocusedDemo = demoType === 'focused';

    // For focused demos, need tenantId; for sample demos, need selectedProfileId
    if (isFocusedDemo && !tenantId) {
      setError('Missing business information');
      return;
    }
    if (!isFocusedDemo && !selectedProfileId) {
      setError('Missing demo profile');
      return;
    }
    if (!ownerPhone) {
      setError('Missing phone number');
      return;
    }

    setIsLoading(true);
    setError(null);

    // Clear previous call state
    setCallId(null);
    setCallStatus('');
    setCallDuration(0);

    try {
      const callResponse = await api.initiateDemoCall({
        tenant_id: isFocusedDemo ? tenantId! : undefined,
        profile_id: !isFocusedDemo ? selectedProfileId! : undefined,
        phone_number: formatPhoneE164(ownerPhone),
      });

      setCallId(callResponse.call_id);
      setCallStatus(callResponse.status);
      setIsCallInProgress(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start call');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, ownerPhone, demoType, selectedProfileId]);

  // Stop polling
  const stopCallPolling = useCallback(() => {
    setPollingInterval((currentInterval) => {
      if (currentInterval) {
        clearInterval(currentInterval);
      }
      return null;
    });
    setIsCallInProgress(false);
  }, []);

  // Check call status. Reads callIdRef.current rather than closing over the
  // callId state value directly — see the ref's own comment above for why.
  const checkCallStatus = useCallback(async () => {
    const currentCallId = callIdRef.current;
    if (!currentCallId) return;

    try {
      const status = await api.getCallStatus(currentCallId);
      setCallStatus(status.status);
      setCallDuration(status.duration);

      // If completed or failed, stop polling
      if (status.status === 'completed' || status.status === 'failed' ||
          status.status === 'busy' || status.status === 'no-answer') {
        setIsCallInProgress(false);
        stopCallPolling();
      }
    } catch (err) {
      console.error('Failed to check call status:', err);
    }
  }, [stopCallPolling]);

  // Start polling for call status
  const startCallPolling = useCallback(() => {
    setPollingInterval((currentInterval) => {
      if (currentInterval) return currentInterval;

      return setInterval(() => {
        checkCallStatus();
      }, 2000);
    });

    setTimeout(() => {
      checkCallStatus();
    }, 1000);
  }, [checkCallStatus]);

  // Start test call (for onboarding flow)
  const startTestCall = useCallback(async (phone: string) => {
    if (!tenantId) {
      setError('No business found. Please complete business setup first.');
      return;
    }

    if (!phone) {
      setError('Please enter your phone number');
      return;
    }

    setCallId(null);
    setCallStatus('');
    setCallDuration(0);
    setIsCallInProgress(false);

    setIsLoading(true);
    setError(null);

    try {
      const formattedPhone = formatPhoneE164(phone);

      const callResponse = await api.initiateDemoCall({
        tenant_id: tenantId,
        phone_number: formattedPhone,
      });

      setCallId(callResponse.call_id);
      setCallStatus(callResponse.status);
      setIsCallInProgress(true);
      setOwnerPhone(phone);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start test call');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  // Fetch transcript with retries
  const fetchTranscript = useCallback(async () => {
    if (!callId) {
      setError('No call to fetch transcript for');
      return;
    }

    setIsLoading(true);
    setError(null);

    // Retry logic with increasing delays
    const delays = [3000, 5000, 7000, 10000, 15000];
    let lastError: Error | null = null;

    for (let i = 0; i < delays.length; i++) {
      try {
        const transcriptData = await api.getTranscript(callId);
        setTranscript(transcriptData);
        setIsLoading(false);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Failed to fetch transcript');
        console.log(`Transcript fetch attempt ${i + 1} failed, retrying in ${delays[i]}ms...`);

        if (i < delays.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delays[i]));
        }
      }
    }

    setError(lastError?.message || 'Failed to fetch transcript after multiple attempts');
    setIsLoading(false);
  }, [callId]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Reset all state
  const reset = useCallback(() => {
    setTenantId(null);
    setBusinessName('');
    setOwnerPhone('');
    setOwnerEmail('');
    setDemoType(null);
    setSelectedProfileId(null);
    setCallId(null);
    setCallStatus('');
    setCallDuration(0);
    setIsCallInProgress(false);
    setTranscript(null);
    setIsSubscribed(false);
    setAssignedPhoneNumber(null);
    setError(null);

    // Extended business info
    setBusinessWebsite('');
    setBusinessAddress('');
    setBusinessPhone('');
    setBusinessDescription('');
    setServicesOffered([]);
    setBusinessHours(null);

    // Voice/persona
    setSelectedVoice('11labs-Adrian');
    setSelectedTone('professional');

    // Onboarding
    setOnboardingStep(0);
    setOnboardingComplete(false);

    // Clear localStorage
    if (typeof window !== 'undefined') {
      Object.values(STORAGE_KEYS).forEach((key) => {
        localStorage.removeItem(key);
      });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  const value: OnboardingContextType = {
    // State
    tenantId,
    businessName,
    ownerPhone,
    ownerEmail,
    demoType,
    selectedProfileId,

    // Extended business info
    businessWebsite,
    businessAddress,
    businessPhone,
    businessDescription,
    servicesOffered,
    businessHours,

    // Voice/persona
    selectedVoice,
    selectedTone,

    // Onboarding progress
    onboardingStep,
    onboardingComplete,

    callId,
    callStatus,
    callDuration,
    isCallInProgress,
    transcript,
    isSubscribed,
    assignedPhoneNumber,
    isLoading,
    error,
    isHydrated,

    // Actions
    setTenantId,
    setBusinessName,
    setOwnerPhone,
    setOwnerEmail,
    setDemoType,
    selectProfile,
    setSelectedProfileId,

    // Extended business setters
    setBusinessWebsite,
    setBusinessAddress,
    setBusinessPhone,
    setBusinessDescription,
    setServicesOffered,
    setBusinessHours,

    // Voice/persona setters
    setSelectedVoice,
    setSelectedTone,

    // Subscription setters
    setAssignedPhoneNumber,
    setIsSubscribed,

    // Onboarding progress
    setOnboardingStep,

    createTenantAndStartDemo,
    retryDemoCall,
    startCallPolling,
    stopCallPolling,
    checkCallStatus,
    startTestCall,
    fetchTranscript,
    clearError,
    reset,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}
