// ==UserScript==
// @name        nsk
// @namespace   https://nonstopkino.at
// @match       https://nonstopkino.at/*
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_setValue
// @version     2.1
// @description Tracking of Nonstopkino
// @updateURL    https://raw.githubusercontent.com/jakobkogler/browser-scripts/main/nsk/nsk.js
// @downloadURL  https://raw.githubusercontent.com/jakobkogler/browser-scripts/main/nsk/nsk.js
// ==/UserScript==

const STORAGE_KEY = 'nonstopkino_seen_movies';

function getSeenMovies() {
  try { return JSON.parse(GM_getValue(STORAGE_KEY, '[]')); }
  catch { return []; }
}

function saveSeenMovies(set) {
  GM_setValue(STORAGE_KEY, JSON.stringify([...set]));
}

const seenSet = new Set(getSeenMovies());
let hideSeen = true;

function getMovieSlug(article) {
  const link = article.querySelector('a.full-card-link');
  if (!link) return null;
  return link.getAttribute('data-original-link') || link.getAttribute('href');
}

GM_addStyle(`
  .agenda-list {
    height: auto !important;
    position: relative !important;
    display: flex !important;
    flex-direction: column !important;
    transition: none !important;
    opacity: 1 !important;
  }

  .agenda-list article.event {
    position: static !important;
    transform: none !important;
    opacity: 1 !important;
    visibility: visible !important;
    width: 100% !important;
    transition: none !important;
    contain: none !important;
    display: flex !important;
    align-items: stretch !important;
  }

  .agenda-list article.event[style*="scale(0.001)"],
  .agenda-list article.event[aria-hidden="true"] {
    display: none !important;
  }

  .agenda-list article.event.nsk-hidden-seen {
    display: none !important;
  }

  .agenda-list article.event.nsk-seen a.full-card-link {
    opacity: 0.45;
  }

  .agenda-list article.event > a.full-card-link {
    flex: 1 !important;
    min-width: 0 !important;
  }

  .nsk-seen-btn {
    flex-shrink: 0;
    width: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: none;
    border-bottom: 2px solid #000;
    border-left: 2px solid #000;
    background: transparent;
    padding: 0;
    font-size: 1.2rem;
    color: #aaa;
    transition: color 0.15s, background-color 0.15s;
  }

  .nsk-seen-btn:hover {
    background: #f0f0f0;
    color: #000;
  }

  .nsk-seen-btn.nsk-checked {
    color: #348120;
    background: #e8f5e3;
  }

  #nsk-toggle-seen {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--font-size-xs2, 13px);
    background: #000;
    color: #fff;
    border: none;
    padding: 0.5em 1em;
    cursor: pointer;
    border-radius: 2px;
  }
  #nsk-toggle-seen:hover {
    background: #333;
  }

  #nsk-seen-counter {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--font-size-xs2, 13px);
    margin-left: 0.5rem;
    opacity: 0.6;
  }

  section.big-logo-section {
    display: none !important;
  }

  .agenda-overview .header {
    display: none !important;
  }

  .agenda-overview {
    padding-top: calc(var(--headerHeight, 3.2vw) + 2rem) !important;
  }
`);

function updateArticleVisibility(article) {
  const slug = getMovieSlug(article);
  if (!slug) return;
  const isSeen = seenSet.has(slug);
  article.classList.toggle('nsk-seen', isSeen);
  article.classList.toggle('nsk-hidden-seen', isSeen && hideSeen);

  const btn = article.querySelector('.nsk-seen-btn');
  if (btn) {
    btn.classList.toggle('nsk-checked', isSeen);
    btn.innerHTML = isSeen ? '&#10003;' : '&#9675;';
    btn.title = isSeen ? 'Marked as seen' : 'Mark as seen';
  }
}

function updateAllArticles() {
  for (const article of document.querySelectorAll('.agenda-list article.event')) {
    updateArticleVisibility(article);
  }
  updateCounter();
}

function updateCounter() {
  const el = document.getElementById('nsk-seen-counter');
  if (el) el.textContent = `(${seenSet.size} seen)`;
}

function toggleSeen(slug) {
  if (seenSet.has(slug)) {
    seenSet.delete(slug);
  } else {
    seenSet.add(slug);
  }
  saveSeenMovies(seenSet);

  for (const art of document.querySelectorAll('.agenda-list article.event')) {
    if (getMovieSlug(art) === slug) {
      updateArticleVisibility(art);
    }
  }
  updateCounter();
}

function injectCheckbox(article) {
  if (article.querySelector('.nsk-seen-btn')) return;
  const slug = getMovieSlug(article);
  if (!slug) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nsk-seen-btn';
  btn.innerHTML = seenSet.has(slug) ? '&#10003;' : '&#9675;';
  btn.title = seenSet.has(slug) ? 'Marked as seen' : 'Mark as seen';
  if (seenSet.has(slug)) btn.classList.add('nsk-checked');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleSeen(slug);
  });

  article.appendChild(btn);
  updateArticleVisibility(article);
}

function injectToggleButton() {
  if (document.getElementById('nsk-toggle-seen')) return;
  const container = document.querySelector('.agenda-overview .container');
  if (!container) return;

  const filterRow = container.querySelector('.agenda-filter');
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'margin-top: 1rem;';

  const btn = document.createElement('button');
  btn.id = 'nsk-toggle-seen';
  btn.textContent = 'Show seen';
  btn.addEventListener('click', () => {
    hideSeen = !hideSeen;
    btn.textContent = hideSeen ? 'Show seen' : 'Hide seen';
    updateAllArticles();
  });

  const counter = document.createElement('span');
  counter.id = 'nsk-seen-counter';
  counter.textContent = `(${seenSet.size} seen)`;

  wrapper.appendChild(btn);
  wrapper.appendChild(counter);

  if (filterRow) {
    filterRow.appendChild(wrapper);
  } else {
    container.prepend(wrapper);
  }
}

function processArticles() {
  for (const article of document.querySelectorAll('.agenda-list article.event')) {
    injectCheckbox(article);
  }
}

function fixLayout() {
  const list = document.querySelector('.agenda-list');
  if (!list) return;
  list.style.height = 'auto';

  injectToggleButton();
  processArticles();

  const observer = new MutationObserver(() => {
    list.style.height = 'auto';
    for (const article of list.querySelectorAll('article.event')) {
      article.style.transform = 'none';
      article.style.visibility = 'visible';
      article.style.opacity = '1';

      const isFilteredOut = article.getAttribute('aria-hidden') === 'true';
      if (isFilteredOut) {
        article.style.display = 'none';
      } else {
        const slug = getMovieSlug(article);
        const isSeen = slug && seenSet.has(slug);
        article.style.display = (isSeen && hideSeen) ? 'none' : '';
      }

      injectCheckbox(article);
    }
  });

  observer.observe(list, { attributes: true, attributeFilter: ['style', 'aria-hidden'], subtree: true, childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fixLayout);
} else {
  fixLayout();
}
