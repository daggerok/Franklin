#!/usr/bin/env bun
// Validates index.html and app.tsx contain the required contract IDs and keys.
// Same idea as daggerok/WisdomTree's check-index.ts but dependency-free.

import { readFile } from 'node:fs/promises';

const REQUIRED_IDS = [
  'app-subtitle',
  'ticker-count',
  'theme-toggle',
  'search-input',
  'search-clear-btn',
  'tabs-bar',
  'dropzone',
  'dropzone-text',
  'file-input',
  'copy-btn',
  'export-csv-btn',
  'export-txt-btn',
  'reset-btn',
  'blacklist-btn',
  'blacklist-panel',
  'blacklist-input',
  'blacklist-add-btn',
  'blacklist-clear-btn',
  'blacklist-chips',
  'blacklist-empty',
  'selected-tabs-panel',
  'selected-tabs-bar',
  'table-scroll',
  'table-head',
  'table-body',
  'static-load-sentinel',
  'static-load-status',
];

const REQUIRED_APP_STRINGS = [
  'franklin-theme',
  'franklin-selected-etfs',
  'franklin-blacklisted-etfs',
  'franklin-active-fund',
  'api/franklin/index.json',
  'formatDistributionFrequency',
  'exportFileName',
  'WATCHLIST_PAGE_SIZE',
  'DETAIL_TABS',
  'COLUMN_TOOLTIPS',
];

async function main() {
  const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const appTsx = await readFile(new URL('../app.tsx', import.meta.url), 'utf8');

  let ok = true;

  for (const id of REQUIRED_IDS) {
    if (!indexHtml.includes(`id=\"${id}\"`) && !indexHtml.includes(`id='${id}'`)) {
      console.error(`[check] missing id=\"${id}\" in index.html`);
      ok = false;
    }
  }

  for (const needle of REQUIRED_APP_STRINGS) {
    if (!appTsx.includes(needle)) {
      console.error(`[check] missing \"${needle}\" in app.tsx`);
      ok = false;
    }
  }

  // Basic HTML sanity
  if (!indexHtml.includes('<title>Franklin ETF Holdings to Watchlist</title>')) {
    console.error('[check] title mismatch');
    ok = false;
  }

  if (!indexHtml.includes('cdn.tailwindcss.com')) {
    console.error('[check] missing Tailwind CDN');
    ok = false;
  }

  if (!indexHtml.includes('babel.min.js')) {
    console.error('[check] missing Babel standalone');
    ok = false;
  }

  if (!appTsx.includes('function byId')) {
    console.error('[check] missing byId helper');
    ok = false;
  }

  if (ok) {
    console.log('[check] index.html + app.tsx contract OK');
  } else {
    console.error('[check] contract validation failed');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
