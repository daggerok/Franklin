# Franklin

One of the app's features lets you select Franklin ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/franklin` static feed (franklintempleton.com ETF listings, per-fund product pages, Yahoo Finance daily history, SEC EDGAR N-PORT-P as holdings fallback) into a searchable ETF/category catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export - the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Franklin#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/Franklin/>

### Column types and filters

Every column of the ETF catalog and of the Watchlist, Holdings, History and Distributions tabs has a type: text (`ABC`), number (`123`), percentage (`%`), money (`$`), date (`D`), date and time (`DT`) or time of day (`T`). The type is detected from the texts the column shows (80% of the filled cells must agree, otherwise text) and is written in the badge next to the column title: click it to cycle the type, Shift+click to return to auto-detection. Dates are read as `2024-06-15`, `6/15/2024`, `15.06.2024`, `Jun 15, 2024` or `15-Jun-2024`, date and time as `2024-06-15T09:30:00Z` or `2024-06-15 09:30`, time as `09:30`, `16:00:00` or `9:30 PM`

A row of filter inputs sits under the column headers (the `Filters` button hides it, `Clear filters` empties it). Filters of different columns are combined with AND, the search box applies on top, and Copy Tickers and the exports use the filtered rows. Filters and type overrides are remembered in the browser. `Sticky #` (next to `Filters`, off by default, remembered in the browser) numbers the rows by their rank in the table sorted by the current column before the column filters, so a filtered fund keeps its rank and the numbers keep gaps; the sort, the search and the category and blacklist choices rank again. The catalog starts sorted by Net Assets, largest first, unavailable values sort last in both directions, and every export starts with the `#` column

Inside one filter: a space means AND, a comma means OR, a leading `!` means NOT, `?` matches an empty or unavailable value and `!?` a value that is there; a value that is unavailable matches only `?` and negated conditions. An unquoted space ends the value, so quote values that contain one (`>="2024-06-15 09:30"`)

| Type | Examples |
| --- | --- |
| Text | `bank` contains, `"two words"`, `!bank`, `=exact`, `^starts`, `ends$`, `/regex/`, `tech, health` |
| Number, percentage, money | `>10`, `>=10 <50`, `=22` (matches what rounds to 22), `!=22`, `10..50`, `..50`, `10..`, `>1B` and `K` `M` `B` `T` suffixes, an optional `$` or `%` |
| Date, date and time | `>2024-06-01`, `2024` (the whole year), `2024-06` (the whole month), `2024-01..2024-06`, `today`, `yesterday`, `-7d..` (the last 7 days), `+2w`, `-3m`, `-1y` |
| Time | `>09:30`, `09:30..16:00`, `=12:00` (the whole minute) |

The `Columns` menu next to `Filters` lists every column of the ETF table from the first to the last, all of them shown by default, with a search box and the `All`, `Clear`, `Toggle` and `Reset` buttons. `Use` and `Ticker` are listed but locked. Hiding a column only removes it from the table: the filters, the sorting, the exports and Copy Tickers still use it. The choice is remembered in the browser (localStorage, never the data) and the menu is shown on the ETF catalog only

The asset classes are one `Asset classes` multi-select next to the `All ETFs` pill instead of one tab per class: every class is selected by default (= all ETFs), `Only` or unchecking narrows the table, and the `All ETFs` pill is lit only while nothing narrows it (all or none of the classes checked); clicking the pill clears the selection. The choice is remembered in the browser (localStorage, never the data)

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
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures in percent, `((1 + CAGR/100)^n - 1) * 100` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized -> *SI Ann.*
- `dividendYield` - the official figure when the product page prints one, otherwise an estimate; `meta.json` `yields.dividendYieldKind` says which. Order: (1) the official 12-month yield (`official 12-month distribution yield from the product page`), (2) the official **Distribution Rate**, labelled `Distribution Rate at NAV published on the official Franklin fund page as of <date>` with `yields.dividendYieldAsOfDate`, (3) only when the page prints neither, the indicated yield (latest Yahoo distribution x payments per year / price, labelled `indicated: ...`). The page defines the Distribution Rate (its footnote) as the most recent distribution amount paid, annualized and divided by the closing market price or NAV as of the printed date (the page shows it "At Net Asset Value (NAV)", updated daily); special distributions are excluded, it is not a trailing 12-month figure and not a quotation of performance. A rate of a monthly payer therefore reacts to the last payment, and funds that print no rate (for example semiannual payers) keep the indicated yield
- `dividendYieldBasis` - short code for the definition behind `dividendYield`, `null` exactly when `dividendYield` is `null`; it is retained together with the yield it describes. Franklin uses three of the shared codes:

  | Code | Meaning for Franklin | `yields.dividendYieldKind` in `meta.json` |
  | --- | --- | --- |
  | `official-trailing-12m` | the 12-month distribution yield printed on the product page | `official 12-month distribution yield from the product page` |
  | `official-distribution-rate` | the page's Distribution Rate: latest distribution annualized over NAV or market price, with its own as-of date | `Distribution Rate ... published on the official Franklin fund page ...` |
  | `indicated` | updater estimate: latest Yahoo distribution x payments per year / price | `indicated: ...` |

  `official-other` (a provider yield of unclear definition) is only the fallback for an unrecognised published label; `computed-trailing-12m` is not used by Franklin
