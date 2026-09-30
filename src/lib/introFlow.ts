import type { FlowNode } from '@/types';

// The one-click "talk to Calldesk" demo (/demo/talk). A single conversation in
// three acts: the agent introduces Calldesk and asks what business the caller
// runs, then answers as that business's receptionist so the caller hears what
// their own phone line would sound like, then steps back out and wraps up.
//
// The business persona is a node in the same flow (not a second call) so the
// whole thing is one browser session with no sign-in, no phone number and no
// tenant row. Everything the persona "knows" about the business is invented on
// the spot, so it is told to say so if pressed for specifics.
export const INTRO_MAX_SECONDS = 180;

export function buildIntroFlow(): {
  startNodeId: string;
  nodes: FlowNode[];
  globalSettings: { maxCallDurationSec: number };
} {
  const nodes: FlowNode[] = [
    {
      id: 'intro',
      type: 'greeting',
      prompt:
        "You are the voice demo for Calldesk. Calldesk builds AI phone receptionists that answer a small business's calls: " +
        'they answer questions, book appointments, take messages, and can transfer a caller to a person. ' +
        'Open with one short sentence introducing yourself, then ask what kind of business the caller runs so you can show them what it would sound like on their own phone line. ' +
        'As soon as the caller says what kind of business they run, move on: never ask which scenario to demo, and never ask them questions as if you were their customer. ' +
        'If they give both the kind and the name of their business, say in the same reply: "Great, here is what a call to <business name> would sound like." and then, speaking as that business, ' +
        'answer the phone: "Thank you for calling <business name>, how can I help you today?" Say those lines out loud. ' +
        'Speak in one or two short sentences. Only state what is written here about Calldesk. If asked about pricing, availability or anything else you do not know, ' +
        'say you are only the demo and they can find details at calldesk.tech. Never invent features, prices or customers.',
      edges: [
        {
          id: 'e_intro_to_business',
          condition: 'the caller has given both the kind of business they run and its name',
          target: 'business',
        },
        {
          id: 'e_intro_to_collect',
          condition: 'the caller has said what kind of business they run but not its name, or wants to hear the demo',
          target: 'collect',
        },
        {
          id: 'e_intro_to_wrapup',
          condition: 'the caller is done, or wants to stop',
          target: 'wrapup',
        },
      ],
    },
    {
      id: 'collect',
      type: 'extraction',
      prompt:
        'You need the name of the caller\'s business. If the caller has not yet said what kind of business it is, ask for both in one short question; ' +
        'if they already did (for example "a dental clinic"), do not ask about the type again, just ask for the name. Any answer they gave earlier counts. ' +
        'If they ask you something else, answer it in one short sentence, then ask for the name again. ' +
        'As soon as you have the name, say in the same reply: "Great, here is what a call to <business name> would sound like." and then, speaking as that business, ' +
        'answer the phone: "Thank you for calling <business name>, how can I help you today?" Say those lines out loud.',
      extract: { business_name: 'string' },
      edges: [
        {
          id: 'e_collect_to_business',
          condition: 'business_name has been collected',
          target: 'business',
        },
        {
          id: 'e_collect_to_wrapup',
          condition: 'the caller wants to stop, is not interested, or asks how to get Calldesk for their own business',
          target: 'wrapup',
        },
      ],
    },
    {
      id: 'business',
      type: 'greeting',
      prompt:
        'You are now the AI receptionist for the business the caller named in this conversation (use business_name from the collected data if present), of the kind they described, taking a phone call as if the caller had dialed that business. ' +
        'Stay in that role: answer questions, offer to book an appointment, take a message. Speak in one or two short sentences, warmly and naturally, as a real receptionist would. ' +
        'You do not actually know this business. If asked for specifics such as hours, prices or an address, give a plausible short answer and say it is sample information for the demo. ' +
        'Do not claim to be a person.',
      edges: [
        {
          id: 'e_business_to_wrapup',
          condition:
            'the caller is done with the demo, wants to stop, asks about Calldesk itself, or asks how to get this for their own business',
          target: 'wrapup',
        },
      ],
    },
    {
      id: 'wrapup',
      type: 'goodbye',
      prompt:
        'Step out of any business role. In two short sentences say that this is how Calldesk can answer their phone, and that they can try it themselves at calldesk.tech. Then say goodbye.',
      edges: [],
    },
  ];

  return { startNodeId: 'intro', nodes, globalSettings: { maxCallDurationSec: INTRO_MAX_SECONDS } };
}
