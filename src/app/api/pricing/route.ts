import { NextResponse } from 'next/server';
import { publicPricing } from '@/lib/pricingTiers';
import { publicNumberAddOn } from '@/lib/numberAddOn';
import { publicExpertBackup } from '@/lib/expertBackup';

// GET /api/pricing: the pricing tiers, the phone number and expert backup extras and add-ons (src/lib/pricingTiers.ts, src/lib/numberAddOn.ts). Public, no auth: it is the same information as the pricing
// page. The engine's model choices are not part of it; customers choose a tier, not models.
export async function GET() {
  return NextResponse.json({ ...publicPricing(), phoneNumbers: publicNumberAddOn(), expertBackup: publicExpertBackup() }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
