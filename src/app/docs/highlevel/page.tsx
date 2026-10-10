import { SiteHeader } from '@/components/landing/SiteHeader';
import { SiteFooter } from '@/components/landing/Closing';
import { Container, Eyebrow } from '@/components/landing/primitives';
import { CALLDESK_BASE, FLAT_EXAMPLE, WORKFLOW_A, WORKFLOW_B, toYaml } from '@/lib/highlevelRecipe';

export const metadata = {
  title: 'Use Calldesk with HighLevel',
  description: 'Place Calldesk AI voice calls from HighLevel workflows and send call results back, using HighLevel Custom Webhook and Inbound Webhook.',
};

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {label && <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-[12px] font-medium text-gray-500">{label}</div>}
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-[1.6] text-[#1a1d29]"><code>{children}</code></pre>
    </div>
  );
}
const H2 = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h2 id={id} className="mt-14 scroll-mt-[96px] text-[24px] font-semibold tracking-[-0.02em]">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => <p className="mt-3 max-w-[680px] text-[15px] leading-[1.6] text-gray-600">{children}</p>;
const UL = ({ children }: { children: React.ReactNode }) => <ul className="mt-3 max-w-[680px] list-disc space-y-1.5 pl-5 text-[15px] leading-[1.6] text-gray-600">{children}</ul>;
const OL = ({ children }: { children: React.ReactNode }) => <ol className="mt-3 max-w-[680px] list-decimal space-y-1.5 pl-5 text-[15px] leading-[1.6] text-gray-600">{children}</ol>;
const C = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[13px] text-[#1a1d29]">{children}</code>;

const callBody = JSON.stringify(WORKFLOW_A.actions[0].body, null, 2);

export default function HighLevelDocsPage() {
  return (
    <div className="min-h-screen bg-white text-[#00122e]">
      <SiteHeader />
      <main className="pb-24 pt-[120px] md:pt-[136px]">
        <Container>
          <div className="max-w-[720px]">
            <Eyebrow>Integrations</Eyebrow>
            <h1 className="mt-6 text-[36px] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[48px]">Use Calldesk with HighLevel</h1>
            <P>
              Two HighLevel workflows connect the platforms: one that places a Calldesk AI call for a contact, and one that receives the result and
              updates the contact. It uses only HighLevel&apos;s built-in Custom Webhook action and Inbound Webhook trigger. There is nothing to install,
              and no marketplace app is involved. See also the <a className="underline" href="/docs">API reference</a>.
            </P>
            <P>Not an official HighLevel product; HighLevel is a trademark of its owner. Both HighLevel features used here are LC Premium workflow items, so execution costs apply on your HighLevel side (see Costs).</P>
          </div>

          <div className="mt-10 max-w-[760px]">
            <nav aria-label="On this page" className="text-[14px] text-gray-600">
              <ul className="flex flex-wrap gap-x-5 gap-y-1">
                {[['prerequisites', 'Prerequisites'], ['workflow-a', 'Workflow A: place a call'], ['workflow-b', 'Workflow B: call completed'], ['payload', 'Flat payload'], ['config', 'Machine-readable config'], ['errors', 'Errors and limits'], ['security', 'Security and costs'], ['troubleshooting', 'Troubleshooting'], ['snapshot', 'Building a snapshot']].map(([id, l]) => (
                  <li key={id}><a className="underline" href={`#${id}`}>{l}</a></li>
                ))}
              </ul>
            </nav>

            <H2 id="prerequisites">Prerequisites</H2>
            <UL>
              <li>A Calldesk workspace with a published agent and a phone number whose <b>outbound agent</b> is set (Numbers, then the number, then Outbound Call Agent).</li>
              <li>A Calldesk API key: Settings, API Keys, create a key. Keys start with <C>cdk_live_</C> and are pinned to one workspace. Copy it when it is shown.</li>
              <li>The id of the phone number to call from. Call <C>GET {CALLDESK_BASE}/me</C> to get your workspace id, then <C>GET {CALLDESK_BASE}/tenants/&lt;workspace id&gt;/phone-numbers</C> and use the <C>id</C> of the number (not the number itself).</li>
              <li>A HighLevel sub-account with workflows, and LC Premium triggers and actions enabled for it (HighLevel agency settings).</li>
              <li>To use Calldesk variables in the agent, put <C>{'{{first_name}}'}</C>-style placeholders in the agent prompt or spoken lines.</li>
            </UL>

            <H2 id="workflow-a">Workflow A: place a Calldesk call</H2>
            <P>Use any HighLevel trigger that has a contact with a phone number (for example Contact Tagged, Form Submitted, Appointment Status). Then add one action:</P>
            <OL>
              <li>Add the action <b>Custom Webhook</b>.</li>
              <li>Method: <C>POST</C>. URL: <C>{CALLDESK_BASE}/phone-numbers/&lt;YOUR_CALLDESK_PHONE_NUMBER_ID&gt;/call</C>.</li>
              <li>Under headers, add <C>Authorization</C> = <C>Bearer &lt;YOUR_CALLDESK_API_KEY&gt;</C> and <C>Content-Type</C> = <C>application/json</C>.</li>
              <li>Choose the CUSTOM event option so the action sends a raw JSON body, and paste the body below. The <C>{'{{contact.*}}'}</C> merge fields are filled in by HighLevel when the workflow runs.</li>
              <li>Save and publish the workflow, then test it with a contact that has your own mobile number.</li>
            </OL>
            <div className="mt-4 max-w-[680px]"><Code label="Request body">{callBody}</Code></div>
            <P>
              <C>toNumber</C> must be E.164 (<C>+14155550123</C>); make sure the contact&apos;s phone is stored that way. <C>variables</C> is optional: each key becomes a
              placeholder for this call only (letters, digits and underscores in the name; string values up to 500 characters; up to 25 keys). Empty values are ignored,
              so a contact with no last name does not break the call. A successful request returns <C>201</C> with <C>{'{ "call": { "sid": "...", "to": "..." } }'}</C>;
              the call is then dialled by Calldesk.
            </P>

            <H2 id="workflow-b">Workflow B: call completed</H2>
            <OL>
              <li>In HighLevel create a new workflow with the trigger <b>Inbound Webhook</b>. Copy the webhook URL it shows. It accepts a JSON POST.</li>
              <li>In Calldesk open Integrations, Webhooks, Add endpoint. Paste the HighLevel URL, tick <b>Call completed</b>, tick <b>Flat payload</b>, and add it. (Registering webhooks needs a signed-in owner or admin; API keys cannot create webhooks. The API field is <C>format: &quot;flat&quot;</C>.)</li>
              <li>Use the endpoint&apos;s Test button, or place one real call, so HighLevel receives sample data. In the trigger click Test Trigger, select the received request as sample data and save.</li>
              <li>Add the action <b>Create/Update Contact</b> and map <C>phone</C> to Phone, <C>email</C> to Email, <C>name</C> to name. HighLevel needs an email or phone in the payload to create or match a contact; <C>phone</C> is always present on call events.</li>
              <li>Add <b>Add Note</b> (or Send Internal Notification) using the received <C>summary</C>, <C>outcome</C>, <C>duration_seconds</C> and <C>transcript_url</C> from the value picker.</li>
              <li>Add an <b>If/Else</b> on <C>outcome</C> (values such as answered, voicemail, transferred, no_answer) and <b>Add Tag</b> per branch; custom variables arrive as <C>var_&lt;name&gt;</C> and can feed custom fields.</li>
            </OL>
            <P>
              Calldesk signs every delivery (<C>X-CallDesk-Signature</C>), but HighLevel does not verify signatures. The secret Inbound Webhook URL is the only protection, so treat it like a password.
              If it leaks, delete the trigger in HighLevel, create a new one and update the Calldesk endpoint.
            </P>

            <H2 id="payload">The flat payload</H2>
            <P>With <C>format: &quot;flat&quot;</C> a delivery is one single-level JSON object. Keys are fixed snake_case with no spaces. <C>name</C> and <C>email</C> are present only when known (from call variables or extracted call data), so HighLevel never sees empty identity fields. <C>transcript_url</C> opens the call in your Calldesk dashboard and requires signing in to your workspace; transcripts are never sent in the payload and the link is not public. It may be empty for a call whose log row is not known yet.</P>
            <div className="mt-4 max-w-[680px]"><Code label="call.completed, flat">{JSON.stringify(FLAT_EXAMPLE, null, 2)}</Code></div>
            <P><C>phone</C> is always the other party: the person called on outbound calls, the caller on inbound calls. Without the flat option the payload keeps its nested <C>{'{ event, created_at, data }'}</C> shape.</P>

            <H2 id="config">Machine-readable configuration</H2>
            <P>The same two workflows as data, for scripting or for building a HighLevel snapshot. Placeholders in angle brackets must be replaced; never commit real keys.</P>
            <div className="mt-4 max-w-[680px] space-y-4">
              <Code label="Workflow A (JSON)">{JSON.stringify(WORKFLOW_A, null, 2)}</Code>
              <Code label="Workflow B (JSON)">{JSON.stringify(WORKFLOW_B, null, 2)}</Code>
              <Code label="Workflow A (YAML)">{toYaml(WORKFLOW_A)}</Code>
              <Code label="Workflow B (YAML)">{toYaml(WORKFLOW_B)}</Code>
            </div>

            <H2 id="errors">Errors and limits</H2>
            <UL>
              <li><C>400</C> bad <C>toNumber</C> or invalid <C>variables</C> (the message names the field). Nothing is dialled.</li>
              <li><C>401</C> missing, revoked or wrong API key. <C>404</C> unknown phone number id or a number in another workspace. <C>403</C> your workspace is not allowed to place calls (for example a pilot limit).</li>
              <li><C>429</C> too many calls too fast. Calls are paced per workspace (currently a short burst, then about one call every two seconds). In HighLevel, add a Wait step before the webhook, or use the action&apos;s retry behaviour, when many contacts enter at once. For large lists use Calldesk batch calls instead.</li>
              <li><C>502</C> the voice provider rejected the call; the error text carries the reason, for example an invalid or unreachable destination number.</li>
              <li>Webhook deliveries to HighLevel time out after 8 seconds and are not retried. A failed delivery is only logged on the Calldesk side; use the Test button to check the endpoint.</li>
              <li>Outbound calls cost money and respect your plan, calling hours rules and local regulations. You are responsible for consent to contact each person.</li>
            </UL>

            <H2 id="security">Security and costs</H2>
            <UL>
              <li>Never paste a real <C>cdk_live_</C> key into a HighLevel snapshot or any template you share: headers are copied with a snapshot. Put the key in each sub-account after import, and use a dedicated key per client so you can revoke it (Settings, API Keys).</li>
              <li>An API key can place calls and read your workspace data. Keep it out of screenshots, forum posts and shared workflows.</li>
              <li>The Inbound Webhook URL is a secret (see above). Rotate it if shared.</li>
              <li>Custom Webhook and Inbound Webhook are LC Premium items in HighLevel. HighLevel states new sub-accounts get 100 free executions once premium items are enabled, then executions are billed by HighLevel to the account or, with rebilling on, the sub-account. Check HighLevel&apos;s current price. Calldesk bills calls separately, per your plan.</li>
            </UL>

            <H2 id="troubleshooting">Troubleshooting</H2>
            <UL>
              <li><b>Nothing happens in Workflow A.</b> Open the contact&apos;s workflow history in HighLevel and the Custom Webhook step&apos;s response. A <C>401</C> means the Authorization header is wrong (it must be <C>Bearer </C> followed by the key).</li>
              <li><b>400 about toNumber.</b> The contact&apos;s phone is empty or not in E.164. Add a country code, or use a formatter step first.</li>
              <li><b>The agent says &quot;{'{{first_name}}'}&quot; or ignores the name.</b> The placeholder name in the agent must match the <C>variables</C> key exactly, and the merge field must not be empty.</li>
              <li><b>Workflow B never triggers.</b> The Calldesk endpoint must be subscribed to <C>call.completed</C>; the workflow must be published; the call must have ended. Use the Test button in Calldesk. Calls on some engines may need extra time for analysis before <C>summary</C> is filled.</li>
              <li><b>Payload looks nested.</b> The endpoint was created without Flat payload. Delete it and add it again with Flat payload ticked, or PATCH its <C>format</C> to <C>flat</C> using a signed-in session.</li>
              <li><b>No contact created.</b> HighLevel needs an email or phone in the received data. Re-select the mapping reference after the payload shape changed (HighLevel asks you to re-pick it).</li>
              <li><b>Test succeeds but real calls are missing.</b> The flat payload for calls placed on the CallDesk voice engine requires the matching engine release; if <C>phone</C> or <C>transcript_url</C> is empty, contact support.</li>
            </UL>

            <H2 id="snapshot">Building a HighLevel snapshot</H2>
            <P>A snapshot must be created inside a HighLevel agency account; this page cannot supply one. To build one: create the two workflows above in a template sub-account, leave the Authorization header as the literal text <C>Bearer &lt;YOUR_CALLDESK_API_KEY&gt;</C> and the number id as <C>&lt;YOUR_CALLDESK_PHONE_NUMBER_ID&gt;</C>, replace the Inbound Webhook URL step with a note (the URL is created per sub-account), then in Agency settings choose Snapshots, Create new, select the workflows and share the link. After importing, each client replaces the two placeholders and registers their own Inbound Webhook URL in Calldesk.</P>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}
