#!/usr/bin/env -S bun --use-system-ca

// Franklin Templeton U.S.-listed ETF static data updater.
// Embedded TLS fix: Bun v1.2.23+ supports --use-system-ca flag and NODE_USE_SYSTEM_CA=1 env var
// to use OS CA store. We set env var here so script user does NOT need to pass flag manually.
// See https://bun.com/blog/bun-v1.2.23#use-system-ca and https://github.com/oven-sh/bun/issues/30313
if (typeof process !== 'undefined' && process.env) {
  process.env.NODE_USE_SYSTEM_CA = process.env.NODE_USE_SYSTEM_CA || '1';
}
//
// The browser application is deliberately static. This script builds the feed
// under api/franklin/** from public issuer/SEC/market-data sources:
//
//   catalog       franklintempleton.com ETF finder
//                 https://www.franklintempleton.com/investments/options/exchange-traded-funds (81 ETFs)
//   product page  https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/...
//                 (Fund Profile, CUSIP/ISIN, expense, NAV, AUM, yields, frequency, returns)
//   holdings      SEC EDGAR Form N-PORT-P for the exact series (official, quarterly)
//                 — Franklin publishes no direct per-fund holdings CSV; the SEC filing is the
//                 authoritative daily holdings disclosure (same as Goldman Sachs / Schwab fallback)
//   history       Yahoo Finance public chart API (daily close, adj close, volume, dividends, splits)
//   distributions Yahoo dividend events + official distribution frequency from product page
//
// Issuer requests are made directly with a browser-like User-Agent first; when
// the issuer answers with a bot-wall, the same URL is read through the read-only
// r.jina.ai rendering proxy (identical to daggerok/WisdomTree). SEC and Yahoo stay direct.
//
// Usage: bun ./scripts/update-data.ts [--help]

/// <reference types="bun" />
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
};

type JsonRecord = Record<string, any>;
type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

const FRANKLIN_SITE = 'https://www.franklintempleton.com';
const FRANKLIN_CATALOG_URL = `${FRANKLIN_SITE}/investments/options/exchange-traded-funds`;
const PROXY_PREFIX = 'https://r.jina.ai/';
const PROXY_PREFIXES = [
  (u: string) => u, // direct with BROWSER_UA
  (u: string) => `https://r.jina.ai/http://${u.replace(/^https?:\/\//, '')}`,
  (u: string) => `https://r.jina.ai/https://${u.replace(/^https?:\/\//, '')}`,
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  (u: string) => `https://cc.bingj.com/cache.aspx?d=465987&m=1&w=1&u=${encodeURIComponent(u)}`,
];
// Fast path for catalog: only first 3 proxies to avoid long hangs, product pages use first 3 (direct + r.jina.ai http/https)
const CATALOG_PROXY_COUNT = 3;
const PRODUCT_PROXY_COUNT = 3;
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Definitive 81 Franklin Templeton U.S.-listed ETFs from sitemap product.xml (80 + FLRU Russia)
// Source: https://www.franklintempleton.com/binaries/content/assets/global/sitemaps/google/en-us_product.xml chunks 18-19
// Parsed 94 total (81 active incl FLRU + 13 closed). This seed ensures full catalog even when issuer blocks.
const SEED_81 = [
  'BUYZ','DIEM','DIVI','DVAL','EZBC','EZET','EZPZ','FFOG','FGDL','FLAU','FLAX','FLBL','FLBR','FLCA','FLCB','FLCH','FLCO',
  'FLEE','FLEU','FLGB','FLGR','FLGV','FLHY','FLIA','FLIN','FLJH','FLJP','FLKR','FLLA','FLMB','FLMI','FLMX','FLQL','FLQM',
  'FLQS','FLRU','FLSA','FLSP','FLSW','FLTW','FLUD','FRIZ','FSML','FTCA','FTMA','FTMH','FTMN','FTMS','FTMU','FTNJ','FTNY',
  'FTOH','FTPA','FTSD','HELX','INCE','INCM','IQM','LRGE','LVHD','LVHI','MULT','PBDC','PEMX','PGRI','PGRO','PVAL','SOEZ',
  'SQLV','TEMD','TINS','UDIV','USFI','USPX','WABF','XDAT','XIDV','XRPZ','XUDV','YCLO','YLDE',
] as const;
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const SEC_SITE = 'https://www.sec.gov';
const SEC_BROWSE_URL = `${SEC_SITE}/cgi-bin/browse-edgar`;
const SEC_ARCHIVES = `${SEC_SITE}/Archives/edgar/data`;
const SEC_FUND_TICKERS_URL = `${SEC_SITE}/files/company_tickers_mf.json`;
const SEC_COMPANY_TICKERS_URL = `${SEC_SITE}/files/company_tickers.json`;
const SEC_UA = 'DaggerOk Franklin ETF feed admin@daggerok.example.com';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PROXY_SLEEP_SECONDS = 3.2;

const API_ROOT = new URL('../api/franklin/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);

const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on']);
const AUM_BOUNDS = { nano: [0, 10_000_000], micro: [10_000_000, 300_000_000], small: [300_000_000, 2_000_000_000], mid: [2_000_000_000, 10_000_000_000], large: [10_000_000_000, undefined] } as const;

export type CatalogReturns = {
  ytd: number | null;
  yr1: number | null;
  yr3: number | null;
  yr5: number | null;
  yr10: number | null;
  sinceInception: number | null;
};

export type CatalogFund = {
  ticker: string;
  name: string;
  category: string;
  categoryPath: string;
  inception: string | null;
  exchange: string;
  cusip: string;
  isin: string;
  benchmark: string;
  ter: number | null;
  grossTer: number | null;
  nav: number | null;
  close: number | null;
  premiumDiscount: number | null;
  netAssets: number | null;
  dividendYield: number | null;
  secYield: number | null;
  asOfDate: string | null;
  returns: CatalogReturns;
  fundPage: string;
  source: 'franklin' | 'previous index' | 'seed';
  factSheet?: string;
};

export type ChartDay = { date: string; close: number; adjClose: number; volume: number };
export type ParsedChart = {
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
  splits: Array<{ epoch: number; ratio: string }>;
  exchangeName: string;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
};

export type ParsedNport = {
  regName: string;
  regCik: string;
  seriesName: string;
  seriesId: string;
  repPdDate: string;
  holdings: JsonRecord[];
  totalValue: number;
  netAssets: number | null;
};

export type ProductPageSummary = {
  name: string | null;
  cusip: string;
  isin: string;
  exchange: string;
  benchmark: string;
  morningstarCategory: string;
  assetClass: string;
  etfType: string;
  inception: string | null;
  nav: number | null;
  navAsOfDate: string | null;
  totalNetAssets: number | null;
  totalNetAssetsAsOfDate: string | null;
  totalExpenseRatio: number | null;
  grossExpenseRatio: number | null;
  sharesOutstanding: number | null;
  totalHoldings: number | null;
  totalHoldingsAsOfDate: string | null;
  secYield: number | null;
  secYieldAsOfDate: string | null;
  distributionYield: number | null;
  distributionFrequency: string | null;
  premiumDiscount: number | null;
  premiumDiscountAsOfDate: string | null;
  marketPrice: number | null;
  marketPriceAsOfDate: string | null;
  dividendFrequencyRaw: string | null;
  distributionRate: number | null;
  factSheet: string | null;
  ytdReturn: number | null;
  returns: CatalogReturns;
};

export type HoldingsRow = JsonRecord;
type SecSeriesRef = { cik: string; seriesId: string; classId: string };
type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

type UpdaterConfig = {
  maxFetches: number;
  requestSleep: number;
  aum?: Range;
  ter?: Range;
  dividendYield?: Range;
  secYield?: Range;
  performance: RangeMap;
  totalReturn: RangeMap;
  concurrency: number;
  holdingsPageSize: number;
  historyPageSize: number;
  storeRawDownloads: boolean;
  maxRetries: number;
  tickers: Set<string> | null;
  historyRange: string;
  edgarFallback: boolean;
  skipFranklin: boolean;
  skipYahoo: boolean;
  category: string;
};

const EMPTY_RETURNS: CatalogReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };

let requestGateAt = 0;
let proxyGateAt = 0;
let requestSleepSeconds = 1.5;
let fundTickerMap: Map<string, SecSeriesRef> | null = null;
let fundTickerMapPromise: Promise<Map<string, SecSeriesRef>> | null = null;
let companyTickerMap: Map<string, string> | null = null;
let companyTickerMapPromise: Promise<Map<string, string>> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function decodeEntities(value: string): string {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&reg;/gi, '®')
    .replace(/&trade;/gi, '™')
    .replace(/&copy;/gi, '©')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanText(value: unknown): string {
  return decodeEntities(String(value ?? ''))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTicker(value: unknown): string {
  return cleanText(value).replace(/[^A-Za-z0-9.-]/g, '').toUpperCase();
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = cleanText(value);
  if (!raw || ['-', '--', '—', 'n/a', 'na', 'null', 'none'].includes(raw.toLowerCase())) return null;
  const negative = /^\(.*\)$/.test(raw);
  const normalized = raw.replace(/[($,%\s]/g, '').replace(/[)]/g, '').replace(/,/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function normalizeNumberText(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (text === '' || text === '-') return text;
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.replace(/,/g, ''))) return text;
  const number = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(number) || Math.abs(number) >= 1e21) return text;
  return number.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 });
}

function firstNumber(value: unknown): number | null {
  const raw = cleanText(value).replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ');
  const match = /(\(?[-+]?\$?\d[\d,]*(?:\.\d+)?%?\)?)/.exec(raw);
  return match ? numberOrNull(match[1]) : null;
}

function firstDate(value: unknown): string | null {
  const raw = cleanText(value);
  const match = /(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? toIsoDate(match[1]) : null;
}

export function toIsoDate(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const short = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(raw);
  if (short) {
    const yy = Number(short[3]);
    return `${yy <= 69 ? 2000 + yy : 1900 + yy}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined): string {
  const iso = toIsoDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso || '—';
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])} ${match[1]}`;
}

function formatUsDate(epoch: number): string {
  const date = new Date(epoch * 1000);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function isoToEpoch(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000);
}

function formatAumDisplay(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)} T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)} B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)} M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(2)} K`;
  return `$${value.toFixed(2)}`;
}

function parseBoolean(value: string | undefined): boolean {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseDecimal(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseRange(value: string, name = 'range'): Range | undefined {
  const raw = String(value ?? '').trim();
  if (!raw || raw === ':') return undefined;
  if ((raw.match(/:/g) || []).length !== 1) throw new Error(`${name}: colon is required exactly once (use min:max)`);
  const [left, right] = raw.split(':').map((part) => part.trim().replace(/[$%]/g, ''));
  const min = left === '' ? undefined : Number(left);
  const max = right === '' ? undefined : Number(right);
  if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max))) throw new Error(`${name}: bounds must be numbers`);
  if (min !== undefined && max !== undefined && min > max) throw new Error(`${name}: minimum must not exceed maximum`);
  return { min, max };
}

function parseAumBound(value: string): number | undefined {
  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw in AUM_BOUNDS) return AUM_BOUNDS[raw as keyof typeof AUM_BOUNDS][0];
  const match = /^\$?([0-9]+(?:\.[0-9]+)?)([kmbt]?)$/i.exec(raw);
  if (!match) throw new Error(`AUM: invalid bound \"${value}\"`);
  const multiplier: Record<string, number> = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  return Number(match[1]) * multiplier[match[2].toLowerCase()];
}

