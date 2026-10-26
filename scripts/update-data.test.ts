/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ADJ_CLOSE_NOISE,
  CLOSED_FUNDS,
  CONTROL_NAMES,
  closedFund,
  keptAdjClose,
  PREMIUM_COMPUTED_SOURCE,
  asOfFromKind,
  computePremiumDiscount,
  officialDividendYield,
  parseDistributionRate,
  retainPublishedSections,
  FETCH_TIMEOUT_MS,
  RETURNS_BASIS,
  annualizedToTotal,
  buildMetrics,
  checkNportFiling,
  dividendYieldBasisFromKind,
  DIVIDEND_YIELD_BASES,
  OFFICIAL_12M_YIELD_KIND,
  cleanFundName,
  configurePacing,
  createRequestGate,
  fetchText,
  frequencyCodeLabel,
  fundNameFromPageSlug,
  holdingsGuard,
  inferDistributionFrequency,
  installSystemCa,
  isCertError,
  isHistoryRange,
  main,
  normalizeDistributionFrequency,
  normalizeNumberText,
  numberOrNull,
  parseAumRange,
  parseCatalogText,
  parseChart,
  parseConfig,
  parseEdgarAtomFilings,
  parseFranklinHoldings,
  parseFundTickerMap,
  parseCompanyTickerMap,
  fillNportTickers,
  parseNport,
  parsePerformanceAsOf,
  parseProductPage,
  parseSharePrices,
  stripFootnoteMarkers,
  toTextLines,
  parseRange,
  parseRanges,
  paymentsPerYearFor,
  placeholderFund,
  plausibleBenchmark,
  plausibleDividendYield,
  plausibleNav,
  plausiblePremiumDiscount,
  plausibleSecYield,
  previousTer,
  resolveCategory,
  resolveControls,
  resolveFundName,
  resetSecCachesForTest,
  nportIsNewer,
  resolvePerformanceAsOf,
  runtimeControls,
  setApiRootForTest,
  setClockForTest,
  setSoftDeadline,
  stableAumAsOf,
  publishedAsOf,
  stalestFirst,
  stripProxyPreamble,
  tenYearEligible,
  toIsoDate,
  totalToAnnualized,
  userAgentFor,
  yahooChartUrl,
} from './update-data';

const realFetch = globalThis.fetch;
const realLog = console.log;
const realWarn = console.warn;
const realEnv = { ...process.env };
const brandAliases = ['HISTORICAL_PAGE_SIZE', 'GITHUB_STEP_SUMMARY'];

// Clean, pinned environment for every test: no exported control variables, fixed time zone
beforeEach(() => {
  for (const name of [...CONTROL_NAMES, ...brandAliases]) delete process.env[name];
  process.env.TZ = 'UTC';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setSoftDeadline(25 * 60_000);
  setClockForTest();
  console.log = realLog;
  console.warn = realWarn;
  process.exitCode = 0;
  for (const name of Object.keys(process.env)) if (!(name in realEnv)) delete process.env[name];
  Object.assign(process.env, realEnv);
});

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = () => JSON.parse(read('scripts/update-data.config.json'));
const noReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const fundUrl = (id: number, slug: string, ticker: string) => `https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/${id}/SINGLCLASS/${slug}/${ticker}`;

/** Fake clock: sleeping only advances virtual time, so retry backoff and the 3.2 s proxy gate cost nothing. */
const fakeClock = () => {
  let t = Date.UTC(2026, 9, 3);
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
};

/**
 * A product page in the rendering proxy's markdown. Sections the proxy lazy-loads (Portfolio, Pricing) come back as
 * empty headings when `portfolio` / `pricing` are false: that is the partial page.
 */
const pageMd = (o: { portfolio?: boolean; pricing?: boolean; marketPrice?: boolean; secYield?: boolean; rate?: boolean; nav?: string } = {}) => {
  const { portfolio = true, pricing = true, marketPrice = true, secYield = true, rate = false, nav = '21.99' } = o;
  const note = '[1](https://www.franklintempleton.com/x#footnote_1)';
  return [
    'Title: Franklin FTSE Switzerland ETF - FLCH', '', 'Markdown Content:',
    '## Overview', '### Fund Facts', 'Benchmark FTSE Switzerland Capped Index-NR', 'Fund Inception Date 02/06/2018',
    ...(secYield ? [`30-Day SEC Yield[5](https://www.franklintempleton.com/x#footnote_5)As of 08/31/2026 (Updated Monthly)3.93%`] : []),
    ...(rate ? ['Distribution Rate at NAV[9](https://www.franklintempleton.com/x#footnote_9)As of 10/02/2026 (Updated Daily)1.18%'] : []),
    '### Expenses & Fees', 'Gross Expense Ratio', '0.19%', 'Net Expense Ratio', '0.19%',
    '### Identifiers', 'CUSIP Code', '35473P123', 'ISIN Code', 'US35473P1234',
    '### Average Annual Total Returns  As of 08/31/2026', '*    10.50%1 Year', '*    4.20%3 Years', '*    —5 Years', '*    —10 Years', '*    3.00%Since Inception',
    '## Portfolio',
    ...(portfolio ? ['### Assets', 'As of 10/02/2026  (Updated Daily)', 'Total Net Assets $53.87 Million', '### Holdings', 'As of 10/02/2026 (Updated Daily)',
      '| Security Name | Weight (%) | Market Value ($) | Notional Exposure | Quantity |', '| --- | --- | --- | --- | --- |',
      '| NESTLE SA | 60.00 | 10,000 | 0.00 | 100 |', '| NOVARTIS AG | 40.00 | 5,000 | 0.00 | 50 |'] : []),
    '## Distributions & Tax', '## Pricing',
    ...(pricing ? ['### Share Prices', 'As of 10/02/2026', `NAV${note}(Net Asset Value)$${nav}`, `NAV Change${note}$-0.02`, ...(marketPrice ? [`Market Price${note}$21.90`] : []), `Market Price Change${note}$-0.04`] : []),
    '## Documents', '## Important Information', 'The fund prospectus is current as of December 1, 2025.',
  ].join('\n');
};

describe('controls', () => {
  test('precedence is file < advanced < nonblank input < env; blanks and aliases behave', () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'FLIN' }, { CONCURRENCY: 3, TICKERS: 'FLGR' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '6' });
    expect(c.CONCURRENCY).toBe('6');
    expect(c.TICKERS).toBe('FLGR');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
    // a blank input inherits the file value, advanced may blank a key, an explicit env value wins even when false
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
    expect(resolveControls({ TICKERS: 'FLIN' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
    // brand alias, the canonical name wins
    expect(resolveControls({ HISTORY_PAGE_SIZE: '1000' }, {}, {}, { HISTORICAL_PAGE_SIZE: '500' }).HISTORY_PAGE_SIZE).toBe('500');
    expect(resolveControls({}, {}, {}, { HISTORY_PAGE_SIZE: '300', HISTORICAL_PAGE_SIZE: '500' }).HISTORY_PAGE_SIZE).toBe('300');
  });

  test('invalid values, unknown keys, non-scalars and CR/LF/NUL are errors, never silent fallbacks', () => {
    const bad = [
      { UNKNOWN: 1 }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' },
      { VERBOSE: 'maybe' }, { USE_SYSTEM_CA: 'maybe' }, { EDGAR_FALLBACK: 'sometimes' }, { HISTORY_RANGE: 'forever' }, { HISTORY_RANGE: '6mo' },
      { AUM: '1:2:3' }, { TER: '5:1' }, { PERFORMANCE_1Y: 'x:y' }, { TICKERS: ['FLIN'] }, { TICKERS: { a: 1 } },
      { SEC_UA: 'x\nEVIL=yes' }, { SEC_UA: 'x\rfoo' }, { SEC_UA: 'x\0bad' }, { TICKERS: 'A\nB' }, null, [],
    ];
    for (const value of bad) {
      expect(() => resolveControls(value)).toThrow();
      expect(() => resolveControls({}, value)).toThrow();
      expect(() => resolveControls({}, {}, value)).toThrow();
    }
    // env values are validated too (unknown env names are simply not read)
    for (const env of [{ CONCURRENCY: '0' }, { MAX_RETRIES: '0' }, { SEC_UA: 'x\0bad' }, { TICKERS: 'A\nB' }, { VERBOSE: 'maybe' }, { HISTORY_RANGE: 'forever' }]) {
      expect(() => resolveControls({}, {}, {}, env)).toThrow();
    }
    expect(() => resolveControls(file(), {}, {}, { HISTORY_RANGE: '6mo' })).toThrow();
    expect(() => resolveControls(file(), {}, {}, { USE_SYSTEM_CA: 'maybe' })).toThrow(/USE_SYSTEM_CA/);
  });

  test('accepted spellings are normalized', () => {
    expect(parseConfig(resolveControls(file(), {}, {}, { HISTORY_RANGE: '1Y' })).historyRange).toBe('1y');
    for (const mode of ['auto', 'true', 'false', 'AUTO', 'True', 'FALSE']) {
      expect(resolveControls(file(), {}, {}, { USE_SYSTEM_CA: mode }).USE_SYSTEM_CA).toBe(mode.toLowerCase());
    }
  });

  test('config file: keys equal CONTROL_NAMES, string values, scheduled run equals the defaults', async () => {
    const defaults = file();
    expect(Object.keys(defaults).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(defaults)) expect(typeof value).toBe('string');
    expect(CONTROL_NAMES.some((name) => /OUTPUT|DIR/.test(name))).toBe(false);
    expect(defaults.SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(defaults.USE_SYSTEM_CA).toBe('auto');
    const scheduled = resolveControls(defaults, {}, {});
    expect(scheduled).toEqual(defaults);
    expect(await runtimeControls({})).toEqual(scheduled);
    expect((await runtimeControls({ TICKERS: 'FLIN FLGR', SKIP_YAHOO: '1' })).TICKERS).toBe('FLIN FLGR');
    const config = parseConfig(scheduled);
    expect(config).toMatchObject({
      maxFetches: 0, requestSleep: 1.5, concurrency: 3, holdingsPageSize: 250, historyPageSize: 1000, maxRetries: 2,
      edgarFallback: true, skipYahoo: false, skipFranklin: false, storeRawDownloads: false, tickers: null, category: '', historyRange: 'max',
      performance: {}, totalReturn: {},
    });
    expect(config.aum).toBeUndefined();
    expect(read('scripts/update-data.ts')).toContain("new URL('../api/franklin/'");
  });

  test('range filters: colon forms, suffixes, presets and rejections', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseRange('1:5', 'X')).toEqual({ min: 1, max: 5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(parseRange(':3', 'X')).toEqual({ min: undefined, max: 3 });
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('$1:$2', 'X')).toEqual({ min: 1, max: 2 });
    expect(() => parseRange('15', 'X')).toThrow(/colon is required/);
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(parseRanges({ PERFORMANCE_YTD: ':', PERFORMANCE_1Y: ':', TOTAL_RETURN_1Y: ':' }, 'PERFORMANCE')).toEqual({});
    expect(parseAumRange('')).toBeUndefined();
    expect(parseAumRange(':')).toBeUndefined();
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('1B:')).toEqual({ min: 1_000_000_000, max: undefined });
    expect(parseAumRange('nano')).toEqual({ min: 0, max: 10_000_000 });
    expect(parseAumRange('large')).toEqual({ min: 10_000_000_000, max: undefined });
    expect(() => parseAumRange('invalid:1B')).toThrow();
  });
});

