import type { BookingSlot } from '@/types';

const CAL_API_URL = 'https://api.cal.com/v2';

class CalClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${CAL_API_URL}${endpoint}`, {
      ...options,
      headers: {
        'cal-api-version': '2024-08-13',
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cal.com API Error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // Get available slots for a specific event type
  async getAvailability(config: {
    eventTypeId: string;
    startTime: string; // ISO string
    endTime: string; // ISO string
    timeZone?: string;
  }): Promise<BookingSlot[]> {
    const params = new URLSearchParams({
      eventTypeId: config.eventTypeId,
      startTime: config.startTime,
      endTime: config.endTime,
      timeZone: config.timeZone || 'America/New_York',
    });

    const response = await this.request<{
      data: {
        slots: Record<string, Array<{ time: string }>>;
      };
    }>(`/slots/available?${params}`);

    // Flatten slots from all dates
    const slots: BookingSlot[] = [];
    for (const [, daySlots] of Object.entries(response.data.slots)) {
      for (const slot of daySlots) {
        slots.push({
          startTime: slot.time,
          endTime: new Date(new Date(slot.time).getTime() + 30 * 60000).toISOString(), // Assume 30 min
          available: true,
        });
      }
    }

    return slots;
  }

  // Create a booking
  async createBooking(config: {
    eventTypeId: string;
    start: string; // ISO string
    attendee: {
      name: string;
      email: string;
      timeZone?: string;
    };
    metadata?: Record<string, string>;
  }): Promise<{
    id: string;
    uid: string;
    status: string;
  }> {
    const response = await this.request<{
      data: {
        id: string;
        uid: string;
        status: string;
      };
    }>('/bookings', {
      method: 'POST',
      body: JSON.stringify({
        eventTypeId: parseInt(config.eventTypeId),
        start: config.start,
        attendee: {
          name: config.attendee.name,
          email: config.attendee.email,
          timeZone: config.attendee.timeZone || 'America/New_York',
        },
        metadata: config.metadata,
      }),
    });

    return response.data;
  }

  // Get booking by ID
  async getBooking(bookingId: string): Promise<{
    id: string;
    uid: string;
    status: string;
    startTime: string;
    endTime: string;
  }> {
    const response = await this.request<{
      data: {
        id: string;
        uid: string;
        status: string;
        startTime: string;
        endTime: string;
      };
    }>(`/bookings/${bookingId}`);

    return response.data;
  }

  // Cancel a booking
  async cancelBooking(bookingId: string, reason?: string): Promise<void> {
    await this.request(`/bookings/${bookingId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        cancellationReason: reason,
      }),
    });
  }

  // Get event types
  async getEventTypes(): Promise<Array<{
    id: string;
    title: string;
    slug: string;
    length: number;
  }>> {
    const response = await this.request<{
      data: Array<{
        id: string;
        title: string;
        slug: string;
        length: number;
      }>;
    }>('/event-types');

    return response.data;
  }
}

// Helper function to format availability for AI prompt
export function formatAvailabilityForAI(slots: BookingSlot[]): string {
  if (slots.length === 0) {
    return 'No available times in the requested period.';
  }

  const grouped = slots.reduce((acc, slot) => {
    const date = new Date(slot.startTime).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(
      new Date(slot.startTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    );
    return acc;
  }, {} as Record<string, string[]>);

  return Object.entries(grouped)
    .map(([date, times]) => `${date}: ${times.join(', ')}`)
    .join('\n');
}

// Factory function to create Cal client for a tenant
export function createCalClient(apiKey: string): CalClient {
  return new CalClient(apiKey);
}

export { CalClient };
