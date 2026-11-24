import { workflow, node, trigger, ifElse, expr, newCredential } from '@n8n/workflow-sdk';

// SF Utility Chat → Agent
// Bridge between the Salesforce utility-bar LWC (via Apex + Named Credential n8n_Agent)
// and the n8n Agent "UK Car Assistant". Mirrors the live workflow, node positions included.
//
// Everything the panel shows is in the reply text, so the Salesforce side needs no changes:
// - On the first message of a conversation (tracked in workflow static data, no Data Table) the
//   workflow looks up the chatting user's own User record with a Salesforce JWT credential
//   (integration user), gives it to the Agent and writes it above the reply.
// - An optional debug block (execution, timing, session, lookup, record, tools, tokens) is added
//   below the reply. Toggles: the "Chat settings" node (debug, showUserInfo); publish to apply.

// Set these values for your environment before creating the workflow:
// - ALLOWED_ORG_ID: your Salesforce org ID (Setup > Company Information), the only org allowed to call this webhook.
// - AGENT_ID: the ID of your n8n Agent (from its URL: /projects/<projectId>/agents/<AGENT_ID>).
// - SALESFORCE_JWT_CREDENTIAL: name of your n8n "Salesforce JWT API" credential (integration user).
const ALLOWED_ORG_ID = '00D000000000000AAA';
const AGENT_ID = 'YOUR_N8N_AGENT_ID';
const SALESFORCE_JWT_CREDENTIAL = 'Salesforce JWT';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.2,
  config: {
    name: 'Salesforce chat request',
    position: [0, 208],
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
          id: '003000000000000AAA',
          objectApiName: 'Contact',
          fields: { Name: 'Jane Morgan', Title: 'Operations Manager', Email: 'jane@example.com', 'Account.Name': 'Morgan Logistics' },
        },
      },
    },
  ],
});

// ------------------------------------------------------------------ Validate request

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

  // newConversation: optional boolean (true on the first message: triggers the user lookup)
  if (body.newConversation !== undefined && typeof body.newConversation !== 'boolean') errors.push('newConversation must be a boolean');

  // user: id (a User id, 005 prefix; also keeps the SOQL lookup safe) + name required, profile optional
  const user = body.user || {};
  if (typeof user.id !== 'string' || !/^005[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/.test(user.id)) errors.push('user.id must be a Salesforce user id');
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
    position: [224, 208],
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
    position: [448, 208],
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
    position: [672, 336],
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ { "error": $json.check.error, "message": $json.check.message } }}'),
      options: { responseCode: expr('{{ $json.check.status }}'), enableStreaming: false },
    },
  },
});

// ------------------------------------------------------------------ Settings & first message

const chatSettings = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Chat settings',
    position: [672, 80],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'debug', name: 'debug', type: 'boolean', value: true },
          { id: 'showUserInfo', name: 'showUserInfo', type: 'boolean', value: true },
          { id: 'startedAt', name: 'startedAt', type: 'number', value: expr('{{ $now.toMillis() }}') },
        ],
      },
      options: {},
    },
    notes: "TOGGLES. debug: append a debug block (execution, timing, session, user lookup, record, tools, tokens) to every reply. showUserInfo: show the chatting user's Salesforce details above the first reply. Change, then publish the workflow.",
  },
  output: [{ debug: true, showUserInfo: true, startedAt: 1795479789444 }],
});

const checkFirstMessage = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Check first message',
    position: [896, 80],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Is this the first message of the conversation? Tracked in workflow static data (no Data Table).
// Static data is saved only for production (webhook) executions, never for manual test runs.
const body = $('Salesforce chat request').first().json.body;
const key = 'sf-' + body.user.id + '-' + body.sessionId;

const store = $getWorkflowStaticData('global');
store.seenConversations = store.seenConversations || {};
const seen = store.seenConversations;

const now = Date.now();
const isFirst = !seen[key];
seen[key] = now; // last activity

// Forget conversations idle for 7 days, and keep at most 2,000 entries (oldest dropped first)
const IDLE_MS = 7 * 24 * 60 * 60 * 1000;
for (const [k, t] of Object.entries(seen)) {
  if (now - t > IDLE_MS) delete seen[k];
}
const keys = Object.keys(seen);
if (keys.length > 2000) {
  keys.sort((a, b) => seen[a] - seen[b])
    .slice(0, keys.length - 2000)
    .forEach((k) => delete seen[k]);
}

