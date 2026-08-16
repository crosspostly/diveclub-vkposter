#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * PlaywrightService — ТОЧНАЯ КОПИЯ логики апрельской рабочей версии
 * (коммит 4bf8c299 «🤖 Auto-publish: 2026-04-17», services/playwrightService.ts),
 * переведённая на JS/commonjs для подпапки.
 *
 * Изменения против оригинала — ТОЛЬКО механические:
 *   - TS → JS (commonjs), типы убраны
 *   - скриншоты/дампы пишутся в каталог скрипта (path.join(__dirname))
 *   - добавлен флаг dryRun (пропускает submitPublish)
 * Логика селекторов, флоу, тайминги — БЕЗ ИЗМЕНЕНИЙ.
 * ═══════════════════════════════════════════════════════════════════════════ */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Загрузка .env из каталога скрипта (см. .env.example)
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 🎯 КАНАЛ ДЛЯ ПУБЛИКАЦИИ — слаг из адреса студии dzen.ru/profile/editor/<слаг>.
// Задаётся в .env (DZEN_CHANNEL_SLUG) или здесь.
const CHANNEL_SLUG = process.env.DZEN_CHANNEL_SLUG || 'your-channel-slug';

class PlaywrightService {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.dryRun = false;
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  async dumpState(name) {
    if (!this.page) return;
    try {
      const html = await this.page.content();
      const screenshot = await this.page.screenshot({ fullPage: true });
      await fs.writeFileSync(path.join(__dirname, `${name}.html`), html);
      await fs.writeFileSync(path.join(__dirname, `${name}.png`), screenshot);
      this.log(`📸 State dumped to ${name}.html and ${name}.png`);
    } catch (e) {
      console.error('Failed to dump state:', e);
    }
  }

  async publish(article, options) {
    try {
      this.log(`🤖 Starting PlaywrightService for article: "${article.title}"`);
      this.dryRun = !!options.dryRun;

      await this.initBrowser(options);
      await this.loadCookies(options.cookiesJson);

      await this.navigateToEditor();
      await this.fillArticle(article);

      if (this.dryRun) {
        this.log('⏸️ DRY-RUN: публикация пропущена, черновик готов.');
        this.log('⏳ жду 8 c — даём картинке до-загрузиться перед скриншотом...');
        await this.page.waitForTimeout(8000);
        await this.dumpState('00-dry-final');
        if (options.keepOpen > 0) {
          this.log(`⏳ браузер открыт ещё ${options.keepOpen} c...`);
          await this.page.waitForTimeout(options.keepOpen * 1000);
        }
        await this.close();
        return { success: true, url: null, dryRun: true };
      }

      const result = await this.submitPublish();

      await this.close();
      return result;
    } catch (error) {
      console.error('❌ PlaywrightService Error:', error);
      if (this.page) {
        await this.dumpState('error_state');
      }
      await this.close();
      return { success: false, error: error.message };
    }
  }

  async initBrowser(options) {
    this.log('🚀 Initializing browser...');
    this.browser = await chromium.launch({
      headless: options.headless !== false,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage']
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 YaBrowser/23.12.0.0 Safari/537.36',
      permissions: ['clipboard-read', 'clipboard-write'] // Crucial for copy-paste
    });

    this.page = await this.context.newPage();
  }

  async loadCookies(cookiesJson) {
    if (!this.context) throw new Error('Browser context not initialized');
    try {
      const rawCookies = JSON.parse(cookiesJson);

      // Sanitize cookies for Playwright
      const validCookies = rawCookies.map((c) => {
        const cookie = { ...c };

        // Fix sameSite: Playwright requires "Strict" | "Lax" | "None"
        if (cookie.sameSite) {
          const lower = String(cookie.sameSite).toLowerCase();
          if (lower === 'no_restriction' || lower === 'none') {
            cookie.sameSite = 'None';
            cookie.secure = true; // 'None' requires Secure
          } else if (lower === 'lax') {
            cookie.sameSite = 'Lax';
          } else if (lower === 'strict') {
            cookie.sameSite = 'Strict';
          } else {
            // Remove invalid/unknown values (e.g. 'unspecified') to let browser use default
            delete cookie.sameSite;
          }
        }

        // Remove other potentially problematic fields that appear in some exports
        delete cookie.hostOnly;
        delete cookie.session;
        delete cookie.storeId;
        delete cookie.id;

        return cookie;
      });

      await this.context.addCookies(validCookies);
      this.log(`✅ Cookies loaded (${validCookies.length} items)`);
    } catch (e) {
      throw new Error(`Failed to load cookies: ${e.message}`);
    }
  }

