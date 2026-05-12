const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const RSS_FEEDS = [
  'https://feeds.propublica.org/propublica/main',
  'https://theintercept.com/feed/?rss',
  'https://rss.politico.com/congress.xml',
  'https://feeds.foxnews.com/foxnews/politics',
  'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml',
  'https://reason.com/feed/',
  'https://www.commondreams.org/rss.xml',
  'https://justthenews.com/feed'
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UniPartyBot/1.0)' },
      timeout: 10000
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseRSS(xml, sourceUrl) {
  const articles = [];
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const item of items.slice(0, 5)) {
    const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                   item.match(/<title>(.*?)<\/title>/) || [])[1];
    const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                  item.match(/<description>(.*?)<\/description>/) || [])[1];
    const link = (item.match(/<link>(.*?)<\/link>/) ||
                  item.match(/<link\s+href="(.*?)"/) || [])[1];
    const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1];
    if (title && title !== 'undefined') {
      articles.push({
        title: title.replace(/<[^>]*>/g, '').trim(),
        description: desc ? desc.replace(/<[^>]*>/g, '').trim().slice(0, 150) : '',
        url: link ? link.trim() : sourceUrl,
        source: new URL(sourceUrl).hostname,
        publishedAt: pubDate || new Date().toISOString()
      });
    }
  }
  return articles;
}

async function fetchAllFeeds() {
  const all = [];
  const seen = new Set();
  for (const feed of RSS_FEEDS) {
    try {
      console.log(`Fetching: ${feed}`);
      const xml = await fetchUrl(feed);
      const articles = parseRSS(xml, feed);
      for (const a of articles) {
        if (!seen.has(a.title)) {
          seen.add(a.title);
          all.push(a);
        }
      }
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.error(`Feed failed: ${feed} — ${e.message}`);
    }
  }
  console.log(`Total articles fetched: ${all.length}`);
  return all.slice(0, 20);
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 60000
    };
    const req = https.request(options, (res) => {
      let response = '';
      res.on('data', chunk => response += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(response)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Claude API timeout')); });
    req.write(data);
    req.end();
  });
}

async function curateWithClaude(articles) {
  const articleList = articles.map((a, i) =>
    `[${i}] ${a.title} (${a.source})\n${a.description}\nURL: ${a.url}`
  ).join('\n\n');

  const prompt = `You are the editorial AI for unipartypolitics.com — a watchdog site exposing bipartisan corruption. Cover: endless wars, surveillance, drug prices, Wall Street bailouts, insider trading, revolving door lobbying, debt, trade deals, media consolidation.

Select articles showing bipartisan failure — both parties serving donors over voters. Equal treatment of R and D mandatory.

CATEGORIES: betrayal, data, receipts, dossier, shame

Return ONLY this exact JSON structure, nothing else, no markdown:
{"featured":{"category":"betrayal","kicker":"kicker text","headline":"headline","dek":"2-3 sentence summary","votes_r":50,"votes_d":40,"votes_yes":90,"votes_no":10,"source":"source"},"articles":[{"id":1,"category":"betrayal","headline":"headline","meta":"topic · X hours ago","url":"url"},{"id":2,"category":"data","headline":"headline","meta":"topic · X hours ago","url":"url"},{"id":3,"category":"receipts","headline":"headline","meta":"topic · X hours ago","url":"url"},{"id":4,"category":"dossier","headline":"headline","meta":"topic · X hours ago","url":"url"},{"id":5,"category":"betrayal","headline":"headline","meta":"topic · X hours ago","url":"url"}]}

Use real headlines and URLs from the articles below. Pick 1 featured + 5 articles max.

ARTICLES:
${articleList}`;

  const response = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    }
  );

  const text = response.content?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error('Claude JSON parse failed:', e.message);
    console.error('Raw response:', text.slice(0, 800));
    return null;
  }
}

async function main() {
  console.log('UniParty Politics pipeline starting...');
  const articles = await fetchAllFeeds();

  if (articles.length === 0) {
    console.error('No articles fetched. Exiting.');
    process.exit(1);
  }

  console.log(`Sending ${articles.length} articles to Claude...`);
  const curated = await curateWithClaude(articles);

  if (!curated) {
    console.error('Curation failed. Exiting.');
    process.exit(1);
  }

  const existing = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/articles.json'), 'utf8')
  );

  const output = {
    updated: new Date().toISOString(),
    featured: curated.featured || existing.featured,
    articles: curated.articles || existing.articles,
    stats: existing.stats,
    hall_of_shame: existing.hall_of_shame
  };

  fs.writeFileSync(
    path.join(__dirname, '../data/articles.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('articles.json updated successfully.');
  console.log(`Featured: ${output.featured?.headline}`);
  console.log(`Articles: ${output.articles?.length}`);
}

main().catch(e => {
  console.error('Pipeline error:', e);
  process.exit(1);
});