return [{ json: { isFirst, trackedConversations: Object.keys(seen).length } }];`,
    },
    notes: "Keyed by sf-<userId>-<sessionId>, like the Agent session. Conversations started before this change count as new once. Static data needs a Code node: expressions can't read it.",
  },
  output: [{ isFirst: true, trackedConversations: 1 }],
});

const isFirstMessage = ifElse({
  version: 2.2,
  config: {
    name: 'First message?',
    position: [1120, 80],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: 'is-first',
            leftValue: expr("{{ $('Check first message').item.json.isFirst }}"),
            operator: { type: 'boolean', operation: 'true', singleValue: true },
            rightValue: '',
          },
        ],
        combinator: 'and',
      },
    },
    notes: 'True on the first message of a conversation (from Check first message): look up the chatting user.',
  },
});

// ------------------------------------------------------------------ Who's chatting

// Runs as the integration user. Only the requesting user's own record: user.id comes from Apex
// UserInfo and is validated as a 005 id above. Role/Profile aren't readable by an API-only
// integration user; the profile name comes from Apex. A failure gives an empty profile.
const lookupUser = node({
  type: 'n8n-nodes-base.salesforce',
  version: 1.1,
  config: {
    name: 'Look up chatting user',
    position: [1344, -48],
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
    executeOnce: true,
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      authentication: 'jwt',
      resource: 'search',
      operation: 'query',
      query: expr("SELECT Id, Name, Title, Department, CompanyName, Email, Phone, City, Country, Manager.Name FROM User WHERE Id = '{{ $('Salesforce chat request').item.json.body.user.id }}' LIMIT 1"),
    },
    credentials: { salesforceJwtApi: newCredential(SALESFORCE_JWT_CREDENTIAL) },
    notes: 'Runs as the n8n integration user (JWT). Only the requesting user\'s own record: user.id comes from Apex UserInfo and is validated as a 005 id. Role/Profile aren\'t readable by the integration user; the profile name comes from Apex. A failure gives an empty profile, never a failed chat.',
  },
  output: [{ Id: '005000000000000AAA', Name: 'Test Rep', Title: 'Sales Manager', Email: 'test.rep@example.com', Manager: { Name: 'Sam Lead' } }],
});

const shapeProfile = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Shape user profile',
    position: [1568, -48],
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'userInfo',
            name: 'userInfo',
            type: 'object',
            value: expr(`{{ (() => {
  const u = $('Look up chatting user').first().json || {};
  const body = $('Salesforce chat request').item.json.body;
  // Only the requesting user's own record; no row or a lookup error gives an empty profile
  if (!u.Id || u.Id.slice(0, 15) !== body.user.id.slice(0, 15)) return {};
  const info = {
    name: u.Name,
    title: u.Title,
    department: u.Department,
    company: u.CompanyName,
    email: u.Email,
    phone: u.Phone,
    location: [u.City, u.Country].filter(Boolean).join(', '),
    manager: u.Manager ? u.Manager.Name : null,
    profile: body.user.profile,
  };
  // Keep non-empty strings only
  return Object.fromEntries(Object.entries(info).filter(([, v]) => typeof v === 'string' && v.trim() !== ''));
})() }}`),
          },
        ],
      },
      options: {},
    },
    notes: "Used twice: in the Agent's [context] and in the reply text (user info block).",
  },
  output: [{ userInfo: { name: 'Test Rep', title: 'Sales Manager', email: 'test.rep@example.com', manager: 'Sam Lead', profile: 'System Administrator' } }],
});

// ------------------------------------------------------------------ Ask the Agent

// The Agent gets a [context] block before the rep's message.
const promptExpr = expr(`{{ (() => {
  const b = $('Salesforce chat request').item.json.body;
  // Page record part: object + id + fields, or an explicit "no record open"
  const rec = b.record && b.record.id
    ? b.record.objectApiName + ' ' + b.record.id + ' | fields: ' + JSON.stringify(b.record.fields || {})
    : 'no record open';
  // Chatting user's profile: only on the first message (looked up in Salesforce); the Agent remembers it for the session
  const profile = $('Shape user profile').isExecuted ? $('Shape user profile').first().json.userInfo : null;
  const who = profile && Object.keys(profile).length ? ' | user profile: ' + JSON.stringify(profile) : '';
  return '[context] user: ' + b.user.name + ' (' + b.user.id + ')' + who + ' | page record: ' + rec + '\\n' + b.message.trim();
})() }}`);

const askAgent = node({
  type: 'n8n-nodes-base.messageAnAgent',
  version: 3.1,
  config: {
    name: 'Ask UK Car Assistant',
    position: [1792, 80],
    onError: 'continueErrorOutput',
    parameters: {
      agentId: { __rl: true, mode: 'id', value: AGENT_ID },
      message: promptExpr,
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
  output: [{
    text: 'Your 2016 diesel is likely ULEZ compliant if it meets Euro 6.',
    usage: { promptTokens: 5044, completionTokens: 36, totalTokens: 5080 },
    toolCalls: [{ toolName: 'autoza_check_clean_air_zone' }],
    finishReason: 'stop',
    session: { sessionId: 'sf-005000000000000AAA-3f1c2a9e-8d7b-4c1e-9a55-0b2f6d4e7a10' },
  }],
});

// Reply text = user info (first message, if enabled) + the Agent's answer + debug block (if enabled).
const replyExpr = expr(`{{ (() => {
  const settings = $('Chat settings').first().json;
  const body = $('Salesforce chat request').item.json.body;
  const agent = $('Ask UK Car Assistant').item.json;
  const first = $('Check first message').first().json.isFirst;
  const profile = ($('Shape user profile').isExecuted ? $('Shape user profile').first().json.userInfo : null) || {};
  const parts = [];

  // 1. Who's chatting: first message only, from the Salesforce JWT lookup
  if (settings.showUserInfo && first && profile.name) {
    const line2 = [profile.title, profile.department, profile.company].filter(Boolean).join(' · ');
    const line3 = [profile.email, profile.phone, profile.location].filter(Boolean).join(' · ');
    const line4 = [
      profile.manager ? 'Manager: ' + profile.manager : null,
      profile.profile ? 'Profile: ' + profile.profile : null,
    ].filter(Boolean).join(' · ');
    parts.push(['👤 ' + profile.name, line2, line3, line4].filter(Boolean).join('\\n'));
  }

  // 2. The Agent's answer
  parts.push(agent.text);

  // 3. Debug block (toggle: Chat settings > debug)
  if (settings.debug) {
    const lookup = $('Look up chatting user').isExecuted ? $('Look up chatting user').first().json : null;
    const lookupStatus = !first ? 'skipped (not the first message)'
      : !lookup ? 'not run'
      : lookup.error ? 'failed: ' + String(lookup.error.message || lookup.error).slice(0, 120)
      : lookup.Id ? 'ok, ' + Object.keys(profile).length + ' fields'
      : 'no row';
    const tools = [...new Set((agent.toolCalls || []).map((t) => t.toolName))];
    const usage = agent.usage || {};
    const rec = body.record && body.record.id
      ? body.record.objectApiName + ' ' + body.record.id + ' (' + Object.keys(body.record.fields || {}).length + ' fields)'
      : 'none';
    parts.push([
      '─── debug ───',
      'execution ' + $execution.id + ' · ' + (($now.toMillis() - settings.startedAt) / 1000).toFixed(1) + ' s',
      'session ' + (agent.session ? agent.session.sessionId : '?'),
      'first message: ' + (first ? 'yes' : 'no') + ' · user lookup (Salesforce JWT): ' + lookupStatus,
      'record context: ' + rec,
      'tools: ' + (tools.length ? tools.join(', ') : 'none'),
      'tokens: ' + (usage.promptTokens || 0) + ' in / ' + (usage.completionTokens || 0) + ' out · finish: ' + (agent.finishReason || '?'),
    ].join('\\n'));
  }

  // userInfo stays null: everything is in the reply text, so the panel needs no changes
  return { reply: parts.join('\\n\\n'), sessionId: body.sessionId, userInfo: null };
})() }}`);

const respondReply = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Return reply',
    position: [2016, 0],
    parameters: {
      respondWith: 'json',
      responseBody: replyExpr,
      options: { responseCode: 200, enableStreaming: false },
    },
  },
});

const respondAgentError = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Agent failed (502)',
    position: [2016, 192],
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ { "error": "upstream_error", "message": "The assistant could not answer right now. Please try again." } }}'),
      options: { responseCode: 502, enableStreaming: false },
    },
  },
});

export default workflow('sf-utility-chat', 'SF Utility Chat → Agent')
  .add(webhook)
  .to(validate)
  .to(
    isValid
      .onTrue(
        chatSettings.to(
          checkFirstMessage.to(
            isFirstMessage
              .onTrue(lookupUser.to(shapeProfile.to(askAgent)))
              .onFalse(askAgent),
          ),
        ),
      )
      .onFalse(respondRejected),
  )
  .add(askAgent.output(0).to(respondReply))
  .add(askAgent.output(1).to(respondAgentError))
  .group('Validate request', [validate, isValid], {
    description: 'Org allow-list (403) and body shape (400) after Header Auth.',
  })
  .group('Settings & first message', [chatSettings, checkFirstMessage], {
    description: 'Toggles (debug, showUserInfo) + first-message check in workflow static data.',
  })
  .group("Who's chatting", [lookupUser, shapeProfile], {
    description: "First message only: the user's own User record via Salesforce JWT.",
  })
  .group('Ask the Agent', [askAgent, respondReply, respondAgentError], {
    description: '[context] + message; reply text = user info (first msg) + answer + debug block; 502 on failure.',
  });
