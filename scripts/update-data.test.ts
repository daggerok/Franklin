// Bun's test runner provides these globals at runtime.
// @ts-ignore the repository intentionally keeps runtime dependencies at zero.
import { describe, expect, test } from 'bun:test';
import {
  parseRange,
  parseAumRange,
  numberOrNull,
  toIsoDate,
  normalizeNumberText,
  parseCatalogText,
  parseProductPage,
  parseChart,
  parseNport,
  parseEdgarAtomFilings,
  parseFundTickerMap,
  frequencyCodeLabel,
  inferDistributionFrequency,
  normalizeDistributionFrequency,
  paymentsPerYearFor,
  resolveFundName,
  cleanFundName,
  fundNameFromPageSlug,
  resolveCategory,
  tenYearEligible,
  plausibleSecYield,
  plausibleDividendYield,
  plausiblePremiumDiscount,
  plausibleBenchmark,
  annualizedToTotal,
  totalToAnnualized,
  stripProxyPreamble,
  htmlToText,
  parseFranklinHoldings,
} from './update-data';

describe('parseRange', () => {
  test('empty and \":\" mean no restriction', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
  });

  test('inclusive bounds', () => {
    expect(parseRange('1:5', 'X')).toEqual({ min: 1, max: 5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(parseRange(':3', 'X')).toEqual({ min: undefined, max: 3 });
  });

  test('percent signs and $ signs are optional', () => {
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('$1:$2', 'X')).toEqual({ min: 1, max: 2 });
  });

  test('colonless values are rejected', () => {
    expect(() => parseRange('15', 'X')).toThrow(/colon is required/);
  });

  test('min greater than max is rejected', () => {
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
  });
});

describe('parseAumRange', () => {
  test('empty and \":\" mean no restriction', () => {
    expect(parseAumRange('')).toBeUndefined();
    expect(parseAumRange(':')).toBeUndefined();
  });

  test('numeric bounds with K/M/B/T suffixes', () => {
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('1B:')).toEqual({ min: 1_000_000_000, max: undefined });
  });

  test('preset bounds', () => {
    expect(parseAumRange('nano')).toEqual({ min: 0, max: 10_000_000 });
    expect(parseAumRange('micro')).toEqual({ min: 10_000_000, max: 300_000_000 });
    expect(parseAumRange('small')).toEqual({ min: 300_000_000, max: 2_000_000_000 });
    expect(parseAumRange('mid')).toEqual({ min: 2_000_000_000, max: 10_000_000_000 });
    expect(parseAumRange('large')).toEqual({ min: 10_000_000_000, max: undefined });
  });

  test('invalid bound throws', () => {
    expect(() => parseAumRange('invalid:1B')).toThrow();
  });
});

describe('numberOrNull', () => {
  test('parses numbers with $ and %', () => {
    expect(numberOrNull('$1,234.56')).toBe(1234.56);
    expect(numberOrNull('0.39%')).toBe(0.39);
    expect(numberOrNull('-0.40%')).toBe(-0.4);
    expect(numberOrNull('—')).toBeNull();
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull('N/A')).toBeNull();
  });
});

describe('toIsoDate', () => {
  test('US and ISO dates', () => {
    expect(toIsoDate('02/06/2018')).toBe('2018-02-06');
    expect(toIsoDate('07/25/2023')).toBe('2023-07-25');
    expect(toIsoDate('2026-08-31')).toBe('2026-08-31');
    expect(toIsoDate('Feb 6 2018')).not.toBe('');
  });
});

describe('normalizeNumberText', () => {
  test('expands scientific notation', () => {
    expect(normalizeNumberText('2.97E8')).toBe('297000000');
    expect(normalizeNumberText('2.97057744E8')).toBe('297057744');
    expect(normalizeNumberText('—')).toBe('—');
  });
});

