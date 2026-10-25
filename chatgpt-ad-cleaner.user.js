// ==UserScript==
// @name         ChatGPT Ad Cleaner
// @namespace    io.github.free6589.chatgpt-ad-cleaner
// @version      0.01
// @description  Hides the upgrade ads, free-trial buttons, plan badge and disclaimer on chatgpt.com in any interface language, restores the normal file-upload menu, and turns "Think" on automatically.
// @author       free6589
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '0.01';
    const HIDDEN_ATTR = 'data-chgpt-hidden';
    const LOG_PREFIX = '[ChatGPT Ad Cleaner]';

    const state = { paused: false };
    const stats = { scans: 0, lastScanMs: 0 };

    // Do nothing on pricing / checkout pages.
    if (/\/(pricing|checkout|subscription|plans)(\/|$)/i.test(location.pathname)) {
        return;
    }

    /* ------------------------------------------------------------------
     * 1) File upload menu
     *
     * When the free upload quota is used up, the server sends a "file_upload"
     * entry inside blocked_features of /backend-api/conversation/init, and the
     * "+" menu is replaced by an upsell row. We drop that entry before the page
     * reads it, so the normal "Upload from computer" item stays.
     *
     * Note: this only removes the in-page block. The real quota is enforced by
     * the server and cannot be changed by a userscript.
     * ------------------------------------------------------------------ */
    function stripUploadBlock(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }

        let changed = false;

        if (Array.isArray(data.blocked_features)) {
            const kept = data.blocked_features.filter(
                item => !(item && item.name === 'file_upload')
            );

            if (kept.length !== data.blocked_features.length) {
                data.blocked_features = kept;
                changed = true;
            }
        }

        if (Array.isArray(data.limits_progress)) {
            for (const item of data.limits_progress) {
                if (item && item.feature_name === 'file_upload' && item.remaining === 0) {
                    item.remaining = 1;
                    changed = true;
                }
            }
        }

        if (data.banner_info && data.banner_info.upsell_context_id === 'file_upload') {
            data.banner_info = null;
            changed = true;
        }

        return changed;
    }

    function shouldPatch(url) {
        // Upload-block metadata is needed from the init response only. Matching
        // every /conversation/* URL also parses large saved-conversation JSON
        // responses for no reason, which can hurt long-chat load performance.
        return /\/backend-api\/conversation\/init(?:[?#]|$)/.test(String(url || ''));
    }

    const originalFetch = window.fetch;

    if (typeof originalFetch === 'function') {
        window.fetch = function (...args) {
            const input = args[0];
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            const promise = originalFetch.apply(this, args);

            if (!shouldPatch(url)) {
                return promise;
            }

            return promise.then(response => {
                const type = response.headers.get('content-type') || '';

                if (!/application\/json/i.test(type)) {
                    return response;
                }

                return response.clone().json().then(data => {
                    if (!stripUploadBlock(data)) {
                        return response;
                    }

                    const headers = new Headers(response.headers);
                    headers.delete('content-length');
                    headers.delete('content-encoding');

                    return new Response(JSON.stringify(data), {
                        status: response.status,
                        statusText: response.statusText,
                        headers
                    });
                }).catch(() => response);
            });
        };
    }

    /* ------------------------------------------------------------------
     * 2) Text patterns (English UI + Chinese UI)
     * ------------------------------------------------------------------ */
    const MAX_TEXT_LENGTH = 900;

    const TRIAL_CTA_RE =
        /^(?:\u514D\u8D39\u8BD5\u7528\s*(?:chatgpt\s*)?(?:plus|pro)(?:\s*(?:1|\u4E00)\s*\u4E2A\u6708|\s*30\s*\u5929|\s*\u5957\u9910)?|\u514D\u8D39\u8BD5\u7528|\u7ACB\u5373\u8BD5\u7528\s*(?:plus|pro)?|\u8BD5\u7528\s*(?:chatgpt\s*)?(?:plus|pro)|try\s+(?:chatgpt\s+)?plus(?:\s+for\s+free)?(?:\s+for\s+1\s+month)?|try\s+plus(?:\s+free)?|start\s+(?:a\s+)?free\s+trial|free\s+trial(?:\s+of)?\s*(?:chatgpt\s*)?(?:plus|pro)?|start\s+your\s+free\s+trial)$/i;

    const OFFER_CTA_RE =
        /^(?:\u514D\u8D39\u4F18\u60E0|\u83B7\u53D6\u4F18\u60E0|\u9886\u53D6\u4F18\u60E0|\u9886\u53D6\u514D\u8D39\u4F18\u60E0|\u5151\u6362\u514D\u8D39\u4F18\u60E0|claim\s+(?:free\s+)?offer|get\s+offer|free\s+offer|redeem\s+(?:free\s+)?offer)$/i;

    const OFFER_TEXT_HINTS = ['\u83B7\u53D6\u4F18\u60E0', '\u9886\u53D6\u4F18\u60E0', '\u514D\u8D39\u4F18\u60E0', '\u9886\u53D6\u514D\u8D39\u8BD5\u7528'];

    const UPGRADE_CTA_RE =
        /^(?:upgrade\s+to\s+(?:chatgpt\s+)?(?:plus|pro)|\u5347\u7EA7\u81F3?\s*(?:chatgpt\s*)?(?:plus|pro)|\u7ACB\u5373\u5347\u7EA7\s*(?:plus|pro)?)$/i;

    const PLAN_BADGE_RE = /^(?:\u514D\u8D39\u7248|\u514D\u8D39\u5957\u9910|\u514D\u8D39\u8BA1\u5212|free|free\s+plan)$/i;

    const UPLOAD_LIMIT_RE =
        /(?:\u8BA2\u9605\s*(?:Plus|Business)\s*[\uFF0C,]\s*\u83B7\u5F97\u66F4\u591A\u4E0A\u4F20\u989D\u5EA6|\u6216\u7B49\u5F85.{0,16}\u540E\u518D\u4E0A\u4F20|get\s+(?:plus|business)\s+for\s+more\s+uploads|upload\s+limit\s+reached|more\s+uploads|mehr\s+uploads|m\u00E1s\s+cargas|plus\s+de\s+t\u00E9l\u00E9versements|mais\s+uploads|altre\s+caricamenti)/i;

    const DISCLAIMER_RE =
        /^(?:chatgpt\s*)?(?:\u53EF\u80FD\u4F1A\u51FA\u9519|\u53EF\u80FD\u4F1A\u72AF\u9519)[\uFF0C,\u3002.!\uFF01]?\s*(?:\u8BF7\u6838\u67E5\u91CD\u8981\u4FE1\u606F|\u8BF7\u6838\u5BF9\u91CD\u8981\u4FE1\u606F|\u8BF7\u6838\u5B9E\u91CD\u8981\u4FE1\u606F)[\u3002.!\uFF01]?$|^chatgpt(?:\s+is\s+ai\s+and)?\s+can\s+make\s+mistakes[.,\uFF0C\u3002!\uFF01]?\s*check\s+important\s+info[.!\uFF01\u3002]?$/i;

    // Same sentence in any other language: it starts with ChatGPT, mentions
    // mistakes and asks to check important information.
    const DISCLAIMER_GENERIC_RE =
        /^chatgpt[^.!?]{0,60}(?:mistake|error|erro|erreur|fehler|errore|\u043E\u0448\u0438\u0431|\u9593\u9055|\uC2E4\uC218|\u9519\u8BEF|\u51FA\u9519)[\s\S]{0,150}(?:important|wichtig|importante|importanti|\u0432\u0430\u0436\u043D|\u91CD\u8981|\uC911\uC694)/i;

    // Exact button labels for the other interface languages. Matching a whole
    // label (not a substring) keeps normal chat text out of the way.
    const TRIAL_LABELS = [
        'prueba plus gratis', 'probar plus gratis', 'prueba gratis',
        'empieza tu prueba gratuita', 'comienza tu prueba gratuita',
        'essayer plus gratuitement', 'essayez plus gratuitement', 'essai gratuit',
        'commencer l\'essai gratuit', 'commencer l\u2019essai gratuit',
        'plus kostenlos testen', 'plus gratis testen', 'kostenlos testen', 'kostenlose testversion',
        'experimente o plus gr\u00E1tis', 'experimentar plus gr\u00E1tis', 'teste o plus gr\u00E1tis', 'teste gr\u00E1tis',
        'prova plus gratis', 'prova plus gratuitamente', 'prova gratuita',
        'plus\u3092\u7121\u6599\u3067\u8A66\u3059', '\u7121\u6599\u3067\u8A66\u3059', '\u7121\u6599\u30C8\u30E9\u30A4\u30A2\u30EB',
        'plus \uBB34\uB8CC\uB85C \uC0AC\uC6A9\uD574 \uBCF4\uAE30', '\uBB34\uB8CC\uB85C \uC0AC\uC6A9\uD574 \uBCF4\uAE30', '\uBB34\uB8CC \uCCB4\uD5D8',
        '\u043F\u043E\u043F\u0440\u043E\u0431\u043E\u0432\u0430\u0442\u044C plus \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E', '\u043F\u043E\u043F\u0440\u043E\u0431\u043E\u0432\u0430\u0442\u044C \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E', '\u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u0430\u044F \u043F\u0440\u043E\u0431\u043D\u0430\u044F \u0432\u0435\u0440\u0441\u0438\u044F',
        'plus gratis proberen', 'gratis proberen',
        'wypr\u00F3buj plus za darmo', 'wypr\u00F3buj za darmo',
        '\u00FCcretsiz dene', 'plus\'\u0131 \u00FCcretsiz dene',
        'coba plus gratis', 'coba gratis',
        'd\u00F9ng th\u1EED plus mi\u1EC5n ph\u00ED', 'd\u00F9ng th\u1EED mi\u1EC5n ph\u00ED',
        '\u0E17\u0E14\u0E25\u0E2D\u0E07\u0E43\u0E0A\u0E49 plus \u0E1F\u0E23\u0E35', '\u0E17\u0E14\u0E25\u0E2D\u0E07\u0E43\u0E0A\u0E49\u0E1F\u0E23\u0E35',
        '\u062C\u0631\u0651\u0628 plus \u0645\u062C\u0627\u0646\u064B\u0627', '\u062A\u062C\u0631\u0628\u0629 \u0645\u062C\u0627\u0646\u064A\u0629',
        'plus \u0915\u094B \u092E\u0941\u092B\u093C\u094D\u0924 \u0906\u091C\u093C\u092E\u093E\u090F\u0901', '\u092E\u0941\u092B\u093C\u094D\u0924 \u0906\u091C\u093C\u092E\u093E\u090F\u0901'
    ];

    const OFFER_LABELS = [
        'aprovechar oferta', 'obtener oferta', 'canjear oferta', 'reclamar oferta', 'oferta gratis',
        'r\u00E9cup\u00E9rer l\'offre', 'obtenir l\'offre', 'offre gratuite', 'profiter de l\'offre',
        'angebot sichern', 'angebot erhalten', 'angebot einl\u00F6sen', 'gratisangebot',
        'resgatar oferta', 'aproveitar oferta', 'oferta gr\u00E1tis',
        'riscatta offerta', 'ottieni offerta', 'offerta gratis',
        '\u30AA\u30D5\u30A1\u30FC\u3092\u53D7\u3051\u53D6\u308B', '\u7121\u6599\u30AA\u30D5\u30A1\u30FC',
        '\uD61C\uD0DD \uBC1B\uAE30', '\uBB34\uB8CC \uD61C\uD0DD',
        '\u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0435', '\u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E\u0435 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0435',
        'aanbieding claimen', 'gratis aanbieding',
        'odbierz ofert\u0119', 'darmowa oferta',
        'teklifi al', '\u00FCcretsiz teklif',
        'klaim penawaran', 'penawaran gratis',
        'nh\u1EADn \u01B0u \u0111\u00E3i', '\u01B0u \u0111\u00E3i mi\u1EC5n ph\u00ED',
        '\u0E23\u0E31\u0E1A\u0E02\u0E49\u0E2D\u0E40\u0E2A\u0E19\u0E2D', '\u0E02\u0E49\u0E2D\u0E40\u0E2A\u0E19\u0E2D\u0E1F\u0E23\u0E35',
        '\u0627\u062D\u0635\u0644 \u0639\u0644\u0649 \u0627\u0644\u0639\u0631\u0636', '\u0639\u0631\u0636 \u0645\u062C\u0627\u0646\u064A',
        '\u0911\u092B\u093C\u0930 \u092A\u094D\u0930\u093E\u092A\u094D\u0924 \u0915\u0930\u0947\u0902', '\u092E\u0941\u092B\u093C\u094D\u0924 \u0911\u092B\u093C\u0930'
    ];

    const UPGRADE_LABELS = [
        '\u5347\u7EA7\u8BA2\u9605', '\u8BA2\u9605\u5347\u7EA7', '\u7ACB\u5373\u8BA2\u9605', '\u8BA2\u9605 plus', '\u5347\u7EA7\u5957\u9910', '\u5347\u7EA7\u8BA1\u5212',
        '\u83B7\u53D6 plus', '\u83B7\u53D6plus', '\u83B7\u53D6 chatgpt plus', '\u83B7\u53D6chatgpt plus',
        'get plus', 'upgrade to plus', 'subscribe to plus', 'upgrade plan', 'see plans',
        'mejorar plan', 'mejorar a plus', 'suscribirse a plus', 'passer \u00E0 plus', 'plus abonnieren',
        'upgrade auf plus', 'fazer upgrade', 'assinar o plus', 'passar para o plus', 'passa a plus',
        'abbonati a plus', 'plus\'a y\u00FCkselt', 'plus\'a ge\u00E7', 'n\u00E2ng c\u1EA5p l\u00EAn plus', '\u0E2D\u0E31\u0E1B\u0E40\u0E01\u0E23\u0E14\u0E40\u0E1B\u0E47\u0E19 plus',
        'plus\u306B\u30A2\u30C3\u30D7\u30B0\u30EC\u30FC\u30C9', 'plus \uAD6C\uB3C5', '\u043F\u043E\u0434\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u043D\u0430 plus'
    ];

    const PROMO_PATTERNS = [
        /\u4F60\u6B63\u5728\u4F7F\u7528\s*ChatGPT\s*(?:\u514D\u8D39\u7248|\u514D\u8D39\u8BA1\u5212|\u514D\u8D39\u5957\u9910).{0,220}(?:\u5347\u7EA7|\u9AD8\u7EA7\u6A21\u578B|\u8BB0\u5FC6|\u56FE\u50CF)/i,
        /(?:\u4F60\u6B63\u5728\u4F7F\u7528|\u4F60\u5F53\u524D\u4F7F\u7528\u7684\u662F|\u5F53\u524D\u6B63\u5728\u4F7F\u7528).{0,40}(?:\u514D\u8D39\u7248|\u514D\u8D39\u8BA1\u5212|\u514D\u8D39\u5957\u9910).{0,180}(?:\u5347\u7EA7|\u9AD8\u7EA7\u6A21\u578B|\u8BB0\u5FC6|\u56FE\u50CF)/i,
        /\u63D0\u5347\u6280\u672F\u5DE5\u4F5C\u7684\u51C6\u786E\u6027/i,
        /(?:\u63D0\u5347|\u63D0\u9AD8|\u6539\u5584).{0,35}(?:\u6280\u672F\u5DE5\u4F5C|\u5DE5\u4F5C\u6548\u7387|\u51C6\u786E\u6027).{0,120}(?:\u5347\u7EA7|Plus|Pro|\u589E\u5F3A\u63A8\u7406)/i,
        /(?:\u5347\u7EA7\u81F3|\u5347\u7EA7\u5230|\u5347\u7EA7)\s*(?:ChatGPT\s*)?(?:Plus|Pro).{0,220}(?:\u589E\u5F3A\u63A8\u7406|\u8C03\u8BD5\u4EE3\u7801|\u68B3\u7406\u7CFB\u7EDF|\u6570\u5B66|\u7406\u79D1\u95EE\u9898|\u7F16\u7A0B|\u63A8\u7406\u80FD\u529B)/i,
        /(?:\u589E\u5F3A\u63A8\u7406|\u8C03\u8BD5\u4EE3\u7801|\u68B3\u7406\u7CFB\u7EDF).{0,140}(?:\u5347\u7EA7\u81F3|\u5347\u7EA7\u5230|\u5347\u7EA7|Plus|Pro|\u6570\u5B66|\u7406\u79D1\u95EE\u9898)/i,
        /(?:\u5347\u7EA7|\u8BA2\u9605|\u514D\u8D39\u8BD5\u7528|\u5F00\u59CB\u8BD5\u7528).{0,160}(?:\u9AD8\u7EA7\u6A21\u578B|\u66F4\u5F3A\u7684\u8BB0\u5FC6\u529F\u80FD|\u66F4\u5927\u7684\u8BB0\u5FC6\u5BB9\u91CF|\u66F4\u9AD8\u8D28\u91CF\u7684\u56FE\u50CF|\u751F\u6210\u66F4\u9AD8\u8D28\u91CF\u7684\u56FE\u50CF|\u66F4\u591A\u6D88\u606F|\u66F4\u9AD8\u7684\u4F7F\u7528\u9650\u989D|\u589E\u5F3A\u63A8\u7406|\u8C03\u8BD5\u4EE3\u7801|\u68B3\u7406\u7CFB\u7EDF|\u6570\u5B66\u6216\u7406\u79D1\u95EE\u9898)/i,
        /(?:\u9AD8\u7EA7\u6A21\u578B|\u66F4\u5F3A\u7684\u8BB0\u5FC6\u529F\u80FD|\u66F4\u5927\u7684\u8BB0\u5FC6\u5BB9\u91CF|\u66F4\u9AD8\u8D28\u91CF\u7684\u56FE\u50CF|\u589E\u5F3A\u63A8\u7406|\u8C03\u8BD5\u4EE3\u7801|\u68B3\u7406\u7CFB\u7EDF|\u6570\u5B66\u6216\u7406\u79D1\u95EE\u9898).{0,160}(?:\u5347\u7EA7|\u8BA2\u9605|\u514D\u8D39\u8BD5\u7528|Plus|Pro)/i,
        /(?:you(?:'|\u2019)re using|you are using|you(?:'|\u2019)re on|you are on).{0,50}(?:ChatGPT\s*)?(?:Free plan|Free tier|free version).{0,200}(?:upgrade|advanced models|memory|images|limits)/i,
        /(?:upgrade to use|upgrade to access|upgrade for|try Plus|try Pro|start a free trial).{0,160}(?:advanced models|reasoning|debug code|coding|math|science|memory|higher.?quality images|more messages|higher limits)/i,
        /(?:est\u00E1s usando la versi\u00F3n gratuita|estas usando la versi\u00F3n gratuita).{0,200}(?:mejora|avanzados|memoria)/i,
        /(?:vous utilisez la version gratuite|vous utilisez la version gratuite de chatgpt).{0,200}(?:passez|avanc\u00E9s|m\u00E9moire)/i,
        /(?:sie verwenden die kostenlose version|du verwendest die kostenlose version).{0,200}(?:upgrade|fortschrittliche|speicher)/i,
        /(?:voc\u00EA est\u00E1 usando a vers\u00E3o gratuita|est\u00E1 a usar a vers\u00E3o gratuita).{0,200}(?:atualize|avan\u00E7ados|mem\u00F3ria)/i,
        /(?:\u5347\u7EA7\u5957\u9910|\u8BA2\u9605\u5957\u9910|\u514D\u8D39\u8BD5\u7528|\u5347\u7EA7\u81F3 Plus|\u5347\u7EA7\u81F3 Pro).{0,160}(?:\u6A21\u578B|\u63A8\u7406|\u4EE3\u7801|\u6570\u5B66|\u7406\u79D1|\u529F\u80FD|\u8BB0\u5FC6|\u56FE\u50CF|\u989D\u5EA6)/i,
        /(?:upgrade to plus|upgrade to pro|try plus free|try pro free).{0,140}(?:reasoning|debug|coding|math|science|advanced models|memory)/i
    ];

    const SEMANTIC_PROMO_RE = /(?:banner|upsell|promo|promotion|upgrade|trial)/i;

    function inLabelList(text, list) {
        const value = normalize(text).toLowerCase();
        if (!value) return false;
        return list.indexOf(value) !== -1;
    }

    function isTrialLabel(text) {
        return TRIAL_CTA_RE.test(normalize(text)) || inLabelList(text, TRIAL_LABELS);
    }

    function isOfferLabel(text) {
        return OFFER_CTA_RE.test(normalize(text)) || inLabelList(text, OFFER_LABELS);
    }

    function isUpgradeLabel(text) {
        return UPGRADE_CTA_RE.test(normalize(text)) || inLabelList(text, UPGRADE_LABELS);
    }

    /* ------------------------------------------------------------------
     * 3) Selectors and safety rails
     * ------------------------------------------------------------------ */

    // Anything that counts as real chat content. Never hide these, and never
    // hide a container that holds one of them.
    const EXCLUDED_SELECTOR = [
        'article',
        '[data-message-author-role]',
        '[data-testid*="conversation-turn"]',
        '[data-testid="message-content"]',
        '.markdown',
        '[class*="MarkdownRoot"]',
        '[class~="group/user-message"]',
        '[data-user-message-bubble]',
        '[data-virtualized-turn-content]'
    ].join(',');

    // Page skeleton. Hiding any container that holds one of these blanks the page.
    const SAFE_ANCHOR_SELECTOR = [
        'main',
        '#prompt-textarea',
        'textarea[placeholder]',
        '[contenteditable="true"]',
        'article',
        '[data-message-author-role]',
        '[data-testid*="conversation-turn"]',
        '[data-testid="message-content"]',
        '.markdown',
        '[class*="MarkdownRoot"]',
        '[class*="thread-scroll"]',
        '[container-name="thread-content"]'
    ].join(',');

    // The composer and its form: never hide anything that contains them.
    const COMPOSER_ANCHOR = '[contenteditable="true"], #prompt-textarea, form';

    // Only these can be an ad block on their own. Sweeping every div on the
    // page was far too expensive while a reply is streaming in.
    const SWEEP_SELECTOR = 'button, a, [role="button"], [role="status"], [role="alert"], [data-testid]';

    const BLOCK_SELECTOR = [
        'button',
        'a',
        '[role="button"]',
        'div',
        'section',
        'aside',
        'p',
        '[role="alert"]',
        '[role="status"]',
        '[data-testid]'
    ].join(',');

    // Below this height an element is considered a small UI block, not a page region.
    const MAX_HIDE_HEIGHT = 320;

    function normalize(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function getText(el) {
        return normalize(el.innerText || el.textContent);
    }

    function getLabels(el) {
        return [
            el.innerText,
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.getAttribute('data-testid')
        ].map(normalize).filter(Boolean);
    }

    function isOfferButtonLabel(label) {
        const text = normalize(label);

        if (!text || text.length > 32) {
            return false;
        }

        if (OFFER_TEXT_HINTS.some(hint => text.includes(hint))) {
            return true;
        }

        return isOfferLabel(text);
    }

    function isPromoCTA(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        if (!el.matches('button, a, [role="button"]')) {
            return false;
        }

        return getLabels(el).some(label =>
            isTrialLabel(label) ||
            isOfferButtonLabel(label) ||
            isUpgradeLabel(label)
        );
    }

    function hasPromoCopy(el) {
        if (isPromoCTA(el)) {
            return true;
        }

        const text = getText(el);

        if (text.length < 12 || text.length > MAX_TEXT_LENGTH) {
            return false;
        }

        return PROMO_PATTERNS.some(pattern => pattern.test(text));
    }

    function hasPromoSemantic(el) {
        const signature = [
            el.id,
            typeof el.className === 'string' ? el.className : '',
            el.getAttribute('data-testid'),
            el.getAttribute('role')
        ].filter(Boolean).join(' ');

        return SEMANTIC_PROMO_RE.test(signature);
    }

    function hasPromoAction(el) {
        const controls = el.querySelectorAll('button, a, [role="button"]');

        return Array.from(controls).some(control => {
            if (isPromoCTA(control)) {
                return true;
            }

            return getLabels(control).some(label =>
                isUpgradeLabel(label) ||
                isOfferLabel(label) ||
                isTrialLabel(label)
            );
        });
    }

    function isExcluded(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        // Check ancestors AND descendants: a wrapper may contain a message bubble
        // without being a message itself.
        try {
            if (el.closest(EXCLUDED_SELECTOR)) return true;
            if (el.querySelector(EXCLUDED_SELECTOR)) return true;
        } catch (e) {
            return true;
        }

        return false;
    }

    function canHideElement(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        if (el === document.body || el === document.documentElement) return false;
        if (el.tagName === 'MAIN' || el.tagName === 'HTML' || el.tagName === 'BODY') return false;
        if (isExcluded(el)) return false;

        try {
            if (el.matches(SAFE_ANCHOR_SELECTOR)) return false;
            if (el.querySelector(SAFE_ANCHOR_SELECTOR)) return false;
        } catch (e) {
            return false;
        }

        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { height: 0 };
        if (rect && rect.height > MAX_HIDE_HEIGHT) return false;

        return true;
    }

    // Hide with three independent mechanisms. A stylesheet alone can be blocked
    // by the site CSP or by a userscript sandbox; an inline style cannot.
    function hideElement(el) {
        if (!canHideElement(el)) return false;

        try {
            el.setAttribute(HIDDEN_ATTR, '1');
        } catch (e) { /* ignore */ }

        try {
            el.style.setProperty('display', 'none', 'important');
        } catch (e) { /* ignore */ }

        return true;
    }

    // Last resort for promo buttons that sit inside a message container.
    // We hide the button (and a small wrapper around it) but stop at the
    // message body, so the answer text is never touched.
    function forceHidePromoControl(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        let target = el;
        let parent = el.parentElement;
        let depth = 0;

        while (
            parent &&
            parent !== document.body &&
            parent !== document.documentElement &&
            parent.tagName !== 'MAIN' &&
            depth < 3
        ) {
            try {
                if (parent.matches(EXCLUDED_SELECTOR)) break;
            } catch (e) {
                break;
            }

            const rect = parent.getBoundingClientRect();

            if (rect && rect.height > 200) break;
            if (getText(parent).length > 160) break;
            if (parent.querySelectorAll('button, a, [role="button"]').length > 1) break;

            try {
                if (parent.querySelector(COMPOSER_ANCHOR)) break;
            } catch (e) {
                break;
            }

            target = parent;
            parent = parent.parentElement;
            depth++;
        }

        if (target === document.body || target === document.documentElement || target.tagName === 'MAIN') {
            return false;
        }

        const rect = target.getBoundingClientRect();

        if (rect && rect.height > 400) {
            return false;
        }

        try {
            target.setAttribute(HIDDEN_ATTR, '1');
            target.style.setProperty('display', 'none', 'important');
            return true;
        } catch (e) {
            return false;
        }
    }

    /* ------------------------------------------------------------------
     * 4) Cleanup rules
     * ------------------------------------------------------------------ */

    function hideButtonAndEmptyWrapper(el) {
        let target = el;
        let parent = el.parentElement;
        let depth = 0;

        while (
            parent &&
            parent !== document.body &&
            parent !== document.documentElement &&
            parent.tagName !== 'MAIN' &&
            depth < 2
        ) {
            if (isExcluded(parent)) break;
            if (getText(parent) !== getText(el)) break;
            if (parent.children.length !== 1) break;
            if (parent.querySelectorAll('button, a, [role="button"]').length > 1) break;

            target = parent;
            parent = parent.parentElement;
            depth++;
        }

        return hideElement(target);
    }

    // "ChatGPT can make mistakes. Check important info." line.
    function hideDisclaimers(root) {
        if (!root || !root.textContent) {
            return;
        }

        if (!/\u53EF\u80FD\u4F1A\u51FA\u9519|\u53EF\u80FD\u4F1A\u72AF\u9519|can make mistakes|mistake|error|erro|erreur|fehler|errore|\u043E\u0448\u0438\u0431|\u9593\u9055|\uC2E4\uC218/i.test(root.textContent)) {
            return;
        }

        const elements = [];

        if (root.nodeType === Node.ELEMENT_NODE && root.matches('div, p, span')) {
            elements.push(root);
        }

        if (root.querySelectorAll) {
            elements.push(...root.querySelectorAll('div, p, span'));
        }

        for (const el of elements) {
            if (!el.isConnected) continue;
            if (isExcluded(el)) continue;

            const text = getText(el);

            if (!DISCLAIMER_RE.test(text) && !DISCLAIMER_GENERIC_RE.test(text)) continue;

            const isLeaf = el.childElementCount === 0 || (
                el.childElementCount === 1 &&
                el.firstElementChild.tagName === 'SPAN' &&
                el.firstElementChild.childElementCount === 0
            );

            if (!isLeaf) continue;

            hideElement(el);

            let node = el;

            for (let depth = 0; depth < 4; depth++) {
                const parent = node.parentElement;

                if (!parent) break;
                if (parent === document.body || parent === document.documentElement) break;
                if (parent.tagName === 'MAIN') break;
                if (isExcluded(parent)) break;
                if (getText(parent) !== text) break;

                const signature = typeof parent.className === 'string' ? parent.className : '';

                if (/container-type|thread-scroll/i.test(signature)) break;
                if (parent.getBoundingClientRect().height > 200) break;

                hideElement(parent);
                node = parent;
            }
        }
    }

    // "Try Plus free", "Claim offer", "Get offer" buttons.
    function hideOfferButtons(root) {
        if (!root) {
            return;
        }

        const controls = [];

        if (
            root.nodeType === Node.ELEMENT_NODE &&
            root.matches('button, a, [role="button"], [role="menuitem"]')
        ) {
            controls.push(root);
        }

        if (root.querySelectorAll) {
            controls.push(...root.querySelectorAll('button, a, [role="button"], [role="menuitem"]'));
        }

        for (const el of controls) {
            if (!el.isConnected) continue;

            const isPromo = getLabels(el).some(label =>
                isTrialLabel(label) ||
                isOfferButtonLabel(label) ||
                isUpgradeLabel(label)
            );

            if (!isPromo) continue;

            if (isExcluded(el)) {
                forceHidePromoControl(el);
                continue;
            }

            if (!hideButtonAndEmptyWrapper(el)) {
                forceHidePromoControl(el);
            }
        }
    }

    // "Free" badge under the user name.
    function hidePlanBadges(root) {
        if (!root) {
            return;
        }

        const candidates = [];

        if (root.nodeType === Node.ELEMENT_NODE && root.matches('span, div')) {
            candidates.push(root);
        }

        if (root.querySelectorAll) {
            candidates.push(...root.querySelectorAll('span, div'));
        }

        for (const el of candidates) {
            if (!el.isConnected) continue;
            if (el.children.length) continue;
            if (isExcluded(el)) continue;

            const text = getText(el);

            if (!PLAN_BADGE_RE.test(text)) continue;

            // Only inside the profile button, the sidebar or an account menu,
            // so a message that happens to contain the word "Free" is safe.
            if (!el.closest([
                'button[aria-label*="\u8D44\u6599"]',
                'button[aria-label*="profile" i]',
                'button[aria-label*="account" i]',
                'button[data-testid*="profile" i]',
                'nav',
                '[role="menu"]',
                '[role="dialog"]',
                '[class*="sidebar"]',
                '[class*="Sidebar"]'
            ].join(','))) {
                continue;
            }

            const parent = el.parentElement;

            if (
                parent &&
                getText(parent) === text &&
                !parent.querySelectorAll('button, a, [role="button"]').length
            ) {
                hideElement(parent);
            } else {
                hideElement(el);
            }
        }
    }

    // "Get Plus for more uploads / or wait N hours" row inside the "+" menu.
    function hideUploadLimitRows(root) {
        if (!root || !root.textContent) {
            return;
        }

        if (!UPLOAD_LIMIT_RE.test(root.textContent)) {
            return;
        }

        const rows = root.querySelectorAll
            ? [...root.querySelectorAll('button, a, [role="button"], [role="menuitem"], [data-menu-row-content], li')]
            : [];

        for (const row of rows) {
            if (!row.isConnected) continue;

            const text = getText(row);

            if (!UPLOAD_LIMIT_RE.test(text) || text.length > 120) continue;

            let target = row;
            let node = row;

            for (let depth = 0; depth < 3; depth++) {
                const parent = node.parentElement;

                if (!parent) break;
                if (parent === document.body || parent === document.documentElement) break;
                if (!UPLOAD_LIMIT_RE.test(getText(parent))) break;
                if (parent.getBoundingClientRect().height > 90) break;

                target = parent;
                node = parent;
            }

            hideElement(target);
        }
    }

    // The promo card above the composer ("Upgrade to Plus ..." + "Try Plus free").
    // It lives next to the text box, so we must stop before the composer.
    function hideComposerPromo(root) {
        if (!root || !root.querySelectorAll) {
            return;
        }

        const matches = el => {
            const text = getText(el);

            if (text.length < 10 || text.length > MAX_TEXT_LENGTH) {
                return false;
            }

            if (!PROMO_PATTERNS.some(pattern => pattern.test(text))) {
                return false;
            }

            // Plain text alone is not enough: a chat message may quote the ad.
            // Require a promo button, or a status/alert card.
            return hasPromoAction(el) ||
                !!el.closest('[role="status"], [role="alert"]') ||
                hasPromoSemantic(el);
        };

        const candidates = [...root.querySelectorAll('div, section, aside, p')].filter(matches);

        for (const el of candidates) {
            if (!el.isConnected || isExcluded(el)) continue;
            if (el.closest('[data-virtualized-turn-content], article, [data-message-author-role]')) continue;
            if ([...el.children].some(child => matches(child))) continue;

            let target = el;
            let node = el;

            for (let depth = 0; depth < 6; depth++) {
                const parent = node.parentElement;

                if (!parent) break;
                if (parent === document.body || parent === document.documentElement) break;
                if (parent.tagName === 'MAIN') break;
                if (isExcluded(parent)) break;

                try {
                    if (parent.matches(COMPOSER_ANCHOR) || parent.querySelector(COMPOSER_ANCHOR)) break;
                } catch (e) {
                    break;
                }

                if (parent.getBoundingClientRect().height > 400) break;

                target = parent;
                node = parent;
            }

            hideElement(target);
        }
    }

    function findRemovalTarget(el) {
        let current = el;
        let fallback = isPromoCTA(el) ? el : null;

        for (let depth = 0; current && depth < 7; depth++) {
            if (
                current === document.body ||
                current === document.documentElement ||
                current.tagName === 'MAIN'
            ) {
                break;
            }

            if (current.matches(EXCLUDED_SELECTOR) || current.closest(EXCLUDED_SELECTOR)) {
                return null;
            }

            const text = getText(current);

            if (depth > 0 && text.length > MAX_TEXT_LENGTH) {
                break;
            }

            try {
                if (current.matches(COMPOSER_ANCHOR) || current.querySelector(COMPOSER_ANCHOR)) {
                    break;
                }
            } catch (e) {
                break;
            }

            if (
                depth > 0 &&
                text.length >= 12 &&
                (
                    current.matches('[role="alert"], [role="status"]') ||
                    hasPromoSemantic(current)
                )
            ) {
                return current;
            }

            const controls = current.querySelectorAll('button, a, [role="button"]');

            if (
                depth > 0 &&
                text.length <= 280 &&
                controls.length <= 2 &&
                hasPromoAction(current)
            ) {
                return current;
            }

            if (
                !fallback &&
                /^(DIV|SECTION|ASIDE|P)$/.test(current.tagName) &&
                text.length >= 12 &&
                hasPromoCopy(current) &&
                (
                    hasPromoAction(current) ||
                    current.matches('[role="status"], [role="alert"]') ||
                    hasPromoSemantic(current)
                )
            ) {
                fallback = current;
            }

            current = current.parentElement;
        }

        return fallback;
    }

    /* ------------------------------------------------------------------
     * 4b) Rules that do not depend on the page language
     *
     * The same blocks exist in every language, so instead of matching their
     * words we match their place in the page. This keeps the script working
     * when the ChatGPT interface is not English or Chinese.
     * ------------------------------------------------------------------ */

    // The profile button at the bottom of the sidebar: holds an avatar image.
    let cachedProfile = null;

    function findProfileButton() {
        if (cachedProfile && cachedProfile.isConnected) return cachedProfile;

        const buttons = document.querySelectorAll('button[aria-haspopup="menu"], button[aria-expanded]');
        let best = null;

        for (const btn of buttons) {
            if (!btn.getClientRects().length) continue;
            if (!btn.querySelector('img')) continue;

            const rect = btn.getBoundingClientRect();

            if (rect.width < 100) continue;
            if (rect.top < window.innerHeight * 0.55) continue;

            if (!best || rect.top > best.getBoundingClientRect().top) {
                best = btn;
            }
        }

        cachedProfile = best;
        return best;
    }

    // Second line inside the profile button = the plan badge ("Free",
    // "Gratis", "\u514D\u8D39\u7248", "\u7121\u6599"...). Its wording does not matter.
    function hidePlanBadgeUnderProfile(profile) {
        if (!profile) return false;

        const containers = profile.querySelectorAll('span, div');

        for (const container of containers) {
            if (container.children.length !== 2) continue;

            const name = container.children[0];
            const badge = container.children[1];

            if (!normalize(name.textContent) || !normalize(badge.textContent)) continue;
            if (badge.querySelector('button, img')) continue;

            const text = normalize(badge.textContent);
            if (text.length > 24) continue;

            const rect = badge.getBoundingClientRect();
            if (!rect.height || rect.height > 30) continue;

            return hideElement(badge);
        }

        return false;
    }

    // The round offer button that sits right above the profile row.
    function hideSidebarOfferSlot(profile) {
        if (!profile) return false;

        const top = profile.getBoundingClientRect().top;

        for (const block of document.querySelectorAll('div[class*="col-span-full"]')) {
            const controls = block.querySelectorAll('button, a');

            if (controls.length !== 1) continue;

            const rect = block.getBoundingClientRect();

            if (!rect.height || rect.height > 80) continue;
            if (rect.bottom > top - 2) continue;
            if (top - rect.bottom > 48) continue;

            return hideElement(block);
        }

        return false;
    }

    // Small "Upgrade / Subscribe" chip that can appear inside the sidebar rows
    // next to the user name. Its wording changes, so we only require a short
    // label that talks about a plan.
    const CHIP_UPSELL_RE = /(?:\u5347\u7EA7|\u8BA2\u9605|\u83B7\u53D6|plus|pro|upgrade|subscribe|abonn|suscrib|assin|abbon|\u30A2\u30C3\u30D7\u30B0\u30EC\u30FC\u30C9|\uAD6C\uB3C5|\u043F\u043E\u0434\u043F\u0438\u0441)/i;

    function hideSidebarUpsellChips(profile) {
        if (!profile) return;

        const scope = profile.closest('nav, aside, [class*="sidebar"]') || profile.parentElement;

        if (!scope) return;

        const rows = scope.querySelectorAll('[class*="sidebar-item"]');

        for (const row of rows) {
            for (const btn of row.querySelectorAll('button, a')) {
                if (!btn.getClientRects().length) continue;
                if (isExcluded(btn)) continue;

                const text = normalize(btn.textContent);

                if (!text || text.length > 24) continue;
                if (!CHIP_UPSELL_RE.test(text)) continue;

                hideElement(btn);
            }
        }
    }

    // The "free plan" reminder pill in the top bar has a small close (X)
    // button. Its accessible name is the only language-neutral hook we have,
    // so we match the "close ... reminder / upgrade / offer" wording and hide
    // the whole pill around it.
    const DISMISS_UPSELL_RE =
        /(?:close|dismiss|cerrar|fechar|schlie\u00DFen|schliessen|fermer|chiudi|sluiten|zamknij|kapat|\u0111\u00F3ng|\u0E1B\u0E34\u0E14|\u0625\u063A\u0644\u0627\u0642|\u092C\u0902\u0926 \u0915\u0930\u0947\u0902).{0,50}(?:reminder|upgrade|offer|plan|promo|recordatorio|mejorar|lembrete|erinnerung|rappel|promemoria|aanbieding|ofert|teklif|\u01B0u \u0111\u00E3i|\u0E02\u0E49\u0E2D\u0E40\u0E2A\u0E19\u0E2D|\u0627\u0644\u0639\u0631\u0636|\u0911\u092B\u093C\u0930)|(?:\u5173\u95ED|\u5173\u95ED\u5347\u7EA7|\u5173\u95ED\u4F18\u60E0|\u5173\u95ED\u63D0\u9192)/i;

    function hideUpsellReminders(root) {
        if (!root || !root.querySelectorAll) return;

        for (const control of root.querySelectorAll('button[aria-label]')) {
            if (!control.isConnected) continue;
            if (!control.getClientRects().length) continue;

            const label = control.getAttribute('aria-label') || '';

            if (!DISMISS_UPSELL_RE.test(label)) continue;
            if (isExcluded(control)) continue;

            let target = control.parentElement;

            if (!target) continue;
            if (isExcluded(target)) continue;

            const rect = target.getBoundingClientRect();

            if (!rect.height || rect.height > 60) continue;
            if (target.querySelectorAll('button').length > 2) continue;

            hideElement(target);
        }
    }

    // Small status/alert card that carries a promo button: the "you are on the
    // free plan" banner in any language.
    function hideStatusPromoCards(root) {
        if (!root || !root.querySelectorAll) return;

        const cards = root.querySelectorAll('[role="status"], [role="alert"]');

        for (const card of cards) {
            if (!card.isConnected) continue;
            if (!card.getClientRects().length) continue;
            if (isExcluded(card)) continue;
            if (card.closest('button, nav, [class*="sidebar"], [class*="Sidebar"]')) continue;

            const rect = card.getBoundingClientRect();

            if (!rect.height || rect.height > 170) continue;
            if (normalize(card.textContent).length > 400) continue;
            if (!hasPromoAction(card)) continue;

            if (hideElement(card)) continue;

            const control = card.querySelector('button, a, [role="button"]');

            if (control && isPromoCTA(control)) {
                forceHidePromoControl(control);
            }
        }
    }

    /* ------------------------------------------------------------------
     * 4c) Turn "Think" on automatically
     *
     * Free accounts get the "Think" toggle in the composer, but it starts
     * off on every new chat. We switch it on once per composer, and never
     * argue with the user: if they turn it off by hand we leave it alone
     * until the composer is re-created.
     * ------------------------------------------------------------------ */
    const THINK_LABELS = [
        '\u601D\u8003', 'think', 'pensar', 'r\u00E9fl\u00E9chir', 'reflechir', 'denken', 'pensare', 'ragiona',
        '\u8003\u3048\u308B', '\uC0DD\uAC01', '\u0440\u0430\u0437\u043C\u044B\u0448\u043B\u0435\u043D\u0438\u0435', '\u0434\u0443\u043C\u0430\u0442\u044C', 'nadenken', 'my\u015Bl', 'd\u00FC\u015F\u00FCn', 'berpikir',
        'suy ngh\u0129', '\u0E04\u0E34\u0E14', '\u062A\u0641\u0643\u064A\u0631', '\u0938\u094B\u091A\u0947\u0902'
    ];

    const thinkAttempts = new WeakMap();

    function autoEnableThinking() {
        const buttons = document.querySelectorAll('form button[aria-pressed="false"]');

        for (const btn of buttons) {
            if (!btn.getClientRects().length) continue;
            if (btn.disabled) continue;

            const text = normalize(btn.textContent).toLowerCase();

            if (!text) continue;
            if (THINK_LABELS.indexOf(text) === -1) continue;
            if (!btn.closest('form')) continue;

            const attempts = thinkAttempts.get(btn) || 0;

            if (attempts >= 3) continue;

            thinkAttempts.set(btn, attempts + 1);

            try {
                btn.click();
                console.info(LOG_PREFIX + ' thinking mode on');
            } catch (e) { /* ignore */ }
        }
    }

    function scanRoot(root, deep) {
        if (state.paused) return;
        if (!root || !root.isConnected) return;

        const started = Date.now();
        const full = !!deep || root === document.body;

        stats.scans++;

        hideOfferButtons(root);
        hideComposerPromo(root);
        hideStatusPromoCards(root);
        hideUpsellReminders(root);
        hideUploadLimitRows(root);

        // These two walk a lot of text. On a huge root they only run during a
        // full pass; on a small subtree they always run.
        if (full || root !== document.body) {
            hidePlanBadges(root);
            hideDisclaimers(root);
        }

        const profile = findProfileButton();

        if (profile) {
            hidePlanBadgeUnderProfile(profile);
            hideSidebarOfferSlot(profile);
            hideSidebarUpsellChips(profile);
        }

        autoEnableThinking();

        const elements = [];

        if (root.nodeType === Node.ELEMENT_NODE && root.matches(SWEEP_SELECTOR)) {
            elements.push(root);
        }

        if (root.querySelectorAll) {
            elements.push(...root.querySelectorAll(SWEEP_SELECTOR));
        }

        for (const el of elements) {
            if (!el.isConnected) continue;
            if (el.getAttribute(HIDDEN_ATTR) === '1') continue;
            if (isExcluded(el)) continue;
            if (!hasPromoCopy(el)) continue;

            const target = findRemovalTarget(el);

            const ok = target &&
                target.isConnected &&
                target !== document.body &&
                target !== document.documentElement &&
                target.tagName !== 'MAIN' &&
                !isExcluded(target) &&
                hideElement(target);

            if (!ok && el.isConnected && el !== target && !el.closest(EXCLUDED_SELECTOR)) {
                hideElement(el);
            }
        }

        stats.lastScanMs = Date.now() - started;
    }

    /* ------------------------------------------------------------------
     * 5) Watching for new content
     * ------------------------------------------------------------------ */

    let timer = null;
    const pendingRoots = new Set();

    function queueScan(node) {
        if (!node || state.paused) return;

        let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

        if (!el) return;

        // A streaming reply changes the DOM hundreds of times per second and
        // never contains an ad. Skipping that subtree is what keeps the page
        // responsive; if a button shows up inside a message we still look.
        const inMessage = el.closest ? el.closest(EXCLUDED_SELECTOR) : null;

        if (inMessage && !(el.querySelector && el.querySelector('button, a, [role="button"]'))) {
            return;
        }

        let depth = 0;

        while (
            el &&
            el !== document.body &&
            el !== document.documentElement &&
            !el.matches(BLOCK_SELECTOR) &&
            depth < 8
        ) {
            el = el.parentElement;
            depth++;
        }

        if (!el) {
            pendingRoots.add(document.body);
        } else {
            for (const queued of pendingRoots) {
                if (queued === document.body || queued === el || queued.contains(el)) {
                    return;
                }
            }

            for (const queued of [...pendingRoots]) {
                if (el.contains(queued)) {
                    pendingRoots.delete(queued);
                }
            }

            pendingRoots.add(el);
        }

        if (timer !== null) return;

        timer = window.setTimeout(() => {
            timer = null;

            const roots = [...pendingRoots];
            pendingRoots.clear();

            const fullPass = roots.indexOf(document.body) !== -1 && roots.length === 1;

            for (const root of roots) {
                scanRoot(root, fullPass);
            }

            logStatus('scan finished');
        }, 400);
    }

    function injectStyle() {
        if (!document.documentElement) return;

        const style = document.createElement('style');
        style.textContent = `
            [data-chgpt-hidden="1"] {
                display: none !important;
            }

            .composer-disclaimer,
            .composer-disclaimer-above,
            [data-testid="disclaimer"],
            [data-testid="composer-disclaimer"] {
                display: none !important;
            }
        `;

        try {
            (document.head || document.documentElement).appendChild(style);
        } catch (e) { /* blocked by CSP: the inline styles still work */ }
    }

    function stampVersion() {
        try {
            document.documentElement.setAttribute('data-chgpt-script', VERSION);
        } catch (e) { /* ignore */ }
    }

    let lastLoggedCount = -1;
    let lastStatusCheckAt = 0;

    function logStatus() {
        try {
            const now = Date.now();

            // This function is called after scans, potentially many times. Avoid
            // querying the entire document on every call just to update diagnostics.
            if (now - lastStatusCheckAt < 10000) return;
            lastStatusCheckAt = now;

            const count = document.querySelectorAll('[' + HIDDEN_ATTR + '="1"]').length;
            document.documentElement.setAttribute('data-chgpt-hidden-count', String(count));

            // Log only when the count changes, and check that count at most every 10s.
            if (count === lastLoggedCount) return;
            lastLoggedCount = count;

            console.info(
                LOG_PREFIX + ' v' + VERSION + ' running, hidden: ' + count +
                ' (' + stats.scans + ' scans, last ' + stats.lastScanMs + 'ms)'
            );
        } catch (e) { /* ignore */ }
    }

    function start() {
        stampVersion();

        // Small handle so the user can stop it from the console if a page
        // ever feels slow: __chgptCleaner.pause()
        try {
            window.__chgptCleaner = {
                version: VERSION,
                stats,
                pause() { state.paused = true; },
                resume() {
                    state.paused = false;
                    cachedProfile = null;
                    queueScan(document.body);
                }
            };
        } catch (e) { /* ignore */ }
        logStatus('startup');
        injectStyle();

        const begin = () => {
            scanRoot(document.body, true);
            logStatus('first scan');

            // Only watch DOM insertions. Observing every inline style change across
            // the page creates extra callbacks during React layout/streaming updates.
            // The injected CSS rule keeps marked elements hidden after re-renders.
            const observer = new MutationObserver(records => {
                for (const record of records) {
                    if (record.type !== 'childList') continue;

                    for (const node of record.addedNodes) {
                        if (
                            node.nodeType === Node.ELEMENT_NODE ||
                            node.nodeType === Node.TEXT_NODE
                        ) {
                            queueScan(node);
                        }
                    }
                }
            });

            observer.observe(document.body, {
                subtree: true,
                childList: true
            });

            // Re-scan after an in-page navigation.
            const rescan = () => {
                cachedProfile = null;
                queueScan(document.body);
            };

            for (const method of ['pushState', 'replaceState']) {
                const original = history[method];

                history[method] = function (...args) {
                    const result = original.apply(this, args);
                    window.setTimeout(rescan, 300);
                    return result;
                };
            }

            window.addEventListener('popstate', rescan);

            // autoEnableThinking() also runs during the initial and mutation-triggered
            // scans, so a permanent polling timer is unnecessary.
        };

        // Wait until ChatGPT has rendered once, so we never break the first paint.
        const deadline = Date.now() + 8000;

        const tick = () => {
            const hasComposer = !!document.querySelector('[contenteditable="true"]');
            const hasMessages =
                document.querySelectorAll('[data-user-message-bubble]').length > 0 ||
                document.querySelectorAll('[class*="MarkdownRoot"]').length > 0;

            const thread = document.querySelector(
                '[class*="thread-scroll"], [container-name="thread-content"]'
            );

            const hasThreadText = !!thread && (thread.innerText || '').trim().length > 50;
            const isHome = location.pathname === '/' && document.querySelectorAll('button').length > 20;

            if (hasComposer && (hasMessages || hasThreadText || isHome)) {
                window.setTimeout(begin, 500);
                return;
            }

            if (Date.now() > deadline) {
                begin();
                return;
            }

            window.setTimeout(tick, 250);
        };

        tick();
    }

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
