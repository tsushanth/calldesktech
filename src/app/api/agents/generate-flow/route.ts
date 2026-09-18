import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/anthropic';
import type { FlowNode } from '@/types';
import { requireAuth } from '@/lib/authz';

// POST /api/agents/generate-flow — "Generate from prompt" (matches Retell's
// own Create Agent modal): a real LLM call that drafts a starting
// conversational flow from a plain-English description, landing in the same
// editor a template pick would, for review before save — never auto-saved,
// never trusted blindly. Forces the model's output through a tool call with
// a JSON-schema-constrained input rather than parsing free text, then does
// its OWN semantic validation on top (edge targets/startNodeId actually
// existing) — a JSON schema can express "this field is a string", not "this
// string must equal one of the sibling node ids", so that part has to be
// real code, not inferred trust in the model's output.
const NODE_TYPES = [
  'greeting', 'extraction', 'function', 'knowledge_base', 'transfer', 'goodbye',
  'payment', 'logic_split', 'press_digit', 'sms', 'code', 'mcp',
] as const;

const GENERATE_FLOW_TOOL = {
  name: 'emit_flow',
  description: 'Emit a conversational flow (nodes + edges) matching the described agent.',
  input_schema: {
    type: 'object' as const,
    properties: {
      startNodeId: { type: 'string', description: 'id of the node the call should begin at' },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'short, unique, lowercase_snake_case id' },
            type: { type: 'string', enum: NODE_TYPES },
            prompt: { type: 'string', description: "the step's instructions to the assistant — omit only for logic_split/press_digit" },
            extract: {
              type: 'object',
              description: 'for an extraction node only: field name -> "string"',
              additionalProperties: { type: 'string' },
            },
            edges: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  condition: { type: 'string', description: 'plain-English condition, e.g. "caller wants to book an appointment"' },
                  target: { type: 'string', description: 'id of another node in this same flow' },
                },
                required: ['target'],
              },
            },
          },
          required: ['id', 'type', 'edges'],
        },
      },
    },
    required: ['startNodeId', 'nodes'],
  },
};

export async function POST(request: NextRequest) {
  const __auth = await requireAuth(request);
  if (!__auth.ok) return __auth.response;

  const { description } = await request.json();
  if (!description || typeof description !== 'string' || !description.trim()) {
    return NextResponse.json({ error: 'A description is required.' }, { status: 400 });
  }
  if (description.length > 2000) {
    return NextResponse.json({ error: 'Description is too long (max 2000 characters).' }, { status: 400 });
  }

  let anthropic;
  try {
    anthropic = getAnthropicClient();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Anthropic not configured' }, { status: 500 });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      system:
        'You design conversational-flow voice AI agents for a phone answering product. Given a plain-English ' +
        "description of what the agent should do, call emit_flow with a real, usable flow: 4-8 nodes, a real " +
        "greeting, real extraction steps for whatever information needs collecting, and a goodbye. Every edge's " +
        'target must be the id of another node you actually included. Use logic_split for real branching on ' +
        'previously collected data, not for conversational judgment calls (those are plain edges with a ' +
        'natural-language condition). Keep it realistic and minimal — do not over-engineer a simple request.',
      messages: [{ role: 'user', content: description.trim() }],
      tools: [GENERATE_FLOW_TOOL],
      tool_choice: { type: 'tool', name: 'emit_flow' },
    });

    const toolUse = message.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ error: 'The model did not return a flow — try rephrasing the description.' }, { status: 502 });
    }

    const input = toolUse.input as { startNodeId?: string; nodes?: FlowNode[] };
    const nodes = Array.isArray(input.nodes) ? input.nodes : [];
    const startNodeId = input.startNodeId;

    // Real validation, not trust — the JSON schema above can't express these.
    if (nodes.length === 0) {
      return NextResponse.json({ error: 'The model returned an empty flow — try rephrasing the description.' }, { status: 502 });
    }
    const ids = new Set(nodes.map((n) => n.id));
    if (ids.size !== nodes.length) {
      return NextResponse.json({ error: 'The generated flow had duplicate node ids — try again.' }, { status: 502 });
    }
    if (!startNodeId || !ids.has(startNodeId)) {
      return NextResponse.json({ error: 'The generated flow had no valid start node — try again.' }, { status: 502 });
    }
    for (const node of nodes) {
      for (const edge of node.edges || []) {
        if (!edge.target || !ids.has(edge.target)) {
          return NextResponse.json(
            { error: `The generated flow had an edge from "${node.id}" to a node that doesn't exist ("${edge.target}") — try again.` },
            { status: 502 }
          );
        }
      }
    }

    return NextResponse.json({ nodes, startNodeId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate a flow';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
