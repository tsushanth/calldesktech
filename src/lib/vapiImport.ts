import type { FlowNode } from '@/types';
import { normalizeLanguage } from '@/lib/languages';

// Turns a Vapi assistant (the JSON from GET /assistant/{id}, or the assistant object copied from the dashboard) into a Calldesk
// conversational-flow draft. Pure and deterministic: no network, no model call. The draft lands in the editor for review, like
// "Generate from prompt"; nothing is saved here.
//
// Shape of the result: one main step that carries the Vapi system prompt, plus a step for each thing Vapi's tools did:
//   endCall                -> a goodbye step
//   transferCall           -> a transfer step per destination (phone numbers only)
//   function tool (inline) -> [collect arguments] -> call the webhook -> back to the main step
// Everything else is reported, never silently dropped. The report has three lists: imported, review (carried over but check it),
// and skipped (not carried over, with the reason).

export interface ImportNote { area: string; text: string }

export interface VapiImportOk {
  ok: true;
  name: string;
  startNodeId: string;
  nodes: FlowNode[];
  settings: { language?: string; maxCallDurationSec?: number; endCallAfterSilenceSec?: number };
  /** Plain {{placeholders}} found in the text that the user should define under Variables. */
  variables: string[];
  report: { imported: ImportNote[]; review: ImportNote[]; skipped: ImportNote[] };
}
export type VapiImportResult = VapiImportOk | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const MAX_INPUT_CHARS = 400_000;
const E164 = /^\+[1-9]\d{6,14}$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g;
// Names Vapi fills in itself. Calldesk does not fill the same names, so these need a look.
const VAPI_BUILT_INS = new Set(['now', 'date', 'time', 'month', 'day', 'year']);

function slug(s: string, fallback: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return out || fallback;
}

function parseInput(raw: unknown): { assistant: Obj; tools: Obj[] } | { error: string } {
  let v: unknown = raw;
  if (typeof v === 'string') {
    if (v.length > MAX_INPUT_CHARS) return { error: 'That is too large to be a single assistant (limit 400,000 characters).' };
    try { v = JSON.parse(v); } catch { return { error: 'That is not valid JSON. Paste the assistant object exactly as Vapi returns it.' }; }
  }
  if (!isObj(v)) return { error: 'Expected a JSON object: the assistant from Vapi.' };
  let tools: Obj[] = [];
  let assistant: Obj = v;
  // Accept { assistant: {...}, tools: [...] } as well as the bare assistant.
  if (isObj(v.assistant)) {
    assistant = v.assistant;
    if (Array.isArray(v.tools)) tools = v.tools.filter(isObj);
  }
  if (!isObj(assistant.model) && !('firstMessage' in assistant)) {
    return { error: 'This does not look like a Vapi assistant: it has no "model" and no "firstMessage".' };
  }
  return { assistant, tools };
}