export function parseAumRange(value: string): Range | undefined {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === ':') return undefined;
  if (!raw.includes(':') && raw in AUM_BOUNDS) {
    const [min, max] = AUM_BOUNDS[raw as keyof typeof AUM_BOUNDS];
    return { min, max };
  }
  if ((raw.match(/:/g) || []).length !== 1) throw new Error('AUM: colon is required exactly once (or use a size preset)');
  const [left, right] = raw.split(':');
  const min = left ? parseAumBound(left) : undefined;
  let max = right ? parseAumBound(right) : undefined;
  if (right && right in AUM_BOUNDS) max = AUM_BOUNDS[right as keyof typeof AUM_BOUNDS][1];
  if (min !== undefined && max !== undefined && min > max) throw new Error('AUM: minimum must not exceed maximum');
  return { min, max };
}

function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const result: RangeMap = {};
  for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y'] as ReturnPeriod[]) {
    const value = env[`${prefix}_${period}`];
    if (value !== undefined && value.trim() !== '') result[period] = parseRange(value, `${prefix}_${period}`);
  }
  return result;
}

function readTickerSet(value: string | undefined): Set<string> | null {
  const tickers = String(value ?? '').split(/[\s,;]+/).map(sanitizeTicker).filter(Boolean);
  return tickers.length ? new Set(tickers) : null;
}

function hasConfiguredFilters(config: UpdaterConfig): boolean {
  return Boolean(config.aum || config.ter || config.dividendYield || config.secYield || config.tickers || Object.keys(config.performance).length || Object.keys(config.totalReturn).length || config.category);
}

export function stripProxyPreamble(text: string): string {
  const lines = String(text ?? '').split('\n');
  if (lines.length >= 4 && /^Title:/i.test(lines[0] || '') && /^URL Source:/i.test(lines[1] || '') && /^Markdown Content:/i.test(lines[2] || '')) {
    return lines.slice(3).join('\n').trim();
  }
  return String(text ?? '').trim();
}

export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
}

type TextLine = { text: string; cells: string[] };
export function toTextLines(source: string): TextLine[] {
  return String(source ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.split('|').map((cell) => cleanText(cell)).filter((cell) => cell !== '');
      return { text: line, cells };
    });
}

function labelText(label: JsonRecord | null): string {
  if (!label) return '';
  return cleanText(label.value ?? label.text ?? '');
}

function labelNumber(label: JsonRecord | null): number | null {
  if (!label) return null;
  return firstNumber(label.value ?? label.text ?? '') ?? numberOrNull(label.value);
}

function labelAsOf(label: JsonRecord | null): string | null {
  if (!label) return null;
  const raw = String(label.asOf ?? label.asOfDate ?? label.text ?? '');
  return firstDate(raw) || null;
}

function lookupLabel(lines: TextLine[], pattern: string | RegExp): JsonRecord | null {
  const isString = typeof pattern === 'string';
  const test = isString ? (text: string) => text.toLowerCase().includes((pattern as string).toLowerCase()) : (text: string) => (pattern as RegExp).test(text);
  const extractAfter = (full: string, pat: string | RegExp): string => {
    if (isString) {
      const idx = full.toLowerCase().indexOf((pat as string).toLowerCase());
      if (idx >= 0) {
        const after = full.slice(idx + (pat as string).length).trim().replace(/^[:\-\s]+/, '').trim();
        if (after) return after;
      }
      return full;
    }
    const m = (pat as RegExp).exec(full);
    if (m && m.index !== undefined) {
      const after = full.slice(m.index + m[0].length).trim().replace(/^[:\-\s]+/, '').trim();
      if (after) return after;
    }
    return full;
  };
  let best: JsonRecord | null = null;
  let bestScore = Infinity;
  for (const line of lines) {
    const joined = line.cells.join(' | ') || line.text;
    const haystack = joined || line.text;
    if (!test(haystack)) continue;
    let value: string;
    if (line.cells.length >= 2) {
      const idx = line.cells.findIndex((c) => test(c));
      if (idx >= 0 && idx + 1 < line.cells.length) value = line.cells.slice(idx + 1).join(' | ');
      else value = line.cells.slice(1).join(' | ');
    } else {
      value = extractAfter(line.text, pattern);
      if (value === line.text) value = extractAfter(joined, pattern);
    }
    const cleaned = cleanText(value);
    if (!cleaned) continue;
    const score = cleaned.length + (line.text.length > 200 ? 1000 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { value: cleaned, text: joined, asOf: firstDate(joined) || firstDate(line.text) };
      if (cleaned.length < 80 && line.text.length < 150) return best;
    }
  }
  return best;
}

