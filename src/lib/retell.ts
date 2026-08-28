import type { RetellAgent, ConversationFlow, FlowNode } from '@/types';

const RETELL_API_URL = 'https://api.retellai.com';

class RetellClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${RETELL_API_URL}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Retell API Error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // Agent Management (no /v2 prefix)
  async createAgent(config: {
    agentName: string;
    voiceId: string;
    llmId: string;
  }): Promise<RetellAgent> {
    return this.request<RetellAgent>('/create-agent', {
      method: 'POST',
      body: JSON.stringify({
        agent_name: config.agentName,
        voice_id: config.voiceId,
        response_engine: {
          type: 'retell-llm',
          llm_id: config.llmId,
        },
      }),
    });
  }

  async getAgent(agentId: string): Promise<RetellAgent> {
    return this.request<RetellAgent>(`/get-agent/${agentId}`);
  }

  async updateAgent(
    agentId: string,
    config: Partial<{
      agentName: string;
      voiceId: string;
    }>
  ): Promise<RetellAgent> {
    return this.request<RetellAgent>(`/update-agent/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        agent_name: config.agentName,
        voice_id: config.voiceId,
      }),
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.request(`/delete-agent/${agentId}`, {
      method: 'DELETE',
    });
  }

  // LLM Configuration (no /v2 prefix)
  async createLLM(config: {
    generalPrompt: string;
    beginMessage?: string;
    knowledgeBaseIds?: string[];
    generalTools?: RetellGeneralTool[];
  }): Promise<{ llm_id: string }> {
    return this.request('/create-retell-llm', {
      method: 'POST',
      body: JSON.stringify({
        general_prompt: config.generalPrompt,
        begin_message: config.beginMessage,
        knowledge_base_ids: config.knowledgeBaseIds,
        general_tools: config.generalTools,
      }),
    });
  }

  async updateLLM(
    llmId: string,
    config: {
      generalPrompt?: string;
      beginMessage?: string;
      knowledgeBaseIds?: string[];
      generalTools?: RetellGeneralTool[];
    }
  ): Promise<{ llm_id: string }> {
    return this.request(`/update-retell-llm/${llmId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        general_prompt: config.generalPrompt,
        begin_message: config.beginMessage,
        knowledge_base_ids: config.knowledgeBaseIds,
        general_tools: config.generalTools,
      }),
    });
  }

  // Phone Number Management (no /v2 prefix)
  async purchasePhoneNumber(areaCode?: string): Promise<{ phone_number: string }> {
    return this.request('/create-phone-number', {
      method: 'POST',
      body: JSON.stringify({
        area_code: areaCode,
      }),
    });
  }

  async assignPhoneNumberToAgent(
    phoneNumber: string,
    agentId: string
  ): Promise<void> {
    await this.request(`/update-phone-number/${phoneNumber}`, {
      method: 'PATCH',
      body: JSON.stringify({
        inbound_agent_id: agentId,
      }),
    });
  }

  // Knowledge Base (uses multipart/form-data)
  async createKnowledgeBase(config: {
    name: string;
    texts?: Array<{ title: string; text: string }>;
    urls?: string[];
  }): Promise<{ knowledge_base_id: string }> {
    const formData = new FormData();
    formData.append('knowledge_base_name', config.name);

    if (config.texts && config.texts.length > 0) {
      formData.append('knowledge_base_texts', JSON.stringify(config.texts));
    }

    if (config.urls && config.urls.length > 0) {
      formData.append('knowledge_base_urls', JSON.stringify(config.urls));
    }

    const response = await fetch(`${RETELL_API_URL}/create-knowledge-base`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        // Note: Don't set Content-Type for FormData, browser will set it with boundary
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Retell API Error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async updateKnowledgeBase(
    kbId: string,
    config: {
      texts?: string[];
      urls?: string[];
    }
  ): Promise<void> {
    await this.request(`/update-knowledge-base/${kbId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        knowledge_base_texts: config.texts,
        knowledge_base_urls: config.urls,
      }),
    });
  }

  async deleteKnowledgeBase(kbId: string): Promise<void> {
    await this.request(`/delete-knowledge-base/${kbId}`, {
      method: 'DELETE',
    });
  }

  async deleteLLM(llmId: string): Promise<void> {
    await this.request(`/delete-retell-llm/${llmId}`, {
      method: 'DELETE',
    });
  }

  // Call Management (uses /v2 prefix)
  async getCall(callId: string): Promise<{
    call_id: string;
    transcript: string;
    recording_url: string;
    call_analysis: Record<string, unknown>;
  }> {
    return this.request(`/v2/get-call/${callId}`);
  }

  async listCalls(agentId: string, limit = 50): Promise<{
    calls: Array<{
      call_id: string;
      from_number: string;
      start_timestamp: number;
      end_timestamp: number;
    }>;
  }> {
    // list-calls uses POST, not GET with query params
    return this.request('/v2/list-calls', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: agentId,
        limit: limit,
      }),
    });
  }

  // Create outbound call (uses /v2 prefix)
  async createPhoneCall(config: {
    fromNumber: string;
    toNumber: string;
    agentId: string;
  }): Promise<{ call_id: string }> {
    return this.request('/v2/create-phone-call', {
      method: 'POST',
      body: JSON.stringify({
        from_number: config.fromNumber,
        to_number: config.toNumber,
        override_agent_id: config.agentId,
      }),
    });
  }
}

// Retell's own general_tools schema for a transfer_call entry — see
// https://docs.retellai.com/api-references/create-retell-llm. Only the
// fields this codebase actually sets are typed; Retell accepts more.
export interface RetellGeneralTool {
  type: 'transfer_call';
  name: string;
  description: string;
  transfer_destination: { type: 'predefined'; number: string };
  transfer_option: { type: 'cold_transfer' };
}

// Convert our flow format to Retell's prompt format
export function flowToRetellPrompt(flow: ConversationFlow): string {
  const nodeDescriptions = flow.nodes.map((node) => {
    return formatNodeForPrompt(node);
  }).join('\n\n');

  return `
You are an AI receptionist. Follow this conversation flow:

${nodeDescriptions}

Global Rules:
- ${flow.globalSettings.allowInterruptions ? 'Allow the caller to interrupt you' : 'Complete your sentences before listening'}
- ${flow.globalSettings.returnToFlow ? 'After answering any off-topic questions, return to the current step in the flow' : 'Stay on topic'}
- Be friendly, professional, and concise
- If you don't know something, offer to have a human call them back
`;
}

// Was previously a Retell-parity gap: a 'transfer' node only ever narrated
// "transferring you now" in the prompt with nothing behind it — the model
// had no actual mechanism to move the call off itself, so the call just
// kept talking. Retell's real transfer mechanism is a general_tools entry
// the model calls, not prose; this builds one tool per transfer node that
// has a real destination number, keyed by node id so the prompt (below) can
// tell the model exactly which tool to invoke for which node.
export function flowToRetellTools(flow: ConversationFlow): RetellGeneralTool[] {
  return flow.nodes
    .filter((node): node is FlowNode & { params: { transferTo: string } } =>
      node.type === 'transfer' && Boolean(node.params?.transferTo?.trim())
    )
    .map((node) => ({
      type: 'transfer_call' as const,
      name: `transfer_call_${node.id}`,
      description: `Transfer the call — used when reaching the "${node.id}" step of the flow: ${node.prompt}`,
      transfer_destination: { type: 'predefined' as const, number: node.params.transferTo.trim() },
      transfer_option: { type: 'cold_transfer' as const },
    }));
}

function formatNodeForPrompt(node: FlowNode): string {
  let description = `## ${node.id.toUpperCase()}\n`;
  description += `Type: ${node.type}\n`;
  description += `Instructions: ${node.prompt}\n`;

  if (node.extract) {
    description += `Data to collect: ${Object.keys(node.extract).join(', ')}\n`;
  }

  if (node.type === 'transfer' && node.params?.transferTo?.trim()) {
    description += `To perform this step, call the "transfer_call_${node.id}" tool — do not just say you're transferring without calling it.\n`;
  }

  if (node.edges.length > 0) {
    description += `Next steps:\n`;
    node.edges.forEach((edge) => {
      description += `  - If ${edge.condition}: go to ${edge.target}\n`;
    });
  }

  return description;
}

// Singleton instance
let retellClient: RetellClient | null = null;

export function getRetellClient(): RetellClient {
  if (!retellClient) {
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) {
      throw new Error('RETELL_API_KEY is not configured');
    }
    retellClient = new RetellClient(apiKey);
  }
  return retellClient;
}

export { RetellClient };
