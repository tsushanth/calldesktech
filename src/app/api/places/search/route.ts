import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');

  if (!query) {
    return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
  }

  if (!GOOGLE_PLACES_API_KEY) {
    return NextResponse.json({ error: 'Google Places API key not configured' }, { status: 500 });
  }

  try {
    // Use Google Places Text Search API
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('query', query);
    url.searchParams.set('key', GOOGLE_PLACES_API_KEY);
    url.searchParams.set('type', 'establishment');

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('Google Places API error:', data.status, data.error_message);
      return NextResponse.json({ error: 'Failed to search places' }, { status: 500 });
    }

    // Map results to a simpler format
    const results = (data.results || []).slice(0, 5).map((place: Record<string, unknown>) => ({
      place_id: place.place_id,
      name: place.name,
      address: place.formatted_address,
      types: place.types,
    }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Places search error:', error);
    return NextResponse.json({ error: 'Failed to search places' }, { status: 500 });
  }
}