- `premiumDiscount` (index row `premiumDiscountValue`, with `premiumDiscountAsOfDate`) - computed as `(price / NAV - 1) * 100`, rounded to two decimals, from the official NAV and a price of the same trading date: the closing Market Price of the page's own `Share Prices` block (one as-of date for both; the page defines it as the official closing price), else the Yahoo regular-session close of the NAV date. `meta.json` `premiumDiscount.source` is `computed from market price / official NAV, same date` and `priceSource` names the price used. When the dates differ or either figure is missing the value is `null`, never a mix of dates. The page's own "Avg. of Market Price vs. NAV at Close" matches this figure on the pages checked; the since-inception average is not used. Funds that hold foreign stocks can show more than 1% on days when their NAV was struck before the local close
- `secYield` - 30-day SEC yield when published; `null` otherwise
- `returnsBasis` - always a non-empty text describing how the returns are computed: official Franklin Templeton average annual total returns at market price (finder and product page), 3Y/5Y/10Y cumulative figures compounded from the official annualized values, not derived from Yahoo Finance
- `performanceAsOf` - ISO date (`YYYY-MM-DD`) the returns are as of: the "Average Annual Total Returns As of ..." date of the Franklin performance table (a month-end or quarter-end, not the NAV or holdings date), kept from the previous run when a page is unavailable; `null` when unknown or when the fund has no returns. The hub uses it to flag stale returns. YTD is refreshed daily by the issuer, so it can be newer than this date

Caveats:

