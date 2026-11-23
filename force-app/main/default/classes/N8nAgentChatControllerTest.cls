@IsTest
private class N8nAgentChatControllerTest {

    static final String SESSION = '3f1c2a9e-8d7b-4c1e-9a55-0b2f6d4e7a10';
    static final String LOW_ACCESS_ALIAS = 'n8nlow';

    /** Mock that records the last request and returns a canned response (or throws). */
    class N8nMock implements HttpCalloutMock {
        Integer status;
        String body;
        Boolean fail = false;
        HttpRequest lastRequest;

        N8nMock(Integer status, String body) {
            this.status = status;
            this.body = body;
        }

        public HttpResponse respond(HttpRequest req) {
            lastRequest = req;
            if (fail) {
                throw new CalloutException('Read timed out');
            }
            HttpResponse res = new HttpResponse();
            res.setStatusCode(status);
            res.setHeader('Content-Type', 'application/json');
            res.setBody(body);
            return res;
        }
    }

    @TestSetup
    static void setup() {
        Account acc = new Account(Name = 'Morgan Motors', Industry = 'Retail');
        insert acc;
        insert new Contact(FirstName = 'Jane', LastName = 'Morgan', Title = 'Buyer',
                           Email = 'jane.morgan@example.com', AccountId = acc.Id);

        // A user whose profile has no access to Contact, for the "can't see the record" case.
        // Creating users needs Manage Users; a least-privilege CI user doesn't have it, so the
        // userWithoutAccessGetsNoRecord test is skipped there (deletedOrHiddenRecordSendsNoRecord
        // still covers the same "no rows" branch).
        List<Profile> minimal = [SELECT Id FROM Profile WHERE Name = 'Minimum Access - Salesforce' LIMIT 1];
        if (!minimal.isEmpty()) {
            System.runAs(new User(Id = UserInfo.getUserId())) {
                try {
                    insert new User(
                        Alias = LOW_ACCESS_ALIAS, LastName = 'LowAccess',
                        Email = 'n8n.lowaccess@example.com',
                        Username = 'n8n.lowaccess.' + System.now().getTime() + '@example.com',
                        ProfileId = minimal[0].Id, TimeZoneSidKey = 'Europe/London',
                        LocaleSidKey = 'en_GB', EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'en_US'
                    );
                } catch (DmlException e) {
                    System.debug(LoggingLevel.INFO, 'Skipping low-access user setup: ' + e.getMessage());
                }
            }
        }
    }

    static void useDefaultConfig() {
        N8nAgentChatController.fieldConfigOverride = new Map<String, String>{
            'Contact' => 'Name, Title, Email, Account.Name, Not_A_Field__c, Owner.Bogus, A.B.C'
        };
    }

    static Map<String, Object> sentPayload(N8nMock mock) {
        return (Map<String, Object>) JSON.deserializeUntyped(mock.lastRequest.getBody());
    }

    static String expectError(String message, String sessionId, Id recordId) {
        try {
            N8nAgentChatController.sendMessage(message, sessionId, recordId);
        } catch (AuraHandledException e) {
            return e.getMessage();
        }
        Assert.fail('Expected an AuraHandledException');
        return null;
    }

    // ------------------------------------------------------------- success