describe('parsing', () => {
  const catalog = `
Title: Exchange Traded Funds | Franklin Templeton

Markdown Content:
| Checkbox | [BrandywineGLOBAL - U.S. Fixed Income ETF  \\- **USFI**](${fundUrl(36405, 'brandywine-global-u-s-fixed-income-etf', 'USFI')}) | -0.40% | 3.47 | 4.19 | — | 3.54<br>07/25/2023 | Gross<br>Net<br>0.39% <br>0.39% | $9.53 Million | Download |
| Checkbox | [Franklin FTSE India ETF  \\- **FLIN**](${fundUrl(26348, 'franklin-ftse-india-etf', 'FLIN')}) | -10.39% | -3.94 | 5.33 | 3.05 | 5.93<br>02/06/2018 | Gross<br>Net<br>0.19% <br>0.19% | $2.60 Billion | Download |
| Checkbox | [Franklin FTSE Japan ETF  \\- **FLJP**](${fundUrl(26357, 'franklin-ftse-japan-etf', 'FLJP')}) | 20.28% | 26.80 | 19.32 | 9.79 | 8.08<br>11/02/2017 | Gross<br>Net<br>0.09% <br>0.09% | $4.04 Billion | Download |
`;
  const fltwPage = `
# FLTW  Franklin FTSE Taiwan ETF
NAV  $0.42(0.38%)
$110.52
As of 09/23/2026
YTD Total Returns At NAV [1]
81.22%
As of 09/23/2026
Total Net Assets
$4.16B
As of 09/23/2026 (Updated Daily)
Fund Inception Date11/02/2017
Listing ExchangeNYSE Arca
Gross Expense Ratio
0.19%
Net Expense Ratio
0.19%
CUSIP Code
35473P686
ISIN Code
US35473P6869
Market Price Return
NAV Return
- 96.86%1 Year
- 44.10%3 Years
- 20.96%5 Years
- —10 Years
- 19.77%Since Inception
`;

  test('catalog rows: tickers, TER, assets, inception, returns; liquidation note; empty page throws', () => {
    const funds = parseCatalogText(catalog);
    expect(funds.map((f) => f.ticker).sort()).toEqual(['FLIN', 'FLJP', 'USFI']);
    const flin = funds.find((f) => f.ticker === 'FLIN')!;
    expect(flin.name).toContain('India');
    expect(flin).toMatchObject({ ter: 0.19, netAssets: 2.6e9, inception: '2018-02-06' });
    expect(flin.returns).toMatchObject({ ytd: -10.39, yr1: -3.94 });
    expect(funds.find((f) => f.ticker === 'USFI')).toMatchObject({ netAssets: 9.53e6, ter: 0.39 });

    const liquidation = `
| Checkbox | [Franklin FTSE Taiwan ETF  \\- **FLTW**](${fundUrl(26351, 'franklin-ftse-taiwan-etf', 'FLTW')})<br>Upcoming Liquidation <br>Upcoming Liquidation Click the fund name for more information.<br>**Click the fund name for more information.** | 81.22% | 95.62% | 43.94% | 21.04% | 19.77%<br>11/02/2017 | Gross<br>Net<br>0.19% <br>0.19% | $4.16 Billion | Download |
`;
    const [fltw, ...rest] = parseCatalogText(liquidation);
    expect(rest).toEqual([]);
    expect(fltw).toMatchObject({ ticker: 'FLTW', ter: 0.19, netAssets: 4.16e9 });
    expect(fltw.returns).toMatchObject({ ytd: 81.22, yr1: 95.62, yr3: 43.94, yr5: 21.04 });
    expect(() => parseCatalogText('no etfs here')).toThrow(/no ETF rows/);
  });

  test('product page: identifiers, fees, yields, NAV and the performance date', () => {
    const page = `
Title: FLIN Franklin FTSE India ETF - FLIN
Markdown Content:
# FLIN Franklin FTSE India ETF
Equity  Indexed
## Overview
Benchmark FTSE India Capped Index-NR
Fund Inception Date 02/06/2018
Listing Exchange NYSE Arca
Dividend Frequency, if any Semiannually
### Expenses & Fees
Gross Expense Ratio 0.19%
Net Expense Ratio 0.19%
### Identifiers
CUSIP Code 35473P769
ISIN Code US35473P7693
### Additional Fund Info
Morningstar Category India Equity
## Price
As of 09/23/2026
NAV $34.85
Market Price $34.82
## Distributions
Distribution Frequency Quarterly
SEC 30-Day Yield 2.09%
12-Month Yield 0.42%
`;
    expect(parseProductPage(page, 'FLIN')).toMatchObject({
      cusip: '35473P769', isin: 'US35473P7693', totalExpenseRatio: 0.19, inception: '2018-02-06', morningstarCategory: 'India Equity',
      secYield: 2.09, distributionYield: 0.42, nav: 34.85, marketPrice: 34.82,
    });
    expect(parseProductPage(page, 'FLIN').exchange).toContain('NYSE');
    expect(parseProductPage(page, 'FLIN').distributionFrequency).toContain('Quarterly');
    expect(parseProductPage('# BUYZ  Franklin Disruptive Commerce ETF\n### Average Annual Total Returns  As of 08/31/2026\n- -14.61%1 Year\n- 11.85%3 Years\n', 'BUYZ').performanceAsOf).toBe('2026-08-31');
    // the 30 of "SEC 30-Day Yield" never becomes the yield
    expect(parseProductPage('# EZET Franklin Ethereum ETF\n## Distributions\n| SEC 30-Day Yield | |\n| 30-Day Yield as of 08/31/2026 | — |\n', 'EZET').secYield).toBeNull();
  });

  test('product page returns: YTD behind footnotes, no borrowed values, dash for the 10-year slot', () => {
    const cases: Array<[string, number | null, number | null]> = [
      ['## Price\nNAV $20.00\nYTD Total Returns At NAV [1]\n[1] The fund\'s total return assumes reinvestment of distributions and does not\nreflect brokerage commissions, which would reduce returns.\n4.20%\nAs of 09/23/2026\n', 4.2, null],
      ['## Performance\nYTD Total Returns At Market Price [1]\n-7.35%\n1 Year\n12.10%\n', -7.35, 12.1],
      ['## Performance\nYTD Total Returns At NAV [1]\n-7.35%\n1 Year\n', -7.35, null],
    ];
    for (const [body, ytd, yr1] of cases) {
      const { returns } = parseProductPage(`# TEST  Franklin Test ETF\n${body}`, 'TEST');
      expect([returns.ytd, returns.yr1]).toEqual([ytd, yr1]);
    }
    const fltw = parseProductPage(fltwPage, 'FLTW');
    expect(fltw).toMatchObject({ nav: 110.52, totalNetAssets: 4.16e9, totalExpenseRatio: 0.19, inception: '2017-11-02', cusip: '35473P686' });
    expect(fltw.returns).toEqual({ ytd: 81.22, yr1: 96.86, yr3: 44.1, yr5: 20.96, yr10: null, sinceInception: 19.77 });
  });

  test('Distribution Rate: overview line, Rates and Yields block, either basis, never the footnote or a neighbouring yield', () => {
    const overview = 'Dividend Frequency, if any Quarterly\nDistribution Rate at NAV[9](https://www.franklintempleton.com/x#footnote_9)As of 10/02/2026 (Updated Daily)1.18%\n30-Day SEC Yield 1.52%';
    expect(parseDistributionRate(toTextLines(stripFootnoteMarkers(overview)))).toEqual({ value: 1.18, asOfDate: '2026-10-02', basis: 'NAV' });
    const block = '### Rates and Yields\nDistribution Rate[9]\nAs of 10/02/2026 (Updated Daily)\nAt Net Asset Value (NAV) 4.78%\n30-Day SEC Yield[6]\nAs of 08/31/2026\n4.53%';
    expect(parseDistributionRate(toTextLines(stripFootnoteMarkers(block)))).toEqual({ value: 4.78, asOfDate: '2026-10-02', basis: 'NAV' });
    expect(parseDistributionRate(toTextLines('Distribution Rate\nAs of 10/01/2026\nAt Market Price 2.50%'))).toEqual({ value: 2.5, asOfDate: '2026-10-01', basis: 'market price' });
    // NAV basis wins when both are printed; a rate without a basis or date is still read, with nulls
    expect(parseDistributionRate(toTextLines('Distribution Rate at Market Price 2.50%\nDistribution Rate at NAV 2.40%'))?.value).toBe(2.4);
    expect(parseDistributionRate(toTextLines('Distribution Rate 3.10%'))).toEqual({ value: 3.1, asOfDate: null, basis: null });
    // the footnote sentence, a dash and a missing label are nulls, never 0 and never the SEC yield
    expect(parseDistributionRate(toTextLines('9. Distribution Rate is calculated by annualizing the most recent distribution 5%'))).toBeNull();
    expect(parseDistributionRate(toTextLines('Distribution Rate at NAV As of 10/02/2026 —\n30-Day SEC Yield 1.52%'))).toBeNull();
    expect(parseDistributionRate(toTextLines('30-Day SEC Yield 1.52%'))).toBeNull();
    const page = parseProductPage(pageMd({ rate: true }), 'FLCH');
    expect(page).toMatchObject({ distributionRate: 1.18, distributionRateAsOfDate: '2026-10-02', distributionRateBasis: 'NAV', distributionYield: null });
    expect(page.sections.yields).toBe(true);
  });
});

