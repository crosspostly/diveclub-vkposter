#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * publish-dzen-video — публикация ВИДЕО в Дзен через редактор.
 *
 * Флоу (тот же старт, что и статья): cookies → dzen.ru/profile/editor/<слаг канала>
 * → «Создать» → «Загрузить видео» → «Выбрать видео» (локальный файл)
 * → модалка «Публикация видео» (название/описание/обложка/теги/комментарии)
 * → «Опубликовать».
 *
 * Использование (ТОЛЬКО из корня репо — пути завязаны на process.cwd()):
 *   node !posts/publish-cycle/publish-dzen-video.js ^
 *     --video "C:\path\to\video.mp4" ^
 *     --title "Заголовок" ^
 *     --text "Описание (необязательно)" ^
 *     --tags "тег1,тег2" ^
 *     --cover "C:\path\to\cover.jpg" ^
 *     --dry-run              # заполнить модалку, НЕ публиковать
 *     --keep-open 8          # подержать браузер N секунд после
 *
 * Запуск без --dry-run публикует РЕАЛЬНО в канал — сначала всегда
 * проверяй сухой прогон и получи подтверждение.
 * ═══════════════════════════════════════════════════════════════════════════ */
const { playwrightService } = require('./playwrightService');
const fs = require('fs');
const path = require('path');

// Загрузка .env из каталога скрипта (см. .env.example)
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 📋 Configuration (пути — относительно каталога скрипта; переопределяются через .env)
const CONFIG = {
  cookiesPath: path.join(__dirname, 'config', 'cookies.json'),
  historyPath: path.join(__dirname, 'history', 'published_videos.txt'),
  headless: process.env.HEADLESS !== 'false',
};

const DRY_RUN = process.argv.includes('--dry-run');
const KEEP_OPEN = (() => {
  const i = process.argv.indexOf('--keep-open');
  if (i === -1) return 0;
  const v = parseInt(process.argv[i + 1], 10);
  return isNaN(v) ? 0 : v;
})();

function cliArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const CLI_VIDEO = cliArg('video');
const CLI_TITLE = cliArg('title');
const CLI_TEXT = cliArg('text');
const CLI_TAGS = cliArg('tags');
const CLI_COVER = cliArg('cover');
const CLI_COMMENTS = cliArg('comments') || 'all';

async function loadCookies() {
  try {
    if (await fs.promises.stat(CONFIG.cookiesPath).catch(() => false)) {
      const fileContent = await fs.promises.readFile(CONFIG.cookiesPath, 'utf8');
      if (fileContent && fileContent.length > 10) {
        console.log('🍪 Using cookies from Local File (!posts/config/cookies.json)');
        return fileContent;
      }
    }
  } catch (e) { /* fall through */ }

  const envCookies = process.env.DZEN_COOKIES_JSON;
  if (envCookies && envCookies.length > 10) {
    console.log('🍪 Using cookies from Environment Variable (DZEN_COOKIES_JSON)');
    return envCookies;
  }
  throw new Error('❌ Cookies not found in !posts/config/cookies.json OR DZEN_COOKIES_JSON env var!');
}

async function savePublishedVideo(title, url) {
  const date = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const entry = url ? `${date} - ${title} - ${url}\n` : `${date} - ${title}\n`;
  try {
    await fs.promises.mkdir(path.dirname(CONFIG.historyPath), { recursive: true });
    await fs.promises.appendFile(CONFIG.historyPath, entry);
    console.log(`✅ Saved to history: "${title.substring(0, 50)}"...`);
  } catch (error) {
    console.error(`❌ Error saving history: ${error.message}`);
  }
}

// 🚀 Main
async function main() {
  console.log('🤖 ==== VIDEO PUBLISHER STARTING ====');
  if (DRY_RUN) console.log('⏸️  DRY-RUN MODE: реальная публикация будет пропущена');

  if (!CLI_VIDEO) {
    console.error('❌ Укажи --video <путь к mp4>');
    process.exit(1);
  }
  if (!fs.existsSync(CLI_VIDEO)) {
    console.error(`❌ Видео-файл не найден: ${CLI_VIDEO}`);
    process.exit(1);
  }
  if (!CLI_TITLE) {
    console.error('❌ Укажи --title "Заголовок"');
    process.exit(1);
  }

  const video = {
    filePath: CLI_VIDEO,
    title: CLI_TITLE,
    description: CLI_TEXT || '',
    tags: CLI_TAGS ? CLI_TAGS.split(',').map(t => t.trim()).filter(Boolean) : [],
    coverPath: CLI_COVER && fs.existsSync(CLI_COVER) ? CLI_COVER : null,
    comments: CLI_COMMENTS,
  };

  console.log(`🎬 Video: ${video.filePath}`);
  console.log(`📝 Title: ${video.title}`);
  if (video.description) console.log(`📝 Description: ${video.description.substring(0, 80)}...`);
  if (video.tags.length) console.log(`🏷️ Tags: ${video.tags.join(', ')}`);
  if (video.coverPath) console.log(`🖼️ Cover: ${video.coverPath}`);
  console.log(`💬 Comments: ${video.comments === 'all' ? 'Все пользователи' : video.comments}`);

  try {
    const cookiesJson = await loadCookies();

    const result = await playwrightService.publishVideo(video, {
      cookiesJson,
      headless: CONFIG.headless,
      dryRun: DRY_RUN,
      keepOpen: KEEP_OPEN
    });

    if (result.success && result.url) {
      console.log(`\n🎉 SUCCESS! Video published: ${result.url}`);
      await savePublishedVideo(video.title, result.url);
    } else if (result.success && result.dryRun) {
      console.log('\n⏸️  DRY-RUN: модалка заполнена, публикация не выполнялась.');
      process.exit(0);
    } else if (result.success) {
      console.log('\n🎉 SUCCESS! Видео опубликовано (URL уточнится после обработки).');
      await savePublishedVideo(video.title, '');
      process.exit(0);
    } else {
      console.error(`\n❌ FAILED: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ FATAL ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