  async navigateToEditor() {
    if (!this.page) throw new Error('Page not initialized');

    this.log('🌐 Navigating to Dzen editor...');
    // Используем прямой URL для надежности
    await this.page.goto(`https://dzen.ru/profile/editor/${CHANNEL_SLUG}`, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(5000);

    const title = await this.page.title();
    const url = this.page.url();
    this.log(`📄 Page loaded: "${title}" (${url})`);

    // Check for login redirection
    if (url.includes('passport.yandex')) {
      await this.dumpState('login_redirect');
      throw new Error('Redirected to login page (cookies expired?)');
    }

    // Close modal if present (более широкие селекторы)
    const modalButton = await this.page.$('[data-testid="close-button"], [aria-label="Закрыть"]');
    if (modalButton) {
      this.log('Start modal found, closing...');
      await modalButton.click();
      await this.page.waitForTimeout(1000);
    }

    await this.dumpState('step1_editor');

    // Click "Add Publication"
    const addButtonSelectors = [
      '[data-testid="add-publication-button"]',
      'button[aria-label="Создать"]',
      'button:has-text("Создать")',
      '.new-publication-button'
    ];
    let addButton = null;

    for (const sel of addButtonSelectors) {
      addButton = await this.page.$(sel);
      if (addButton && await addButton.isVisible()) {
        this.log(`Found add button with selector: ${sel}`);
        break;
      }
    }

    if (addButton) {
      await addButton.click();
      await this.page.waitForTimeout(2000);
      await this.dumpState('step2_menu_open');

      // Click "Write Article"
      const writeSelectors = [
        'text="Написать статью"',
        'text="Статья"',
        'button:has-text("Статья")',
        '[data-testid="menu-item-article"]'
      ];
      let writeButton = null;

      for (const sel of writeSelectors) {
        writeButton = await this.page.$(sel);
        if (writeButton && await writeButton.isVisible()) {
          this.log(`Found write button with selector: ${sel}`);
          break;
        }
      }

      if (writeButton) {
        await writeButton.click();
        this.log('✅ "Write Article" clicked, waiting for editor...');
        await this.page.waitForTimeout(8000); // Wait for editor load

        await this.dumpState('step3_editor_loaded');

        // Close overlays
        await this.page.evaluate(() => {
          const overlays = document.querySelectorAll('.ReactModal__Overlay, .ReactModalPortal, .article-editor-desktop--help-popup__overlay-3q');
          overlays.forEach(el => { el.style.display = 'none'; el.remove(); });
        });
        await this.page.keyboard.press('Escape');
      } else {
        await this.dumpState('dump_menu');
        // Если кнопка не найдена, пробуем прямой переход
        this.log('⚠️ Write button not found, trying direct navigation...');
        await this.page.goto('https://dzen.ru/profile/editor/new/article', { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(5000);
      }
    } else {
      // Может мы уже в редакторе?
      if (!url.includes('editor/new/article')) {
        this.log('⚠️ Add button not found, trying direct navigation...');
        await this.page.goto('https://dzen.ru/profile/editor/new/article', { waitUntil: 'domcontentloaded' }).catch(() => {});
        await this.page.waitForTimeout(5000);
      }
    }
  }

  async fillArticle(article) {
    if (!this.page) throw new Error('Page not initialized');

    this.log('📝 Looking for inputs...');
    const inputs = await this.page.$$('input[type="text"], textarea, div[contenteditable="true"]');
    this.log(`Found ${inputs.length} input elements`);

    if (inputs.length === 0) {
      await this.dumpState('no_inputs');
      throw new Error('No inputs found in editor');
    }

    // 1. Title (Human-like typing)
    if (inputs.length > 0) {
      this.log('📝 Typing title...');
      await inputs[0].focus();
      await inputs[0].click();
      await this.page.keyboard.press('Control+A');
      await this.page.keyboard.press('Backspace');
      await inputs[0].type(article.title, { delay: 50 });
    }

    // 2. Content (Copy-Paste)
    if (inputs.length > 1) {
      this.log('📝 Pasting content...');
      await inputs[1].focus();
      await inputs[1].click();
      await this.page.evaluate((text) => navigator.clipboard.writeText(text), article.content);
      await this.page.waitForTimeout(1000);
      await this.page.keyboard.press('Control+V');
      await this.page.waitForTimeout(1000);
      await this.page.keyboard.press('Enter');

      // Scroll simulation
      await this.page.mouse.wheel(0, 500);
      await this.page.waitForTimeout(1000);
      await this.page.mouse.wheel(0, -500);
    }

    // 3. Image
    if (article.imageUrl) {
      this.log('🖼️ Inserting image...');

      const imageBtnSelectors = [
        'button[data-tip="Вставить изображение"]',
        'button[aria-label="Вставить изображение"]',
        '.article-editor-desktop--side-button__sideButton-1z',
        'button:has(svg)'
      ];

      let imageBtn = null;
      for (const selector of imageBtnSelectors) {
        imageBtn = await this.page.$(selector);
        if (imageBtn && await imageBtn.isVisible()) {
          this.log(`Found image button: ${selector}`);
          break;
        }
      }

      if (imageBtn) {
        await imageBtn.click();
        await this.page.waitForTimeout(2000);

        const urlInput = await this.page.waitForSelector('input[type="text"][placeholder*="ссылка"]', { timeout: 5000 }).catch(() => null) ||
                         await this.page.$('input[type="text"]');

        if (urlInput) {
          await urlInput.fill(article.imageUrl);
          await urlInput.press('Enter');
          await this.page.waitForTimeout(3000);
          this.log('✅ Image URL submitted');
        }
      }
    }
  }

  async submitPublish() {
    if (!this.page) throw new Error('Page not initialized');

    const firstBtnSelector = 'button[data-testid="article-publish-btn"]';

    try {
      this.log('⏳ Waiting for publish button...');
      await this.page.waitForSelector(`${firstBtnSelector}:not([disabled])`, { timeout: 15000 });

      const firstBtn = await this.page.$(firstBtnSelector);
      if (firstBtn) {
        await firstBtn.click();
        this.log('✅ Clicked first publish button');
        await this.handleCaptcha();
        await this.page.waitForTimeout(3000);
      }
    } catch (e) {
      this.log(`⚠️ First publish button issue: ${e.message}`);
    }

    const secondBtnSelector = 'button[data-testid="publish-btn"][type="submit"]';

    try {
      const secondBtn = await this.page.waitForSelector(secondBtnSelector, { timeout: 10000 });
      if (secondBtn) {
        await secondBtn.click();
        this.log('✅ Clicked confirmation button');

        await this.handleCaptcha(15);

        this.log('⏳ Waiting for redirect...');
        try {
          await this.page.waitForFunction(() => !window.location.href.includes('/editor/'), { timeout: 45000 });
          const finalUrl = this.page.url();
          this.log(`🔗 Published at: ${finalUrl}`);
          return { success: true, url: finalUrl };
        } catch (e) {
          throw new Error('Publication timed out (no redirect)');
        }
      }
    } catch (e) {
      this.log('⚠️ Second publish button not found');
    }

    return { success: false };
  }

  async handleCaptcha(maxAttempts = 5) {
    if (!this.page) return;
    const selector = '#not-robot-captcha-checkbox';

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const el = await this.page.$(selector);
        if (el) {
          await this.clickCaptcha(el);
          return;
        }

        for (const frame of this.page.frames()) {
          const frameEl = await frame.$(selector);
          if (frameEl) {
            this.log('🤖 Captcha found in iframe');
            await this.clickCaptcha(frameEl, frame);
            return;
          }
        }
        await this.page.waitForTimeout(1000);
      } catch (e) { /* ignore */ }
    }
  }

  async clickCaptcha(element, frame = null) {
    try {
      const label = await element.evaluateHandle((el) => el.closest('label'));
      if (label) {
        await label.click();
      } else {
        await element.click({ force: true });
      }
      this.log('✅ Captcha clicked');
      await this.page.waitForTimeout(3000);
    } catch (e) {
      this.log('⚠️ Failed to click captcha');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ВИДЕО-ПУБЛИКАЦИЯ (добавлено 2026-08-16)
  // Флоу: редактор → «Загрузить видео» → локальный файл → модалка
  // (название/описание/обложка/теги/комментарии) → «Опубликовать».
  // Селекторы подтверждены живым DOM 2026-08-16 (video-editor--*).
  // ═══════════════════════════════════════════════════════════════════════

  async publishVideo(video, options) {
    try {
      this.log(`🤖 Starting video publish: "${video.title}"`);
      this.dryRun = !!options.dryRun;

      await this.initBrowser(options);
      await this.loadCookies(options.cookiesJson);

      await this.navigateToVideoUpload();
      await this.selectVideoFile(video.filePath);
      await this.waitForVideoReady();
      await this.fillVideoModal(video);

      if (this.dryRun) {
        this.log('⏸️ DRY-RUN: публикация пропущена, модалка заполнена.');
        await this.page.waitForTimeout(3000);
        await this.dumpState('00-video-dry-final');
        if (options.keepOpen > 0) {
          this.log(`⏳ браузер открыт ещё ${options.keepOpen} c...`);
          await this.page.waitForTimeout(options.keepOpen * 1000);
        }
        await this.close();
        return { success: true, url: null, dryRun: true };
      }

      const result = await this.submitVideoPublish();
      await this.close();
      return result;
    } catch (error) {
      console.error('❌ PlaywrightService Video Error:', error);
      if (this.page) await this.dumpState('video_error_state');
      await this.close();
      return { success: false, error: error.message };
    }
  }

  async navigateToVideoUpload() {
    if (!this.page) throw new Error('Page not initialized');

    this.log('🌐 Navigating to Dzen editor (video)...');
    await this.page.goto(`https://dzen.ru/profile/editor/${CHANNEL_SLUG}`, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(5000);

    const url = this.page.url();
    if (url.includes('passport.yandex')) {
      await this.dumpState('login_redirect');
      throw new Error('Redirected to login page (cookies expired?)');
    }

    // Close modal if present
    const modalButton = await this.page.$('[data-testid="close-button"], [aria-label="Закрыть"]');
    if (modalButton) {
      this.log('Start modal found, closing...');
      await modalButton.click();
      await this.page.waitForTimeout(1000);
    }

    // Click "Add Publication" (как в статье)
    const addButton = await this.page.$('[data-testid="add-publication-button"]');
    if (!addButton || !await addButton.isVisible()) {
      await this.dumpState('v0_no_add_btn');
      throw new Error('Add publication button not found');
    }
    await addButton.click();
    await this.page.waitForTimeout(2000);
    await this.dumpState('v1_menu_open');

    // Click «Загрузить видео» (label из нового-публикация dropdown)
    const videoLabelSelectors = [
      'label[role="button"][aria-label="Загрузить видео"]',
      'text="Загрузить видео"'
    ];
    let videoLabel = null;
    for (const sel of videoLabelSelectors) {
      videoLabel = await this.page.$(sel);
      if (videoLabel && await videoLabel.isVisible()) {
        this.log(`Found «Загрузить видео» with selector: ${sel}`);
        break;
      }
    }
    if (!videoLabel) {
      await this.dumpState('v_dump_menu');
      throw new Error('«Загрузить видео» not found in menu');
    }

    // Возможно открывается новая вкладка — слушаем popup
    const popupPromise = this.page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
    await videoLabel.click();
    this.log('✅ «Загрузить видео» clicked');
    const popup = await popupPromise;
    if (popup) {
      this.log('📑 Video upload opened in new tab');
      this.page = popup;
      await popup.waitForLoadState('domcontentloaded');
    }
    await this.page.waitForTimeout(5000);
    await this.dumpState('v2_video_page');
  }

  async selectVideoFile(filePath) {
    if (!this.page) throw new Error('Page not initialized');
    this.log('🎬 Selecting video file...');

    const chooserPromise = this.page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);

    const chooseBtnSelectors = [
      'button:has-text("Выбрать видео")',
      'button.video-editor--base-button__accentPrimary-B4'
    ];
    let chooseBtn = null;
    for (const sel of chooseBtnSelectors) {
      chooseBtn = await this.page.$(sel);
      if (chooseBtn && await chooseBtn.isVisible()) {
        this.log(`Found «Выбрать видео» button: ${sel}`);
        break;
      }
    }

    if (!chooseBtn) {
      // Fallback: скрытый input[type=file] может быть уже в DOM
      const fileInput = await this.page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(filePath);
        this.log('✅ File set via direct input');
        await this.page.waitForTimeout(3000);
        return;
      }
      await this.dumpState('v_no_choose_btn');
      throw new Error('«Выбрать видео» button not found');
    }

    await chooseBtn.click();
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(filePath);
      this.log('✅ File selected via filechooser');
    } else {
      const fileInput = await this.page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(filePath);
        this.log('✅ File set via input fallback');
      } else {
        await this.dumpState('v_no_file_input');
        throw new Error('No file input found after clicking choose button');
      }
    }
    await this.page.waitForTimeout(3000);
    await this.dumpState('v3_upload_started');
  }

