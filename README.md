# Franklin

One of the app's features lets you select Franklin ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/franklin` static feed (franklintempleton.com ETF listings, per-fund product pages, Yahoo Finance daily history, SEC EDGAR N-PORT-P as holdings fallback) into a searchable ETF/category catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export - the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Franklin#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/Franklin/>

## Updating the static Franklin data

Run the updater with Bun:

```bash
bun test
bun ./scripts/update-data.ts
```

Run `bun ./scripts/update-data.ts --help` to print every control with its default and examples.

Defaults live in `scripts/update-data.config.json` (every control as a string). Explicit environment variables override the file, and a blank environment variable overrides it with an empty value. The **Update Franklin ETF data** GitHub Actions workflow uses the same `resolveControls` resolver as the CLI: individual `workflow_dispatch` inputs are blank by default and inherit the file, the `advanced` input accepts a JSON object with any control (for example `{"VERBOSE":"true","PERFORMANCE_10Y":"5:"}`), and the precedence is file defaults < advanced JSON < nonblank individual inputs < protected Actions variable/env. GitHub allows at most 25 inputs, so `HISTORY_RANGE`, `PERFORMANCE_10Y`, `TOTAL_RETURN_10Y`, `VERBOSE` and `SEC_UA` are set through `advanced`. Scheduled runs (Sundays at 00:00 UTC) have no inputs and use the file defaults. The real SEC contact belongs in the protected repository Actions variable `SEC_UA`, which wins when nonblank; the config default is `daggerok ETF feed daggerok@gmail.com`. The workflow always writes to `api/franklin` and commits only that directory. All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US Franklin ETFs) | `https://www.franklintempleton.com/investments/options/exchange-traded-funds` (Franklin Templeton ETF finder) |
| Product pages per fund | `https://www.franklintempleton.com/investments/options/exchange-traded-funds/products/.../{TICKER}` -> CUSIP, ISIN, Bloomberg, exchange, inception, expense ratio, SEC yield, distribution frequency |
| Daily history, distributions | Yahoo Finance public chart API (`/v8/finance/chart/{TICKER}?period1=0&interval=1d&events=div\|split`) |
| Fallback | SEC EDGAR N-PORT-P for holdings fallback (Franklin Templeton ETF Trust CIK 0001655589 via `company_tickers_mf.json` + EDGAR atom) |

### Metrics and caveats

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` - official YTD and 1-year returns -> *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` - published annualized 3Y/5Y/10Y figures -> *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized -> *SI Ann.*
- `dividendYield` - 12-month trailing yield or indicated yield (latest distribution x frequency / price), an estimate derived from Yahoo distribution events and the market price
- `secYield` - 30-day SEC yield when published; `-` otherwise

Caveats:

