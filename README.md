# Franklin

Franklin (Franklin Templeton) ETF holdings to Watchlist. A single-file client-side tool that reads the generated `./api/franklin` static feed (franklintempleton.com ETF listings, per-fund product pages, Yahoo Finance daily history, SEC EDGAR N-PORT-P as holdings fallback) into a searchable ETF/category catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Franklin#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/Franklin/>.

## Updating the static Franklin data

Run the updater with Bun:

```bash
bun test scripts/update-data.test.ts
bun ./scripts/update-data.ts
```

Run `bun ./scripts/update-data.ts -h` (or `--help`) to print every configuration variable with its default and usage examples.

The **Update Franklin ETF data** GitHub Actions workflow exposes the same settings as manual inputs. All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US Franklin ETFs) | `https://www.franklintempleton.com/investments/options/exchange-traded-funds` (Franklin Templeton ETF finder) |
| Product pages per fund | `https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/.../{TICKER}` → CUSIP, ISIN, Bloomberg, exchange, inception, expense ratio, SEC yield, distribution frequency |
| Daily history, distributions | Yahoo Finance public chart API (`/v8/finance/chart/{TICKER}?range=max&interval=1d&events=div\|split`) |
| Fallback | SEC EDGAR N-PORT-P for holdings fallback (Franklin Templeton ETF Trust CIK 0001655589 via `company_tickers_mf.json` + EDGAR atom) |

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` — official YTD and 1-year returns → *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` — published annualized 3Y/5Y/10Y figures → *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` — cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` → *TR 3Y/5Y/10Y*
- `siAnn` — since-inception annualized → *SI Ann.*
- `dividendYield` — 12-month trailing yield or indicated yield (latest distribution × frequency ÷ price)
- `secYield` — 30-day SEC yield when published; `—` otherwise

### Update controls

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | all | Batch size: with a positive value the updater continues after the committed cursor in `api/franklin/update-state.json`; empty or `0` is a full pass — every fund is refreshed in one run. |
| `REQUEST_SLEEP` | `1.5` | Seconds between outgoing request starts (franklintempleton.com and Yahoo throttle; SEC allows 10/s; keep >= 1). |
| `CONCURRENCY` | `3` | Parallel fund workers (keep low to stay polite). |
| `AUM` | `:` | AUM min:max; bounds may be amounts or K/M/B/T suffixes, or nano/micro/small/mid/large preset. |
| `TER` | `:` | Net expense ratio range in percent: min:max. |
| `DIVIDEND_YIELD` | `:` | Dividend-yield percentage range. |
| `SEC_YIELD` | `:` | SEC yield percentage range. |
| `CATEGORY` | `` | Keep only this provider category substring. |
| `TICKERS` | `` | Only update these tickers, separated by spaces or commas. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated price-history JSON page. |
| `HISTORY_RANGE` | `max` | Yahoo chart range for history rows (max, 10y, 5y, ...). |
| `EDGAR_FALLBACK` | `1` | Use SEC EDGAR Form N-PORT-P for full holdings (default on). |
| `SKIP_YAHOO` | `` | Keep previous history and distributions while refreshing catalog/holdings. |
| `SKIP_FRANKLIN` | `` | Keep the previously published official catalog. |
| `STORE_RAW_DOWNLOADS` | `` | Store the official rendered catalog under `api/franklin/raw`. |
| `MAX_RETRIES` | `2` | Retries after the initial request. |
| `PERFORMANCE_YTD`, `PERFORMANCE_1Y`, `PERFORMANCE_3Y`, `PERFORMANCE_5Y`, `PERFORMANCE_10Y` | `` | Annualized return range filters. |
| `TOTAL_RETURN_YTD`, `TOTAL_RETURN_1Y`, `TOTAL_RETURN_3Y`, `TOTAL_RETURN_5Y`, `TOTAL_RETURN_10Y` | `` | Cumulative return range filters. |

### Output layout

```
api/franklin/
  index.json                 # catalog + month-end metrics
  update-state.json          # cursor for bounded runs
  funds/{TICKER}/
    meta.json                # per-fund identifiers, returns, metrics, manifest
    holdings/001.json        # paginated current holdings
    history/001.json         # paginated daily history
```

The UI loads `index.json` first, then lazily fetches `meta.json` and the paginated sheets for the selected watchlist.

### WAF handling

franklintempleton.com is behind a WAF that may return 403 to bare `fetch`. The updater tries a direct fetch with a browser-like `User-Agent` first, then falls back to `https://r.jina.ai/http://...` (Jina AI rendering proxy) which returns Markdown. Both paths are parsed by the same `parseFranklinCatalog` / `parseFranklinProductPage` helpers, so the feed works whether the WAF is active or not. After `ISSUER_DIRECT_DENIAL_LIMIT` consecutive direct 403s, the updater stops trying direct and uses the proxy only.

### Verification

- `bun ./scripts/check-index.ts` — validates that `index.html` contains the required DOM IDs and `app.tsx` contains the required keys.
- `bun test scripts/update-data.test.ts` — unit tests for range parsers, catalog parsing (81 Franklin ETFs markdown table with `**TICKER**` link pattern), product page parsing (CUSIP/ISIN/Bloomberg/NAV/AUM/ER/inception/exchange/SEC yield/distribution frequency), Yahoo chart, SEC EDGAR N-PORT-P parsing.
- `bunx tsc --noEmit` — type-checks the updater.

### GitHub Pages

The repository is configured for GitHub Pages deploy from root (static). The `api/franklin/` folder is committed and served as static JSON alongside `index.html` and `app.tsx` (Babel standalone, no build step).
