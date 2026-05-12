
const https = require('https');
const fs = require('fs');
const path = require('path');

const NEWSAPI_KEY = process.env.NEWSAPI_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const QUERIES = [
  'congress bipartisan vote both parties',
  'congressional stock trading insider',
  'defense spending military contractor congress',
  'pharma drug price congress vote',
  'surveillance FISA warrantless both parties',
  'lobbying revolving door washington',
  'debt ceiling congress vote',
  'foreign aid military bipartisan',
  'campaign finance donor both parties',
  'trade deal congress bipartisan'
];

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
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
      }
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
    req.write(data);
    req.end();
  });
}

async function fetchArticles() {
  const articles = [];
  const seen = new Set();

  for (const query of QUERIES) {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://newsapi.org/v2/everything?q=${encoded}&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWSAPI_KEY}`;
      const result = await httpsGet(url);
      if (result.articles) {
        for (const a of result.articles) {
          if (!seen.has(a.url) && a.title && a.title !== '[Removed]') {
            seen.add(a.url);
            articles.push({
              title: a.title,
              description: a.description || '',
              url: a.url,
              source: a.source?.name || 'Unknown',
              publishedAt: a.publishedAt
            });
          }
        }
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`Query failed: ${query}`, e.message);
    }
  }

  return articles.slice(0, 40);
}

async function curateWithClaude(articles) {
  const articleList = articles.map((a, i) =>
    `[${i}] ${a.title}\n${a.description}\nSource: ${a.source}\nURL: ${a.url}`
  ).join('\n\n');

  const prompt = `You are the editorial AI for unipartypolitics.com — a watchdog site that exposes bipartisan corruption, both Republican and Democrat. You cover issues where BOTH parties fail the public: endless wars, surveillance expansion, drug price protection, Wall Street bailouts, insider trading, revolving door lobbying, debt spending, and trade deals that gut workers.

Here are ${articles.length} recent news articles. Select and categorize the best ones that fit the uniparty theme — stories showing bipartisan failure, institutional corruption, or both parties serving donors over voters.

CATEGORIES:
- betrayal: bipartisan votes, policy failures affecting all Americans
- data: numbers, statistics, financial disclosures, stock trades, donor money
- receipts: politicians saying one thing and doing another
- dossier: deep investigative angles, systemic corruption, institutional power
- shame: specific politicians caught in hypocrisy or corruption (both parties equally)

Return ONLY valid JSON, no markdown, no explanation:
{
  "featured": {
    "category": "betrayal",
    "kicker": "short kicker text here",
    "headline": "compelling headline here",
    "dek": "2-3 sentence summary explaining the bipartisan angle",
    "votes_r": 50,
    "votes_d": 40,
    "votes_yes": 90,
    "votes_no": 10,
    "source": "source name"
  },
  "articles": [
    {
      "id": 1,
      "category": "betrayal",
      "headline": "headline here",
      "meta": "topic · time ago",
      "url": "article url"
    }
  ]
}

Select 1 featured story and up to 8 articles. Only include stories with a clear bipartisan betrayal angle. Equal treatment of both parties is mandatory. If a story only attacks one party, skip it.

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
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    }
  );

  const text = response.content?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error('Claude JSON parse failed:', e.message);
    console.error('Raw response:', text);
    return null;
  }
}

async function main() {
  console.log('UniParty Politics pipeline starting...');
  console.log('Fetching articles from NewsAPI...');

  const articles = await fetchArticles();
  console.log(`Fetched ${articles.length} articles`);

  if (articles.length === 0) {
    console.error('No articles fetched. Exiting.');
    process.exit(1);
  }

  console.log('Sending to Claude for curation...');
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
