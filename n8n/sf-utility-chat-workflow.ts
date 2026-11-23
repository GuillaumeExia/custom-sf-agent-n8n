import { workflow, node, trigger, sticky, ifElse, expr, newCredential } from '@n8n/workflow-sdk';

// SF Utility Chat → Agent
// Bridge between the Salesforce utility-bar LWC (via Apex + Named Credential n8n_Agent)
// and the n8n Agent "UK Car Assistant".

// Set these two values for your environment before creating the workflow:
// - ALLOWED_ORG_ID: your Salesforce org ID (Setup > Company Information), the only org allowed to call this webhook.
// - AGENT_ID: the ID of your n8n Agent (from its URL: /projects/<projectId>/agents/<AGENT_ID>).
const ALLOWED_ORG_ID = '00D000000000000AAA';
const AGENT_ID = 'YOUR_N8N_AGENT_ID';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.2,
  config: {
    name: 'Salesforce chat request',
    parameters: {
      httpMethod: 'POST',
      path: 'sf-utility-chat',
      authentication: 'headerAuth',
      responseMode: 'responseNode',
      options: {},
    },
    credentials: { httpHeaderAuth: newCredential('SF Utility Chat Webhook') },
    notes: 'Header Auth: X-SF-Signature. The secret lives only in this credential and in the Salesforce External Credential n8n_Agent.',
  },
  output: [
    {
      body: {
        message: 'Is this person\'s 2016 diesel ULEZ compliant?',
        sessionId: '3f1c2a9e-8d7b-4c1e-9a55-0b2f6d4e7a10',
        user: { id: '005000000000000AAA', name: 'Test Rep', profile: 'System Administrator' },
        orgId: ALLOWED_ORG_ID,
        record: {
          id: '003gL000000AbCdQAK',
          objectApiName: 'Contact',
          fields: { Name: 'Jane Morgan', Title: 'Operations Manager', Email: 'jane@example.com', 'Account.Name': 'Morgan Logistics' },
        },
      },
    },
  ],
});

// One IIFE validates the whole request and decides the status code.
// 403 when the org doesn't match, 400 for any shape problem, 200 when valid.
const validatorExpr = expr(`{{ (() => {
  const body = $('Salesforce chat request').item.json.body || {};
  const errors = [];

  // Org allow-list first: a request from another org is forbidden, whatever its shape
  if (body.orgId !== '${ALLOWED_ORG_ID}') {
    return { valid: false, status: 403, error: 'forbidden', message: 'This Salesforce org is not allowed to use the assistant.' };
  }

  // message: required string, 1..4000 chars after trim
  if (typeof body.message !== 'string' || body.message.trim().length === 0) errors.push('message is required');
  else if (body.message.trim().length > 4000) errors.push('message must be 4000 characters or fewer');

  // sessionId: required, UUID-like (letters, digits, dashes), max 40 chars (Agent session keys max 74)
  if (typeof body.sessionId !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(body.sessionId)) errors.push('sessionId is required (letters, digits, dashes, max 40)');

  // user: id + name required, profile optional
  const user = body.user || {};
  if (typeof user.id !== 'string' || !/^[A-Za-z0-9]{15,18}$/.test(user.id)) errors.push('user.id must be a Salesforce user id');
  if (typeof user.name !== 'string' || user.name.trim().length === 0) errors.push('user.name is required');

  // record: optional; when present needs id + objectApiName, fields must be an object
  if (body.record !== undefined && body.record !== null) {
    const r = body.record;
    if (typeof r.id !== 'string' || !/^[A-Za-z0-9]{15,18}$/.test(r.id)) errors.push('record.id must be a Salesforce record id');
    if (typeof r.objectApiName !== 'string' || r.objectApiName.length === 0) errors.push('record.objectApiName is required');
    if (r.fields !== undefined && (typeof r.fields !== 'object' || Array.isArray(r.fields))) errors.push('record.fields must be an object');
  }

  if (errors.length === 0) return { valid: true, status: 200, error: null, message: null };
  return { valid: false, status: 400, error: 'validation_error', message: errors.join('; ') };
})() }}`);

