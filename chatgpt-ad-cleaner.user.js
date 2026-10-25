// ==UserScript==
// @name         ChatGPT Ad Cleaner
// @namespace    io.github.free6589.chatgpt-ad-cleaner
// @version      2.0.0
// @description  Hides the upgrade ads, free-trial buttons, "Free" plan badge and disclaimer on chatgpt.com, and restores the normal file-upload menu.
// @author       free6589
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '2.0.0';
    const HIDDEN_ATTR = 'data-chgpt-hidden';
    const LOG_PREFIX = '[ChatGPT Ad Cleaner]';

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
        return /\/backend-api\/conversation(\/|$|\?)/.test(String(url || ''));
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
        /(?:\u8BA2\u9605\s*(?:Plus|Business)\s*[\uFF0C,]\s*\u83B7\u5F97\u66F4\u591A\u4E0A\u4F20\u989D\u5EA6|\u6216\u7B49\u5F85.{0,16}\u540E\u518D\u4E0A\u4F20|get\s+(?:plus|business)\s+for\s+more\s+uploads|upload\s+limit\s+reached)/i;

    const DISCLAIMER_RE =
        /^(?:chatgpt\s*)?(?:\u53EF\u80FD\u4F1A\u51FA\u9519|\u53EF\u80FD\u4F1A\u72AF\u9519)[\uFF0C,\u3002.!\uFF01]?\s*(?:\u8BF7\u6838\u67E5\u91CD\u8981\u4FE1\u606F|\u8BF7\u6838\u5BF9\u91CD\u8981\u4FE1\u606F|\u8BF7\u6838\u5B9E\u91CD\u8981\u4FE1\u606F)[\u3002.!\uFF01]?$|^chatgpt(?:\s+is\s+ai\s+and)?\s+can\s+make\s+mistakes[.,\uFF0C\u3002!\uFF01]?\s*check\s+important\s+info[.!\uFF01\u3002]?$/i;

    const PROMO_PATTERNS = [
        /\u4F60\u6B63\u5728\u4F7F\u7528\s*ChatGPT\s*(?:\u514D\u8D39\u7248|\u514D\u8D39\u8BA1\u5212|\u514D\u8D39\u5957\u9910).{0,220}(?:\u5347\u7EA7|\u9AD8\u7EA7\u6A21\u578B|\u8BB0\u5FC6|\u56FE\u50CF)/i,
        /(?:\u4F60\u6B63\u5728\u4F7F\u7528|\u4F60\u5F53\u524D\u4F7F\u7528\u7684\u662F|\u5F53\u524D\u6B63\u5728\u4F7F\u7528).{0,40}(?:\u514D\u8D39\u7248|\u514D\u8D39\u8BA1\u5212|\u514D\u8D39\u5957\u9910).{0,180}(?:\u5347\u7EA7|\u9AD8\u7EA7\u6A21\u578B|\u8BB0\u5FC6|\u56FE\u50CF)/i,
        /\u63D0\u5347\u6280\u672F\u5DE5\u4F5C\u7684\u51C6\u786E\u6027/i,
        /(?:\u63D0\u5347|\u63D0\u9AD8|\u6539\u5584).{0,35}(?:\u6280\u672F\u5DE5\u4F5C|\u5DE5\u4F5C\u6548\u7387|\u51C6\u786E\u6027).{0,120}(?:\u5347\u7EA7|Plus|Pro|\u589E\u5F3A\u63A8\u7406)/i,
        /(?:\u5347\u7EA7\u81F3|\u5347\u7EA7\u5230|\u5347\u7EA7)\s*(?:ChatGPT\s*)?(?:Plus|Pro).{0,220}(?:\u589E\u5F3A\u63A8\u7406|\u8C03\u8BD5\u4EE3\u7801|\u68B3\u7406\u7CFB\u7EDF|\u6570\u5B66|\u7406\u79D1\u95EE\u9898|\u7F16\u7A0B|\u63A8\u7406\u80FD\u529B)/i,
        /(?:\u589E\u5F3A\u63A8\u7406|\u8C03\u8BD5\u4EE3\u7801|\u68B3\u7406\u7CFB\u7EDF).{0,140}(?:\u5347\u7EA7\u81F3|\u5347\u7EA7\u5230|\u5347\u7EA7|Plus|Pro|\u6570\u5B66|\u7406\u79D1\u95EE\u9898)/i,
        /(?:\u5347\u7EA7|\u8BA2\u9605|\u514D\u8D39\u8BD5\u7528|\u5F00\u59CB\u8BD5\u7528).{0,160}(?:\u9AD8\u7EA7\u6A21\u578B|\u66F4\u5F3A\u7684\u8BB0\u5FC6\u529F\u80FD|\u66F4\u5927\u7684\u8BB0\u5FC6\u5BB9\u91CF|\u66F4\u9AD8\u8D28\u91CF\u7684\u56FE\u50CF|\u751F\u6210\u66F4\u9AD8\u8D28\u91CF\u7684\u56FE\u50CF|\u66F4\u591A\u6D88\u606F|\u66F4\u9AD8\u7684\u4F7F\u7528\u9650\u989D|\u589E\u5F3A\u63A8\u7406|\u8C03\u8BD5\u4EE3\u7801|\u68B3\u7406\u7CFB\u7EDF|\u6570\u5B66\u6216\u7406\u79D1\u95EE\u9898)/i,
        /(?:\u9AD8\u7EA7\u6A21\u578B|\u66F4\u5F3A\u7684\u8BB0\u5FC6\u529F\u80FD|\u66F4\u5927\u7684\u8BB0\u5FC6\u5BB9\u91CF|\u66F4\u9AD8\u8D28\u91CF\u7684\u56FE\u50CF|\u589E\u5F3A\u63A8\u7406|\u8C03\u8BD5\u4EE3\u7801|\u68B3\u7406\u7CFB\u7EDF|\u6570\u5B66\u6216\u7406\u79D1\u95EE\u9898).{0,160}(?:\u5347\u7EA7|\u8BA2\u9605|\u514D\u8D39\u8BD5\u7528|Plus|Pro)/i,
        /(?:you(?:'|\u2019)re using|you are using|you(?:'|\u2019)re on|you are on).{0,50}(?:ChatGPT\s*)?(?:Free plan|Free tier).{0,180}(?:upgrade|advanced models|memory|images|limits)/i,
        /(?:upgrade to use|upgrade to access|upgrade for|try Plus|try Pro|start a free trial).{0,160}(?:advanced models|reasoning|debug code|coding|math|science|memory|higher.?quality images|more messages|higher limits)/i,
        /(?:\u5347\u7EA7\u5957\u9910|\u8BA2\u9605\u5957\u9910|\u514D\u8D39\u8BD5\u7528|\u5347\u7EA7\u81F3 Plus|\u5347\u7EA7\u81F3 Pro).{0,160}(?:\u6A21\u578B|\u63A8\u7406|\u4EE3\u7801|\u6570\u5B66|\u7406\u79D1|\u529F\u80FD|\u8BB0\u5FC6|\u56FE\u50CF|\u989D\u5EA6)/i
    ];

    const SEMANTIC_PROMO_RE = /(?:banner|upsell|promo|promotion|upgrade|trial)/i;

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

        if (!text || text.length > 12) {
            return false;
        }

        if (OFFER_TEXT_HINTS.some(hint => text.includes(hint))) {
            return true;
        }

        return OFFER_CTA_RE.test(text);
    }

    function isPromoCTA(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        if (!el.matches('button, a, [role="button"]')) {
            return false;
        }

        return getLabels(el).some(label =>
            TRIAL_CTA_RE.test(label) ||
            isOfferButtonLabel(label) ||
            UPGRADE_CTA_RE.test(label)
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
                UPGRADE_CTA_RE.test(label) ||
                OFFER_CTA_RE.test(label)
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

        if (!/\u53EF\u80FD\u4F1A\u51FA\u9519|\u53EF\u80FD\u4F1A\u72AF\u9519|can make mistakes/i.test(root.textContent)) {
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

            if (!DISCLAIMER_RE.test(text)) continue;

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
                TRIAL_CTA_RE.test(label) ||
                isOfferButtonLabel(label)
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

    function scanRoot(root) {
        if (!root || !root.isConnected) return;

        hideDisclaimers(root);
        hideComposerPromo(root);
        hideOfferButtons(root);
        hidePlanBadges(root);
        hideUploadLimitRows(root);

        const elements = [];

        if (root.nodeType === Node.ELEMENT_NODE && root.matches(BLOCK_SELECTOR)) {
            elements.push(root);
        }

        if (root.querySelectorAll) {
            elements.push(...root.querySelectorAll(BLOCK_SELECTOR));
        }

        elements.sort((a, b) => getText(a).length - getText(b).length);

        for (const el of elements) {
            if (!el.isConnected) continue;
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
    }

    /* ------------------------------------------------------------------
     * 5) Watching for new content
     * ------------------------------------------------------------------ */

    let timer = null;
    const pendingRoots = new Set();

    function queueScan(node) {
        if (!node) return;

        let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
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

            for (const root of roots) {
                scanRoot(root);
            }

            logStatus('scan finished');
        }, 200);
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

    function logStatus(stage) {
        try {
            const count = document.querySelectorAll('[' + HIDDEN_ATTR + '="1"]').length;

            document.documentElement.setAttribute('data-chgpt-hidden-count', String(count));

            if (count === lastLoggedCount) return;

            lastLoggedCount = count;

            console.info(LOG_PREFIX + ' v' + VERSION + ' running (' + stage + '), hidden: ' + count);
        } catch (e) { /* ignore */ }
    }

    function start() {
        stampVersion();
        logStatus('startup');
        injectStyle();

        const begin = () => {
            scanRoot(document.body);
            logStatus('first scan');

            const observer = new MutationObserver(records => {
                for (const record of records) {
                    if (record.type === 'attributes') {
                        // React re-renders can drop the inline style: put it back.
                        const target = record.target;

                        if (
                            target &&
                            target.nodeType === Node.ELEMENT_NODE &&
                            target.getAttribute(HIDDEN_ATTR) === '1' &&
                            target.style.getPropertyValue('display') !== 'none'
                        ) {
                            target.style.setProperty('display', 'none', 'important');
                        }

                        continue;
                    }

                    if (record.type === 'characterData') {
                        queueScan(record.target.parentElement);
                        continue;
                    }

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
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['style']
            });

            // Re-scan after an in-page navigation.
            const rescan = () => queueScan(document.body);

            for (const method of ['pushState', 'replaceState']) {
                const original = history[method];

                history[method] = function (...args) {
                    const result = original.apply(this, args);
                    window.setTimeout(rescan, 300);
                    return result;
                };
            }

            window.addEventListener('popstate', rescan);
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
