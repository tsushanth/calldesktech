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

  // Agent Management
  async createAgent(config: {
    agentName: string;
    voiceId: string;
    llmId: string;
  }): Promise<RetellAgent> {
    return this.request<RetellAgent>('/v2/agent', {
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
    return this.request<RetellAgent>(`/v2/agent/${agentId}`);
  }

  async updateAgent(
    agentId: string,
    config: Partial<{
      agentName: string;
      voiceId: string;
    }>
  ): Promise<RetellAgent> {
    return this.request<RetellAgent>(`/v2/agent/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        agent_name: config.agentName,
        voice_id: config.voiceId,
      }),
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.request(`/v2/agent/${agentId}`, {
      method: 'DELETE',
    });
  }

  // LLM Configuration
  async createLLM(config: {
    generalPrompt: string;
    beginMessage?: string;
    knowledgeBaseIds?: string[];
  }): Promise<{ llm_id: string }> {
    return this.request('/v2/llm', {
      method: 'POST',
      body: JSON.stringify({
        general_prompt: config.generalPrompt,
        begin_message: config.beginMessage,
        knowledge_base_ids: config.knowledgeBaseIds,
      }),
    });
  }

  async updateLLM(
    llmId: string,
    config: {
      generalPrompt?: string;
      beginMessage?: string;
      knowledgeBaseIds?: string[];
    }
  ): Promise<{ llm_id: string }> {
    return this.request(`/v2/llm/${llmId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        general_prompt: config.generalPrompt,
        begin_message: config.beginMessage,
        knowledge_base_ids: config.knowledgeBaseIds,
      }),
    });
  }

  // Phone Number Management
  async purchasePhoneNumber(areaCode?: string): Promise<{ phone_number: string }> {
    return this.request('/v2/phone-number', {
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
    await this.request(`/v2/phone-number/${phoneNumber}`, {
      method: 'PATCH',
      body: JSON.stringify({
        inbound_agent_id: agentId,
      }),
    });
  }

  // Knowledge Base
  async createKnowledgeBase(config: {
    name: string;
    texts?: string[];
    urls?: string[];
  }): Promise<{ knowledge_base_id: string }> {
    return this.request('/v2/knowledge-base', {
      method: 'POST',
      body: JSON.stringify({
        knowledge_base_name: config.name,
        knowledge_base_texts: config.texts,
        knowledge_base_urls: config.urls,
      }),
    });
  }

  async updateKnowledgeBase(
    kbId: string,
    config: {
      texts?: string[];
      urls?: string[];
    }
  ): Promise<void> {
    await this.request(`/v2/knowledge-base/${kbId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        knowledge_base_texts: config.texts,
        knowledge_base_urls: config.urls,
      }),
    });
  }

  // Call Management
  async getCall(callId: string): Promise<{
    call_id: string;
    transcript: string;
    recording_url: string;
    call_analysis: Record<string, unknown>;
  }> {
    return this.request(`/v2/call/${callId}`);
  }

  async listCalls(agentId: string, limit = 50): Promise<{
    calls: Array<{
      call_id: string;
      from_number: string;
      start_timestamp: number;
      end_timestamp: number;
    }>;
  }> {
    return this.request(`/v2/list-calls?agent_id=${agentId}&limit=${limit}`);
  }
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

function formatNodeForPrompt(node: FlowNode): string {
  let description = `## ${node.id.toUpperCase()}\n`;
  description += `Type: ${node.type}\n`;
  description += `Instructions: ${node.prompt}\n`;

  if (node.extract) {
    description += `Data to collect: ${Object.keys(node.extract).join(', ')}\n`;
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
