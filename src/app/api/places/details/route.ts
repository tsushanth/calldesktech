import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

interface PlaceResult {
  name?: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  website?: string;
  opening_hours?: {
    periods?: Array<{
      open?: { day: number; time: string };
      close?: { time: string };
    }>;
  };
  types?: string[];
  business_status?: string;
  dine_in?: boolean;
  takeout?: boolean;
  delivery?: boolean;
  curbside_pickup?: boolean;
  reservable?: boolean;
  serves_beer?: boolean;
  serves_breakfast?: boolean;
  serves_brunch?: boolean;
  serves_dinner?: boolean;
  serves_lunch?: boolean;
  serves_vegetarian_food?: boolean;
  serves_wine?: boolean;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const placeId = searchParams.get('place_id');

  if (!placeId) {
    return NextResponse.json({ error: 'place_id parameter is required' }, { status: 400 });
  }

  if (!GOOGLE_PLACES_API_KEY) {
    return NextResponse.json({ error: 'Google Places API key not configured' }, { status: 500 });
  }

  try {
    // Use Google Places Details API
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('key', GOOGLE_PLACES_API_KEY);
    url.searchParams.set('fields', 'name,formatted_address,formatted_phone_number,website,opening_hours,types,business_status,dine_in,takeout,delivery,curbside_pickup,reservable,serves_beer,serves_breakfast,serves_brunch,serves_dinner,serves_lunch,serves_vegetarian_food,serves_wine');

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== 'OK') {
      console.error('Google Places Details API error:', data.status, data.error_message);
      return NextResponse.json({ error: 'Failed to get place details' }, { status: 500 });
    }

    const place: PlaceResult = data.result;

    // Parse opening hours into our format
    let businessHours: Record<string, { open: string; close: string; closed: boolean }> | null = null;
    if (place.opening_hours?.periods) {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      businessHours = {};

      days.forEach((day, index) => {
        const period = place.opening_hours!.periods!.find((p) => p.open?.day === index);
        if (period) {
          businessHours![day] = {
            open: formatTime(period.open?.time || '0900'),
            close: formatTime(period.close?.time || '1700'),
            closed: false,
          };
        } else {
          businessHours![day] = {
            open: '09:00',
            close: '17:00',
            closed: true,
          };
        }
      });
    }

    // Extract business type from types
    const businessType = extractBusinessType(place.types || []);

    // Extract services from Google Places fields
    const services = extractServicesFromPlace(place);

    return NextResponse.json({
      place_id: placeId,
      name: place.name,
      address: place.formatted_address,
      phone: place.formatted_phone_number,
      website: place.website,
      business_hours: businessHours,
      business_type: businessType,
      business_status: place.business_status,
      services,
    });
  } catch (error) {
    console.error('Places details error:', error);
    return NextResponse.json({ error: 'Failed to get place details' }, { status: 500 });
  }
}

function formatTime(time: string): string {
  // Convert "0900" to "09:00"
  if (time.length === 4) {
    return `${time.slice(0, 2)}:${time.slice(2)}`;
  }
  return time;
}

function extractServicesFromPlace(place: PlaceResult): string[] {
  const services: string[] = [];

  // Map Google Places boolean fields to service names
  if (place.dine_in) services.push('Indoor Seating');
  if (place.takeout) services.push('Takeout');
  if (place.delivery) services.push('Delivery');
  if (place.curbside_pickup) services.push('Curbside Pickup');
  if (place.reservable) services.push('Reservations');
  if (place.serves_breakfast) services.push('Breakfast');
  if (place.serves_brunch) services.push('Brunch');
  if (place.serves_lunch) services.push('Lunch');
  if (place.serves_dinner) services.push('Dinner');
  if (place.serves_vegetarian_food) services.push('Vegetarian Options');
  if (place.serves_beer) services.push('Beer');
  if (place.serves_wine) services.push('Wine');

  return services;
}

function extractBusinessType(types: string[]): string {
  // Map Google Place types to friendly names
  const typeMap: Record<string, string> = {
    'plumber': 'Plumbing',
    'electrician': 'Electrical',
    'dentist': 'Dental',
    'doctor': 'Medical',
    'lawyer': 'Legal',
    'restaurant': 'Restaurant',
    'cafe': 'Cafe',
    'hair_care': 'Salon',
    'beauty_salon': 'Salon',
    'spa': 'Spa',
    'gym': 'Fitness',
    'car_repair': 'Auto Repair',
    'veterinary_care': 'Veterinary',
    'real_estate_agency': 'Real Estate',
    'accounting': 'Accounting',
    'insurance_agency': 'Insurance',
    'travel_agency': 'Travel',
    'lodging': 'Hotel',
    'store': 'Retail',
    'home_goods_store': 'Home Goods',
    'hardware_store': 'Hardware',
    'general_contractor': 'Contractor',
    'hvac': 'HVAC',
    'roofing_contractor': 'Roofing',
    'moving_company': 'Moving',
    'locksmith': 'Locksmith',
    'painter': 'Painting',
    'physiotherapist': 'Physical Therapy',
    'chiropractor': 'Chiropractic',
    'pet_store': 'Pet Store',
  };

  for (const type of types) {
    if (typeMap[type]) {
      return typeMap[type];
    }
  }

  return 'Business';
}