describe('parsing 2', () => {
  test('page sections: a page is loaded fully only with identifiers, Total Net Assets and the Share Prices block', () => {
    const full = parseProductPage(pageMd(), 'FLCH');
    // footnote links inside labels no longer leak into the values (they read NAV as 461.09 and the market price as null)
    expect(full).toMatchObject({ nav: 21.99, marketPrice: 21.9, totalNetAssets: 53.87e6, secYield: 3.93, holdingsAsOfDate: '2026-10-02', loadedFully: true });
    expect(full.sections).toEqual({ facts: true, returns: true, assets: true, pricing: true, yields: true, holdings: true });
    // the proxy's partial render: Portfolio and Pricing headings are there but empty
    const partial = parseProductPage(pageMd({ portfolio: false, pricing: false }), 'FLCH');
    expect(partial).toMatchObject({ marketPrice: null, totalNetAssets: null, loadedFully: false });
    expect(partial.sections).toMatchObject({ facts: true, returns: true, assets: false, pricing: false, holdings: false });
    expect(parseProductPage(pageMd({ pricing: false }), 'FLCH').loadedFully).toBe(false);
    expect(parseProductPage(pageMd({ portfolio: false }), 'FLCH').loadedFully).toBe(false);
    // a block missing one price is still a loaded page (the field is an honest null); no returns/yields/holdings is fine too
    expect(parseProductPage(pageMd({ marketPrice: false, secYield: false }), 'FLCH')).toMatchObject({ marketPrice: null, secYield: null, loadedFully: true });
    expect(stripFootnoteMarkers('NAV[1](https://a.test/#footnote_1)(Net Asset Value)$1.00 [5,](https://a.test/b)x')).toBe('NAV(Net Asset Value)$1.00 x');
    expect(parseSharePrices(toTextLines('### Share Prices\nAs of 10/02/2026\nNAV Change $0.49\nMarket Price $5.00'))).toEqual({ nav: null, marketPrice: 5, asOfDate: '2026-10-02' });
    expect(parseSharePrices(toTextLines('## Pricing\n'))).toBeNull();
  });

  test('official holdings table: dollar amounts, M suffix, empty page, zero-width characters inside numbers', () => {
    const flau = `
# Portfolio Holdings
| Security Name | Weight (%) | Market Value ($) | Quantity |
| --- | --- | --- | --- |
| BHP GROUP LTD | 13.46% | $27,530,012 | 629,391 |
| COMMONWEALTH BANK OF AUSTRALIA | 8.36% | $17,102,277 | 98,432 |
| CSL LTD | 6.21% | $12,704,123 | 45,123 |
`;
    const flin = `
| Security Name | Weight (%) | Market Value ($) | Notional Exposure | Quantity |
| --- | --- | --- | --- | --- |
| HDFC BANK LTD | 5.29% | 137.14M USD | 137.14M | 5.20M |
| RELIANCE INDUSTRIES LTD | 4.85% | 125.60M USD | 125.60M | 4.10M |
`;
    const a = parseFranklinHoldings(flau);
    expect(a.map((h) => h.name)).toEqual(['BHP GROUP LTD', 'COMMONWEALTH BANK OF AUSTRALIA', 'CSL LTD']);
    expect([a[0].pctVal, Number(a[0].valUSD), Number(a[0].balance)]).toEqual(['13.46', 27530012, 629391]);
    const b = parseFranklinHoldings(flin);
    expect(b.length).toBe(2);
    expect([b[0].name, b[0].pctVal, Number(b[0].valUSD), Number(b[0].balance)]).toEqual(['HDFC BANK LTD', '5.29', 137140000, 5200000]);
    expect(parseFranklinHoldings('no table here')).toEqual([]);
    // an empty cell keeps its column (the market value was read as the weight), a parenthesised amount is negative
    const gaps = parseFranklinHoldings([
      '| Security Name | Weight (%) | Market Value ($) | Quantity |', '| --- | --- | --- | --- |',
      '| APPLE INC | | $1,000 | 10 |', '| S&P 500 FUTURE | (0.52%) | ($1,234.00) | (5) |', '| CASH | 1.20% | | |',
    ].join('\n'));
    expect(gaps.map((h) => [h.name, h.pctVal, h.valUSD, h.balance])).toEqual([
      ['APPLE INC', '', '1000', '10'], ['S&P 500 FUTURE', '-0.52', '-1234', '-5'], ['CASH', '1.2', '', ''],
    ]);
    // the crypto and gold pages put zero-width characters inside every number (EZPZ, FGDL on 2026-10-23)
    const zw = (s: string) => s.replace(/\./g, '.\u200b').replace(/,/g, ',\u2060');
    const ezpz = parseFranklinHoldings([
      'Title: Franklin Crypto Index ETF - EZPZ', 'Markdown Content:',
      '| Security Name | Weight (%) | Market Value ($) | Notional Exposure | Quantity |', '| --- | --- | --- | --- | --- |',
      `| BITCOIN | ${zw('78.16')} | ${zw('13,407,461.27')} | 0.\u200b00 | ${zw('165.06')} |`,
      `| GOLD OZ.\u200b | \ufeff${zw('21.84%')} | $${zw('3,746,282.10')} | 0.\u200b00 | ${zw('1,234.5')}\u200d |`,
    ].join('\n'));
    expect(ezpz.map((h) => [h.name, numberOrNull(h.pctVal), numberOrNull(h.valUSD), numberOrNull(h.balance)])).toEqual([
      ['BITCOIN', 78.16, 13407461.27, 165.06],
      ['GOLD OZ.', 21.84, 3746282.1, 1234.5],
    ]);
    expect(numberOrNull('13,\u200b407.\u200d5\ufeff')).toBe(13407.5);
    expect(parseProductPage(pageMd({ nav: '21.\u200b99' }), 'FLCH').nav).toBe(21.99); // read from the raw line, not a cleaned cell
  });

  test('holdings guard: header-only, renamed weight column, broken weights, a bad weight sum and a halved sheet are rejected', () => {
    const headers = ['Name', 'Ticker', 'Weight'];
    const rows = [{ Name: 'A', Ticker: 'A', Weight: '60%' }, { Name: 'B', Ticker: 'B', Weight: '40%' }];
    expect(holdingsGuard(headers, rows, 2)).toBeNull();
    expect(holdingsGuard(headers, [['A', 'A', '60'], ['B', 'B', '40']], null)).toBeNull();
    expect(holdingsGuard([], [], 0)).toBeNull(); // nothing published before: an empty sheet is honest
    expect(holdingsGuard(headers, [], 505)).toContain('no holdings rows');
    expect(holdingsGuard(['Name', 'Ticker', 'Wt'], rows, 2)).toContain('no weight column');
    expect(holdingsGuard(headers, rows.map((row) => ({ ...row, Weight: '6\u200B0' })), 2)).toContain('numeric weight');
    const allocation = [{ Name: 'Cash&Collateral', Ticker: '-', Weight: '100' }, { Name: 'Equities', Ticker: '-', Weight: '476' }];
    expect(holdingsGuard(headers, allocation, 2)).toContain('outside 50..150');
    expect(holdingsGuard(headers, allocation, 2, ['sum'])).toBeNull();
    expect(holdingsGuard(headers, rows, 5)).toContain('less than half');
  });

  test('Yahoo chart and SEC payloads', () => {
    const chart = parseChart({
      chart: {
        result: [{
          meta: { exchangeName: 'PCX', regularMarketPrice: 34.85, regularMarketTime: 1720000000, firstTradeDate: 1510000000 },
          timestamp: [1600000000, 1600086400, 1600172800],
          indicators: { quote: [{ close: [10, null, 12], volume: [100, 200, 300] }], adjclose: [{ adjclose: [9, null, 11.5] }] },
          events: { dividends: { '1600086400': { amount: 0.25, date: 1600086400 } }, splits: { '1600172800': { date: 1600172800, numerator: 2, denominator: 1 } } },
        }],
      },
    });
    expect(chart.days.length).toBe(2);
    expect(chart.days[0].close).toBe(10);
    expect([chart.dividends.length, chart.splits.length, chart.exchangeName]).toEqual([1, 1, 'PCX']);

    const map = parseFundTickerMap({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1655589, 'S000053151', 'C000167258', 'FLIN'], [1655589, 'S000059504', 'C000194938', 'FLMX']] });
    expect(map.get('FLIN')).toMatchObject({ cik: '0001655589', seriesId: 'S000053151' });
    const atom = '<feed><entry><content><accession-number>0001752724-26-000001</accession-number><filing-date>2026-08-27</filing-date><filing-type>NPORT-P</filing-type><filing-href>https://www.sec.gov/Archives/edgar/data/1655589/000175272426000001/0001752724-26-000001-index.htm</filing-href><period>2026-06-30</period></content></entry></feed>';
    const filings = parseEdgarAtomFilings(atom);
    expect(filings.length).toBe(1);
    expect(filings[0].accession).toBe('0001752724-26-000001');
    // the SEC form: isin, ticker and SEDOL are value attributes, a foreign line is valued in its own currency, a
    // derivative's reference index carries identifiers of its own (FLAU and FLQL filings, 2026-06-30)
    const position = (name: string, cusip: string, ids: string, cur: string, cat: string, more = '') =>
      `<invstOrSec><name>${name}</name><title>${name}</title><cusip>${cusip}</cusip><identifiers>${ids}</identifiers><balance>10.00000000</balance>${cur}<valUSD>100.50000000</valUSD><pctVal>1.25</pctVal><assetCat>${cat}</assetCat><invCountry>US</invCountry>${more}</invstOrSec>`;
    const nport = parseNport(`<edgarSubmission><genInfo><regName>Franklin Templeton ETF Trust</regName><regCik>0001655589</regCik><seriesName>Franklin FTSE Australia ETF</seriesName><seriesId>S000059508</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><invstOrSecs>${[
      position('SIMS LTD', '000000000', '<isin value="AU000000SGM7"/><ticker value="SGM"/><other otherDesc="SEDOL" value="B0LCW75"/>', '<currencyConditional curCd="AUD" exchangeRt="1.44"/>', 'EC'),
      position('JAZZ PHARMACEUTICALS PLC', '000000000', '<isin value="IE00B4Q5ZN47"/><ticker value="JAZZ"/>', '<curCd>USD</curCd>', 'EC'),
      position('MASCO CORP', '574599106', '<isin value="US5745991068"/>', '<curCd>USD</curCd>', 'EC'),
      position('ALPHABET INC', '02079K305', '<isin value="US02079K3059"/>', '<curCd>USD</curCd>', 'EC'),
      position('ASX 24', '000000000', '<ticker value="AP U26-SFE"/>', '<currencyConditional curCd="AUD" exchangeRt="1.44"/>', 'DE', '<derivativeInfo><futrDeriv><identifiers><cusip value="000000000"/><isin value="AU000000XJO0"/><ticker value="AS51"/></identifiers></futrDeriv></derivativeInfo>'),
      position('US TREASURY N/B 4.25% 2030', '91282CLK5', '<isin value="US91282CLK52"/><ticker value="T"/>', '<curCd>USD</curCd>', 'DBT'),
    ].join('')}</invstOrSecs></edgarSubmission>`);
    expect(nport.seriesId).toBe('S000059508');
    expect(nport.holdings.map((h) => [h.isin, h.ticker, h.sedol])).toEqual([
      ['AU000000SGM7', 'SGM', 'B0LCW75'], ['IE00B4Q5ZN47', 'JAZZ', ''], ['US5745991068', '', ''], ['US02079K3059', '', ''], ['', 'AP U26-SFE', ''], ['US91282CLK52', 'T', ''],
    ]);
    // SEC company table: exact issuer names only, a name with two tickers (GOOG, GOOGL) is never guessed
    const names = parseCompanyTickerMap({ 0: { ticker: 'MAS', title: 'Masco Corporation' }, 1: { ticker: 'GOOGL', title: 'Alphabet Inc.' }, 2: { ticker: 'GOOG', title: 'Alphabet Inc.' } });
    expect(fillNportTickers(nport.holdings, names).map((h) => [h.Ticker, h.Identifier])).toEqual([
      ['—', 'AU000000SGM7'], ['JAZZ', 'IE00B4Q5ZN47'], ['MAS', '574599106'], ['—', '02079K305'], ['—', '—'], ['—', '91282CLK5'],
    ]);
    expect(checkNportFiling(nport.seriesId, 's000059508')).toEqual({ ok: true });
    expect(checkNportFiling('S000068596', 'S000053151').reason).toContain('filing series S000068596 is not S000053151');
    expect(checkNportFiling('', 'S000053151').ok).toBe(false);
  });

  test('Total Net Assets date: its own block (the "As of" above it in Portfolio Assets), never the monthly block below; same value keeps the published date', () => {
    // the Portfolio "Assets" block of FTMH: the daily "As of" is above the value, the monthly statistics follow
    const assets = (date: string) => pageMd().replace('As of 10/02/2026  (Updated Daily)\nTotal Net Assets $53.87 Million',
      `As of ${date}  (Updated Daily)\nTotal Net Assets $53.87 Million\n### Portfolio Statistics\nAs of 09/30/2026  (Updated Monthly)`);
    expect(parseProductPage(assets('10/25/2026'), 'FLCH')).toMatchObject({ totalNetAssets: 53.87e6, totalNetAssetsAsOfDate: '2026-10-25' });
    // the header block prints the date below the value
    expect(parseProductPage(pageMd().replace('## Overview', 'Total Net Assets\n$53.87M\nAs of 10/22/2026 (Updated Daily)\n## Overview'), 'FLCH').totalNetAssetsAsOfDate).toBe('2026-10-22');
    // a new value takes the source's date; the published value keeps its date, earlier or later re-stamps alike
    const published = { value: 224.46e6, asOfDate: '2026-10-25' };
    expect(stableAumAsOf(224.46e6, '2026-10-22', published)).toBe('2026-10-25');
    expect(stableAumAsOf(224.46e6, '2026-10-27', published)).toBe('2026-10-25');
    expect(stableAumAsOf(225.1e6, '2026-10-27', published)).toBe('2026-10-27');
    expect([stableAumAsOf(224.46e6, null, published), stableAumAsOf(224.46e6, '2026-10-22', { value: 224.46e6, asOfDate: '—' }), stableAumAsOf(224.46e6, '2026-10-22', null)]).toEqual([null, '2026-10-22', '2026-10-22']);
  });
});