describe('Franklin catalog parsing', () => {
  const catalogMarkdown = `
Title: Exchange Traded Funds | Franklin Templeton

Markdown Content:
| Checkbox | [BrandywineGLOBAL - U.S. Fixed Income ETF  \\- **USFI**](https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/36405/SINGLCLASS/brandywine-global-u-s-fixed-income-etf/USFI) | -0.40% | 3.47 | 4.19 | — | 3.54<br>07/25/2023 | Gross<br>Net<br>0.39% <br>0.39% | $9.53 Million | Download |
| Checkbox | [Franklin FTSE India ETF  \\- **FLIN**](https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26348/SINGLCLASS/franklin-ftse-india-etf/FLIN) | -10.39% | -3.94 | 5.33 | 3.05 | 5.93<br>02/06/2018 | Gross<br>Net<br>0.19% <br>0.19% | $2.60 Billion | Download |
| Checkbox | [Franklin FTSE Japan ETF  \\- **FLJP**](https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26357/SINGLCLASS/franklin-ftse-japan-etf/FLJP) | 20.28% | 26.80 | 19.32 | 9.79 | 8.08<br>11/02/2017 | Gross<br>Net<br>0.09% <br>0.09% | $4.04 Billion | Download |
`;

  test('parses tickers and basic metrics', () => {
    const funds = parseCatalogText(catalogMarkdown);
    expect(funds.length).toBe(3);
    const tickers = funds.map((f) => f.ticker).sort();
    expect(tickers).toEqual(['FLIN', 'FLJP', 'USFI']);
    const flin = funds.find((f) => f.ticker === 'FLIN')!;
    expect(flin.name).toContain('India');
    expect(flin.ter).toBe(0.19);
    expect(flin.netAssets).toBe(2.6e9);
    expect(flin.inception).toBe('2018-02-06');
    expect(flin.returns.ytd).toBe(-10.39);
    expect(flin.returns.yr1).toBe(-3.94);
    const usfi = funds.find((f) => f.ticker === 'USFI')!;
    expect(usfi.netAssets).toBe(9.53e6);
    expect(usfi.ter).toBe(0.39);
  });

  test('throws when no rows', () => {
    expect(() => parseCatalogText('no etfs here')).toThrow(/no ETF rows/);
  });

  test('parses FLTW with % signs and Upcoming Liquidation note', () => {
    const md = `
| Checkbox | [Franklin FTSE Taiwan ETF  \\- **FLTW**](https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26351/SINGLCLASS/franklin-ftse-taiwan-etf/FLTW)<br>Upcoming Liquidation <br>Upcoming Liquidation Click the fund name for more information.<br>**Click the fund name for more information.** | 81.22% | 95.62% | 43.94% | 21.04% | 19.77%<br>11/02/2017 | Gross<br>Net<br>0.19% <br>0.19% | $4.16 Billion | Download |
`;
    const funds = parseCatalogText(md);
    expect(funds.length).toBe(1);
    const fltw = funds[0];
    expect(fltw.ticker).toBe('FLTW');
    expect(fltw.returns.ytd).toBe(81.22);
    expect(fltw.returns.yr1).toBe(95.62);
    expect(fltw.returns.yr3).toBe(43.94);
    expect(fltw.returns.yr5).toBe(21.04);
    expect(fltw.ter).toBe(0.19);
    expect(fltw.netAssets).toBe(4.16e9);
  });
});