    @IsTest
    static void sendsRecordContextForConfiguredObject() {
        useDefaultConfig();
        Contact c = [SELECT Id FROM Contact LIMIT 1];
        N8nMock mock = new N8nMock(200, '{"reply":"Yes, a 2016 petrol car meets ULEZ.","sessionId":"' + SESSION + '"}');
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        N8nAgentChatController.ChatReply r = N8nAgentChatController.sendMessage('  Is this ULEZ compliant?  ', SESSION, c.Id);
        Test.stopTest();

        Assert.areEqual('Yes, a 2016 petrol car meets ULEZ.', r.reply);
        Assert.areEqual(SESSION, r.sessionId);
        Assert.areEqual(N8nAgentChatController.ENDPOINT, mock.lastRequest.getEndpoint());
        Assert.areEqual('POST', mock.lastRequest.getMethod());

        Map<String, Object> payload = sentPayload(mock);
        Assert.areEqual('Is this ULEZ compliant?', payload.get('message'), 'message is trimmed');
        Assert.areEqual(UserInfo.getOrganizationId(), payload.get('orgId'));
        Map<String, Object> user = (Map<String, Object>) payload.get('user');
        Assert.areEqual(UserInfo.getUserId(), user.get('id'), 'identity comes from UserInfo');

        Map<String, Object> record = (Map<String, Object>) payload.get('record');
        Assert.areEqual('Contact', record.get('objectApiName'));
        Map<String, Object> fields = (Map<String, Object>) record.get('fields');
        Assert.areEqual('Jane Morgan', fields.get('Name'));
        Assert.areEqual('Morgan Motors', fields.get('Account.Name'));
        Assert.isFalse(fields.containsKey('Not_A_Field__c'), 'unknown fields are dropped');
        Assert.isFalse(fields.containsKey('Owner.Bogus'), 'unknown relationship fields are dropped');
        Assert.areEqual(4, fields.size());
    }

    @IsTest
    static void sendsNullRecordWhenNoRecordOpen() {
        useDefaultConfig();
        N8nMock mock = new N8nMock(200, '{"reply":"An MOT is due every year after a car is 3 years old."}');
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        N8nAgentChatController.ChatReply r = N8nAgentChatController.sendMessage('When is an MOT due?', SESSION, null);
        Test.stopTest();

        Assert.isTrue(r.reply.startsWith('An MOT'));
        Assert.isNull(sentPayload(mock).get('record'));
    }

    @IsTest
    static void usesCustomMetadataWhenNoOverride() {
        // No override: configuration comes from Agent_Context_Field__mdt (whatever is deployed).
        Contact c = [SELECT Id FROM Contact LIMIT 1];
        N8nMock mock = new N8nMock(200, '{"reply":"ok"}');
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        N8nAgentChatController.sendMessage('hi', SESSION, c.Id);
        Test.stopTest();

        Assert.isNotNull(mock.lastRequest, 'callout is made with or without configured fields');
    }

    // ------------------------------------------------------------- record context

    @IsTest
    static void unsupportedObjectSendsNoRecord() {
        useDefaultConfig(); // only Contact is configured
        Account a = [SELECT Id FROM Account LIMIT 1];
        N8nMock mock = new N8nMock(200, '{"reply":"ok"}');
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        N8nAgentChatController.sendMessage('Tell me about this account', SESSION, a.Id);
        Test.stopTest();

        Assert.isNull(sentPayload(mock).get('record'), 'objects without active config send no data');
    }

    @IsTest
    static void deletedOrHiddenRecordSendsNoRecord() {
        useDefaultConfig();
        Contact c = [SELECT Id FROM Contact LIMIT 1];
        delete c; // query returns no rows, same branch as a record hidden by sharing

        Test.startTest();
        Map<String, Object> ctx = N8nAgentChatController.buildRecordContext(c.Id);
        Test.stopTest();

        Assert.isNull(ctx);
    }

    @IsTest
    static void userWithoutAccessGetsNoRecord() {
        useDefaultConfig();
        Contact c = [SELECT Id FROM Contact LIMIT 1];
        List<User> low = [SELECT Id FROM User WHERE Alias = :LOW_ACCESS_ALIAS LIMIT 1];
        if (low.isEmpty()) {
            return; // profile not available in this org; covered by deletedOrHiddenRecordSendsNoRecord
        }
        Map<String, Object> ctx;
        N8nAgentChatController.RecordLabel label;
        Test.startTest();
        System.runAs(low[0]) {
            ctx = N8nAgentChatController.buildRecordContext(c.Id);
            label = N8nAgentChatController.getRecordLabel(c.Id);
        }
        Test.stopTest();

        Assert.isNull(ctx, 'USER_MODE must hide records the user cannot read');
        Assert.isNull(label);
    }