describe('parsing 3', () => {
  test('scalars: numbers, dates and proxy preamble; missing values are null, never 0', () => {
    expect(numberOrNull('$1,234.56')).toBe(1234.56);
    expect(numberOrNull('-0.40%')).toBe(-0.4);
    for (const missing of ['—', '', 'N/A']) expect(numberOrNull(missing)).toBeNull();
    expect(toIsoDate('02/06/2018')).toBe('2018-02-06');
    expect(toIsoDate('2026-08-31')).toBe('2026-08-31');
    expect(toIsoDate('Feb 6 2018')).toBe('2018-02-06');
    expect(normalizeNumberText('2.97057744E8')).toBe('297057744');
    expect(normalizeNumberText('—')).toBe('—');
    expect(stripProxyPreamble('Title: Foo\nURL Source: https://example.com\nMarkdown Content:\nReal content here')).toBe('Real content here');
    expect(stripProxyPreamble('Real content')).toBe('Real content');
  });

  test('dates do not depend on the machine time zone: the same calendar day in UTC, New York and Tokyo', () => {
    // formatDate writes "Oct 20 2026" into index.json and the next run reads it back: Date.parse took it as local
    // midnight, so east of UTC every local run moved the inception of every kept fund back one day
    const saved = process.env.TZ;
    try {
      for (const zone of [saved || 'UTC', 'UTC', 'America/New_York', 'Asia/Tokyo']) {
        process.env.TZ = zone;
        expect([zone, ...['Oct 20 2026', 'October 20, 2026', 'Dec 4 2019', '20 Oct 2026', 'Sept 3, 2026', '2026-10-20T00:00:00Z', '10/20/2026'].map(toIsoDate)])
          .toEqual([zone, '2026-10-20', '2026-10-20', '2019-12-04', '2026-10-20', '2026-09-03', '2026-10-20', '2026-10-20']);
      }
    } finally {
      if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
    }
  });

  test('distribution frequency: inferred, labelled and normalized', () => {
    const every = (count: number, days: number) => Array.from({ length: count }, (_, i) => ({ epoch: 1700000000 + i * days * 86400, amount: 0.1 }));
    expect(inferDistributionFrequency(every(12, 30))).toBe('Monthly');
    expect(inferDistributionFrequency(every(4, 90))).toBe('Quarterly');
    expect(inferDistributionFrequency([])).toBe('—');
    expect(frequencyCodeLabel('Monthly')).toBe('01 - Monthly');
    expect(frequencyCodeLabel('Semi-annually')).toBe('06 - Semi-annually');
    expect(frequencyCodeLabel('—')).toBe('00 - None');
    const normalized: Array<[string, string]> = [
      ['Annually This fund is an ex-Dividend fund', 'Annually'], [', if any Semiannually', 'Semi-annually'], [', if any Monthly', 'Monthly'],
      ['Semi-Annual This fund is an ex-Dividend fund', 'Semi-annually'], ['Quarterly', 'Quarterly'], ['Irregular', 'Irregular'], ['—', '—'], ['', '—'],
    ];
    for (const [raw, expected] of normalized) expect(normalizeDistributionFrequency(raw)).toBe(expected);
    expect([paymentsPerYearFor('Monthly'), paymentsPerYearFor(', if any Semiannually'), paymentsPerYearFor('—')]).toEqual([12, 2, null]);
  });

  test('names, categories and plausibility guards', () => {
    expect(cleanFundName('Franklin Disruptive Commerce ETF - NAV Return (%)')).toBe('Franklin Disruptive Commerce ETF');
    expect(cleanFundName('FLTW Franklin FTSE Taiwan ETF - FLTW', 'FLTW')).toBe('Franklin FTSE Taiwan ETF');
    expect(fundNameFromPageSlug(fundUrl(123, 'franklin-u-s-core-bond-etf', 'FLCB'))).toBe('Franklin U.S. Core Bond ETF');
    const gold = fundUrl(31714, 'franklin-responsibly-sourced-gold-etf', 'FGDL');
    expect(resolveFundName('Franklin ETF and Index Investmen', gold, 'FGDL')).toBe('Franklin Responsibly Sourced Gold ETF');
    expect(resolveFundName('Exchange Traded Funds', fundUrl(26352, 'franklin-ftse-canada-etf', 'FLCA'), 'FLCA')).toBe('Franklin FTSE Canada ETF');
    expect(resolveFundName('Franklin FTSE Taiwan ETF - NAV Return (%)', fundUrl(26351, 'franklin-ftse-taiwan-etf', 'FLTW'), 'FLTW')).toBe('Franklin FTSE Taiwan ETF');
    expect(resolveCategory('India Equity')).toBe('India Equity');
    for (const junk of ['Asset Class', 'As of 09/23/2026 (Updated Daily)', 'March 31', '665.32', 'page. If so preload resources', '']) expect(resolveCategory(junk)).toBe('ETF');
    expect(resolveCategory('Fiscal Year End', 'Ethnic and Thematic')).toBe('ETF');

    expect([plausibleSecYield(30), plausibleSecYield(0), plausibleSecYield(null), plausibleSecYield(2.09)]).toEqual([null, null, null, 2.09]);
    expect([plausibleDividendYield(30), plausibleDividendYield(61)]).toEqual([30, null]);
    expect([plausiblePremiumDiscount(100), plausiblePremiumDiscount(-6), plausiblePremiumDiscount(0.12)]).toEqual([null, null, 0.12]);
    expect(plausibleBenchmark('FTSE India Capped Index-NR')).toBe('FTSE India Capped Index-NR');
    expect(plausibleBenchmark("index are as of the ETF's/ETP's last trading day before the ")).toBeNull();
    expect(plausibleBenchmark('')).toBeNull();
    // unrelated product-page dollar figures are rejected against the market price
    expect([plausibleNav(828.34, 53.09), plausibleNav(43.92, 34.24), plausibleNav(0, null)]).toEqual([null, null, null]);
    expect([plausibleNav(53.05, 53.09), plausibleNav(34.85, null)]).toEqual([53.05, 34.85]);
  });
});

describe('metrics', () => {
  const base = { inception: null, dividendYield: null, secYield: null, performanceAsOf: null };

  test('performanceAsOf comes from the "Average Annual Total Returns" header and travels with returnsBasis', () => {
    const finder = '|  | As of 10/01/2026 | Average Annual Total Returns at Market Price (%) [2](https://example.org/x#footnote_2)As of 08/31/2026 |  |\n| --- | --- | --- |\n';
    expect(parsePerformanceAsOf(finder)).toBe('2026-08-31');
    expect(parsePerformanceAsOf('### Average Annual Total Returns  As of 06/30/2026\nAs of 10/01/2026 (Updated Daily)')).toBe('2026-06-30');
    expect(parsePerformanceAsOf('NAV $1\nAs of 10/01/2026')).toBeNull();
    expect(resolvePerformanceAsOf('2026-08-31', { ...noReturns, yr1: 1 })).toBe('2026-08-31');
    expect(resolvePerformanceAsOf('2026-08-31', { ...noReturns, ytd: 0 })).toBe('2026-08-31');
    expect(resolvePerformanceAsOf('2026-08-31', noReturns)).toBeNull();
    expect(resolvePerformanceAsOf('Aug 31 2026', { ...noReturns, yr1: 1 })).toBeNull();
    expect(resolvePerformanceAsOf('', { ...noReturns, yr1: 1 })).toBeNull();
  });

  test('buildMetrics: percent numbers, null for missing or too-young horizons, basis and date last', () => {
    const metrics = buildMetrics({
      ...base,
      returns: { ytd: -14.69, yr1: -14.61, yr3: 10, yr5: -7.2, yr10: 6, sinceInception: 6.05 },
      inception: '2020-02-25',
      dividendYield: 0.08,
      performanceAsOf: '2026-08-31',
    });
    expect(metrics.tr3y).toBeCloseTo(33.1, 2);
    // a fund incepted in 2020 has no 10-year figure, even when a value was scraped
    expect(metrics.tr10y).toBeNull();
    expect(metrics.cagr10y).toBeNull();
    expect(metrics.secYield).toBeNull();
    expect(Object.keys(metrics).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    expect(metrics.returnsBasis).toBe(RETURNS_BASIS);
    expect(String(metrics.returnsBasis).trim()).not.toBe('');
    expect(metrics.performanceAsOf).toBe('2026-08-31');
    expect([tenYearEligible('2015-01-02'), tenYearEligible('2020-02-25'), tenYearEligible('2017-11-02'), tenYearEligible(null)]).toEqual([true, false, false, true]);
  });

  test('dividend yield kinds: official 12-month first, then the Distribution Rate with its date, never indicated', () => {
    const page = (over: Record<string, unknown>) => ({ distributionYield: null, distributionRate: null, distributionRateAsOfDate: null, distributionRateBasis: null, ...over }) as any;
    expect(officialDividendYield(page({ distributionYield: 0.42, distributionRate: 1.18 }))).toEqual({ value: 0.42, kind: 'official 12-month distribution yield from the product page', asOfDate: null });
    expect(officialDividendYield(page({ distributionRate: 1.18, distributionRateAsOfDate: '2026-10-02', distributionRateBasis: 'NAV' }))).toEqual({
      value: 1.18, kind: 'Distribution Rate at NAV published on the official Franklin fund page as of Oct 2 2026', asOfDate: '2026-10-02',
    });
    expect(officialDividendYield(page({ distributionRate: 3.1 }))?.kind).toBe('Distribution Rate published on the official Franklin fund page');
    expect(officialDividendYield(page({ distributionRate: 0 }))).toBeNull();
    expect(officialDividendYield(page({}))).toBeNull();
    // the published label round-trips through retention: a partial page restores the rate with its date and basis
    const summary = parseProductPage(pageMd({ portfolio: false, pricing: false, secYield: false }), 'FLCH');
    const kept = retainPublishedSections(summary, { yields: { dividendYield: 1.18, dividendYieldKind: 'Distribution Rate at NAV published on the official Franklin fund page as of Oct 2 2026' } });
    expect(kept).toContain('Distribution Rate');
    expect(officialDividendYield(summary)).toMatchObject({ value: 1.18, asOfDate: '2026-10-02' });
    expect(asOfFromKind('SEC Yield (30 Day) published on the official product page as of Aug 31 2026')).toBe('2026-08-31');
    expect(asOfFromKind('not published')).toBeNull();
  });

  test('dividendYieldBasis: one code per yield source, null exactly when the yield is null, same key set on every row', () => {
    const page = (over: Record<string, unknown>) => ({ distributionYield: null, distributionRate: null, distributionRateAsOfDate: null, distributionRateBasis: null, ...over }) as any;
    const kindOf = (over: Record<string, unknown>) => officialDividendYield(page(over))!.kind;
    expect(dividendYieldBasisFromKind(kindOf({ distributionYield: 0.42 }), true)).toBe('official-trailing-12m');
    expect(dividendYieldBasisFromKind(OFFICIAL_12M_YIELD_KIND, true)).toBe('official-trailing-12m');
    expect(dividendYieldBasisFromKind(kindOf({ distributionRate: 1.18, distributionRateAsOfDate: '2026-10-02', distributionRateBasis: 'NAV' }), true)).toBe('official-distribution-rate');
    expect(dividendYieldBasisFromKind(kindOf({ distributionRate: 3.1 }), true)).toBe('official-distribution-rate');
    expect(dividendYieldBasisFromKind('indicated: latest distribution 0.0500 x 12/year / market price 21.90', false)).toBe('indicated');
    // unknown text: official-other for a provider-published yield, indicated otherwise
    expect(dividendYieldBasisFromKind('official something new', true)).toBe('official-other');
    expect(dividendYieldBasisFromKind('something else', false)).toBe('indicated');
    expect(DIVIDEND_YIELD_BASES).toContain(dividendYieldBasisFromKind(undefined, true));
    const withYield = (basis: any) => buildMetrics({ ...base, returns: noReturns, dividendYield: 1.2, dividendYieldBasis: basis });
    expect(withYield('official-distribution-rate').dividendYieldBasis).toBe('official-distribution-rate');
    expect(withYield('indicated').dividendYieldBasis).toBe('indicated');
    expect(withYield(undefined).dividendYieldBasis).toBe('official-other');
    // null yield: null code, even when a code is passed
    expect(buildMetrics({ ...base, returns: noReturns, dividendYieldBasis: 'indicated' }).dividendYieldBasis).toBeNull();
    const keys = (row: Record<string, unknown>) => Object.keys(row);
    expect(keys(withYield('indicated'))).toEqual(keys(buildMetrics({ ...base, returns: noReturns })));
    expect(keys(withYield('indicated'))).toContain('dividendYieldBasis');
  });
});

describe('metrics 2', () => {
  const base = { inception: null, dividendYield: null, secYield: null, performanceAsOf: null };

  test('premium/discount: (price / NAV - 1) * 100 only for the same date, otherwise null', () => {
    expect(computePremiumDiscount(41.42, '2026-10-02', 42, '2026-10-02')).toBe(1.4);
    expect(computePremiumDiscount(61.7, '2026-10-02', 61.72, '2026-10-02')).toBe(0.03);
    expect(computePremiumDiscount(21.99, '2026-10-02', 21.9, '2026-10-02')).toBe(-0.41);
    expect(computePremiumDiscount(41.42, '2026-10-02', 42, '2026-10-01')).toBeNull();
    expect(computePremiumDiscount(41.42, null, 42, '2026-10-02')).toBeNull();
    expect(computePremiumDiscount(null, '2026-10-02', 42, '2026-10-02')).toBeNull();
    expect(computePremiumDiscount(0, '2026-10-02', 42, '2026-10-02')).toBeNull();
    expect(computePremiumDiscount(10, '2026-10-02', 90, '2026-10-02')).toBeNull(); // a mis-read price is not a 800% premium
    expect(PREMIUM_COMPUTED_SOURCE).toBe('computed from market price / official NAV, same date');
  });

  test('every row has the same key set; unknown dates stay null and a fund without returns gets no date', () => {
    const rows = [
      buildMetrics({ ...base, returns: noReturns }),
      buildMetrics({ ...base, returns: { ...noReturns, yr1: 2 } }),
      buildMetrics({ ...base, returns: { ...noReturns, yr1: 2, yr10: 3 }, inception: '2001-01-01', performanceAsOf: '2026-08-31' }),
    ];
    for (const row of rows) expect(Object.keys(row)).toEqual(Object.keys(rows[0]));
    expect(rows[1].performanceAsOf).toBeNull();
    const bare = buildMetrics({ ...base, returns: noReturns, performanceAsOf: '2026-08-31' });
    expect(bare.performanceAsOf).toBeNull();
    expect(bare.tr3y).toBeNull();
    expect(bare.returnsBasis).toBe(RETURNS_BASIS);
    expect(annualizedToTotal(10, 3)).toBeCloseTo(0.331, 2);
    expect(totalToAnnualized(0.331, 3)).toBeCloseTo(10, 0);
  });

  test('nothing is invented for unseen funds: no name, fees or exchange; a made-up 0.19 is dropped', () => {
    expect(placeholderFund('ZZZZ', 'https://example.test/zzzz', 'official sitemap')).toMatchObject({ name: '', ter: null, grossTer: null, exchange: '', nav: null });
    expect(previousTer({ terValue: 0.19, navValue: null, aumValue: null })).toBeNull();
    expect(previousTer({ terValue: 0.19, navValue: 21.03, aumValue: 307030000 })).toBe(0.19);
    expect(previousTer({ terValue: 0.35, navValue: null, aumValue: null })).toBe(0.35);
    expect(previousTer({ ter: '—' })).toBeNull();
  });
});

// pipeline harness shared by the pipeline groups: one temp api root per test
const offline = { SKIP_FRANKLIN: 'true', SKIP_YAHOO: 'true', EDGAR_FALLBACK: 'false', REQUEST_SLEEP: '0', CONCURRENCY: '2', MAX_RETRIES: '1' };
let root = '';

const feed = () => join(root, 'franklin');
const index = () => JSON.parse(readFileSync(join(feed(), 'index.json'), 'utf8'));
const snapshot = (dir: string, base = dir): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, snapshot(path, base));
    else out[path.slice(base.length)] = readFileSync(path, 'utf8');
  }
  return out;
};
const run = async (env: Record<string, string> = {}) => {
  process.exitCode = 0;
  await main([], { ...offline, ...env });
};
// each test gets its own temp api root, removed afterwards even when the test fails
const inTempRoot = (body: () => Promise<void>) => async () => {
  root = mkdtempSync(join(tmpdir(), 'franklin-test-'));
  setApiRootForTest(pathToFileURL(`${feed()}/`));
  setClockForTest(fakeClock());
  console.log = () => {};
  console.warn = () => {};
  try { await body(); }
  finally { rmSync(root, { recursive: true, force: true }); root = ''; }
};
const offlineFetch = () => { (globalThis as any).fetch = async () => { throw new Error('offline'); }; };

