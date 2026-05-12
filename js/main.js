
const CATEGORY_LABELS = {
  betrayal: 'Betrayal',
  data: 'Data',
  receipts: 'Receipts',
  dossier: 'Dossier',
  shame: 'Shame'
};

const CATEGORY_CLASSES = {
  betrayal: 'cp-betrayal',
  data: 'cp-data',
  receipts: 'cp-receipts',
  dossier: 'cp-dossier',
  shame: 'cp-shame'
};

async function loadData() {
  try {
    const res = await fetch('/data/articles.json');
    const data = await res.json();
    return data;
  } catch (e) {
    console.error('Failed to load articles.json', e);
    return null;
  }
}

function renderFeatured(featured) {
  const el = document.getElementById('featured-card');
  if (!el || !featured) return;

  const totalVotes = featured.votes_r + featured.votes_d;
  const rPct = Math.round((featured.votes_r / totalVotes) * 100);
  const dPct = 100 - rPct;

  el.innerHTML = `
    <div class="feat-banner"><div class="ban-r"></div><div class="ban-p"></div><div class="ban-d"></div></div>
    <div class="feat-body">
      <div class="feat-kicker">${featured.kicker}</div>
      <div class="feat-hed">${featured.headline}</div>
      <div class="feat-dek">${featured.dek}</div>
      <div class="vote-bar-wrap">
        <div class="vote-bar">
          <div class="vb-r" style="width:${rPct}%">R: ${featured.votes_r}</div>
          <div class="vb-d" style="width:${dPct}%">D: ${featured.votes_d}</div>
        </div>
        <div class="vote-label">${featured.votes_yes} yes votes · ${featured.votes_no} no · bipartisan passage</div>
      </div>
      <div class="feat-source">${featured.source}</div>
    </div>
  `;
}

function renderArticles(articles, containerId, limit) {
  const el = document.getElementById(containerId);
  if (!el || !articles) return;

  const items = limit ? articles.slice(0, limit) : articles;

  if (items.length === 0) {
    el.innerHTML = '<div class="loading">No articles yet. Pipeline runs every 2 hours.</div>';
    return;
  }

  el.innerHTML = items.map(a => `
    <div class="art-row">
      <div><span class="cat-pill ${CATEGORY_CLASSES[a.category] || 'cp-betrayal'}">${CATEGORY_LABELS[a.category] || a.category}</span></div>
      <div>
        <div class="art-hed"><a href="${a.url || '#'}" target="_blank" rel="noopener">${a.headline}</a></div>
        <div class="art-meta">${a.meta}</div>
      </div>
    </div>
  `).join('');
}

function renderStats(stats) {
  if (!stats) return;
  const donors = document.getElementById('stat-donors');
  const votes = document.getElementById('stat-votes');
  const wars = document.getElementById('stat-wars');
  if (donors) donors.textContent = stats.shared_donor_dollars;
  if (votes) votes.textContent = stats.bipartisan_yes_votes;
  if (wars) wars.textContent = stats.wars_since_2000;
}

function renderShame(shame) {
  const el = document.getElementById('hall-of-shame');
  if (!el || !shame) return;

  el.innerHTML = shame.map(p => `
    <div class="shame-row">
      <div class="av av-${p.party}">${p.initials}</div>
      <div>
        <div class="shame-name">${p.name}</div>
        <div class="shame-sin">${p.sin}</div>
      </div>
    </div>
  `).join('');
}

function renderUpdated(updated) {
  const el = document.getElementById('last-updated');
  if (!el || !updated) return;
  const d = new Date(updated);
  el.textContent = 'Last updated: ' + d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });
}

async function init() {
  const data = await loadData();
  if (!data) return;

  renderFeatured(data.featured);
  renderArticles(data.articles, 'article-list', 7);
  renderStats(data.stats);
  renderShame(data.hall_of_shame);
  renderUpdated(data.updated);
}

document.addEventListener('DOMContentLoaded', init);
