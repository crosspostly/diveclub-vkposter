#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * publish-dzen — ТОЧНАЯ КОПИЯ апрельского оркестратора
 * (коммит 4bf8c299, scripts/publish-dzen.ts), переведённая на JS/commonjs.
 *
 * Логика 1:1: читает feed.xml → берёт первую неопубликованную статью →
 * вызывает PlaywrightService → пишет в published_articles.txt.
 *
 * Механические адаптации:
 *   - TS → JS (commonjs)
 *   - пути привязаны к каталогу репозитория (process.cwd())
 *   - добавлен флаг --dry-run (пропускает реальную публикацию)
 *   - добавлен --article <N> (выбор статьи по индексу из feed)
 * ═══════════════════════════════════════════════════════════════════════════ */
const { playwrightService } = require('./playwrightService');
const fs = require('fs');
const path = require('path');

// Загрузка .env из каталога скрипта (см. .env.example)
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 📋 Configuration (пути — относительно каталога скрипта; переопределяются через .env)
const CONFIG = {
  cookiesSource: process.env.CI ? 'ENVIRONMENT' : 'FILE',
  cookiesPath: path.join(__dirname, 'config', 'cookies.json'),
  feedPath: process.env.DZEN_FEED_PATH || path.join(__dirname, 'feed.xml'),
  historyPath: path.join(__dirname, 'history', 'published_articles.txt'),
  headless: process.env.HEADLESS !== 'false',
};

const DRY_RUN = process.argv.includes('--dry-run');
const KEEP_OPEN = (() => {
  const i = process.argv.indexOf('--keep-open');
  if (i === -1) return 0;
  const v = parseInt(process.argv[i + 1], 10);
  return isNaN(v) ? 0 : v;
})();
const ARTICLE_INDEX = (() => {
  const i = process.argv.indexOf('--article');
  if (i === -1) return 0;
  const v = parseInt(process.argv[i + 1], 10);
  return isNaN(v) ? 0 : v;
})();
const CLI_TITLE = (() => { const i = process.argv.indexOf('--title'); return i === -1 ? null : process.argv[i + 1]; })();
const CLI_TEXT = (() => { const i = process.argv.indexOf('--text'); return i === -1 ? null : process.argv[i + 1]; })();
const CLI_IMAGE = (() => { const i = process.argv.indexOf('--image'); return i === -1 ? null : process.argv[i + 1]; })();

// 📖 Get articles from feed.xml
async function getArticlesFromFeed() {
  try {
    console.log(`📄 Opening feed: ${CONFIG.feedPath}`);
    const feedContent = await fs.promises.readFile(CONFIG.feedPath, 'utf8');

    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const items = [];
    let match;

    while ((match = itemRegex.exec(feedContent)) !== null) {
      const itemContent = match[1];

      const titleMatch = itemContent.match(/<title><!\[CDATA\[(.+?)\]\]>/) || itemContent.match(/<title>(.+?)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.+?)\]\]>/g, '$1').trim() : 'Without title';

      const linkMatch = itemContent.match(/<link>(.+?)<\/link>/);
      const link = linkMatch ? linkMatch[1] : '';

      const mediaContentMatch = itemContent.match(/<media:content[^>]*url="(.+?)"[^>]*>/);
      const enclosureMatch = itemContent.match(/<enclosure[^>]*url="(.+?)"[^>]*>/);
      const imageUrl = mediaContentMatch ? mediaContentMatch[1] : (enclosureMatch ? enclosureMatch[1] : '');

      const contentMatch = itemContent.match(/<content:encoded><!\[CDATA\[([\s\S]+?)\]\]>/) || itemContent.match(/<content:encoded>([\s\S]+?)<\/content:encoded>/);
      const descriptionMatch = itemContent.match(/<description><!\[CDATA\[([\s\S]+?)\]\]>/) || itemContent.match(/<description>([\s\S]+?)<\/description>/);
      const content = contentMatch ? contentMatch[1] : (descriptionMatch ? descriptionMatch[1] : '');

      items.push({ title, link, imageUrl, content });
    }

    return items;
  } catch (error) {
    console.error(`❌ Error reading feed: ${error.message}`);
    return [];
  }
}