describe('pipeline', () => {
  test('a first run invents no fees or names and every row has the same metrics keys', inTempRoot(async () => {
    await run();
    const { funds, generatedAt } = index();
    expect(funds.length).toBeGreaterThanOrEqual(3);
    expect(funds.every((row: any) => row.terValue === null && row.ter === '—' && row.name === null)).toBe(true);
    const keys = Object.keys(buildMetrics({ ...{ inception: null, dividendYield: null, secYield: null, performanceAsOf: null }, returns: noReturns }));
    expect(funds.every((row: any) => JSON.stringify(Object.keys(row.metrics)) === JSON.stringify(keys))).toBe(true);
    expect(funds.every((row: any) => row.returns.quarterEnd.sinceInception === null)).toBe(true);
    expect(generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  }), 30_000);

  test('console output: config with TICKERS=all, one catalog line, no blank lines, the two done lines last', inTempRoot(async () => {
    const logged: string[] = [];
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
    await run({ TICKERS: '', MAX_FETCHES: '2' });
    const lines = logged.join('\n').split('\n');
    expect(lines).toContain('              TICKERS=all');
    expect(lines.some((line) => line.trim() === '')).toBe(false);
    expect(lines.filter((line) => line.startsWith('[ catalog  ]'))).toEqual(['[ catalog  ] 81 Franklin ETFs (definitive 81 seed fixture)']);
    expect(lines.findIndex((line) => line.startsWith('[ catalog  ]'))).toBeLessThan(lines.findIndex((line) => line.startsWith('[ filter   ]')));
    expect(lines.at(-2)).toMatch(/^\[ done     \] 2 funds: \d+ updated, \d+ unchanged, 0 kept, 0 skipped, 0 failed in \d+\.\ds$/);
    expect(lines.at(-1)).toMatch(/^\[ done     \] counts: 81 funds \/ [\d,]+ holdings rows \/ [\d,]+ history rows$/);
  }), 30_000);

  test('a second identical run writes nothing', inTempRoot(async () => {
    await run();
    const first = snapshot(feed());
    await new Promise((resolve) => setTimeout(resolve, 1100)); // generatedAt has second resolution
    await run();
    expect(snapshot(feed())).toEqual(first);
    expect(Object.keys(first).some((name) => name.endsWith('.tmp'))).toBe(false);
  }), 30_000);

  test('two runs on the same source data write zero changes even when Yahoo adjusted closes jitter across a cent boundary', inTempRoot(async () => {
    // Yahoo float32 noise seen live: AAM SPDV 2024-11-12 came back as 31.544998 and 31.545001 a minute apart
    const days = [Date.UTC(2026, 8, 29, 20) / 1000, Date.UTC(2026, 8, 30, 20) / 1000, Date.UTC(2026, 9, 1, 20) / 1000];
    let adjclose: number[] = [];
    (globalThis as any).fetch = async (input: unknown) => {
      if (!String(input).includes('finance/chart')) throw new Error('offline');
      return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 26.5, regularMarketTime: days[2] }, timestamp: days, indicators: { quote: [{ close: [24.5, 25.5, 26.5], volume: [1, 1, 1] }], adjclose: [{ adjclose }] }, events: {} }] } }));
    };
    const live = { SKIP_YAHOO: 'false', TICKERS: 'FLCH', CONCURRENCY: '1' };
    const history = () => JSON.parse(readFileSync(join(feed(), 'funds', 'FLCH', 'history', '001.json'), 'utf8')).rows.map((row: any) => row['Adj Close']);
    adjclose = [23.915001, 24.984999, 25.995001];
    await run(live);
    expect(history()).toEqual(['23.92', '24.98', '26.00']);
    const first = snapshot(feed());
    await new Promise((resolve) => setTimeout(resolve, 1100)); // generatedAt has second resolution
    adjclose = [23.914998, 24.985002, 25.994999];
    await run(live);
    expect(snapshot(feed())).toEqual(first);
    // a real change beyond the noise is still written
    adjclose = [23.9, 24.97, 25.98];
    await run(live);
    expect(history()).toEqual(['23.90', '24.97', '25.98']);
    expect(keptAdjClose(31.545001, '31.54')).toBe('31.54');
    expect(keptAdjClose(31.5452, '31.54')).toBe('31.55');
    expect(keptAdjClose(31.545001, undefined)).toBe('31.55');
    expect(ADJ_CLOSE_NOISE).toBe(1e-4);
  }), 30_000);

  test('a one-ticker run keeps every row and file; unknown tickers are an error', inTempRoot(async () => {
    await run();
    const before = snapshot(feed());
    await run({ TICKERS: 'FLCH' });
    expect(index().funds.length).toBe(JSON.parse(before['/index.json']).funds.length);
    expect(snapshot(feed())).toEqual(before);
    expect(existsSync(join(feed(), 'update-state.json'))).toBe(false);
    await expect(run({ TICKERS: 'NOPE' })).rejects.toThrow(/NOPE/);
  }), 30_000);
});

