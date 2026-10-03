// What the docs page shows for the MCP server: every registered tool, grouped, with a one-line summary.
// test/lib/mcpToolDocs.test.ts fails if a tool is registered in tools.ts without an entry here (or listed here but not registered),
// so this cannot drift from the server.
export type McpToolDoc = { name: string; summary: string };
export type McpToolGroup = { group: string; tools: McpToolDoc[] };

export const MCP_TOOL_GROUPS: McpToolGroup[] = [
  { group: 'Workspace', tools: [{ name: 'whoami', summary: 'Show the workspace this connection is pinned to.' }] },
  {
    group: 'Agents',
    tools: [
      { name: 'flow_authoring_guide', summary: 'Read first: node types, parameters, edge rules and gotchas for building a flow.' },
      { name: 'list_agents', summary: 'List agents with their latest version’s engine and voice, and the numbers routed to them.' },
      { name: 'create_agent', summary: 'Create an agent (publish a version next).' },
      { name: 'get_agent', summary: 'Get one agent.' },
      { name: 'rename_agent', summary: 'Rename an agent.' },
      { name: 'delete_agent', summary: 'Permanently delete an agent and its versions, subflows and knowledge bases.' },
      { name: 'list_agent_versions', summary: 'List an agent’s immutable versions, newest first.' },
      { name: 'publish_agent_version', summary: 'Publish a new immutable version from a conversation-flow graph. Optional tier (standard or pro) picks the models for you; advanced llmModel and ttsModel override them.' },
      { name: 'list_agent_templates', summary: 'List the built-in agent templates.' },
      { name: 'create_agent_from_template', summary: 'Create a ready-to-call agent from a template and publish its first version.' },
      { name: 'list_agent_environments', summary: 'List an agent’s staging and production environments and the version each points to.' },
      { name: 'promote_agent_environment', summary: 'Promote a version into staging or production.' },
      { name: 'analyze_agent_copilot', summary: 'Analyze recent real calls for recurring problems and propose flow edits grounded in specific transcripts.' },
    ],
  },
  {
    group: 'Pricing and models',
    tools: [
      { name: 'list_pricing_tiers', summary: 'List the pricing tiers (Lite, Standard, Pro) with price per minute, what each includes, carrier billing and add-ons.' },
      { name: 'list_model_options', summary: 'List the language models (llmModel) and voice models (ttsModel) a version can use, with status and notes (advanced).' },
    ],
  },
  {
    group: 'Subflows and knowledge',
    tools: [
      { name: 'list_subflows', summary: 'List subflows (library ones plus an agent’s own).' },
      { name: 'create_subflow', summary: 'Create a reusable sub-graph to reference from a subflow_ref node.' },
      { name: 'update_subflow', summary: 'Update a subflow. Published versions keep their snapshot.' },
      { name: 'delete_subflow', summary: 'Delete a subflow.' },
      { name: 'list_knowledge_bases', summary: 'List knowledge bases.' },
      { name: 'create_knowledge_base', summary: 'Create a knowledge base.' },
      { name: 'add_knowledge_items', summary: 'Add question-and-answer items to a knowledge base.' },
      { name: 'delete_knowledge_base', summary: 'Delete a knowledge base and its items.' },
    ],
  },
  {
    group: 'Sounds',
    tools: [
      { name: 'list_sounds', summary: 'List the workspace’s intro jingle and sound effects.' },
      { name: 'create_jingle', summary: 'Generate the intro jingle that plays when a call connects.' },
      { name: 'create_sound_effect', summary: 'Generate a sound effect the agent can play mid-call.' },
      { name: 'delete_sound', summary: 'Delete a jingle or sound effect.' },
    ],
  },
  {
    group: 'Numbers and calls',
    tools: [
      { name: 'list_phone_numbers', summary: 'List phone numbers and the agent versions they route to.' },
      { name: 'set_number_routing', summary: 'Route a number’s inbound or outbound calls to a version or an environment.' },
      { name: 'place_call', summary: 'Place a real outbound call from one of your numbers (costs money).' },
      { name: 'list_calls', summary: 'List recent calls.' },
      { name: 'get_call', summary: 'Get one call: transcript, outcome, duration and transfer status.' },
    ],
  },
  {
    group: 'Batch calls',
    tools: [
      { name: 'list_batch_calls', summary: 'List batch calls.' },
      { name: 'create_batch_call', summary: 'Create (not start) a batch of outbound calls for a version.' },
      { name: 'get_batch_call', summary: 'Get a batch and every target with its dial status.' },
      { name: 'run_batch_call', summary: 'Start a batch: dials every number (costs money).' },
    ],
  },
  {
    group: 'Webhooks and integrations',
    tools: [
      { name: 'list_webhooks', summary: 'List webhooks.' },
      { name: 'create_webhook', summary: 'Register a webhook.' },
      { name: 'delete_webhook', summary: 'Delete a webhook.' },
      { name: 'lookup_hubspot_contact', summary: 'Find a caller’s HubSpot contact by phone and return fields usable as call-time variables.' },
    ],
  },
  {
    group: 'Analytics',
    tools: [
      { name: 'get_analytics', summary: 'Call analytics by day.' },
      { name: 'get_qa_overview', summary: 'QA scores, resolution rate and transfer metrics.' },
    ],
  },
];
