import type { FlowNode } from '@/types';

// Synthesizes a node-based flow from the wizard's building-block toggles —
// shared by real onboarding (creates an agent's first version), dashboard
// settings (creates a later version on edit), and the capability demos
// (each demos exactly one block in isolation). This is the one place that
// decides what a toggle actually means as flow structure — see the
// "Two-Tier Onboarding" design doc for why FAQ/KB is always baseline while
// booking/transfer/take-message are opt-in.
export interface WizardBlocks {
  booking: boolean;
  transfer: boolean;
  takeMessage: boolean;
}

export interface WizardBusinessInfo {
  businessName: string;
  businessType?: string;
  greeting?: string;
  transferToNumber?: string;
}

export const DEFAULT_WIZARD_BLOCKS: WizardBlocks = {
  booking: true,
  transfer: false,
  takeMessage: true,
};

export function buildWizardFlow(info: WizardBusinessInfo, blocks: WizardBlocks): { startNodeId: string; nodes: FlowNode[] } {
  const nodes: FlowNode[] = [];
  const greetingEdges: FlowNode['edges'] = [];

  if (blocks.booking) {
    greetingEdges.push({ id: 'e_to_booking', condition: 'caller wants to book or schedule an appointment', target: 'booking' });
  }
  if (blocks.transfer) {
    greetingEdges.push({ id: 'e_to_transfer', condition: 'caller explicitly asks to speak to a human or a real person', target: 'transfer' });
  }
  if (blocks.takeMessage) {
    greetingEdges.push({ id: 'e_to_message', condition: 'caller wants to leave a message or have someone call them back', target: 'take_message' });
  }
  greetingEdges.push({ id: 'e_to_goodbye', condition: 'caller is done and ready to hang up', target: 'goodbye' });

  // FAQ/knowledge-base answering is the baseline, not a separate node — the
  // greeting node itself is instructed to answer questions directly, only
  // transitioning out for the actionable outcomes above.
  nodes.push({
    id: 'greeting',
    type: 'greeting',
    prompt:
      `Greet the caller as ${info.businessName}'s AI receptionist${info.greeting ? ` — use this exact opening if it fits naturally: "${info.greeting}"` : ''}. ` +
      `Answer any questions about the business (hours, services, pricing) directly using what you know about it. ` +
      `Only move to a different step for one of the actionable outcomes listed below.`,
    edges: greetingEdges,
  });

  if (blocks.booking) {
    nodes.push({
      id: 'booking',
      type: 'extraction',
      prompt: "Ask for the caller's name and their preferred appointment date/time.",
      extract: { name: 'string', preferred_time: 'string' },
      edges: [{ id: 'e_booking_done', condition: 'both name and preferred_time have been collected', target: 'goodbye' }],
    });
  }

  if (blocks.transfer) {
    nodes.push({
      id: 'transfer',
      type: 'transfer',
      prompt: 'Let the caller know you are transferring them to a team member now.',
      params: { transferTo: info.transferToNumber || '' },
      edges: [],
    });
  }

  if (blocks.takeMessage) {
    nodes.push({
      id: 'take_message',
      type: 'extraction',
      prompt: "Apologize that no one is available right now, then ask for the caller's name, callback number, and a brief reason for their call.",
      extract: { name: 'string', callback_number: 'string', reason: 'string' },
      edges: [{ id: 'e_message_done', condition: 'name, callback_number, and reason have all been collected', target: 'goodbye' }],
    });
  }

  nodes.push({
    id: 'goodbye',
    type: 'goodbye',
    prompt: 'Thank the caller for calling and say a warm goodbye.',
    edges: [],
  });

  return { startNodeId: 'greeting', nodes };
}

// One-block variant used by the capability demos — same builder, just with
// every other block forced off so the demo shows exactly one capability in
// isolation, undiluted by the others.
export function buildSingleBlockDemoFlow(info: WizardBusinessInfo, block: keyof WizardBlocks): { startNodeId: string; nodes: FlowNode[] } {
  return buildWizardFlow(info, {
    booking: block === 'booking',
    transfer: block === 'transfer',
    takeMessage: block === 'takeMessage',
  });
}