    @IsTest
    static void recordLabelForChip() {
        Contact c = [SELECT Id FROM Contact LIMIT 1];
        Test.startTest();
        N8nAgentChatController.RecordLabel label = N8nAgentChatController.getRecordLabel(c.Id);
        N8nAgentChatController.RecordLabel none = N8nAgentChatController.getRecordLabel(null);
        Test.stopTest();

        Assert.areEqual('Jane Morgan', label.name);
        Assert.isNotNull(label.objectLabel);
        Assert.isNull(none);
    }

    @IsTest
    static void recordLabelForDeletedRecordIsNull() {
        Contact c = [SELECT Id FROM Contact LIMIT 1];
        delete c;
        Assert.isNull(N8nAgentChatController.getRecordLabel(c.Id));
    }

    // ------------------------------------------------------------- validation

    @IsTest
    static void rejectsBlankMessage() {
        Assert.areEqual('Please type a message.', expectError('   ', SESSION, null));
        Assert.areEqual('Please type a message.', expectError(null, SESSION, null));
    }

    @IsTest
    static void rejectsTooLongMessage() {
        String longText = 'a'.repeat(N8nAgentChatController.MAX_MESSAGE_LENGTH + 1);
        Assert.isTrue(expectError(longText, SESSION, null).contains('too long'));
    }

    @IsTest
    static void acceptsMessageAtMaxLength() {
        N8nMock mock = new N8nMock(200, '{"reply":"ok"}');
        Test.setMock(HttpCalloutMock.class, mock);
        String text = 'a'.repeat(N8nAgentChatController.MAX_MESSAGE_LENGTH);
        Test.startTest();
        N8nAgentChatController.sendMessage(text, SESSION, null);
        Test.stopTest();
        Assert.areEqual(text, sentPayload(mock).get('message'), 'exactly 4000 chars is accepted');
    }

    @IsTest
    static void rejectsInvalidSessionId() {
        Assert.isTrue(expectError('hi', 'bad id with spaces', null).contains('conversation'));
        Assert.isTrue(expectError('hi', null, null).contains('conversation'));
    }

    // ------------------------------------------------------------- HTTP errors

    @IsTest
    static void maps400ToFriendlyMessage() {
        Test.setMock(HttpCalloutMock.class, new N8nMock(400, '{"error":"validation_error","message":"secret detail"}'));
        Test.startTest();
        String msg = expectError('hi', SESSION, null);
        Test.stopTest();
        Assert.isTrue(msg.contains('could not process'));
        Assert.isFalse(msg.contains('secret detail'), 'raw body is never shown');
    }

    @IsTest
    static void maps403ToAuthMessage() {
        Test.setMock(HttpCalloutMock.class, new N8nMock(403, '{"error":"forbidden"}'));
        Test.startTest();
        String msg = expectError('hi', SESSION, null);
        Test.stopTest();
        Assert.isTrue(msg.contains('not authorised'));
    }

    @IsTest
    static void maps502ToUnavailable() {
        Test.setMock(HttpCalloutMock.class, new N8nMock(502, '{"error":"upstream_error"}'));
        Test.startTest();
        String msg = expectError('hi', SESSION, null);
        Test.stopTest();
        Assert.isTrue(msg.contains('unavailable'));
    }

    @IsTest
    static void mapsTimeoutToFriendlyMessage() {
        N8nMock mock = new N8nMock(200, '');
        mock.fail = true;
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        String msg = expectError('hi', SESSION, null);
        Test.stopTest();
        Assert.isTrue(msg.contains('too long to answer'));
    }

    @IsTest
    static void emptyOrMalformedReplyIsAnError() {
        Test.setMock(HttpCalloutMock.class, new N8nMock(200, 'not json'));
        Test.startTest();
        String msg = expectError('hi', SESSION, null);
        Test.stopTest();
        Assert.isTrue(msg.contains('empty answer'));
    }
}