describe('pipeline 2', () => {
  test('MAX_FETCHES walks the filtered list and wraps around', inTempRoot(async () => {
    await run();
    const tickers: string[] = index().funds.map((row: any) => row.ticker);
    const total = tickers.length;
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await run({ MAX_FETCHES: String(total - 1) });
      seen.push(JSON.parse(readFileSync(join(feed(), 'update-state.json'), 'utf8')).cursor);
    }
    expect(seen[0]).toBe(tickers[total - 2]);
    expect(seen[1]).toBe(tickers[(total - 2 + total - 1) % total]);
    expect(new Set(seen).size).toBe(3);
  }), 30_000);

  test('stalest fund first: a deadline-truncated run refreshes the stalest, the next runs pick up the skipped funds', inTempRoot(async () => {
    const tickers = ['DIVI', 'FLCH', 'LVHD'];
    // published as-of dates: LVHD stalest, then DIVI, then FLCH (alphabetical order would be DIVI, FLCH, LVHD)
    const published: Record<string, string> = { LVHD: '2026-01-10', DIVI: '2026-02-10', FLCH: '2026-03-01' };
    await run({ TICKERS: tickers.join(' ') });
    for (const ticker of tickers) {
      const metaPath = join(feed(), 'funds', ticker, 'meta.json');
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      meta.marketPrice.asOfDate = published[ticker];
      writeFileSync(metaPath, JSON.stringify(meta, null, 1) + '\n');
    }
    expect(publishedAsOf(JSON.parse(readFileSync(join(feed(), 'funds', 'DIVI', 'meta.json'), 'utf8')))).toBe('2026-02-10');
    expect(publishedAsOf(null)).toBeNull();
    const asOf = new Map<string, string | null>([...Object.entries(published), ['ZNEW', null]]);
    expect(stalestFirst([...tickers, 'ZNEW'].map((ticker) => ({ ticker })), asOf).map((f) => f.ticker)).toEqual(['ZNEW', 'LVHD', 'DIVI', 'FLCH']);

    // a mocked Yahoo chart stamps a fresh trading day on whatever fund is fetched, in request order
    const order: string[] = [];
    (globalThis as any).fetch = async (input: unknown) => {
      const url = String(input);
      const ticker = /finance\/chart\/([A-Z]+)/.exec(url)?.[1];
      if (!ticker) throw new Error('offline');
      order.push(ticker);
      const t = Date.UTC(2026, 2, 27) / 1000;
      return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 20, regularMarketTime: t }, timestamp: [t - 86_400, t], indicators: { quote: [{ close: [19, 20], volume: [1, 1] }], adjclose: [{ adjclose: [19, 20] }] }, events: {} }] } }));
    };
    // soft deadline 0 and one worker: every run takes exactly one fund (the first fund is always taken)
    const summary = join(root, 'summary.md');
    process.env.GITHUB_STEP_SUMMARY = summary;
    setSoftDeadline(0);
    const runs: string[][] = [];
    for (let i = 0; i < 3; i += 1) {
      order.length = 0;
      await run({ TICKERS: tickers.join(' '), SKIP_YAHOO: 'false', CONCURRENCY: '1' });
      runs.push([...order]);
    }
    expect(runs).toEqual([['LVHD'], ['DIVI'], ['FLCH']]);
    expect(readFileSync(summary, 'utf8')).toContain('1 of 3 funds refreshed, 2 keep their published files, oldest remaining published as-of: 2026-02-10 (DIVI)');
    expect(index().funds.length).toBe(81);
  }), 30_000);

  test('a partial product page keeps the published official sections (zero diff); a full page lacking a field is an honest null', inTempRoot(async () => {
    let page = pageMd();
    const requests: string[] = [];
    (globalThis as any).fetch = async (input: unknown) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('finance/chart')) {
        const t = Math.floor(Date.now() / 86_400_000) * 86_400;
        return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 22, regularMarketTime: t }, timestamp: [t - 86_400, t], indicators: { quote: [{ close: [21.5, 22], volume: [1, 1] }], adjclose: [{ adjclose: [21.5, 22] }] }, events: {} }] } }));
      }
      if (url.includes('franklintempleton.com/investments')) return new Response(page);
      if (url.includes('sitemap')) return new Response('<urlset/>');
      throw new Error('offline');
    };
    const live = { SKIP_FRANKLIN: 'false', SKIP_YAHOO: 'false', TICKERS: 'FLCH', CONCURRENCY: '1' };
    const logged: string[] = [];
    const run2 = async () => { logged.length = 0; console.log = (...args: unknown[]) => { logged.push(args.join(' ')); }; await run(live); };
    const meta = () => JSON.parse(readFileSync(join(feed(), 'funds', 'FLCH', 'meta.json'), 'utf8'));
    const row = () => index().funds.find((item: any) => item.ticker === 'FLCH');

    // run 1: full page
    await run2();
    expect(meta()).toMatchObject({
      nav: { value: 21.99, asOfDate: '2026-10-02' },
      marketPrice: { value: 21.9, asOfDate: '2026-10-02', source: 'official product page Market Price' },
      aum: { value: 53.87e6, source: 'official product page Total Net Assets' },
      yields: { secYield: 3.93, secYieldKind: 'SEC Yield (30 Day) published on the official product page as of Aug 31 2026' },
      returns: { performanceAsOf: '2026-08-31', monthEnd: { yr1: 10.5, yr3: 4.2, yr5: null, sinceInception: 3 } },
      holdings: { totalRows: 2, asOfDate: '2026-10-02' }, // not the "December 1, 2025" of the disclaimer text
    });
    expect(logged.filter((line) => line.startsWith('[ kept'))).toEqual([]);
    const published = snapshot(feed());

    // run 2: the proxy renders the page partially (Portfolio and Pricing empty): everything official stays, zero diff
    page = pageMd({ portfolio: false, pricing: false, secYield: false });
    requests.length = 0;
    await run2();
    expect(snapshot(feed())).toEqual(published);
    expect(logged.filter((line) => line.startsWith('[ kept'))).toHaveLength(1); // one notice for the fund
    expect(logged.find((line) => line.startsWith('[ kept'))).toContain('pricing (NAV, market price)');
    expect(row().metrics).toMatchObject({ secYield: 3.93, tr1y: 10.5, performanceAsOf: '2026-08-31' });
    // a partial page gets one retry through the rendering proxy (direct, then at most the proxy candidates), no more
    expect(requests.filter((url) => url.includes('franklintempleton.com/investments') && url.startsWith('https://r.jina.ai/')).length).toBeLessThanOrEqual(2);

    // run 3: a page that loaded fully but really has no market price and no SEC yield: honest nulls, the rest fresh
    page = pageMd({ marketPrice: false, secYield: false, nav: '22.50' }).replace('4.20%3 Years', '4.30%3 Years');
    await run2();
    expect(logged.filter((line) => line.startsWith('[ kept'))).toHaveLength(0);
    expect(meta()).toMatchObject({ nav: { value: 22.5 }, yields: { secYield: null }, marketPrice: { source: 'last close from the Yahoo Finance price history' }, returns: { monthEnd: { yr3: 4.3 } } });
    expect(row().metrics.secYield).toBeNull();
  }), 60000);

  test('product pages through the rendering proxy: no cache, wait for the page load, no http:// stub, one retry after a 429', inTempRoot(async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    let limited = 0;
    (globalThis as any).fetch = async (input: unknown, init?: { headers?: Record<string, string> }) => {
      const url = String(input);
      if (!url.includes('franklintempleton.com/investments')) throw new Error('offline');
      seen.push({ url, headers: init?.headers ?? {} });
      // as live: the direct request gets the bare SPA shell, r.jina.ai/http:// the redirect stub, a burst a 429
      if (!url.startsWith('https://r.jina.ai/')) return new Response('<html><app-root></app-root></html>');
      if (url.startsWith('https://r.jina.ai/http://')) return new Response('Title: Franklin Templeton\n\nMarkdown Content:\nLoading...');
      if (limited++ === 0) return new Response('{"data":null,"retryAfter":2,"code":429,"name":"RateLimitTriggeredError"}', { status: 429, statusText: 'Too Many Requests' });
      // the proxy's markdown carries the ticker in the page body too, not only in the stripped Title preamble
      return new Response(pageMd().replace('Markdown Content:', 'Markdown Content:\n# Franklin FTSE Switzerland ETF - FLCH'));
    };
    const logged: string[] = [];
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
    await run({ SKIP_FRANKLIN: 'false', TICKERS: 'FLCH', CONCURRENCY: '1' });
    const proxied = seen.filter((request) => request.url.startsWith('https://r.jina.ai/'));
    expect(proxied.map((request) => request.url.slice(0, 26))).toEqual(['https://r.jina.ai/https://', 'https://r.jina.ai/https://']);
    for (const request of proxied) expect([request.headers['X-No-Cache'], request.headers['X-Timeout']]).toEqual(['true', '30']);
    for (const request of seen.filter((item) => !item.url.startsWith('https://r.jina.ai/'))) {
      expect<unknown[]>([request.headers['X-No-Cache'], request.headers['X-Timeout']]).toEqual([undefined, undefined]);
    }
    expect(logged.filter((line) => line.includes('FLCH') && /429|product page/.test(line))).toEqual([]);
  }), 30_000);

  test('an empty proxy snapshot of a product page is asked once more: empty then valid publishes the page, empty twice fails as before', inTempRoot(async () => {
    const empty = 'Title: Franklin Templeton\n\nMarkdown Content:\n';
    let answers: string[] = [];
    let proxied = 0;
    (globalThis as any).fetch = async (input: unknown) => {
      const url = String(input);
      if (!url.includes('franklintempleton.com/investments')) throw new Error('offline');
      if (!url.startsWith('https://r.jina.ai/')) return new Response('<html><app-root></app-root></html>'); // the SPA shell
      proxied += 1;
      return new Response(answers.shift() ?? empty);
    };
    const logged: string[] = [];
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
    const live = { SKIP_FRANKLIN: 'false', TICKERS: 'FLCH', CONCURRENCY: '1' };
    answers = [empty, pageMd().replace('Markdown Content:', 'Markdown Content:\n# Franklin FTSE Switzerland ETF - FLCH')];
    await run(live);
    expect(proxied).toBe(2);
    const meta = JSON.parse(readFileSync(join(feed(), 'funds', 'FLCH', 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ nav: { value: 21.99 }, aum: { source: 'official product page Total Net Assets' } });
    expect(process.exitCode).toBe(0);
    const published = snapshot(feed());
    proxied = 0;
    logged.length = 0;
    answers = [empty, empty];
    await run(live);
    expect(proxied).toBe(2); // one retry, never a third request
    expect(snapshot(feed())).toEqual(published);
    expect(logged.some((line) => line.includes('FLCH') && line.includes('did not contain expected content'))).toBe(true);
  }), 30_000);
});