const validate = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Validate request',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'check', name: 'check', value: validatorExpr, type: 'object' }],
      },
      options: {},
    },
  },
  output: [{ check: { valid: true, status: 200, error: null, message: null } }],
});

const isValid = ifElse({
  version: 2.2,
  config: {
    name: 'Request valid?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: 'is-valid',
            leftValue: expr('{{ $json.check.valid }}'),
            operator: { type: 'boolean', operation: 'true', singleValue: true },
            rightValue: '',
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const respondRejected = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Reject request (400/403)',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ { "error": $json.check.error, "message": $json.check.message } }}'),
      options: { responseCode: expr('{{ $json.check.status }}'), enableStreaming: false },
    },
  },
});

// The Agent gets a [context] block before the rep's message.
const promptExpr = expr(`{{ (() => {
  const b = $('Salesforce chat request').item.json.body;
  // Page record part: object + id + fields, or an explicit "no record open"
  const rec = b.record && b.record.id
    ? b.record.objectApiName + ' ' + b.record.id + ' | fields: ' + JSON.stringify(b.record.fields || {})
    : 'no record open';
  return '[context] user: ' + b.user.name + ' (' + b.user.id + ') | page record: ' + rec + '\\n' + b.message.trim();
})() }}`);

const askAgent = node({
  type: 'n8n-nodes-base.messageAnAgent',
  version: 3.1,
  config: {
    name: 'Ask UK Car Assistant',
    onError: 'continueErrorOutput',
    parameters: {
      agentId: { __rl: true, mode: 'id', value: AGENT_ID },
      message: promptExpr,
      useStructuredOutput: false,
      advanced: {
        enableStreaming: false,
        invokeMode: 'allItems',
        session: {
          session: {
            sessionIdType: 'customKey',
            // One Agent session per Salesforce user + LWC conversation (max 74 chars: 3+18+1+36)
            sessionKey: expr("{{ 'sf-' + $('Salesforce chat request').item.json.body.user.id + '-' + $('Salesforce chat request').item.json.body.sessionId }}"),
          },
        },
        allowOtherNodesData: false,
      },
    },
    notes: 'Production executions run the PUBLISHED Agent version; manual runs use the draft.',
  },
  output: [{ text: 'Your 2016 diesel is likely ULEZ compliant if it meets Euro 6.', toolCalls: [], finishReason: 'stop', session: { sessionId: 'sf-x' } }],
});

const respondReply = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Return reply',
    parameters: {
      respondWith: 'json',
      responseBody: expr("{{ { \"reply\": $json.text, \"sessionId\": $('Salesforce chat request').item.json.body.sessionId } }}"),
      options: { responseCode: 200, enableStreaming: false },
    },
  },
});

const respondAgentError = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Agent failed (502)',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ { "error": "upstream_error", "message": "The assistant could not answer right now. Please try again." } }}'),
      options: { responseCode: 502, enableStreaming: false },
    },
  },
});

const validateZone = sticky('### Validate\nHeader Auth, org allow-list (403), body shape (400).', [webhook, validate, isValid, respondRejected], { color: 5, height: 464 });
const agentZone = sticky('### Ask the Agent\n[context] block + message, session sf-<userId>-<sessionId>; 502 on failure.', [askAgent, respondReply, respondAgentError], { color: 6, height: 496 });

export default workflow('sf-utility-chat', 'SF Utility Chat → Agent')
  .add(webhook)
  .to(validate)
  .to(
    isValid
      .onTrue(askAgent)
      .onFalse(respondRejected),
  )
  .add(askAgent.output(0).to(respondReply))
  .add(askAgent.output(1).to(respondAgentError))
  .add(validateZone)
  .add(agentZone);
