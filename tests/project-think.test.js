'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadProductionHelpers() {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'chatgpt-ad-cleaner.user.js'),
        'utf8'
    );
    const start = source.indexOf('    function getRequestUrl(input) {');
    const end = source.indexOf('    const originalFetch = window.fetch;', start);

    assert.notEqual(start, -1, 'production request helpers must exist');
    assert.notEqual(end, -1, 'production helper block must have an end marker');

    const context = {
        URL,
        location: { origin: 'https://chatgpt.com' }
    };
    vm.createContext(context);
    vm.runInContext(
        source.slice(start, end) + '\n' +
        'globalThis.testApi = {' +
        'getRequestUrl, parseSameOriginUrl, getProjectGizmoId, ' +
        'enableProjectThinkingHint, getResponsePatchKind, shouldPatch' +
        '};',
        context
    );

    return context.testApi;
}

const api = loadProductionHelpers();
const projectHintsUrl =
    'https://chatgpt.com/backend-api/system_hints?mode=basic&gizmo_id=g-p-fixture_123';

test('request URL helper accepts strings, Request-like objects, and URL objects', () => {
    assert.equal(api.getRequestUrl('/backend-api/conversation/init'), '/backend-api/conversation/init');
    assert.equal(api.getRequestUrl({ url: projectHintsUrl }), projectHintsUrl);
    assert.equal(api.getRequestUrl(new URL(projectHintsUrl)), projectHintsUrl);
    assert.equal(api.getRequestUrl({}), '');
});

test('project id is recognized only for the basic system_hints endpoint', () => {
    assert.equal(api.getProjectGizmoId(projectHintsUrl), 'g-p-fixture_123');
    assert.equal(
        api.getProjectGizmoId('/backend-api/system_hints?mode=basic&gizmo_id=g-p-fixture_123'),
        'g-p-fixture_123'
    );
});

test('ordinary chats, custom GPTs, wrong modes, and unrelated paths are not project requests', () => {
    assert.equal(api.getProjectGizmoId('https://chatgpt.com/backend-api/system_hints?mode=basic'), null);
    assert.equal(api.getProjectGizmoId('https://chatgpt.com/backend-api/system_hints?mode=basic&gizmo_id=g-custom123'), null);
    assert.equal(api.getProjectGizmoId('https://chatgpt.com/backend-api/system_hints?mode=plugins&gizmo_id=g-p-fixture'), null);
    assert.equal(api.getProjectGizmoId('https://chatgpt.com/not-system_hints?mode=basic&gizmo_id=g-p-fixture'), null);
});

test('cross-origin API-shaped URLs are never patched', () => {
    const external = 'https://example.com/backend-api/system_hints?mode=basic&gizmo_id=g-p-fixture';
    assert.equal(api.parseSameOriginUrl(external), null);
    assert.equal(api.getProjectGizmoId(external), null);
    assert.equal(api.shouldPatch(external), false);
});

test('project Think patch adds gizmo_interaction and preserves existing modes', () => {
    const data = {
        system_hints: [
            { system_hint: 'picture_v2', required_conversation_modes: [] },
            { system_hint: 'reason', required_conversation_modes: ['primary_assistant'] },
            { system_hint: 'search', required_conversation_modes: [] }
        ]
    };

    assert.equal(api.enableProjectThinkingHint(data, projectHintsUrl), true);
    assert.deepEqual(
        Array.from(data.system_hints[1].required_conversation_modes),
        ['primary_assistant', 'gizmo_interaction']
    );
    assert.deepEqual(
        data.system_hints.map(item => item.system_hint),
        ['picture_v2', 'reason', 'search']
    );
});

test('project Think patch is idempotent', () => {
    const data = {
        system_hints: [{
            system_hint: 'reason',
            required_conversation_modes: ['primary_assistant', 'gizmo_interaction']
        }]
    };

    assert.equal(api.enableProjectThinkingHint(data, projectHintsUrl), false);
    assert.deepEqual(
        Array.from(data.system_hints[0].required_conversation_modes),
        ['primary_assistant', 'gizmo_interaction']
    );
});

test('missing or malformed reason hints are left unchanged', () => {
    assert.equal(api.enableProjectThinkingHint({}, projectHintsUrl), false);
    assert.equal(api.enableProjectThinkingHint({ system_hints: [] }, projectHintsUrl), false);
    assert.equal(api.enableProjectThinkingHint({
        system_hints: [{ system_hint: 'reason', required_conversation_modes: 'primary_assistant' }]
    }, projectHintsUrl), false);
    assert.equal(api.enableProjectThinkingHint({
        system_hints: [{ system_hint: 'reason', required_conversation_modes: ['primary_assistant'] }]
    }, 'https://chatgpt.com/backend-api/system_hints?mode=plugins&gizmo_id=g-p-fixture'), false);
});

test('response patch scope includes only conversation init and project basic hints', () => {
    assert.equal(
        api.getResponsePatchKind('https://chatgpt.com/backend-api/conversation/init?x=1'),
        'conversation-init'
    );
    assert.equal(api.getResponsePatchKind(projectHintsUrl), 'project-system-hints');
    assert.equal(api.shouldPatch('https://chatgpt.com/backend-api/conversations'), false);
    assert.equal(api.shouldPatch('https://chatgpt.com/backend-api/system_hints?mode=plugins&gizmo_id=g-p-fixture'), false);
});
