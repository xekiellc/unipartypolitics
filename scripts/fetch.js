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
        description: desc ? desc.replace(/<[^>]*>/g, '').trim().slice(0, 120) : '',
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
  return all.slice(0, 15);
}

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout: 60000
    };

    const req = https.request(options, (res) => {
      let response = '';
      console.log(`Claude API status: ${res.statusCode}`);
      res.on('data', chunk => response += chunk);
      res.on('end', () => {
        console.log(`Claude raw response length: ${response.length}`);
        console.log(`Claude raw response: ${response.slice(0, 500)}`);
        resolve(response);
      });
    });

    req.on('error', (e) => {
      console.error(`Claude request error: ${e.message}`);
      reject(e);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Claude API timeout'));
    });

    req.write(body);
    req.end();
  });
}

async function curateWithClaude(articles) {
  console.log(`API key present: ${!!ANTHROPIC_API_KEY}`);
  console.log(`API key length: ${ANTHROPIC_API_KEY ? ANTHROPIC_API_KEY.length : 0}`);

  const articleList = articles.map((a, i) =>
    `[${i}] ${a.title} (${a.source})`
  ).join('\n');

  const prompt = `You are editorial AI for unipartypolitics.com. Pick the best articles exposing bipartisan political corruption — both Republican AND Democrat failures.

Return ONLY this JSON, no other text:
{"featured":{"category":"betrayal","kicker":"Both parties fail again","headline":"Congress passes surveillance bill with bipartisan support","dek":"Both parties voted to expand surveillance powers with no reform amendments added.","votes_r":42,"votes_d":36,"votes_yes":78,"votes_no":19,"source":"ProPublica"},"articles":[{"id":1,"category":"betrayal","headline":"Article headline here","meta":"Politics · today","url":"https://example.com"}]}

ARTICLES:
${articleList}`;

  try {
    const raw = await callClaude(prompt);
    const parsed = JSON.parse(raw);
    const text = parsed.content?.[0]?.text || '';
    console.log(`Claude text response: ${text.slice(0, 300)}`);
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error(`Curation error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('UniParty Politics pipeline starting...');

  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set!');
    process.exit(1);
  }

  const articles = await fetchAllFeeds();

  if (articles.length === 0) {
    console.error('No articles fetched. Exiting.');
    process.exit(1);
  }

  console.log(`Sending ${articles.length} articles to Claude...`);
  const curated = await curateWithClaude(articles);

  if (!curated) {
    console.error('Curation failed. Keeping existing articles.json.');
    process.exit(0);
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
