import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { DEMO_PROFILES, type DemoProfileId } from '@/lib/constants';

// GET /api/demo-agents - Get all demo agents
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const { data: agents, error } = await supabase
      .from('calldesk_demo_agents')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json({ agents: agents || [] });
  } catch (error) {
    console.error('Error fetching demo agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch demo agents' },
      { status: 500 }
    );
  }
}

// DELETE /api/demo-agents - Delete all demo agents (admin only, for recreating with KB)
export async function DELETE(request: NextRequest) {
  try {
    // Simple auth check
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.RETELL_API_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const retell = getRetellClient();

    // Get all demo agents
    const { data: agents, error: fetchError } = await supabase
      .from('calldesk_demo_agents')
      .select('*');

    if (fetchError) {
      throw fetchError;
    }

    const results: { profile: string; success: boolean; error?: string }[] = [];

    // Delete each agent from Retell and database
    for (const agent of agents || []) {
      try {
        // Delete from Retell (agent, LLM, KB)
        if (agent.retell_agent_id) {
          await retell.deleteAgent(agent.retell_agent_id).catch(() => {});
        }
        if (agent.retell_llm_id) {
          await retell.deleteLLM(agent.retell_llm_id).catch(() => {});
        }
        if (agent.retell_kb_id) {
          await retell.deleteKnowledgeBase(agent.retell_kb_id).catch(() => {});
        }

        // Delete from database
        await supabase.from('calldesk_demo_agents').delete().eq('id', agent.id);

        results.push({ profile: agent.profile_id, success: true });
      } catch (err) {
        results.push({
          profile: agent.profile_id,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      message: 'Demo agents deletion complete',
      results,
    });
  } catch (error) {
    console.error('Error deleting demo agents:', error);
    return NextResponse.json(
      { error: 'Failed to delete demo agents' },
      { status: 500 }
    );
  }
}

// POST /api/demo-agents - Initialize demo agents (admin only, run once)
export async function POST(request: NextRequest) {
  try {
    // Simple auth check - in production, use proper admin auth
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.RETELL_API_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const retell = getRetellClient();

    const results: { profile: string; success: boolean; error?: string }[] = [];

    // Process each demo profile
    for (const [profileId, profile] of Object.entries(DEMO_PROFILES) as [DemoProfileId, typeof DEMO_PROFILES[DemoProfileId]][]) {
      try {
        // Check if already exists
        const { data: existing } = await supabase
          .from('calldesk_demo_agents')
          .select('id')
          .eq('profile_id', profileId)
          .single();

        if (existing) {
          results.push({ profile: profileId, success: true, error: 'Already exists' });
          continue;
        }

        // Create knowledge base with demo business info
        console.log(`Creating knowledge base for ${profile.businessName}...`);
        const kbContent = getDemoKnowledgeBase(profile);
        // Convert string array to title/text format required by Retell API
        const kbTexts = kbContent.map((text, index) => ({
          title: `${profile.businessName} - Section ${index + 1}`,
          text: text,
        }));
        const kb = await retell.createKnowledgeBase({
          name: `Demo - ${profile.businessName}`.slice(0, 39), // Max 40 chars
          texts: kbTexts,
        });
        console.log(`Knowledge base created: ${kb.knowledge_base_id}`);

        // Create LLM with profile-specific prompt and knowledge base
        console.log(`Creating LLM for ${profile.businessName}...`);
        const llm = await retell.createLLM({
          generalPrompt: getDemoPrompt(profile),
          beginMessage: profile.greeting,
          knowledgeBaseIds: [kb.knowledge_base_id],
        });

        // Create Agent with profile's voice
        console.log(`Creating Agent for ${profile.businessName}...`);
        const agent = await retell.createAgent({
          agentName: `Demo - ${profile.businessName}`,
          voiceId: profile.voiceId,
          llmId: llm.llm_id,
        });

        // Save to database
        const { error: insertError } = await supabase
          .from('calldesk_demo_agents')
          .insert({
            profile_id: profileId,
            business_name: profile.businessName,
            business_type: profile.businessType,
            retell_agent_id: agent.agent_id,
            retell_llm_id: llm.llm_id,
            retell_kb_id: kb.knowledge_base_id,
            voice_id: profile.voiceId,
            greeting: profile.greeting,
            knowledge_base: kbContent, // Store KB content for display on website
          });

        if (insertError) {
          throw insertError;
        }

        results.push({ profile: profileId, success: true });
        console.log(`Created demo agent for ${profile.businessName}`);
      } catch (err) {
        console.error(`Error creating demo agent for ${profileId}:`, err);
        results.push({
          profile: profileId,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      message: 'Demo agents initialization complete',
      results,
    });
  } catch (error) {
    console.error('Error initializing demo agents:', error);
    return NextResponse.json(
      { error: 'Failed to initialize demo agents' },
      { status: 500 }
    );
  }
}

// Generate a demo-specific prompt
function getDemoPrompt(profile: typeof DEMO_PROFILES[DemoProfileId]): string {
  const basePrompt = `You are a friendly and professional AI receptionist for ${profile.businessName}, a ${profile.businessType} business.

Your personality: ${profile.displayName} - ${profile.voiceStyle}

Your primary goals are:
1. Warmly greet callers and make them feel welcome
2. Answer questions about the business and services
3. Help callers book appointments
4. Take messages when needed

Guidelines:
- Be warm, helpful, and conversational
- Match your tone to the business type
- If you don't know something specific, offer to have someone call them back
- Always confirm important details (name, phone number, appointment time)
- Keep responses concise but friendly`;

  // Add business-specific context
  const businessContext = getBusinessContext(profile.businessType);

  return `${basePrompt}

${businessContext}

When booking appointments:
- Ask for the caller's name and preferred time
- Confirm the appointment details before ending the call
- If the requested time is unavailable, offer alternatives

Remember: This is a demo call, so be helpful and showcase the AI's capabilities!`;
}

function getBusinessContext(businessType: string): string {
  switch (businessType) {
    case 'plumbing':
      return `Business context:
- We handle emergency plumbing, water heaters, drain cleaning, and general repairs
- Emergency calls are prioritized
- We serve residential and commercial customers
- Typical appointment slots are morning (8-12) and afternoon (1-5)`;

    case 'salon':
      return `Business context:
- We offer haircuts, coloring, styling, and spa treatments
- Popular services include blowouts, highlights, and manicures
- Walk-ins are welcome but appointments are recommended
- We have experienced stylists for all hair types`;

    case 'medical':
      return `Business context:
- We're a family medical clinic offering primary care
- We handle routine checkups, sick visits, and preventive care
- New patients are welcome
- We accept most major insurance plans`;

    case 'restaurant':
      return `Business context:
- We serve authentic Italian cuisine
- Reservations are recommended for dinner, especially weekends
- We can accommodate dietary restrictions
- Private dining available for special events`;

    case 'auto_repair':
      return `Business context:
- We handle oil changes, brake service, engine diagnostics, and general repairs
- We work on all makes and models
- Free estimates are provided
- We offer a shuttle service for customers`;

    default:
      return `Business context:
- We're here to help with all your ${businessType} needs
- Appointments can be scheduled at your convenience`;
  }
}

// Generate detailed knowledge base content for demo profiles
function getDemoKnowledgeBase(profile: typeof DEMO_PROFILES[DemoProfileId]): string[] {
  const knowledgeBases: Record<string, string[]> = {
    plumber: [
      `About Mike's Plumbing:
Mike's Plumbing has been serving the Austin area for over 15 years. Owner Mike Johnson started the business after 10 years working for larger plumbing companies. We're a family-owned business that takes pride in honest, quality work.`,

      `Services & Pricing:
- Emergency plumbing repairs: $150 service call + parts/labor
- Water heater installation: Starting at $800 (40-gallon tank)
- Tankless water heater installation: Starting at $2,500
- Drain cleaning: $175 for standard drains, $250 for main line
- Leak detection and repair: $150 service call + repairs
- Toilet repair/replacement: $125-$400 depending on issue
- Faucet installation: $150-$250 labor + fixture cost
- Garbage disposal installation: $200 + disposal cost
- Sump pump installation: Starting at $500`,

      `Business Hours:
Monday-Friday: 7:00 AM - 6:00 PM
Saturday: 8:00 AM - 2:00 PM
Sunday: Closed (Emergency calls only)
24/7 Emergency Service Available: Call our main line anytime`,

      `Service Area:
We serve Austin and surrounding areas including:
- North Austin, South Austin, East Austin, West Austin
- Round Rock, Cedar Park, Pflugerville
- Georgetown, Leander, Kyle
- Service radius: approximately 30 miles from downtown Austin`,

      `What to Expect:
1. Call or text to schedule - we'll give you a 2-hour arrival window
2. Our technician will call 30 minutes before arrival
3. We provide upfront pricing before any work begins
4. Licensed and insured - TX License #M-38472
5. All work guaranteed for 1 year on labor, manufacturer warranty on parts`,
    ],

    salon: [
      `About Bella's Hair Studio:
Bella's Hair Studio opened in 2018 by stylist Isabella Martinez. After working at high-end salons in Dallas, Bella wanted to create a warm, welcoming space where clients feel like family. Our talented team of 6 stylists specializes in all hair types and textures.`,

      `Services & Pricing:
Haircuts:
- Women's haircut & style: $55-$85 (based on length)
- Men's haircut: $35
- Children's haircut (12 & under): $25
- Bang trim: $15

Color Services:
- Single process color: $85+
- Full highlights: $150-$250
- Partial highlights: $95-$150
- Balayage/Ombre: $200-$350
- Color correction: Consultation required

Treatments:
- Deep conditioning treatment: $35
- Keratin treatment: $250-$400
- Olaplex treatment: $45 add-on`,

      `Spa Services:
- Manicure: $30
- Gel manicure: $45
- Pedicure: $50
- Gel pedicure: $65
- Facial (60 min): $85
- Eyebrow wax: $18
- Full face wax: $45`,

      `Business Hours:
Tuesday-Friday: 9:00 AM - 7:00 PM
Saturday: 9:00 AM - 5:00 PM
Sunday-Monday: Closed

Walk-ins welcome based on availability, but appointments are recommended for color services.`,

      `Our Team:
- Bella (Owner): 12+ years experience, color specialist
- Sarah: Balayage expert, trained in NYC
- Marcus: Men's cuts and fades
- Jessica: Bridal and special occasion styling
- Emily: Curly hair specialist (DevaCurl certified)
- Alex: Junior stylist, great with kids`,
    ],

    medical: [
      `About Sunrise Family Clinic:
Sunrise Family Clinic has provided primary care to families in the Houston area since 2010. Founded by Dr. Sarah Chen, we believe in treating the whole person, not just symptoms. Our caring team of physicians and nurse practitioners sees patients of all ages, from newborns to seniors.`,

      `Services Offered:
Primary Care:
- Annual wellness exams
- Sick visits (same-day appointments often available)
- Chronic disease management (diabetes, hypertension, etc.)
- Women's health and Pap smears
- Men's health screenings
- Pediatric care and well-child visits
- Immunizations and flu shots
- Sports and school physicals

Additional Services:
- Basic lab work on-site
- EKG/Heart rhythm testing
- Minor procedures (stitches, wart removal, etc.)
- Referrals to specialists when needed`,

      `Insurance & Payment:
We accept most major insurance plans including:
- Blue Cross Blue Shield
- Aetna
- Cigna
- United Healthcare
- Medicare
- Medicaid (some plans)

Self-pay patients: We offer a sliding scale and payment plans. A typical office visit is $125-$175 for uninsured patients.`,

      `Business Hours:
Monday-Friday: 8:00 AM - 5:00 PM
Saturday: 9:00 AM - 12:00 PM (urgent care only)
Sunday: Closed

For after-hours emergencies, call our main line for the on-call provider.`,

      `Our Providers:
- Dr. Sarah Chen, MD - Family Medicine, 15+ years experience
- Dr. Michael Torres, MD - Internal Medicine
- Jennifer Walsh, NP - Family Nurse Practitioner
- Lisa Park, PA-C - Physician Assistant

New patients welcome! Please arrive 15 minutes early to complete paperwork, or download forms from our website.`,
    ],

    restaurant: [
      `About Mama Rosa's Kitchen:
Mama Rosa's Kitchen brings authentic Italian home cooking to San Antonio since 1998. Rosa Benedetti emigrated from Naples in 1985 and opened this restaurant to share her family recipes passed down for generations. Now run by Rosa and her daughter Maria, we still make everything fresh daily, just like Mama taught us.`,

      `Menu Highlights:
Appetizers:
- Bruschetta al Pomodoro: $12
- Calamari Fritti: $16
- Antipasto for Two: $22

Pasta (all made fresh daily):
- Spaghetti & Meatballs: $18
- Fettuccine Alfredo: $17
- Lasagna della Casa: $21
- Ravioli (cheese or meat): $19
- Penne alla Vodka: $18

Entrees:
- Chicken Parmesan: $24
- Veal Piccata: $28
- Eggplant Parmesan: $20
- Salmon Oreganata: $26

Desserts (made in-house):
- Tiramisu: $10
- Cannoli: $8
- Panna Cotta: $9`,

      `Wine & Drinks:
Extensive Italian wine list featuring wines from Tuscany, Piedmont, and Sicily. House wines available by the glass ($9) or carafe ($28). Full bar available.

Specialty cocktails include our famous Limoncello Martini and Rosa's Negroni.`,

      `Hours & Reservations:
Tuesday-Thursday: 5:00 PM - 9:00 PM
Friday-Saturday: 5:00 PM - 10:00 PM
Sunday: 4:00 PM - 8:00 PM
Monday: Closed

Reservations highly recommended for Friday and Saturday. Walk-ins welcome but may have a wait during peak hours.`,

      `Private Events:
Our private dining room seats up to 30 guests. Perfect for:
- Rehearsal dinners
- Birthday celebrations
- Corporate events
- Anniversary parties

Custom menus available. Minimum spend applies on weekends.
Contact us for more information about private events.`,

      `Dietary Accommodations:
- Gluten-free pasta available (+$3)
- Vegetarian options clearly marked on menu
- Vegan dishes can be prepared upon request
- Please inform your server of any allergies`,
    ],

    auto: [
      `About Joe's Auto Repair:
Joe's Auto Repair has been the trusted neighborhood mechanic in Phoenix since 1995. Owner Joe Martinez learned the trade from his father and believes in honest, fair pricing. We work on all makes and models, foreign and domestic. Our ASE-certified technicians treat your car like it's their own.`,

      `Services & Pricing:
Oil Change:
- Conventional oil change: $39.99
- Synthetic blend: $59.99
- Full synthetic: $79.99
- Includes filter, fluid top-off, and 21-point inspection

Brake Service:
- Brake inspection: Free
- Front brake pads: $149-$199 (most vehicles)
- Rear brake pads: $149-$199 (most vehicles)
- Rotors: Additional $100-$200 per axle

Other Common Services:
- Tire rotation: $25
- Wheel alignment: $89
- Battery replacement: $129-$179 + battery cost
- A/C recharge: $129
- Transmission fluid service: $149
- Coolant flush: $99
- Check engine light diagnosis: $89 (waived with repair)`,

      `Business Hours:
Monday-Friday: 7:30 AM - 5:30 PM
Saturday: 8:00 AM - 2:00 PM
Sunday: Closed

Drop-offs available - leave your key in the drop box and we'll call you with an estimate.`,

      `What Makes Us Different:
- Free shuttle service within 5 miles
- Comfortable waiting room with Wi-Fi and coffee
- All repairs explained before work begins
- No surprise charges - we call if additional work is needed
- 12-month/12,000-mile warranty on all repairs
- Family discount: 10% off labor for repeat customers`,

      `Certifications & Credentials:
- ASE Certified technicians
- AAA Approved Auto Repair facility
- BBB A+ rating
- State inspection station
- All major makes: Honda, Toyota, Ford, Chevy, BMW, Mercedes, and more

We specialize in: Check engine diagnostics, brake repair, AC service, and general maintenance. For major engine or transmission rebuilds, we can provide referrals to specialty shops.`,
    ],
  };

  return knowledgeBases[profile.id] || [
    `About ${profile.businessName}:
We are a ${profile.businessType} business dedicated to providing excellent service to our customers.`,
  ];
}