  async waitForVideoReady() {
    if (!this.page) throw new Error('Page not initialized');
    this.log('⏳ Waiting for upload & processing...');

    // Модалка открывается после начала загрузки — ждём кнопку «Опубликовать»
    try {
      await this.page.waitForSelector('button[data-testid="publish-btn"]', { timeout: 180000 });
      this.log('✅ Publication modal opened');
    } catch (e) {
      await this.dumpState('v_modal_timeout');
      throw new Error(`Publication modal did not open: ${e.message}`);
    }

    // Ждём готовность: «Готово: можно публиковать и смотреть» / кнопка активна
    try {
      await this.page.waitForSelector('button[data-testid="publish-btn"]:not([disabled])', { timeout: 180000 });
      this.log('✅ Video processed, publish button enabled');
    } catch (e) {
      await this.dumpState('v_processing_timeout');
      throw new Error(`Video processing timeout: ${e.message}`);
    }
    await this.page.waitForTimeout(2000);
    await this.dumpState('v4_modal_ready');
  }

  async fillVideoModal(video) {
    if (!this.page) throw new Error('Page not initialized');

    // 1. Название — очистить и напечатать (апрельское правило: type, не paste)
    const titleInput = await this.page.$('textarea.Textarea-Control.Texteditor-Control_withSizing') ||
                       (await this.page.$$('textarea.Textarea-Control.Texteditor-Control'))[1];
    if (!titleInput) {
      await this.dumpState('v_no_title');
      throw new Error('Title textarea not found');
    }
    await titleInput.click();
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.press('Backspace');
    await titleInput.type(video.title, { delay: 50 });
    this.log('✅ Title typed');

    // 2. Описание — вставка в quill-редактор
    if (video.description) {
      const qlEditor = await this.page.$('.video-editor--quill-text-field__editorContainer-mB .ql-editor');
      if (qlEditor) {
        await qlEditor.click();
        await this.page.evaluate((text) => navigator.clipboard.writeText(text), video.description);
        await this.page.waitForTimeout(500);
        await this.page.keyboard.press('Control+V');
        await this.page.waitForTimeout(1000);
        this.log('✅ Description pasted');
      } else {
        this.log('⚠️ Quill description not found, skipping');
      }
    }

    // 3. Теги (Enter после каждого)
    if (video.tags && video.tags.length) {
      const tagInput = await this.page.$('input.video-editor--tag-input__input-29, input[placeholder="Добавьте теги"]');
      if (tagInput) {
        await tagInput.click();
        for (const tag of video.tags) {
          await tagInput.type(tag, { delay: 40 });
          await this.page.waitForTimeout(400);
          await this.page.keyboard.press('Enter');
          await this.page.waitForTimeout(600);
        }
        this.log(`✅ Tags added: ${video.tags.join(', ')}`);
      } else {
        this.log('⚠️ Tag input not found, skipping');
      }
    }

    // 4. Кто может комментировать → «Все пользователи»/«Никто» (по умолчанию «Подписчики»)
    if (video.comments === 'all' || video.comments === 'none') {
      const target = video.comments === 'all' ? 'Все пользователи' : 'Никто';
      const commentTrigger = await this.page.$('[data-testid="select-trigger-button-comment"]');
      if (commentTrigger) {
        await commentTrigger.click();
        await this.page.waitForTimeout(1500);
        const option = await this.page.$(`label[data-testid="${target}"]`);
        if (option) {
          await option.click();
          this.log(`✅ Comments: ${target}`);
        } else {
          await this.dumpState('v_comment_popup');
          this.log(`⚠️ «${target}» option not found`);
        }
        await this.page.waitForTimeout(1000);
      } else {
        this.log('⚠️ Comment selector not found, skipping');
      }
    }

    // 5. Обложка (опционально)
    if (video.coverPath) {
      const coverInput = await this.page.$('input[type="file"][accept*="image"]');
      if (coverInput) {
        await coverInput.setInputFiles(video.coverPath);
        this.log('✅ Cover image set');
        await this.page.waitForTimeout(3000);
      } else {
        this.log('⚠️ Cover input not found, skipping');
      }
    }
  }