describe('Franklin product page parsing', () => {
  const productPage = `
Title: FLIN Franklin FTSE India ETF - FLIN
Markdown Content:
# FLIN Franklin FTSE India ETF
Equity  Indexed
## Overview
### Fund description
Seeks to provide investment results that closely correspond to FTSE India Index
Benchmark FTSE India Capped Index-NR
Fund Inception Date 02/06/2018
Listing Exchange NYSE Arca
Dividend Frequency, if any Semiannually
### Expenses & Fees
As of 08/01/2026
Gross Expense Ratio 0.19%
Net Expense Ratio 0.19%
### Identifiers
Ticker FLIN
CUSIP Code 35473P769
ISIN Code US35473P7693
Bloomberg Code FLIN US
## Top Sectors
As of 09/22/2026 % of Total
| Financials 28.62% |
### Additional Fund Info
Morningstar Category India Equity
Fiscal Year End March 31
ETF Type Indexed
### Trading Characteristics
As of 09/22/2026
Shares Outstanding 74,700,000
Daily Volume 148,140
## Price
As of 09/23/2026
NAV $34.85
Market Price $34.82
## Distributions
as of 08/31/2026
Distribution Frequency Quarterly
SEC 30-Day Yield 2.09%
12-Month Yield 0.42%
`;

  test('parses identifiers and metrics', () => {
    const summary = parseProductPage(productPage, 'FLIN');
    expect(summary.cusip).toBe('35473P769');
    expect(summary.isin).toBe('US35473P7693');
    expect(summary.exchange).toContain('NYSE');
    expect(summary.totalExpenseRatio).toBe(0.19);
    expect(summary.inception).toBe('2018-02-06');
    expect(summary.morningstarCategory).toBe('India Equity');
    expect(summary.distributionFrequency).toContain('Quarterly');
    expect(summary.secYield).toBe(2.09);
    // "NAV $34.85" shares a line with its label in the real page markdown.
    expect(summary.nav).toBe(34.85);
    expect(summary.marketPrice).toBe(34.82);
  });

  test('parses YTD when the value sits behind a footnote sentence', () => {
    const page = `
# TEST  Franklin Test ETF
## Price
As of 09/23/2026
NAV $20.00
YTD Total Returns At NAV [1]
[1] The fund's total return assumes reinvestment of distributions and does not
reflect brokerage commissions, which would reduce returns.
4.20%
As of 09/23/2026
`;
    const summary = parseProductPage(page, 'TEST');
    expect(summary.returns.ytd).toBe(4.2);
  });

  test('parses YTD from its own line when the label line carries no value', () => {
    const page = `
# TEST  Franklin Test ETF
## Performance
YTD Total Returns At Market Price [1]
-7.35%
1 Year
12.10%
`;
    const summary = parseProductPage(page, 'TEST');
    expect(summary.returns.ytd).toBe(-7.35);
    expect(summary.returns.yr1).toBe(12.1);
  });

  test('does not borrow the YTD value as a 1-year return', () => {
    const page = `
# TEST  Franklin Test ETF
## Performance
YTD Total Returns At NAV [1]
-7.35%
1 Year
`;
    const summary = parseProductPage(page, 'TEST');
    expect(summary.returns.ytd).toBe(-7.35);
    expect(summary.returns.yr1).toBeNull();
  });

  test('parses FLTW product page with YTD 81.22% and NAV 110.52', () => {
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
    const summary = parseProductPage(fltwPage, 'FLTW');
    expect(summary.nav).toBe(110.52);
    expect(summary.totalNetAssets).toBe(4.16e9);
    expect(summary.totalExpenseRatio).toBe(0.19);
    expect(summary.inception).toBe('2017-11-02');
    expect(summary.returns.ytd).toBe(81.22);
    expect(summary.returns.yr1).toBe(96.86);
    expect(summary.returns.yr3).toBe(44.1);
    expect(summary.returns.yr5).toBe(20.96);
    expect(summary.returns.sinceInception).toBe(19.77);
  });
});

describe('Yahoo chart', () => {
  const payload = {
    chart: {
      result: [
        {
          meta: { exchangeName: 'PCX', regularMarketPrice: 34.85, regularMarketTime: 1720000000, firstTradeDate: 1510000000 },
          timestamp: [1600000000, 1600086400, 1600172800],
          indicators: { quote: [{ close: [10, null, 12], volume: [100, 200, 300] }], adjclose: [{ adjclose: [9, null, 11.5] }] },
          events: { dividends: { '1600086400': { amount: 0.25, date: 1600086400 } }, splits: { '1600172800': { date: 1600172800, numerator: 2, denominator: 1 } } },
        },
      ],
    },
  };

  test('parseChart drops null closes and sorts dividends', () => {
    const chart = parseChart(payload);
    expect(chart.days.length).toBe(2);
    expect(chart.days[0].close).toBe(10);
    expect(chart.dividends.length).toBe(1);
    expect(chart.splits.length).toBe(1);
    expect(chart.exchangeName).toBe('PCX');
  });
});