- Official figures come from franklintempleton.com product pages; history, distributions and the derived yield come from Yahoo Finance market prices and are estimates, not official NAV data
- Unavailable values are published as missing, never as `0`; a fund with a missing value for a return filter is kept rather than dropped
- Each fund records its source and as-of metadata in `meta.json`
- franklintempleton.com is behind a WAF that may return 403 to bare `fetch`. The updater tries a direct fetch with a browser-like `User-Agent` first, then falls back to `https://r.jina.ai/http://...` (Jina AI rendering proxy) which returns Markdown. Both paths are parsed by the same `parseFranklinCatalog` / `parseFranklinProductPage` helpers. After `ISSUER_DIRECT_DENIAL_LIMIT` consecutive direct 403s, the updater uses the proxy only
- `HISTORY_RANGE` limits the Yahoo history request window (`max` starts at `period1=0`, the others use Yahoo's `range=`); a short window also shortens the distribution history the derived yield uses
- Output layout:

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

### Update controls

The table matches `scripts/update-data.config.json` exactly.

| Control | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` | Batch size: with a positive value the updater continues after the committed cursor in `api/franklin/update-state.json`; `0` is a full pass over every fund |
| `REQUEST_SLEEP` | `1.5` | Seconds between outgoing request starts (franklintempleton.com and Yahoo throttle; SEC allows 10/s; keep >= 1) |
| `CONCURRENCY` | `3` | Parallel fund workers (keep low to stay polite) |
| `MAX_RETRIES` | `2` | Retries after the initial request (integer >= 1) |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | SEC User-Agent with a declared contact; the protected `SEC_UA` Actions variable overrides it |
| `AUM` | `:` | AUM min:max; bounds may be amounts or K/M/B/T suffixes, or nano/micro/small/mid/large preset |
| `TER` | `:` | Net expense ratio range in percent: min:max |
| `DIVIDEND_YIELD` | `:` | Dividend-yield percentage range |
| `SEC_YIELD` | `:` | SEC yield percentage range |
| `TICKERS` | empty | Only update these tickers, separated by spaces or commas |
| `CATEGORY` | empty | Keep only this provider category substring |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated price-history JSON page (env alias `HISTORICAL_PAGE_SIZE`) |
| `HISTORY_RANGE` | `max` | Yahoo history window: `max`, `ytd`, `1d`, `5d`, `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y` or `10y` |
| `STORE_RAW_DOWNLOADS` | `false` | Store the source pages under `api/franklin/raw` |
| `SKIP_YAHOO` | `false` | Keep previous history and distributions while refreshing catalog and holdings |
| `SKIP_FRANKLIN` | `false` | Keep the previously published official catalog and holdings |
| `EDGAR_FALLBACK` | `true` | Use SEC EDGAR Form N-PORT-P for full holdings when the official ones are unavailable |
| `VERBOSE` | `false` | Print per-fund retry and fallback notices |
| `PERFORMANCE_YTD`, `PERFORMANCE_1Y`, `PERFORMANCE_3Y`, `PERFORMANCE_5Y`, `PERFORMANCE_10Y` | `:` | Annualized return range filters, one control per period |
| `TOTAL_RETURN_YTD`, `TOTAL_RETURN_1Y`, `TOTAL_RETURN_3Y`, `TOTAL_RETURN_5Y`, `TOTAL_RETURN_10Y` | `:` | Cumulative return range filters, one control per period |

### Examples

```bash
TICKERS="FLIN FLGR FLEE" bun ./scripts/update-data.ts
MAX_FETCHES=10 REQUEST_SLEEP=0 bun ./scripts/update-data.ts
AUM=large TER=:0.40 bun ./scripts/update-data.ts
```

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone - no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

`bun test` runs the single `scripts/update-data.test.ts`: parsers, the config resolver (precedence, validation, defaults), parity of the config file, `--help` and the controls table, the workflow shape, the README structure and the browser contract ids of `index.html` and `app.tsx`

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **AAM** | [aamlive.com](https://www.aamlive.com/ETF) \| [AAM](https://daggerok.github.io/AAM/) |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **ARK Invest** | [ark-funds.com](https://www.ark-funds.com/our-etfs/) \| [ARK](https://daggerok.github.io/ARK/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global-X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) |
| **Parametric** | [eatonvance.com](https://www.eatonvance.com/products/etfs.html) \| [Parametric](https://daggerok.github.io/Parametric/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SP Funds** | [sp-funds.com](https://www.sp-funds.com/) \| [SP-Funds](https://daggerok.github.io/SP-Funds/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
| **Tema ETFs** | [temaetfs.com](https://temaetfs.com/funds) \| [Tema](https://daggerok.github.io/Tema/) |
| **Themes ETFs** | [themesetfs.com/etfs](https://themesetfs.com/etfs) \| [Themes](https://daggerok.github.io/Themes/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| AAM | Official AAM catalog/detail HTML + full holdings XLS + SEC N-PORT holdings fallback + Yahoo market history/dividends | [AAM](https://github.com/daggerok/AAM) |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs (Firestore data feed) | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com CSV downloads + Yahoo Finance | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| Parametric | eatonvance.com ETF catalog and Parametric product pages + SEC EDGAR N-PORT-P holdings + Yahoo Finance history/dividends | [Parametric](https://github.com/daggerok/Parametric) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SP Funds | sp-funds.com homepage catalog, fund pages and daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [SP-Funds](https://github.com/daggerok/SP-Funds) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott ETFs | sprottetfs.com fund pages + SEC EDGAR N-PORT-P (Sprott Funds Trust) + Yahoo Finance history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| Tema ETFs | Tema official fund pages + dated daily holdings CSV; SEC EDGAR N-PORT-P holdings fallback only + Yahoo Finance price/history/dividend fallback | [Tema](https://github.com/daggerok/Tema) |
| Themes ETFs | themesetfs.com catalog + daily holdings CSV + Yahoo Finance history/dividends + SEC N-PORT-P holdings fallback | [Themes](https://github.com/daggerok/Themes) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT — same as all sibling ETF repositories.](./LICENSE)

Franklin Templeton® and Franklin® and the fund names/tickers referenced here are trademarks of Franklin Resources, Inc. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by Franklin Templeton or Franklin Resources, Inc. All data is reproduced from Franklin Templeton's own public fund pages, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