// 🏄 Process HTML content
function processArticleContent(content) {
  if (!content) return '';

  let processed = content
    .replace(/<p[^>]*>/gi, '\n\n')
    .replace(/<\/p>/gi, '')
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<div[^>]*>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<br>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  processed = processed.replace(/\n\s*\n\s*\n+/g, '\n\n');
  return processed.trim();
}

async function loadCookies() {
  // 1. Try Local File (Priority as per user request)
  try {
    if (await fs.promises.stat(CONFIG.cookiesPath).catch(() => false)) {
      const fileContent = await fs.promises.readFile(CONFIG.cookiesPath, 'utf8');
      if (fileContent && fileContent.length > 10) {
        console.log('🍪 Using cookies from Local File (!posts/config/cookies.json)');
        return fileContent;
      }
    }
  } catch (e) {
    // Continue to env var
  }

  // 2. Try Environment Variable (Fallback)
  const envCookies = process.env.DZEN_COOKIES_JSON;
  if (envCookies && envCookies.length > 10) {
    console.log('🍪 Using cookies from Environment Variable (DZEN_COOKIES_JSON)');
    return envCookies;
  }

  throw new Error('❌ Cookies not found in config/cookies.json file OR DZEN_COOKIES_JSON environment variable!');
}

async function getPublishedArticles() {
  try {
    const content = await fs.promises.readFile(CONFIG.historyPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const match = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) - (.*?)(?: - https?:\/\/.+)?$/);
      return match ? { date: match[1], title: match[2].trim() } : null;
    }).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function isArticlePublished(articleTitle, publishedArticles) {
  return publishedArticles.some(pub => pub.title.trim() === articleTitle.trim());
}

async function savePublishedArticle(article, url) {
  const date = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const entry = `${date} - ${article.title} - ${url}\n`;
  try {
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(CONFIG.historyPath), { recursive: true });
    await fs.promises.appendFile(CONFIG.historyPath, entry);
    console.log(`✅ Saved to history: "${article.title.substring(0, 50)}"...`);
  } catch (error) {
    console.error(`❌ Error saving history: ${error.message}`);
  }
}

// 🚀 Main
async function main() {
  console.log('🤖 ==== AUTO-PUBLISHER (JS) STARTING ====');
  if (DRY_RUN) console.log('⏸️  DRY-RUN MODE: реальная публикация будет пропущена');

  try {
    const cookiesJson = await loadCookies();
    const publishedArticles = await getPublishedArticles();
    // Прямой тест через CLI: --title/--text/--image (приоритет над feed.xml)
    let articleToPublish = null;
    if (CLI_TITLE) {
      articleToPublish = { title: CLI_TITLE, link: '', imageUrl: CLI_IMAGE || '', content: CLI_TEXT || '' };
      console.log(`📝 Test article from CLI: "${articleToPublish.title}"`);
    } else {
      const articles = await getArticlesFromFeed();

      if (articles.length === 0) {
        console.log('❌ No articles found in feed.xml (и нет --title для теста)');
        process.exit(0);
      }

      // Find first unpublished (или статья по индексу --article N)
      for (let i = 0; i < articles.length; i++) {
        if (i === ARTICLE_INDEX) { articleToPublish = articles[i]; break; }
      }
      if (!articleToPublish) {
        for (const article of articles) {
          if (!isArticlePublished(article.title, publishedArticles)) {
            articleToPublish = article;
            break;
          }
        }
      }
    }

    if (!articleToPublish) {
      console.log('✅ All articles already published');
      process.exit(0);
    }

    console.log(`\n📝 Publishing article: "${articleToPublish.title}"`);
    const processedContent = processArticleContent(articleToPublish.content);

    const result = await playwrightService.publish({
      title: articleToPublish.title,
      content: processedContent,
      imageUrl: articleToPublish.imageUrl
    }, {
      cookiesJson,
      headless: CONFIG.headless,
      dryRun: DRY_RUN,
      keepOpen: KEEP_OPEN
    });

    if (result.success && result.url) {
      console.log(`\n🎉 SUCCESS! Published at: ${result.url}`);
      await savePublishedArticle(articleToPublish, result.url);
    } else if (result.success && result.dryRun) {
      console.log('\n⏸️  DRY-RUN: черновик готов, публикация не выполнялась.');
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
