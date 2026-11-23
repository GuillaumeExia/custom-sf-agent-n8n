import { LightningElement, wire } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { getEnclosingUtilityId, setUtilityLabel, setUtilityIcon } from 'lightning/platformUtilityBarApi';
import sendMessage from '@salesforce/apex/N8nAgentChatController.sendMessage';
import getRecordLabel from '@salesforce/apex/N8nAgentChatController.getRecordLabel';

const SESSION_KEY = 'n8nAgentChat.sessionId';
const MESSAGES_KEY = 'n8nAgentChat.messages';
const MAX_LENGTH = 4000;
const MAX_STORED_MESSAGES = 100;

// sessionStorage can throw (privacy settings, Lightning Locker/LWS restrictions): never let it break the chat.
function readStorage(key) {
    try {
        return window.sessionStorage.getItem(key);
    } catch (e) {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        if (value === null) {
            window.sessionStorage.removeItem(key);
        } else {
            window.sessionStorage.setItem(key, value);
        }
    } catch (e) {
        // ignore: history then lives only as long as the utility stays loaded
    }
}

function newSessionId() {
    try {
        return crypto.randomUUID();
    } catch (e) {
        // Fallback for browsers without randomUUID: still matches ^[A-Za-z0-9-]{1,40}$
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
    }
}

export default class N8nAgentChat extends LightningElement {
    sessionId;
    messages = [];
    draft = '';
    isSending = false;
    errorMessage;
    pendingRetry; // { text, recordId } of the last failed send

    recordId;
    objectApiName;
    recordLabel;
    includeRecord = true;

    shouldScroll = false;

    connectedCallback() {
        this.sessionId = readStorage(SESSION_KEY);
        if (!this.sessionId) {
            this.sessionId = newSessionId();
            writeStorage(SESSION_KEY, this.sessionId);
        }
        try {
            const stored = JSON.parse(readStorage(MESSAGES_KEY) || '[]');
            this.messages = Array.isArray(stored) ? stored.map((m) => this.decorate(m)) : [];
        } catch (e) {
            this.messages = [];
        }
        this.shouldScroll = true;
        this.initUtility();
    }

    async initUtility() {
        try {
            const utilityId = await getEnclosingUtilityId();
            if (utilityId) {
                await setUtilityLabel(utilityId, 'n8n Agent');
                await setUtilityIcon(utilityId, 'chat');
            }
        } catch (e) {
            // Not rendered in a utility bar (or API unavailable): nothing to set.
        }
    }

    // ---------------------------------------------------------------- page context

    @wire(CurrentPageReference)
    handlePageReference(pageRef) {
        const attrs = pageRef && pageRef.attributes ? pageRef.attributes : {};
        if (pageRef && pageRef.type === 'standard__recordPage' && attrs.recordId) {
            this.recordId = attrs.recordId;
            this.objectApiName = attrs.objectApiName;
        } else {
            this.recordId = undefined;
            this.objectApiName = undefined;
            this.recordLabel = undefined;
        }
    }

    @wire(getRecordLabel, { recordId: '$recordId' })
    handleRecordLabel({ data, error }) {
        if (data) {
            this.recordLabel = data;
        } else if (error) {
            this.recordLabel = undefined;
        }
    }

    get hasRecord() {
        return Boolean(this.recordId);
    }

    get contextLabel() {
        const objectLabel = (this.recordLabel && this.recordLabel.objectLabel) || this.objectApiName || 'Record';
        const name = this.recordLabel && this.recordLabel.name ? ` ${this.recordLabel.name}` : '';
        const suffix = this.includeRecord ? '' : ' (not shared)';
        return `Context: ${objectLabel}${name}${suffix}`;
    }

    handleToggleRecord(event) {
        this.includeRecord = event.target.checked;
    }

    // ---------------------------------------------------------------- composer

    get isEmpty() {
        return this.messages.length === 0 && !this.isSending;
    }

    get sendDisabled() {
        return this.isSending || !this.draft || !this.draft.trim();
    }

    handleDraftChange(event) {
        this.draft = event.detail.value;
    }

    handleKeyDown(event) {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            this.handleSend();
        }
    }

    handleSend() {
        const text = (this.draft || '').trim();
        if (!text || this.isSending) {
            return;
        }
        if (text.length > MAX_LENGTH) {
            this.errorMessage = 'Your message is too long. Please keep it under 4,000 characters.';
            this.pendingRetry = undefined;
            return;
        }
        const recordId = this.includeRecord ? this.recordId : null;
        this.addMessage('user', text);
        this.draft = '';
        this.send(text, recordId);
    }

    handleRetry() {
        if (this.pendingRetry && !this.isSending) {
            const { text, recordId } = this.pendingRetry;
            this.send(text, recordId);
        }
    }

    async send(text, recordId) {
        this.isSending = true;
        this.errorMessage = undefined;
        this.shouldScroll = true;
        try {
            const result = await sendMessage({ message: text, sessionId: this.sessionId, recordId: recordId || null });
            this.pendingRetry = undefined;
            this.addMessage('agent', result && result.reply ? result.reply : '');
        } catch (error) {
            this.pendingRetry = { text, recordId };
            this.errorMessage = this.reduceError(error);
        } finally {
            this.isSending = false;
            this.shouldScroll = true;
        }
    }

    handleNewConversation() {
        this.sessionId = newSessionId();
        writeStorage(SESSION_KEY, this.sessionId);
        this.messages = [];
        writeStorage(MESSAGES_KEY, null);
        this.errorMessage = undefined;
        this.pendingRetry = undefined;
        this.draft = '';
    }

    // ---------------------------------------------------------------- helpers

    addMessage(role, text) {
        const msg = this.decorate({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role,
            text,
            ts: new Date().toISOString()
        });
        this.messages = [...this.messages, msg].slice(-MAX_STORED_MESSAGES);
        writeStorage(
            MESSAGES_KEY,
            JSON.stringify(this.messages.map(({ id, role: r, text: t, ts }) => ({ id, role: r, text: t, ts })))
        );
        this.shouldScroll = true;
    }

    decorate(m) {
        const outbound = m.role === 'user';
        return {
            ...m,
            author: outbound ? 'You' : 'Agent',
            itemClass: `slds-chat-listitem ${outbound ? 'slds-chat-listitem_outbound' : 'slds-chat-listitem_inbound'}`,
            bubbleClass: `slds-chat-message__text ${outbound ? 'slds-chat-message__text_outbound' : 'slds-chat-message__text_inbound'}`
        };
    }

    reduceError(error) {
        // Apex throws AuraHandledException with a friendly message; anything else gets a generic one.
        const msg = error && error.body && error.body.message;
        return msg || 'Something went wrong. Please try again.';
    }

    renderedCallback() {
        if (this.shouldScroll && this.refs.scroller) {
            this.refs.scroller.scrollTop = this.refs.scroller.scrollHeight;
            this.shouldScroll = false;
        }
    }
}
