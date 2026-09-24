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