  async submitVideoPublish() {
    if (!this.page) throw new Error('Page not initialized');

    this.log('⏳ Clicking «Опубликовать»...');
    const publishBtn = await this.page.waitForSelector(
      'button[data-testid="publish-btn"][type="submit"]:not([disabled])',
      { timeout: 30000 }
    );
    await publishBtn.click();
    this.log('✅ Publish clicked');

    await this.handleCaptcha(10);
    await this.page.waitForTimeout(3000);

    // Успех = модалка закрылась (publish-btn исчез из DOM)
    try {
      await this.page.waitForSelector('button[data-testid="publish-btn"]', { state: 'detached', timeout: 45000 });
      this.log('✅ Modal closed — publish accepted');
    } catch (e) {
      await this.dumpState('v_publish_stuck');
      return { success: false, error: 'Publish: modal did not close (timeout)' };
    }

    // Пытаемся найти URL видео (сразу или на канале)
    let videoUrl = null;
    try {
      await this.page.waitForTimeout(5000);
      const currentUrl = this.page.url();
      if (currentUrl.includes('/video/')) {
        videoUrl = currentUrl;
      } else {
        await this.page.goto(`https://dzen.ru/${CHANNEL_SLUG}`, { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(5000);
        const link = await this.page.$('a[href*="/video/watch/"]');
        if (link) {
          const href = await link.getAttribute('href');
          if (href) videoUrl = href.startsWith('http') ? href : 'https://dzen.ru' + href;
        }
      }
    } catch (e) { /* URL не критичен */ }

    if (videoUrl) {
      this.log(`🔗 Video URL: ${videoUrl}`);
    } else {
      this.log('⚠️ Видео опубликовано, но URL ещё не найден (обработка может занять время).');
    }
    return { success: true, url: videoUrl || '' };
  }

  async close() {
    if (this.browser) await this.browser.close();
  }
}

const playwrightService = new PlaywrightService();

module.exports = { PlaywrightService, playwrightService };