- Official figures come from franklintempleton.com product pages; history, distributions and the derived yield come from Yahoo Finance market prices and are estimates, not official NAV data
- Unavailable values are published as missing, never as `0`; a bounded return, yield or AUM filter excludes funds that have no figure for it
- Each fund records its source and as-of metadata in `meta.json`
- Nothing is invented: a fund the sitemap lists but no page has been read for has `null` name, `terValue` and exchange, and an index row without `meta.json` has `dataFile: null` with a full all-null `metrics` object. `terValue` is the net expense ratio and `meta.json` `expenseRatio.gross` the gross one when published
- Funds are published whole: a fund is computed completely in memory, then written (page files, then `meta.json`, then stale page removal; every JSON file goes through a temp file and a rename). When the product page or the Yahoo chart worked for a fund before and fails now, the fund keeps its previous files and counts as failed, so a new return is never published next to stale prices. The workflow may therefore commit a partial run: every fund in it is either fully updated or fully kept. The updater exits 1 only when every selected fund failed
- A product page counts as fully loaded only when it carries all three anchors: identifiers/fees (Overview), `Total Net Assets` (Portfolio) and the `Share Prices` block (Pricing). The rendering proxy sometimes returns the page with the lazy sections collapsed (empty `Performance`, `Portfolio`, `Pricing` headings); the updater then asks the next proxy candidate once (never more than the existing three candidates, still one global proxy gate of at least 3.2 s) and otherwise uses the partial page. For a partial page every section that was published as official before and is missing from it (pricing: NAV and market price, from which the premium/discount is computed again; total net assets; SEC yield and the 12-month yield or Distribution Rate; month-end returns with `performanceAsOf`; official holdings unless a newer N-PORT filing exists) counts as a failed read: the previous block is kept as one unit with its as-of date, never replaced by Yahoo-derived values or `null`, and one `[ kept ]` line per fund names the sections kept. A page that loaded fully and lacks a field (no market price, no SEC yield) is an honest absence and publishes `null` (the market price then falls back to the Yahoo close, labelled as such). Returns are the exception: young funds have no returns table, so a loaded page cannot vouch for them and an absent returns section is always kept. A NAV that fails the plausibility check against the price is a failed read too and the published NAV stays
- Holdings carry their own `asOfDate` and source; when no fresh holdings are available the previous ones stay under their own date
- Every request has a 45 s deadline covering headers and body (8 s for the direct franklintempleton.com attempt before the proxy fallback), retried per `MAX_RETRIES`. The SEC contact in `SEC_UA` is sent to sec.gov only and is redacted in the config printout
- Unbounded runs (`MAX_FETCHES=0`, and `TICKERS` runs) process the stalest fund first: funds without published data, then the oldest published as-of date (the latest of the price, NAV, holdings and performance dates in `funds/<TICKER>/meta.json`), ties alphabetical. The run stops taking new funds after 25 minutes (the first fund is always taken) and still writes the index; the skipped funds keep their published files and are first in line next time, so the tail of the list never starves. The log and the step summary report how many funds were refreshed and the oldest remaining as-of date. A bounded run (`MAX_FETCHES` > 0) keeps walking the alphabetical cursor
- New catalog tickers are printed as `NEW FUNDS: A, B` and appended to the GitHub step summary
- franklintempleton.com is behind a WAF that may return 403 to bare `fetch`. The updater tries a direct fetch with a browser-like `User-Agent` first, then falls back to `https://r.jina.ai/http://...` (Jina AI rendering proxy) which returns Markdown. Both paths are parsed by the same `parseFranklinCatalog` / `parseFranklinProductPage` helpers. After `ISSUER_DIRECT_DENIAL_LIMIT` consecutive direct 403s, the updater uses the proxy only
- `HISTORY_RANGE` limits the Yahoo history request window (`max` starts at `period1=0`, `<N>y` sends explicit `period1`/`period2` for the last N years); a short window also shortens the distribution history the derived yield uses
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
| `MAX_FETCHES` | `0` | Batch size: with a positive value the updater continues after the committed cursor in `api/franklin/update-state.json` inside the filtered list and wraps around; `0` is a full pass. Runs with `TICKERS` never read or change the cursor |
| `REQUEST_SLEEP` | `1.5` | Seconds between request starts per worker lane for direct requests; the r.jina.ai proxy fallback stays globally paced (min 3.2s between starts) |
| `CONCURRENCY` | `3` | Parallel fund workers; N workers give about N times the direct request throughput |
| `MAX_RETRIES` | `2` | Retries after the initial request (integer >= 1) |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | SEC User-Agent with a declared contact; the protected `SEC_UA` Actions variable overrides it |
| `AUM` | `:` | AUM min:max; bounds may be amounts or K/M/B/T suffixes, or nano/micro/small/mid/large preset |
| `TER` | `:` | Net expense ratio range in percent: min:max |
| `DIVIDEND_YIELD` | `:` | Dividend-yield percentage range |
| `SEC_YIELD` | `:` | SEC yield percentage range |
| `TICKERS` | empty | Only update these tickers, separated by spaces or commas; an unknown ticker is an error |
| `CATEGORY` | empty | Keep only this provider category substring |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated price-history JSON page (env alias `HISTORICAL_PAGE_SIZE`) |
| `HISTORY_RANGE` | `max` | Yahoo history window: `max` or `<N>y` (for example `5y`); other values are an error |
| `STORE_RAW_DOWNLOADS` | `false` | Store the source pages under `api/franklin/raw` |
| `SKIP_YAHOO` | `false` | Keep previous history and distributions while refreshing catalog and holdings |
| `SKIP_FRANKLIN` | `false` | Keep the previously published official catalog and holdings |
| `EDGAR_FALLBACK` | `true` | Use SEC EDGAR Form N-PORT-P for full holdings when the official ones are unavailable |
| `VERBOSE` | `false` | Print per-fund retry and fallback notices |
| `USE_SYSTEM_CA` | `auto` | TLS trust store: `auto` restarts the updater once with Bun's `--use-system-ca` when a request fails with an untrusted-certificate error; `true` always uses the system CA store; `false` never restarts. Not an individual workflow input: use `advanced`, the config file or the CLI environment |
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
| Amplify | Amplify ETFs Firestore data feed + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com fund pages and sitemap + official Invesco fund API (monthly returns, NAV, AUM, yields, daily holdings, expense ratio) + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Invesco](https://github.com/daggerok/Invesco) |
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