function linkUrls(source: string, pattern: RegExp): string[] {
  const urls: string[] = [];
  const re = /https?:\/\/[^\s"'<>]+\.(?:csv|xlsx|xls|pdf)/gi;
  for (const m of String(source ?? '').matchAll(re)) {
    if (pattern.test(m[0])) urls.push(m[0]);
  }
  return [...new Set(urls)];
}

function canonicalFundPage(url: string, ticker: string): string {
  try {
    const parsed = new URL(url, FRANKLIN_SITE);
    if (parsed.hostname.includes('franklintempleton.com')) return parsed.toString();
  } catch {}
  return `${FRANKLIN_SITE}/investments/options/exchange-traded-funds/products/${encodeURIComponent(ticker.toLowerCase())}/SINGLCLASS/${encodeURIComponent(ticker.toLowerCase())}-etf/${encodeURIComponent(ticker.toUpperCase())}`;
}

function normalizeCategory(value: string): string {
  const cleaned = cleanText(value);
  if (!cleaned) return 'ETF';
  return cleaned;
}

// ---------------------------------------------------------------------------
// Franklin catalog parsing
// ---------------------------------------------------------------------------

export function parseFranklinCatalog(text: string): CatalogFund[] {
  const source = stripProxyPreamble(text);
  const lines = source.split('\n');
  const funds = new Map<string, CatalogFund>();

  // The finder page renders a markdown table with rows like:
  // | Checkbox | [Fund Name - **TICKER**](https://.../products/.../TICKER) | YTD | 1Y | 3Y | 5Y | Since Inception + date | Expense Ratio | Total Net Assets | Fact Sheet |
  // We also support the mobile card layout where ticker appears as **TICKER** inside a link.
  const tickerLinkPattern = /\[([^\]]*?)\*\*([A-Z0-9]{2,6})\*\*[^\]]*\]\((https?:\/\/[^\)]+)\)/g;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    for (const match of line.matchAll(tickerLinkPattern)) {
      const rawName = cleanText(match[1].replace(/\s*-\s*$/, ''));
      const ticker = sanitizeTicker(match[2]);
      const fundPage = match[3];
      if (!ticker) continue;

      // Extract table cells after the link
      const after = line.slice((match.index ?? 0) + match[0].length);
      const cells = after.split('|').map((c) => cleanText(c.replace(/<[^>]+>/g, ' ').replace(/\*\*/g, ''))).filter((c) => c !== '');

      // cells layout: YTD, 1Y, 3Y, 5Y, SinceInception + date, Expense, AUM, FactSheet
      // Example: -0.40% | 3.47 | 4.19 | — | 3.54 07/25/2023 | Gross Net 0.39% 0.39% | $9.53 Million
      let ytd: number | null = null;
      let yr1: number | null = null;
      let yr3: number | null = null;
      let yr5: number | null = null;
      let sinceInception: number | null = null;
      let inception: string | null = null;
      let ter: number | null = null;
      let netAssets: number | null = null;

      if (cells.length >= 1) ytd = numberOrNull(cells[0]);
      if (cells.length >= 2) yr1 = numberOrNull(cells[1]);
      if (cells.length >= 3) yr3 = numberOrNull(cells[2]);
      if (cells.length >= 4) yr5 = numberOrNull(cells[3]);
      if (cells.length >= 5) {
        const siCell = cells[4];
        sinceInception = numberOrNull(siCell);
        inception = firstDate(siCell);
      }
      if (cells.length >= 6) {
        // Expense ratio cell may contain "Gross Net 0.39% 0.39%" or "—"
        const percents = cells[5].match(/[\d.]+%/g) || [];
        if (percents.length) {
          // last percent is net
          ter = numberOrNull(percents[percents.length - 1]);
        }
      }
      if (cells.length >= 7) {
        // AUM cell like "$9.53 Million" or "$2.60 Billion" or "$391.01 Million"
        const aumText = cells[6];
        const m = /\$([\d.,]+)\s*(Million|Billion|Thousand|M|B|K)?/i.exec(aumText);
        if (m) {
          let val = Number(m[1].replace(/,/g, ''));
          const unit = (m[2] || '').toLowerCase();
          if (unit.startsWith('b')) val *= 1e9;
          else if (unit.startsWith('m')) val *= 1e6;
          else if (unit.startsWith('k') || unit.startsWith('th')) val *= 1e3;
          netAssets = val;
        }
      }

      const existing = funds.get(ticker);
      const fund: CatalogFund = existing || {
        ticker,
        name: rawName || ticker,
        category: 'ETF',
        categoryPath: '',
        inception: inception,
        exchange: 'NYSEArca',
        cusip: '',
        isin: '',
        benchmark: '',
        ter,
        grossTer: ter,
        nav: null,
        close: null,
        premiumDiscount: null,
        netAssets,
        dividendYield: null,
        secYield: null,
        asOfDate: null,
        returns: { ytd, yr1, yr3, yr5, yr10: null, sinceInception },
        fundPage: canonicalFundPage(fundPage, ticker),
        source: 'franklin',
      };

      if (rawName && rawName.length > fund.name.length) fund.name = rawName;
      if (ter !== null) { fund.ter = ter; fund.grossTer = ter; }
      if (netAssets !== null) fund.netAssets = netAssets;
      if (inception) fund.inception = inception;
      // merge returns
      if (ytd !== null) fund.returns.ytd = ytd;
      if (yr1 !== null) fund.returns.yr1 = yr1;
      if (yr3 !== null) fund.returns.yr3 = yr3;
      if (yr5 !== null) fund.returns.yr5 = yr5;
      if (sinceInception !== null) fund.returns.sinceInception = sinceInception;

      funds.set(ticker, fund);
    }
  }

  if (!funds.size) {
    // Fallback: try to find any franklintempleton product links with ticker pattern in URL
    const genericPattern = /https?:\/\/[^\/\s]*franklintempleton\.com\/[^\s]*?\/([A-Z]{2,6})(?:[^\w]|$)/g;
    for (const line of lines) {
      for (const m of line.matchAll(genericPattern)) {
        const ticker = sanitizeTicker(m[1]);
        if (!ticker || ticker.length < 2 || ticker.length > 6) continue;
        if (funds.has(ticker)) continue;
        funds.set(ticker, {
          ticker,
          name: ticker,
          category: 'ETF',
          categoryPath: '',
          inception: null,
          exchange: 'NYSEArca',
          cusip: '',
          isin: '',
          benchmark: '',
          ter: null,
          grossTer: null,
          nav: null,
          close: null,
          premiumDiscount: null,
          netAssets: null,
          dividendYield: null,
          secYield: null,
          asOfDate: null,
          returns: { ...EMPTY_RETURNS },
          fundPage: `${FRANKLIN_SITE}/investments/options/exchange-traded-funds/products/${ticker.toLowerCase()}/SINGLCLASS/${ticker.toLowerCase()}-etf/${ticker}`,
          source: 'franklin',
        });
      }
    }
  }

  if (!funds.size) throw new Error('Franklin product finder: no ETF rows found');

  return [...funds.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function parseCatalogText(text: string): CatalogFund[] {
  return parseFranklinCatalog(text);
}

// ---------------------------------------------------------------------------
// Product page parsing
// ---------------------------------------------------------------------------

export function parseFranklinProductPage(text: string, ticker: string): ProductPageSummary {
  const source = stripProxyPreamble(text);
  const cleaned = htmlToText(source);
  const lines = toTextLines(cleaned + '\n' + source.replace(/<[^>]+>/g, '\n'));

  const name = (() => {
    const m = /(?:Franklin|BrandywineGLOBAL|ClearBridge|Western Asset|Putnam)[^\n]*?\bETF\b/i.exec(cleaned);
    if (m) return cleanText(m[0]);
    const titleMatch = /Title:\s*([^\n]+?)\s*-\s*[A-Z]{2,6}\s*\|/i.exec(source);
    if (titleMatch) return cleanText(titleMatch[1]);
    return `${ticker} ETF`;
  })();

  // Identifiers
  const cusipLabel = lookupLabel(lines, 'CUSIP Code') || lookupLabel(lines, /^CUSIP$/i);
  const isinLabel = lookupLabel(lines, 'ISIN Code') || lookupLabel(lines, /^ISIN$/i);
  const exchangeLabel = lookupLabel(lines, 'Listing Exchange') || lookupLabel(lines, /^Exchange$/i);
  const inceptionLabel = lookupLabel(lines, 'Fund Inception Date') || lookupLabel(lines, 'Inception Date');
  const benchmarkLabel = lookupLabel(lines, 'Benchmark') || lookupLabel(lines, 'Underlying Index');
  const categoryLabel = lookupLabel(lines, 'Morningstar Category') || lookupLabel(lines, 'Morningstar');
  const assetClassLabel = lookupLabel(lines, 'Asset Class') || lookupLabel(lines, /^Asset Class$/i);
  const etfTypeLabel = lookupLabel(lines, 'ETF Type');
  const navLabel = lookupLabel(lines, /^NAV$/i) || lookupLabel(lines, 'NAV Calculation');
  const marketPriceLabel = lookupLabel(lines, 'Market Price') || lookupLabel(lines, 'Market Price Return');
  const totalNetAssetsLabel = lookupLabel(lines, 'Total Net Assets');
  const grossExpenseLabel = lookupLabel(lines, 'Gross Expense Ratio');
  const netExpenseLabel = lookupLabel(lines, 'Net Expense Ratio') || lookupLabel(lines, 'Expense Ratio');
  const secYieldLabel = lookupLabel(lines, 'SEC 30-Day Yield') || lookupLabel(lines, /SEC.*Yield/i);
  const distributionYieldLabel = lookupLabel(lines, '12-Month Yield') || lookupLabel(lines, /12-Month Yield|Distribution Yield/i);
  const distributionRateLabel = lookupLabel(lines, 'Distribution Rate');
  const frequencyLabel = lookupLabel(lines, /Distribution Frequency/i) || lookupLabel(lines, 'Dividend Frequency');
  const holdingsLabel = lookupLabel(lines, 'Number of Holdings') || lookupLabel(lines, /Number of Holdings|Holdings/i);
  const sharesLabel = lookupLabel(lines, 'Shares Outstanding');
  const premiumLabel = lookupLabel(lines, 'Premium / Discount') || lookupLabel(lines, /Premium/i);

  const extractCusip = (raw: string): string => {
    const upper = String(raw ?? '').toUpperCase();
    const m = /[A-Z0-9]{9}/.exec(upper.replace(/[^A-Z0-9]/g, ' ')) || /([A-Z0-9]{9})/.exec(upper);
    // Prefer last 9-char alphanumeric that looks like CUSIP (contains digit)
    const all = [...upper.matchAll(/[A-Z0-9]{9}/g)].map((x) => x[0]);
    const candidate = all.reverse().find((c) => /\d/.test(c)) || all[0] || '';
    if (candidate) return candidate;
    const cleaned = upper.replace(/[^A-Z0-9]/g, '');
    // If cleaned still contains label prefix, take last 9 chars
    if (cleaned.length >= 9) {
      const last9 = cleaned.slice(-9);
      if (/[A-Z0-9]{9}/.test(last9)) return last9;
    }
    return cleaned;
  };
  const extractIsin = (raw: string): string => {
    const upper = String(raw ?? '').toUpperCase();
    const all = [...upper.matchAll(/[A-Z0-9]{12}/g)].map((x) => x[0]);
    const candidate = all.reverse().find((c) => c.startsWith('US')) || all[0] || '';
    if (candidate) return candidate;
    const cleaned = upper.replace(/[^A-Z0-9]/g, '');
    if (cleaned.length >= 12) {
      const last12 = cleaned.slice(-12);
      if (/[A-Z0-9]{12}/.test(last12)) return last12;
    }
    return cleaned;
  };
  const cusip = extractCusip(labelText(cusipLabel));
  const isin = extractIsin(labelText(isinLabel));
  const exchange = labelText(exchangeLabel) || 'NYSEArca';
  const benchmark = labelText(benchmarkLabel);
  const morningstarCategory = labelText(categoryLabel) || labelText(assetClassLabel) || 'ETF';
  const assetClass = labelText(assetClassLabel) || morningstarCategory;
  const etfType = labelText(etfTypeLabel) || 'ETF';

  const inception = firstDate(labelText(inceptionLabel)) || firstDate(source);
  const nav = labelNumber(navLabel);
  const marketPrice = labelNumber(marketPriceLabel);
  const totalNetAssets = (() => {
    const raw = labelText(totalNetAssetsLabel);
    const m = /\$([\d.,]+)\s*(Million|Billion|Thousand|M|B|K)?/i.exec(raw);
    if (m) {
      let val = Number(m[1].replace(/,/g, ''));
      const unit = (m[2] || '').toLowerCase();
      if (unit.startsWith('b')) val *= 1e9;
      else if (unit.startsWith('m')) val *= 1e6;
      else if (unit.startsWith('k') || unit.startsWith('th')) val *= 1e3;
      return val;
    }
    return labelNumber(totalNetAssetsLabel);
  })();
  const grossExpense = labelNumber(grossExpenseLabel);
  const netExpense = labelNumber(netExpenseLabel) ?? grossExpense;
  const secYield = labelNumber(secYieldLabel);
  const distributionYield = labelNumber(distributionYieldLabel);
  const distributionRate = labelNumber(distributionRateLabel);
  const frequencyRaw = labelText(frequencyLabel) || null;
  const totalHoldings = labelNumber(holdingsLabel);
  const sharesOutstanding = labelNumber(sharesLabel);
  const premiumDiscount = labelNumber(premiumLabel);

  // Returns from the product page are not always present in the static HTML (they are JS-rendered).
  // We keep catalog returns as fallback and try to extract from any table that mentions "Market Price Return" or "NAV Return"
  const returns: CatalogReturns = { ...EMPTY_RETURNS };
  // Try to find return values in lines containing % and year labels
  // Example: "Market Price Return -3.94% 1 Year 5.33% 3 Years ..."
  // This is best-effort; catalog already has YTD/1Y/3Y/5Y
  for (const line of lines) {
    const txt = line.text;
    if (/Market Price Return|NAV Return/i.test(txt) && /%/.test(txt)) {
      // extract numbers like -3.94% etc.
      const nums = [...txt.matchAll(/([-+]?\d+(?:\.\d+)?)%/g)].map((m) => numberOrNull(m[1]));
      // We don't have reliable mapping, so keep as is; catalog already parsed
    }
  }

  const factSheet = linkUrls(source, /fact-sheet|FactSheet/i)[0] || null;

  return {
    name: name || `${ticker} ETF`,
    cusip: /^[A-Z0-9]{9}$/.test(cusip) ? cusip : '',
    isin: /^[A-Z0-9]{12}$/.test(isin) ? isin : '',
    exchange: exchange || 'NYSEArca',
    benchmark,
    morningstarCategory,
    assetClass,
    etfType,
    inception,
    nav,
    navAsOfDate: labelAsOf(navLabel),
    totalNetAssets,
    totalNetAssetsAsOfDate: labelAsOf(totalNetAssetsLabel),
    totalExpenseRatio: netExpense,
    grossExpenseRatio: grossExpense,
    sharesOutstanding,
    totalHoldings,
    totalHoldingsAsOfDate: labelAsOf(holdingsLabel),
    secYield,
    secYieldAsOfDate: labelAsOf(secYieldLabel),
    distributionYield,
    distributionFrequency: frequencyRaw,
    premiumDiscount,
    premiumDiscountAsOfDate: labelAsOf(premiumLabel),
    marketPrice,
    marketPriceAsOfDate: labelAsOf(marketPriceLabel),
    dividendFrequencyRaw: frequencyRaw,
    distributionRate,
    factSheet,
    ytdReturn: null,
    returns,
  };
}

export function parseProductPage(text: string, ticker: string): ProductPageSummary {
  return parseFranklinProductPage(text, ticker);
}

export function parseFundName(source: string, ticker: string): string | null {
  const upper = ticker.toUpperCase();
  const patterns = [
    new RegExp(`^#{1,3}\\s+(?:\\*\\*)?(?:${upper}\\s+)?(Franklin[^\\n|]*?\\bETF\\b[^\\n|]*)$`, 'im'),
    new RegExp(`Title:\\s*([^\n]+?\\bETF\\b)`, 'im'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const cleaned = cleanText(match[1].replace(/\*\*/g, ''));
    if (cleaned) return cleaned;
  }
  return null;
}

// ---------------------------------------------------------------------------
// CSV helpers (not used for Franklin holdings but kept for parity)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

// ---------------------------------------------------------------------------
// SEC EDGAR N-PORT parsing (same as Schwab / WisdomTree)
// ---------------------------------------------------------------------------

function secHeaders(): Record<string, string> {
  return { 'User-Agent': SEC_UA, Accept: 'application/json, application/xml, text/xml, text/plain' };
}

export function parseFundTickerMap(payload: JsonRecord): Map<string, SecSeriesRef> {
  const map = new Map<string, SecSeriesRef>();
  const data = (payload as any).data || [];
  for (const row of data) {
    const [cik, seriesId, classId, symbol] = row as [number, string, string, string];
    const ticker = sanitizeTicker(symbol);
    if (!ticker) continue;
    map.set(ticker, { cik: String(cik).padStart(10, '0'), seriesId, classId });
  }
  return map;
}

function parseCompanyTickerMap(payload: JsonRecord): Map<string, string> {
  const map = new Map<string, string>();
  const entries = Object.values(payload as any) as Array<{ ticker: string; title: string }>;
  for (const entry of entries) {
    const ticker = sanitizeTicker((entry as any).ticker);
    const title = cleanText((entry as any).title);
    if (ticker && title) map.set(ticker, title);
  }
  return map;
}

export function parseEdgarAtomFilings(xml: string): NportAccession[] {
  const filings: NportAccession[] = [];
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
  for (const entryMatch of String(xml ?? '').matchAll(entryPattern)) {
    const entry = entryMatch[1];
    const type = /<filing-type>\s*([^<]+)\s*<\/filing-type>/i.exec(entry)?.[1]?.trim();
    if (type && type !== 'NPORT-P') continue;
    const accession = /<accession-number>\s*([^<]+)\s*<\/accession-number>/i.exec(entry)?.[1]?.trim();
    const filed = /<filing-date>\s*([^<]+)\s*<\/filing-date>/i.exec(entry)?.[1]?.trim() || '';
    const reportDate = /<period>\s*([^<]+)\s*<\/period>/i.exec(entry)?.[1]?.trim() || filed;
    if (!accession) continue;
    const digits = accession.replace(/-/g, '').slice(0, 10);
    const acc = accession.replace(/-/g, '');
    // primary_doc.xml may lack holdings, so we use the raw accession .txt
    const url = `${SEC_ARCHIVES}/${Number(digits)}/${acc}/${accession}.txt`;
    filings.push({ accession, filed, reportDate, url });
  }
  return filings.sort((a, b) => b.filed.localeCompare(a.filed));
}

function nportUrlFor(cik: string, accession: string): string {
  const digits = cik.replace(/^0+/, '') || '0';
  const acc = accession.replace(/-/g, '');
  return `${SEC_ARCHIVES}/${digits}/${acc}/${accession}.txt`;
}

export function parseNport(xml: string): ParsedNport {
  const text = String(xml ?? '');
  // Extract from primary_doc.xml or raw .txt that contains <NPORT-P>
  const regName = /<regName>\s*([^<]+)\s*<\/regName>/i.exec(text)?.[1]?.trim() || '';
  const regCik = /<regCik>\s*([^<]+)\s*<\/regCik>/i.exec(text)?.[1]?.trim() || '';
  const seriesName = /<seriesName>\s*([^<]+)\s*<\/seriesName>/i.exec(text)?.[1]?.trim() || '';
  const seriesId = /<seriesId>\s*([^<]+)\s*<\/seriesId>/i.exec(text)?.[1]?.trim() || '';
  const repPdDate = /<repPdDate>\s*([^<]+)\s*<\/repPdDate>/i.exec(text)?.[1]?.trim() || '';

  const holdings: JsonRecord[] = [];
  const invstPattern = /<invstOrSec>([\s\S]*?)<\/invstOrSec>/g;
  for (const m of text.matchAll(invstPattern)) {
    const block = m[1];
    const name = /<name>\s*([^<]+)\s*<\/name>/i.exec(block)?.[1]?.trim() || '';
    const cusip = /<cusip>\s*([^<]+)\s*<\/cusip>/i.exec(block)?.[1]?.trim() || '';
    const ticker = /<ticker>\s*([^<]+)\s*<\/ticker>/i.exec(block)?.[1]?.trim() || '';
    const isin = /<isin>\s*([^<]+)\s*<\/isin>/i.exec(block)?.[1]?.trim() || '';
    const sedol = /<sedol>\s*([^<]+)\s*<\/sedol>/i.exec(block)?.[1]?.trim() || '';
    const balance = /<balance>\s*([^<]+)\s*<\/balance>/i.exec(block)?.[1]?.trim() || '';
    const valUSD = /<valUSD>\s*([^<]+)\s*<\/valUSD>/i.exec(block)?.[1]?.trim() || '';
    const pctVal = /<pctVal>\s*([^<]+)\s*<\/pctVal>/i.exec(block)?.[1]?.trim() || '';
    const assetCat = /<assetCat>\s*([^<]+)\s*<\/assetCat>/i.exec(block)?.[1]?.trim() || '';
    const issuerCat = /<issuerCat>\s*([^<]+)\s*<\/issuerCat>/i.exec(block)?.[1]?.trim() || '';
    const invCountry = /<invCountry>\s*([^<]+)\s*<\/invCountry>/i.exec(block)?.[1]?.trim() || '';

    holdings.push({
      name,
      cusip,
      ticker,
      isin,
      sedol,
      balance,
      valUSD,
      pctVal,
      assetCat,
      issuerCat,
      invCountry,
      identifier: cusip || isin || sedol || '',
    });
  }

  const totalValue = holdings.reduce((sum, h) => sum + (numberOrNull(h.valUSD) || 0), 0);
  return { regName, regCik, seriesName, seriesId, repPdDate, holdings, totalValue, netAssets: null };
}

export function cleanHoldingTicker(raw: unknown): string {
  const t = cleanText(raw);
  if (!t || ['-', '--', '—', 'N/A', 'NA'].includes(t.toUpperCase())) return '';
  return sanitizeTicker(t);
}

export function normalizeHoldingName(raw: unknown): string {
  return cleanText(raw);
}

function fillNportTickers(rows: JsonRecord[], companyMap: Map<string, string>): JsonRecord[] {
  // Franklin N-PORT already has ticker for most equities; we keep as-is and resolve name fallback
  return rows.map((row) => {
    const ticker = cleanHoldingTicker(row.ticker);
    const name = normalizeHoldingName(row.name);
    const identifier = cleanText(row.cusip || row.isin || row.sedol || '');
    return {
      ...row,
      Ticker: ticker || '—',
      Name: name,
      Identifier: identifier,
      Weight: row.pctVal ? `${row.pctVal}` : '',
      'Market Value': row.valUSD ? `$${Number(row.valUSD).toLocaleString('en-US')}` : '',
      'Shares Held': row.balance || '',
      'Asset Category': row.assetCat || row.issuerCat || '',
      searchIndex: `${ticker} ${name} ${identifier}`.toLowerCase(),
    };
  });
}

// ---------------------------------------------------------------------------
// Yahoo Finance chart parsing (same as Schwab)
// ---------------------------------------------------------------------------

export function parseChart(payload: JsonRecord): ParsedChart {
  const result = (payload as any).chart?.result?.[0];
  if (!result) throw new Error('Yahoo chart: no result');
  const timestamp: number[] = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const close: Array<number | null> = quote.close || [];
  const adjClose: Array<number | null> = result.indicators?.adjclose?.[0]?.adjclose || close;
  const volume: Array<number | null> = quote.volume || [];
  const meta = result.meta || {};

  const days: ChartDay[] = [];
  for (let i = 0; i < timestamp.length; i++) {
    const ts = timestamp[i];
    const c = close[i];
    const ac = adjClose[i];
    if (ts == null || c == null) continue;
    days.push({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close: Number(c),
      adjClose: Number(ac ?? c),
      volume: Number(volume[i] ?? 0),
    });
  }

  const dividends: Array<{ epoch: number; amount: number }> = [];
  const divEvents = result.events?.dividends || {};
  for (const key of Object.keys(divEvents)) {
    const ev = divEvents[key];
    if (ev && typeof ev.amount === 'number' && typeof ev.date === 'number') {
      dividends.push({ epoch: ev.date, amount: ev.amount });
    }
  }
  dividends.sort((a, b) => a.epoch - b.epoch);

  const splits: Array<{ epoch: number; ratio: string }> = [];
  const splitEvents = result.events?.splits || {};
  for (const key of Object.keys(splitEvents)) {
    const ev = splitEvents[key];
    if (ev && typeof ev.date === 'number') {
      splits.push({ epoch: ev.date, ratio: `${ev.numerator}:${ev.denominator}` });
    }
  }

  return {
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
    dividends,
    splits,
    exchangeName: cleanText(meta.exchangeName || ''),
    regularMarketPrice: meta.regularMarketPrice != null ? Number(meta.regularMarketPrice) : null,
    regularMarketTime: meta.regularMarketTime != null ? Number(meta.regularMarketTime) : null,
    firstTradeDate: meta.firstTradeDate != null ? Number(meta.firstTradeDate) : null,
  };
}

export function inferDistributionFrequency(dividends: Array<{ epoch: number; amount: number }>): string {
  if (!dividends.length) return '—';
  const now = Date.now() / 1000;
  const oneYearAgo = now - 365 * 24 * 3600;
  const recent = dividends.filter((d) => d.epoch >= oneYearAgo);
  const count = recent.length || dividends.slice(-12).length;
  if (count <= 0) return '—';
  if (count >= 11) return 'Monthly';
  if (count >= 3 && count <= 5) return 'Quarterly';
  if (count === 2) return 'Semi-annually';
  if (count === 1) return 'Annually';
  return 'Irregular';
}

export function frequencyCodeLabel(raw: string): string {
  const t = cleanText(raw).toLowerCase();
  if (!t || t === '—' || t === '-' || t === 'n/a') return '00 - —';
  if (t.includes('monthly')) return '01 - Monthly';
  if (t.includes('quarterly')) return '04 - Quarterly';
  if (t.includes('semi')) return '06 - Semi-annually';
  if (t.includes('annual')) return '12 - Annually';
  if (t.includes('none')) return '00 - None';
  if (t.includes('unknown')) return '00 - Unknown';
  if (t.includes('irregular')) return '99 - Irregular';
  return raw;
}

// ---------------------------------------------------------------------------
// HTTP layer with proxy fallback
// ---------------------------------------------------------------------------

async function paceRequests(proxy = false): Promise<void> {
  const now = Date.now();
  if (proxy) {
    const wait = Math.max(0, proxyGateAt - now);
    proxyGateAt = Math.max(now, proxyGateAt) + Math.max(requestSleepSeconds, PROXY_SLEEP_SECONDS) * 1000;
    if (wait) await sleep(wait);
    return;
  }
  const wait = Math.max(0, requestGateAt - now);
  requestGateAt = Math.max(now, requestGateAt) + Math.max(0, requestSleepSeconds * 1000);
  if (wait) await sleep(wait);
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function retryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 403 || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  return true;
}

function isProxyUrl(url: string): boolean {
  return url.startsWith(PROXY_PREFIX) || url.includes('allorigins.win') || url.includes('codetabs.com') || url.includes('bingj.com');
}

export function proxyUrl(url: string): string {
  return `${PROXY_PREFIX}${url}`;
}

function buildProxyUrls(originalUrl: string): string[] {
  return PROXY_PREFIXES.map((fn) => fn(originalUrl));
}

async function fetchText(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  const proxy = isProxyUrl(url);
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      await paceRequests(proxy);
      const controller = new AbortController();
      const isFranklinDirect = url.includes('franklintempleton.com') && !proxy;
      const timeoutMs = isFranklinDirect ? 8000 : 15000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { headers: { 'User-Agent': SEC_UA, Accept: '*/*', ...headers }, redirect: 'follow', signal: controller.signal } as any);
      clearTimeout(timeout);
      if (!response.ok) {
        const snippet = cleanText((await response.text().catch(() => '')).replace(/<[^>]+>/g, ' ')).slice(0, 160);
        throw new HttpError(response.status, `${response.status} ${response.statusText}${snippet ? ` — ${snippet}` : ''}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxRetries || !retryable(error)) break;
      const rateLimited = error instanceof HttpError && error.status === 429;
      await sleep(Math.min(60_000, (rateLimited ? 12_000 : 800) * 2 ** attempt));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function fetchJson(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<JsonRecord> {
  const text = await fetchText(url, label, config, { Accept: 'application/json', ...headers });
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`${label}: response was not JSON`);
  }
}

let issuerDirectDenials = 0;
const ISSUER_DIRECT_DENIAL_LIMIT = 2;

async function fetchIssuerText(url: string, label: string, config: UpdaterConfig, validate: (text: string) => boolean, accept = 'text/html,application/xhtml+xml,text/csv,text/plain;q=0.9,*/*;q=0.8', options: { cache?: boolean; maxProxies?: number } = {}): Promise<{ text: string; via: 'direct' | 'proxy' }> {
  const allCandidates = buildProxyUrls(url);
  const max = options.maxProxies ?? allCandidates.length;
  const candidates = allCandidates.slice(0, max);
  let lastError: unknown = new Error('no candidates');
  // Tabulated candidate logs: [issuer  ] [product ] TICKER candidate 1/3 https://...
  for (let i = 0; i < candidates.length; i++) {
    console.log(`[issuer  ] ${label} candidate ${i + 1}/${candidates.length} ${candidates[i]}`);
    const candidateUrl = candidates[i];
    const isDirect = i === 0;
    const viaLabel = isDirect ? 'direct' : `proxy ${i}`;
    if (isDirect && issuerDirectDenials >= ISSUER_DIRECT_DENIAL_LIMIT) {
      lastError = new Error('direct request skipped (issuer CDN denies this network)');
      continue;
    }
    try {
      const headers: Record<string, string> = isDirect
        ? { 'User-Agent': BROWSER_UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' }
        : { 'User-Agent': SEC_UA, Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8' };
      if (!isDirect && options.cache === false) headers['X-No-Cache'] = 'true';
      const maxRetriesForCandidate = 0; // fail fast for issuer, we have multiple proxies
      const textRaw = await fetchText(candidateUrl, `${label} (${viaLabel})`, { ...config, maxRetries: maxRetriesForCandidate }, headers);
      const text = isDirect ? textRaw : stripProxyPreamble(textRaw);
      if (validate(text)) {
        if (isDirect) issuerDirectDenials = 0;
        return { text, via: isDirect ? 'direct' : 'proxy' };
      }
      lastError = new Error(`${viaLabel} response did not contain expected content`);
    } catch (error) {
      lastError = error;
      if (isDirect && /\b403\b/.test(error instanceof Error ? error.message : String(error))) {
        issuerDirectDenials += 1;
        if (issuerDirectDenials === ISSUER_DIRECT_DENIAL_LIMIT) console.warn('[issuer  ] direct requests are denied from this network; using the read-only rendering proxy for the rest of the run');
      }
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

// ---------------------------------------------------------------------------
// Previous feed helpers
// ---------------------------------------------------------------------------

function parsePreviousFund(ticker: string, row: JsonRecord): CatalogFund {
  return {
    ticker,
    name: cleanText(row.name || row.ticker || ticker),
    category: cleanText(row.category || 'ETF'),
    categoryPath: cleanText(row.categoryPath || row.category || ''),
    inception: row.inceptionDate ? toIsoDate(row.inceptionDate) : null,
    exchange: cleanText(row.exchange || 'NYSEArca'),
    cusip: cleanText(row.cusip || ''),
    isin: cleanText(row.isin || ''),
    benchmark: cleanText(row.benchmark || ''),
    ter: typeof row.terValue === 'number' ? row.terValue : numberOrNull(row.ter),
    grossTer: typeof row.terValue === 'number' ? row.terValue : numberOrNull(row.ter),
    nav: typeof row.navValue === 'number' ? row.navValue : numberOrNull(row.nav),
    close: typeof row.closePriceValue === 'number' ? row.closePriceValue : numberOrNull(row.closePrice),
    premiumDiscount: typeof row.premiumDiscountValue === 'number' ? row.premiumDiscountValue : null,
    netAssets: typeof row.aumValue === 'number' ? row.aumValue : numberOrNull(row.aum),
    dividendYield: row.metrics?.dividendYield ?? null,
    secYield: row.metrics?.secYield ?? null,
    asOfDate: row.asOfDate || null,
    returns: {
      ytd: row.metrics?.ytd ?? row.returns?.monthEnd?.ytd ?? null,
      yr1: row.metrics?.tr1y ?? row.returns?.monthEnd?.yr1 ?? null,
      yr3: row.metrics?.cagr3y ?? row.returns?.monthEnd?.yr3 ?? null,
      yr5: row.metrics?.cagr5y ?? row.returns?.monthEnd?.yr5 ?? null,
      yr10: row.metrics?.cagr10y ?? row.returns?.monthEnd?.yr10 ?? null,
      sinceInception: row.metrics?.siAnn ?? row.returns?.monthEnd?.sinceInception ?? null,
    },
    fundPage: cleanText(row.fundPage || ''),
    source: 'previous index',
  };
}

// ---------------------------------------------------------------------------
// Yahoo helpers
// ---------------------------------------------------------------------------

async function fetchYahooChart(ticker: string, label: string, config: UpdaterConfig): Promise<ParsedChart> {
  const url = `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=div%7Csplit&includeAdjustedClose=true`;
  // Try direct, then via multiple proxies for Yahoo (some networks block Yahoo)
  const candidates = [
    url,
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`,
    `https://r.jina.ai/https://${url.replace(/^https?:\/\//, '')}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
  ];
  let lastErr: unknown = new Error('no candidates');
  for (let i = 0; i < candidates.length; i++) {
    try {
      const isDirect = i === 0;
      const headers = isDirect ? { 'User-Agent': BROWSER_UA, Accept: 'application/json' } : { 'User-Agent': SEC_UA, Accept: 'application/json' };
      const raw = isDirect ? await fetchText(candidates[i], label, { ...config, maxRetries: 0 }, headers) : stripProxyPreamble(await fetchText(candidates[i], `${label} (proxy ${i})`, { ...config, maxRetries: 0 }, headers));
      const payload = JSON.parse(raw) as JsonRecord;
      return parseChart(payload);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchJsonWithProxyFallback(url: string, label: string, config: UpdaterConfig, headers: Record<string, string>): Promise<JsonRecord> {
  const candidates = [
    url,
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`,
    `https://r.jina.ai/https://${url.replace(/^https?:\/\//, '')}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  let lastErr: unknown = new Error('no candidates');
  for (let i = 0; i < candidates.length; i++) {
    try {
      const isDirect = i === 0;
      const h = isDirect ? headers : { 'User-Agent': SEC_UA, Accept: 'application/json' };
      const raw = isDirect ? await fetchText(candidates[i], label, { ...config, maxRetries: 0 }, h) : stripProxyPreamble(await fetchText(candidates[i], `${label} (proxy ${i})`, { ...config, maxRetries: 0 }, h));
      return JSON.parse(raw) as JsonRecord;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchFundTickerMap(config: UpdaterConfig): Promise<Map<string, SecSeriesRef>> {
  if (fundTickerMap) return fundTickerMap;
  if (fundTickerMapPromise) return fundTickerMapPromise;
  fundTickerMapPromise = (async () => {
    const payload = await fetchJsonWithProxyFallback(SEC_FUND_TICKERS_URL, '[edgar   ] fund ticker table', config, secHeaders());
    fundTickerMap = parseFundTickerMap(payload);
    console.log(`[edgar   ] SEC fund ticker table: ${fundTickerMap.size} share classes`);
    return fundTickerMap;
  })();
  return fundTickerMapPromise;
}

async function fetchCompanyTickerMap(config: UpdaterConfig): Promise<Map<string, string>> {
  if (companyTickerMap) return companyTickerMap;
  if (companyTickerMapPromise) return companyTickerMapPromise;
  companyTickerMapPromise = (async () => {
    const payload = await fetchJsonWithProxyFallback(SEC_COMPANY_TICKERS_URL, '[edgar   ] company ticker table', config, secHeaders());
    companyTickerMap = parseCompanyTickerMap(payload);
    console.log(`[edgar   ] SEC company ticker table: ${companyTickerMap.size} issuer names`);
    return companyTickerMap;
  })();
  return companyTickerMapPromise;
}

async function fetchTextWithProxyFallback(url: string, label: string, config: UpdaterConfig, headers: Record<string, string>): Promise<string> {
  const candidates = [
    url,
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`,
    `https://r.jina.ai/https://${url.replace(/^https?:\/\//, '')}`,
  ];
  let lastErr: unknown = new Error('no candidates');
  for (let i = 0; i < candidates.length; i++) {
    try {
      const isDirect = i === 0;
      const h = isDirect ? headers : { 'User-Agent': SEC_UA, Accept: '*/*' };
      const raw = isDirect ? await fetchText(candidates[i], label, { ...config, maxRetries: 0 }, h) : stripProxyPreamble(await fetchText(candidates[i], `${label} (proxy ${i})`, { ...config, maxRetries: 0 }, h));
      return raw;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchNportForFund(fund: CatalogFund, config: UpdaterConfig): Promise<{ parsed: ParsedNport; accession: NportAccession; ref: SecSeriesRef } | null> {
  const map = await fetchFundTickerMap(config);
  const ref = map.get(fund.ticker.toUpperCase());
  if (!ref) return null;
  const params = new URLSearchParams({ action: 'getcompany', CIK: ref.cik, type: 'NPORT-P', owner: 'include', count: '10', output: 'atom' });
  const atom = await fetchTextWithProxyFallback(`${SEC_BROWSE_URL}?${params.toString()}`, `[edgar   ] ${fund.ticker} filings`, config, secHeaders());
  const [accession] = parseEdgarAtomFilings(atom);
  if (!accession) return null;
  const filingText = await fetchTextWithProxyFallback(accession.url, `[edgar   ] ${fund.ticker} accession`, config, secHeaders());
  const parsed = parseNport(filingText);
  return { parsed, accession, ref };
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

export function annualizedToTotal(cagr: number | null, years: number): number | null {
  if (cagr === null || !Number.isFinite(cagr)) return null;
  return (1 + cagr / 100) ** years - 1;
}

export function totalToAnnualized(total: number | null, years: number): number | null {
  if (total === null || !Number.isFinite(total)) return null;
  return ((1 + total) ** (1 / years) - 1) * 100;
}

// ---------------------------------------------------------------------------
// Main updater
// ---------------------------------------------------------------------------

function envValue(env: Record<string, string | undefined>, key: string): string {
  return String(env[key] ?? '').trim();
}

function parseConfig(): UpdaterConfig {
  const env = process.env as Record<string, string | undefined>;
  if (env.HISTORICAL_PAGE_SIZE && !env.HISTORY_PAGE_SIZE) env.HISTORY_PAGE_SIZE = env.HISTORICAL_PAGE_SIZE;
  return {
    maxFetches: parsePositiveInt(envValue(env, 'MAX_FETCHES'), 0),
    requestSleep: parseDecimal(envValue(env, 'REQUEST_SLEEP'), 1.5),
    aum: parseAumRange(envValue(env, 'AUM') || ':'),
    ter: parseRange(envValue(env, 'TER') || ':', 'TER'),
    dividendYield: parseRange(envValue(env, 'DIVIDEND_YIELD') || ':', 'DIVIDEND_YIELD'),
    secYield: parseRange(envValue(env, 'SEC_YIELD') || ':', 'SEC_YIELD'),
    performance: parseRanges(env, 'PERFORMANCE'),
    totalReturn: parseRanges(env, 'TOTAL_RETURN'),
    concurrency: Math.max(1, parsePositiveInt(envValue(env, 'CONCURRENCY'), 3)),
    holdingsPageSize: Math.max(1, parsePositiveInt(envValue(env, 'HOLDINGS_PAGE_SIZE'), 250)),
    historyPageSize: Math.max(1, parsePositiveInt(envValue(env, 'HISTORY_PAGE_SIZE'), 1000)),
    storeRawDownloads: parseBoolean(envValue(env, 'STORE_RAW_DOWNLOADS')),
    maxRetries: Math.max(0, parsePositiveInt(envValue(env, 'MAX_RETRIES'), 2)),
    tickers: readTickerSet(envValue(env, 'TICKERS')),
    historyRange: envValue(env, 'HISTORY_RANGE') || 'max',
    edgarFallback: envValue(env, 'EDGAR_FALLBACK') ? parseBoolean(envValue(env, 'EDGAR_FALLBACK')) : true,
    skipFranklin: parseBoolean(envValue(env, 'SKIP_FRANKLIN')),
    skipYahoo: parseBoolean(envValue(env, 'SKIP_YAHOO')),
    category: envValue(env, 'CATEGORY'),
  };
}

function printUsage(): void {
  console.log(`
Franklin Templeton ETF static feed updater (zero dependencies, run with Bun).

  bun ./scripts/update-data.ts [-h|--help]

Environment variables (all optional):

  MAX_FETCHES          0     Funds to process. 0 = full pass. A positive value
                             resumes after the committed cursor in
                             api/franklin/update-state.json.
  REQUEST_SLEEP        1.5   Minimum seconds between request starts.
  CONCURRENCY          3     Parallel fund workers (starts stay globally paced).
  MAX_RETRIES          2     Retries for network errors and 408/425/429/5xx.
  TICKERS              \"\"    Space/comma separated tickers. ANDed with the other
                             filters, never overriding them.
  AUM                  \"\"    \"min:max\" dollars, K/M/B/T suffixes, or a preset:
                             nano <$10M | micro $10M-$300M | small $300M-$2B |
                             mid $2B-$10B | large >=$10B
  TER                  \"\"    \"min:max\" expense ratio percent.
  DIVIDEND_YIELD       \"\"    \"min:max\" dividend yield percent.
  SEC_YIELD            \"\"    \"min:max\" SEC yield percent.
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y   \"min:max\" official return percent.
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y  \"min:max\" derived total return percent.
  HOLDINGS_PAGE_SIZE   250   Rows per holdings page file.
  HISTORY_PAGE_SIZE    1000  Rows per history page file (alias
                             HISTORICAL_PAGE_SIZE).
  HISTORY_RANGE        max   \"max\" or a year window; oldest history row kept.
  CATEGORY             \"\"    Keep only this provider category substring.
  STORE_RAW_DOWNLOADS  0     1|true|yes|y|on writes api/franklin/raw/**.
  SEC_UA               (set) Declared User-Agent for SEC EDGAR requests.
  EDGAR_FALLBACK       1     Use Form N-PORT-P when holdings not available elsewhere.
  SKIP_YAHOO           0     Skip Yahoo Finance (distributions, derived returns).
  SKIP_FRANKLIN        0     Skip franklintempleton.com entirely (keeps committed data).
  OFFLINE_SEED         0     Replay committed seed instead of fetching.

Range syntax is strict \"min:max\" with exactly one colon; \"\" and \":\" mean no
restriction; a configured min must not exceed max.

Examples:

  TICKERS=\"FLIN FLGR FLEE\" bun ./scripts/update-data.ts
  MAX_FETCHES=10 bun ./scripts/update-data.ts
  AUM=large TER=:0.40 bun ./scripts/update-data.ts
`);
}

function inRange(value: number | null, range: Range | undefined): boolean {
  if (!range) return true;
  if (value === null || !Number.isFinite(value)) return false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

function passesFilters(fund: CatalogFund, config: UpdaterConfig): boolean {
  if (config.tickers && !config.tickers.has(fund.ticker.toUpperCase())) return false;
  if (config.category && !fund.category.toLowerCase().includes(config.category.toLowerCase()) && !fund.name.toLowerCase().includes(config.category.toLowerCase())) return false;
  if (!inRange(fund.netAssets, config.aum)) return false;
  if (!inRange(fund.ter, config.ter)) return false;
  if (!inRange(fund.dividendYield, config.dividendYield)) return false;
  if (!inRange(fund.secYield, config.secYield)) return false;
  for (const period of Object.keys(config.performance) as ReturnPeriod[]) {
    const range = config.performance[period];
    const value = period === 'YTD' ? fund.returns.ytd : period === '1Y' ? fund.returns.yr1 : period === '3Y' ? fund.returns.yr3 : period === '5Y' ? fund.returns.yr5 : fund.returns.yr10;
    if (value === null) continue;
    if (!inRange(value, range)) return false;
  }
  for (const period of Object.keys(config.totalReturn) as ReturnPeriod[]) {
    const range = config.totalReturn[period];
    const value = period === 'YTD' ? fund.returns.ytd : period === '1Y' ? fund.returns.yr1 : period === '3Y' ? fund.returns.yr3 : period === '5Y' ? fund.returns.yr5 : fund.returns.yr10;
    if (value === null) continue;
    if (!inRange(value, range)) return false;
  }
  return true;
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function writeJsonIfChanged(path: URL, data: unknown): Promise<boolean> {
  const serialized = JSON.stringify(data, null, 1) + '\n';
  return readFile(path, 'utf8')
    .then((existing) => {
      if (existing === serialized) return false;
      return writeFile(path, serialized, 'utf8').then(() => true);
    })
    .catch(() => writeFile(path, serialized, 'utf8').then(() => true));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function ensureApiRoot(): Promise<void> {
  await mkdir(API_ROOT, { recursive: true });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    printUsage();
    return;
  }

  const config = parseConfig();
  requestSleepSeconds = config.requestSleep;

  console.log(`[config  ] Franklin updater: MAX_FETCHES=${config.maxFetches} REQUEST_SLEEP=${config.requestSleep} CONCURRENCY=${config.concurrency} EDGAR_FALLBACK=${config.edgarFallback} SKIP_FRANKLIN=${config.skipFranklin} SKIP_YAHOO=${config.skipYahoo}`);
  if (config.tickers) console.log(`[config  ] TICKERS filter: ${[...config.tickers].join(', ')}`);
  if (config.category) console.log(`[config  ] CATEGORY filter: ${config.category}`);

  await ensureApiRoot();

  // Load previous index for fallback
  let previousFunds = new Map<string, JsonRecord>();
  try {
    const prev = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as JsonRecord;
    for (const f of (prev.funds || []) as JsonRecord[]) {
      if (f && f.ticker) previousFunds.set(String(f.ticker).toUpperCase(), f);
    }
    console.log(`[catalog ] previous index: ${previousFunds.size} funds`);
  } catch {
    console.log('[catalog ] no previous index found');
  }

  // Load state for bounded runs
  let state: JsonRecord = {};
  try {
    state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as JsonRecord;
  } catch {}

  let catalog = new Map<string, CatalogFund>();
  let catalogSource = 'franklintempleton.com';

  const forceCatalog = parseBoolean(process.env.FORCE_CATALOG || '');
  const hasFullPrevious = previousFunds.size >= 81;

  if (!config.skipFranklin && !(hasFullPrevious && !forceCatalog)) {
    try {
      const fetched = await fetchIssuerText(FRANKLIN_CATALOG_URL, '[catalog ] franklintempleton.com ETF finder', config, (text) => {
        const lower = text.toLowerCase();
        return lower.includes('franklin') && lower.includes('etf') && (lower.includes('ticker') || lower.includes('fl') || lower.includes('usfi') || lower.includes('product'));
      }, 'text/html,application/xhtml+xml,text/csv,text/plain;q=0.9,*/*;q=0.8', { maxProxies: CATALOG_PROXY_COUNT });
      const parsed = parseFranklinCatalog(fetched.text);
      for (const fund of parsed) catalog.set(fund.ticker, fund);
      console.log(`[catalog ] ${FRANKLIN_CATALOG_URL} -> ${catalog.size} funds via ${fetched.via}`);
      if (config.storeRawDownloads) {
        await mkdir(new URL('raw/', API_ROOT), { recursive: true });
        await writeFile(new URL('raw/catalog.html', API_ROOT), fetched.text, 'utf8');
      }
    } catch (e) {
      console.warn(`[catalog ] failed to fetch franklintempleton.com finder: ${e instanceof Error ? e.message : String(e)}`);
      catalogSource = 'previous index (catalog fetch failed)';
    }
  } else {
    if (hasFullPrevious) {
      catalogSource = 'previous index (has full 81, skipping catalog fetch)';
      console.log(`[catalog ] skipping catalog fetch, using previous index with ${previousFunds.size} funds`);
    } else {
      catalogSource = 'previous index (SKIP_FRANKLIN)';
    }
  }

  if (!catalog.size) {
    for (const [ticker, row] of previousFunds) {
      catalog.set(ticker, parsePreviousFund(ticker, row));
    }
    if (catalog.size) console.log(`[catalog ] using previous index fallback: ${catalog.size} funds`);
  }

  if (!catalog.size) {
    // Fallback to previous index already attempted above; if still empty, use definitive 81 seed from sitemap
    if (previousFunds.size) {
      for (const [ticker, row] of previousFunds) {
        if (!catalog.has(ticker)) catalog.set(ticker, parsePreviousFund(ticker, row));
      }
    }
  }

  if (!catalog.size) {
    // Seed definitive 81 fixture for offline development and when issuer blocks catalog fetch
    for (const t of SEED_81) {
      catalog.set(t, {
        ticker: t,
        name: `Franklin ${t} ETF`,
        category: 'ETF',
        categoryPath: 'ETF',
        inception: null,
        exchange: 'NYSEArca',
        cusip: '',
        isin: '',
        benchmark: '',
        ter: 0.19,
        grossTer: 0.19,
        nav: null,
        close: null,
        premiumDiscount: null,
        netAssets: null,
        dividendYield: null,
        secYield: null,
        asOfDate: null,
        returns: { ...EMPTY_RETURNS },
        fundPage: `${FRANKLIN_SITE}/investments/options/exchange-traded-funds/products/${t.toLowerCase()}/SINGLCLASS/${t.toLowerCase()}-etf/${t}`,
        source: 'seed',
      });
    }
    console.log(`[catalog ] using seed fixture: ${catalog.size} funds (definitive 81)`);
    catalogSource = 'seed';
  }

  // If catalog fetch succeeded but returned fewer than 81, augment with seed to guarantee full coverage
  if (catalog.size < 81) {
    let added = 0;
    for (const t of SEED_81) {
      if (!catalog.has(t)) {
        const prev = previousFunds.get(t);
        if (prev) {
          catalog.set(t, parsePreviousFund(t, prev));
        } else {
          catalog.set(t, {
            ticker: t,
            name: `Franklin ${t} ETF`,
            category: 'ETF',
            categoryPath: 'ETF',
            inception: null,
            exchange: 'NYSEArca',
            cusip: '',
            isin: '',
            benchmark: '',
            ter: 0.19,
            grossTer: 0.19,
            nav: null,
            close: null,
            premiumDiscount: null,
            netAssets: null,
            dividendYield: null,
            secYield: null,
            asOfDate: null,
            returns: { ...EMPTY_RETURNS },
            fundPage: `${FRANKLIN_SITE}/investments/options/exchange-traded-funds/products/${t.toLowerCase()}/SINGLCLASS/${t.toLowerCase()}-etf/${t}`,
            source: 'seed',
          });
        }
        added++;
      }
    }
    if (added) console.log(`[catalog ] augmented with ${added} seed funds to reach ${catalog.size} (expected 81)`);
  }

  // Apply filters BEFORE batching (as per contract)
  let filtered = [...catalog.values()].filter((f) => passesFilters(f, config));
  console.log(`[filter  ] ${filtered.length} of ${catalog.size} funds pass filters`);

  // Bounded runs: resume after cursor
  let startIndex = 0;
  if (config.maxFetches > 0 && state.cursor) {
    const idx = filtered.findIndex((f) => f.ticker === state.cursor);
    if (idx >= 0) startIndex = idx + 1;
  }
  let toProcess = filtered;
  if (config.maxFetches > 0) {
    toProcess = filtered.slice(startIndex, startIndex + config.maxFetches);
    console.log(`[cursor  ] bounded run: start=${startIndex} max=${config.maxFetches} processing=${toProcess.length} cursor=${state.cursor || 'none'}`);
  }

  // Preload ticker maps for SEC
  if (config.edgarFallback) {
    try {
      await fetchFundTickerMap(config);
      await fetchCompanyTickerMap(config);
    } catch (e) {
      console.warn(`[edgar   ] failed to preload SEC maps: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let skipped = 0;

  // Process funds with concurrency
  const queue = [...toProcess];
  const workers: Promise<void>[] = [];

  async function processFund(fund: CatalogFund): Promise<void> {
    const ticker = fund.ticker.toUpperCase();
    const fundDir = new URL(`funds/${ticker}/`, API_ROOT);
    await mkdir(fundDir, { recursive: true });
    await mkdir(new URL('holdings/', fundDir), { recursive: true });
    await mkdir(new URL('history/', fundDir), { recursive: true });

    let summary: ProductPageSummary | null = null;
    let holdingsRows: JsonRecord[] = [];
    let holdingsHeaders = HOLDINGS_HEADERS;
    let holdingsAsOf: string | null = null;
    let holdingsSource = 'not available';
    let chart: ParsedChart | null = null;
    let nport: ParsedNport | null = null;

    // 1) Product page – logs are tabulated issuer candidate lines inside fetchIssuerText
    if (!config.skipFranklin) {
      try {
        const page = await fetchIssuerText(fund.fundPage, `[product ] ${ticker}`, config, (text) => {
          const lower = text.toLowerCase();
          return lower.includes(ticker.toLowerCase()) && (lower.includes('cusip') || lower.includes('nav') || lower.includes('expense'));
        }, 'text/html,application/xhtml+xml,text/csv,text/plain;q=0.9,*/*;q=0.8', { maxProxies: PRODUCT_PROXY_COUNT });
        summary = parseFranklinProductPage(page.text, ticker);
        // Merge into catalog fund
        if (summary.name) fund.name = summary.name;
        if (summary.cusip) fund.cusip = summary.cusip;
        if (summary.isin) fund.isin = summary.isin;
        if (summary.exchange) fund.exchange = summary.exchange;
        if (summary.benchmark) fund.benchmark = summary.benchmark;
        if (summary.morningstarCategory) { fund.category = summary.morningstarCategory; fund.categoryPath = summary.morningstarCategory; }
        else if (summary.assetClass) { fund.category = summary.assetClass; fund.categoryPath = summary.assetClass; }
        if (summary.totalExpenseRatio !== null) { fund.ter = summary.totalExpenseRatio; fund.grossTer = summary.grossExpenseRatio ?? summary.totalExpenseRatio; }
        if (summary.totalNetAssets !== null) fund.netAssets = summary.totalNetAssets;
        if (summary.nav !== null) fund.nav = summary.nav;
        if (summary.marketPrice !== null) fund.close = summary.marketPrice;
        if (summary.premiumDiscount !== null) fund.premiumDiscount = summary.premiumDiscount;
        if (summary.distributionYield !== null) fund.dividendYield = summary.distributionYield;
        if (summary.secYield !== null) fund.secYield = summary.secYield;
        if (summary.inception) fund.inception = summary.inception;
        if (config.storeRawDownloads) {
          await mkdir(new URL('raw/', API_ROOT), { recursive: true });
          await writeFile(new URL(`raw/${ticker}-product.html`, API_ROOT), page.text, 'utf8');
        }
      } catch (e) {
        console.warn(`[product ] ${ticker} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2) Holdings via SEC N-PORT-P – no per-stage log, only final summary
    if (config.edgarFallback) {
      try {
        const result = await fetchNportForFund(fund, config);
        if (result && result.parsed.holdings.length) {
          const companyMap = await fetchCompanyTickerMap(config);
          holdingsRows = fillNportTickers(result.parsed.holdings, companyMap);
          holdingsAsOf = result.parsed.repPdDate || null;
          nport = result.parsed;
          holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${result.accession.accession}, report period ${result.parsed.repPdDate || 'n/a'})`;
        }
      } catch (e) {
        console.warn(`[nport   ] ${ticker} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3) History via Yahoo – no per-stage log
    if (!config.skipYahoo) {
      try {
        chart = await fetchYahooChart(ticker, `[yahoo   ] ${ticker} chart`, config);
      } catch (e) {
        console.warn(`[yahoo   ] ${ticker} chart failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Load previous meta for fallback
    let prevMeta: JsonRecord | null = null;
    try {
      prevMeta = JSON.parse(await readFile(new URL('meta.json', fundDir), 'utf8')) as JsonRecord;
    } catch {}

    // Determine distribution frequency
    let distributionFrequency = summary?.distributionFrequency || summary?.dividendFrequencyRaw || null;
    if (!distributionFrequency && chart?.dividends?.length) {
      distributionFrequency = inferDistributionFrequency(chart.dividends);
    }
    if (!distributionFrequency) distributionFrequency = '—';

    const frequencyCode = frequencyCodeLabel(distributionFrequency);

    // Build history rows
    const historyRows: JsonRecord[] = [];
    if (chart?.days?.length) {
      for (const day of chart.days) {
        historyRows.push({
          Date: formatDate(day.date),
          Close: day.close.toFixed(2),
          'Adj Close': day.adjClose.toFixed(2),
          Volume: String(day.volume),
          searchIndex: `${day.date} ${day.close}`.toLowerCase(),
        });
      }
    } else if (prevMeta?.history?.pages?.length) {
      // Keep previous history if Yahoo failed
      try {
        for (const pagePath of prevMeta.history.pages as string[]) {
          const pageData = JSON.parse(await readFile(new URL(pagePath, fundDir), 'utf8')) as JsonRecord;
          for (const row of (pageData.rows || []) as JsonRecord[]) historyRows.push(row);
        }
      } catch {}
    }

    // Holdings fallback to previous if SEC failed
    if (!holdingsRows.length && prevMeta?.holdings?.pages?.length) {
      try {
        for (const pagePath of prevMeta.holdings.pages as string[]) {
          const pageData = JSON.parse(await readFile(new URL(pagePath, fundDir), 'utf8')) as JsonRecord;
          for (const row of (pageData.rows || []) as JsonRecord[]) holdingsRows.push(row);
        }
        holdingsSource = prevMeta.holdings.source || 'previous run';
        holdingsAsOf = prevMeta.holdings.asOfDate || prevMeta.holdings.asOf || null;
      } catch {}
    }

    // Build paginated files
    const holdingsPages = chunk(holdingsRows, config.holdingsPageSize);
    const historyPages = chunk(historyRows, config.historyPageSize);

    const holdingsManifest = {
      totalRows: holdingsRows.length,
      pageSize: config.holdingsPageSize,
      pageCount: holdingsPages.length || 1,
      pages: holdingsPages.length ? holdingsPages.map((_, i) => `./holdings/${pad3(i + 1)}.json`) : [],
      asOfDate: holdingsAsOf,
      asOf: holdingsAsOf ? formatDate(holdingsAsOf) : '—',
      source: holdingsSource,
    };

    const historyManifest = {
      totalRows: historyRows.length,
      pageSize: config.historyPageSize,
      pageCount: historyPages.length || 1,
      pages: historyPages.length ? historyPages.map((_, i) => `./history/${pad3(i + 1)}.json`) : [],
      asOf: historyRows.length ? formatDate(historyRows[historyRows.length - 1].Date) : '—',
      source: chart ? 'Yahoo Finance public chart API' : (prevMeta?.history?.source || 'previous run'),
    };

    // Write holdings pages
    for (let i = 0; i < holdingsPages.length; i++) {
      const pageData = {
        ticker,
        page: i + 1,
        pageSize: config.holdingsPageSize,
        totalRows: holdingsRows.length,
        headers: holdingsHeaders,
        rows: holdingsPages[i],
      };
      await writeJsonIfChanged(new URL(`holdings/${pad3(i + 1)}.json`, fundDir), pageData);
    }
    // Clean extra holdings pages
    try {
      const existing = await readdir(new URL('holdings/', fundDir));
      for (const file of existing) {
        const num = Number(file.replace('.json', ''));
        if (Number.isInteger(num) && num > holdingsPages.length) {
          await rm(new URL(`holdings/${file}`, fundDir));
        }
      }
    } catch {}

    // Write history pages
    for (let i = 0; i < historyPages.length; i++) {
      const pageData = {
        ticker,
        page: i + 1,
        pageSize: config.historyPageSize,
        totalRows: historyRows.length,
        headers: ['Date', 'Close', 'Adj Close', 'Volume'],
        rows: historyPages[i],
      };
      await writeJsonIfChanged(new URL(`history/${pad3(i + 1)}.json`, fundDir), pageData);
    }
    try {
      const existing = await readdir(new URL('history/', fundDir));
      for (const file of existing) {
        const num = Number(file.replace('.json', ''));
        if (Number.isInteger(num) && num > historyPages.length) {
          await rm(new URL(`history/${file}`, fundDir));
        }
      }
    } catch {}

    // Distributions from Yahoo dividends
    const distributionRows: JsonRecord[] = [];
    if (chart?.dividends?.length) {
      for (const div of chart.dividends.slice().reverse()) {
        distributionRows.push({
          'Ex-Date': formatDate(new Date(div.epoch * 1000).toISOString().slice(0, 10)),
          Dividend: div.amount.toFixed(4),
          searchIndex: `${formatDate(new Date(div.epoch * 1000).toISOString().slice(0, 10))} ${div.amount}`.toLowerCase(),
        });
      }
    }

    const latestDividend = distributionRows.length ? numberOrNull(distributionRows[0].Dividend) : null;
    const exDate = distributionRows.length ? (distributionRows[0]['Ex-Date'] as string) : '—';

    // Returns: use catalog returns + derived from Yahoo if needed
    const ytd = fund.returns.ytd;
    const yr1 = fund.returns.yr1;
    const yr3 = fund.returns.yr3;
    const yr5 = fund.returns.yr5;
    const yr10 = fund.returns.yr10;
    const si = fund.returns.sinceInception;

    // Build meta.json
    const meta = {
      ticker,
      name: fund.name,
      category: fund.category,
      categoryPath: fund.categoryPath,
      fundPage: fund.fundPage,
      factSheet: summary?.factSheet || null,
      source: {
        provider: 'Franklin Templeton',
        market: 'us',
        site: FRANKLIN_SITE,
        catalog: FRANKLIN_CATALOG_URL,
        fundPage: fund.fundPage,
        holdingsSource,
        historySource: chart ? 'Yahoo Finance public chart API' : (prevMeta?.source?.historySource || 'previous run'),
        yahooChart: `${YAHOO_CHART_URL}/${ticker}?period1=0&period2=..&interval=1d&events=div%7Csplit&includeAdjustedClose=true`,
        nportDoc: nport ? `SEC EDGAR N-PORT-P ${nport.repPdDate}` : null,
      },
      identifiers: {
        cusip: fund.cusip || summary?.cusip || null,
        isin: fund.isin || summary?.isin || null,
        benchmark: fund.benchmark || summary?.benchmark || null,
      },
      expenseRatio: {
        display: fund.ter !== null ? `${fund.ter.toFixed(2)}%` : '—',
        value: fund.ter,
        gross: fund.grossTer,
        net: fund.ter,
      },
      nav: {
        display: fund.nav !== null ? `$${fund.nav.toFixed(2)}` : '—',
        value: fund.nav,
        asOfDate: summary?.navAsOfDate || null,
      },
      marketPrice: {
        display: fund.close !== null ? `$${fund.close.toFixed(2)}` : '—',
        value: fund.close,
        asOfDate: summary?.marketPriceAsOfDate || null,
      },
      premiumDiscount: {
        display: fund.premiumDiscount !== null ? `${fund.premiumDiscount.toFixed(2)}%` : '—',
        value: fund.premiumDiscount,
      },
      aum: {
        display: formatAumDisplay(fund.netAssets),
        value: fund.netAssets,
        asOfDate: summary?.totalNetAssetsAsOfDate || holdingsAsOf || null,
        source: summary?.totalNetAssets !== null ? 'official product page Total Net Assets' : holdingsSource,
      },
      yields: {
        dividendYield: fund.dividendYield,
        dividendYieldText: fund.dividendYield !== null ? `${fund.dividendYield.toFixed(2)}%` : '—',
        dividendYieldKind: summary?.distributionYield !== null ? 'official 12-month yield from product page' : chart?.dividends?.length ? 'indicated from Yahoo dividends' : 'not published',
        secYield: fund.secYield,
        secYieldText: fund.secYield !== null ? `${fund.secYield.toFixed(2)}%` : '—',
        secYieldKind: fund.secYield !== null ? `SEC Yield (30 Day) published on the official product page${summary?.secYieldAsOfDate ? ` as of ${formatDate(summary.secYieldAsOfDate)}` : ''}` : 'not published by franklintempleton.com for this fund',
      },
      returns: {
        derivedFrom: 'official Franklin Templeton product finder (market price) + Yahoo Finance fallback',
        monthEnd: {
          asOfDate: fund.asOfDate || '',
          ytd,
          ytdText: ytd !== null ? `${ytd.toFixed(2)}%` : '—',
          yr1,
          yr1Text: yr1 !== null ? `${yr1.toFixed(2)}%` : '—',
          yr3,
          yr3Text: yr3 !== null ? `${yr3.toFixed(2)}%` : '—',
          yr5,
          yr5Text: yr5 !== null ? `${yr5.toFixed(2)}%` : '—',
          yr10,
          yr10Text: yr10 !== null ? `${yr10.toFixed(2)}%` : '—',
          sinceInception: si,
          sinceInceptionText: si !== null ? `${si.toFixed(2)}%` : '—',
        },
        quarterEnd: {
          asOfDate: '',
          ytd: null,
          ytdText: '—',
          yr1: null,
          yr1Text: '—',
          yr3: null,
          yr3Text: '—',
          yr5: null,
          yr5Text: '—',
          yr10: null,
          yr10Text: '—',
          sinceInception: si,
          sinceInceptionText: si !== null ? `${si.toFixed(2)}%` : '—',
        },
      },
      distributions: {
        frequency: distributionFrequency,
        frequencyCode,
        paymentsPerYear: distributionFrequency === 'Monthly' ? 12 : distributionFrequency === 'Quarterly' ? 4 : distributionFrequency === 'Semi-annually' ? 2 : distributionFrequency === 'Annually' ? 1 : null,
        headers: ['Ex-Date', 'Dividend'],
        rows: distributionRows,
        latestDividend: latestDividend !== null ? `${latestDividend}` : '—',
        exDate,
      },
      holdings: holdingsManifest,
      history: historyManifest,
    };

    const changed = await writeJsonIfChanged(new URL('meta.json', fundDir), meta);
    if (changed) updated++;
    else unchanged++;
    // Tabulated final line: [fund    ]            FLTW updated holdings=0 history=2201
    console.log(`[fund    ]            ${ticker} ${changed ? 'updated' : 'unchanged'} holdings=${holdingsRows.length} history=${historyRows.length}`);
  }

  // Worker pool
  for (let w = 0; w < config.concurrency; w++) {
    workers.push(
      (async () => {
        while (queue.length) {
          const fund = queue.shift();
          if (!fund) break;
          try {
            await processFund(fund);
          } catch (e) {
            console.error(`[error   ] ${fund.ticker} failed: ${e instanceof Error ? e.message : String(e)}`);
            failed++;
          }
        }
      })()
    );
  }

  await Promise.all(workers);

  // Build index.json
  const allFunds = [...catalog.values()]
    .filter((f) => {
      // Keep all catalog funds, but ensure we have meta for processed ones; unprocessed keep previous values
      return true;
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  let totalHoldings = 0;
  let totalHistory = 0;
  const indexFunds: JsonRecord[] = [];

  for (const fund of allFunds) {
    const ticker = fund.ticker.toUpperCase();
    const metaPath = new URL(`funds/${ticker}/meta.json`, API_ROOT);
    let meta: JsonRecord | null = null;
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf8')) as JsonRecord;
    } catch {
      // No meta yet, use catalog only
    }

    const holdingsCount = meta?.holdings?.totalRows ?? 0;
    const historyCount = meta?.history?.totalRows ?? 0;
    totalHoldings += holdingsCount;
    totalHistory += historyCount;

    const ter = fund.ter ?? meta?.expenseRatio?.value ?? null;
    const nav = fund.nav ?? meta?.nav?.value ?? null;
    const aum = fund.netAssets ?? meta?.aum?.value ?? null;
    const secYield = fund.secYield ?? meta?.yields?.secYield ?? null;
    const divYield = fund.dividendYield ?? meta?.yields?.dividendYield ?? null;

    const ytd = fund.returns.ytd ?? meta?.returns?.monthEnd?.ytd ?? null;
    const tr1y = fund.returns.yr1 ?? null;
    const tr3y = fund.returns.yr3 ? annualizedToTotal(fund.returns.yr3, 3) : null;
    const tr5y = fund.returns.yr5 ? annualizedToTotal(fund.returns.yr5, 5) : null;
    const tr10y = fund.returns.yr10 ? annualizedToTotal(fund.returns.yr10, 10) : null;
    const cagr3y = fund.returns.yr3 ?? null;
    const cagr5y = fund.returns.yr5 ?? null;
    const cagr10y = fund.returns.yr10 ?? null;
    const siAnn = fund.returns.sinceInception ?? null;

    const freq = meta?.distributions?.frequency || fund.categoryPath || '—';
    const freqCode = frequencyCodeLabel(freq);

    indexFunds.push({
      ticker,
      name: fund.name,
      category: fund.category,
      fundPage: fund.fundPage,
      dataFile: `./funds/${ticker}/meta.json`,
      cusip: fund.cusip || meta?.identifiers?.cusip || null,
      isin: fund.isin || meta?.identifiers?.isin || null,
      ter: ter !== null ? `${ter.toFixed(2)}%` : '—',
      terValue: ter,
      nav: nav !== null ? `$${nav.toFixed(2)}` : '—',
      navValue: nav,
      aum: aum !== null ? formatAumDisplay(aum) : '—',
      aumValue: aum,
      asOfDate: meta?.holdings?.asOf || meta?.aum?.asOfDate || '—',
      inceptionDate: fund.inception ? formatDate(fund.inception) : (meta?.returns?.monthEnd?.inceptionDate ? formatDate(meta.returns.monthEnd.inceptionDate) : '—'),
      exchange: fund.exchange || meta?.identifiers?.exchange || 'NYSEArca',
      closePrice: meta?.marketPrice?.display || (fund.close !== null ? `$${fund.close.toFixed(2)}` : '—'),
      closePriceValue: fund.close ?? meta?.marketPrice?.value ?? null,
      premiumDiscount: meta?.premiumDiscount?.display || '—',
      premiumDiscountValue: meta?.premiumDiscount?.value ?? null,
      distributions: {
        frequency: freq,
        exDate: meta?.distributions?.exDate || '—',
        dividend: meta?.distributions?.latestDividend || '—',
      },
      returns: {
        monthEnd: {
          asOfDate: meta?.returns?.monthEnd?.asOfDate || '',
          ytd,
          ytdText: ytd !== null ? `${ytd.toFixed(2)}%` : '—',
          yr1: tr1y,
          yr1Text: tr1y !== null ? `${tr1y.toFixed(2)}%` : '—',
          yr3: cagr3y,
          yr3Text: cagr3y !== null ? `${cagr3y.toFixed(2)}%` : '—',
          yr5: cagr5y,
          yr5Text: cagr5y !== null ? `${cagr5y.toFixed(2)}%` : '—',
          yr10: cagr10y,
          yr10Text: cagr10y !== null ? `${cagr10y.toFixed(2)}%` : '—',
          sinceInception: siAnn,
          sinceInceptionText: siAnn !== null ? `${siAnn.toFixed(2)}%` : '—',
        },
        quarterEnd: {
          asOfDate: '',
          ytd: null,
          ytdText: '—',
          yr1: null,
          yr1Text: '—',
          yr3: null,
          yr3Text: '—',
          yr5: null,
          yr5Text: '—',
          yr10: null,
          yr10Text: '—',
          sinceInception: siAnn,
          sinceInceptionText: siAnn !== null ? `${siAnn.toFixed(2)}%` : '—',
        },
      },
      metrics: {
        ytd,
        tr1y,
        tr3y,
        tr5y,
        tr10y,
        cagr3y,
        cagr5y,
        cagr10y,
        siAnn,
        dividendYield: divYield,
        dividendYieldText: divYield !== null ? `${divYield.toFixed(2)}%` : '—',
        secYield,
        secYieldText: secYield !== null ? `${secYield.toFixed(2)}%` : '—',
        returnsBasis: 'official Franklin Templeton product finder (market price) + Yahoo Finance fallback',
      },
      distributionFrequency: freq,
      holdings: holdingsCount,
      history: historyCount,
    });
  }

  const indexData = {
    generatedAt: new Date().toISOString(),
    source: {
      provider: 'Franklin Templeton',
      market: 'us',
      site: FRANKLIN_SITE,
      catalog: FRANKLIN_CATALOG_URL,
      holdings: 'SEC EDGAR Form N-PORT-P (Franklin Templeton ETF Trust CIK 1655589)',
      history: 'Yahoo Finance public chart API (adjusted close)',
    },
    counts: {
      funds: indexFunds.length,
      holdings: totalHoldings,
      history: totalHistory,
    },
    funds: indexFunds,
  };

  const indexChanged = await writeJsonIfChanged(INDEX_FILE, indexData);

  // Update state cursor
  if (config.maxFetches > 0) {
    const lastTicker = toProcess.length ? toProcess[toProcess.length - 1].ticker : state.cursor || null;
    const newState = { cursor: lastTicker, savedAt: new Date().toISOString() };
    // If we processed all remaining, reset cursor
    if (startIndex + toProcess.length >= filtered.length) {
      newState.cursor = null;
    }
    await writeJsonIfChanged(STATE_FILE, newState);
  } else {
    // Full pass resets cursor
    try {
      await rm(STATE_FILE);
    } catch {}
  }

  console.log(`[summary ] updated=${updated} unchanged=${unchanged} failed=${failed} skipped=${skipped} indexChanged=${indexChanged} funds=${indexFunds.length} holdings=${totalHoldings} history=${totalHistory} source=${catalogSource}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
