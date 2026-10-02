import { NextResponse } from 'next/server';
import { publicPricing } from '@/lib/pricingTiers';

// GET /api/pricing: the pricing tiers and add-ons (src/lib/pricingTiers.ts). Public, no auth: it is the same information as the pricing
// page. The engine's model choices are not part of it; customers choose a tier, not models.
export async function GET() {
  return NextResponse.json(publicPricing(), { headers: { 'Cache-Control': 'public, max-age=300' } });
}