describe('SEC EDGAR', () => {
  test('parseFundTickerMap', () => {
    const map = parseFundTickerMap({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1655589, 'S000053151', 'C000167258', 'FLIN'], [1655589, 'S000059504', 'C000194938', 'FLMX']] });
    expect(map.get('FLIN')?.cik).toBe('0001655589');
    expect(map.get('FLIN')?.seriesId).toBe('S000053151');
  });

  test('parseEdgarAtomFilings', () => {
    const atom = `<feed><entry><content><accession-number>0001752724-26-000001</accession-number><filing-date>2026-08-27</filing-date><filing-type>NPORT-P</filing-type><filing-href>https://www.sec.gov/Archives/edgar/data/1655589/000175272426000001/0001752724-26-000001-index.htm</filing-href><period>2026-06-30</period></content></entry></feed>`;
    const filings = parseEdgarAtomFilings(atom);
    expect(filings.length).toBe(1);
    expect(filings[0].accession).toBe('0001752724-26-000001');
  });

  test('parseNport', () => {
    const xml = `<edgarSubmission><genInfo><regName>Franklin Templeton ETF Trust</regName><regCik>0001655589</regCik><seriesName>Franklin FTSE India ETF</seriesName><seriesId>S000053151</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>2600000000</netAssets></fundInfo><invstOrSecs><invstOrSec><name>Reliance Industries Ltd</name><cusip>123456789</cusip><ticker>RELIANCE</ticker><balance>100000</balance><valUSD>1000000</valUSD><pctVal>5.48</pctVal><assetCat>EC</assetCat></invstOrSec></invstOrSecs></edgarSubmission>`;
    const parsed = parseNport(xml);
    expect(parsed.seriesId).toBe('S000053151');
    expect(parsed.holdings.length).toBe(1);
    expect(parsed.holdings[0].name).toBe('Reliance Industries Ltd');
  });
});

describe('distribution frequency', () => {
  test('infers frequency from dividends', () => {
    const monthly = Array.from({ length: 12 }, (_, i) => ({ epoch: 1700000000 + i * 30 * 86400, amount: 0.1 }));
    expect(inferDistributionFrequency(monthly)).toBe('Monthly');
    const quarterly = Array.from({ length: 4 }, (_, i) => ({ epoch: 1700000000 + i * 90 * 86400, amount: 0.1 }));
    expect(inferDistributionFrequency(quarterly)).toBe('Quarterly');
    expect(inferDistributionFrequency([])).toBe('—');
  });

  test('frequencyCodeLabel', () => {
    expect(frequencyCodeLabel('Monthly')).toBe('01 - Monthly');
    expect(frequencyCodeLabel('Quarterly')).toBe('04 - Quarterly');
    expect(frequencyCodeLabel('Semi-annually')).toBe('06 - Semi-annually');
    expect(frequencyCodeLabel('Annually')).toBe('12 - Annually');
    expect(frequencyCodeLabel('—')).toBe('00 - —');
  });

  test('normalizeDistributionFrequency strips the page furniture', () => {
    expect(normalizeDistributionFrequency('Annually This fund is an ex-Dividend fund')).toBe('Annually');
    expect(normalizeDistributionFrequency('Monthly This fund is an ex-Dividend fund')).toBe('Monthly');
    expect(normalizeDistributionFrequency(', if any Semiannually')).toBe('Semi-annually');
    expect(normalizeDistributionFrequency(', if any Monthly')).toBe('Monthly');
    expect(normalizeDistributionFrequency('Semi-Annual This fund is an ex-Dividend fund')).toBe('Semi-annually');
    expect(normalizeDistributionFrequency('Quarterly')).toBe('Quarterly');
    expect(normalizeDistributionFrequency('Irregular')).toBe('Irregular');
    expect(normalizeDistributionFrequency('—')).toBe('—');
    expect(normalizeDistributionFrequency('')).toBe('—');
  });

  test('paymentsPerYearFor maps the canonical label', () => {
    expect(paymentsPerYearFor('Monthly')).toBe(12);
    expect(paymentsPerYearFor('Quarterly')).toBe(4);
    expect(paymentsPerYearFor(', if any Semiannually')).toBe(2);
    expect(paymentsPerYearFor('Annually This fund is an ex-Dividend fund')).toBe(1);
    expect(paymentsPerYearFor('—')).toBeNull();
  });
});