describe('pipeline 3', () => {
  test('Distribution Rate and computed premium: labelled, dated, zero diff on rerun, kept on a partial page, null when the dates differ', inTempRoot(async () => {
    let page = pageMd({ rate: true });
    let yahooDay = Date.UTC(2026, 9, 2, 20) / 1000;
    (globalThis as any).fetch = async (input: unknown) => {
      const url = String(input);
      if (url.includes('finance/chart')) {
        return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 22.4, regularMarketTime: yahooDay }, timestamp: [yahooDay], indicators: { quote: [{ close: [22.4], volume: [1] }], adjclose: [{ adjclose: [22.4] }] }, events: {} }] } }));
      }
      if (url.includes('franklintempleton.com/investments')) return new Response(page);
      if (url.includes('sitemap')) return new Response('<urlset/>');
      throw new Error('offline');
    };
    const live = { SKIP_FRANKLIN: 'false', SKIP_YAHOO: 'false', TICKERS: 'FLCH', CONCURRENCY: '1' };
    const logged: string[] = [];
    const run2 = async () => { logged.length = 0; console.log = (...args: unknown[]) => { logged.push(args.join(' ')); }; await run(live); };
    const meta = () => JSON.parse(readFileSync(join(feed(), 'funds', 'FLCH', 'meta.json'), 'utf8'));
    const row = () => index().funds.find((item: any) => item.ticker === 'FLCH');

    // official page figures: the Distribution Rate beats an indicated yield, the premium is computed from the page's own NAV and closing price
    await run2();
    expect(meta().yields).toMatchObject({ dividendYield: 1.18, dividendYieldKind: 'Distribution Rate at NAV published on the official Franklin fund page as of Oct 2 2026', dividendYieldAsOfDate: '2026-10-02' });
    expect(meta().premiumDiscount).toMatchObject({ value: -0.41, display: '-0.41%', asOfDate: '2026-10-02', source: PREMIUM_COMPUTED_SOURCE, priceSource: 'official product page closing Market Price' });
    expect(row()).toMatchObject({ premiumDiscountValue: -0.41, premiumDiscountAsOfDate: '2026-10-02', dividendYieldSource: 'official' });
    expect(row().metrics).toMatchObject({ dividendYield: 1.18, dividendYieldBasis: 'official-distribution-rate' });
    const published = snapshot(feed());

    // an identical rerun writes nothing
    await run2();
    expect(snapshot(feed())).toEqual(published);

    // a partial page keeps the published rate and the premium exactly (zero diff), one notice
    page = pageMd({ portfolio: false, pricing: false, secYield: false });
    await run2();
    expect(snapshot(feed())).toEqual(published);
    expect(logged.filter((line) => line.startsWith('[ kept'))).toHaveLength(1);
    expect(logged.find((line) => line.startsWith('[ kept'))).toContain('Distribution Rate');
    expect(row().metrics).toMatchObject({ dividendYield: 1.18, dividendYieldBasis: 'official-distribution-rate' });

    // a full page without a market price: the Yahoo close of the NAV date; the rate is an honest null, not an indicated value
    page = pageMd({ marketPrice: false, nav: '22.50' });
    await run2();
    expect(meta().yields.dividendYield).toBeNull();
    expect(row().metrics).toMatchObject({ dividendYield: null, dividendYieldBasis: null });
    expect(meta().premiumDiscount).toMatchObject({ value: -0.44, priceSource: 'Yahoo Finance regular-session close of the NAV date', source: PREMIUM_COMPUTED_SOURCE });

    // the Yahoo close belongs to another day than the NAV: never mix the dates
    yahooDay = Date.UTC(2026, 9, 1, 20) / 1000;
    await run2();
    expect(meta().premiumDiscount).toMatchObject({ value: null, display: '—', asOfDate: null });
    expect(row()).toMatchObject({ premiumDiscountValue: null, premiumDiscountAsOfDate: null });
  }), 60000);

  test('a failed source keeps the published fund exactly', inTempRoot(async () => {
    await run();
    const metaPath = join(feed(), 'funds', 'FLCH', 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.returns.performanceAsOf = '2026-08-31';
    meta.history = { ...meta.history, totalRows: 5 };
    writeFileSync(metaPath, JSON.stringify(meta, null, 1) + '\n');
    const before = snapshot(join(feed(), 'funds'));
    offlineFetch();
    await run({ SKIP_FRANKLIN: 'false', TICKERS: 'FLCH' });
    expect(snapshot(join(feed(), 'funds'))).toEqual(before);
    expect(process.exitCode).toBe(1);
  }), 120000);

  test('fresh holdings that fail the guard keep the fund exactly as published and report it failed', inTempRoot(async () => {
    let page = pageMd();
    (globalThis as any).fetch = async (input: unknown) => {
      const url = String(input);
      if (url.includes('franklintempleton.com/investments')) return new Response(page);
      if (url.includes('sitemap')) return new Response('<urlset/>');
      throw new Error('offline');
    };
    const live = { SKIP_FRANKLIN: 'false', TICKERS: 'FLCH', CONCURRENCY: '1' };
    await run(live);
    expect(process.exitCode).toBe(0);
    const published = snapshot(feed());
    expect(JSON.parse(published['/funds/FLCH/meta.json']).holdings.totalRows).toBe(2);
    // a newer NAV next to a holdings table whose weights are dashes: nothing of the fund is written
    page = pageMd({ nav: '22.50' }).replace('| 60.00 |', '| — |').replace('| 40.00 |', '| — |');
    const logged: string[] = [];
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
    await run(live);
    expect(snapshot(feed())).toEqual(published);
    expect(process.exitCode).toBe(1);
    expect(logged.some((line) => line.includes('holdings guard: only 0 of 2 rows have a numeric weight'))).toBe(true);
    // the same page with sound weights is written
    page = pageMd({ nav: '22.50' });
    await run(live);
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(feed(), 'funds', 'FLCH', 'meta.json'), 'utf8')).nav.value).toBe(22.5);
  }), 60000);

  test('a closed fund is never fetched or reported failed: its files stay as published, its index row says closed, a rerun writes nothing', inTempRoot(async () => {
    const entry = { ticker: 'FLCH', closed: '2026-10-01', source: 'https://www.sec.gov/Archives/edgar/data/1655589/notice.htm' };
    expect(() => closedFund([{ ...entry, closed: 'soon' }], 'FLCH')).toThrow('CLOSED_FUNDS');
    expect(closedFund([entry], 'flch')).toEqual(entry);
    let page = pageMd();
    const calls: string[] = [];
    (globalThis as any).fetch = async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('franklintempleton.com/investments')) return new Response(page);
      if (url.includes('sitemap')) return new Response('<urlset/>'); // the live catalog no longer lists FLCH
      throw new Error('offline');
    };
    const live = { SKIP_FRANKLIN: 'false', TICKERS: 'FLCH', CONCURRENCY: '1' };
    await run();
    await run(live);
    const first = snapshot(feed());
    expect(JSON.parse(first['/funds/FLCH/meta.json']).holdings.totalRows).toBe(2);
    page = pageMd({ nav: '22.50' }).replace('| 60.00 |', '| — |').replace('| 40.00 |', '| — |'); // the guard would reject these holdings
    CLOSED_FUNDS.push(entry);
    try {
      calls.length = 0;
      const logged: string[] = [];
      console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
      await run(live);
      expect(calls.filter((url) => /flch/i.test(url))).toEqual([]);
      expect(process.exitCode).not.toBe(1);
      expect(logged.some((line) => line.startsWith('[ closed   ] FLCH'))).toBe(true);
      const closed = snapshot(feed());
      for (const path of Object.keys(first)) if (path !== '/index.json') expect([path, closed[path]]).toEqual([path, first[path]]);
      const rows = index().funds;
      expect(rows).toHaveLength(JSON.parse(first['/index.json']).funds.length);
      expect(rows.find((row: any) => row.ticker === 'FLCH')).toMatchObject({ status: 'closed', closedDate: '2026-10-01', closedSource: entry.source, dataFile: './funds/FLCH/meta.json' });
      expect(rows.filter((row: any) => row.status === 'closed')).toHaveLength(1);
      await run();
      expect(snapshot(feed())).toEqual(closed);
    } finally {
      CLOSED_FUNDS.splice(CLOSED_FUNDS.indexOf(entry), 1);
    }
  }), 60000);
});

describe('pipeline 4', () => {
  test('N-PORT fallback: searched by the series ID, a filing of another series in the same trust is never used', inTempRoot(async () => {
    // FLCH is series S000059502 of Franklin Templeton ETF Trust (CIK 0001655589); S000068596 is the trust's Treasury bond ETF
    const filing = (series: string, name: string) => `<edgarSubmission><genInfo><regCik>0001655589</regCik><seriesId>${series}</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><invstOrSecs><invstOrSec><name>${name}</name><cusip>123456789</cusip><balance>10</balance><valUSD>600</valUSD><pctVal>60</pctVal></invstOrSec><invstOrSec><name>${name} 2</name><cusip>223456789</cusip><balance>5</balance><valUSD>400</valUSD><pctVal>40</pctVal></invstOrSec></invstOrSecs></edgarSubmission>`;
    const atom = (accession: string) => `<feed><entry><content><accession-number>${accession}</accession-number><filing-date>2026-08-27</filing-date><filing-type>NPORT-P</filing-type><period>2026-06-30</period></content></entry></feed>`;
    const own = '0000940400-26-099001';
    const other = '0000940400-26-099002';
    const filings: Record<string, string> = { [own]: filing('S000059502', 'NESTLE SA'), [other]: filing('S000068596', 'US TREASURY NOTE') };
    let listed: Record<string, string> = { 'CIK=S000059502': own, 'CIK=0001655589': other }; // the trust lists another series first
    (globalThis as any).fetch = async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('https://r.jina.ai/')) throw new Error('offline');
      if (url.endsWith('company_tickers_mf.json')) return new Response(JSON.stringify({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1655589, 'S000059502', 'C000194936', 'FLCH']] }));
      if (url.endsWith('company_tickers.json')) return new Response('{}');
      if (url.includes('browse-edgar')) {
        const key = Object.keys(listed).find((k) => url.includes(k));
        return new Response(key ? atom(listed[key]) : '<feed/>');
      }
      const accession = Object.keys(filings).find((a) => url.endsWith(`/${a}.txt`));
      return accession ? new Response(filings[accession]) : new Response('not found', { status: 404 }); // the known accession of FLCH is gone
    };
    const sourceOf = () => JSON.parse(readFileSync(join(feed(), 'funds', 'FLCH', 'meta.json'), 'utf8')).holdings.source;
    resetSecCachesForTest();
    try {
      await run({ EDGAR_FALLBACK: 'true', TICKERS: 'FLCH', CONCURRENCY: '1' });
      expect(sourceOf()).toContain(own);
      const published = snapshot(feed());
      // now even the series search hands back another series' filing: it is ignored and the published holdings stay
      listed = { 'CIK=S000059502': other, 'CIK=0001655589': other };
      await run({ EDGAR_FALLBACK: 'true', TICKERS: 'FLCH', CONCURRENCY: '1' });
      expect(snapshot(feed())).toEqual(published);
    } finally {
      resetSecCachesForTest();
    }
  }), 60000);

  test('N-PORT: the newest filing of the series, only when newer than the published holdings; a failed SEC table is asked again', inTempRoot(async () => {
    // FLCH (series S000059502) and FLCA (S000059509) are pre-seeded series; 0000940400-26-035168 was FLCH's pinned 2026-06-30 filing
    const filing = (series: string, period: string, name: string) => `<edgarSubmission><genInfo><regCik>0001655589</regCik><seriesId>${series}</seriesId><repPdDate>${period}</repPdDate></genInfo><invstOrSecs><invstOrSec><name>${name}</name><cusip>123456789</cusip><balance>10</balance><valUSD>600</valUSD><pctVal>60</pctVal></invstOrSec><invstOrSec><name>${name} 2</name><cusip>223456789</cusip><balance>5</balance><valUSD>400</valUSD><pctVal>40</pctVal></invstOrSec></invstOrSecs></edgarSubmission>`;
    const atom = (accession: string, period: string) => `<feed><entry><content><accession-number>${accession}</accession-number><filing-date>${period}</filing-date><filing-type>NPORT-P</filing-type><period>${period}</period></content></entry></feed>`;
    const filings: Record<string, string> = {
      '0000940400-26-035168': filing('S000059502', '2026-06-30', 'PINNED JUNE'),
      '0000940400-26-099101': filing('S000059502', '2026-09-30', 'NEWEST SEPTEMBER'),
      '0000940400-26-099102': filing('S000059502', '2026-03-31', 'OLDER MARCH'),
      '0000940400-26-099103': filing('S000059509', '2026-09-30', 'CANADA SEPTEMBER'),
    };
    let listed: Record<string, [string, string]> = { 'CIK=S000059502': ['0000940400-26-099101', '2026-09-30'], 'CIK=S000059509': ['0000940400-26-099103', '2026-09-30'] };
    let tableCalls = 0;
    let tableDown: 'first' | 'always' = 'always';
    (globalThis as any).fetch = async (input: unknown) => {
      const url = String(input);
      if (!url.startsWith('https://www.sec.gov/')) throw new Error('offline'); // proxies
      if (url.endsWith('company_tickers_mf.json')) return ++tableCalls === 1 || tableDown === 'always' ? new Response('busy', { status: 503 }) : new Response('{"fields":[],"data":[]}');
      if (url.endsWith('company_tickers.json')) return new Response('{}');
      if (url.includes('browse-edgar')) {
        const key = Object.keys(listed).find((k) => url.includes(k));
        return new Response(key ? atom(...listed[key]) : '<feed/>');
      }
      // filings live under the registrant's CIK, never under the filer agent (0000940400) that starts the accession
      const accession = Object.keys(filings).find((a) => url === `https://www.sec.gov/Archives/edgar/data/1655589/${a.replace(/-/g, '')}/${a}.txt`);
      return accession ? new Response(filings[accession]) : new Response('not found', { status: 404 });
    };
    const holdingsOf = (ticker: string) => existsSync(join(feed(), 'funds', ticker, 'meta.json')) ? JSON.parse(readFileSync(join(feed(), 'funds', ticker, 'meta.json'), 'utf8')).holdings : null;
    resetSecCachesForTest();
    try {
      // a failed fund ticker table is asked once more later in the run, then no more
      await run({ EDGAR_FALLBACK: 'true', TICKERS: 'FLCA,FLCH', CONCURRENCY: '1' });
      expect([tableCalls, holdingsOf('FLCA')?.totalRows ?? 0, holdingsOf('FLCH')?.totalRows ?? 0]).toEqual([2, 0, 0]);
      // the preload fails, the fund asks again; every series is looked up on EDGAR, so the newest filing wins over the
      // once pinned June accession
      resetSecCachesForTest();
      tableCalls = 0;
      tableDown = 'first';
      await run({ EDGAR_FALLBACK: 'true', TICKERS: 'FLCH', CONCURRENCY: '1' });
      expect(tableCalls).toBe(2);
      expect(holdingsOf('FLCH').source).toContain('0000940400-26-099101');
      const published = snapshot(feed());
      // an older filing never replaces the published September holdings
      listed = { 'CIK=S000059502': ['0000940400-26-099102', '2026-03-31'], 'CIK=S000059509': ['0000940400-26-099103', '2026-09-30'] };
      await run({ EDGAR_FALLBACK: 'true', TICKERS: 'FLCH', CONCURRENCY: '1' });
      expect(snapshot(feed())).toEqual(published);
      expect(nportIsNewer('2026-09-30', { totalRows: 2, asOfDate: '2026-06-30' })).toBe(true);
      expect(nportIsNewer('2026-06-30', { totalRows: 2, asOfDate: '2026-06-30' })).toBe(false);
      expect(nportIsNewer('n/a', { totalRows: 2, asOfDate: '2026-06-30' })).toBe(false);
      expect(nportIsNewer('2026-03-31', { totalRows: 0 })).toBe(true); // nothing published yet
    } finally {
      resetSecCachesForTest();
    }
  }), 60000);

  test('a new fund that no source answered or whose holdings fail the guard is failed with a catalog-only row and no files', inTempRoot(async () => {
    const metricsKeys = Object.keys(buildMetrics({ inception: null, dividendYield: null, secYield: null, performanceAsOf: null, returns: noReturns }));
    const catalogOnly = (reason: RegExp, logged: string[]) => {
      expect(existsSync(join(feed(), 'funds', 'FLCH', 'meta.json'))).toBe(false);
      const row = index().funds.find((item: any) => item.ticker === 'FLCH');
      expect([row.dataFile, row.holdings, Object.keys(row.metrics), row.metrics.returnsBasis]).toEqual([null, 0, metricsKeys, RETURNS_BASIS]);
      expect(process.exitCode).toBe(1);
      expect(logged.some((line) => /FLCH +failed/.test(line) && reason.test(line))).toBe(true);
    };
    const logged: string[] = [];
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
    // the product page and Yahoo fail
    offlineFetch();
    await run({ SKIP_FRANKLIN: 'false', SKIP_YAHOO: 'false', TICKERS: 'FLCH' });
    catalogOnly(/no source returned data/, logged);
    // only N-PORT is asked and gives nothing: no empty meta.json reported updated
    logged.length = 0;
    resetSecCachesForTest();
    await run({ EDGAR_FALLBACK: 'true', TICKERS: 'FLCH' });
    resetSecCachesForTest();
    catalogOnly(/N-PORT: no usable filing/, logged);
    // the page answers, but its holdings fail the guard
    let page = pageMd().replace('| 60.00 |', '| — |').replace('| 40.00 |', '| — |');
    (globalThis as any).fetch = async (input: unknown) => {
      if (String(input).includes('franklintempleton.com/investments')) return new Response(page);
      throw new Error('offline');
    };
    logged.length = 0;
    await run({ SKIP_FRANKLIN: 'false', TICKERS: 'FLCH', CONCURRENCY: '1' });
    catalogOnly(/holdings guard/, logged);
    // the catalog-only row is never the published state: sound holdings are written as for any new fund
    page = pageMd();
    await run({ SKIP_FRANKLIN: 'false', TICKERS: 'FLCH', CONCURRENCY: '1' });
    expect(process.exitCode).toBe(0);
    expect(index().funds.find((item: any) => item.ticker === 'FLCH')).toMatchObject({ dataFile: './funds/FLCH/meta.json', holdings: 2 });
  }), 120000);

  test('stale pages are removed only after the new meta.json exists', inTempRoot(async () => {
    await run();
    const dir = join(feed(), 'funds', 'FLCH');
    mkdirSync(join(dir, 'holdings'), { recursive: true });
    writeFileSync(join(dir, 'holdings', '009.json'), '{}');
    await run({ TICKERS: 'FLCH' });
    expect(existsSync(join(dir, 'holdings', '009.json'))).toBe(false);
    expect(existsSync(join(dir, 'meta.json'))).toBe(true);
  }), 30_000);

  test('AUM date across runs: the same value never moves its published date back or forward, a new value takes the page date', inTempRoot(async () => {
    let page = pageMd();
    (globalThis as any).fetch = async (input: unknown) => {
      const url = String(input);
      if (url.includes('finance/chart')) {
        const t = Math.floor(Date.now() / 86_400_000) * 86_400;
        return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 22, regularMarketTime: t }, timestamp: [t - 86_400, t], indicators: { quote: [{ close: [21.5, 22], volume: [1, 1] }], adjclose: [{ adjclose: [21.5, 22] }] }, events: {} }] } }));
      }
      if (url.includes('franklintempleton.com/investments')) return new Response(page);
      if (url.includes('sitemap')) return new Response('<urlset/>');
      throw new Error('offline');
    };
    const live = { SKIP_FRANKLIN: 'false', SKIP_YAHOO: 'false', TICKERS: 'FLCH', CONCURRENCY: '1' };
    const aum = () => JSON.parse(readFileSync(join(feed(), 'funds', 'FLCH', 'meta.json'), 'utf8')).aum;
    const assets = (date: string, value: string) => pageMd().replace('As of 10/02/2026  (Updated Daily)\nTotal Net Assets $53.87 Million',
      `As of ${date}  (Updated Daily)\nTotal Net Assets $${value} Million\n### Portfolio Statistics\nAs of 09/30/2026  (Updated Monthly)`);
    page = assets('10/25/2026', '53.87');
    await run(live);
    expect(aum()).toMatchObject({ value: 53.87e6, asOfDate: '2026-10-25', source: 'official product page Total Net Assets' });
    const published = snapshot(feed());
    // the issuer re-dates the unchanged value: an older and a newer stamp both write nothing
    for (const date of ['10/22/2026', '10/27/2026']) {
      page = assets(date, '53.87');
      await run(live);
      expect(snapshot(feed())).toEqual(published);
    }
    page = assets('10/27/2026', '54.10');
    await run(live);
    expect(aum()).toMatchObject({ value: 54.1e6, asOfDate: '2026-10-27' });
  }), 60_000);
});