export function vapiAssistantToFlow(raw: unknown): VapiImportResult {
  const parsed = parseInput(raw);
  if ('error' in parsed) return { ok: false, error: parsed.error };
  const { assistant, tools: extraTools } = parsed;

  const imported: ImportNote[] = [];
  const review: ImportNote[] = [];
  const skipped: ImportNote[] = [];
  const model: Obj = isObj(assistant.model) ? assistant.model : {};

  // ---- system prompt ------------------------------------------------------------------------------------------------------------
  const messages = Array.isArray(model.messages) ? model.messages.filter(isObj) : [];
  const systemParts = messages.filter((m) => str(m.role) === 'system').map((m) => str(m.content)).filter(Boolean);
  if (systemParts.length === 0) {
    return { ok: false, error: 'No system prompt found: the assistant has no "system" message in model.messages, so there is nothing to import.' };
  }
  const prompt = systemParts.join('\n\n');
  imported.push({ area: 'Prompt', text: `System prompt (${prompt.length.toLocaleString('en-US')} characters) is the main step's instructions.` });
  const otherMsgs = messages.length - systemParts.length;
  if (otherMsgs > 0) skipped.push({ area: 'Example messages', text: `${otherMsgs} non-system message${otherMsgs === 1 ? '' : 's'} in model.messages (examples or history) were not imported.` });

  // ---- opening line -------------------------------------------------------------------------------------------------------------
  const firstMessage = str(assistant.firstMessage);
  const mode = str(assistant.firstMessageMode);
  let spokenMessage = '';
  if (mode === 'assistant-waits-for-user') {
    review.push({ area: 'Opening', text: 'Vapi waits for the caller to speak first. The fixed greeting is off; the main step\'s instructions decide what the agent says first.' });
  } else if (mode === 'assistant-speaks-first-with-model-generated-message') {
    review.push({ area: 'Opening', text: 'Vapi wrote the opening line with the model. The fixed greeting is off, so the agent writes its own greeting from the instructions.' });
  } else if (/^https?:\/\//i.test(firstMessage)) {
    skipped.push({ area: 'Opening', text: 'The first message is an audio file URL. Calldesk speaks text, so the fixed greeting is off.' });
  } else if (firstMessage) {
    spokenMessage = firstMessage;
    imported.push({ area: 'Opening', text: 'First message became the fixed greeting, spoken word for word when the call connects.' });
  }

  // ---- tools --------------------------------------------------------------------------------------------------------------------
  const inline = Array.isArray(model.tools) ? model.tools.filter(isObj) : [];
  const toolIds: string[] = [
    ...(Array.isArray(model.toolIds) ? model.toolIds.map(str).filter(Boolean) : []),
    ...(Array.isArray(model.toolRefs) ? model.toolRefs.filter(isObj).map((r) => str(r.id)).filter(Boolean) : []),
  ];
  const byId = new Map<string, Obj>();
  for (const t of extraTools) if (str(t.id)) byId.set(str(t.id), t);
  const tools: Obj[] = [...inline];
  const unresolved: string[] = [];
  for (const id of toolIds) {
    const t = byId.get(id);
    if (t) tools.push(t); else unresolved.push(id);
  }
  if (unresolved.length > 0) {
    review.push({
      area: 'Saved tools',
      text: `${unresolved.length} saved tool${unresolved.length === 1 ? '' : 's'} (${unresolved.slice(0, 5).join(', ')}${unresolved.length > 5 ? ', ...' : ''}) could not be read from the assistant alone. Add them to the paste as {"assistant": ..., "tools": [...]} (the output of GET /tool), or re-create them as function steps.`,
    });
  }

  const nodes: FlowNode[] = [];
  const mainEdges: FlowNode['edges'] = [];
  const usedIds = new Set<string>(['main', 'goodbye']);
  const uid = (base: string): string => {
    let id = base; let n = 2;
    while (usedIds.has(id)) id = `${base}_${n++}`;
    usedIds.add(id);
    return id;
  };

  let hasEndCall = false;
  const transferNodes: FlowNode[] = [];
  const functionNodes: FlowNode[] = [];

  for (const t of tools) {
    const type = str(t.type);
    if (type === 'endCall') { hasEndCall = true; continue; }

    if (type === 'transferCall') {
      const dests = Array.isArray(t.destinations) ? t.destinations.filter(isObj) : [];
      if (dests.length === 0) { review.push({ area: 'Transfer', text: 'A transferCall tool has no destinations, so no transfer step was created.' }); continue; }
      const toolDesc = str((t.function as Obj | undefined)?.description) || str(t.description);
      for (const d of dests) {
        const dType = str(d.type);
        const number = str(d.number);
        if (dType && dType !== 'number') {
          skipped.push({ area: 'Transfer', text: `A ${dType} transfer destination was not imported (Calldesk transfers to phone numbers).` });
          continue;
        }
        const id = uid('transfer');
        const plan = isObj(d.transferPlan) ? d.transferPlan : {};
        const planMode = str(plan.mode);
        const warm = /warm/i.test(planMode);
        const params: Record<string, string> = { transferTo: E164.test(number) ? number : '' };
        if (warm) params.transferMode = 'warm';
        if (!E164.test(number)) review.push({ area: 'Transfer', text: `Transfer number "${number || '(empty)'}" is not in +country-code format. Set it on the "${id}" step.` });
        const condition = str(d.description) || toolDesc || 'the caller asks to speak to a person';
        transferNodes.push({ id, type: 'transfer', prompt: str(d.message) || 'Let the caller know you are transferring them now.', params, edges: [] });
        mainEdges.push({ id: `e_to_${id}`, condition, target: id });
        imported.push({ area: 'Transfer', text: `Transfer step "${id}" to ${E164.test(number) ? number : 'a number you still need to set'}${warm ? ' (warm transfer)' : ''}.` });
        if (planMode && !warm) review.push({ area: 'Transfer', text: `Vapi transfer mode "${planMode}" became a cold transfer.` });
      }
      continue;
    }

    if (type === 'function') {
      const fn = isObj(t.function) ? t.function : {};
      const name = slug(str(fn.name), 'tool');
      const server = isObj(t.server) ? t.server : {};
      const url = str(server.url);
      const desc = str(fn.description);
      const paramSchema = isObj(fn.parameters) && isObj((fn.parameters as Obj).properties) ? ((fn.parameters as Obj).properties as Obj) : {};
      const props = Object.keys(paramSchema);
      const requiredList = isObj(fn.parameters) && Array.isArray((fn.parameters as Obj).required) ? ((fn.parameters as Obj).required as unknown[]).map(str) : [];
      // The extraction schema only holds strings, so Vapi's type, enum, description and "required" flag go into the step prompt instead.
      const fieldLine = (k: string): string => {
        const def = isObj(paramSchema[k]) ? (paramSchema[k] as Obj) : {};
        const enumVals = Array.isArray(def.enum) ? def.enum.map(str).filter(Boolean) : [];
        const kind = enumVals.length > 0 ? `one of: ${enumVals.slice(0, 12).join(', ')}` : str(def.type);
        const d = str(def.description).replace(/\s+/g, ' ').slice(0, 160);
        const tags = [kind, requiredList.includes(k) ? 'required' : requiredList.length > 0 ? 'optional' : ''].filter(Boolean).join(', ');
        return `${k}${tags ? ` (${tags})` : ''}${d ? `: ${d}` : ''}`;
      };
      const callId = uid(`${name}_call`);
      const callNode: FlowNode = { id: callId, type: 'function', function: str(fn.name) || name, params: { webhookUrl: url }, edges: [{ id: `e_${callId}_done`, condition: 'always', target: 'main' }] };
      let entry = callId;
      if (props.length > 0) {
        const collectId = uid(`${name}_collect`);
        const extract: Record<string, string> = {};
        for (const p of props) extract[p] = 'string';
        functionNodes.push({
          id: collectId, type: 'extraction',
          prompt: `Ask the caller for what is needed to ${desc ? desc.charAt(0).toLowerCase() + desc.slice(1).replace(/\.$/, '') : `run ${name}`}. Fields:\n${props.map((k) => `- ${fieldLine(k)}`).join('\n')}`,
          extract,
          edges: [{ id: `e_${collectId}_done`, condition: `${props.join(', ')} ${props.length === 1 ? 'has' : 'have all'} been collected`, target: callId }],
        });
        entry = collectId;
      }
      functionNodes.push(callNode);
      mainEdges.push({ id: `e_to_${entry}`, condition: desc || `the caller needs ${name.replace(/_/g, ' ')}`, target: entry });
      imported.push({ area: 'Tools', text: `Function "${str(fn.name) || name}" became ${props.length > 0 ? `a collect step (${props.join(', ')}) and ` : ''}a webhook step "${callId}", then back to the main step.` });
      if (!url) review.push({ area: 'Tools', text: `Function "${str(fn.name) || name}" has no server URL. Set the webhook URL on the "${callId}" step.` });
      if (server.credentialId || (isObj(server.headers) && Object.keys(server.headers as Obj).length > 0) || server.secret) {
        review.push({ area: 'Tools', text: `Function "${str(fn.name) || name}" used authentication (credential or headers). It was not carried over: set it up for the "${callId}" step.` });
      }
      if (props.length > 0) review.push({ area: 'Tools', text: `Function "${str(fn.name) || name}" arguments are stored as text fields. Their types, allowed values and required flags are written into the collect step's prompt, not enforced.` });
      continue;
    }

    if (type === 'dtmf') { review.push({ area: 'Tools', text: 'A keypad (dtmf) tool was not converted. Calldesk has a "press a digit" step: add one where the agent should press keys.' }); continue; }
    skipped.push({ area: 'Tools', text: `A "${type || 'unknown'}" tool was not imported.` });
  }

  // ---- goodbye ------------------------------------------------------------------------------------------------------------------
  const endCallMessage = str(assistant.endCallMessage);
  const endPhrases = Array.isArray(assistant.endCallPhrases) ? assistant.endCallPhrases.map(str).filter(Boolean) : [];
  const wantsGoodbye = hasEndCall || endCallMessage !== '' || endPhrases.length > 0;
  if (wantsGoodbye) {
    mainEdges.push({ id: 'e_to_goodbye', condition: 'the conversation is complete, or the caller wants to end the call', target: 'goodbye' });
    imported.push({ area: 'Ending', text: endCallMessage ? 'End-of-call message became the goodbye step.' : 'The end-call tool became a goodbye step.' });
  }
  if (endPhrases.length > 0) review.push({ area: 'Ending', text: 'Vapi ended the call on phrases (' + endPhrases.slice(0, 4).join(', ') + '). Calldesk ends through the goodbye step instead; check it ends when you expect.' });

  // ---- assemble -----------------------------------------------------------------------------------------------------------------
  nodes.push({
    id: 'main', type: 'greeting', prompt,
    ...(spokenMessage ? { params: { spokenMessage } } : {}),
    edges: mainEdges,
  });
  nodes.push(...functionNodes, ...transferNodes);
  if (wantsGoodbye) {
    nodes.push({
      id: 'goodbye', type: 'goodbye',
      prompt: endCallMessage ? `Say this to the caller, then end the call: "${endCallMessage}"` : 'Thank the caller and say a brief goodbye.',
      edges: [],
    });
  }

  // ---- settings -----------------------------------------------------------------------------------------------------------------
  const settings: VapiImportOk['settings'] = {};
  const transcriber: Obj = isObj(assistant.transcriber) ? assistant.transcriber : {};
  const lang = str(transcriber.language);
  if (lang && lang.toLowerCase() !== 'multi') {
    const code = normalizeLanguage(lang);
    if (code && code !== 'en') { settings.language = code; imported.push({ area: 'Language', text: `Language set to ${code} from the transcriber.` }); }
    else if (!code) review.push({ area: 'Language', text: `Transcriber language "${lang}" is not one Calldesk supports; the agent will use English.` });
  } else if (lang) {
    review.push({ area: 'Language', text: 'Vapi used multilingual transcription. Pick the agent language in settings.' });
  }
  const maxDur = Number(assistant.maxDurationSeconds);
  if (Number.isFinite(maxDur) && maxDur > 0) { settings.maxCallDurationSec = Math.round(maxDur); imported.push({ area: 'Limits', text: `Maximum call length ${Math.round(maxDur)} seconds.` }); }
  const silence = Number(assistant.silenceTimeoutSeconds);
  if (Number.isFinite(silence) && silence > 0) { settings.endCallAfterSilenceSec = Math.round(silence); imported.push({ area: 'Limits', text: `Hang up after ${Math.round(silence)} seconds of silence.` }); }

  const note = (key: string, area: string, text: string) => { if (assistant[key] !== undefined && assistant[key] !== null) skipped.push({ area, text }); };
  if (isObj(assistant.voice)) skipped.push({ area: 'Voice', text: `Vapi voice (${str((assistant.voice as Obj).provider) || 'unknown provider'}${str((assistant.voice as Obj).voiceId) ? ', ' + str((assistant.voice as Obj).voiceId) : ''}) was not carried over. Calldesk picks the voice from the plan you choose; pick the closest one in settings.` });
  if (str(model.provider) || str(model.model)) skipped.push({ area: 'Model', text: `Vapi model (${[str(model.provider), str(model.model)].filter(Boolean).join(' ')}) and its temperature/token limits were not carried over. Calldesk runs the model for the plan you choose (Lite, Standard or Pro).` });
  if (isObj(model.knowledgeBase) || (Array.isArray(model.knowledgeBase) && model.knowledgeBase.length)) skipped.push({ area: 'Knowledge base', text: 'The Vapi knowledge base was not imported. Add the same documents under Knowledge base.' });
  note('server', 'Webhooks', 'The assistant-level server URL (call events) was not imported. Set up webhooks in Calldesk if you rely on end-of-call reports.');
  note('serverMessages', 'Webhooks', 'serverMessages settings were not imported.');
  note('analysisPlan', 'Analysis', 'Vapi\'s post-call analysis (summary, structured data, success evaluation) was not imported. Calldesk produces a summary and extracts fields on its own.');
  note('artifactPlan', 'Recording', 'Recording and transcript settings were not imported.');
  note('hooks', 'Hooks', 'Hooks were not imported.');
  note('backgroundSound', 'Sound', 'Background sound was not imported.');
  note('startSpeakingPlan', 'Turn-taking', 'startSpeakingPlan (when the agent starts talking) was not imported.');
  note('stopSpeakingPlan', 'Turn-taking', 'stopSpeakingPlan (interruption behaviour) was not imported.');
  note('keypadInputPlan', 'Keypad', 'keypadInputPlan was not imported.');
  if (assistant.voicemailDetection || assistant.voicemailMessage) review.push({ area: 'Voicemail', text: 'Voicemail detection and the voicemail message were not imported. Voicemail detection is a per-agent setting in Calldesk.' });

  // ---- placeholders ---------------------------------------------------------------------------------------------------------------
  const found = new Set<string>();
  const scan = (s: string) => { for (const m of s.matchAll(PLACEHOLDER)) found.add(m[1]); };
  scan(prompt); scan(spokenMessage); scan(endCallMessage);
  const builtIn = [...found].filter((v) => v.includes('.') || VAPI_BUILT_INS.has(v));
  const variables = [...found].filter((v) => !v.includes('.') && !VAPI_BUILT_INS.has(v)).sort();
  if (variables.length > 0) review.push({ area: 'Variables', text: `Define these under Variables, or the placeholders stay as written: ${variables.map((v) => `{{${v}}}`).join(', ')}.` });
  if (builtIn.length > 0) review.push({ area: 'Variables', text: `${builtIn.map((v) => `{{${v}}}`).join(', ')} ${builtIn.length === 1 ? 'is' : 'are'} filled in by Vapi itself. Calldesk does not fill the same names, so reword those parts of the prompt.` });

  return { ok: true, name: str(assistant.name).slice(0, 60), startNodeId: 'main', nodes, settings, variables, report: { imported, review, skipped } };
}