describe('published names and categories', () => {
  test('cleanFundName drops the product-page section suffix', () => {
    expect(cleanFundName('Franklin Disruptive Commerce ETF - NAV Return (%)')).toBe('Franklin Disruptive Commerce ETF');
    expect(cleanFundName('Franklin Ethereum ETF - NAV Return')).toBe('Franklin Ethereum ETF');
    expect(cleanFundName('FLTW Franklin FTSE Taiwan ETF - FLTW', 'FLTW')).toBe('Franklin FTSE Taiwan ETF');
    expect(cleanFundName('Franklin FTSE Australia ETF')).toBe('Franklin FTSE Australia ETF');
  });

  test('fundNameFromPageSlug rebuilds the official name', () => {
    expect(fundNameFromPageSlug('https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/31714/SINGLCLASS/franklin-responsibly-sourced-gold-etf/FGDL')).toBe('Franklin Responsibly Sourced Gold ETF');
    expect(fundNameFromPageSlug('https://www.franklintempleton.com/x/products/26360/SINGLCLASS/franklin-ftse-germany-etf/FLGR')).toBe('Franklin FTSE Germany ETF');
    expect(fundNameFromPageSlug('https://www.franklintempleton.com/x/products/123/SINGLCLASS/franklin-u-s-core-bond-etf/FLCB')).toBe('Franklin U.S. Core Bond ETF');
  });

  test('resolveFundName prefers the slug when the scraped name is wrong or truncated', () => {
    const fgdl = 'https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/31714/SINGLCLASS/franklin-responsibly-sourced-gold-etf/FGDL';
    const flca = 'https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26352/SINGLCLASS/franklin-ftse-canada-etf/FLCA';
    const flgr = 'https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/26360/SINGLCLASS/franklin-ftse-germany-etf/FLGR';
    expect(resolveFundName('Franklin ETF and Index Investmen', fgdl, 'FGDL')).toBe('Franklin Responsibly Sourced Gold ETF');
    expect(resolveFundName('Exchange Traded Funds', flca, 'FLCA')).toBe('Franklin FTSE Canada ETF');
    expect(resolveFundName('FLGR ETF', flgr, 'FLGR')).toBe('Franklin FTSE Germany ETF');
    // A correct scraped name is kept as is.
    expect(resolveFundName('Franklin FTSE Taiwan ETF - NAV Return (%)', 'https://www.franklintempleton.com/x/products/26351/SINGLCLASS/franklin-ftse-taiwan-etf/FLTW', 'FLTW')).toBe('Franklin FTSE Taiwan ETF');
  });

  test('resolveCategory rejects page furniture and numeric garbage', () => {
    expect(resolveCategory('India Equity')).toBe('India Equity');
    expect(resolveCategory('Asset Class')).toBe('ETF');
    expect(resolveCategory('As of 09/23/2026 (Updated Daily)')).toBe('ETF');
    expect(resolveCategory('March 31')).toBe('ETF');
    expect(resolveCategory('665.32')).toBe('ETF');
    expect(resolveCategory('287142124.29')).toBe('ETF');
    expect(resolveCategory('page. If so preload resources')).toBe('ETF');
    expect(resolveCategory('Fiscal Year End', 'Ethnic and Thematic')).toBe('ETF');
    expect(resolveCategory('', null, undefined)).toBe('ETF');
  });

  test('tenYearEligible guards the 10-year slot', () => {
    expect(tenYearEligible('2015-01-02')).toBe(true);
    expect(tenYearEligible('2020-02-25')).toBe(false);
    expect(tenYearEligible('2017-11-02')).toBe(false);
    expect(tenYearEligible(null)).toBe(true);
  });
});

describe('yield plausibility', () => {
  test('the label artifact and out-of-range values are dropped', () => {
    expect(plausibleSecYield(30)).toBeNull();
    expect(plausibleSecYield(2.09)).toBe(2.09);
    expect(plausibleSecYield(0)).toBeNull();
    expect(plausibleSecYield(null)).toBeNull();
    expect(plausibleDividendYield(30)).toBe(30);
    expect(plausibleDividendYield(61)).toBeNull();
    expect(plausiblePremiumDiscount(100)).toBeNull();
    expect(plausiblePremiumDiscount(0.12)).toBe(0.12);
    expect(plausiblePremiumDiscount(-6)).toBeNull();
    expect(plausibleBenchmark('FTSE India Capped Index-NR')).toBe('FTSE India Capped Index-NR');
    expect(plausibleBenchmark("index are as of the ETF's/ETP's last trading day before the ")).toBeNull();
    expect(plausibleBenchmark('')).toBeNull();
  });
});

