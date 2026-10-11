import { createLlmUsage } from './llmUsage';

// One shared Claude-spend accounting client for the whole app. Records tokens and
// dollars (never prompts or answers) per model and feature label and reports them
// to the central app-failure-reporter Worker. The key comes from LLM_USAGE_KEY (else
// FAILURE_REPORTER_KEY); with neither set the client is disabled and does nothing.
// Rows are batched in memory and sent every 30 s on an unref'd timer, so this never
// holds a request or the process open.
export const llmUsage = createLlmUsage({
  app: 'calldesk',
  log: (m) => console.warn(`[llm-usage] ${m}`),
});
