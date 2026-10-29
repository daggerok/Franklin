#!/usr/bin/env bun
// Checked-in scripts/update-data.config.json is the runtime default; see resolveControls for precedence.
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
    skipGlobalX: 'SKIP_GLOBALX', skipNorthernTrust: 'SKIP_NORTHERNTRUST',
  };
  const range = (v: any): string => typeof v === 'string' ? v : v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    if (['proxyGapMs', 'fetchTimeoutMs', 'retryDelayMs'].includes(key)) continue;
    const name = aliases[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputConfigValue(key: string, value: string): string {
  if (/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key)) return '<redacted>';
  if (key === 'TICKERS' && ['', 'null', 'undefined'].includes(value)) return 'all';
  return outputClean(value);
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${outputConfigValue(key, value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
const outputUnits: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12 };
function outputMoney(value: any): string {
  const raw = value && typeof value === 'object' && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)(K|M|B|T|Thousand|Million|Billion|Trillion)?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * (outputUnits[match[2]?.toUpperCase() ?? ''] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
/** Yields: rounded to 2 decimals without trailing zeros; placeholders are omitted like null. */
function outputPercent(value: any): unknown {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
  const text = String(raw).trim().replace(/%$/, '').trim();
  if (['', '-', '—', '--', 'n/a'].includes(text.toLowerCase())) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : outputClean(raw);
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputPercent(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputPercent(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${`${String(index).padStart(width)}/${total}`.padEnd(8)} ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  const tally = new Map<string, number>();
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      const final = status ?? (before.digest === after.digest ? 'unchanged' : 'updated');
      tally.set(final, (tally.get(final) ?? 0) + 1);
      console.log(outputFundLine(++completed, total, ticker, final, { ...after.meta, ...extra }, reason));
    },
    /** First [ done ] line: the statuses of every fund line this reporter printed. */
    summary(startedAt: number): string {
      const order = ['updated', 'unchanged', 'kept', 'skipped', 'failed'];
      const statuses = [...order, ...[...tally.keys()].filter(status => !order.includes(status))];
      return `[ done     ] ${completed} fund${completed === 1 ? '' : 's'}: ${statuses.map(status => `${tally.get(status) ?? 0} ${status}`).join(', ')} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    },
  };
}
/** Second [ done ] line: published totals. */
function outputCounts(funds: number, holdings: number, history: number): string {
  return `[ done     ] counts: ${funds.toLocaleString('en-US')} funds / ${holdings.toLocaleString('en-US')} holdings rows / ${history.toLocaleString('en-US')} history rows`;
}


// SEC series of Franklin ETFs, many of which company_tickers_mf.json does not list: the N-PORT reader looks a fund up here
// first, then in SEC's table. Only the identity lives here: the fund's newest N-PORT-P filing is looked up on EDGAR by the
// series id on every run, never pinned to one report period.
const FRANKLIN_SERIES_MAP: Record<string, { cik: string; seriesId: string; classId: string }> = {
  // Franklin Templeton ETF Trust (CIK 0001655589)
  FLAU: { cik: "0001655589", seriesId: "S000059508", classId: "C000194942" },
  FLGB: { cik: "0001655589", seriesId: "S000059499", classId: "C000194933" },
  USFI: { cik: "0001655589", seriesId: "S000080763", classId: "C000243455" },
  WABF: { cik: "0001655589", seriesId: "S000081195", classId: "C000244304" },
  TEMD: { cik: "0001655589", seriesId: "S000098522", classId: "C000268200" },
  TINS: { cik: "0001655589", seriesId: "S000095580", classId: "C000264307" },
  FRIZ: { cik: "0001655589", seriesId: "S000094832", classId: "C000262846" },
  DVAL: { cik: "0001655589", seriesId: "S000075788", classId: "C000235372" },
  FFOG: { cik: "0001655589", seriesId: "S000080151", classId: "C000242203" },
  MULT: { cik: "0001655589", seriesId: "S000094328", classId: "C000261957" },
  INCM: { cik: "0001655589", seriesId: "S000080465", classId: "C000242858" },
  YCLO: { cik: "0001655589", seriesId: "S000100939", classId: "C000271790" },
  BUYZ: { cik: "0001655589", seriesId: "S000067392", classId: "C000216664" },
  DIEM: { cik: "0001655589", seriesId: "S000053152", classId: "C000167259" },
  DIVI: { cik: "0001655589", seriesId: "S000053151", classId: "C000167258" },
  FLAX: { cik: "0001655589", seriesId: "S000059500", classId: "C000194934" },
  FLBL: { cik: "0001655589", seriesId: "S000061948", classId: "C000201383" },
  FLBR: { cik: "0001655589", seriesId: "S000059501", classId: "C000194935" },
  FLCA: { cik: "0001655589", seriesId: "S000059509", classId: "C000194943" },
  FLCB: { cik: "0001655589", seriesId: "S000066377", classId: "C000214198" },
  FLCH: { cik: "0001655589", seriesId: "S000059502", classId: "C000194936" },
  FLCO: { cik: "0001655589", seriesId: "S000053775", classId: "C000168997" },
  FLEE: { cik: "0001655589", seriesId: "S000059495", classId: "C000194929" },
  FLEU: { cik: "0001655589", seriesId: "S000059506", classId: "C000194940" },
  FLGR: { cik: "0001655589", seriesId: "S000059511", classId: "C000194945" },
  FLGV: { cik: "0001655589", seriesId: "S000068596", classId: "C000219662" },
  FLHY: { cik: "0001655589", seriesId: "S000061946", classId: "C000201381" },
  FLIA: { cik: "0001655589", seriesId: "S000061947", classId: "C000201382" },
  FLIN: { cik: "0001655589", seriesId: "S000059503", classId: "C000194937" },
  FLJH: { cik: "0001655589", seriesId: "S000059496", classId: "C000194930" },
  FLJP: { cik: "0001655589", seriesId: "S000059514", classId: "C000194948" },
  FLKR: { cik: "0001655589", seriesId: "S000059497", classId: "C000194931" },
  FLLA: { cik: "0001655589", seriesId: "S000063035", classId: "C000204739" },
  FLMB: { cik: "0001655589", seriesId: "S000057880", classId: "C000187843" },
  FLMI: { cik: "0001655589", seriesId: "S000057879", classId: "C000187842" },
  FLMX: { cik: "0001655589", seriesId: "S000059504", classId: "C000194938" },
  FLQL: { cik: "0001655589", seriesId: "S000057200", classId: "C000182607" },
  FLQM: { cik: "0001655589", seriesId: "S000057201", classId: "C000182608" },
  FLQS: { cik: "0001655589", seriesId: "S000057202", classId: "C000182609" },
  FLRU: { cik: "0001655589", seriesId: "S000059505", classId: "C000194939" },
  FLSA: { cik: "0001655589", seriesId: "S000063031", classId: "C000204735" },
  FLSP: { cik: "0001655589", seriesId: "S000066719", classId: "C000215161" },
  FLSW: { cik: "0001655589", seriesId: "S000059498", classId: "C000194932" },
  FLTW: { cik: "0001655589", seriesId: "S000059507", classId: "C000194941" },
  FLUD: { cik: "0001655589", seriesId: "S000068139", classId: "C000218765" },
  FSML: { cik: "0001655589", seriesId: "S000097279", classId: "C000266461" },
  HELX: { cik: "0001655589", seriesId: "S000067393", classId: "C000216665" },
  INCE: { cik: "0001655589", seriesId: "S000053774", classId: "C000168996" },
  IQM:  { cik: "0001655589", seriesId: "S000067394", classId: "C000216666" },
  UDIV: { cik: "0001655589", seriesId: "S000053153", classId: "C000167260" },
  USPX: { cik: "0001655589", seriesId: "S000053154", classId: "C000167261" },
  XDAT: { cik: "0001655589", seriesId: "S000070439", classId: "C000223847" },
  XIDV: { cik: "0001655589", seriesId: "S000089400", classId: "C000255866" },
  XUDV: { cik: "0001655589", seriesId: "S000089401", classId: "C000255867" },

  // Legg Mason ETF Investment Trust (CIK 0001645194)
  LVHD: { cik: "0001645194", seriesId: "S000051686", classId: "C000162625" },
  LVHI: { cik: "0001645194", seriesId: "S000054583", classId: "C000171279" },
  LRGE: { cik: "0001645194", seriesId: "S000057700", classId: "C000186075" },
  SQLV: { cik: "0001645194", seriesId: "S000058077", classId: "C000190092" },
  YLDE: { cik: "0001645194", seriesId: "S000057702", classId: "C000186077" },

  // Putnam ETF Trust (CIK 0001845809)
  FTCA: { cik: "0001845809", seriesId: "S000094549", classId: "C000262334" },
  FTMA: { cik: "0001845809", seriesId: "S000094555", classId: "C000262340" },
  FTMH: { cik: "0001845809", seriesId: "S000094552", classId: "C000262337" },
  FTMN: { cik: "0001845809", seriesId: "S000094556", classId: "C000262341" },
  FTMS: { cik: "0001845809", seriesId: "S000094554", classId: "C000262339" },
  FTMU: { cik: "0001845809", seriesId: "S000094551", classId: "C000262336" },
  FTNJ: { cik: "0001845809", seriesId: "S000094557", classId: "C000262342" },
  FTNY: { cik: "0001845809", seriesId: "S000094553", classId: "C000262338" },
  FTOH: { cik: "0001845809", seriesId: "S000094558", classId: "C000262343" },
  FTPA: { cik: "0001845809", seriesId: "S000094550", classId: "C000262335" },
  FTSD: { cik: "0001551895", seriesId: "S000040579", classId: "C000125740" }, // Franklin ETF Trust
  PBDC: { cik: "0001845809", seriesId: "S000077137", classId: "C000237731" },
  PEMX: { cik: "0001845809", seriesId: "S000077139", classId: "C000237733" },
  PGRI: { cik: "0001845809", seriesId: "S000077298", classId: "C000238068" },
  PGRO: { cik: "0001845809", seriesId: "S000071709", classId: "C000227195" },
  PVAL: { cik: "0001845809", seriesId: "S000071710", classId: "C000227196" },
};

// Franklin Templeton U.S.-listed ETF static data updater.
//
// The browser application is deliberately static. This script builds the feed
// under api/franklin/** from public issuer/SEC/market-data sources:
//
//   catalog       franklintempleton.com ETF finder
//                 https://www.franklintempleton.com/investments/options/exchange-traded-funds (81 ETFs)
//   product page  https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/...
//                 (Fund Profile, CUSIP/ISIN, expense, NAV, AUM, yields, frequency, returns)
//   holdings      Franklin official product page Portfolio tab (daily, primary)
//                 | Security Name | Weight (%) | Market Value ($) | Quantity |  (e.g. FLAU 101 holdings, FLIN 280)
//                 plus SEC EDGAR Form N-PORT-P for the exact series via FRANKLIN_SERIES_MAP
//                 (multi-trust mapping, 108 holdings for FLAU, quarterly fallback when official daily unavailable)
//   history       Yahoo Finance public chart API (daily close, adj close, volume, dividends, splits)
//   distributions Yahoo dividend events + official distribution frequency from product page
//
// Issuer requests are made directly with a browser-like User-Agent first; when
// the issuer answers with a bot-wall, the same URL is read through the read-only
// r.jina.ai rendering proxy (identical to daggerok/WisdomTree). SEC and Yahoo stay direct.
// TLS trust store: the USE_SYSTEM_CA control (auto|true|false) can restart the updater with Bun's --use-system-ca.
//
// Usage: bun ./scripts/update-data.ts [--help]

import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

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
// r.jina.ai snapshots the product page SPA before its lazy sections load and then serves that partial snapshot from
// its cache. Product pages therefore bypass the cache and ask the renderer to wait for the page load (seconds).
const PRODUCT_RENDER_TIMEOUT_SECONDS = 30;
// r.jina.ai/http:// renders the site's http -> https redirect stub ("Loading..."), never the product page, and only
// spends the proxy's per-IP rate limit; product pages skip it.
const PLAIN_HTTP_PROXY = 'https://r.jina.ai/http://';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Definitive 81 Franklin Templeton U.S.-listed ETFs from sitemap product.xml (80 + FLRU Russia)
// Source: https://www.franklintempleton.com/binaries/content/assets/global/sitemaps/google/en-us_product.xml chunks 18-19
// Parsed 94 total (81 active incl FLRU + 13 closed). This seed ensures full catalog even when issuer blocks.
export const FRANKLIN_CANONICAL_PAGES: Record<string, string> = {
  "FLIA": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26727/SINGLCLASS/franklin-international-aggregate-bond-etf/FLIA",
  "FTMH": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/48365/SINGLCLASS/franklin-municipal-high-yield-etf/FTMH",
  "FLEU": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26347/SINGLCLASS/franklin-ftse-eurozone-etf/FLEU",
  "FTMS": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/48362/SINGLCLASS/franklin-short-term-municipal-income-etf/FTMS",
  "FLRU": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26356/SINGLCLASS/franklin-ftse-russia-etf/FLRU",
  "FTCA": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/48306/SINGLCLASS/franklin-california-municipal-income-etf/FTCA",
  "FLQS": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/25771/SINGLCLASS/franklin-u-s-small-cap-multifactor-index-etf/FLQS",
  "TINS": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/47550/SINGLCLASS/templeton-international-insights-etf/TINS",
  "EZPZ": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/41786/SINGLCLASS/franklin-crypto-index-etf/EZPZ",
  "FLSP": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/28388/SINGLCLASS/franklin-systematic-style-premia-etf/FLSP",
  "INCE": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/21559/SINGLCLASS/franklin-income-equity-focus-etf/INCE",
  "YLDE": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/91629/SINGLCLASS/franklin-clearbridge-enhanced-income-etf/YLDE",
  "FLLA": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/27393/SINGLCLASS/franklin-ftse-latin-america-etf/FLLA",
  "FLKR": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26353/SINGLCLASS/franklin-ftse-south-korea-etf/FLKR",
  "SQLV": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/91662/SINGLCLASS/royce-quant-small-cap-quality-value-etf/SQLV",
  "FLBL": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26728/SINGLCLASS/franklin-senior-loan-etf/FLBL",
  "PGRO": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/39433/SINGLCLASS/putnam-focused-large-cap-growth-etf/PGRO",
  "FLCO": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/21558/SINGLCLASS/franklin-investment-grade-corporate-etf/FLCO",
  "FLQL": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/25773/SINGLCLASS/franklin-u-s-large-cap-multifactor-index-etf/FLQL",
  "TEMD": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/48762/SINGLCLASS/templeton-emerging-markets-debt-etf/TEMD",
  "FLCA": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26364/SINGLCLASS/franklin-ftse-canada-etf/FLCA",
  "FLCB": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/28565/SINGLCLASS/franklin-u-s-core-bond-etf/FLCB",
  "HELX": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/29097/SINGLCLASS/franklin-genomic-advancements-etf/HELX",
  "XUDV": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/42074/SINGLCLASS/franklin-us-dividend-booster-index-etf/XUDV",
  "XDAT": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/30780/SINGLCLASS/franklin-exponential-data-etf/XDAT",
  "FTNJ": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/48364/SINGLCLASS/franklin-new-jersey-municipal-income-etf/FTNJ",
  "FTNY": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/48361/SINGLCLASS/franklin-new-york-municipal-income-etf/FTNY",
  "FLSA": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/27392/SINGLCLASS/franklin-ftse-saudi-arabia-etf/FLSA",
  "EZBC": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/39639/SINGLCLASS/franklin-bitcoin-etf/EZBC",
  "FLGV": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/29614/SINGLCLASS/franklin-u-s-treasury-bond-etf/FLGV",
  "FLGB": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26350/SINGLCLASS/franklin-ftse-united-kingdom-etf/FLGB",
  "FLJP": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26357/SINGLCLASS/franklin-ftse-japan-etf/FLJP",
  "FLBR": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26363/SINGLCLASS/franklin-ftse-brazil-etf/FLBR",
  "PBDC": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/39500/SINGLCLASS/putnam-bdc-income-etf/PBDC",
  "FLCH": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26362/SINGLCLASS/franklin-ftse-china-etf/FLCH",
  "LVHD": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/91415/SINGLCLASS/franklin-u-s-low-volatility-high-dividend-index-etf/LVHD",
  "DIVI": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/21412/SINGLCLASS/franklin-international-core-dividend-tilt-index-etf/DIVI",
  "UDIV": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/21415/SINGLCLASS/franklin-u-s-core-dividend-tilt-index-etf/UDIV",
  "LVHI": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/91481/SINGLCLASS/franklin-international-low-volatility-high-dividend-index-etf/LVHI",
  "LRGE": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/91630/SINGLCLASS/clearbridge-large-cap-growth-select-etf/LRGE",
  "YCLO": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/50418/SINGLCLASS/franklin-bsp-clo-etf/YCLO",
  "FLUD": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/29430/SINGLCLASS/franklin-ultra-short-bond-etf/FLUD",
  "FLGR": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26360/SINGLCLASS/franklin-ftse-germany-etf/FLGR",
  "FLAU": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26365/SINGLCLASS/franklin-ftse-australia-etf/FLAU",
  "MULT": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/46894/SINGLCLASS/franklin-multisector-income-etf/MULT",
  "FLJH": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26355/SINGLCLASS/franklin-ftse-japan-hedged-etf/FLJH",
  "FLMX": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26354/SINGLCLASS/franklin-ftse-mexico-etf/FLMX",
  "FLIN": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26348/SINGLCLASS/franklin-ftse-india-etf/FLIN",
  "FTMN": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/48373/SINGLCLASS/franklin-minnesota-municipal-income-etf/FTMN",
  "BUYZ": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/29096/SINGLCLASS/franklin-disruptive-commerce-etf/BUYZ",
  "XRPZ": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/47318/SINGLCLASS/franklin-xrp-etf/XRPZ",
  "DIEM": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/21413/SINGLCLASS/franklin-emerging-market-core-dividend-tilt-index-etf/DIEM",
  "DVAL": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/33319/SINGLCLASS/brandywine-global-dynamic-us-large-cap-value-etf/DVAL",
  "FLSW": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26352/SINGLCLASS/franklin-ftse-switzerland-etf/FLSW",
  "FLQM": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/25772/SINGLCLASS/franklin-u-s-mid-cap-multifactor-index-etf/FLQM",
  "PEMX": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/39499/SINGLCLASS/putnam-emerging-markets-ex-china-etf/PEMX",
  "FLMI": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26175/SINGLCLASS/franklin-dynamic-municipal-bond-etf/FLMI",
  "FTPA": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/48375/SINGLCLASS/franklin-pennsylvania-municipal-income-etf/FTPA",
  "PVAL": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/39434/SINGLCLASS/putnam-focused-large-cap-value-etf/PVAL",
  "FGDL": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/31714/SINGLCLASS/franklin-responsibly-sourced-gold-etf/FGDL",
  "EZET": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/40521/SINGLCLASS/franklin-ethereum-etf/EZET",
  "FFOG": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/36370/SINGLCLASS/franklin-focused-dynamic-growth-etf/FFOG",
  "FLAX": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26346/SINGLCLASS/franklin-ftse-asia-ex-japan-etf/FLAX",
  "FLTW": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26351/SINGLCLASS/franklin-ftse-taiwan-etf/FLTW",
  "FTOH": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/48374/SINGLCLASS/franklin-ohio-municipal-income-etf/FTOH",
  "FSML": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/50069/SINGLCLASS/franklin-small-cap-enhanced-etf/FSML",
  "FLEE": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26349/SINGLCLASS/franklin-ftse-europe-etf/FLEE",
  "XIDV": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/42138/SINGLCLASS/franklin-international-dividend-booster-index-etf/XIDV",
  "IQM": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/29098/SINGLCLASS/franklin-intelligent-machines-etf/IQM",
  "SOEZ": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/47315/SINGLCLASS/franklin-solana-etf/SOEZ",
  "FRIZ": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/47537/SINGLCLASS/franklin-dividend-growth-etf/FRIZ",
  "WABF": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/36353/SINGLCLASS/western-asset-bond-etf/WABF",
  "INCM": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/36262/SINGLCLASS/franklin-income-focus-etf/INCM",
  "FTMU": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/48363/SINGLCLASS/franklin-municipal-income-etf/FTMU",
  "PGRI": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/47497/SINGLCLASS/putnam-international-stock-etf/PGRI",
  "USFI": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/36405/SINGLCLASS/brandywine-global-u-s-fixed-income-etf/USFI",
  "FLMB": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26176/SINGLCLASS/franklin-municipal-green-bond-etf/FLMB",
  "FTSD": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/18000/SINGLCLASS/franklin-short-duration-u-s-government-etf/FTSD",
  "FLHY": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26729/SINGLCLASS/franklin-high-yield-corporate-etf/FLHY",
  "USPX": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/21414/SINGLCLASS/franklin-u-s-equity-index-etf/USPX",
  "FTMA": "https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/48338/SINGLCLASS/franklin-massachusetts-municipal-income-etf/FTMA"
};

const SEED_81 = [
  'BUYZ','DIEM','DIVI','DVAL','EZBC','EZET','EZPZ','FFOG','FGDL','FLAU','FLAX','FLBL','FLBR','FLCA','FLCB','FLCH','FLCO',
  'FLEE','FLEU','FLGB','FLGR','FLGV','FLHY','FLIA','FLIN','FLJH','FLJP','FLKR','FLLA','FLMB','FLMI','FLMX','FLQL','FLQM',
  'FLQS','FLRU','FLSA','FLSP','FLSW','FLTW','FLUD','FRIZ','FSML','FTCA','FTMA','FTMH','FTMN','FTMS','FTMU','FTNJ','FTNY',
  'FTOH','FTPA','FTSD','HELX','INCE','INCM','IQM','LRGE','LVHD','LVHI','MULT','PBDC','PEMX','PGRI','PGRO','PVAL','SOEZ',
  'SQLV','TEMD','TINS','UDIV','USFI','USPX','WABF','XDAT','XIDV','XRPZ','XUDV','YCLO','YLDE',
] as const;
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const SEC_SITE = 'https://www.sec.gov';
const SEC_FUND_TICKERS_URL = `${SEC_SITE}/files/company_tickers_mf.json`;
const SEC_COMPANY_TICKERS_URL = `${SEC_SITE}/files/company_tickers.json`;
let SEC_UA = 'daggerok ETF feed daggerok@gmail.com';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PROXY_SLEEP_SECONDS = 3.2;

let API_ROOT = new URL('../api/franklin/', import.meta.url);
let INDEX_FILE = new URL('index.json', API_ROOT);
let STATE_FILE = new URL('update-state.json', API_ROOT);
/** Test hook: redirect every write below another directory (must end with a slash). */
export function setApiRootForTest(root: URL): void {
  API_ROOT = root;
  INDEX_FILE = new URL('index.json', API_ROOT);
  STATE_FILE = new URL('update-state.json', API_ROOT);
}

/** The workflow times out at 30 minutes: stop taking new funds well before, and still write the index. */
let softDeadlineMs = 25 * 60_000;
/** Test hook: shorten (or zero) the soft run deadline. */
export function setSoftDeadline(ms: number): void {
  softDeadlineMs = ms;
}

/**
 * ISO date a published fund is refreshed up to (the latest of its price, NAV, holdings and
 * performance dates), or null when the fund has no published data yet.
 */
export function publishedAsOf(meta: JsonRecord | null | undefined): string | null {
  if (!meta) return null;
  const dates = [meta.marketPrice?.asOfDate, meta.nav?.asOfDate, meta.holdings?.asOfDate, meta.returns?.performanceAsOf]
    .map(isoDateOrNull)
    .filter((value): value is string => value !== null);
  return dates.length ? dates.sort()[dates.length - 1] : null;
}

/** Published as-of per ticker, read from each fund's meta.json (null: nothing published). */
async function readPublishedAsOf(tickers: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (const ticker of tickers) {
    try {
      map.set(ticker, publishedAsOf(JSON.parse(await readFile(new URL(`funds/${ticker}/meta.json`, API_ROOT), 'utf8')) as JsonRecord));
    } catch {
      map.set(ticker, null);
    }
  }
  return map;
}

/**
 * Run order of an unbounded run: funds without published data first, then the stalest
 * published as-of, ties alphabetical. A run cut short by the soft deadline therefore
 * leaves the freshest funds for last, and the next run starts where this one stopped.
 */
export function stalestFirst<T extends { ticker: string }>(funds: T[], asOf: Map<string, string | null>): T[] {
  const key = (fund: T): string => asOf.get(fund.ticker) ?? '';
  return [...funds].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.ticker.localeCompare(b.ticker)));
}

/** One line for the log and the step summary: what a deadline-truncated run left behind. */
export function deadlineSummary(attempted: number, total: number, remaining: Array<{ ticker: string }>, asOf: Map<string, string | null>): string {
  const ordered = stalestFirst(remaining, asOf);
  const oldest = ordered.length ? `${asOf.get(ordered[0].ticker) ?? 'never published'} (${ordered[0].ticker})` : 'none';
  return `${attempted} of ${total} funds refreshed, ${remaining.length} keep their published files, oldest remaining published as-of: ${oldest}`;
}

const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
/** Funds whose holdings legitimately fail a holdingsGuard check (geared, futures, look-through, top-N lists): ticker, or '*' for every fund -> relaxed checks. */
export const HOLDINGS_GUARD_RELAX: Record<string, string[]> = {
  FLRU: ['sum'], // Russia fund: its sanctioned holdings are valued at 0, so its weights add up to 0
};
/** Funds the issuer closed, each confirmed from an SEC filing or the issuer notice (`source`): never fetched or guarded, last published data kept, index row marked closed. */
export const CLOSED_FUNDS: ClosedFund[] = [];
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
  /** Code for the definition behind `dividendYield` (see DIVIDEND_YIELD_BASES); null when the yield is null or its origin is unknown. */
  dividendYieldBasis?: DividendYieldBasis | null;
  secYield: number | null;
  asOfDate: string | null;
  returns: CatalogReturns;
  /** ISO date the published returns are as of (the issuer performance table date), null when unknown. */
  performanceAsOf?: string | null;
  fundPage: string;
  source: 'franklin' | 'previous index' | 'seed' | 'official sitemap';
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
  /** As-of date printed next to the Distribution Rate (ISO, null when none). */
  distributionRateAsOfDate: string | null;
  /** What the Distribution Rate is divided by: "NAV" or "market price" (null when the page does not say). */
  distributionRateBasis: string | null;
  factSheet: string | null;
  ytdReturn: number | null;
  returns: CatalogReturns;
  performanceAsOf: string | null;
  /** As-of date printed above the page's Holdings table (null when there is no table). */
  holdingsAsOfDate: string | null;
  /** Which parts of the page are present at all (a labelled value or table was read), whether or not later code uses them. */
  sections: PageSections;
  /** True only when the page carries all three anchors: identifiers/fees, Total Net Assets and the Share Prices block. */
  loadedFully: boolean;
};

/**
 * The rendering proxy sometimes returns the product page with its lazy sections collapsed (empty `## Pricing`,
 * `## Portfolio`, `## Performance` headings). Each flag says that the section was really read from this page.
 */
export type PageSections = {
  facts: boolean;
  returns: boolean;
  assets: boolean;
  pricing: boolean;
  yields: boolean;
  holdings: boolean;
};

export type HoldingsRow = JsonRecord;

type UpdaterConfig = {
  /** Test-only override of the per-request deadline. */
  fetchTimeoutMs?: number;
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
/** Years of age each published return needs (withoutYoungReturns): 1-year and since inception from the first anniversary. */
const RETURN_HORIZONS = { yr1: 1, yr3: 3, yr5: 5, yr10: 10, sinceInception: 1 };

/** Published in metrics.returnsBasis and meta.returns.derivedFrom: how the returns are produced. */
export const RETURNS_BASIS = 'official Franklin Templeton average annual total returns at market price (finder and product page, as of the month-end shown in performanceAsOf; YTD is refreshed daily); 3Y/5Y/10Y cumulative figures are compounded from the official annualized values; not derived from Yahoo Finance';

/**
 * Date of the issuer performance table: "Average Annual Total Returns ... As of
 * 08/31/2026" (finder header and product page). Not the NAV or holdings date.
 */
export function parsePerformanceAsOf(text: string): string | null {
  const match = /Average Annual Total Returns[^\n]*?As of\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(String(text ?? ''));
  return match ? isoDateOrNull(toIsoDate(match[1])) : null;
}

function isoDateOrNull(value: unknown): string | null {
  const iso = typeof value === 'string' ? value.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function hasAnyReturn(returns: CatalogReturns | null | undefined): boolean {
  return !!returns && Object.values(returns).some((value) => typeof value === 'number' && Number.isFinite(value));
}

/** ISO performance date, or null when it is malformed or the fund has no returns to date. */
export function resolvePerformanceAsOf(value: unknown, returns: CatalogReturns | null | undefined): string | null {
  return hasAnyReturn(returns) ? isoDateOrNull(value) : null;
}

/** The hub-facing metrics object (STANDARD.md 9a); returnsBasis then performanceAsOf stay last. */
export function buildMetrics(input: {
  returns: CatalogReturns;
  inception: string | null;
  dividendYield: number | null;
  dividendYieldBasis?: DividendYieldBasis | null;
  secYield: number | null;
  performanceAsOf: string | null;
}): JsonRecord {
  const { returns, dividendYield, secYield } = input;
  const yr10 = tenYearEligible(input.inception) ? (returns.yr10 ?? null) : null;
  const total = (cagr: number | null, years: number): number | null => {
    const fraction = cagr === null ? null : annualizedToTotal(cagr, years);
    return fraction === null ? null : round(fraction * 100, 2);
  };
  return {
    ytd: returns.ytd ?? null,
    tr1y: returns.yr1 ?? null,
    tr3y: total(returns.yr3 ?? null, 3),
    tr5y: total(returns.yr5 ?? null, 5),
    tr10y: total(yr10, 10),
    cagr3y: returns.yr3 ?? null,
    cagr5y: returns.yr5 ?? null,
    cagr10y: yr10,
    siAnn: returns.sinceInception ?? null,
    dividendYield,
    dividendYieldText: dividendYield !== null ? `${dividendYield.toFixed(2)}%` : '—',
    // the code travels with the yield it describes: null exactly when the yield is null
    dividendYieldBasis: dividendYield === null ? null : (isDividendYieldBasis(input.dividendYieldBasis) ? input.dividendYieldBasis : 'official-other'),
    secYield,
    secYieldText: secYield !== null ? `${secYield.toFixed(2)}%` : '—',
    returnsBasis: RETURNS_BASIS,
    performanceAsOf: resolvePerformanceAsOf(input.performanceAsOf, returns),
  };
}

let requestSleepSeconds = 1.5;
let directGate: () => Promise<void> = createRequestGate(1, 1500);
let proxyGateAt = 0;
/** A SEC ticker table loaded once per run. A failed load is not cached: a later fund asks again, up to SEC_TABLE_ATTEMPTS per run. */
type SecTable<T> = { value: T | null; pending: Promise<T> | null; failures: number; lastError: unknown };
const SEC_TABLE_ATTEMPTS = 2;
const emptySecTable = <T>(): SecTable<T> => ({ value: null, pending: null, failures: 0, lastError: null });
/** One run's SEC state: the two SEC ticker tables (each loaded once) and the N-PORT reader cache (submissions and documents). */
let secState: { funds: SecTable<Map<string, NportSeriesRef>>; names: SecTable<Map<string, string>>; reader: Map<string, unknown> } = { funds: emptySecTable(), names: emptySecTable(), reader: new Map() };
/** A fresh SEC state for a run (every run starts with it; tests call it too). */
export function resetSecState(): void {
  secState = { funds: emptySecTable(), names: emptySecTable(), reader: new Map() };
}
function loadSecTable<T>(table: SecTable<T>, load: () => Promise<T>): Promise<T> {
  if (table.value) return Promise.resolve(table.value);
  if (table.pending) return table.pending;
  if (table.failures >= SEC_TABLE_ATTEMPTS) return Promise.reject(table.lastError);
  table.pending = load().then(
    (value) => { table.value = value; table.pending = null; return value; },
    (error: unknown) => { table.failures += 1; table.lastError = error; table.pending = null; throw error; },
  );
  return table.pending;
}

// Retry backoff and request pacing read this clock, so tests can run them on a fake one instead of waiting.
type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };
const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
let clock: Clock = realClock;
/** Test-only: swap the pacing/backoff clock; call with no argument to restore the real one. */
export function setClockForTest(next?: Clock): void { clock = next ?? realClock; }

function sleep(ms: number): Promise<void> {
  return clock.sleep(ms);
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

// Zero-width space, non-joiner, joiner, word joiner and BOM: the product page puts them inside numbers
// ("78.\u200b16", "13,\u200b407,\u200b461.\u200b27"), which made every weight of the crypto and gold funds unparseable.
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/g;

function cleanText(value: unknown): string {
  return decodeEntities(String(value ?? ''))
    .replace(ZERO_WIDTH, '')
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

/** The ISO date of a published label ending in "as of Oct 2 2026" (formatDate's output), independent of the machine time zone. */
export function asOfFromKind(kind: unknown): string | null {
  const match = /\bas of ([A-Z][a-z]{2}) (\d{1,2}) (\d{4})$/.exec(String(kind ?? ''));
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  return match && month >= 0 ? `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}` : null;
}

export function toIsoDate(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return '';
  // ISO, U.S. and month-name dates ("Oct 20 2026", "20 Oct 2026"): pure text, the same day in every time zone (shared calendar-dates block)
  return calendarIso(raw) ?? raw;
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

export function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const result: RangeMap = {};
  for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y'] as ReturnPeriod[]) {
    const value = env[`${prefix}_${period}`];
    if (value !== undefined && value.trim() !== '') {
      const parsed = parseRange(value, `${prefix}_${period}`);
      if (parsed && (parsed.min !== undefined || parsed.max !== undefined)) result[period] = parsed;
    }
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

/** The entry of every page parser (catalog, product page, holdings): the regexes that read raw lines see no zero-width characters either. */
export function stripProxyPreamble(text: string): string {
  const s = String(text ?? '').replace(ZERO_WIDTH, '').trim();
  const marker = 'Markdown Content:';
  const idx = s.indexOf(marker);
  if (idx !== -1 && idx < 500) {
    return s.slice(idx + marker.length).trim();
  }
  const lines = s.split('\n');
  if (lines.length >= 4 && /^Title:/i.test(lines[0] || '') && /^URL Source:/i.test(lines[1] || '')) {
    return lines.slice(3).join('\n').trim();
  }
  return s;
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

export type TextLine = { text: string; cells: string[] };
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

// Sanity bounds for published yields. They also drop the legacy "30" artifact
// that an earlier parser read out of the "SEC 30-Day Yield" label.
const MAX_PUBLISHED_SEC_YIELD = 25;
const MAX_PUBLISHED_DIVIDEND_YIELD = 60;

export function plausibleSecYield(value: unknown): number | null {
  const parsed = numberOrNull(value);
  if (parsed === null || parsed <= 0 || parsed > MAX_PUBLISHED_SEC_YIELD) return null;
  return parsed;
}

export function plausibleDividendYield(value: unknown): number | null {
  const parsed = numberOrNull(value);
  if (parsed === null || parsed <= 0 || parsed > MAX_PUBLISHED_DIVIDEND_YIELD) return null;
  return parsed;
}

// NAV and the same-day market close of an ETF should be comparable. A page
// scrape occasionally grabs a nearby dollar figure instead of the NAV (e.g.
// FLCA $828.34 beside a $53.09 close). Reject that value at ingestion rather
// than using it as the denominator of an indicated dividend yield. Only call
// with a recent price reference; older history cannot validate today's NAV.
export function plausibleNav(value: unknown, referencePrice: number | null = null): number | null {
  const nav = numberOrNull(value);
  if (nav === null || nav <= 0) return null;
  if (referencePrice !== null && referencePrice > 0 && Math.abs(nav / referencePrice - 1) > 0.15) return null;
  return nav;
}

// The product page sometimes ships a sentence instead of the benchmark name
// ("index are as of the ETF's/ETP's last trading day before the ...").
export function plausibleBenchmark(value: unknown): string | null {
  const text = cleanText(value);
  if (!text || text.length > 80) return null;
  if (/https?:|\*\*|©|\bas of\b|last trading day|for more information|disclosure/i.test(text)) return null;
  if (text.split(/\s+/).length > 12) return null;
  return text;
}

// A daily ETF premium/discount is a fraction of a percent; larger numbers are
// mis-parsed neighbouring cells (the previous feed carried 100.00%).
export function plausiblePremiumDiscount(value: unknown): number | null {
  const parsed = numberOrNull(value);
  if (parsed === null || Math.abs(parsed) > 5) return null;
  return parsed;
}

export const PREMIUM_COMPUTED_SOURCE = 'computed from market price / official NAV, same date';
export const OFFICIAL_12M_YIELD_KIND = 'official 12-month distribution yield from the product page';

export const DIVIDEND_YIELD_BASES = ['official-trailing-12m', 'official-distribution-rate', 'official-other', 'computed-trailing-12m', 'indicated'] as const;
export type DividendYieldBasis = typeof DIVIDEND_YIELD_BASES[number];

export function isDividendYieldBasis(value: unknown): value is DividendYieldBasis {
  return (DIVIDEND_YIELD_BASES as readonly unknown[]).includes(value);
}

/**
 * Maps a `meta.json` `yields.dividendYieldKind` text to its basis code. Franklin publishes two official yields
 * (12-month yield, Distribution Rate) and the updater adds the `indicated:` estimate; any other text counts as
 * `official-other` when the yield is provider-published and as `indicated` otherwise.
 */
export function dividendYieldBasisFromKind(kind: unknown, providerPublished: boolean): DividendYieldBasis {
  const text = String(kind ?? '');
  if (text === OFFICIAL_12M_YIELD_KIND) return 'official-trailing-12m';
  if (text.startsWith('Distribution Rate')) return 'official-distribution-rate';
  if (text.startsWith('indicated')) return 'indicated';
  return providerPublished ? 'official-other' : 'indicated';
}

/**
 * Premium/discount in percent: (market price / NAV - 1) * 100, rounded to two decimals. Both figures must belong
 * to the same trading date; different or unknown dates give null (a premium is never built from mixed dates).
 */
export function computePremiumDiscount(nav: number | null, navDate: string | null, price: number | null, priceDate: string | null): number | null {
  if (nav === null || nav <= 0 || price === null || price <= 0 || !navDate || !priceDate || navDate !== priceDate) return null;
  return plausiblePremiumDiscount(round((price / nav - 1) * 100, 2));
}

/**
 * The official dividend yield of a product page: the 12-month yield when the page prints one, otherwise the
 * Distribution Rate (most recent distribution annualized over the closing market price or NAV, with its own as-of
 * date). Official figures always win over the Yahoo-derived indicated yield.
 */
export function officialDividendYield(summary: ProductPageSummary): { value: number; kind: string; asOfDate: string | null } | null {
  const twelve = plausibleDividendYield(summary.distributionYield);
  if (twelve !== null) return { value: twelve, kind: OFFICIAL_12M_YIELD_KIND, asOfDate: null };
  const rate = plausibleDividendYield(summary.distributionRate);
  if (rate === null) return null;
  const basis = summary.distributionRateBasis ? ` at ${summary.distributionRateBasis}` : '';
  const asOf = summary.distributionRateAsOfDate ? ` as of ${formatDate(summary.distributionRateAsOfDate)}` : '';
  return { value: rate, kind: `Distribution Rate${basis} published on the official Franklin fund page${asOf}`, asOfDate: summary.distributionRateAsOfDate };
}

// Yield rows are published as percentages. Anchoring on the "%" sign keeps the
// label digits out of the value: "SEC 30-Day Yield" must never parse as 30.
function percentValue(label: JsonRecord | null): number | null {
  if (!label) return null;
  const match = /([-+]?\d+(?:\.\d+)?)\s*%/.exec(labelText(label));
  if (!match) return null;
  const value = numberOrNull(match[1]);
  if (value === null || Math.abs(value) > 100) return null;
  return value;
}

function labelAsOf(label: JsonRecord | null): string | null {
  if (!label) return null;
  const raw = String(label.asOf ?? label.asOfDate ?? label.text ?? '');
  return firstDate(raw) || null;
}

/**
 * The "As of" of the page block a label sits in. The header block prints it below the value ("Total Net Assets",
 * "$224.46M", "As of 10/25/2026 (Updated Daily)"); the Portfolio "Assets" block prints it above ("### Assets",
 * "As of 10/25/2026 (Updated Daily)", "Total Net Assets $683.13 Million"). A date after the next heading belongs to
 * another block: reading two lines ahead dated FTMH's daily assets with the monthly "Portfolio Statistics" 09/30.
 */
export function blockAsOf(lines: TextLine[], label: JsonRecord | null): string | null {
  if (!label) return null;
  const at = typeof label.line === 'number' ? label.line : -1;
  if (at < 0) return labelAsOf(label);
  const isHeading = (line: TextLine | undefined) => !line || /^#/.test(line.text);
  const own = firstDate(lines[at].text);
  if (own) return own;
  for (let j = at + 1; j <= at + 2 && !isHeading(lines[j]); j++) {
    const date = firstDate(lines[j].text);
    if (date) return date;
  }
  for (let j = at - 1; j >= at - 2 && !isHeading(lines[j]); j--) {
    if (/^As of\b/i.test(lines[j].text)) return firstDate(lines[j].text);
  }
  return null;
}

/**
 * AUM date of the published meta. The source's own date is used for a new value; for the value already published the
 * published date stays: the issuer re-stamps an unchanged Total Net Assets with its daily refresh date (FLAU $224.46M
 * read "As of 10/22/2026" on Friday night and "As of 10/25/2026" on Sunday), and a rerun must neither move the date
 * back nor forward for the same number.
 */
export function stableAumAsOf(value: number | null, sourceAsOf: string | null, published: { value?: unknown; asOfDate?: unknown } | null | undefined): string | null {
  if (!sourceAsOf) return null;
  const publishedAsOf = isoDateOrNull(published?.asOfDate);
  return value !== null && publishedAsOf && numberOrNull(published?.value) === value ? publishedAsOf : sourceAsOf;
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
      return '';
    }
    const m = (pat as RegExp).exec(full);
    if (m && m.index !== undefined) {
      const after = full.slice(m.index + m[0].length).trim().replace(/^[:\-\s]+/, '').trim();
      if (after) return after;
    }
    return '';
  };
  let best: JsonRecord | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const joined = line.cells.join(' | ') || line.text;
    const haystack = joined || line.text;
    if (!test(haystack)) continue;
    let value = '';
    if (line.cells.length >= 2) {
      const idx = line.cells.findIndex((c) => test(c));
      if (idx >= 0 && idx + 1 < line.cells.length) value = line.cells.slice(idx + 1).join(' | ');
      else value = line.cells.slice(1).join(' | ');
    } else {
      value = extractAfter(line.text, pattern);
      if (!value) value = extractAfter(joined, pattern);
    }
    let cleaned = cleanText(value);
    // If value empty or equals pattern or doesn't look like data, look ahead 1-3 lines
    if (!cleaned || cleaned.toLowerCase() === (isString ? (pattern as string).toLowerCase() : '') || cleaned.length < 2 || /^[\s\-—]+$/.test(cleaned)) {
      for (let j = 1; j <= 3; j++) {
        if (i + j >= lines.length) break;
        const next = lines[i + j];
        const nextText = cleanText(next.text);
        if (!nextText) continue;
        // Skip if next line is another label (contains known label keywords)
        if (/^(Fund Inception Date|Listing Exchange|Dividend Frequency|Gross Expense|Net Expense|CUSIP|ISIN|Bloomberg|Morningstar|Fiscal Year|ETF Type|Shares Outstanding|Daily Volume|Benchmark|Total Net Assets|NAV|Market Price|Premium|Discount|YTD|As of)/i.test(nextText) && !test(nextText)) {
          // If next line looks like a value (contains $, %, digit, or is short), use it
          if (/[\$\d%]/.test(nextText) || /^[A-Z0-9]{9}$/.test(nextText) || /^US[A-Z0-9]{10}$/.test(nextText) || /NYSE|Nasdaq/i.test(nextText)) {
            cleaned = nextText;
            break;
          }
          // If next line is just a value like $4.16B or 0.19% or 35473P686, use it
        }
        if (nextText.length < 100 && ( /[\$\d%]/.test(nextText) || /^[A-Z0-9]{6,12}$/.test(nextText) || /^(NYSE|NASDAQ|Cboe|BATS)/i.test(nextText) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(nextText) )) {
          // Avoid picking up unrelated long text
          if (nextText.length < 50 || /[\$%]/.test(nextText) || /^\d/.test(nextText)) {
            cleaned = nextText;
            break;
          }
        }
        // For Total Net Assets, NAV, etc., next line often is the value itself
        if (next.cells.length === 0 && nextText.length < 80) {
          cleaned = nextText;
          break;
        }
      }
    }
    if (!cleaned) continue;
    // Skip if cleaned is just the label again
    if (isString && cleaned.toLowerCase() === (pattern as string).toLowerCase()) continue;
    const score = cleaned.length + (line.text.length > 200 ? 1000 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { value: cleaned, text: joined, line: i, asOf: firstDate(joined) || firstDate(line.text) || firstDate(lines[i + 1]?.text || '') || firstDate(lines[i + 2]?.text || '') };
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
  const t = ticker.toUpperCase();
  if (FRANKLIN_CANONICAL_PAGES[t]) return FRANKLIN_CANONICAL_PAGES[t];
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
  const catalogAsOf = parsePerformanceAsOf(source);

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

      // Extract table cells after the link – robust handling of extra notes like
      // "Upcoming Liquidation", "Click the fund name..." which appear before returns
      let after = line.slice((match.index ?? 0) + match[0].length);
      // Clean HTML and markdown artifacts
      after = after.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ');
      after = after.replace(/Upcoming Liquidation/gi, ' ');
      after = after.replace(/Click the fund name for more information\./gi, ' ');
      after = after.replace(/\*\*Click[^*]*\*\*/gi, ' ');
      after = after.replace(/\s+/g, ' ').trim();
      const rawCells = after.split('|').map((c) => cleanText(c.replace(/\*\*/g, ''))).filter((c) => c !== '');
      // Filter out cells that are clearly not data (e.g. "Checkbox", empty, "Download Fact Sheet", etc.)
      // Keep cells that look like returns (% or —), expense (contains %), AUM (contains $), or date+number
      let cells = rawCells.filter(c => {
        if (/^Checkbox$/i.test(c)) return false;
        if (/Download Fact Sheet/i.test(c)) return false;
        if (/Close modal/i.test(c)) return false;
        if (/Fact Sheet not available/i.test(c)) return false;
        if (c.length > 200) return false;
        return true;
      });

      // cells layout: YTD, 1Y, 3Y, 5Y, SinceInception + date, Expense, AUM, FactSheet
      // Example: -0.40% | 3.47 | 4.19 | — | 3.54 07/25/2023 | Gross Net 0.39% 0.39% | $9.53 Million
      // But sometimes first cells are junk, so find first cell that looks like a return (% or — or number)
      let ytd: number | null = null;
      let yr1: number | null = null;
      let yr3: number | null = null;
      let yr5: number | null = null;
      let sinceInception: number | null = null;
      let inception: string | null = null;
      let ter: number | null = null;
      let netAssets: number | null = null;

      // Find start index of returns: first cell that is % or — or numeric (including negative)
      let returnStart = -1;
      for (let ci = 0; ci < cells.length; ci++) {
        const cell = cells[ci];
        if (/^[-—]?\s*[\d.]+%/.test(cell) || /^[-—]$/.test(cell) || /^[-+]?\d+(?:\.\d+)?$/.test(cell) || cell === '—' || cell === '--' || /^\d+\.\d+\s*\d{1,2}\/\d{1,2}\/\d{4}/.test(cell)) {
          returnStart = ci;
          break;
        }
        // Also handle cell like "-0.40%" with zero-width spaces
        if (/[\d.]+%/.test(cell) && cell.length < 20) {
          returnStart = ci;
          break;
        }
      }
      // If not found, try to find any cell with % in first 5 cells
      if (returnStart === -1) {
        for (let ci = 0; ci < Math.min(5, cells.length); ci++) {
          if (/%/.test(cells[ci]) || cells[ci] === '—') {
            returnStart = ci;
            break;
          }
        }
      }

      if (returnStart >= 0) {
        const returnsSlice = cells.slice(returnStart);
        if (returnsSlice.length >= 1) ytd = numberOrNull(returnsSlice[0]);
        if (returnsSlice.length >= 2) yr1 = numberOrNull(returnsSlice[1]);
        if (returnsSlice.length >= 3) yr3 = numberOrNull(returnsSlice[2]);
        if (returnsSlice.length >= 4) yr5 = numberOrNull(returnsSlice[3]);
        if (returnsSlice.length >= 5) {
          const siCell = returnsSlice[4];
          sinceInception = numberOrNull(siCell);
          inception = firstDate(siCell);
        }
        // Expense and AUM are after the 5 return cells
        // Look for expense: cell containing % after returns, and AUM: cell containing $
        for (let ci = 5; ci < returnsSlice.length; ci++) {
          const cell = returnsSlice[ci];
          if (ter === null && /%/.test(cell)) {
            const percents = cell.match(/[\d.]+%/g) || [];
            if (percents.length) {
              ter = numberOrNull(percents[percents.length - 1]);
            }
          }
          if (netAssets === null && /\$/.test(cell)) {
            const m = /\$([\d.,]+)\s*(Million|Billion|Thousand|M|B|K)?/i.exec(cell);
            if (m) {
              let val = Number(m[1].replace(/,/g, ''));
              const unit = (m[2] || '').toLowerCase();
              if (unit.startsWith('b')) val *= 1e9;
              else if (unit.startsWith('m')) val *= 1e6;
              else if (unit.startsWith('k') || unit.startsWith('th')) val *= 1e3;
              netAssets = val;
            }
          }
        }
        // Fallback: if not found in returnsSlice, search all cells
        if (ter === null) {
          for (const cell of cells) {
            if (/%/.test(cell) && /Gross|Net/i.test(cell)) {
              const percents = cell.match(/[\d.]+%/g) || [];
              if (percents.length) {
                ter = numberOrNull(percents[percents.length - 1]);
                break;
              }
            }
          }
        }
        if (netAssets === null) {
          for (const cell of cells) {
            if (/\$/.test(cell)) {
              const m = /\$([\d.,]+)\s*(Million|Billion|Thousand|M|B|K)?/i.exec(cell);
              if (m) {
                let val = Number(m[1].replace(/,/g, ''));
                const unit = (m[2] || '').toLowerCase();
                if (unit.startsWith('b')) val *= 1e9;
                else if (unit.startsWith('m')) val *= 1e6;
                else if (unit.startsWith('k') || unit.startsWith('th')) val *= 1e3;
                netAssets = val;
                break;
              }
            }
          }
        }
      } else {
        // Fallback to old simple parsing if no return start found
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
          const percents = cells[5].match(/[\d.]+%/g) || [];
          if (percents.length) {
            ter = numberOrNull(percents[percents.length - 1]);
          }
        }
        if (cells.length >= 7) {
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

      if (catalogAsOf) fund.performanceAsOf = catalogAsOf;

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

function isValidFundName(value: string): boolean {
  const v = cleanText(value);
  if (!v) return false;
  if (v.length > 120) return false;
  if (v.length < 5) return false;
  if (/franklintempleton\.com/i.test(v)) return false;
  if (/https?:\/\//i.test(v)) return false;
  if (v.includes('/') && v.includes('.com')) return false;
  // URL path like franklintempleton.com/.../fltw-etf should be rejected (contains / and -etf but no space)
  if (v.includes('/') && !v.includes(' ')) return false;
  if (/^[\w.-]+\/[\w\/.-]+$/.test(v) && !v.includes(' ')) return false;
  // Must contain ETF or be at least 2 words
  if (!/\bETF\b/i.test(v) && v.split(/\s+/).length < 2) return false;
  return true;
}

function isValidCategory(value: string): boolean {
  const v = cleanText(value);
  if (!v) return false;
  if (v.length > 60) return false;
  if (v.length < 2) return false;
  if (/franklintempleton\.com/i.test(v)) return false;
  if (/https?:\/\//i.test(v)) return false;
  if (/node_modules/i.test(v)) return false;
  if (/\.js\b/i.test(v)) return false;
  if (/dist\/libs/i.test(v)) return false;
  if (/apps_core/i.test(v)) return false;
  if (v.includes('/') && v.includes('.js')) return false;
  if (v.includes('**')) return false;
  if (/^[\[\]\"']/.test(v)) return false;
  if (v.startsWith('table_')) return false;
  if (/\.mjs\b/i.test(v)) return false;
  if (v.includes('ratings:**') || v.toLowerCase().includes('tm ratings')) return false;
  // Reject if it looks like a footnote link: [5](https://...)
  if (/^\[\d+\]\(https?:\/\//.test(v)) return false;
  // Reject if contains multiple commas and quotes (JS bundle list)
  if ((v.match(/,/g) || []).length > 3 && v.includes('.js')) return false;
  // A category is a short phrase of words: "Equity", "Fixed Income", "India
  // Equity", "Intermediate Core Bond". Anything with digits, URLs or sentence
  // punctuation ("As of 09/23/2026 (Updated Daily)", "page. If so preload
  // resources", "665.32") is a mis-parsed neighbouring cell, not a category.
  if (/\d/.test(v)) return false;
  if (/[/%.$:;|@#()\[\]{}\"']/.test(v)) return false;
  if (v.split(/\s+/).length > 4) return false;
  if (!/^[A-Za-z][A-Za-z .&'\-]*$/.test(v)) return false;
  const lower = v.toLowerCase().trim();
  const furniture = [
    'asset class', 'fiscal year', 'fiscal year end', 'etf type', 'indexed', 'active', 'passive',
    'updated daily', 'morningstar category', 'distribution frequency', 'dividend frequency',
    'listing exchange', 'fund inception', 'inception date', 'expense ratio', 'gross expense',
    'net expense', 'net assets', 'total net assets', 'shares outstanding', 'benchmark',
    'cusip', 'isin', 'ticker', 'nav', 'market price', 'premium', 'discount', 'holdings',
    'sector', 'top sectors', 'fund description', 'overview', 'price', 'performance',
  ];
  if (furniture.includes(lower)) return false;
  if (/\b(page|resources|preload|updated|daily)\b/.test(lower)) return false;
  // Page furniture rows end with their label word ("... Class", "... End").
  if (/(\bclass|\bdate|\bratio|\bexchange|\bfrequency|\byield|\bend|\bcategory|\btype|\bassets|\boutstanding)$/.test(lower)) return false;
  // Only publish values that look like an asset class / Morningstar category:
  // "Equity", "Fixed Income", "India Equity", "Large Blend", "Digital Assets".
  return /income|equity|bond|blend|growth|value|sector|allocation|commodit|derivative|trading|digital|assets|technology|health|energy|real estate|municipal|money market|target|convertible|nontraditional|market neutral|long-short|leveraged|inverse|precious metals|bank loan|corporate|government|high yield|emerging|foreign|world|large|mid|small|diversified|specialty|strateg|infrastructure|utilities|natural resources|consumer|financial|industrial|communication|index/.test(lower);
}

// The finder groups funds as "Equity", "Fixed Income", ... and the product page
// publishes "Morningstar Category". Only a value that survives isValidCategory
// is published; the neutral 'ETF' fallback is preferred over a wrong label.
export function resolveCategory(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const value = cleanText(candidate);
    if (isValidCategory(value)) return value;
  }
  return 'ETF';
}

const NAME_ACRONYMS: Record<string, string> = {
  etf: 'ETF', etfs: 'ETFs', bdc: 'BDC', clo: 'CLO', ftse: 'FTSE', us: 'U.S.', usa: 'U.S.A.',
  ai: 'AI', esg: 'ESG', reit: 'REIT', reits: 'REITs', nft: 'NFT', ml: 'ML',
};

// "franklin-u-s-core-bond-etf" -> "Franklin U.S. Core Bond ETF". The product URL
// slug carries the official fund name, so it is the fallback whenever the page
// text yields a wrong or truncated name ("Exchange Traded Funds", "FLCA ETF").
export function fundNameFromPageSlug(fundPage: unknown, ticker = ''): string {
  const url = cleanText(fundPage);
  const match = /\/([a-z0-9][a-z0-9-]*?)\/([A-Z0-9]{2,6})\/?(?:[?#].*)?$/i.exec(url);
  const slug = match ? match[1].toLowerCase() : '';
  if (!slug) return '';
  if (ticker && slug === ticker.toLowerCase()) return '';
  const words = slug.split('-').filter(Boolean);
  if (!words.length) return '';
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === 'u' && words[i + 1] === 's' && words[i + 2] === 'a') { out.push('U.S.A.'); i += 2; continue; }
    if (word === 'u' && words[i + 1] === 's') { out.push('U.S.'); i++; continue; }
    if (NAME_ACRONYMS[word]) { out.push(NAME_ACRONYMS[word]); continue; }
    out.push(word.charAt(0).toUpperCase() + word.slice(1));
  }
  const name = cleanText(out.join(' '));
  return name && /\bETF\b|\bFund\b|\bTrust\b/i.test(name) ? name : '';
}

/** Product pages append the section they were opened with ("- NAV Return (%)"). */
export function cleanFundName(raw: unknown, ticker = ''): string {
  let name = cleanText(raw).replace(/\*+/g, '');
  if (!name) return '';
  if (ticker) {
    const safeTicker = ticker.replace(/[^A-Za-z0-9]/g, '');
    if (safeTicker) name = name.replace(new RegExp(`^${safeTicker}\\s+`, 'i'), '');
  }
  name = name.replace(/\s*[-\u2013\u2014:|]\s*(NAV|Market\s*Price)\b[^,;]*$/i, '');
  name = name.replace(/\s*\(%\)\s*$/i, '');
  name = name.replace(/\s*[-\u2013\u2014]\s*[A-Z0-9]{2,6}\s*$/, '');
  name = cleanText(name);
  return isValidFundName(name) ? name : '';
}

function significantWords(value: string): string[] {
  const stop = new Set(['and', 'the', 'of', 'for', 'etf', 'etfs', 'fund', 'funds', 'index']);
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !stop.has(word));
}

/**
 * Product-page titles are unreliable ("Exchange Traded Funds", "FLCA ETF").
 * Keep the scraped name when it clearly describes the fund (at least two
 * significant words in common with the URL slug), otherwise publish the slug.
 */
export function resolveFundName(raw: unknown, fundPage: unknown, ticker: string): string {
  const cleaned = cleanFundName(raw, ticker);
  const slugName = fundNameFromPageSlug(fundPage, ticker);
  if (!cleaned) return slugName || `${ticker} ETF`;
  if (!slugName) return cleaned;
  const slugWords = new Set(significantWords(slugName));
  const shared = significantWords(cleaned).filter((word) => slugWords.has(word));
  return shared.length >= 2 ? cleaned : slugName;
}

/** 10-year figures only exist once the fund is ten years old. */
export function tenYearEligible(inception: unknown, now = Date.now()): boolean {
  const iso = toIsoDate(inception);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return true;
  const started = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(started)) return true;
  return now - started >= 10 * 365.25 * 24 * 3600 * 1000;
}

// "Morningstar Category" and "Asset Class" are rendered as a label/value list,
// but the value is not always on the label line, so scan a few lines and keep
// the first candidate that really looks like a category.
function lookupCategoryValue(lines: TextLine[], pattern: string | RegExp): string {
  const isString = typeof pattern === 'string';
  const test = (text: string): boolean => (isString ? text.toLowerCase().includes((pattern as string).toLowerCase()) : (pattern as RegExp).test(text));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const haystack = line.cells.length >= 2 ? line.cells.join(' | ') : line.text;
    if (!test(haystack)) continue;
    const candidates: string[] = [];
    if (line.cells.length >= 2) {
      const idx = line.cells.findIndex(test);
      if (idx >= 0 && idx + 1 < line.cells.length) candidates.push(line.cells.slice(idx + 1).join(' '));
    }
    if (isString) {
      const at = haystack.toLowerCase().indexOf((pattern as string).toLowerCase());
      if (at >= 0) candidates.push(haystack.slice(at + (pattern as string).length));
    } else {
      const match = (pattern as RegExp).exec(haystack);
      if (match && match.index !== undefined) candidates.push(haystack.slice(match.index + match[0].length));
    }
    for (let j = 1; j <= 4; j++) {
      const next = lines[i + j];
      if (!next) break;
      if (/^(?:Morningstar Category|Asset Class|Fiscal Year|ETF Type|Fund Inception|Listing Exchange)/i.test(next.text)) break;
      if (next.cells.length === 0 && next.text.length <= 45) candidates.push(next.text);
    }
    for (const candidate of candidates) {
      const value = cleanText(candidate).replace(/^[:\-|\s]+/, '').trim();
      if (isValidCategory(value)) return value;
    }
  }
  return '';
}

// The page repeats the frequency: the Overview row ("Dividend Frequency, if any
// Monthly This fund is an ex-Dividend fund") and the Distributions block
// ("Distribution Frequency Monthly"). Both carry page furniture, so every
// candidate is normalized and only the canonical word is returned; the
// Distributions block wins because it is the authoritative row.
function extractDistributionFrequency(lines: TextLine[]): string | null {
  const collect = (pattern: RegExp): string[] => {
    const found: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const haystack = line.cells.length >= 2 ? line.cells.join(' | ') : line.text;
      if (!pattern.test(haystack)) continue;
      if (line.cells.length >= 2) {
        const idx = line.cells.findIndex((cell) => pattern.test(cell));
        found.push(idx >= 0 && idx + 1 < line.cells.length ? line.cells.slice(idx + 1).join(' ') : haystack);
      } else {
        found.push(line.text);
      }
      // The value often continues on one of the next lines.
      for (let j = 1; j <= 2; j++) {
        const next = lines[i + j];
        if (!next) break;
        if (/frequency/i.test(next.text)) break;
        if (next.text.length <= 60) found.push(next.text);
      }
      if (found.length > 6) break;
    }
    return found;
  };
  const firstCanonical = (candidates: string[]): string | null => {
    for (const candidate of candidates) {
      const normalized = normalizeDistributionFrequency(candidate);
      if (normalized !== '—') return normalized;
    }
    return null;
  };
  return firstCanonical(collect(/distribution frequency/i))
    ?? firstCanonical(collect(/dividend frequency|frequency,?\s*if any/i));
}

/** Footnote markers rendered as links ("NAV[1](https://...#footnote_1)(Net Asset Value)$21.99") break label parsing. */
export function stripFootnoteMarkers(text: string): string {
  return String(text ?? '').replace(/\[[\d,\s]+\]\(https?:\/\/[^)\s]*\)/g, '');
}

/**
 * The "Share Prices" block of the Pricing section: the only place that prints the NAV and the market price
 * together with one as-of date. Returns null when the block is not on the page (collapsed or legacy layout).
 */
export function parseSharePrices(lines: TextLine[]): { nav: number | null; marketPrice: number | null; asOfDate: string | null } | null {
  const start = lines.findIndex((line) => /^#{2,6}\s*Share Prices\b/i.test(line.text));
  if (start < 0) return null;
  let nav: number | null = null;
  let marketPrice: number | null = null;
  let asOfDate: string | null = null;
  for (let i = start + 1; i < lines.length && i <= start + 24; i += 1) {
    const text = lines[i].text;
    if (/^#{1,6}\s/.test(text)) break;
    asOfDate ??= /^As of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text)?.[1] ? firstDate(text) : null;
    nav ??= numberOrNull(/^NAV\s*(?:\(Net Asset Value\))?\s*\$\s*(-?[\d,]+(?:\.\d+)?)/i.exec(text)?.[1] ?? null);
    marketPrice ??= numberOrNull(/^Market Price\s*\$\s*(-?[\d,]+(?:\.\d+)?)/i.exec(text)?.[1] ?? null);
  }
  return nav === null && marketPrice === null ? null : { nav, marketPrice, asOfDate };
}

/**
 * The official "Distribution Rate" of the product page: the most recent distribution annualized and divided by the
 * closing market price or NAV (footnote on the page; special distributions excluded). It is printed twice, in the
 * overview ("Distribution Rate at NAV  As of 10/02/2026 (Updated Daily) 1.18%") and in the Rates and Yields block
 * ("Distribution Rate" / "As of ..." / "At Net Asset Value (NAV) 1.18%"). The NAV basis wins over the market price
 * basis when both are printed; a rate without a stated basis is accepted with a null basis. The footnote line
 * ("9. Distribution Rate is calculated ...") never matches because it does not start with the label.
 */
export function parseDistributionRate(lines: TextLine[]): { value: number; asOfDate: string | null; basis: string | null } | null {
  const found: Array<{ value: number; asOfDate: string | null; basis: string | null }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^Distribution Rate\b/i.test(lines[i].text)) continue;
    let block = lines[i].text;
    for (let j = i + 1; j < lines.length && j <= i + 3; j += 1) {
      if (/^(#|30-Day|SEC\b|Dividend|Distribution Rate\b)/i.test(lines[j].text)) break;
      block += ` ${lines[j].text}`;
      if (/%/.test(lines[j].text)) break;
    }
    const value = percentValue({ value: block.replace(/^Distribution Rate/i, '') });
    if (value === null || value < 0) continue;
    // no trailing \b below: once the footnote marker is stripped, "NAV" and "As of" run together ("NAVAs of 10/02/2026")
    const basisMatch = /\bat\s+(NAV|Net Asset Value|Market Price)/i.exec(block);
    const basis = basisMatch ? (/market/i.test(basisMatch[1]) ? 'market price' : 'NAV') : null;
    found.push({ value, asOfDate: firstDate(block) || null, basis });
  }
  return found.find((entry) => entry.basis === 'NAV') ?? found[0] ?? null;
}

/** The date printed right under the "Holdings" heading of the Portfolio section ("### Holdings / As of 10/02/2026"). */
export function parseHoldingsAsOf(lines: TextLine[]): string | null {
  const start = lines.findIndex((line) => /^#{2,6}\s*Holdings\s*$/i.test(line.text));
  if (start < 0) return null;
  for (let i = start + 1; i <= start + 3 && i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i].text)) break;
    if (/^As of\b/i.test(lines[i].text)) return firstDate(lines[i].text);
  }
  return null;
}

export function parseFranklinProductPage(text: string, ticker: string): ProductPageSummary {
  const original = String(text ?? '');
  const source = stripFootnoteMarkers(stripProxyPreamble(original));
  const cleaned = htmlToText(source);
  const lines = toTextLines(cleaned + '\n' + source.replace(/<[^>]+>/g, '\n'));
  const sharePrices = parseSharePrices(lines);

  const name = (() => {
    // 1) Title: line from jina.ai preamble (original, not stripped)
    const titleMatch = /Title:\s*([^\n]+?)\s*(?:\|\s*Franklin|\s*-\s*[A-Z]{2,6}\s*(?:\||$))/i.exec(original);
    if (titleMatch) {
      const cand = cleanText(titleMatch[1].split('|')[0].split(' - ')[0]);
      if (isValidFundName(cand)) return cand;
    }
    const title2 = /Title:\s*([^\n]+?)\s*-\s*[A-Z]{2,6}\s*\|/i.exec(original);
    if (title2) {
      const cand = cleanText(title2[1]);
      if (isValidFundName(cand)) return cand;
    }
    // 2) Markdown heading: "# FLTW Franklin FTSE Taiwan ETF" or "# Franklin FTSE Taiwan ETF - FLTW"
    for (const line of lines) {
      const txt = line.text;
      // Heading often starts with # and contains ticker and ETF
      if (/^#+\s*/.test(txt) && /\bETF\b/i.test(txt)) {
        // Remove leading # and ticker
        let cand = txt.replace(/^#+\s*/, '').trim();
        cand = cand.replace(new RegExp(`^${ticker}\\s+`, 'i'), '').trim();
        cand = cand.replace(new RegExp(`\\s*-?\\s*${ticker}\\s*$`, 'i'), '').trim();
        cand = cleanText(cand);
        if (isValidFundName(cand)) return cand;
      }
    }
    // 3) Look for lines with Franklin/Brandywine... + ETF but without URL markers
    const candidates: string[] = [];
    for (const line of lines) {
      const txt = line.text;
      if (txt.length > 120) continue;
      if (/franklintempleton\.com/i.test(txt)) continue;
      if (/https?:\/\//i.test(txt)) continue;
      if (txt.includes('/') && txt.includes('.com')) continue;
      const m = /(?:Franklin|BrandywineGLOBAL|ClearBridge|Western Asset|Putnam)[^|\n]{0,80}?\bETF\b[^\n|]{0,20}/i.exec(txt);
      if (m) {
        const cand = cleanText(m[0]);
        if (isValidFundName(cand)) candidates.push(cand);
      }
    }
    if (candidates.length) {
      // Prefer shortest that looks like a proper name (contains space, not just ticker)
      candidates.sort((a, b) => a.length - b.length);
      for (const cand of candidates) {
        if (cand.split(/\s+/).length >= 2) return cand;
      }
      return candidates[0];
    }
    // 4) Fallback to ticker ETF, but try to improve from slug if available
    return `${ticker} ETF`;
  })();

  // Identifiers
  const cusipLabel = lookupLabel(lines, 'CUSIP Code') || lookupLabel(lines, /^CUSIP$/i);
  const isinLabel = lookupLabel(lines, 'ISIN Code') || lookupLabel(lines, /^ISIN$/i);
  const exchangeLabel = lookupLabel(lines, 'Listing Exchange') || lookupLabel(lines, /^Exchange$/i);
  const inceptionLabel = lookupLabel(lines, 'Fund Inception Date') || lookupLabel(lines, 'Inception Date');
  const benchmarkLabel = lookupLabel(lines, 'Benchmark') || lookupLabel(lines, 'Underlying Index');
  // Strict category parsing: only exact "Morningstar Category", not generic "Morningstar" which matches rating disclaimer
  const categoryLabelRaw = lookupLabel(lines, 'Morningstar Category');
  const assetClassLabelRaw = lookupLabel(lines, 'Asset Class');
  const etfTypeLabel = lookupLabel(lines, 'ETF Type');
  // "NAV $34.85" (value on the same line), "NAV  $0.42(0.38%)" (the day change,
  // the actual NAV on the next line) and a bare "NAV" label cell must all be
  // recognised; "NAV Return" lines from the performance block must not be.
  const navLabel = lookupLabel(lines, /^NAV\b(?!\s*(?:Return|Calculation))/i) || lookupLabel(lines, 'NAV Calculation');
  const marketPriceLabel = lookupLabel(lines, 'Market Price') || lookupLabel(lines, 'Market Price Return');
  const totalNetAssetsLabel = lookupLabel(lines, 'Total Net Assets');
  const grossExpenseLabel = lookupLabel(lines, 'Gross Expense Ratio');
  const netExpenseLabel = lookupLabel(lines, 'Net Expense Ratio') || lookupLabel(lines, 'Expense Ratio');
  const secYieldLabel = lookupLabel(lines, 'SEC 30-Day Yield') || lookupLabel(lines, /SEC.*Yield/i);
  const distributionYieldLabel = lookupLabel(lines, '12-Month Yield') || lookupLabel(lines, /12-Month Yield|Distribution Yield/i);
  const frequencyLabel = lookupLabel(lines, /Distribution Frequency/i) || lookupLabel(lines, 'Dividend Frequency');
  const holdingsLabel = lookupLabel(lines, 'Number of Holdings') || lookupLabel(lines, /Number of Holdings|Holdings/i);
  const sharesLabel = lookupLabel(lines, 'Shares Outstanding');
  const premiumLabel = lookupLabel(lines, 'Premium / Discount') || lookupLabel(lines, /Premium\s*(?:\/|and)?\s*Discount/i);

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
  // Validate categories – reject JS bundle garbage and footnote links
  const rawMorningstar = lookupCategoryValue(lines, 'Morningstar Category') || labelText(categoryLabelRaw);
  const rawAsset = lookupCategoryValue(lines, 'Asset Class') || labelText(assetClassLabelRaw);
  const morningstarCategory = isValidCategory(rawMorningstar) ? rawMorningstar : 'ETF';
  const assetClass = isValidCategory(rawAsset) ? rawAsset : (isValidCategory(rawMorningstar) ? rawMorningstar : 'ETF');
  const etfType = labelText(etfTypeLabel) || 'ETF';

  const inception = firstDate(labelText(inceptionLabel));
  // NAV – page shows change $0.42 then actual $110.52 on next line; we need actual
  const nav = sharePrices ? sharePrices.nav : (() => {
    // Try label first
    let v = labelNumber(navLabel);
    // If v is small (<5) likely change, look ahead for larger NAV
    if (v !== null && v < 5) {
      // Search next lines after navLabel for $ amount >5
      const navIdx = lines.findIndex(l => /^\s*NAV\b/i.test(l.text) || l.text.toLowerCase().includes('nav'));
      if (navIdx >= 0) {
        for (let j = 1; j <= 5; j++) {
          if (navIdx + j >= lines.length) break;
          const txt = lines[navIdx + j].text;
          const m = /\$([\d,]+\.?\d*)/.exec(txt);
          if (m) {
            const candidate = numberOrNull(m[1]);
            if (candidate !== null && candidate > 5) return candidate;
          }
        }
      }
      // Fallback: search full text for $ amount followed by As of
      const full = lines.map(l => l.text).join('\n');
      const m = /\$([\d,]+\.\d+)\s*\n+As of/i.exec(full);
      if (m) {
        const cand = numberOrNull(m[1]);
        if (cand !== null && cand > 5) return cand;
      }
      // If still small, keep but try to find larger in next lines
      const allNavs = [...full.matchAll(/\$([\d,]+\.\d+)/g)].map(x => numberOrNull(x[1])).filter((n): n is number => n !== null && n > 10);
      if (allNavs.length) return allNavs[0];
    }
    if (v !== null) return v;
    // Final fallback: find $ amount near NAV text
    const full = lines.map(l => l.text).join('\n');
    const navBlock = /NAV[^\n]*\n+\s*\$([\d,]+\.?\d*)/i.exec(full);
    if (navBlock) {
      const cand = numberOrNull(navBlock[1]);
      if (cand !== null) return cand;
    }
    return null;
  })();
  const marketPrice = sharePrices ? sharePrices.marketPrice : labelNumber(marketPriceLabel);
  const totalNetAssets = (() => {
    const raw = labelText(totalNetAssetsLabel);
    const m = /\$([\d.,]+)\s*(Million|Billion|Thousand|M|B|K|Billion)?/i.exec(raw);
    if (m) {
      let val = Number(m[1].replace(/,/g, ''));
      const unit = (m[2] || '').toLowerCase();
      if (unit.startsWith('b')) val *= 1e9;
      else if (unit.startsWith('m')) val *= 1e6;
      else if (unit.startsWith('k') || unit.startsWith('th')) val *= 1e3;
      return val;
    }
    // Also try to parse $4.16B format directly from label value
    const m2 = /\$([\d.]+)\s*([B])\b/i.exec(raw);
    if (m2) {
      const val = Number(m2[1]);
      if (Number.isFinite(val)) return val * 1e9;
    }
    return labelNumber(totalNetAssetsLabel);
  })();
  const grossExpense = labelNumber(grossExpenseLabel);
  const netExpense = labelNumber(netExpenseLabel) ?? grossExpense;
  // Yields are percentages: labelNumber would happily read the "30" of
  // "SEC 30-Day Yield", so the value must be anchored on the "%" sign.
  const secYield = percentValue(secYieldLabel);
  const distributionYield = percentValue(distributionYieldLabel);
  const rate = parseDistributionRate(lines);
  const distributionRate = rate?.value ?? null;
  const frequencyRaw = extractDistributionFrequency(lines) || normalizeDistributionFrequency(labelText(frequencyLabel));
  const totalHoldings = labelNumber(holdingsLabel);
  const sharesOutstanding = labelNumber(sharesLabel);
  const premiumDiscount = plausiblePremiumDiscount(percentValue(premiumLabel));

  // Returns – product page contains:
  // YTD Total Returns At NAV 81.22% As of 09/23/2026
  // and a performance block:
  // Market Price Return / NAV Return
  // 96.86%1 Year / 44.10%3 Years / 20.96%5 Years / —10 Years / 19.77%Since Inception
  // We parse both and merge into returns (catalog is fallback, product page is primary)
  const returns: CatalogReturns = { ...EMPTY_RETURNS };
  const fullText = lines.map(l => l.text).join('\n');

  // YTD from the product page. The value either follows the "YTD Total Returns
  // At NAV/Market Price" label (often behind a footnote marker, sometimes after
  // a sentence of footnote copy) or sits on a line of its own; parse both so a
  // longer footnote does not silently drop the value.
  const extractYtd = (): number | null => {
    const direct = /YTD Total Returns At (?:NAV|Market Price)[\s\S]{0,160}?([-+]?\d+(?:\.\d+)?)\s*%/i.exec(fullText);
    if (direct) {
      const v = numberOrNull(direct[1]);
      if (v !== null) return v;
    }
    const periodStop = /1\s*Year|3\s*Years?|5\s*Years?|10\s*Years?|Since\s*Inception|Expense Ratio|Net Assets/i;
    for (let i = 0; i < lines.length; i++) {
      const txt = lines[i].text;
      if (!/YTD/i.test(txt)) continue;
      if (periodStop.test(txt)) continue;
      for (let j = 0; j <= 2; j++) {
        const line = lines[i + j];
        if (!line) break;
        if (j > 0 && periodStop.test(line.text)) break;
        const m = /([-+]?\d+(?:\.\d+)?)\s*%/.exec(line.text);
        if (m) {
          const v = numberOrNull(m[1]);
          if (v !== null) return v;
        }
      }
    }
    return null;
  };
  const ytdValue = extractYtd();
  if (ytdValue !== null) returns.ytd = ytdValue;

  // Helper to extract returns like "96.86%1 Year" or "44.10%3 Years" etc.
  // Both directions are line-anchored: the value must not be carried over from
  // the previous period ("YTD -7.35%" followed by "1 Year" must not become
  // the 1-year return).
  const extractReturn = (labelRegex: RegExp): number | null => {
    const re = new RegExp(`([-+]?\\d+(?:\\.\\d+)?)[ \\t]*%[ \\t]*${labelRegex.source}`, 'i');
    const m = re.exec(fullText);
    if (m) {
      const v = numberOrNull(m[1]);
      if (v !== null) return v;
    }
    const re2 = new RegExp(`${labelRegex.source}[^\\d\\-—]{0,40}?([-+]?\\d+(?:\\.\\d+)?)[ \\t]*%`, 'i');
    const m2 = re2.exec(fullText);
    if (m2) {
      const v = numberOrNull(m2[1]);
      if (v !== null) return v;
    }
    return null;
  };

  const yearPatterns: { key: keyof CatalogReturns; regex: RegExp }[] = [
    { key: 'yr1', regex: /1\s*Year/i },
    { key: 'yr3', regex: /3\s*Years?/i },
    { key: 'yr5', regex: /5\s*Years?/i },
    { key: 'yr10', regex: /10\s*Years?/i },
    { key: 'sinceInception', regex: /Since\s*Inception/i },
  ];
  for (const { key, regex } of yearPatterns) {
    const v = extractReturn(regex);
    if (v !== null) (returns as any)[key] = v;
  }

  for (const line of lines) {
    const txt = line.text;
    const m = /([-+]?\d+(?:\.\d+)?)\s*%\s*(1\s*Year|3\s*Years?|5\s*Years?|10\s*Years?|Since\s*Inception)/i.exec(txt);
    if (m) {
      const val = numberOrNull(m[1]);
      const label = m[2].toLowerCase();
      if (val !== null) {
        if (label.includes('1 year')) returns.yr1 = val;
        else if (label.includes('3 year')) returns.yr3 = val;
        else if (label.includes('5 year')) returns.yr5 = val;
        else if (label.includes('10 year')) returns.yr10 = val;
        else if (label.includes('since')) returns.sinceInception = val;
      }
    }
    // fallback only (extractYtd above is the primary), and lazy: a greedy `[^%]*` kept only the last digit ("81.22%" -> 2)
    // and dropped the sign
    const ytdLine = returns.ytd === null ? /YTD[^%]*?([-+]?\d+(?:\.\d+)?)\s*%/i.exec(txt) : null;
    if (ytdLine) {
      const v = numberOrNull(ytdLine[1]);
      if (v !== null) returns.ytd = v;
    }
  }

  // A fund younger than ten years has no 10-year return; the live performance
  // block prints the since-inception value in that slot.
  if (!tenYearEligible(inception)) returns.yr10 = null;

  const factSheet = linkUrls(source, /fact-sheet|FactSheet/i)[0] || null;

  // A page that loaded fully has all three anchors: identifiers/fees (Overview), Total Net Assets (Portfolio >
  // Assets) and the Share Prices block (Pricing). The last two sit in lazily rendered sections, which is what
  // goes missing on a partial render. Returns, yields and holdings are tracked too but never required: young
  // funds have no returns, equity funds no yields.
  const sections: PageSections = {
    facts: Boolean(/^[A-Z0-9]{9}$/.test(cusip) || /^[A-Z0-9]{12}$/.test(isin) || netExpense !== null),
    returns: [returns.yr1, returns.yr3, returns.yr5, returns.yr10, returns.sinceInception].some((value) => value !== null),
    assets: totalNetAssets !== null,
    pricing: sharePrices !== null,
    yields: secYield !== null || distributionYield !== null || distributionRate !== null,
    holdings: parseFranklinHoldings(source).length > 0,
  };

  return {
    name: cleanFundName(name, ticker) || `${ticker} ETF`,
    cusip: /^[A-Z0-9]{9}$/.test(cusip) ? cusip : '',
    isin: /^[A-Z0-9]{12}$/.test(isin) ? isin : '',
    exchange: exchange || 'NYSEArca',
    benchmark,
    morningstarCategory,
    assetClass,
    etfType,
    inception,
    nav,
    navAsOfDate: sharePrices ? sharePrices.asOfDate : labelAsOf(navLabel),
    totalNetAssets,
    totalNetAssetsAsOfDate: blockAsOf(lines, totalNetAssetsLabel),
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
    marketPriceAsOfDate: sharePrices ? (marketPrice !== null ? sharePrices.asOfDate : null) : labelAsOf(marketPriceLabel),
    dividendFrequencyRaw: frequencyRaw,
    distributionRate,
    distributionRateAsOfDate: rate?.asOfDate ?? null,
    distributionRateBasis: rate?.basis ?? null,
    factSheet,
    ytdReturn: null,
    returns,
    performanceAsOf: parsePerformanceAsOf(source),
    holdingsAsOfDate: parseHoldingsAsOf(lines),
    sections,
    loadedFully: sections.facts && sections.assets && sections.pricing,
  };
}

export function parseProductPage(text: string, ticker: string): ProductPageSummary {
  return parseFranklinProductPage(text, ticker);
}

// Franklin official holdings from product page Portfolio tab
// The page (via r.jina.ai markdown) contains a table like:
// | Security Name | Weight (%) ... | Market Value ($) ... | Notional Exposure ... | Quantity ... |
// | --- | --- | --- | --- | --- |
// | BHP GROUP LTD | 13.57% | 29.38M USD | ... | 671.70K |
// | BHP GROUP LTD | 13.46% | $27,530,012 | ... | 629,391 |
// We parse it as primary holdings source (daily), SEC N-PORT-P as fallback (quarterly)
function parseFranklinAmount(raw: string): number | null {
  const cleaned = cleanText(raw).replace(/USD|\$/gi, '').trim();
  if (!cleaned) return null;
  // "(1,234.00)" is a negative amount (short futures, payables)
  if (/^\(.*\)$/.test(cleaned)) {
    const inner = parseFranklinAmount(cleaned.slice(1, -1));
    return inner === null ? null : -Math.abs(inner);
  }
  // Handle "29.38M", "671.70K", "137,140,723"
  const m = /([-+]?\d[\d,]*\.?\d*)\s*([KMB])?/i.exec(cleaned);
  if (!m) return numberOrNull(cleaned);
  const num = numberOrNull(m[1]);
  if (num === null) return null;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') return num * 1e3;
  if (suffix === 'M') return num * 1e6;
  if (suffix === 'B') return num * 1e9;
  return num;
}

/** Cells of a markdown table row, empty cells kept so every value stays under its own header. */
function tableCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => cleanText(c));
}

export function parseFranklinHoldings(text: string): JsonRecord[] {
  const source = stripProxyPreamble(text);
  const lines = source.split('\n').map(l => l.trim()).filter(Boolean);
  const holdings: JsonRecord[] = [];

  // Find holdings table header – may appear multiple times, take first with Security Name + Weight
  let headerIdx = -1;
  let headerCells: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('|')) continue;
    const lower = line.toLowerCase();
    if (lower.includes('security name') && lower.includes('weight')) {
      const cells = tableCells(line);
      if (cells.filter((c) => c !== '').length >= 2) {
        headerIdx = i;
        headerCells = cells;
        break;
      }
    }
  }
  if (headerIdx === -1) return [];

  let dataStart = headerIdx + 1;
  if (dataStart < lines.length && /^[\s|:-]+$/.test(lines[dataStart])) {
    dataStart++;
  }

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) break;
    if (line.toLowerCase().includes('security name')) break;
    if (/^[\s|:-]+$/.test(line)) continue;
    // Empty cells are kept: dropping them shifted the row left (an empty weight took the market value)
    const cells = tableCells(line);
    if (cells.filter((c) => c !== '').length < 2) continue;
    // The cell under the header that names the column; the position only when the header lacks that column
    const getCell = (aliases: string[], position: number): string => {
      for (const alias of aliases) {
        const idx = headerCells.findIndex(h => h.toLowerCase().includes(alias.toLowerCase()));
        if (idx >= 0) return cells[idx] ?? '';
      }
      return cells[position] ?? '';
    };

    const name = getCell(['security name', 'name'], 0);
    const weight = getCell(['weight'], 1);
    const marketValue = getCell(['market value'], 2);
    const quantity = getCell(['quantity'], cells.length - 1);

    const weightNum = (() => {
      const n = numberOrNull(weight);
      if (n !== null) return String(n);
      const m = /([-+]?\d+(?:\.\d+)?)\s*%/.exec(weight);
      return m ? m[1] : weight;
    })();

    if (!name || name.toLowerCase().includes('security name')) continue;
    if (name.length > 200) continue;
    if (/franklintempleton\.com/i.test(name)) continue;

    const mvParsed = parseFranklinAmount(marketValue);
    const qtyParsed = parseFranklinAmount(quantity);

    holdings.push({
      name,
      cusip: '',
      ticker: '',
      isin: '',
      sedol: '',
      balance: qtyParsed !== null ? String(qtyParsed) : quantity,
      valUSD: mvParsed !== null ? String(mvParsed) : '',
      pctVal: weightNum,
      assetCat: '',
      issuerCat: '',
      invCountry: '',
      identifier: '',
      rawMarketValue: marketValue,
      rawQuantity: quantity,
    });
  }

  return holdings;
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
// SEC EDGAR Form N-PORT-P: the shared nport-reader block at the end of this file finds, reads and checks the filing
// ---------------------------------------------------------------------------

function secHeaders(): Record<string, string> {
  return { 'User-Agent': SEC_UA, Accept: 'application/json, application/xml, text/xml, text/plain' };
}

/**
 * The fund's registrant CIK and series id for the N-PORT reader: FRANKLIN_SERIES_MAP first (series SEC's
 * company_tickers_mf.json lacks, across the four trusts), else the SEC fund ticker table; null when neither knows the ticker.
 */
async function fundSeriesRef(ticker: string, config: UpdaterConfig): Promise<NportSeriesRef | null> {
  const known = FRANKLIN_SERIES_MAP[ticker];
  if (known) return known;
  return (await loadFundTickerTable(config)).get(ticker) ?? null;
}

/**
 * The Franklin holdings sheet of an N-PORT filing (HOLDINGS_HEADERS): a missing number stays empty (never 0), a missing
 * ticker or identifier is `—`; tickers come from nportTickers (U.S. equities in USD only), identifiers from the position itself.
 */
export function nportHoldingsSheet(filing: NportFiling, tickers: ReadonlyArray<string>): JsonRecord[] {
  return filing.positions.map((position, index) => ({
    Name: position.name || '—',
    Ticker: tickers[index] || '—',
    Identifier: nportIdentifier(position) || '—',
    Weight: nportCell(position.weight),
    'Market Value': nportCell(position.value, 2),
    'Shares Held': nportCell(position.balance),
    'Asset Category': position.assetCat || position.issuerCat || '',
  }));
}

/**
 * Display columns of the official product-page holdings table (parseFranklinHoldings). The table names no identifier,
 * currency or asset class, so a row keeps Ticker and Identifier `—`: a guessed ticker never merges two companies in the hub.
 */
export function officialHoldingsRows(rows: JsonRecord[]): JsonRecord[] {
  return rows.map((row) => {
    const name = cleanText(row.name);
    const val = numberOrNull(row.valUSD);
    const weightVal = numberOrNull(row.pctVal);
    return {
      ...row,
      Ticker: '—',
      Name: name,
      Identifier: '—',
      Weight: weightVal !== null ? weightVal.toFixed(2) : '',
      'Market Value': val !== null ? `${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '',
      'Shares Held': row.balance ? (Number.isFinite(Number(row.balance)) ? Number(row.balance).toLocaleString('en-US') : String(row.balance)) : '',
      'Asset Category': row.assetCat || row.issuerCat || '',
      searchIndex: ` ${name} `.toLowerCase(),
    };
  });
}

// ---------------------------------------------------------------------------
// Yahoo Finance chart parsing (same as Schwab)
// ---------------------------------------------------------------------------

// Yahoo's adjusted close is float32 and its last digits move with the request's period2, so a value
// sitting on a cent boundary (31.544998 vs 31.545001) flips between runs. Within that noise the
// published cent is kept: a rerun with the same source data changes nothing. A real change beyond
// the noise is written.
export const ADJ_CLOSE_NOISE = 1e-4;
export function keptAdjClose(raw: number, published: unknown): string {
  const fresh = raw.toFixed(2);
  const prior = typeof published === 'string' && published.trim() !== '' ? Number(published) : NaN;
  return Number.isFinite(prior) && fresh !== published && Math.abs(raw - prior) <= 0.005 + ADJ_CLOSE_NOISE ? (published as string) : fresh;
}

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
  // Anchor the trailing window to the most recent distribution's own date,
  // not to wall-clock "now": a window relative to the run time drifts a
  // year-old ex-date in and out of range between otherwise-identical runs,
  // flipping the inferred frequency (and the yield derived from it) with no
  // new source data. Anchoring to the data itself makes this deterministic.
  const now = dividends[dividends.length - 1].epoch;
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
  if (!t || t === '—' || t === '-' || t === 'n/a') return '00 - None';
  if (t.includes('monthly')) return '01 - Monthly';
  if (t.includes('quarterly')) return '04 - Quarterly';
  if (t.includes('semi')) return '06 - Semi-annually';
  if (t.includes('annual')) return '12 - Annually';
  if (t.includes('none')) return '00 - None';
  if (t.includes('unknown')) return '00 - Unknown';
  if (t.includes('irregular')) return '99 - Irregular';
  return raw;
}

// Live product pages render the frequency row with page furniture around the
// distribution word, e.g.
//   "Dividend Frequency, if any Monthly This fund is an ex-Dividend fund"
//   "Distribution Frequency Semi-annually"
// Only the canonical word is published in the feed; everything else must never
// reach the Frequency column.
export function normalizeDistributionFrequency(raw: unknown): string {
  const text = cleanText(raw).toLowerCase();
  if (!text || text === '—' || text === '-' || text === 'n/a' || text === 'null') return '—';
  if (/semi[\s-]?annual|semiannual|half[\s-]?year/.test(text)) return 'Semi-annually';
  if (/month/.test(text)) return 'Monthly';
  if (/quarter/.test(text)) return 'Quarterly';
  if (/annual|yearly/.test(text)) return 'Annually';
  if (/irregular/.test(text)) return 'Irregular';
  if (/\bnone\b/.test(text)) return 'None';
  if (/unknown/.test(text)) return 'Unknown';
  return '—';
}

export function paymentsPerYearFor(frequency: unknown): number | null {
  switch (normalizeDistributionFrequency(frequency)) {
    case 'Monthly': return 12;
    case 'Quarterly': return 4;
    case 'Semi-annually': return 2;
    case 'Annually': return 1;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP layer with proxy fallback
// ---------------------------------------------------------------------------

/** Per-request deadline in ms (headers and body). */
export const FETCH_TIMEOUT_MS = 45_000;
const SEC_HOSTS = new Set(['www.sec.gov', 'data.sec.gov', 'sec.gov']);
const GENERIC_UA = 'Mozilla/5.0 (compatible; etf-feed-updater)';

/**
 * The declared SEC contact goes only to sec.gov. Issuer pages, Yahoo and the
 * third-party rendering proxies get a User-Agent without the contact address.
 */
export function userAgentFor(url: string, requested?: string): string {
  let host = '';
  try { host = new URL(url).hostname; } catch { /* keep the generic agent */ }
  if (SEC_HOSTS.has(host)) return requested || SEC_UA;
  return !requested || requested === SEC_UA ? GENERIC_UA : requested;
}

/** Per-worker request lanes: each lane paces its own starts by sleepMs, so N lanes give ~N times the throughput. */
export function createRequestGate(concurrency: number, sleepMs: number, now: () => number = () => clock.now(), wait = sleep): () => Promise<void> {
  const lanes = Array.from({ length: Math.max(1, concurrency) }, () => 0);
  return async () => {
    const time = now();
    let lane = 0;
    for (let i = 1; i < lanes.length; i += 1) if (lanes[i] < lanes[lane]) lane = i;
    const delay = Math.max(0, lanes[lane] - time);
    lanes[lane] = Math.max(time, lanes[lane]) + Math.max(0, sleepMs);
    if (delay) await wait(delay);
  };
}

export function configurePacing(concurrency: number, sleepSeconds: number): void {
  requestSleepSeconds = sleepSeconds;
  directGate = createRequestGate(concurrency, sleepSeconds * 1000);
  proxyGateAt = 0;
}

// Direct requests use per-worker lanes; the r.jina.ai proxy keeps one global gate (rate-limited, min PROXY_SLEEP_SECONDS)
async function paceRequests(proxy = false): Promise<void> {
  if (proxy) {
    const now = clock.now();
    const wait = Math.max(0, proxyGateAt - now);
    proxyGateAt = Math.max(now, proxyGateAt) + Math.max(requestSleepSeconds, PROXY_SLEEP_SECONDS) * 1000;
    if (wait) await sleep(wait);
    return;
  }
  await directGate();
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

export async function fetchText(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  const proxy = isProxyUrl(url);
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      await paceRequests(proxy);
      const isFranklinDirect = url.includes('franklintempleton.com') && !proxy;
      // One deadline covers the headers AND the body, so a stalled body cannot hang a run.
      const timeoutMs = config.fetchTimeoutMs ?? (isFranklinDirect ? 8000 : FETCH_TIMEOUT_MS);
      const signal = AbortSignal.timeout(timeoutMs);
      const response = await fetch(url, { headers: { Accept: '*/*', ...headers, 'User-Agent': userAgentFor(url, headers['User-Agent']) }, redirect: 'follow', signal } as any);
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

/**
 * r.jina.ai answers a burst with 429 RateLimitTriggeredError and a short `retryAfter` (1-2 s). A proxy candidate
 * gets one more attempt after that wait (through the global proxy gate) instead of failing the fund. `retries` is the
 * candidate's one proxy retry, shared with the content-check retry of fetchIssuerText.
 */
async function fetchProxyCandidate(url: string, label: string, config: UpdaterConfig, headers: Record<string, string>, proxy: boolean, retries = { left: 1 }): Promise<string> {
  try {
    return await fetchText(url, label, config, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!proxy || !/\b429\b/.test(message) || retries.left < 1) throw error;
    retries.left -= 1;
    const retryAfter = Number(/"retryAfter":\s*(\d+(?:\.\d+)?)/.exec(message)?.[1] ?? 0);
    await sleep((Math.min(30, Math.max(1, retryAfter)) + 1) * 1000);
    return fetchText(url, label, config, headers);
  }
}

let issuerDirectDenials = 0;
const ISSUER_DIRECT_DENIAL_LIMIT = 2;

async function fetchIssuerText(url: string, label: string, config: UpdaterConfig, validate: (text: string) => boolean, accept = 'text/html,application/xhtml+xml,text/csv,text/plain;q=0.9,*/*;q=0.8', options: { cache?: boolean; maxProxies?: number; prefer?: (text: string) => boolean; renderTimeoutSeconds?: number; skipPlainHttpProxy?: boolean; retryFailedContent?: boolean } = {}): Promise<{ text: string; via: 'direct' | 'proxy' }> {
  let fallback: { text: string; via: 'direct' | 'proxy' } | null = null;
  const allCandidates = buildProxyUrls(url);
  const max = options.maxProxies ?? allCandidates.length;
  const candidates = allCandidates.slice(0, max);
  let lastError: unknown = new Error('no candidates');
  for (let i = 0; i < candidates.length; i++) {
    const candidateUrl = candidates[i];
    const isDirect = i === 0;
    const viaLabel = isDirect ? 'direct' : `proxy ${i}`;
    if (isDirect && issuerDirectDenials >= ISSUER_DIRECT_DENIAL_LIMIT) {
      lastError = new Error('direct request skipped (issuer CDN denies this network)');
      continue;
    }
    if (options.skipPlainHttpProxy && candidateUrl.startsWith(PLAIN_HTTP_PROXY)) continue;
    try {
      const headers: Record<string, string> = isDirect
        ? { 'User-Agent': BROWSER_UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' }
        : { 'User-Agent': SEC_UA, Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8' };
      if (!isDirect && options.cache === false) headers['X-No-Cache'] = 'true';
      if (!isDirect && options.renderTimeoutSeconds && candidateUrl.startsWith(PROXY_PREFIX)) headers['X-Timeout'] = String(options.renderTimeoutSeconds);
      const maxRetriesForCandidate = 0; // fail fast for issuer, we have multiple proxies
      // One proxy retry per candidate (the contract's limit): after a 429, or with retryFailedContent after a snapshot that
      // fails the content check (r.jina.ai sometimes renders a product page empty; XRPZ failed on one such snapshot).
      const retries = { left: 1 };
      const load = async (): Promise<string> => {
        const textRaw = await fetchProxyCandidate(candidateUrl, `${label} (${viaLabel})`, { ...config, maxRetries: maxRetriesForCandidate }, headers, !isDirect, retries);
        return isDirect ? textRaw : stripProxyPreamble(textRaw);
      };
      let text = await load();
      if (!isDirect && options.retryFailedContent && retries.left > 0 && !validate(text)) {
        retries.left -= 1;
        outputNote(`${label}: ${viaLabel} response did not contain expected content, retrying once`);
        text = await load();
      }
      if (validate(text)) {
        if (isDirect) issuerDirectDenials = 0;
        const found = { text, via: isDirect ? 'direct' as const : 'proxy' as const };
        // A usable but unpreferred (partial) page is remembered; the next candidate gets one chance to do better.
        if (!options.prefer || options.prefer(text)) return found;
        fallback ??= found;
        lastError = new Error(`${viaLabel} response came back partial`);
        continue;
      }
      lastError = new Error(`${viaLabel} response did not contain expected content`);
    } catch (error) {
      lastError = error;
      if (isDirect && /\b403\b/.test(error instanceof Error ? error.message : String(error))) {
        issuerDirectDenials += 1;
        
      }
    }
  }
  if (fallback) return fallback;
  const lastMessage = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(lastMessage.startsWith(label) ? lastMessage : `${label}: ${lastMessage}`);
}

// ---------------------------------------------------------------------------
// Previous feed helpers
// ---------------------------------------------------------------------------

/**
 * Net expense ratio carried over from a published index row. Older feeds filled
 * a made-up 0.19 for funds whose product page was never read (no NAV and no AUM
 * from the page); that value is not evidence and is dropped.
 */
export function previousTer(row: JsonRecord): number | null {
  const value = typeof row.terValue === 'number' ? row.terValue : numberOrNull(row.ter);
  if (value === 0.19 && numberOrNull(row.navValue) === null && numberOrNull(row.aumValue) === null) return null;
  return value;
}

/**
 * Catalog row for a ticker the issuer lists but nothing was published for yet.
 * Nothing is invented: name, fees and quotes stay empty until a real source fills them.
 */
export function placeholderFund(ticker: string, fundPage: string, source: CatalogFund['source']): CatalogFund {
  return {
    ticker,
    name: '',
    category: 'ETF',
    categoryPath: 'ETF',
    inception: null,
    exchange: '',
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
    fundPage: FRANKLIN_CANONICAL_PAGES[ticker.toUpperCase()] || fundPage,
    source,
  };
}

function parsePreviousFund(ticker: string, row: JsonRecord): CatalogFund {
  return {
    ticker,
    name: cleanText(row.name || ''),
    category: cleanText(row.category || 'ETF'),
    categoryPath: cleanText(row.categoryPath || row.category || ''),
    inception: row.inceptionDate ? toIsoDate(row.inceptionDate) : null,
    exchange: cleanText(row.exchange || ''),
    cusip: cleanText(row.cusip || ''),
    isin: cleanText(row.isin || ''),
    benchmark: cleanText(row.benchmark || ''),
    ter: previousTer(row),
    grossTer: null, // the index row carries only the net ratio; meta.json keeps the published gross
    nav: typeof row.navValue === 'number' ? row.navValue : numberOrNull(row.nav),
    close: row.closePriceSource === undefined
      ? (typeof row.closePriceValue === 'number' ? row.closePriceValue : numberOrNull(row.closePrice))
      : (String(row.closePriceSource).startsWith('official') ? numberOrNull(row.closePriceValue) : null),
    premiumDiscount: plausiblePremiumDiscount(row.premiumDiscountValue),
    netAssets: typeof row.aumValue === 'number' ? row.aumValue : numberOrNull(row.aum),
    dividendYield: row.dividendYieldSource === undefined
      ? plausibleDividendYield(row.metrics?.dividendYield)
      : (row.dividendYieldSource === 'official' ? plausibleDividendYield(row.metrics?.dividendYield) : null),
    dividendYieldBasis: isDividendYieldBasis(row.metrics?.dividendYieldBasis) ? row.metrics.dividendYieldBasis : null,
    secYield: plausibleSecYield(row.metrics?.secYield),
    asOfDate: row.asOfDate || null,
    performanceAsOf: isoDateOrNull(row.metrics?.performanceAsOf),
    returns: {
      ytd: row.metrics?.ytd ?? row.returns?.monthEnd?.ytd ?? null,
      yr1: row.metrics?.tr1y ?? row.returns?.monthEnd?.yr1 ?? null,
      yr3: row.metrics?.cagr3y ?? row.returns?.monthEnd?.yr3 ?? null,
      yr5: row.metrics?.cagr5y ?? row.returns?.monthEnd?.yr5 ?? null,
      yr10: row.metrics?.cagr10y ?? row.returns?.monthEnd?.yr10 ?? null,
      sinceInception: row.metrics?.siAnn ?? row.returns?.monthEnd?.sinceInception ?? null,
    },
    fundPage: FRANKLIN_CANONICAL_PAGES[ticker.toUpperCase()] || cleanText(row.fundPage || ''),
    source: 'previous index',
  };
}

// ---------------------------------------------------------------------------
// Yahoo helpers
// ---------------------------------------------------------------------------

/** HISTORY_RANGE is `max` or `<N>y` (N >= 1). */
export function isHistoryRange(value: string): boolean {
  return value === 'max' || /^[1-9]\d{0,2}y$/.test(value);
}

export function yahooChartUrl(ticker: string, historyRange: string, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  // Explicit period1/period2: Yahoo ignores `range` when period1 is present and downgrades `range=max`.
  const years = /^(\d+)y$/.exec(historyRange);
  const period1 = years ? Math.max(0, Math.floor(nowSeconds - Number(years[1]) * 365.25 * 86_400)) : 0;
  const window = `period1=${period1}&period2=${nowSeconds}`;
  return `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?${window}&interval=1d&events=div%7Csplit&includeAdjustedClose=true`;
}

async function fetchYahooChart(ticker: string, label: string, config: UpdaterConfig): Promise<ParsedChart> {
  const url = yahooChartUrl(ticker, config.historyRange);
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

/** SEC's ticker -> registrant CIK + series id table (parseSecFundTickers), loaded once per run; a failed load is asked again up to SEC_TABLE_ATTEMPTS. */
function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, NportSeriesRef>> {
  return loadSecTable(secState.funds, async () => parseSecFundTickers(await fetchJsonWithProxyFallback(SEC_FUND_TICKERS_URL, '[ edgar    ] fund ticker table', config, secHeaders())));
}

/** SEC's company name -> ticker table (parseSecCompanyNames) for the N-PORT rows, loaded once per run. */
function loadCompanyNames(config: UpdaterConfig): Promise<Map<string, string>> {
  return loadSecTable(secState.names, async () => parseSecCompanyNames(await fetchJsonWithProxyFallback(SEC_COMPANY_TICKERS_URL, '[ edgar    ] company ticker table', config, secHeaders())));
}

/** Nasdaq Trader symbol directories for the N-PORT rows (shared nport-reader `readUsListings`), loaded once per run: a row with a
 * foreign ISIN keeps a ticker only for the company's own U.S. listing in U.S. dollars (Linde, NXP, IMAX). null when either failed. */
let usListings: Promise<Map<string, string> | null> | null = null;
function loadUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  if (!usListings) usListings = readUsListings(getText);
  return usListings;
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

export function parseConfig(env: Record<string, string | undefined>): UpdaterConfig {
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
    maxRetries: Math.max(1, parsePositiveInt(envValue(env, 'MAX_RETRIES'), 2)),
    tickers: readTickerSet(envValue(env, 'TICKERS')),
    historyRange: envValue(env, 'HISTORY_RANGE').toLowerCase() || 'max',
    edgarFallback: envValue(env, 'EDGAR_FALLBACK') ? parseBoolean(envValue(env, 'EDGAR_FALLBACK')) : true,
    skipFranklin: parseBoolean(envValue(env, 'SKIP_FRANKLIN')),
    skipYahoo: parseBoolean(envValue(env, 'SKIP_YAHOO')),
    category: envValue(env, 'CATEGORY'),
  };
}

export function usageText(): string {
  return `
Franklin Templeton ETF static feed updater (zero dependencies, run with Bun).

  bun ./scripts/update-data.ts [-h|--help]

Defaults live in scripts/update-data.config.json. Precedence: config file <
advanced JSON (workflow) < nonblank workflow inputs < environment variables.

Environment variables (all optional):

  MAX_FETCHES          0     Funds to process. 0 = full pass. A positive value
                             resumes after the committed cursor in
                             api/franklin/update-state.json.
  REQUEST_SLEEP        1.5   Minimum seconds between request starts per worker lane (r.jina.ai proxy: global, min 3.2s).
  CONCURRENCY          3     Parallel fund workers; each paces its own direct request starts.
  MAX_RETRIES          2     Retries (>= 1) for network errors and 408/425/429/5xx.
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
  HISTORY_RANGE        max   Yahoo history window: max or <N>y (explicit period1/period2).
  CATEGORY             \"\"    Keep only this provider category substring.
  STORE_RAW_DOWNLOADS  false 1|true|yes|y|on writes api/franklin/raw/**.
  SEC_UA               (set) Declared User-Agent for SEC EDGAR requests.
  EDGAR_FALLBACK       true  Use Form N-PORT-P when holdings not available elsewhere.
  SKIP_YAHOO           false Skip Yahoo Finance (distributions, derived returns).
  SKIP_FRANKLIN        false Skip franklintempleton.com entirely (keeps committed data).
  VERBOSE              false Print per-fund retry and fallback notices.
  USE_SYSTEM_CA        auto  TLS trust store: auto|true|false. auto restarts once with
                             --use-system-ca on an untrusted-certificate error.

Range syntax is strict \"min:max\" with exactly one colon; \"\" and \":\" mean no
restriction; a configured min must not exceed max.

Examples:

  TICKERS=\"FLIN FLGR FLEE\" bun ./scripts/update-data.ts
  MAX_FETCHES=10 bun ./scripts/update-data.ts
  AUM=large TER=:0.40 bun ./scripts/update-data.ts
`;
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
    if (!inRange(value, range)) return false; // a bounded range excludes funds without that figure
  }
  for (const period of Object.keys(config.totalReturn) as ReturnPeriod[]) {
    const range = config.totalReturn[period];
    const value = period === 'YTD' ? fund.returns.ytd : period === '1Y' ? fund.returns.yr1 : period === '3Y' ? fund.returns.yr3 : period === '5Y' ? fund.returns.yr5 : fund.returns.yr10;
    if (!inRange(value, range)) return false; // a bounded range excludes funds without that figure
  }
  return true;
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

// Comparing raw text would treat a run that only refreshed generatedAt (with
// every fund's actual data unchanged) as a real change and rewrite the file
// every time. Compare with both timestamps stripped instead.
function samePublishedContent(previous: string, value: unknown): boolean {
  const withoutRunTimestamp = (item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const { generatedAt, savedAt, ...content } = item as Record<string, unknown>;
    return content;
  };
  try {
    return JSON.stringify(withoutRunTimestamp(JSON.parse(previous))) === JSON.stringify(withoutRunTimestamp(value));
  } catch { return false; }
}

/** Writes through a temp file and a rename so a crash never leaves a half-written JSON file behind. */
async function writeAtomic(path: URL, text: string): Promise<void> {
  const target = outputFileURLToPath(path);
  const tmp = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, target);
}

async function writeJsonIfChanged(path: URL, data: unknown): Promise<boolean> {
  const serialized = JSON.stringify(data, null, 1) + '\n';
  let existing: string | null = null;
  try { existing = await readFile(path, 'utf8'); } catch { /* first write */ }
  if (existing !== null && (existing === serialized || samePublishedContent(existing, data))) return false;
  await writeAtomic(path, serialized);
  return true;
}

/** The published pages of a fund's sheet (holdings or history): rows and headers as written, what was readable when a page is missing. */
async function readPublishedSheet(prevMeta: JsonRecord | null, fundDir: URL, kind: 'holdings' | 'history'): Promise<{ headers: string[] | null; rows: JsonRecord[] }> {
  const rows: JsonRecord[] = [];
  let headers: string[] | null = null;
  try {
    for (const pagePath of (prevMeta?.[kind]?.pages || []) as string[]) {
      const pageData = JSON.parse(await readFile(new URL(pagePath, fundDir), 'utf8')) as JsonRecord;
      if (!headers && Array.isArray(pageData.headers)) headers = pageData.headers.map(String);
      for (const row of (pageData.rows || []) as JsonRecord[]) rows.push(row);
    }
  } catch {}
  return { headers, rows };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function ensureApiRoot(): Promise<void> {
  await mkdir(API_ROOT, { recursive: true });
}

/**
 * A product page that came back partial (see `PageSections` / `loadedFully`) says nothing about the sections it
 * lacks. Every section that was published as official before and is absent from such a page counts as a FAILED
 * read: its previous block is restored into `summary` as one unit (value with its as-of date, basis and source),
 * so the normal build republishes it unchanged instead of flipping to Yahoo-derived values or null. A page that
 * loaded fully and lacks a field is an honest null and never gets here. The returns are the exception: a fund
 * can be too young for a returns table, so a loaded page cannot vouch for them and an absent returns section is
 * always a failed read. Returns the names of the kept sections.
 */
export function retainPublishedSections(summary: ProductPageSummary, previous: JsonRecord | null): string[] {
  if (!previous) return [];
  const kept: string[] = [];
  const sections = summary.sections;
  const partial = !summary.loadedFully;
  if (partial && !sections.pricing) {
    const parts: string[] = [];
    const nav = numberOrNull(previous.nav?.value);
    if (summary.nav === null && nav !== null) {
      summary.nav = nav;
      summary.navAsOfDate = isoDateOrNull(previous.nav?.asOfDate);
      parts.push('NAV');
    }
    const price = numberOrNull(previous.marketPrice?.value);
    if (summary.marketPrice === null && price !== null && String(previous.marketPrice?.source ?? '').startsWith('official')) {
      summary.marketPrice = price;
      summary.marketPriceAsOfDate = isoDateOrNull(previous.marketPrice?.asOfDate);
      parts.push('market price');
    }
    if (parts.length) kept.push(`pricing (${parts.join(', ')})`);
  }
  if (partial && !sections.assets) {
    const aum = numberOrNull(previous.aum?.value);
    if (summary.totalNetAssets === null && aum !== null && String(previous.aum?.source ?? '').startsWith('official product page')) {
      summary.totalNetAssets = aum;
      summary.totalNetAssetsAsOfDate = isoDateOrNull(previous.aum?.asOfDate);
      kept.push('total net assets');
    }
  }
  if (partial && !sections.yields) {
    const yields = previous.yields || {};
    const sec = numberOrNull(yields.secYield);
    if (summary.secYield === null && sec !== null && String(yields.secYieldKind ?? '').startsWith('SEC Yield')) {
      summary.secYield = sec;
      summary.secYieldAsOfDate = asOfFromKind(yields.secYieldKind);
      kept.push('SEC yield');
    }
    const dividend = numberOrNull(yields.dividendYield);
    const kind = String(yields.dividendYieldKind ?? '');
    if (summary.distributionYield === null && summary.distributionRate === null && dividend !== null) {
      if (kind.startsWith('official')) {
        summary.distributionYield = dividend;
        kept.push('12-month yield');
      } else if (kind.startsWith('Distribution Rate')) {
        summary.distributionRate = dividend;
        summary.distributionRateAsOfDate = asOfFromKind(kind);
        summary.distributionRateBasis = /\bat (NAV|market price)\b/.exec(kind)?.[1] ?? null;
        kept.push('Distribution Rate');
      }
    }
  }
  const monthEnd = previous.returns?.monthEnd || {};
  const periods = ['yr1', 'yr3', 'yr5', 'yr10', 'sinceInception'] as const;
  if (!sections.returns && isoDateOrNull(previous.returns?.performanceAsOf) && periods.some((key) => numberOrNull(monthEnd[key]) !== null)) {
    for (const key of periods) summary.returns[key] = numberOrNull(monthEnd[key]);
    summary.returns.ytd ??= numberOrNull(monthEnd.ytd);
    summary.performanceAsOf = isoDateOrNull(previous.returns.performanceAsOf);
    kept.push('returns');
  }
  return kept;
}

async function runUpdater(config: UpdaterConfig): Promise<void> {
  const startedAt = Date.now();
  configurePacing(config.concurrency, config.requestSleep);
  resetSecState();

  outputPrintConfig('Franklin', config);

  await ensureApiRoot();

  // Load previous index for fallback
  let previousFunds = new Map<string, JsonRecord>();
  try {
    const prev = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as JsonRecord;
    for (const f of (prev.funds || []) as JsonRecord[]) {
      if (f && f.ticker) previousFunds.set(String(f.ticker).toUpperCase(), f);
    }
  } catch {}

  // Load state for bounded runs
  let state: JsonRecord = {};
  try {
    state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as JsonRecord;
  } catch {}

  let catalog = new Map<string, CatalogFund>();
  let catalogSource = 'franklintempleton.com';

  // Query live product sitemap on Franklin Templeton to discover any new funds added
  let sitemapRead = false;
  const sitemapFunds = new Map<string, string>();
  if (!config.skipFranklin) {
    try {
      const sitemapRaw = await fetchText('https://www.franklintempleton.com/binaries/content/assets/global/sitemaps/google/en-us_product.xml', 'sitemap', { ...config, maxRetries: 0 });
      const re = /<loc>(https:\/\/www\.franklintempleton\.com\/investments\/options\/exchange-traded-funds\/products\/[^\/]+\/SINGLCLASS\/[^\/]+\/([A-Z0-9]+))<\/loc>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sitemapRaw)) !== null) {
        const t = m[2].toUpperCase();
        if (!sitemapFunds.has(t)) sitemapFunds.set(t, m[1]);
      }
      sitemapRead = true;
    } catch (e) {
      console.warn(`[ catalog  ] product sitemap unavailable (${e instanceof Error ? e.message : String(e)}); new funds are not discovered this run`);
    }
  }

  // The live catalog: the sitemap plus the definitive seed list when the sitemap was read, the seed alone on a first run
  // without a published feed, null when only the published feed is known (then no published row counts as stale)
  const previousRows = Array.from(previousFunds.values());
  const live: string[] | null = sitemapRead ? Array.from(new Set(Array.from(sitemapFunds.keys()).concat(SEED_81))) : (previousFunds.size ? null : SEED_81.slice());

  // Seed catalog from the previous index: a catalog-only row the live catalog no longer lists (an old mistyped TICKERS entry) is dropped
  for (const row of withoutStalePlaceholders(previousRows, live)) {
    const ticker = String(row.ticker).toUpperCase();
    catalog.set(ticker, parsePreviousFund(ticker, row));
  }
  sitemapFunds.forEach((pageUrl, t) => { if (!catalog.has(t)) catalog.set(t, placeholderFund(t, pageUrl, 'official sitemap')); });

  if (!catalog.size) {
    // Seed definitive 81 fixture for offline development and when issuer blocks catalog fetch
    for (const t of SEED_81) {
      catalog.set(t, placeholderFund(t, `${FRANKLIN_SITE}/investments/options/exchange-traded-funds/products/${t.toLowerCase()}/SINGLCLASS/${t.toLowerCase()}-etf/${t}`, 'seed'));
    }
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
          catalog.set(t, placeholderFund(t, `${FRANKLIN_SITE}/investments/options/exchange-traded-funds/products/${t.toLowerCase()}/SINGLCLASS/${t.toLowerCase()}-etf/${t}`, 'seed'));
        }
        added++;
      }
    }
    if (added) console.warn(`[ catalog  ] augmented with ${added} seed funds to reach ${catalog.size} (expected 81)`);
  }

  console.log(`[ catalog  ] ${catalog.size} Franklin ETFs (${catalogSource === 'seed' ? 'definitive 81 seed fixture' : `published index${sitemapRead ? ' + official product sitemap' : ''}`})`);

  // Q27: a TICKERS entry outside the live catalog and the published funds stops the run before any fund request
  assertKnownTickers(config.tickers ? Array.from(config.tickers) : null, knownTickers(live, previousRows), 'the Franklin catalog or published feed');

  // Apply filters BEFORE batching (as per contract)
  let filtered = [...catalog.values()].filter((f) => passesFilters(f, config));
  console.log(`[ filter   ] ${filtered.length} of ${catalog.size} funds pass filters`);
  // Closed funds leave the run here, before any request and before the MAX_FETCHES budget: never fetched, guarded or reported.
  const open = withoutClosedFunds(filtered, (fund) => fund.ticker, CLOSED_FUNDS);

  // Bounded runs resume after the cursor inside the filtered list and wrap around.
  // A TICKERS run never reads or writes the cursor, so it cannot disturb a batch rotation.
  const useCursor = !config.tickers;
  let toProcess = open;
  if (config.maxFetches > 0) {
    const idx = useCursor && state.cursor ? open.findIndex((f) => f.ticker === state.cursor) : -1;
    const ordered = idx >= 0 ? open.slice(idx + 1).concat(open.slice(0, idx + 1)) : open;
    toProcess = ordered.slice(0, config.maxFetches);
    console.log(`[ cursor   ] bounded run: max=${config.maxFetches} processing=${toProcess.length} cursor=${useCursor ? state.cursor || 'none' : 'untouched (TICKERS run)'}`);
  }
  // An unbounded run goes stalest first, so a run cut short by the soft deadline rotates instead of starving the tail.
  const publishedAsOfByTicker = await readPublishedAsOf(open.map((fund) => fund.ticker));
  if (config.maxFetches === 0) toProcess = stalestFirst(open, publishedAsOfByTicker);

  // Preload ticker maps for SEC
  if (config.edgarFallback) {
    try {
      await loadFundTickerTable(config);
      await loadCompanyNames(config);
    } catch (e) {
      outputNote(`[ ${'edgar'.padEnd(8)} ] ticker tables unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let failed = 0;

  let fundCompletedCount = 0;
  const totalToProcess = toProcess.length;

  // Process funds with concurrency
  const queue = [...toProcess];
  const runStartedAt = Date.now();
  let dispatched = 0;
  let deadlineHit = false;
  const workers: Promise<void>[] = [];

  const output = outputCreateReporter(API_ROOT, totalToProcess);
  async function processFund(catalogFund: CatalogFund): Promise<void> {
    // The fund is computed completely on a copy and only then written: a fund is
    // either fully updated or fully kept from before, never half and half.
    const fund: CatalogFund = { ...catalogFund, returns: { ...catalogFund.returns } };
    const ticker = fund.ticker.toUpperCase();
    const fundDir = new URL(`funds/${ticker}/`, API_ROOT);
    const problems: string[] = [];

    // The published meta.json: the fallback of every source that fails and the source of the sections a partial page lacks.
    let prevMeta: JsonRecord | null = null;
    try {
      prevMeta = JSON.parse(await readFile(new URL('meta.json', fundDir), 'utf8')) as JsonRecord;
    } catch {}
    const keptSections: string[] = [];
    let officialYield: ReturnType<typeof officialDividendYield> = null;

    let summary: ProductPageSummary | null = null;
    let holdingsRows: JsonRecord[] = [];
    let holdingsHeaders = HOLDINGS_HEADERS;
    let holdingsAsOf: string | null = null;
    let holdingsSource = 'not available';
    let chart: ParsedChart | null = null;
    let nport: NportFiling | null = null;
    // Official daily holdings table from the product page Portfolio tab. Kept in
    // the processFund scope (not inside the product-page try block) because the
    // SEC fallback below re-uses it.
    let officialDailyHoldings: JsonRecord[] = [];
    let officialDailyAsOf: string | null = null;
    let officialDailySource = '';

    // 1) Product page – official daily holdings + summary (primary source)
    let franklinPageText: string | null = null;
    if (!config.skipFranklin) {
      try {
        const page = await fetchIssuerText(fund.fundPage, `[ product  ] ${ticker}`, config, (text) => {
          const lower = text.toLowerCase();
          return lower.includes(ticker.toLowerCase()) && (lower.includes('cusip') || lower.includes('nav') || lower.includes('expense'));
        }, 'text/html,application/xhtml+xml,text/csv,text/plain;q=0.9,*/*;q=0.8', { maxProxies: PRODUCT_PROXY_COUNT, cache: false, renderTimeoutSeconds: PRODUCT_RENDER_TIMEOUT_SECONDS, skipPlainHttpProxy: true, retryFailedContent: true, prefer: (text) => parseFranklinProductPage(text, ticker).loadedFully });
        franklinPageText = page.text;
        summary = parseFranklinProductPage(page.text, ticker);
        if (summary.loadedFully) {
          // A fully loaded page is authoritative for pricing and yields: what it lacks is an honest null, never the previous run's value.
          fund.nav = null; fund.close = null; fund.premiumDiscount = null; fund.secYield = null; fund.dividendYield = null; fund.dividendYieldBasis = null;
          if (summary.sections.returns) {
            for (const key of ['yr1', 'yr3', 'yr5', 'yr10', 'sinceInception'] as const) fund.returns[key] = null;
            fund.performanceAsOf = summary.performanceAsOf;
          }
        }
        keptSections.push(...retainPublishedSections(summary, prevMeta));
        // Merge into catalog fund – only valid names/categories, never URL paths or JS bundles.
        // The catalog name (finder table) stays authoritative; the product page
        // only fills a name the catalog could not provide.
        const pageName = resolveFundName(summary.name, fund.fundPage, ticker);
        if (!isValidFundName(fund.name) && pageName) fund.name = pageName;
        if (summary.cusip) fund.cusip = summary.cusip;
        if (summary.isin) fund.isin = summary.isin;
        if (summary.exchange) fund.exchange = summary.exchange;
        if (summary.benchmark) fund.benchmark = summary.benchmark;
        const pageCategory = resolveCategory(summary.morningstarCategory, summary.assetClass);
        if (pageCategory !== 'ETF') { fund.category = pageCategory; fund.categoryPath = pageCategory; }
        if (summary.totalExpenseRatio !== null) { fund.ter = summary.totalExpenseRatio; fund.grossTer = summary.grossExpenseRatio ?? summary.totalExpenseRatio; }
        if (summary.totalNetAssets !== null) fund.netAssets = summary.totalNetAssets;
        if (summary.nav !== null) fund.nav = summary.nav;
        if (summary.marketPrice !== null) fund.close = summary.marketPrice;
        if (summary.premiumDiscount !== null) fund.premiumDiscount = summary.premiumDiscount;
        officialYield = officialDividendYield(summary);
        if (officialYield) { fund.dividendYield = officialYield.value; fund.dividendYieldBasis = dividendYieldBasisFromKind(officialYield.kind, true); }
        if (summary.secYield !== null) fund.secYield = summary.secYield;
        if (summary.inception) fund.inception = summary.inception;
        // Merge returns from product page (primary, more recent than catalog)
        if (summary.returns) {
          for (const k of ['ytd', 'yr1', 'yr3', 'yr5', 'yr10', 'sinceInception'] as (keyof CatalogReturns)[]) {
            const v = (summary.returns as any)[k];
            if (v !== null && v !== undefined) {
              (fund.returns as any)[k] = v;
            }
          }
          if (summary.performanceAsOf && hasAnyReturn(summary.returns)) fund.performanceAsOf = summary.performanceAsOf;
        }

        // Try official holdings from product page Portfolio tab (daily, more recent than SEC quarterly)
        // The page via r.jina.ai contains markdown table: | Security Name | Weight (%) | Market Value | Quantity |
        try {
          const franklinHoldings = parseFranklinHoldings(page.text);
          if (franklinHoldings.length) {
            officialDailyHoldings = officialHoldingsRows(franklinHoldings);
            // The date printed under the Holdings heading. Any other "As of <Month D, YYYY>" on the page is
            // disclaimer text (it dated EZPZ's current table 2025-12-01).
            const asOfMatch = /Holdings\s+As of\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(page.text);
            officialDailyAsOf = summary.holdingsAsOfDate || (asOfMatch ? toIsoDate(asOfMatch[1]) : (summary.totalHoldingsAsOfDate || null));
            officialDailySource = `Franklin Templeton official product page Portfolio holdings (daily${officialDailyAsOf ? `, ${officialDailyAsOf}` : ''})`;
            // If full portfolio (>25 items) is present, use it directly
            if (officialDailyHoldings.length > 25) {
              holdingsRows = officialDailyHoldings;
              holdingsAsOf = officialDailyAsOf;
              holdingsSource = officialDailySource;
            }
          }
        } catch (e) {
          outputNote(`[ ${'franklin'.padEnd(8)} ] ${ticker} holdings parse failed: ${e instanceof Error ? e.message : String(e)}`);
        }

        if (config.storeRawDownloads) {
          await mkdir(new URL('raw/', API_ROOT), { recursive: true });
          await writeFile(new URL(`raw/${ticker}-product.html`, API_ROOT), page.text, 'utf8');
        }
      } catch (e) {
        problems.push(`product page: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // A partial page has no Holdings table: what was published from the official table stays unless a newer N-PORT filing exists.
    const previousHoldingsAsOf = toIsoDate(prevMeta?.holdings?.asOfDate);
    const keepOfficialHoldings = Boolean(summary && !summary.loadedFully && !summary.sections.holdings && previousHoldingsAsOf
      && Number(prevMeta?.holdings?.totalRows ?? 0) > 0 && String(prevMeta?.holdings?.source ?? '').startsWith('Franklin Templeton official product page'));

    // 2) Holdings via SEC N-PORT-P (shared nport-reader block): the fund's own newest filing, found by its series id
    // (FRANKLIN_SERIES_MAP, else the SEC fund ticker table), read from primary_doc.xml in the registrant's folder and used
    // only when its report period is strictly newer than the published holdings
    let nportNotNewer = false;
    if (!holdingsRows.length && config.edgarFallback) {
      try {
        const ref = await fundSeriesRef(ticker, config);
        const publishedAsOf = calendarIso(prevMeta?.holdings?.asOfDate) ?? calendarIso(prevMeta?.holdings?.asOf);
        const read: NportRead = ref
          ? await readNportHoldings({ ticker, cik: ref.cik, seriesId: ref.seriesId }, { asOf: publishedAsOf, rows: Number(prevMeta?.holdings?.totalRows ?? 0) }, (url, label) => fetchTextWithProxyFallback(url, `[ edgar    ] ${label}`, config, secHeaders()), { cache: secState.reader })
          : { problem: `${ticker}: not in FRANKLIN_SERIES_MAP or the SEC fund ticker table` };
        if ('problem' in read) {
          // the fund's own filing is not newer: its published holdings stay (the short official table below never replaces them)
          nportNotNewer = /is not newer than the published holdings/.test(read.problem);
          outputNote(`[ ${'nport'.padEnd(8)} ] ${read.problem}`);
        } else {
          holdingsRows = nportHoldingsSheet(read.filing, nportTickers(read.filing.positions, await loadCompanyNames(config).catch(() => null), await loadUsListings((url, label) => fetchText(url, `[ edgar    ] ${label}`, config, secHeaders()))));
          holdingsAsOf = read.filing.repPdDate || null;
          nport = read.filing;
          holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${read.candidate.accession}, report period ${read.filing.repPdDate || 'n/a'})`;
        }
      } catch (e) {
        outputNote(`[ ${'nport'.padEnd(8)} ] ${ticker}: ${e instanceof Error ? e.message : String(e)} — holdings fall back to the previous run`);
      }
    }

    // Fallback to official daily holdings table if SEC returned nothing. Holdings published from a filing that is as new
    // as the one SEC returns now stay: the short official table (25 rows or fewer) never replaces that full portfolio.
    const publishedOfficial = String(prevMeta?.holdings?.source ?? '').startsWith('Franklin Templeton official product page');
    if (!holdingsRows.length && officialDailyHoldings.length && !(nportNotNewer && !publishedOfficial)) {
      holdingsRows = officialDailyHoldings;
      holdingsAsOf = officialDailyAsOf;
      holdingsSource = officialDailySource;
    }

    // Up to here holdingsRows holds only freshly fetched holdings (the previous run's sheet is re-read further below).
    // Fresh holdings that look broken (no weight column, non-numeric weights, a bad weight sum, half the rows gone)
    // never replace the published ones: the fund is kept as published and reported failed. Whatever is relaxed, a sheet
    // without a numeric weight never replaces a published sheet that had numeric weights.
    if (holdingsRows.length) {
      const published = prevMeta ? await readPublishedSheet(prevMeta, fundDir, 'holdings') : null;
      const publishedWeights = published ? holdingsWeightCount(published.headers || HOLDINGS_HEADERS, published.rows) : null;
      const holdingsProblem = holdingsGuard(holdingsHeaders, holdingsRows, numberOrNull(prevMeta?.holdings?.totalRows), HOLDINGS_GUARD_RELAX[ticker] ?? HOLDINGS_GUARD_RELAX['*'] ?? [], publishedWeights);
      if (holdingsProblem) throw new Error(`holdings guard: ${holdingsProblem}; ${prevMeta ? 'kept the previously published fund' : 'no data published for this fund yet'}`);
    }

    // Published history and distributions: the fallback when Yahoo fails, and the older part of a HISTORY_RANGE window
    const previousHistoryRows = (await readPublishedSheet(prevMeta, fundDir, 'history')).rows;
    const previousDistributionRows: JsonRecord[] = Array.isArray(prevMeta?.distributions?.rows) ? prevMeta.distributions.rows : [];
    let windowJoined = false;

    // 3) History via Yahoo – no per-stage log
    if (!config.skipYahoo) {
      try {
        const fetched = await fetchYahooChart(ticker, `[ yahoo    ] ${ticker} chart`, config);
        // A HISTORY_RANGE window never shrinks the published history: the older published days (and distributions) stay,
        // and a window that does not join them keeps the fund as published (shared windowed-chart block)
        if (/^\d+y$/.test(config.historyRange)) {
          const merged = mergeWindowedChart(fetched, previousHistoryRows, previousDistributionRows.map((row) => [row['Ex-Date'], row.Dividend]));
          if (!merged) throw new Error(`chart window does not join the published history (${config.historyRange})`);
          windowJoined = merged.days.length > fetched.days.length;
          chart = merged;
        } else {
          chart = fetched;
        }
      } catch (e) {
        problems.push(`yahoo chart: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // A source that worked for this fund before and failed now keeps the fund as it
    // was published: new returns never sit next to stale prices or holdings.
    const hadPageData = Boolean(prevMeta?.returns?.performanceAsOf) || String(prevMeta?.aum?.source ?? '').startsWith('official');
    const hadHistory = Number(prevMeta?.history?.totalRows ?? 0) > 0;
    const blocking = problems.filter((problem) => (problem.startsWith('product page') ? hadPageData : hadHistory));
    // A new fund that no asked source answered (the product page and Yahoo failed or were skipped, N-PORT gave nothing)
    // is failed and keeps its catalog-only row: an empty meta.json reported updated would claim data that was never read.
    const askedAnySource = !config.skipFranklin || !config.skipYahoo || config.edgarFallback;
    if (!prevMeta && askedAnySource && !summary && !chart && !holdingsRows.length) throw new Error(`no source returned data (${problems.concat(config.edgarFallback ? ['N-PORT: no usable filing'] : []).join('; ')})`);
    if (prevMeta && blocking.length) throw new Error(`kept the previously published fund (${blocking.join('; ')})`);
    for (const problem of problems) if (!blocking.includes(problem)) outputNote(`[ ${'source'.padEnd(8)} ] ${ticker}: ${problem} (no earlier data from this source)`);

    // Determine distribution frequency. Only the canonical word is published:
    // the pages ship page furniture around it ("Monthly This fund is an
    // ex-Dividend fund", ", if any Semiannually"). The previous meta is the last
    // resort so a run without page access never downgrades the feed.
    const frequencyCandidates = [
      summary?.distributionFrequency,
      summary?.dividendFrequencyRaw,
      chart?.dividends?.length ? inferDistributionFrequency(chart.dividends) : null,
      prevMeta?.distributions?.frequency,
    ];
    let distributionFrequency = '—';
    for (const candidate of frequencyCandidates) {
      const normalized = normalizeDistributionFrequency(candidate);
      if (normalized !== '—') { distributionFrequency = normalized; break; }
    }

    const frequencyCode = frequencyCodeLabel(distributionFrequency);
    const paymentsPerYear = paymentsPerYearFor(distributionFrequency);

    // Build history rows
    const historyRows: JsonRecord[] = [];
    if (chart?.days?.length) {
      // History is rebuilt from the chart on every run: the published cents decide float noise.
      const publishedByDate = new Map(previousHistoryRows.map((row) => [String(row.Date), row]));
      // the published days a HISTORY_RANGE window kept (mergeWindowedChart marks them with adjCloseRaw) keep their search text
      const windowStart = windowJoined ? chart.days.findIndex((day) => (day as WindowedChartDay).adjCloseRaw === undefined) : 0;
      for (let i = 0; i < chart.days.length; i++) {
        const day = chart.days[i];
        const date = formatDate(day.date);
        const published = publishedByDate.get(date);
        historyRows.push({
          Date: date,
          Close: day.close.toFixed(2),
          'Adj Close': keptAdjClose(day.adjClose, published?.['Adj Close']),
          Volume: String(day.volume),
          searchIndex: i < windowStart && published?.searchIndex ? String(published.searchIndex) : `${day.date} ${day.close}`.toLowerCase(),
        });
      }
    } else {
      // Keep previous history if Yahoo failed
      historyRows.push(...previousHistoryRows);
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

    if (keepOfficialHoldings && holdingsSource === prevMeta?.holdings?.source) keptSections.push('holdings');

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
    } else if (Array.isArray(prevMeta?.distributions?.rows)) {
      // Keep the committed distribution history when Yahoo is skipped/unreachable.
      for (const row of prevMeta.distributions.rows as JsonRecord[]) distributionRows.push(row);
    }

    const latestDividend = distributionRows.length ? numberOrNull(distributionRows[0].Dividend) : null;
    const exDate = distributionRows.length ? (distributionRows[0]['Ex-Date'] as string) : '—';

    // Close price: the official Market Price when the product page published
    // one, otherwise the last close of the price history (Yahoo Finance).
    const lastHistoryClose = historyRows.length ? numberOrNull(historyRows[historyRows.length - 1].Close) : null;
    const historyCloseDate = historyRows.length ? toIsoDate(historyRows[historyRows.length - 1].Date) : '';
    const historyAge = Date.now() - Date.parse(`${historyCloseDate}T00:00:00Z`);
    const recentHistoryClose = Number.isFinite(historyAge) && historyAge >= -86400000 && historyAge <= 7 * 86400000 ? lastHistoryClose : null;
    const closePrice = fund.close ?? lastHistoryClose;
    const closePriceKind = fund.close !== null
      ? 'official product page Market Price'
      : (lastHistoryClose !== null ? 'last close from the Yahoo Finance price history' : null);
    const pageNav = fund.nav;
    fund.nav = plausibleNav(fund.nav, fund.close ?? recentHistoryClose);
    // A read that fails the plausibility check is a failed read, not an honest absence: the published NAV stays.
    const publishedNav = numberOrNull(prevMeta?.nav?.value);
    if (pageNav !== null && fund.nav === null && publishedNav !== null && plausibleNav(publishedNav, fund.close ?? recentHistoryClose) !== null) {
      fund.nav = publishedNav;
      keptSections.push('NAV (the page value failed the plausibility check)');
    }

    // Dividend yield: the official 12-month yield when the product page
    // publishes one, otherwise the indicated yield documented in the README and
    // the column tooltip (latest distribution x payments per year / price).
    const yieldPrice = fund.close ?? fund.nav ?? closePrice ?? numberOrNull(prevMeta?.marketPrice?.value) ?? numberOrNull(prevMeta?.nav?.value) ?? null;
    const yieldPriceLabel = fund.close !== null ? 'market price' : fund.nav !== null ? 'NAV' : closePrice !== null ? 'last close' : 'price from the previous run';
    let dividendYield = plausibleDividendYield(fund.dividendYield);
    let dividendYieldKind = 'not published by franklintempleton.com for this fund';
    let dividendYieldAsOfDate: string | null = null;
    if (dividendYield !== null) {
      // Carried-over official yield (page not read this run) keeps the label it was published with.
      const carriedKind = String(prevMeta?.yields?.dividendYieldKind ?? '');
      const carried = !officialYield && /^(official|Distribution Rate)/.test(carriedKind);
      dividendYieldKind = officialYield?.kind ?? (carried ? carriedKind : OFFICIAL_12M_YIELD_KIND);
      dividendYieldAsOfDate = officialYield ? officialYield.asOfDate : (carried ? isoDateOrNull(prevMeta?.yields?.dividendYieldAsOfDate) : null);
    } else if (latestDividend !== null && paymentsPerYear && yieldPrice) {
      const indicated = round((latestDividend * paymentsPerYear / yieldPrice) * 100, 2);
      if (indicated > 0 && indicated <= MAX_PUBLISHED_DIVIDEND_YIELD) {
        dividendYield = indicated;
        dividendYieldKind = `indicated: latest distribution ${latestDividend.toFixed(4)} x ${paymentsPerYear}/year / ${yieldPriceLabel} ${yieldPrice.toFixed(2)}`;
      }
    }
    if (dividendYield === null && !distributionRows.length) dividendYieldKind = 'this fund has no distribution history';
    else if (dividendYield === null && !paymentsPerYear) dividendYieldKind = 'not computable: irregular or unknown distribution frequency';
    else if (dividendYield === null) dividendYieldKind = 'not computable: no distribution price (NAV/market price) in the feed';

    // The shared age rule: no 1-year or since-inception return before the first anniversary, no 3, 5 or 10-year one before those
    fund.returns = withoutYoungReturns(fund.returns, fund.inception, fund.performanceAsOf ?? isoDateOrNull(prevMeta?.returns?.performanceAsOf), RETURN_HORIZONS);
    // Returns: use catalog returns + derived from Yahoo if needed
    const ytd = fund.returns.ytd;
    const yr1 = fund.returns.yr1;
    const yr3 = fund.returns.yr3;
    const yr5 = fund.returns.yr5;
    // The pages print the since-inception value in the 10-year slot of young
    // funds; a fund younger than ten years cannot have a 10-year return.
    const yr10 = tenYearEligible(fund.inception) ? fund.returns.yr10 : null;
    const si = fund.returns.sinceInception;
    const performanceAsOf = resolvePerformanceAsOf(fund.performanceAsOf ?? isoDateOrNull(prevMeta?.returns?.performanceAsOf), { ytd, yr1, yr3, yr5, yr10, sinceInception: si });
    const secYield = plausibleSecYield(fund.secYield);
    // the date of the SEC yield: the page's, or, when the page was not read (SKIP_FRANKLIN, a failed request) and the yield
    // is the published one, the date of the published label, so a retained yield keeps its date (zero diff)
    const secYieldAsOfDate = summary ? summary.secYieldAsOfDate
      : (secYield !== null && numberOrNull(prevMeta?.yields?.secYield) === secYield ? asOfFromKind(prevMeta?.yields?.secYieldKind) : null);
    // Premium/discount: an official value when the page prints one, otherwise computed from the official NAV and a
    // price of the SAME trading date (the page's closing Market Price, else the Yahoo close of the NAV date).
    // Different or unknown dates give null; the previous value is kept only when the page could not be read.
    const navDate = summary?.nav !== null && summary?.nav !== undefined ? summary.navAsOfDate : isoDateOrNull(prevMeta?.nav?.asOfDate);
    const pagePriceDate = summary?.marketPrice !== null && summary?.marketPrice !== undefined ? summary.marketPriceAsOfDate : isoDateOrNull(prevMeta?.marketPrice?.asOfDate);
    const yahooRow = navDate ? historyRows.find((row) => toIsoDate(row.Date) === navDate) : undefined;
    let premiumDiscount = plausiblePremiumDiscount(summary?.premiumDiscount ?? null);
    let premiumAsOfDate: string | null = premiumDiscount !== null ? (summary?.premiumDiscountAsOfDate ?? navDate) : null;
    let premiumSource: string | null = premiumDiscount !== null ? 'official product page Premium / Discount' : null;
    let premiumPriceSource: string | null = null;
    if (premiumDiscount === null) {
      premiumDiscount = computePremiumDiscount(fund.nav, navDate, fund.close, pagePriceDate);
      if (premiumDiscount !== null) premiumPriceSource = 'official product page closing Market Price';
      else {
        premiumDiscount = computePremiumDiscount(fund.nav, navDate, numberOrNull(yahooRow?.Close), navDate);
        if (premiumDiscount !== null) premiumPriceSource = 'Yahoo Finance regular-session close of the NAV date';
      }
      if (premiumDiscount !== null) { premiumAsOfDate = navDate; premiumSource = PREMIUM_COMPUTED_SOURCE; }
    }
    const previousPremium = plausiblePremiumDiscount(numberOrNull(prevMeta?.premiumDiscount?.value));
    if (premiumDiscount === null && previousPremium !== null && (!summary || !summary.sections.pricing)) {
      premiumDiscount = previousPremium;
      premiumAsOfDate = isoDateOrNull(prevMeta?.premiumDiscount?.asOfDate);
      premiumSource = cleanText(prevMeta?.premiumDiscount?.source) || PREMIUM_COMPUTED_SOURCE;
      premiumPriceSource = cleanText(prevMeta?.premiumDiscount?.priceSource) || null;
      if (summary && !summary.loadedFully) keptSections.push('premium/discount');
    }
    fund.premiumDiscount = premiumDiscount;

    // Published identifiers: scraped name/category first, then the product URL
    // slug / neutral fallback so no page furniture reaches the catalog.
    const fundName = fund.name ? resolveFundName(fund.name, fund.fundPage, ticker) : null;
    const fundCategory = resolveCategory(fund.category, fund.categoryPath, summary?.morningstarCategory, summary?.assetClass);
    fund.name = fundName ?? '';
    fund.category = fundCategory;
    fund.categoryPath = fundCategory;

    // One notice per fund naming what a partial page could not give.
    if (keptSections.length) console.log(`[ ${'kept'.padEnd(8)} ] ${ticker}: product page came back partial, kept the published ${keptSections.join(', ')}`);

    // Build meta.json
    const meta = {
      ticker,
      name: fundName,
      category: fundCategory,
      categoryPath: fundCategory,
      fundPage: fund.fundPage,
      factSheet: summary?.factSheet || (summary?.loadedFully ? null : cleanText(prevMeta?.factSheet) || null),
      source: {
        provider: 'Franklin Templeton',
        market: 'us',
        site: FRANKLIN_SITE,
        catalog: FRANKLIN_CATALOG_URL,
        fundPage: fund.fundPage,
        holdingsSource,
        historySource: chart ? 'Yahoo Finance public chart API' : (prevMeta?.source?.historySource || 'previous run'),
        // a window joined to the published history keeps the request the older days came from
        yahooChart: (windowJoined && cleanText(prevMeta?.source?.yahooChart)) || yahooChartUrl(ticker, config.historyRange).replace(/period2=\d+/, 'period2=..'),
        nportDoc: nport ? `SEC EDGAR N-PORT-P ${nport.repPdDate}` : (cleanText(prevMeta?.source?.nportDoc) || null),
      },
      identifiers: {
        cusip: fund.cusip || summary?.cusip || null,
        isin: fund.isin || summary?.isin || null,
        benchmark: plausibleBenchmark(fund.benchmark) || plausibleBenchmark(summary?.benchmark) || plausibleBenchmark(prevMeta?.identifiers?.benchmark) || null,
      },
      expenseRatio: {
        display: fund.ter !== null ? `${fund.ter.toFixed(2)}%` : '—',
        value: fund.ter,
        gross: fund.grossTer ?? (fund.ter !== null ? numberOrNull(prevMeta?.expenseRatio?.gross) : null),
        net: fund.ter,
      },
      nav: {
        display: fund.nav !== null ? `$${fund.nav.toFixed(2)}` : '—',
        value: fund.nav,
        asOfDate: summary?.navAsOfDate || cleanText(prevMeta?.nav?.asOfDate) || null,
      },
      marketPrice: {
        display: closePrice !== null ? `$${closePrice.toFixed(2)}` : '—',
        value: closePrice,
        asOfDate: closePriceKind && !closePriceKind.startsWith('official')
          ? (historyRows.length ? toIsoDate(historyRows[historyRows.length - 1].Date) : null)
          : (summary?.marketPriceAsOfDate || cleanText(prevMeta?.marketPrice?.asOfDate) || null),
        source: closePriceKind,
      },
      premiumDiscount: {
        display: fund.premiumDiscount !== null ? `${fund.premiumDiscount.toFixed(2)}%` : '—',
        value: fund.premiumDiscount,
        asOfDate: fund.premiumDiscount !== null ? premiumAsOfDate : null,
        source: fund.premiumDiscount !== null ? premiumSource : 'not computable: NAV and market price do not share a trading date',
        priceSource: fund.premiumDiscount !== null ? premiumPriceSource : null,
      },
      aum: {
        display: formatAumDisplay(fund.netAssets),
        value: fund.netAssets,
        asOfDate: stableAumAsOf(fund.netAssets, summary?.totalNetAssetsAsOfDate ?? null, prevMeta?.aum) || cleanText(prevMeta?.aum?.asOfDate) || holdingsAsOf || null,
        source: summary?.totalNetAssets !== null && summary?.totalNetAssets !== undefined
          ? 'official product page Total Net Assets'
          : cleanText(prevMeta?.aum?.source) || holdingsSource,
      },
      yields: {
        dividendYield,
        dividendYieldText: dividendYield !== null ? `${dividendYield.toFixed(2)}%` : '—',
        dividendYieldKind,
        dividendYieldAsOfDate,
        secYield,
        secYieldText: secYield !== null ? `${secYield.toFixed(2)}%` : '—',
        secYieldKind: secYield !== null ? `SEC Yield (30 Day) published on the official product page${secYieldAsOfDate ? ` as of ${formatDate(secYieldAsOfDate)}` : ''}` : 'not published by franklintempleton.com for this fund',
      },
      returns: {
        derivedFrom: RETURNS_BASIS,
        performanceAsOf,
        monthEnd: {
          asOfDate: performanceAsOf ? formatDate(performanceAsOf) : '',
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
          sinceInception: null,
          sinceInceptionText: '—',
        },
      },
      distributions: {
        frequency: distributionFrequency,
        frequencyCode,
        paymentsPerYear,
        headers: ['Ex-Date', 'Dividend'],
        rows: distributionRows,
        latestDividend: latestDividend !== null ? `${latestDividend}` : '—',
        exDate,
      },
      holdings: holdingsManifest,
      history: historyManifest,
    };

    // Write order: page files first, then meta.json (the pointer to them), and only
    // then the stale pages of a shrunken series are removed.
    await mkdir(new URL('holdings/', fundDir), { recursive: true });
    await mkdir(new URL('history/', fundDir), { recursive: true });
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
    await writeJsonIfChanged(new URL('meta.json', fundDir), meta);
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

    try {
      const existing = await readdir(new URL('history/', fundDir));
      for (const file of existing) {
        const num = Number(file.replace('.json', ''));
        if (Number.isInteger(num) && num > historyPages.length) {
          await rm(new URL(`history/${file}`, fundDir));
        }
      }
    } catch {}

    Object.assign(catalogFund, fund, { returns: fund.returns });
    fundCompletedCount++;

  }

  // Worker pool
  for (let w = 0; w < config.concurrency; w++) {
    workers.push(
      (async () => {
        while (queue.length) {
          // Every run makes progress: the first fund is always taken, whatever the deadline says.
          if (dispatched > 0 && Date.now() - runStartedAt > softDeadlineMs) { deadlineHit = true; break; }
          const fund = queue.shift();
          if (!fund) break;
          dispatched += 1;
          const before = await output.before(fund.ticker);
          try {
            await processFund(fund);
            await output.result(fund.ticker, before);
          } catch (e) {
            await output.result(fund.ticker, before, 'failed', String(e));
            failed++;
          }
        }
      })()
    );
  }

  await Promise.all(workers);
  if (deadlineHit) {
    const line = `soft deadline reached: ${deadlineSummary(dispatched, totalToProcess, queue, publishedAsOfByTicker)}; the next run starts with them`;
    console.warn(`[ deadline ] ${line}`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Soft deadline\n\n${line}\n`, 'utf8');
  }

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

    const ter = fund.ter;
    const nav = fund.nav ?? meta?.nav?.value ?? null;
    const aum = fund.netAssets ?? meta?.aum?.value ?? null;
    const secYield = plausibleSecYield(fund.secYield ?? meta?.yields?.secYield);
    const fundYield = plausibleDividendYield(fund.dividendYield);
    const divYield = plausibleDividendYield(fund.dividendYield ?? meta?.yields?.dividendYield);
    // The code is taken from the same place as the yield: the fund's own figure with its code, else meta.json
    // (value and kind written together); a yield that has neither is an older official figure.
    const metaYieldMatches = divYield !== null && numberOrNull(meta?.yields?.dividendYield) === divYield;
    const divYieldBasis: DividendYieldBasis | null = divYield === null ? null
      : (fundYield !== null && isDividendYieldBasis(fund.dividendYieldBasis) ? fund.dividendYieldBasis
        : (metaYieldMatches ? dividendYieldBasisFromKind(meta?.yields?.dividendYieldKind, true) : 'official-other'));

    // Only publish values that pass the plausibility checks, whatever the meta
    // or the previous index carried.
    const fundName = fund.name ? resolveFundName(fund.name, fund.fundPage, ticker) : null;
    const fundCategory = resolveCategory(fund.category, fund.categoryPath, meta?.category);

    // the age rule also covers the rows this run did not refresh: no horizon the fund is too young for
    const returns = withoutYoungReturns(fund.returns, fund.inception, fund.performanceAsOf ?? isoDateOrNull(meta?.returns?.performanceAsOf), RETURN_HORIZONS);
    const ytd = returns.ytd ?? meta?.returns?.monthEnd?.ytd ?? null;
    const tr1y = returns.yr1 ?? null;
    const yr10 = tenYearEligible(fund.inception) ? (returns.yr10 ?? null) : null;
    const cagr3y = returns.yr3 ?? null;
    const cagr5y = returns.yr5 ?? null;
    const cagr10y = yr10;
    const siAnn = returns.sinceInception ?? null;
    const metrics = buildMetrics({
      returns: { ...returns, ytd },
      inception: fund.inception,
      dividendYield: divYield,
      dividendYieldBasis: divYieldBasis,
      secYield,
      performanceAsOf: fund.performanceAsOf ?? isoDateOrNull(meta?.returns?.performanceAsOf),
    });
    const performanceAsOf = metrics.performanceAsOf as string | null;

    const closePriceValue = fund.close ?? meta?.marketPrice?.value ?? null;

    const freq = normalizeDistributionFrequency(meta?.distributions?.frequency ?? fund.categoryPath ?? '—');
    const freqCode = frequencyCodeLabel(freq);

    indexFunds.push({
      ticker,
      name: fundName,
      category: fundCategory,
      fundPage: fund.fundPage,
      dataFile: meta ? `./funds/${ticker}/meta.json` : null,
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
      exchange: fund.exchange || meta?.identifiers?.exchange || null,
      closePrice: closePriceValue !== null ? `$${closePriceValue.toFixed(2)}` : (meta?.marketPrice?.display || '—'),
      closePriceValue,
      closePriceSource: meta?.marketPrice?.source || (fund.close !== null ? 'official product page Market Price' : null),
      premiumDiscount: fund.premiumDiscount !== null ? `${fund.premiumDiscount.toFixed(2)}%` : (meta?.premiumDiscount?.display || '—'),
      premiumDiscountValue: plausiblePremiumDiscount(fund.premiumDiscount ?? meta?.premiumDiscount?.value),
      premiumDiscountAsOfDate: plausiblePremiumDiscount(fund.premiumDiscount ?? meta?.premiumDiscount?.value) !== null ? (isoDateOrNull(meta?.premiumDiscount?.asOfDate) ?? null) : null,
      distributions: {
        frequency: freq,
        exDate: meta?.distributions?.exDate || '—',
        dividend: meta?.distributions?.latestDividend || '—',
      },
      returns: {
        monthEnd: {
          asOfDate: performanceAsOf ? formatDate(performanceAsOf) : '',
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
          sinceInception: null,
          sinceInceptionText: '—',
        },
      },
      metrics,
      dividendYieldSource: typeof meta?.yields?.dividendYieldKind === 'string' && String(meta.yields.dividendYieldKind).startsWith('indicated')
        ? 'indicated'
        : (divYield !== null ? 'official' : null),
      distributionFrequency: freq,
      holdings: holdingsCount,
      history: historyCount,
    });
  }

  const indexData = {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
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
    // the 52-week range of every row from its published history pages (shared range-52w block)
    funds: await withRange52w(API_ROOT, markClosedFunds(indexFunds, CLOSED_FUNDS)),
  };

  await writeJsonIfChanged(INDEX_FILE, indexData);
  // Q28: a fund is announced on its first successful publish (a catalog-only row is not published), new catalog-only rows as pending
  const newFunds = newFundsLines(newFundsReport(previousRows, indexFunds));
  for (const line of newFunds) console.log(line);
  if (newFunds.length && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### NEW FUNDS\n\n${newFunds.join('\n')}\n`, 'utf8');

  // Update state cursor
  if (useCursor) {
    if (config.maxFetches > 0) {
      const lastTicker = toProcess.length ? toProcess[(deadlineHit ? dispatched : toProcess.length) - 1].ticker : state.cursor || null;
      await writeJsonIfChanged(STATE_FILE, { cursor: lastTicker, savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
    } else if (filtered.length === catalog.size) {
      // Only an unfiltered full pass resets the rotation.
      try { await rm(STATE_FILE); } catch {}
    }
  }

  if (totalToProcess > 0 && failed === totalToProcess) {
    console.error(`[ failed   ] every selected fund failed (${failed} of ${totalToProcess})`);
    process.exitCode = 1;
  }
  console.log(output.summary(startedAt));
  console.log(outputCounts(indexFunds.length, totalHoldings, totalHistory));
}

// File defaults and explicit overrides, one resolver for the CLI and the GitHub
// Actions workflow. Allowlisted scalar controls only, so workflow inputs are
// never interpolated into bash. Precedence: config file < advanced JSON <
// nonblank inputs < environment (explicit env wins, even when empty).
export const CONTROL_NAMES = [
  'MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY', 'AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD', 'TICKERS',
  'CATEGORY', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'HISTORY_RANGE', 'MAX_RETRIES', 'SEC_UA',
  'STORE_RAW_DOWNLOADS', 'SKIP_YAHOO', 'SKIP_FRANKLIN', 'EDGAR_FALLBACK', 'VERBOSE', 'USE_SYSTEM_CA',
  ...['PERFORMANCE', 'TOTAL_RETURN'].flatMap((prefix) => ['YTD', '1Y', '3Y', '5Y', '10Y'].map((period) => `${prefix}_${period}`)),
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];
export const CONFIG_FILE_URL = new URL('./update-data.config.json', import.meta.url);
const BRAND_ENV_ALIASES: Record<string, string> = { HISTORY_PAGE_SIZE: 'HISTORICAL_PAGE_SIZE' };

export function resolveControls(
  file: unknown = {},
  advanced: unknown = {},
  inputs: unknown = {},
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  const known = new Set<string>(CONTROL_NAMES);
  const apply = (value: unknown, skipEmpty = false): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
    for (const [key, raw] of Object.entries(value)) {
      if (!known.has(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw === '' || raw === undefined || raw === null)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text = String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key] = text;
    }
  };
  apply(file);
  apply(advanced);
  apply(inputs, true);
  for (const key of CONTROL_NAMES) {
    const alias = BRAND_ENV_ALIASES[key];
    const value = env[key] ?? (alias ? env[alias] : undefined);
    if (value !== undefined) apply({ [key]: value });
  }
  for (const key of ['MAX_FETCHES', 'CONCURRENCY', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'MAX_RETRIES']) {
    const v = result[key];
    if (v === undefined || v.trim() === '') continue;
    const min = key === 'MAX_FETCHES' ? 0 : 1;
    if (!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(Number(v)) || Number(v) < min) throw new Error(`${key}: expected integer >= ${min}`);
  }
  if (result.REQUEST_SLEEP?.trim() && (!Number.isFinite(Number(result.REQUEST_SLEEP)) || Number(result.REQUEST_SLEEP) < 0)) throw new Error('REQUEST_SLEEP: expected nonnegative seconds');
  for (const key of ['STORE_RAW_DOWNLOADS', 'SKIP_YAHOO', 'SKIP_FRANKLIN', 'EDGAR_FALLBACK', 'VERBOSE']) {
    if (result[key]?.trim() && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result[key].trim())) throw new Error(`${key}: expected boolean`);
  }
  if (result.USE_SYSTEM_CA !== undefined) {
    const mode = result.USE_SYSTEM_CA.trim().toLowerCase();
    if (!['auto', 'true', 'false'].includes(mode)) throw new Error('USE_SYSTEM_CA: expected auto, true or false');
    result.USE_SYSTEM_CA = mode;
  }
  if (result.HISTORY_RANGE?.trim() && !isHistoryRange(result.HISTORY_RANGE.trim().toLowerCase())) throw new Error('HISTORY_RANGE: expected "max" or "<N>y"');
  parseConfig(result); // validate every min:max filter before any request or write
  return result;
}

export async function runtimeControls(env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  let file: unknown = {};
  try { file = JSON.parse(await readFile(CONFIG_FILE_URL, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return resolveControls(file, {}, {}, env);
}

export async function main(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): Promise<void> {
  if (argv.some((arg) => arg === '--help' || arg === '-h')) {
    console.log(usageText());
    return;
  }
  if (argv.length) throw new Error(`unsupported argument(s): ${argv.join(' ')}. Use --help for usage.`);
  const controls = await runtimeControls(env);
  if (controls.VERBOSE !== undefined && env === process.env) process.env.VERBOSE = controls.VERBOSE;
  if (controls.SEC_UA?.trim()) SEC_UA = controls.SEC_UA.trim();
  installSystemCa(controls.USE_SYSTEM_CA ?? 'auto');
  await runUpdater(parseConfig(controls));
}


if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

// <holdings-guard> shared block of .claude/tools/etfs/etf-std/holdings-guard.block.ts, applied by apply-holdings-guard.ts: never edit it in one repo
/**
 * Sanity check of a fund's new holdings before they replace the published ones. Returns why they must be rejected
 * (the caller then keeps the fund's previous state and reports it as failed), or null when they may be written.
 * An empty sheet passes only when nothing was published before. Otherwise a Name and a weight column (Weight,
 * Weight (%) or Market Weight) are required, >= 80% of the rows carry a numeric weight, the weights add up to
 * 50..150 and the sheet keeps >= 50% of the previously published rows. `relax` switches off the checks a fund
 * legitimately fails: 'numeric' and 'sum' (geared, inverse, futures, look-through, top-N lists) and 'count'. No relax lets
 * a sheet without a single numeric weight replace a published sheet that had numeric weights (`previousWeights`: how many
 * rows of the published sheet carry a numeric weight, see holdingsWeightCount; open-items etfs Q24).
 * Rows are arrays in header order or objects keyed by the header text. A fund in the brand's CLOSED_FUNDS never reaches the guard.
 */
export function holdingsGuard(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, previousRows: number | null | undefined, relax: ReadonlyArray<string> = [], previousWeights: number | null = null): string | null {
  const previous = Number(previousRows) > 0 ? Number(previousRows) : 0;
  if (!rows.length) return previous ? `no holdings rows (${previous} published)` : null;
  const names = headers.map((header) => String(header).trim().toLowerCase());
  const nameAt = names.indexOf('name');
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  if (nameAt < 0 || weightAt < 0) return `no ${nameAt < 0 ? 'Name' : 'weight'} column (headers: ${headers.join(', ') || 'none'})`;
  const weights = holdingsGuardWeights(headers, rows, weightAt);
  const numeric = weights.count;
  const sum = weights.sum;
  if (numeric === 0 && Number(previousWeights) > 0) return `no row has a numeric weight, the published sheet had ${Number(previousWeights)}`;
  if (relax.indexOf('numeric') < 0 && numeric < rows.length * 0.8) return `only ${numeric} of ${rows.length} rows have a numeric weight`;
  if (relax.indexOf('sum') < 0 && (sum < 50 || sum > 150)) return `weights add up to ${sum.toFixed(2)}, outside 50..150`;
  if (relax.indexOf('count') < 0 && previous && rows.length < previous * 0.5) return `${rows.length} rows, less than half of the ${previous} published`;
  return null;
}

/** How many rows carry a numeric weight (Weight, Weight (%) or Market Weight column), 0 without such a column: pass it for the published sheet as holdingsGuard's previousWeights. */
export function holdingsWeightCount(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>): number {
  const names = headers.map((header) => String(header).trim().toLowerCase());
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  return weightAt < 0 ? 0 : holdingsGuardWeights(headers, rows, weightAt).count;
}

/** Count and sum of the numeric weights in column weightAt; rows are arrays in header order or objects keyed by the header text. */
function holdingsGuardWeights(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, weightAt: number): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    const weight = holdingsGuardNumber(Array.isArray(row) ? row[weightAt] : row && typeof row === 'object' ? row[headers[weightAt]] : undefined);
    if (weight !== null) {
      count++;
      sum += weight;
    }
  }
  return { count, sum };
}

/** A weight cell as a number: %, $, commas and spaces are ignored, (x) is negative; null when it is no plain number (a zero-width character inside counts as broken). */
function holdingsGuardNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value === null || value === undefined ? '' : value).replace(/[ \t ,%$]/g, '').replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  return negative ? -Number(text) : Number(text);
}

/** A fund its issuer closed (liquidated, delisted or merged away), confirmed from an official source: an SEC filing or the issuer's notice. */
export type ClosedFund = { ticker: string; closed: string; source: string };

/**
 * The brand's CLOSED_FUNDS entry for a ticker, or null. A closed fund is never fetched, never guarded and never reported failed: it keeps
 * its last published data and its index row carries `status: 'closed'`, `closedDate` and `closedSource`. A malformed entry throws, so a
 * typo (no ISO date, no https source) never ships.
 */
export function closedFund(list: ReadonlyArray<ClosedFund>, ticker: unknown): ClosedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: ClosedFund | null = null;
  for (let i = 0; i < list.length; i++) {
    const fund = list[i];
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(fund.ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(fund.closed) || !/^https:\/\/\S+$/.test(fund.source)) throw new Error(`CLOSED_FUNDS: ${fund.ticker} needs an upper-case ticker, an ISO closing date and an https source`);
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** The index rows with every closed fund marked (`status: 'closed'`, `closedDate`, `closedSource`); other rows are returned as they are. */
export function markClosedFunds<T extends object>(rows: ReadonlyArray<T>, list: ReadonlyArray<ClosedFund>): T[] {
  return rows.map((row) => {
    const fund = closedFund(list, (row as { ticker?: unknown }).ticker);
    return fund ? ({ ...row, status: 'closed', closedDate: fund.closed, closedSource: fund.source } as T) : row;
  });
}

/** A run's queue without the closed funds, which are named once in the log: they are neither fetched nor counted as failed. */
export function withoutClosedFunds<T>(queue: ReadonlyArray<T>, tickerOf: (item: T) => string, list: ReadonlyArray<ClosedFund>): T[] {
  const closed: string[] = [];
  const open: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (closedFund(list, tickerOf(queue[i]))) closed.push(tickerOf(queue[i]));
    else open.push(queue[i]);
  }
  if (closed.length) console.log(`[ closed   ] ${closed.join(', ')}: closed by the issuer, published data kept`);
  return open;
}
// </holdings-guard>

// <nport-reader> shared block of .claude/tools/etfs/etf-std/nport-reader.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * SEC EDGAR Form N-PORT-P holdings reader (open-items etfs ETF-H2), one copy for every brand. Pure functions plus one reader
 * that takes the brand's own `getText(url, label)` (its SEC User-Agent, timeout, retries and pacing). Rules it enforces:
 * - identifiers come from the position itself: `<cusip>` text (or a `value` attribute), `<isin value>`, `<ticker value>`,
 *   `<other value>`; a derivative's reference instrument (inside `<derivativeInfo>`) never lends its identifiers to the position
 * - CUSIP `000000000` and `N/A` are missing; a missing weight or value is null (an empty cell), never 0
 * - a ticker only for a common-stock row (assetCat EC, not a CVR, right, warrant or escrow line) traded in USD with a U.S.
 *   ISIN or none, or with a foreign ISIN when the Nasdaq Trader directories list that ticker for the same company (a U.S.
 *   listing such as Linde, NXP, IMAX); renamed issuers through `nportRenamedIssuers`; an abbreviated or reordered name the
 *   exact key misses through a looser key that must name one company (`nportLooseKey`, Q35: `Lowe's Cos` = `LOWES COMPANIES`,
 *   `SCHWAB CHARLES CORP`); never one ticker on two different securities (`nportTickers`)
 * - identity: the filing must name the fund's own series id, or, with no series id known, the fund's name (`nportIdentity`)
 * - freshness: the report period must be strictly newer than the published holdings (`nportIsFresh`)
 * - filings come newest report period first from the registrant's own archive folder, never from the filer agent's CIK
 *   (the accession number prefix)
 */
export type NportPosition = {
  name: string;
  title: string;
  lei: string;
  cusip: string;
  isin: string;
  ticker: string;
  other: string;
  otherDesc: string;
  balance: number | null;
  units: string;
  currency: string;
  /** valUSD, null when the filing has none */
  value: number | null;
  /** pctVal: percent of net assets (0.5 = 0.5%), null when the filing has none */
  weight: number | null;
  payoff: string;
  assetCat: string;
  issuerCat: string;
  country: string;
  /** derivCat of the position's derivativeInfo (FUT, FWD, SWP, OPT, ...), empty for a security */
  derivative: string;
  /** debtSec annualizedRt and maturityDt (ISO), null and '' for a non-debt row */
  coupon: number | null;
  maturity: string;
};

export type NportFiling = {
  seriesId: string;
  seriesName: string;
  regName: string;
  regCik: string;
  /** report period end (genInfo repPdDate) as ISO, '' when missing */
  repPdDate: string;
  netAssets: number | null;
  totalAssets: number | null;
  positions: NportPosition[];
};

export type NportCandidate = { accession: string; filed: string; period: string; cik: string };
export type NportSeriesRef = { cik: string; seriesId: string; classId: string };

/** XML text: entities decoded, tags dropped, whitespace collapsed. */
function nportText(raw: string): string {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<tag>` (any namespace prefix) in `xml`, '' when absent. */
function nportTag(xml: string, tag: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** The `attribute` of the first `<tag ...>` (any namespace prefix) in `xml`, '' when absent. */
function nportAttr(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** A plain decimal or exponent number, null for an empty, N/A or broken cell. */
function nportNumber(raw: string): number | null {
  const text = String(raw).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An identifier code, '' for N/A, NONE and all zeros (CUSIP 000000000 means "no CUSIP"). */
function nportCode(raw: string): string {
  const text = String(raw).trim().toUpperCase();
  return !text || /^(N\/?A|NONE|-+|0+)$/.test(text) ? '' : text;
}

/** ISO date of an N-PORT date (YYYY-MM-DD, possibly with a time), '' otherwise. */
function nportIso(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** One N-PORT-P primary_doc.xml (or the full submission .txt that embeds it) as series facts and positions. */
export function parseNportFiling(xml: string): NportFiling {
  const text = String(xml === null || xml === undefined ? '' : xml);
  const genInfo = /<(?:[A-Za-z0-9_.-]+:)?genInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?genInfo>/i.exec(text);
  const fundInfo = /<(?:[A-Za-z0-9_.-]+:)?fundInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?fundInfo>/i.exec(text);
  const gen = genInfo ? genInfo[1] : '';
  const fund = fundInfo ? fundInfo[1].replace(/<(?:[A-Za-z0-9_.-]+:)?returnInfo\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?returnInfo>/gi, ' ') : '';
  const positions: NportPosition[] = [];
  const blocks = /<(?:[A-Za-z0-9_.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?invstOrSec>/gi;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const raw = block[1];
    const derivativeInfo = /<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/i.exec(raw);
    // The reference instrument of a derivative (SPY for a SPY option, a bond for a CDS) is another security: drop it first.
    const own = raw.replace(/<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/gi, ' ');
    const identifiers = /<(?:[A-Za-z0-9_.-]+:)?identifiers\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?identifiers>/i.exec(own);
    const ids = identifiers ? identifiers[1] : '';
    const debt = /<(?:[A-Za-z0-9_.-]+:)?debtSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?debtSec>/i.exec(own);
    const name = nportTag(own, 'name');
    positions.push({
      name: name && !/^N\/?A$/i.test(name) ? name : nportTag(own, 'title'),
      title: nportTag(own, 'title'),
      lei: nportCode(nportTag(own, 'lei')),
      cusip: nportCode(nportTag(own, 'cusip') || nportAttr(ids, 'cusip', 'value')),
      isin: nportCode(nportAttr(ids, 'isin', 'value')),
      ticker: nportCode(nportAttr(ids, 'ticker', 'value')),
      other: nportCode(nportAttr(ids, 'other', 'value')),
      otherDesc: nportAttr(ids, 'other', 'otherDesc'),
      balance: nportNumber(nportTag(own, 'balance')),
      units: nportTag(own, 'units'),
      currency: (nportTag(own, 'curCd') || nportAttr(own, 'currencyConditional', 'curCd')).toUpperCase(),
      value: nportNumber(nportTag(own, 'valUSD')),
      weight: nportNumber(nportTag(own, 'pctVal')),
      payoff: nportTag(own, 'payoffProfile'),
      assetCat: (nportTag(own, 'assetCat') || nportAttr(own, 'assetConditional', 'assetCat')).toUpperCase(),
      issuerCat: (nportTag(own, 'issuerCat') || nportAttr(own, 'issuerConditional', 'issuerCat')).toUpperCase(),
      country: nportTag(own, 'invCountry').toUpperCase(),
      derivative: derivativeInfo ? (/\bderivCat\s*=\s*"([^"]*)"/i.exec(derivativeInfo[1]) || ['', 'OTHER'])[1].toUpperCase() : '',
      coupon: debt ? nportNumber(nportTag(debt[1], 'annualizedRt')) : null,
      maturity: debt ? nportIso(nportTag(debt[1], 'maturityDt')) : '',
    });
  }
  return {
    seriesId: nportTag(gen, 'seriesId').toUpperCase(),
    seriesName: nportTag(gen, 'seriesName'),
    regName: nportTag(gen, 'regName'),
    regCik: nportTag(gen, 'regCik').replace(/\D/g, ''),
    repPdDate: nportIso(nportTag(gen, 'repPdDate')),
    netAssets: nportNumber(nportTag(fund, 'netAssets')),
    totalAssets: nportNumber(nportTag(fund, 'totAssets')),
    positions,
  };
}

/**
 * A number as sheet text: '' for null, no exponent, at most `digits` decimals (trailing zeros dropped), and no binary float
 * artifact: `115797518.01` stays `115797518.01`, not the `115797518.01000001` of `toFixed(8)`.
 */
export function nportCell(value: number | null, digits = 8): string {
  if (value === null || !Number.isFinite(value)) return '';
  const fixed = value.toFixed(digits);
  // the shortest text of the rounded number; toFixed only where that text would be an exponent (very small or large numbers)
  const shortest = String(Number(fixed));
  if (!/e/i.test(shortest)) return shortest;
  return fixed.indexOf('.') < 0 ? fixed : fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** The position's own identifier for a sheet: CUSIP, else ISIN, else the "other" code (a Bloomberg or internal id), else ''. */
export function nportIdentifier(position: NportPosition): string {
  return position.cusip || position.isin || position.other;
}

/**
 * A company name as a lookup key: upper case, punctuation and legal suffixes dropped, `CLASS A` -> `CL A`. Initials are one
 * word whether written with dots, spaces or a slash (`N.V.` = `N V` = `NV`, `C.H. ROBINSON` = `C H ROBINSON`, `A/S` = `A S`,
 * `S.A.B. de C.V.` = `SAB DE CV`), `PUBLIC LIMITED COMPANY` is `plc`, and a leading `US` stays (`U.S. BANCORP` is not
 * `BANCORP, INC.`), so both spellings of one issuer give one key.
 */
export function nportNameKey(value: unknown): string {
  // EDGAR adds a state or qualifier suffix to company titles ("COSTCO WHOLESALE CORP /NEW", "BANK OF AMERICA CORP /DE/",
  // "US BANCORP \DE\", "ACUITY INC. (DE)"): drop a trailing one
  const raw = String(value === null || value === undefined ? '' : value).replace(/(?:\s*(?:[\/\\]\s*[A-Za-z]{2,3}\s*[\/\\]?|\(\s*[A-Za-z]{2,3}\s*\)))+\s*$/, '');
  let text = nportText(raw).toUpperCase().replace(/['’]/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\s+([A-Z])\b/g, 'CL $1');
  // a run of single letters is one word, never the class letter after CL
  const words: string[] = [];
  let joining = false;
  text.split(' ').forEach((word) => {
    const letter = /^[A-Z]$/.test(word);
    if (letter && joining) words[words.length - 1] += word;
    else words.push(word);
    joining = letter && (joining || words[words.length - 2] !== 'CL');
  });
  text = words.join(' ').replace(/\bPUBLIC (?:(?:LIMITED|LTD)(?: (?:COMP[A-Z]*|CO))?|(?:COMPANY|CO) (?:LIMITED|LTD))\b/g, 'PLC').replace(/\b(?:S DE RL )?DE CV\b/g, ' ');
  const share = /\bCL [A-Z]\b/.exec(text);
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|SAB|NV|AG|SE|SPA|AS|ASA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, (word: string, _name: string, at: number) => (word === 'US' && at === 0 ? word : ' ')).replace(/\s+/g, ' ').trim();
  if (share && !/\bCL [A-Z]\b/.test(text)) text = `${text} ${share[0]}`;
  return text;
}

/**
 * Abbreviated words of issuer names (open-items etfs Q35) -> one spelling, each seen in N-PORT-P filings of the brands against
 * the SEC company_tickers.json title of the same CUSIP issuer (2026-10-26): `LOWES COS` / `LOWES COMPANIES`, `AMERIPRISE FINL`,
 * `VICI PPTYS`, `TAIWAN SEMICONDUCTOR MFG`, `ZIONS BANCORP NA` / `ZIONS BANCORPORATION NATIONAL ASSOCIATION`. '' drops the word.
 */
function nportLooseWords(): Record<string, string> {
  return {
    COS: '', COMPANIES: '', AND: '', OF: '', NA: '', NATIONAL_ASSOCIATION: '', INCORPORATION: '', REIT: '',
    BANCORPORATION: 'BANCORP', FINL: 'FINANCIAL', PPTYS: 'PROPERTIES', PPTY: 'PROPERTY', MFG: 'MANUFACTURING', GRP: 'GROUP',
    HLDGS: 'HOLDINGS', HLDG: 'HOLDING', INTL: 'INTERNATIONAL', SVCS: 'SERVICES', TECH: 'TECHNOLOGIES', TECHNOLOGY: 'TECHNOLOGIES',
    SYS: 'SYSTEMS', NATL: 'NATIONAL', RES: 'RESOURCES', RLTY: 'REALTY', INDS: 'INDUSTRIES', INS: 'INSURANCE', BROS: 'BROTHERS', SVGS: 'SAVINGS',
  };
}

/**
 * The second, looser company key (open-items etfs Q35), used only for a row the exact key (`nportNameKey`) left without a
 * ticker: a Bloomberg location or article after a slash dropped (`Charles Schwab Corp/The`, `Energy Fuels Inc/canada`; never a
 * one-word start like `RE/MAX`), abbreviations read as one word (`nportLooseWords`), the share class dropped (the caller picks
 * the class) and the words sorted, so EDGAR's reordered titles meet the usual order: `SCHWAB CHARLES CORP` = `Charles Schwab
 * Corp`, `HORTON D R INC` = `DR Horton Inc`, `PRICE T ROWE GROUP INC` = `T Rowe Price Group Inc`. Several companies can share a
 * loose key: `parseSecCompanyNames` and `parseUsListings` keep such a key empty, so it never gives a ticker.
 */
export function nportLooseKey(value: unknown): string {
  let raw = String(value === null || value === undefined ? '' : value).trim();
  const slash = /^(.*\s\S*[A-Za-z]{2}[.,]?)\s*\/\s*([A-Za-z][A-Za-z .,']*)$/.exec(raw);
  if (slash) raw = slash[1];
  // a trailing EDGAR or Bloomberg qualifier after the legal form: `CHEVRON CORP NEW`, `US BANCORP DEL`, `PROGRESSIVE CORP OHIO`
  raw = raw.replace(/\b(CORP(?:ORATION)?|INC(?:ORPORATED)?|CO(?:MPANY)?|LTD|BANCORP|GROUP|GRP|TRUST|HOLDINGS?)\.?,?\s+(?:NEW|DEL|REINCORPORATION|OHIO|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\.?$/i, '$1');
  const words = nportLooseWords();
  const key = nportNameKey(raw).replace(/ CL [A-Z]$/, '').replace(/\bNATIONAL ASSOCIATION\b/g, 'NATIONAL_ASSOCIATION');
  return key.split(' ').map((word) => (Object.prototype.hasOwnProperty.call(words, word) ? words[word] : word)).filter(Boolean).sort().join(' ');
}

/**
 * SEC company_tickers.json -> name key -> ticker (the first, largest company wins a shared key; the class-less key is added too).
 * Each loose key (`nportLooseKey`) is added as `\u0001<loose key>` -> the company's tickers, space-separated in the table's
 * order, or '' when two companies (CIKs) share it; `nportTickers` reads them for rows the exact key misses.
 */
export function parseSecCompanyNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const loose = new Map<string, { cik: string; tickers: string[] } | null>();
  const rows = payload && typeof payload === 'object' ? Object.keys(payload as object).map((key) => (payload as Record<string, unknown>)[key]) : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { ticker?: unknown; title?: unknown; cik_str?: unknown } | null;
    if (!row || typeof row !== 'object') continue;
    const ticker = String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
    const key = nportNameKey(row.title);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !key) continue;
    if (!names.has(key)) names.set(key, ticker);
    const core = key.replace(/ CL [A-Z]$/, '');
    if (core && !names.has(core)) names.set(core, ticker);
    const looseKey = nportLooseKey(row.title);
    const cik = String(row.cik_str === null || row.cik_str === undefined ? '' : row.cik_str).replace(/\D/g, '');
    if (!looseKey || !Number(cik)) continue;
    const seen = loose.get(looseKey);
    if (seen === undefined) loose.set(looseKey, { cik: String(Number(cik)), tickers: [ticker] });
    else if (seen && seen.cik === String(Number(cik))) { if (seen.tickers.indexOf(ticker) < 0) seen.tickers.push(ticker); }
    else loose.set(looseKey, null);
  }
  loose.forEach((seen, looseKey) => names.set(`\u0001${looseKey}`, seen ? seen.tickers.join(' ') : ''));
  return names;
}

/** SEC company_tickers_mf.json -> fund ticker -> registrant CIK (10 digits), series id, class id. */
export function parseSecFundTickers(payload: unknown): Map<string, NportSeriesRef> {
  const map = new Map<string, NportSeriesRef>();
  const record = (payload && typeof payload === 'object' ? payload : {}) as { fields?: unknown; data?: unknown };
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const rows = Array.isArray(record.data) ? record.data : [];
  const at = (row: unknown[], field: string): string => (fields.indexOf(field) < 0 ? '' : String(row[fields.indexOf(field)] === null || row[fields.indexOf(field)] === undefined ? '' : row[fields.indexOf(field)]).trim());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const ticker = at(row, 'symbol').toUpperCase();
    const cik = at(row, 'cik').replace(/\D/g, '');
    const seriesId = at(row, 'seriesId').toUpperCase();
    if (!ticker || !Number(cik) || !/^S\d{9}$/.test(seriesId) || map.has(ticker)) continue;
    map.set(ticker, { cik: `0000000000${Number(cik)}`.slice(-10), seriesId, classId: at(row, 'classId').toUpperCase() });
  }
  return map;
}

/**
 * Is the row a contingent value right, a right, a warrant or an escrow line filed as equity? A placeholder CUSIP or ISIN
 * (`436CVR021`, `US009CVR0445`, `549ESC028`, `866CNT017`) says so; so does the name or title (`NOVO NORDISK A/S - CVR`,
 * `XYZ INC RIGHTS`, `... WARRANT FEB 2026`, `Luby's Inc Escrow`), except on a CUSIP with the common-stock issue number 10
 * (Schwab titles Enovix common stock 293594107 "Enovix Corp Warrants"). `CVR` as the first word is a company (CVR Energy).
 */
function nportIsRight(position: NportPosition): boolean {
  if (/^[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.cusip) || /^US[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.isin)) return true;
  if (/^[0-9A-Z]{6}10[0-9]$/.test(position.cusip)) return false;
  return [position.name, position.title].some((text) => /\S\s*\bCVRS?\b|\bCONTINGENT\b|\bRIGHTS?\b|\bRTS\b|\bWARRANTS?\b|\bWTS\b|\bESCROW\b/i.test(text));
}

/**
 * Renamed issuers (open-items etfs Q33): N-PORT filers keep an issuer's old name for months while SEC's company_tickers.json
 * titles only the new one, so the name match misses (JPMorgan JEPI's Exxon). Old name key (`nportNameKey`) -> [ticker, CUSIP
 * issuer number (the first six characters)]. Used only when the SEC table has no such key, the row's CUSIP (or U.S. ISIN) has
 * that issuer number and the SEC table still lists the ticker. Each entry was confirmed on 2026-10-26: an EC row without a
 * ticker in the N-PORT-P filings of large U.S. equity funds (VTI, SCHB, ITOT, JEPI, IWB, VB, SCHA, FNDX, FNDA, ...) whose name
 * is a former EDGAR name of the CIK that has the ticker today (data.sec.gov submissions `formerNames`, the date the old name
 * ended), the ticker the CIK's only common stock in the Nasdaq Trader directories. Add an entry only with the same evidence.
 * A function, not a const: blocks sit at the end of update-data.ts, below the top-level run, so only declarations are hoisted.
 */
export function nportRenamedIssuers(): Array<[string, string, string]> {
  return [
    ['AADI BIOSCIENCE', 'WHWK', '00032Q'], // CIK 1422142 Whitehawk Therapeutics, Inc., former EDGAR name until 2025-03-18
    ['ABACUS LIFE', 'ABX', '00258Y'], // CIK 1814287 Abacus Global Management, Inc., former EDGAR name until 2025-02-04
    ['ACUITY BRANDS', 'AYI', '00508Y'], // CIK 1144215 ACUITY INC. (DE), former EDGAR name until 2025-04-17
    ['AEROVATE THERAPEUTICS', 'JBIO', '008064'], // CIK 1798749 Jade Biosciences, Inc., former EDGAR name until 2025-04-30
    ['AILERON THERAPEUTICS', 'RNTX', '00887A'], // CIK 1420565 Rein Therapeutics, Inc., former EDGAR name until 2024-12-09
    ['ALLOVIR', 'KLRS', '482929'], // CIK 1754068 Kalaris Therapeutics, Inc., former EDGAR name until 2025-03-12
    ['AMC NETWORKS', 'AMCX', '00164V'], // CIK 1514991 AMC Global Media Inc., former EDGAR name until 2026-04-03
    ['AMMO', 'POWW', '00175J'], // CIK 1015383 Outdoor Holding Co, former EDGAR name until 2025-04-24
    ['ARDENT HEALTH PARTNERS', 'ARDT', '03980N'], // CIK 1756655 Ardent Health, Inc., former EDGAR name until 2025-05-23
    ['ARENA GROUP HOLDINGS', 'PAAI', '040044'], // CIK 894871 Paradium.AI, Inc., former EDGAR name until 2026-08-13
    ['ATEGRITY SPECIALTY HOLDINGS LLC', 'ASIC', '04681Y'], // CIK 2040491 Ategrity Specialty Insurance Co Holdings, former EDGAR name until 2025-06-11
    ['BAKKT HOLDINGS', 'BKKT', '05759B'], // CIK 1820302 Bakkt, Inc., former EDGAR name until 2026-01-20
    ['BED BATH AND BEYOND', 'NXH', '690370'], // CIK 1130713 NEIGHBORHOOD INTELLIGENCE, INC., former EDGAR name until 2026-08-14
    ['BLACKROCK FUNDING', 'BLK', '09290D'], // CIK 2012383 BlackRock, Inc., former EDGAR name until 2024-10-01
    ['BRIGHTSPHERE INVESTMENT GROUP', 'AAMI', '10948W'], // CIK 1748824 Acadian Asset Management Inc., former EDGAR name until 2024-11-14
    ['CARA THERAPEUTICS', 'TVRD', '140755'], // CIK 1346830 Tvardi Therapeutics, Inc., former EDGAR name until 2025-04-11
    ['CEA INDUSTRIES', 'BNC', '86887P'], // CIK 1482541 BNB Standard Corp, former EDGAR name until 2026-09-21
    ['CHROMADEX', 'NAGE', '171077'], // CIK 1386570 Niagen Bioscience, Inc., former EDGAR name until 2025-03-10
    ['CLEANCORE SOLUTIONS', 'ZONE', '184492'], // CIK 1956741 Zone Frontier Inc., former EDGAR name until 2026-08-20
    ['CORPORATE OFFICE PROPERTIES TRUST', 'CDP', '22002T'], // CIK 860546 COPT DEFENSE PROPERTIES, former EDGAR name until 2023-09-14
    ['CULLINAN ONCOLOGY', 'CGEM', '230031'], // CIK 1789972 Cullinan Therapeutics, Inc., former EDGAR name until 2024-04-02
    ['DIME COMMUNITY BANCSHARES', 'DCOM', '25432X'], // CIK 846617 Dime Commercial Bancshares, Inc. /NY/, former EDGAR name until 2026-05-27
    ['DOMO', 'HUCK', '257554'], // CIK 1505952 Huckleberry.ai, Inc., former EDGAR name until 2026-09-03
    ['EASTSIDE DISTILLING', 'BLNE', '277802'], // CIK 1534708 Beeline Holdings, Inc., former EDGAR name until 2025-03-11
    ['EQUITY RESIDENTIAL', 'VMRK', '29476L'], // CIK 906107 VIVMARK RESIDENTIAL, former EDGAR name until 2026-08-12
    ['EXP WORLD HOLDINGS', 'AGNT', '30212W'], // CIK 1495932 AGNT, Inc., former EDGAR name until 2026-06-01
    ['EXXON MOBIL', 'XOM', '30231G'], // holding company reorganization: XOM is CIK 2115436 ExxonMobil Holdings Corp since 2026, the old Exxon Mobil Corp is CIK 34088
    ['EYEPOINT PHARMACEUTICALS', 'EYPT', '30233G'], // CIK 1314102 EyePoint, Inc., former EDGAR name until 2025-12-08
    ['EZFILL HOLDINGS', 'NXXT', '652941'], // CIK 1817004 NEXTNRG, INC., former EDGAR name until 2025-02-14
    ['FORTUNE BRANDS HOME AND SECURITY', 'FBIN', '34964C'], // CIK 1519751 Fortune Brands Innovations, Inc., former EDGAR name until 2022-12-14
    ['FRANKLIN RESOURCES', 'BEN', '354613'], // CIK 38777 FRANKLIN TEMPLETON INC, former EDGAR name until 2026-08-14
    ['FREYR BATTERY', 'TE', '35834F'], // CIK 1992243 T1 Energy Inc., former EDGAR name until 2025-02-14
    ['GALLAGHER ARTHUR J AND', 'AJG', '363576'], // CIK 354190 Arthur J. Gallagher & Co., former EDGAR name until 2019-08-14
    ['GRAINGER WW', 'GWW', '384802'], // CIK 277135 W.W. GRAINGER, INC., former EDGAR name until 2019-10-15
    ['GRAY TELEVISION', 'GTN', '389375'], // CIK 43196 GRAY MEDIA, INC, former EDGAR name until 2025-02-24
    ['GREAT AJAX', 'RPT', '38983D'], // CIK 1614806 Rithm Property Trust Inc., former EDGAR name until 2024-11-13
    ['GREENIDGE GENERATION HOLDINGS', 'VIP', '39531G'], // CIK 1844971 Vulcan Infrastructure & Power Inc., former EDGAR name until 2026-07-09
    ['HANNON ARMSTRONG SUSTAINABLE INFRASTRUCTURE CAPITAL', 'HASI', '41068X'], // CIK 1561894 HA Sustainable Infrastructure Capital, Inc., former EDGAR name until 2024-07-02
    ['HARTFORD FINANCIAL SERVICES GROUP', 'HIG', '416515'], // CIK 874766 HARTFORD INSURANCE GROUP, INC., former EDGAR name until 2025-01-30
    ['HELIX ENERGY SOLUTIONS GROUP', 'HOS', '42330P'], // CIK 866829 HORNBECK OFFSHORE SERVICES, INC., former EDGAR name until 2026-08-31
    ['HYSTER YALE MATERIALS HANDLING', 'HY', '449172'], // CIK 1173514 HYSTER-YALE, INC., former EDGAR name until 2024-05-30
    ['IAC', 'PPLI', '44891N'], // CIK 1800227 People Inc, former EDGAR name until 2026-06-02
    ['IDENTIV', 'INVE', '45170X'], // CIK 1036044 INVE Technologies, Inc., former EDGAR name until 2026-08-25
    ['IRHYTHM TECHNOLOGIES', 'IRTC', '450056'], // CIK 1388658 iRhythm Holdings, Inc., former EDGAR name until 2026-01-12
    ['ISSUER DIRECT', 'ACCS', '46520M'], // CIK 843006 ACCESS Newswire Inc., former EDGAR name until 2025-01-16
    ['JANOVER', 'DFDV', '47100L'], // CIK 1805526 DeFi Development Corp., former EDGAR name until 2025-04-15
    ['JOHN BEAN TECHNOLOGIES', 'JBTM', '477839'], // CIK 1433660 JBT MAREL Corp, former EDGAR name until 2024-12-20
    ['LENDINGCLUB', 'HAPN', '52603A'], // CIK 1409970 Happen, Inc., former EDGAR name until 2026-06-18
    ['LIXTE BIOTECHNOLOGY HOLDINGS', 'NMAD', '539319'], // CIK 1335105 NOMAD POWER SOLUTIONS, INC., former EDGAR name until 2026-07-02
    ['MKS INSTRUMENTS', 'MKSI', '55306N'], // CIK 1049502 MKS INC, former EDGAR name until 2025-05-15
    ['MONTANA TECHNOLOGIES', 'AIRJ', '612160'], // CIK 1855474 AirJoule Technologies Corp., former EDGAR name until 2024-10-21
    ['MULTIPLAN', 'CTEV', '62548M'], // CIK 1793229 Claritev Corp, former EDGAR name until 2025-02-07
    ['NEWPARK RESOURCES', 'NPKI', '651718'], // CIK 71829 NPK International Inc., former EDGAR name until 2024-12-03
    ['ONCOLOGY INSTITUTE', 'STLN', '68236X'], // CIK 1799191 Starling Oncology, Inc., former EDGAR name until 2026-08-03
    ['OREILLY AUTOMOTIVE', 'ORLY', '67103H'], // CIK 898173 O REILLY AUTOMOTIVE INC, former EDGAR name until 1998-04-10
    ['ORION OFFICE REIT', 'ONL', '68629Y'], // CIK 1873923 Orion Properties Inc., former EDGAR name until 2025-03-07
    ['PALTALK', 'IPM', '69764K'], // CIK 1355839 INTELLIGENT PROTECTION MANAGEMENT CORP., former EDGAR name until 2025-01-02
    ['PARAMOUNT SKYDANCE', 'SKYD', '69932A'], // CIK 2041610 Skydance Corp, former EDGAR name until 2026-10-06
    ['PIEDMONT OFFICE REALTY TRUST', 'PDM', '720190'], // CIK 1042776 Piedmont Realty Trust, Inc., former EDGAR name until 2025-06-02
    ['PIERIS PHARMACEUTICALS', 'PVLA', '697947'], // CIK 1583648 PALVELLA THERAPEUTICS, INC., former EDGAR name until 2024-12-12
    ['PLUS THERAPEUTICS', 'CNSY', '72941H'], // CIK 1095981 CERENOME, INC., former EDGAR name until 2026-07-01
    ['RUMBLE', 'RUM', '78137L'], // CIK 1830081 RUM Group Inc., former EDGAR name until 2026-06-17
    ['SCHWEITZER MAUDUIT INTERNATIONAL', 'MATV', '808541'], // CIK 1000623 Mativ Holdings, Inc., former EDGAR name until 2022-07-01
    ['SEQLL', 'CIRC', '048592'], // CIK 1605888 CIRCLE8 GROUP INC, former EDGAR name until 2024-06-06
    ['SHOE CARNIVAL', 'SHOE', '824889'], // CIK 895447 SHOE STATION GROUP INC, former EDGAR name until 2026-06-11
    ['TANGER FACTORY OUTLET CENTERS', 'SKT', '875465'], // CIK 899715 TANGER INC., former EDGAR name until 2023-11-15
    ['TECNOGLASS', 'TGLS', '87877F'], // CIK 1534675 Tecnoglass Holdings Inc., former EDGAR name until 2026-07-07
    ['TEMPUR SEALY INTERNATIONAL', 'SGI', '88023U'], // CIK 1206264 SOMNIGROUP INTERNATIONAL INC., former EDGAR name until 2025-02-14
    ['TEVOGEN BIO HOLDINGS', 'TVGN', '88165K'], // CIK 1860871 Tevogen Inc., former EDGAR name until 2026-07-30
    ['TORO COMBINECO', 'TTGT', '87874R'], // CIK 2018064 TechTarget, Inc., former EDGAR name until 2024-11-20
    ['VIAD', 'PRSU', '92552R'], // CIK 884219 Pursuit Attractions & Hospitality, Inc., former EDGAR name until 2024-12-31
    ['WELLGISTICS HEALTH', 'MEDS', '949503'], // CIK 2030763 DataMeds AI, Inc., former EDGAR name until 2026-07-21
    ['ZOOM VIDEO COMMUNICATIONS', 'ZM', '98980L'], // CIK 1585521 Zoom Communications, Inc., former EDGAR name until 2024-11-12
    ['ZYMEWORKS DELAWARE', 'ZYME', '98985Y'], // CIK 1937653 Zymeworks Inc., former EDGAR name until 2022-10-13
  ];
}

/** Nasdaq Trader symbol directories: Nasdaq listings, and NYSE, NYSE American, NYSE Arca, Cboe and IEX listings. */
export function nportUsListingsUrls(): string[] {
  return ['https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'];
}

/**
 * The Nasdaq Trader symbol directories (the texts of `nportUsListingsUrls()`, in any order) as U.S.-listed symbol -> security
 * name; test issues and ETFs left out, CQS class dots as SEC dashes (`BRK.B` -> `BRK-B`). An issuer listed under several
 * symbols (Liberty Global LBTYA, LBTYB, LBTYK) also gets the entry `\u0000<name key>` -> its symbols, which `nportUsListed` reads
 * to require the share class. null unless every text is a whole directory (a header with Security Name and the File Creation
 * Time footer), so a failed or cut download changes nothing.
 */
export function parseUsListings(texts: ReadonlyArray<string>): Map<string, string> | null {
  const listings = new Map<string, string>();
  if (!texts.length) return null;
  for (let t = 0; t < texts.length; t++) {
    const lines = String(texts[t] === null || texts[t] === undefined ? '' : texts[t]).split(/\r?\n/).filter((line) => line.trim());
    const header = (lines[0] || '').split('|').map((cell) => cell.trim().toUpperCase());
    const nameAt = header.indexOf('SECURITY NAME'), testAt = header.indexOf('TEST ISSUE'), etfAt = header.indexOf('ETF');
    if (nameAt < 0 || !/^FILE CREATION TIME/i.test(lines[lines.length - 1] || '')) return null;
    for (let i = 1; i < lines.length - 1; i++) {
      const cells = lines[i].split('|');
      const symbol = String(cells[0] || '').trim().toUpperCase().replace(/[./ ]/g, '-');
      if (!symbol || String(cells[testAt] || '').trim() === 'Y' || String(cells[etfAt] || '').trim() === 'Y' || listings.has(symbol)) continue;
      listings.set(symbol, String(cells[nameAt] || '').trim());
    }
  }
  const issuers = new Map<string, string[]>();
  const loose = new Map<string, string[]>();
  listings.forEach((name, symbol) => {
    const key = nportNameKey(nportIssuerName(name));
    if (key) issuers.set(key, (issuers.get(key) || []).concat(symbol));
    const looseKey = nportLooseKey(nportIssuerName(name));
    if (looseKey && nportListedCommon(name)) loose.set(looseKey, (loose.get(looseKey) || []).concat(symbol));
  });
  issuers.forEach((symbols, key) => { if (symbols.length > 1) listings.set(`\u0000${key}`, symbols.join(' ')); });
  loose.forEach((symbols, looseKey) => listings.set(`\u0001${looseKey}`, symbols.join(' ')));
  return listings;
}

/** Is a symbol directory security name a company's own common or ordinary shares (not preferred, depositary, notes, warrants, units, rights)? */
function nportListedCommon(name: string): boolean {
  return !/\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b|\bPREFERRED\b|\bPREF\b|\bPFD\b|\bNOTES?\b|\bDEBENTURES?\b|\bWARRANTS?\b|\bUNITS?\b|\bRIGHTS?\b|%|\bDUE\s+\d{4}\b|\bPERPETUAL\b|\bCUMULATIVE\b|\bSUBORDINATED\b|\bTRUST\s+(?:SECURITIES|CERTIFICATES)\b|\bETNS?\b|\bEXCHANGE[- ]TRADED\b/i.test(name);
}

/** The share class a name or title states (`Class C`, `CL C`, `Series A`, `LIBERTY GLOBAL-C`), '' for none. */
function nportShareClass(...texts: unknown[]): string {
  for (let i = 0; i < texts.length; i++) {
    const text = String(texts[i] === null || texts[i] === undefined ? '' : texts[i]);
    const match = /\b(?:CLASS|CL|SERIES|SER)\.?\s+([A-Z])\b/i.exec(text) || /[A-Z]-\s?([A-Z])(?:\s|$)/i.exec(text);
    if (match) return match[1].toUpperCase();
  }
  return '';
}

/** Both symbol directories through the brand's `getText`, null when one fails (`parseUsListings`); load once per run. */
export async function readUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  try {
    return parseUsListings(await Promise.all(nportUsListingsUrls().map((url) => getText(url, `Nasdaq Trader ${url.replace(/^.*\//, '')}`))));
  } catch {
    return null;
  }
}

/** A security or sheet name without its share description: `Accenture plc Class A Ordinary Shares (Ireland)` -> `Accenture plc`. */
function nportIssuerName(value: unknown): string {
  return String(value === null || value === undefined ? '' : value).split(' - ')[0]
    .replace(/\s+(?:\(|(?:CLASS|SERIES)\s+[A-Z]\b|COMMON\b|ORDINARY\b|SUBORDINATE\b|SUB\.?\s+VOT|(?:LIMITED|RESTRICTED)\s+VOTING\b|VOTING\b|SHARES?\b|STOCK\b|AMERICAN\s+DEPOSITARY\b|TRADING\s+UNDER\b)[\s\S]*$/i, '');
}

/**
 * Is `ticker` the company's own U.S. listing? The Nasdaq Trader directories (`parseUsListings`) list it under the same company
 * (same name key, or one key the start of the other: `BUNGE GLOBAL` and the directory's `BUNGE`, a name cut short after two words
 * or more: `CHECK POINT SOFTWARE TECH`), and not as depositary or New York registry shares, which are another security than
 * the foreign line (Shell's SHEL ADR, ASML's New York shares). When the issuer has several listed classes, the name or title
 * must state the listed class (Liberty Latin America Class C is LILAK, not LILA). False without listings. Callers check that
 * the line trades in U.S. dollars: a Toronto or London line of the same company in its own currency never gets the U.S. ticker.
 */
export function nportUsListed(listings: Map<string, string> | null, ticker: string, name: unknown, title: unknown = ''): boolean {
  if (!listings) return false;
  const listed = listings.get(String(ticker).trim().toUpperCase().replace(/[./ ]/g, '-'));
  if (listed === undefined || /\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b/i.test(listed)) return false;
  const a = nportNameKey(nportIssuerName(listed)), b = nportNameKey(nportIssuerName(name));
  if (!a || !b) return false;
  const short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
  if (a !== b && !(short.length >= 4 && long.indexOf(`${short} `) === 0) && !(short.split(' ').length >= 2 && long.indexOf(short) === 0)) return false;
  const listedClass = nportShareClass(listed);
  return !listedClass || !listings.has(`\u0000${a}`) || nportShareClass(name, title) === listedClass;
}

/**
 * Exchange tickers for the positions, in their order ('' for none). A ticker is given only to a common-stock row (assetCat
 * EC; a preferred EP, a CVR, right, warrant or escrow line gets none, a name match would give it the issuer's common ticker):
 * - U.S. ISIN or none, traded in USD (or with no currency): the filer's own `<ticker value>`, else the SEC issuer-name table
 *   (`names`) when the row has a CUSIP or a U.S. ISIN, else a renamed issuer (`nportRenamedIssuers`)
 * - foreign ISIN (Linde IE, NXP NL, IMAX CA): only traded in USD and only when the symbol directories (`listings`,
 *   `parseUsListings`) confirm the filer's or the name-matched ticker for the same company (`nportUsListed`); a local line in
 *   another currency, and every foreign row without listings, gets none
 * A ticker that lands on two different securities (Alphabet A and C, an ordinary share and its ADR) is dropped from the
 * name-matched rows; when the filer itself gave it to two securities it is dropped from all of them. Rows still without a
 * ticker get the second, looser name match (`nportLooseTickers`), which never changes a ticker given here. Bonds, cash, funds
 * and derivatives stay identifier-keyed.
 */
export function nportTickers(positions: ReadonlyArray<NportPosition>, names: Map<string, string> | null = null, listings: Map<string, string> | null = null): string[] {
  const fromFiler: boolean[] = [];
  const secTickers = new Set<string>();
  if (names) names.forEach((ticker, key) => { if (key.charAt(0) !== '\u0001') secTickers.add(ticker); });
  const renames = nportRenamedIssuers();
  const renamed = (position: NportPosition, key: string): string => {
    const issuer = (position.cusip || (/^US[0-9A-Z]{10}$/.test(position.isin) ? position.isin.slice(2, 11) : '')).slice(0, 6);
    const hit = renames.filter((entry) => entry[0] === key && entry[2] === issuer && secTickers.has(entry[1]))[0];
    return hit ? hit[1] : '';
  };
  const tickers = positions.map((position, index) => {
    fromFiler[index] = false;
    const equity = position.assetCat === 'EC' && !position.derivative && !nportIsRight(position);
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    const usd = foreign ? position.currency === 'USD' && Boolean(listings) : !position.currency || position.currency === 'USD';
    if (!equity || !usd) return '';
    const filer = /^[A-Z][A-Z0-9.-]{0,9}$/.test(position.ticker) ? position.ticker : '';
    const key = nportNameKey(position.name);
    const named = names && (/^[0-9A-Z]{9}$/.test(position.cusip) || /^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) ? names.get(key) || names.get(key.replace(/ CL [A-Z]$/, '')) || '' : '';
    if (!foreign) {
      fromFiler[index] = Boolean(filer);
      return filer || named || (names ? renamed(position, key) : '');
    }
    if (filer && nportUsListed(listings, filer, position.name, position.title)) {
      fromFiler[index] = true;
      return filer;
    }
    return named && nportUsListed(listings, named, position.name, position.title) ? named : '';
  });
  const securities = new Map<string, { keys: string[]; filer: string[] }>();
  tickers.forEach((ticker, index) => {
    if (!ticker) return;
    const position = positions[index];
    const key = position.cusip || position.isin || position.other || nportNameKey(position.name);
    const seen = securities.get(ticker) || { keys: [], filer: [] };
    if (seen.keys.indexOf(key) < 0) seen.keys.push(key);
    if (fromFiler[index] && seen.filer.indexOf(key) < 0) seen.filer.push(key);
    securities.set(ticker, seen);
  });
  const exact = tickers.map((ticker, index) => {
    const seen = ticker ? securities.get(ticker) : undefined;
    if (!seen || seen.keys.length < 2) return ticker;
    return seen.filer.length === 1 && fromFiler[index] ? ticker : '';
  });
  return nportLooseTickers(positions, exact, names, listings);
}

/**
 * The second name match (open-items etfs Q35) for the common-stock rows `nportTickers` left without a ticker; the tickers it
 * already gave never change. The row's loose key (`nportLooseKey`) must name one company: in the SEC table (`\u0001` entries of
 * `parseSecCompanyNames`, one CIK) and/or in the symbol directories (`\u0001` entries of `parseUsListings`, common shares only),
 * and when both know the key they must agree on the company. Of that company's tickers only its listed common shares count
 * (with one SEC ticker and no listing, that ticker); several of them (Fox, Lennar, Zillow) need the class the row states in its
 * name or title, matched to the listed security name, else no ticker. A foreign ISIN needs the directory listing of the same
 * key (its own U.S. shares, never depositary ones). A ticker that a row of `exact` holds for another security, or that this pass
 * finds for two securities, is dropped.
 */
function nportLooseTickers(positions: ReadonlyArray<NportPosition>, exact: string[], names: Map<string, string> | null, listings: Map<string, string> | null): string[] {
  if (!names) return exact;
  const companyOf = new Map<string, string>();
  names.forEach((tickers, key) => { if (key.charAt(0) === '\u0001' && tickers) tickers.split(' ').forEach((ticker) => companyOf.set(ticker, key)); });
  const securityOf = (position: NportPosition): string => position.cusip || position.isin || position.other || nportNameKey(position.name);
  const listedClass = (symbol: string): string => nportShareClass(listings ? listings.get(symbol) : '');
  const found = positions.map((position, index) => {
    if (exact[index] || position.assetCat !== 'EC' || position.derivative || nportIsRight(position)) return '';
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    if (foreign ? position.currency !== 'USD' || !listings : position.currency && position.currency !== 'USD') return '';
    if (!/^[0-9A-Z]{9}$/.test(position.cusip) && !/^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) return '';
    const key = nportLooseKey(position.name);
    if (!key) return '';
    const sec = names.get(`\u0001${key}`);
    const listed = listings ? listings.get(`\u0001${key}`) : undefined;
    if (sec === '' || (sec === undefined && listed === undefined) || (foreign && !listed)) return '';
    const listedSymbols = listed ? listed.split(' ') : [];
    // the company: the SEC entry of the key, else the one SEC entry every listed symbol of the key belongs to
    const company = sec !== undefined ? `\u0001${key}` : companyOf.get(listedSymbols[0]) || '';
    if (!company || listedSymbols.some((symbol) => companyOf.get(symbol) !== company)) return '';
    const tickers = String(names.get(company) || '').split(' ').filter(Boolean);
    const common = tickers.filter((ticker) => listings && listings.has(ticker) && nportListedCommon(String(listings.get(ticker))));
    const candidates = common.length ? common : tickers.length === 1 && !foreign ? tickers : [];
    if (foreign && candidates.some((ticker) => listedSymbols.indexOf(ticker) < 0)) return '';
    const wanted = nportShareClass(position.name, position.title);
    if (candidates.length === 1) return !wanted || !listings || !listings.has(candidates[0]) || !listedClass(candidates[0]) || listedClass(candidates[0]) === wanted ? candidates[0] : '';
    const classed = wanted ? candidates.filter((ticker) => listedClass(ticker) === wanted) : [];
    return classed.length === 1 ? classed[0] : '';
  });
  const taken = new Map<string, string[]>();
  exact.forEach((ticker, index) => { if (ticker) taken.set(ticker, (taken.get(ticker) || []).concat(securityOf(positions[index]))); });
  found.forEach((ticker, index) => {
    if (!ticker) return;
    const seen = taken.get(ticker) || [];
    if (seen.indexOf(securityOf(positions[index])) < 0) taken.set(ticker, seen.concat(securityOf(positions[index])));
  });
  return exact.map((ticker, index) => ticker || (found[index] && (taken.get(found[index]) || []).length === 1 ? found[index] : ''));
}

/** The browse-edgar Atom feed of one series' NPORT-P filings. */
export function nportSeriesFeedUrl(seriesId: string, count = 10): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(String(seriesId).toUpperCase())}&type=NPORT-P&dateb=&owner=include&count=${count}&output=atom`;
}

/** The registrant's submissions JSON (report periods of its recent filings). */
export function nportSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${`0000000000${Number(String(cik).replace(/\D/g, '')) || 0}`.slice(-10)}.json`;
}

/** primary_doc.xml of a filing in the registrant's own folder. Throws without a registrant CIK: the accession prefix is the filer agent. */
export function nportDocumentUrl(registrantCik: string, accession: string): string {
  const cik = Number(String(registrantCik).replace(/\D/g, ''));
  if (!cik) throw new Error(`N-PORT ${accession}: no registrant CIK (the accession prefix is the filer agent, never used as the folder)`);
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

/** NPORT-P entries of a browse-edgar Atom feed (amendments and other forms skipped), with the registrant CIK of the filing link. */
export function parseNportFeed(atom: string): NportCandidate[] {
  const out: NportCandidate[] = [];
  const entries = /<entry>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entries.exec(String(atom === null || atom === undefined ? '' : atom))) !== null) {
    const body = entry[1];
    const form = (nportTag(body, 'filing-type') || nportAttr(body, 'category', 'term')).toUpperCase();
    const accession = nportTag(body, 'accession-number');
    if (form !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const folder = /\/Archives\/edgar\/data\/(\d+)\//i.exec(nportTag(body, 'filing-href'));
    out.push({ accession, filed: nportIso(nportTag(body, 'filing-date')), period: nportIso(nportTag(body, 'period')), cik: folder ? folder[1] : '' });
  }
  return out;
}

/** NPORT-P filings of a registrant's submissions JSON (`filings.recent`), with report periods; the registrant is the JSON's own CIK. */
export function parseNportSubmissions(payload: unknown): NportCandidate[] {
  const record = (payload && typeof payload === 'object' ? payload : {}) as { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = record.filings && record.filings.recent ? record.filings.recent : {};
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const forms = column('form'), accessions = column('accessionNumber'), filed = column('filingDate'), periods = column('reportDate');
  const cik = String(record.cik === null || record.cik === undefined ? '' : record.cik).replace(/\D/g, '');
  const out: NportCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const accession = String(accessions[i] === null || accessions[i] === undefined ? '' : accessions[i]);
    if (String(forms[i]).toUpperCase() !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession, filed: nportIso(filed[i]), period: nportIso(periods[i]), cik });
  }
  return out;
}

/**
 * Candidates newest report period first, then newest filing: a late filing for an older period never wins. A missing
 * period is taken from `known` (the registrant's submissions) by accession; candidates still without one go last.
 */
export function nportNewestFirst(candidates: ReadonlyArray<NportCandidate>, known: ReadonlyArray<NportCandidate> = []): NportCandidate[] {
  const periods = new Map<string, string>();
  for (let i = 0; i < known.length; i++) if (known[i].period) periods.set(known[i].accession, known[i].period);
  return candidates
    .map((candidate) => (candidate.period ? candidate : { ...candidate, period: periods.get(candidate.accession) || '' }))
    .sort((a, b) => (a.period && b.period ? b.period.localeCompare(a.period) : a.period ? -1 : b.period ? 1 : 0) || b.filed.localeCompare(a.filed));
}

/**
 * Does the filing belong to the fund? With a series id: only the same series id. Without one: the normalized series name
 * equals the fund name, or (`loose`, reported to the caller) one contains the other. Returns the problem, or null.
 */
export function nportIdentity(filing: Pick<NportFiling, 'seriesId' | 'seriesName'>, fund: { seriesId?: string | null; name?: string | null }): { problem: string | null; loose: boolean } {
  const wantedSeries = String(fund.seriesId || '').trim().toUpperCase();
  if (wantedSeries) return { problem: filing.seriesId === wantedSeries ? null : `names series ${filing.seriesId || 'none'}, not ${wantedSeries}`, loose: false };
  const filed = nportNameKey(filing.seriesName), wanted = nportNameKey(fund.name);
  if (!filed || !wanted) return { problem: 'no series id and no fund name to match', loose: false };
  if (filed === wanted) return { problem: null, loose: false };
  if (filed.indexOf(wanted) >= 0 || wanted.indexOf(filed) >= 0) return { problem: null, loose: true };
  return { problem: `names series "${filing.seriesName}", not "${String(fund.name)}"`, loose: false };
}

/**
 * May a filing replace the published holdings? Nothing published (no rows): any dated or undated report. Otherwise only a
 * report period strictly newer than the published holdings date; both must be ISO dates (convert the brand's display
 * date first), an unknown date on either side keeps the published sheet.
 */
export function nportIsFresh(repPdDate: unknown, publishedAsOf: unknown, publishedRows: unknown): boolean {
  if (!(Number(publishedRows) > 0)) return true;
  const report = nportIso(repPdDate), published = nportIso(publishedAsOf);
  return Boolean(report && published && String(publishedAsOf).trim().length === 10 && report > published);
}

export type NportRead = { filing: NportFiling; candidate: NportCandidate; url: string; loose: boolean } | { problem: string };

/**
 * The newest N-PORT-P filing of one fund, or why there is none. Candidates: the series' Atom feed (when a series id is known;
 * an empty feed means no filing yet) with periods from the registrant's submissions, else (no series id, or the feed failed)
 * the registrant's NPORT-P filings themselves; newest period first.
 * Documents are read until one passes the identity check (at most `maxDocuments`); that newest own filing is returned only
 * when it is fresh against the published holdings (`published.asOf` ISO, `published.rows`). Errors of the optional
 * submissions request are tolerated; others come back as `problem`. `cache` (one Map per run) keeps the submissions and
 * the parsed documents, so funds of one registrant share requests.
 */
export async function readNportHoldings(
  fund: { ticker: string; cik: string; seriesId?: string | null; name?: string | null },
  published: { asOf?: unknown; rows?: unknown },
  getText: (url: string, label: string) => Promise<string>,
  options: { maxDocuments?: number; cache?: Map<string, unknown> } = {},
): Promise<NportRead> {
  const cache = options.cache || new Map<string, unknown>();
  const once = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load().catch((error: unknown) => { cache.delete(key); throw error; }));
    return (await cache.get(key)) as T;
  };
  const cik = String(fund.cik || '').replace(/\D/g, '');
  if (!Number(cik)) return { problem: `${fund.ticker}: no registrant CIK` };
  let known: NportCandidate[] = [];
  try {
    known = await once(`submissions:${Number(cik)}`, async () => parseNportSubmissions(JSON.parse(await getText(nportSubmissionsUrl(cik), `${fund.ticker} N-PORT periods`))));
  } catch {
    known = [];
  }
  // null: no series feed (no series id, or the feed failed), so the registrant's own NPORT-P filings are scanned instead
  let candidates: NportCandidate[] | null = null;
  try {
    if (fund.seriesId) candidates = parseNportFeed(await getText(nportSeriesFeedUrl(fund.seriesId), `${fund.ticker} N-PORT filings`));
  } catch (error) {
    if (!known.length) return { problem: `${fund.ticker}: N-PORT filings unavailable (${error instanceof Error ? error.message : String(error)})` };
  }
  const sorted = nportNewestFirst(candidates || known, known);
  if (!sorted.length) return { problem: `${fund.ticker}: no NPORT-P filing yet` };
  const limit = Math.max(1, options.maxDocuments || (candidates ? 3 : 12));
  const misses: string[] = [];
  for (let i = 0; i < sorted.length && i < limit; i++) {
    const candidate = sorted[i];
    const url = nportDocumentUrl(Number(candidate.cik) ? candidate.cik : cik, candidate.accession);
    let filing: NportFiling;
    try {
      filing = await once(`document:${url}`, async () => parseNportFiling(await getText(url, `${fund.ticker} N-PORT ${candidate.accession}`)));
    } catch (error) {
      misses.push(`${candidate.accession} unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const identity = nportIdentity(filing, fund);
    if (identity.problem) {
      misses.push(`${candidate.accession} ${identity.problem}`);
      continue;
    }
    if (!filing.positions.length) return { problem: `${fund.ticker}: ${candidate.accession} has no positions` };
    if (!nportIsFresh(filing.repPdDate, published.asOf, published.rows)) return { problem: `${fund.ticker}: N-PORT ${filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published.asOf || 'undated')})` };
    return { filing, candidate, url, loose: identity.loose };
  }
  return { problem: `${fund.ticker}: no N-PORT-P filing of its own${misses.length ? `: ${misses.join('; ')}` : ''}` };
}
// </nport-reader>

// <calendar-dates> shared block of .claude/tools/etfs/etf-std/calendar-dates.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * A calendar date as ISO `YYYY-MM-DD`, or null. Pure text work, never `Date.parse` or local getters, so a run in Tokyo
 * publishes the same day as CI (open-items etfs ETF-H4). Accepts ISO (`2026-10-24`, with a time the date part is kept as
 * written), `2026/10/24`, U.S. `10/24/2026` and `10-24-26` (two-digit years up to 69 are 20xx), month names in either order
 * (`Oct 24, 2026`, `October 24 2026`, `Sept. 30, 2026`, `24 Oct 2026`, `24-Oct-26`), an optional weekday or `as of` in front.
 * A day that does not exist (`02/30/2026`) is null.
 */
export function calendarIso(value: unknown): string | null {
  const text = String(value === null || value === undefined ? '' : value).replace(/[\s ]+/g, ' ').trim()
    .replace(/^as of:? /i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  const year = (raw: string): number => (raw.length === 2 ? (Number(raw) <= 69 ? 2000 : 1900) + Number(raw) : Number(raw));
  const month = (raw: string): number => {
    const word = raw.toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < names.length; i++) if (word.length >= 3 && names[i].indexOf(word) === 0) return i + 1;
    return 0;
  };
  let y = 0, m = 0, d = 0, match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)) || (match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = Number(match[1]); d = Number(match[2]);
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(text))) {
    y = Number(match[3]); m = month(match[1]); d = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = month(match[2]); d = Number(match[1]);
  } else {
    return null;
  }
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/**
 * Is the fund at least `years` old on `asOf`? Calendar anniversary, inclusive: a fund started 2025-10-24 is one year old on
 * 2026-10-24 (a 29 February start on 1 March). Unknown or unreadable dates answer true, so a value is never dropped for want
 * of a date. The shared "younger than one year" rule: since-inception returns are annualized only from one year on.
 */
export function fundAgeAtLeast(inception: unknown, asOf: unknown, years: number): boolean {
  const start = calendarIso(inception), end = calendarIso(asOf);
  if (!start || !end) return true;
  return end >= `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
}

/**
 * The returns with every horizon the fund is too young for set to null: `horizons` maps a key of `returns` to the years it
 * needs (`{ yr1: 1, cagr3y: 3, siAnn: 1 }`). Keys that are absent or already null stay as they are; the object is copied.
 */
export function withoutYoungReturns<T extends object>(returns: T, inception: unknown, asOf: unknown, horizons: Record<string, number>): T {
  const out: Record<string, unknown> = { ...(returns as Record<string, unknown>) };
  const keys = Object.keys(horizons);
  for (let i = 0; i < keys.length; i++) {
    if (out[keys[i]] !== undefined && out[keys[i]] !== null && !fundAgeAtLeast(inception, asOf, horizons[keys[i]])) out[keys[i]] = null;
  }
  return out as T;
}
// </calendar-dates>

// <windowed-chart> shared block of .claude/tools/etfs/etf-std/windowed-chart.block.ts, applied by apply-block.ts: never edit it in one repo
export type WindowedChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };
export type WindowedChartDividend = { epoch: number; amount: number };

/**
 * A HISTORY_RANGE window (`period1` N years back) never shrinks the published history, and with it the 3y, 5y, 10y and
 * since-inception returns (open-items etfs Q25; was a byte-identical copy in Fidelity, Invesco and JPMorgan). The published
 * rows older than the first fresh day are put in front of the fresh days; their Adj Close is rescaled by the ratio measured on
 * the overlapping days (Yahoo re-adjusts the whole series after each distribution). Published distributions older than the
 * window are kept as well. Returns the chart unchanged when nothing published is older, and null when the window cannot be
 * joined safely (no overlap, Close changed, inconsistent or implausible ratio): the caller then keeps the fund as published.
 * `published` rows carry `Date` (any calendarIso form), `Close`, `Adj Close`, `Volume`; distribution rows are
 * [date, amount, ...] arrays. The chart's days must be sorted by ISO date.
 */
export function mergeWindowedChart<C extends { days: WindowedChartDay[]; dividends: WindowedChartDividend[] }>(chart: C, published: ReadonlyArray<Record<string, unknown>>, publishedDistributions: ReadonlyArray<unknown> = []): C | null {
  if (!chart.days.length || !published.length) return chart;
  const num = (value: unknown): number | null => {
    const text = String(value === null || value === undefined ? '' : value).replace(/[\s,$]/g, '');
    return text && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  const firstFresh = chart.days[0].date;
  const rows: Array<{ date: string; close: number; adjClose: number; volume: number }> = [];
  for (let i = 0; i < published.length; i++) {
    const date = calendarIso(published[i].Date), close = num(published[i].Close), adjClose = num(published[i]['Adj Close']);
    if (date && close !== null && adjClose !== null && adjClose > 0) rows.push({ date, close, adjClose, volume: num(published[i].Volume) || 0 });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const older = rows.filter((row) => row.date < firstFresh);
  if (!older.length) return chart;
  const byDate = new Map<string, { close: number; adjClose: number }>();
  for (let i = 0; i < rows.length; i++) byDate.set(rows[i].date, rows[i]);
  const adjRatios: number[] = [];
  const closeRatios: number[] = [];
  for (let i = 0; i < chart.days.length; i++) {
    const day = chart.days[i];
    const prior = byDate.get(day.date);
    if (!prior) continue;
    adjRatios.push((day.adjCloseRaw === undefined ? day.adjClose : day.adjCloseRaw) / prior.adjClose);
    if (prior.close > 0) closeRatios.push(day.close / prior.close);
  }
  if (!adjRatios.length) return null;
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  if (closeRatios.length && Math.abs(mean(closeRatios) - 1) > 1e-3) return null;
  if (Math.max.apply(null, adjRatios) / Math.min.apply(null, adjRatios) - 1 > 5e-3) return null;
  const measured = mean(adjRatios);
  if (measured < 0.5 || measured > 1.001) return null;
  const factor = Math.abs(measured - 1) < 1e-4 ? 1 : measured;
  const days: WindowedChartDay[] = older.map((row) => {
    const raw = row.adjClose * factor;
    return { date: row.date, close: row.close, adjClose: factor === 1 ? row.adjClose : Math.round(raw * 100) / 100, volume: row.volume, adjCloseRaw: raw };
  });
  const firstFreshEpoch = Date.UTC(Number(firstFresh.slice(0, 4)), Number(firstFresh.slice(5, 7)) - 1, Number(firstFresh.slice(8, 10))) / 1000;
  const kept: WindowedChartDividend[] = [];
  for (let i = 0; i < publishedDistributions.length; i++) {
    const cells = publishedDistributions[i];
    const date = Array.isArray(cells) ? calendarIso(cells[0]) : null;
    const amount = Array.isArray(cells) ? num(cells[1]) : null;
    if (!date || amount === null || amount <= 0) continue;
    const epoch = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1000;
    if (epoch < firstFreshEpoch) kept.push({ epoch, amount });
  }
  kept.sort((a, b) => a.epoch - b.epoch);
  return { ...chart, days: days.concat(chart.days), dividends: kept.concat(chart.dividends.filter((dividend) => dividend.epoch >= firstFreshEpoch)) };
}
// </windowed-chart>

// <fund-selection> shared block of .claude/tools/etfs/etf-std/fund-selection.block.ts, applied by apply-block.ts: never edit it in one repo
/** An index row as far as these helpers read it: the ticker and whether it has published data (`dataFile`, null for a catalog-only row). */
export type FundSelectionRow = { ticker?: unknown; dataFile?: unknown };

function fundSelectionTicker(row: FundSelectionRow): string {
  return String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
}

/**
 * The tickers a TICKERS entry may name: the live catalog plus every fund with published data (closed funds included). When
 * the live catalog could not be read (`live` null) every previous index row counts, since nothing tells a real catalog-only
 * row from a stale one. A catalog-only row from an earlier mistyped TICKERS run is therefore not "known" (open-items etfs Q27).
 */
export function knownTickers(live: ReadonlyArray<string> | null, previous: ReadonlyArray<FundSelectionRow>): string[] {
  const out: string[] = [];
  const add = (ticker: string): void => { if (ticker && out.indexOf(ticker) < 0) out.push(ticker); };
  if (live) for (let i = 0; i < live.length; i++) add(String(live[i]).trim().toUpperCase());
  for (let i = 0; i < previous.length; i++) if (!live || previous[i].dataFile) add(fundSelectionTicker(previous[i]));
  return out;
}

/** Throws before any fund request when TICKERS names a fund outside `known` (see knownTickers): a clear error, nothing fetched or written. */
export function assertKnownTickers(selected: ReadonlyArray<string> | null, known: ReadonlyArray<string>, where: string): void {
  const unknown = (selected || []).map((ticker) => String(ticker).trim().toUpperCase()).filter((ticker) => ticker && known.indexOf(ticker) < 0);
  if (unknown.length) throw new Error(`TICKERS: ${unknown.join(', ')} not in ${where}; nothing was fetched or written`);
}

/**
 * The index rows without stale catalog-only rows: a row with no published data whose ticker the live catalog no longer lists
 * (an earlier mistyped TICKERS entry, a fund withdrawn before launch). Rows with data always stay; nothing is dropped when the
 * live catalog could not be read (`live` null).
 */
export function withoutStalePlaceholders<T extends FundSelectionRow>(rows: ReadonlyArray<T>, live: ReadonlyArray<string> | null): T[] {
  if (!live) return rows.slice();
  const listed = live.map((ticker) => String(ticker).trim().toUpperCase());
  return rows.filter((row) => Boolean(row.dataFile) || listed.indexOf(fundSelectionTicker(row)) >= 0);
}

/**
 * New funds of a run (open-items etfs Q28): `published` - first published in this run (the previous index had no row for it,
 * or only a catalog-only one), so a fund whose first read failed is announced when it finally succeeds; `pending` - new in the
 * catalog this run but not published yet. Nothing is reported on a first run (empty previous index).
 */
export function newFundsReport(previous: ReadonlyArray<FundSelectionRow>, next: ReadonlyArray<FundSelectionRow>): { published: string[]; pending: string[] } {
  const report = { published: [] as string[], pending: [] as string[] };
  if (!previous.length) return report;
  const before = new Map<string, boolean>();
  for (let i = 0; i < previous.length; i++) before.set(fundSelectionTicker(previous[i]), Boolean(previous[i].dataFile));
  for (let i = 0; i < next.length; i++) {
    const ticker = fundSelectionTicker(next[i]);
    if (!ticker || before.get(ticker)) continue;
    if (next[i].dataFile) report.published.push(ticker);
    else if (!before.has(ticker)) report.pending.push(ticker);
  }
  report.published.sort();
  report.pending.sort();
  return report;
}

/** The log and step-summary lines of a newFundsReport: `NEW FUNDS: A, B` and `NEW FUNDS (not published yet): C`; none when empty. */
export function newFundsLines(report: { published: ReadonlyArray<string>; pending: ReadonlyArray<string> }): string[] {
  const lines: string[] = [];
  if (report.published.length) lines.push(`NEW FUNDS: ${report.published.join(', ')}`);
  if (report.pending.length) lines.push(`NEW FUNDS (not published yet): ${report.pending.join(', ')}`);
  return lines;
}
// </fund-selection>

// <range-52w> shared block of .claude/tools/etfs/etf-std/range-52w.block.ts, applied by apply-block.ts: never edit it in one repo
export type Range52w = {
  week52Low: number | null; week52High: number | null; range52w: number | null; range52wClose: number | null; range52wAsOf: string | null;
  range52wSince: string | null; range52wBasis: string | null;
};

/**
 * The price columns of a history sheet, tried in this order: the market close first, NAV only when no market price is
 * published. A function, not a const: the block sits at the end of update-data.ts, after the top-level `await main()`.
 */
export function range52wColumns(): string[] {
  return ['Close', 'Market Price', 'NAV', 'NAV per Share'];
}

/** The seven `metrics` keys of the 52-week range, all null: a catalog-only row and a fund without history carry this. */
export function range52wEmpty(): Range52w {
  return { week52Low: null, week52High: null, range52w: null, range52wClose: null, range52wAsOf: null, range52wSince: null, range52wBasis: null };
}

/**
 * The 52-week range from the closes of a fund's published history sheet (owner, 2026-10-29: closes, not intraday highs and
 * lows; no extra requests). `headers` are the sheet headers, `rows` objects keyed by header or arrays in header order.
 * - Price column: the first of range52wColumns() with at least two numeric values (`$1,234.50` reads as 1234.5); the date
 *   column is `Date`, else `As Of`, else the first header. Dates go through calendarIso, so every published format works
 * - Window: the last dated close and every close up to 52 weeks (364 days) before it. `week52Low` and `week52High` are the
 *   lowest and highest close of the window, `range52w` the position of the last close between them in percent
 *   (0 = at the low, 100 = at the high, 2 decimals). The last close is part of the window, so it never falls outside;
 *   `range52wClose` and `range52wAsOf` are that close and its date (it can differ from the row's closePrice source)
 * - A fund with less than 52 weeks of history gets the range since its first published close, and `range52wSince` names
 *   that date (owner: "alternative" - the range since launch with a note); a full window has `range52wSince: null`
 * - `range52wBasis` names the column used. Fewer than two closes give range52wEmpty(); a flat window (high = low) keeps
 *   low and high but `range52w: null`, never a made-up 0 or 50
 */
export function range52wMetrics(headers: string[], rows: unknown[]): Range52w {
  const list = Array.isArray(headers) ? headers.map((h) => String(h)) : [];
  const dateHeader = list.indexOf('Date') >= 0 ? 'Date' : list.indexOf('As Of') >= 0 ? 'As Of' : list[0];
  const cell = (row: unknown, header: string): unknown => {
    if (Array.isArray(row)) return row[list.indexOf(header)];
    return row && typeof row === 'object' ? (row as Record<string, unknown>)[header] : undefined;
  };
  const price = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    const text = String(value === null || value === undefined ? '' : value).replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    return number > 0 ? number : null;
  };
  const all = Array.isArray(rows) ? rows : [], columns = range52wColumns();
  for (let c = 0; c < columns.length; c++) {
    const column = columns[c];
    if (list.indexOf(column) < 0 || !dateHeader) continue;
    const points: Array<{ date: string; close: number }> = [];
    for (let i = 0; i < all.length; i++) {
      const date = calendarIso(cell(all[i], dateHeader)), close = price(cell(all[i], column));
      if (date && close !== null) points.push({ date, close });
    }
    if (points.length < 2) continue;
    points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = points[points.length - 1];
    const end = Date.UTC(Number(last.date.slice(0, 4)), Number(last.date.slice(5, 7)) - 1, Number(last.date.slice(8, 10)));
    const start = new Date(end - 364 * 86400000).toISOString().slice(0, 10);
    const window = points.filter((p) => p.date >= start);
    if (window.length < 2) continue;
    let low = window[0].close, high = window[0].close;
    for (let i = 1; i < window.length; i++) { low = Math.min(low, window[i].close); high = Math.max(high, window[i].close); }
    const round = (value: number, digits: number): number => Number(value.toFixed(digits));
    return {
      week52Low: round(low, 4), week52High: round(high, 4),
      range52w: high > low ? round(((last.close - low) / (high - low)) * 100, 2) : null, range52wClose: round(last.close, 4), range52wAsOf: last.date,
      range52wSince: points[0].date > start ? points[0].date : null,
      range52wBasis: column,
    };
  }
  return range52wEmpty();
}
/**
 * The index rows with the five 52-week keys in every `metrics`, computed from each fund's published history pages
 * (`funds/<T>/history/*.json` under `feedRoot`, the folder of index.json). Call it on the final rows right before
 * index.json is written: updated, unchanged and kept funds all get the range of the history they publish, a row without
 * `dataFile` or without history pages gets range52wEmpty(). A row without a `metrics` object is left as it is. The seven
 * keys go in front of `returnsBasis` and `performanceAsOf`, so those two stay the last keys of `metrics`.
 */
export async function withRange52w<T>(feedRoot: URL | string, funds: T[]): Promise<T[]> {
  const fs = await import('node:fs/promises');
  const { pathToFileURL } = await import('node:url');
  const root = feedRoot instanceof URL ? new URL(feedRoot.href.replace(/\/?$/, '/')) : new URL(pathToFileURL(String(feedRoot).replace(/\/?$/, '/')).href); // global URL, also with older @types/node (Amplify)
  const out: T[] = [];
  for (const fund of Array.isArray(funds) ? funds : []) {
    const row = fund as unknown as Record<string, unknown>;
    if (!row || typeof row !== 'object' || !row.metrics || typeof row.metrics !== 'object') { out.push(fund); continue; }
    let range = range52wEmpty();
    const dataFile = typeof row.dataFile === 'string' ? row.dataFile : '';
    if (dataFile) {
      const dir = new URL(`${dataFile.replace(/^\.\//, '').replace(/[^/]*$/, '')}history/`, root);
      const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => /\.json$/.test(name)).sort();
      let headers: string[] = [];
      const rows: unknown[] = [];
      for (const name of names) {
        const page = await fs.readFile(new URL(name, dir), 'utf8').then((text) => JSON.parse(text)).catch(() => null);
        if (!page || !Array.isArray(page.rows)) continue;
        if (!headers.length && Array.isArray(page.headers)) headers = page.headers;
        for (const item of page.rows) rows.push(item);
      }
      range = range52wMetrics(headers, rows);
    }
    // the range keys go in front of returnsBasis and performanceAsOf, which stay the last two keys (metrics contract)
    const metrics: Record<string, unknown> = {}, old = row.metrics as Record<string, unknown>, tail = ['returnsBasis', 'performanceAsOf'];
    for (const key of Object.keys(old)) if (tail.indexOf(key) < 0 && !(key in range)) metrics[key] = old[key];
    Object.assign(metrics, range);
    for (const key of tail) if (key in old) metrics[key] = old[key];
    out.push({ ...row, metrics } as unknown as T);
  }
  return out;
}
// </range-52w>