describe('product page yields', () => {
  test('SEC and 12-month yields stay on their percent value', () => {
    const page = `
# FLIN Franklin FTSE India ETF
## Distributions
Distribution Frequency Quarterly
SEC 30-Day Yield 2.09%
12-Month Yield 0.42%
`;
    const summary = parseProductPage(page, 'FLIN');
    expect(summary.secYield).toBe(2.09);
    expect(summary.distributionYield).toBe(0.42);
    expect(summary.distributionFrequency).toBe('Quarterly');
  });

  test('the 30 of "SEC 30-Day Yield" never becomes the SEC yield', () => {
    const page = `
# EZET Franklin Ethereum ETF
## Distributions
| SEC 30-Day Yield | |
| 30-Day Yield as of 08/31/2026 | — |
`;
    const summary = parseProductPage(page, 'EZET');
    expect(summary.secYield).toBeNull();
  });

  test('a fund younger than ten years has no 10-year figure', () => {
    const page = `
# FLTW Franklin FTSE Taiwan ETF
Fund Inception Date 11/02/2017
Market Price Return
NAV Return
- 96.86%1 Year
- 44.10%3 Years
- 20.96%5 Years
- —10 Years
- 19.77%Since Inception
`;
    const summary = parseProductPage(page, 'FLTW');
    expect(summary.returns.yr1).toBe(96.86);
    expect(summary.returns.yr5).toBe(20.96);
    expect(summary.returns.yr10).toBeNull();
    expect(summary.returns.sinceInception).toBe(19.77);
  });
});

describe('math', () => {
  test('annualized to total and back', () => {
    expect(annualizedToTotal(10, 3)).toBeCloseTo(0.331, 2);
    expect(totalToAnnualized(0.331, 3)).toBeCloseTo(10, 0);
  });
});

describe('helpers', () => {
  test('stripProxyPreamble', () => {
    const proxied = 'Title: Foo\nURL Source: https://example.com\nMarkdown Content:\nReal content here';
    expect(stripProxyPreamble(proxied)).toBe('Real content here');
    expect(stripProxyPreamble('Real content')).toBe('Real content');
  });

  test('htmlToText', () => {
    expect(htmlToText('<div>Hello<br>World</div>')).toContain('Hello');
  });
});

describe('Franklin official holdings', () => {
  const flauHoldings = `
Title: FLAU Franklin FTSE Australia ETF
Markdown Content:
# Portfolio Holdings
As of September 21, 2026
| Security Name | Weight (%) | Market Value ($) | Quantity |
| --- | --- | --- | --- |
| BHP GROUP LTD | 13.46% | $27,530,012 | 629,391 |
| COMMONWEALTH BANK OF AUSTRALIA | 8.36% | $17,102,277 | 98,432 |
| CSL LTD | 6.21% | $12,704,123 | 45,123 |
`;

  const flinHoldings = `
Markdown Content:
| Security Name | Weight (%) | Market Value ($) | Notional Exposure | Quantity |
| --- | --- | --- | --- | --- |
| HDFC BANK LTD | 5.29% | 137.14M USD | 137.14M | 5.20M |
| RELIANCE INDUSTRIES LTD | 4.85% | 125.60M USD | 125.60M | 4.10M |
`;

  test('parses FLAU holdings with dollar amounts and commas', () => {
    const holdings = parseFranklinHoldings(flauHoldings);
    expect(holdings.length).toBe(3);
    expect(holdings[0].name).toBe('BHP GROUP LTD');
    expect(holdings[0].pctVal).toBe('13.46');
    expect(Number(holdings[0].valUSD)).toBeCloseTo(27530012, 0);
    expect(Number(holdings[0].balance)).toBeCloseTo(629391, 0);
  });

  test('parses FLIN holdings with M suffix', () => {
    const holdings = parseFranklinHoldings(flinHoldings);
    expect(holdings.length).toBe(2);
    expect(holdings[0].name).toBe('HDFC BANK LTD');
    expect(holdings[0].pctVal).toBe('5.29');
    expect(Number(holdings[0].valUSD)).toBeCloseTo(137140000, -3);
    expect(Number(holdings[0].balance)).toBeCloseTo(5200000, -3);
  });

  test('returns empty when no holdings table', () => {
    expect(parseFranklinHoldings('no table here')).toEqual([]);
  });
});
