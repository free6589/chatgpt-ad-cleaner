import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'chatgpt-ad-cleaner.user.js'), 'utf8');

function parseRegexAt(text, from) {
  const start = text.indexOf('/', from);
  assert.notEqual(start, -1, 'expected a regex literal');
  let escaped = false;
  let inClass = false;
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '[') { inClass = true; continue; }
    if (char === ']' && inClass) { inClass = false; continue; }
    if (char === '/' && !inClass) {
      let end = i + 1;
      while (/[a-z]/i.test(text[end] || '')) end++;
      return { regex: new RegExp(text.slice(start + 1, i), text.slice(i + 1, end)), end };
    }
  }
  throw new Error('unterminated regex literal');
}

function getRegex(name) {
  const declaration = source.indexOf('const ' + name + ' =');
  assert.notEqual(declaration, -1, 'missing source declaration: ' + name);
  return parseRegexAt(source, declaration).regex;
}

function getRegexArray(name) {
  const declaration = source.indexOf('const ' + name + ' = [');
  assert.notEqual(declaration, -1, 'missing source declaration: ' + name);
  const end = source.indexOf('];', declaration);
  assert.notEqual(end, -1, 'unterminated array declaration: ' + name);
  const segment = source.slice(declaration, end);
  const result = [];
  let cursor = segment.indexOf('[') + 1;
  while (cursor < segment.length) {
    const slash = segment.indexOf('/', cursor);
    if (slash === -1) break;
    const parsed = parseRegexAt(segment, slash);
    result.push(parsed.regex);
    cursor = parsed.end;
  }
  return result;
}

function assertMatches(regex, samples, description) {
  for (const sample of samples) assert.match(sample, regex, description + ' should match: ' + sample);
}
function assertDoesNotMatch(regex, samples, description) {
  for (const sample of samples) assert.doesNotMatch(sample, regex, description + ' should not match: ' + sample);
}

test('source contains expected core filters and keeps domain/path scope', () => {
  assert.match(source, /@match\s+https:\/\/chatgpt\.com\/\*/);
  assert.match(source, /@match\s+https:\/\/chat\.openai\.com\/\*/);
  assert.match(source, /function stripUploadBlock\(data\)/);
  assert.match(source, /function shouldPatch\(url\)/);
  assert.match(source, /function canHideElement\(el\)/);
  assert.match(source, /function isExcluded\(el\)/);
  assert.match(source, /data-message-author-role/);
  assert.match(source, /SAFE_ANCHOR_SELECTOR/);
});

test('trial CTA patterns match current English and Simplified Chinese labels', () => {
  assertMatches(getRegex('TRIAL_CTA_RE'), [
    'Try Plus', 'Try ChatGPT Plus for free', 'Start a free trial',
    'Free trial of ChatGPT Pro', '免费试用', '免费试用 ChatGPT Plus',
    '立即试用 Pro', '试用 ChatGPT Plus'
  ], 'trial CTA');
});

test('offer CTA patterns match current English and Simplified Chinese labels', () => {
  assertMatches(getRegex('OFFER_CTA_RE'), [
    'Get offer', 'Claim offer', 'Claim free offer', 'Redeem offer',
    '免费优惠', '获取优惠', '领取优惠', '兑换免费优惠'
  ], 'offer CTA');
});

test('upgrade CTA and plan badge patterns match current English and Simplified Chinese labels', () => {
  assertMatches(getRegex('UPGRADE_CTA_RE'), [
    'Upgrade to Plus', 'Upgrade to ChatGPT Pro', '升级至 Plus',
    '升级至 ChatGPT Pro', '立即升级'
  ], 'upgrade CTA');
  assertMatches(getRegex('PLAN_BADGE_RE'), [
    'Free', 'Free plan', '免费版', '免费套餐', '免费计划'
  ], 'plan badge');
});

test('upload-limit and disclaimer patterns match current English and Simplified Chinese copy', () => {
  assertMatches(getRegex('UPLOAD_LIMIT_RE'), [
    'Get Plus for more uploads', 'upload limit reached',
    '订阅 Plus，获得更多上传额度', '或等待18小时后再上传'
  ], 'upload-limit row');
  assertMatches(getRegex('DISCLAIMER_RE'), [
    'ChatGPT can make mistakes. Check important info.',
    'ChatGPT 可能会出错，请核对重要信息。',
    '可能会犯错，请核实重要信息。'
  ], 'disclaimer');
});

test('promotion-copy rules recognize representative English and Simplified Chinese upgrade cards', () => {
  const patterns = getRegexArray('PROMO_PATTERNS');
  assert.ok(patterns.length >= 10, 'expected a substantial pattern set; got ' + patterns.length);
  assert.ok(patterns.some(re => re.test("You're using ChatGPT Free plan. Upgrade to access advanced models, memory and images.")));
  assert.ok(patterns.some(re => re.test('你正在使用 ChatGPT 免费版，升级即可使用高级模型、记忆和图像功能')));
  assert.ok(patterns.some(re => re.test('升级至 Plus，体验增强推理和调试代码功能')));
});

test('ordinary discussion should not be classified by the primary CTA labels', () => {
  const trial = getRegex('TRIAL_CTA_RE');
  const offer = getRegex('OFFER_CTA_RE');
  const upgrade = getRegex('UPGRADE_CTA_RE');
  assertDoesNotMatch(trial, [
    'I tried Plus last year', 'Free trial ended yesterday', '开始免费试用值得吗？'
  ], 'trial CTA');
  assertDoesNotMatch(offer, [
    'Can you explain the offer?', '我想了解这个优惠是什么意思'
  ], 'offer CTA');
  assertDoesNotMatch(upgrade, [
    'Please explain how to upgrade to Plus', '升级到 Plus 有什么区别？'
  ], 'upgrade CTA');
});

test('upload response patch has explicit guards before mutation', () => {
  const start = source.indexOf('function stripUploadBlock(data)');
  const end = source.indexOf('\n    function shouldPatch', start);
  assert.ok(start >= 0 && end > start, 'stripUploadBlock body must be locatable');
  const body = source.slice(start, end);
  assert.match(body, /Array\.isArray\(data\.blocked_features\)/);
  assert.match(body, /item\.name === 'file_upload'/);
  assert.match(body, /item\.feature_name === 'file_upload'/);
  assert.match(body, /data\.banner_info\.upsell_context_id === 'file_upload'/);
});

test('report known localization gaps without making the current baseline fail', () => {
  const trial = getRegex('TRIAL_CTA_RE');
  const upgrade = getRegex('UPGRADE_CTA_RE');
  const checks = [
    ['Traditional Chinese', '免費試用 Plus', '升級至 Plus'],
    ['Simplified Chinese variant', '免费试用 Plus', '升级到 Plus'],
    ['Japanese', '無料トライアルを開始', 'Plusにアップグレード'],
    ['Korean', '무료 체험 시작', 'Plus로 업그레이드'],
    ['French', 'Commencer un essai gratuit', 'Passer à Plus'],
    ['German', 'Kostenlos testen', 'Auf Plus upgraden'],
    ['Spanish', 'Iniciar prueba gratis', 'Actualizar a Plus']
  ];
  const gaps = checks.filter(([, trialText, upgradeText]) => !trial.test(trialText) || !upgrade.test(upgradeText));
  if (gaps.length) {
    console.warn('\nKnown localization coverage gaps (expected in current baseline):');
    for (const [language, trialText, upgradeText] of gaps) {
      console.warn('- ' + language + ': trial=' + trial.test(trialText) + ', upgrade=' + upgrade.test(upgradeText));
    }
  }
  assert.ok(checks.length >= 6);
});