describe('network', () => {
  // runs `urls` through `concurrency` workers on a counting fetch stub
  async function lanes(concurrency: number, sleepSeconds: number, urls: string[]) {
    let inFlight = 0;
    let peak = 0;
    const starts: number[] = [];
    (globalThis as any).fetch = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 100));
      inFlight -= 1;
      return new Response('ok');
    };
    configurePacing(concurrency, sleepSeconds);
    const queue = [...urls];
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (queue.length) await fetchText(queue.shift()!, 'test', { maxRetries: 0 } as any);
    }));
    return { peak, starts };
  }
  const direct = Array.from({ length: 6 }, (_, i) => `https://example.test/${i}`);

  test('in-flight peak is 1 at CONCURRENCY=1 and N at N, even with REQUEST_SLEEP > 0', async () => {
    expect((await lanes(1, 0.02, direct)).peak).toBe(1);
    expect((await lanes(3, 0.02, direct)).peak).toBe(3);
    let now = 0;
    const waits: number[] = [];
    const gate = createRequestGate(2, 1000, () => now, async (ms) => { waits.push(ms); });
    for (let i = 0; i < 4; i += 1) await gate();
    expect(waits).toEqual([1000, 1000]);
  });

  test('proxy requests stay globally serialized with a minimum 3.2s gap', async () => {
    const { peak, starts } = await lanes(2, 0, ['https://r.jina.ai/https://a.test', 'https://r.jina.ai/https://b.test']);
    expect(peak).toBe(1);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(3100);
  }, 15000);

  test('a body that never finishes is cut by the deadline and retries are bounded by MAX_RETRIES', async () => {
    let calls = 0;
    let signals = 0;
    (globalThis as any).fetch = async (_url: string, init?: { signal?: AbortSignal }) => {
      calls += 1;
      if (init?.signal) signals += 1;
      const body = new ReadableStream({
        start(controller) { init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason)); },
      });
      return new Response(body, { status: 200 });
    };
    configurePacing(1, 0);
    const slow = fetchText('https://example.test/slow', 'slow', { maxRetries: 1, fetchTimeoutMs: 80 } as any).then(() => 'resolved', () => 'rejected');
    // a generous guard so a missing deadline fails the test instead of hanging the run
    expect(await Promise.race([slow, new Promise((resolve) => setTimeout(resolve, 10_000, 'hung'))])).toBe('rejected');
    expect([calls, signals]).toEqual([2, 2]);
    expect(FETCH_TIMEOUT_MS).toBe(45_000);
  });
});

describe('network 2', () => {
  test('HISTORY_RANGE shrinks the Yahoo request with explicit period1/period2', () => {
    expect([isHistoryRange('max'), isHistoryRange('5y'), isHistoryRange('6mo'), isHistoryRange('ytd')]).toEqual([true, true, false, false]);
    expect(yahooChartUrl('FLIN', 'max', 1700000000)).toContain('period1=0&period2=1700000000');
    const url = yahooChartUrl('FLIN', '5y', 1700000000);
    expect(url).toContain(`period1=${Math.floor(1700000000 - 5 * 365.25 * 86400)}&period2=1700000000`);
    expect(url).not.toContain('range=');
  });

  test('the SEC contact is sent to sec.gov only and redacted in logs', () => {
    const contact = 'daggerok ETF feed daggerok@gmail.com';
    expect(userAgentFor('https://www.sec.gov/Archives/x', contact)).toBe(contact);
    expect(userAgentFor('https://data.sec.gov/submissions/CIK1.json', contact)).toBe(contact);
    for (const url of ['https://r.jina.ai/https://www.sec.gov/x', 'https://api.allorigins.win/raw?url=a', fundUrl(1, 'x', 'X'), 'https://query1.finance.yahoo.com/v8']) {
      expect(userAgentFor(url, contact)).not.toContain('daggerok');
      expect(userAgentFor(url, undefined)).not.toContain('daggerok');
    }
    expect(userAgentFor('https://query1.finance.yahoo.com/v8', 'Mozilla/5.0 browser')).toBe('Mozilla/5.0 browser');
    expect(read('scripts/update-data.ts')).toMatch(/TOKEN\|PASSWORD\|SECRET\|COOKIE\|SEC_UA/);
  });

  test('system CA: certificate errors are detected and the script restarts once', async () => {
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(new Error('unable to get local issuer certificate'))).toBe(true);
    expect(isCertError(Object.assign(new Error('fetch failed'), { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
    for (const other of [{ code: 'ECONNRESET' }, new Error('HTTP 403 Forbidden'), null]) expect(isCertError(other)).toBe(false);

    const certError = Object.assign(new Error('fetch failed'), { cause: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } });
    let next: () => Promise<Response> = async () => new Response('ok');
    const stub = (async () => next()) as unknown as typeof fetch;
    let calls = 0;
    const reexec = (() => { calls++; return undefined as never; }) as () => never;

    globalThis.fetch = stub;
    installSystemCa('false', reexec, false);
    installSystemCa('auto', reexec, true);
    expect([globalThis.fetch === stub, calls]).toEqual([true, 0]);
    installSystemCa('true', reexec, false);
    expect(calls).toBe(1);
    globalThis.fetch = stub; // a real reexec never returns; the mock falls through

    installSystemCa('auto', reexec, false);
    expect(globalThis.fetch).not.toBe(stub);
    expect(await (await fetch('https://example.invalid')).text()).toBe('ok');
    next = async () => { throw new Error('ECONNRESET'); };
    await expect(fetch('https://example.invalid')).rejects.toThrow('ECONNRESET');
    expect(calls).toBe(1);
    next = async () => { throw certError; };
    await fetch('https://example.invalid');
    expect(calls).toBe(2);
  });
});
