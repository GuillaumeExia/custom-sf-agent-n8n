# Agent utility-bar chat: Salesforce → n8n Agent

An Agentforce-style side panel in the Lightning Experience **utility bar**. Internal users chat with the n8n Agent
**"UK Car Assistant"**. The panel is on every page, keeps the conversation as you navigate, and knows which record is on screen.

```
LWC n8nAgentChat (utility bar)
  └─ Apex N8nAgentChatController.sendMessage   (identity from UserInfo, record fields WITH USER_MODE)
       └─ Named Credential n8n_Agent            (adds X-SF-Signature from External Credential n8n_Agent)
            └─ n8n workflow "SF Utility Chat → Agent"   POST /webhook/sf-utility-chat
                 ├─ validate (400) · org check (403)
                 └─ Message an Agent → "UK Car Assistant"  (session sf-<userId>-<sessionId>)
                      └─ Autoza public MCP (read-only tools) + FAQ skill
                 ← { reply, sessionId }   ·   502 if the Agent fails
```

## Repository layout

| Path | What |
|---|---|
| `knowledge/uk-used-car-faq.md` | Agent knowledge (also uploaded as the Agent skill "UK used-car FAQ") |
| `n8n/sf-utility-chat-workflow.ts` | Workflow SDK source of the bridge workflow |
| `force-app/main/default/externalCredentials/` | `n8n_Agent` (Custom protocol, `X-SF-Signature` header from the principal parameter) |
| `force-app/main/default/namedCredentials/` | `n8n_Agent` → your n8n base URL |
| `force-app/main/default/objects/Agent_Context_Field__mdt/` + `customMetadata/` | Which fields of which object are sent as context |
| `force-app/main/default/permissionsets/` | `n8n_Agent_Chat` (principal access, Apex class, CMDT) |
| `force-app/main/default/classes/` | `N8nAgentChatController` + test class |
| `force-app/main/default/lwc/n8nAgentChat/` | Utility-bar component |

## n8n side

| Item | Value |
|---|---|
| Agent | UK Car Assistant (first-class n8n Agent), OpenAI model, n8n memory |
| Workflow | SF Utility Chat → Agent, built from `n8n/sf-utility-chat-workflow.ts` |
| Webhook | `POST https://<your-n8n-host>/webhook/sf-utility-chat`, Header Auth `X-SF-Signature` |

### Knowledge
The UK used-car FAQ: paperwork (V5C, HPI, write-off categories), MOT, VED, ULEZ/CAZ, consumer rights, finance (HP/PCP), EVs and hybrids,
and which Autoza tool answers reliability and price questions. The Agent loads it first and says when the answer isn't there.

### Allowed MCP actions (Autoza, `https://autoza.co.uk/api/mcp`)
Category defaults for read and write are **blocked**; only these read-only tools are allowed:
`calculate_car_tax`, `check_clean_air_zone`, `check_mot_due_date`, `mot_outlook`, `get_model_reliability`,
`get_uk_price_guide`, `search_used_cars`, `ask_about_car`, `estimate_running_costs`. Autoza has no write tools.

### Personal data rule
The `[context]` block contains Salesforce data (for a Contact: name, title, email, account name). That data goes to n8n and the
OpenAI model, **not** to Autoza: the Agent instructions forbid passing names, emails, account names, record IDs or any Salesforce data
to tools; only vehicle attributes (registration year, fuel, postcode area for CAZ, etc.) go to Autoza. Verified in tests: Autoza received
only `{registration_year, fuel}`. This is an instruction-level control, not a technical one: keep the field list in
`Agent_Context_Field__mdt` to what the assistant actually needs.

## Configure for your environment

The repository ships with placeholders. Set these before deploying:

| Where | Placeholder | Set to |
|---|---|---|
| `force-app/main/default/namedCredentials/n8n_Agent.namedCredential-meta.xml` | `https://your-n8n-host.example.com` | Your n8n base URL |
| `n8n/sf-utility-chat-workflow.ts` | `ALLOWED_ORG_ID = '00D000000000000AAA'` | Your Salesforce org ID |
| `n8n/sf-utility-chat-workflow.ts` | `AGENT_ID = 'YOUR_N8N_AGENT_ID'` | Your n8n Agent ID |
| `force-app/main/default/flexipages/LightningSales_UtilityBar.flexipage-meta.xml` | (standard Sales app) | Retrieve your own app's utility bar first if it already has items, then add the `c:n8nAgentChat` item |

## Setup

1. **n8n credential.** In n8n create a credential of type **Header Auth** named `SF Utility Chat Webhook`: name `X-SF-Signature`,
   value a long random secret (e.g. 48+ chars). Then bind it to the webhook node "Salesforce chat request" (open the node, pick the
   credential) and publish the workflow.
2. **Salesforce metadata.** Deploy in this order: credentials → CMDT + records → permission set → Apex + tests → LWC.
3. **Secret in Salesforce.** Setup → Named Credentials → External Credentials → `n8n_Agent` → principal `n8n_Agent_Principal` →
   Edit → add the authentication parameter `Signature` with the **same** secret as step 1. Never commit it.
4. **Access.** Assign permission set `n8n Agent Chat` to the users who should see the chat.
5. **Utility bar.** Done as metadata: `force-app/main/default/flexipages/LightningSales_UtilityBar.flexipage-meta.xml` adds
   "Agent Chat (n8n)" (label `n8n Agent`, icon `chat`, 450×700, **Start automatically**). Manual equivalent: Setup → App Manager →
   Sales → Edit → Utility Items → Add Utility Item. Pop-out is only offered for console apps; Sales is a standard-navigation app.
6. **Test.** Open a Contact, open "n8n Agent" from the bottom bar, ask "Is this person's 2016 petrol car ULEZ compliant?".

To change which fields are shared: Setup → Custom Metadata Types → Agent Context Field → Manage Records. An object without an
active record sends no record data.

## Behaviour

- Identity (`user.id/name/profile`, `orgId`) is set by Apex from `UserInfo`; the browser can't spoof it.
- Record fields are read `WITH USER_MODE`: if the user can't see the record or a field, `record` is `null`.
- The toggle "Share this record with the assistant" leaves the record out of the next messages.
- `sessionId` = `crypto.randomUUID()` in `sessionStorage`; "New conversation" creates a new one (new Agent memory thread).
- Messages are plain text (no HTML rendering). Errors show a friendly banner with **Retry**; raw response bodies are never shown.

## Known limitations

- The utility opens from the bottom utility bar (not a right-hand docked panel like Agentforce); no pop-out in the standard Sales app.
- n8n Agents are in **Preview** and change often.
- No write actions: Autoza is read-only and write categories are blocked.
- One request can take up to ~120 s (Apex callout limit); long Agent runs time out with a friendly error.
- No streaming: the reply appears when complete.
- The Agent and workflow run on whichever n8n instance you point the Named Credential at; use a non-production instance for testing.
- The Salesforce org is a **Developer Edition** org, not a sandbox (accepted for this build).
- Conversation history is per browser tab session (`sessionStorage`); the Agent's own memory is kept in n8n per session key.
