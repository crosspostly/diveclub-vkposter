#!/usr/bin/env node
/**
 * probe-editor.js v3 — исследование DOM редактора Дзен с ВАЛИДАТОРОМ ШАГОВ:
 * клик → ждём появления ожидаемого элемента → если нет, Esc и повтор.
 * Read-only: ничего не заполняет и не публикует.
 */
const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

const COOKIES = path.join(__dirname, 'config', 'cookies.json');
const EDITOR_URL = `https://dzen.ru/profile/editor/${process.env.DZEN_CHANNEL_SLUG || 'your-channel-slug'}`;

function norm(raw) {
  const map = { unspecified: 'Lax', no_restriction: 'None', lax: 'Lax', strict: 'Strict', none: 'None' };
  return raw.map(c => {
    const out = { name: c.name, value: c.value, domain: c.domain, path: c.path || '/' };
    if (c.expirationDate !== undefined) out.expires = c.expirationDate;
    else if (c.expires !== undefined) out.expires = c.expires;
    if (c.httpOnly !== undefined) out.httpOnly = c.httpOnly;
    if (c.secure !== undefined) out.secure = c.secure;
    out.sameSite = map[(c.sameSite || 'unspecified').toLowerCase()] || 'Lax';
    return out;
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = async page => { try { await page.keyboard.press('Escape'); } catch (_) {} await sleep(700); };

async function hideHelp(page) {
  try {
    await page.evaluate(() => {
      document.querySelectorAll('.ReactModalPortal, .ReactModal__Overlay').forEach(el => {
        const cls = (el.className || '').toString();
        const txt = (el.innerText || '').toLowerCase();
        if (cls.includes('help') || cls.includes('help-popup') || txt.includes('в первую очередь')) {
          el.style.display = 'none'; el.style.visibility = 'hidden'; el.style.pointerEvents = 'none'; el.remove();
        }
      });
    });
  } catch (_) {}
  await sleep(300);
}

// Ожидание появления элемента (валидация шага)
async function waitFor(page, sel, ms) {
  try { await page.waitForSelector(sel, { state: 'visible', timeout: ms }); return true; } catch (_) { return false; }
}

// Шаг с валидацией: клик → ожидание expected → при фейле Esc + повтор
async function step(page, sel, label, expected, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const el = await page.$(sel);
    if (el) {
      try { await el.click({ timeout: 5000 }); console.log(`OK click ${label}`); } catch (e) {
        console.log(`  retry${i + 1} ${label}: ${e.message.split('\n')[0]}`); await esc(page); await hideHelp(page); continue;
      }
    } else {
      console.log(`NO element ${label} (ищем "${sel}")`);
      await esc(page); await hideHelp(page); await sleep(1000);
      continue;
    }
    if (expected) {
      if (await waitFor(page, expected, 6000)) { console.log(`  VALID: появилось "${expected}"`); return true; }
      console.log(`  retry${i + 1} ${label}: не появилось "${expected}" → Esc`);
      await esc(page); await hideHelp(page); await sleep(1200);
    } else {
      return true;
    }
  }
  return false;
}

(async () => {
  const cookies = norm(JSON.parse(await fs.readFile(COOKIES, 'utf8')));
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);

  await context.addCookies(cookies);
  console.log('goto', EDITOR_URL);
  await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(6000);
  console.log('url:', page.url());

  // Шаг 1: открыть меню добавления (валидация: появился пункт «Написать статью»)
  await step(page, '[data-testid="add-publication-button"]', 'add-publication', 'text="Написать статью"', 4);

  // ДАМП меню: что вообще в попапе добавления
  const menu = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button, [role="menuitem"], [role="button"], a').forEach((el, i) => {
      const t = (el.innerText || '').trim();
      const cls = (el.className || '').toString().slice(0, 60);
      if (t && t.length < 60 && el.offsetParent !== null) out.push({ i, tag: el.tagName, t, cls });
    });
    return out.filter(o => o.t);
  });
  console.log('\n=== Попап добавления: видимые элементы с текстом ===');
  menu.forEach(m => console.log(`#${m.i} <${m.tag}> "${m.t}" cls=${m.cls.slice(0, 50)}`));

  // Шаг 2: клик «Написать статью» (валидация: появился редактор)
  await step(page, 'text="Написать статью"', 'write-article', '.public-DraftEditor-content[contenteditable="true"]', 4);

  await sleep(3000);
  await esc(page);
  await hideHelp(page);
  await sleep(1500);

  // ДАМП редактора: поля + кнопки
  const editorState = await page.evaluate(() => {
    const out = { fields: [], buttons: [] };
    document.querySelectorAll('[contenteditable="true"], input[type="text"], textarea').forEach((el, i) => {
      const cls = (el.className || '').toString().slice(0, 80);
      const ph = el.getAttribute('placeholder') || '';
      const aria = el.getAttribute('aria-label') || '';
      if (el.offsetParent !== null) out.fields.push({ i, tag: el.tagName, cls, ph, aria, txt: (el.textContent || '').slice(0, 40) });
    });
    document.querySelectorAll('button, [data-tip], [aria-label]').forEach((el, i) => {
      const tip = el.getAttribute('data-tip');
      const aria = el.getAttribute('aria-label');
      const testid = el.getAttribute('data-testid');
      const cls = (el.className || '').toString().slice(0, 70);
      if ((tip || aria || testid) && el.offsetParent !== null) out.buttons.push({ i, tag: el.tagName, tip, aria, testid, cls });
    });
    return out;
  });
  console.log('\n=== Поля редактора ===');
  editorState.fields.forEach(f => console.log(`#${f.i} <${f.tag}> ph="${f.ph}" aria="${f.aria}" cls=${f.cls.slice(0, 55)} txt="${f.txt}"`));
  console.log('\n=== Кнопки редактора (tip/aria/testid) ===');
  editorState.buttons.forEach(b => console.log(`#${b.i} <${b.tag}> tip="${b.tip}" aria="${b.aria}" testid="${b.testid}" cls=${b.cls.slice(0, 55)}`));

  // Клик в текст → панель медиа (БЕЗ Esc перед этим!)
  const body = await page.$('.public-DraftEditor-content[contenteditable="true"]');
  if (body) {
    try { await body.click({ timeout: 5000 }); console.log('\nклик в текст ок'); } catch (e) { console.log('клик в текст fail:', e.message.split('\n')[0]); }
    await sleep(2000);
    const mediaPanel = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button, [data-tip], [aria-label]').forEach((el, i) => {
        const tip = el.getAttribute('data-tip');
        const aria = el.getAttribute('aria-label');
        const testid = el.getAttribute('data-testid');
        const cls = (el.className || '').toString().slice(0, 70);
        if ((tip || aria || testid) && el.offsetParent !== null && (tip || testid)) out.push({ i, tag: el.tagName, tip, aria, testid, cls });
      });
      return out;
    });
    console.log('\n=== Кнопки после клика в текст (только tip/testid) ===');
    mediaPanel.forEach(b => console.log(`#${b.i} <${b.tag}> tip="${b.tip}" aria="${b.aria}" testid="${b.testid}" cls=${b.cls.slice(0, 55)}`));
    await page.screenshot({ path: path.join(__dirname, 'probe-editor.png') });
  } else {
    console.log('\nNO body editor');
  }

  await browser.close();
  console.log('\nDONE');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
