# Franklin

<!-- message:
implement Franklin brand ETFs site similar to how I build lots of other such sites

<prerequisites_task>
do a research on how was implemented these repositories:

- https://github.com/daggerok/JPMorgan
- https://github.com/daggerok/Schwab
- https://github.com/daggerok/Invesco
- https://github.com/daggerok/iShares
- https://github.com/daggerok/Fidelity
- https://github.com/daggerok/Amplify
- https://github.com/daggerok/Vanguard
- https://github.com/daggerok/SPDR
- https://github.com/daggerok/WisdomTree
- https://github.com/daggerok/VanEck
- https://github.com/daggerok/Goldman-Sachs
- https://github.com/daggerok/Neos
- https://github.com/daggerok/ProShares

you can check how does they similar looking for to each other and that similarity for me is very important
</prerequisites_task>

what is needed:

<requirements>
you must take in consideration when will be building our app: https://www.franklintempleton.com/investments/options/exchange-traded-funds

please make sure you used exactly same approaches and make sure you have done a research on how its best of all to get needed data 1st official and 2nd only if not everything is existen, then in addition you can use also some other publicly available or non official or calculated data...

scripts must contain at least update-data.test.ts update-data.ts file

there should be index.html and app,tsx without ts config because we are using bun, so check carefully all my repos to make exactly similar solution but only different brand and all should works and looks exactly same as what I listed above (all of listed repos has https://daggerok.github.io/{name} published static web site, all data used by these sites are updated seapratly with a specific github workflow job

all comments, styles, readmes and files structure must remain the same

and make sure you fully verified on site web ui that all data is available and we don't have empty cells with no data available unless its a very young ETF and there are simply no data for such old period available to us... output ot ./scripts/update-data.ts I would prefer to see like in VanEck repo, but its not very strict requirement, if it must looks like from Goldman-Sachs - I don't mind...
</requirements>

As task is big and comple, we may fail with errors like AI long time is not responding or something like that, so lets split the work and do chuck by chunk and do as many commits/pushes as you need, just to make sure that we will able to resume from our last commit/push ...because there are a thons of work to do, you don't need to do everything at once, you can: 1) do some portion of work, aggregate needed data into repo files even they will be removed after full complete work is done; 2) write me a message like we done this, and now you gonna do next , and wait from me ok or so, so when I confirm, you can done more work and store it similarly ; 3) this will continues until you finish and we will not be failing with errors like "AI took too long time to answer..." and we wil able to complete an app, I think its reasonable to do because we have a lot of requirements and we need to do a lot of research and implementations. what do you think?

<split_the_work>
I have a generic plan, which may help you to split work and do some break down so you can do step by step and we will not fail after 1 hour running with the failure but we will get some work done each step, and continue next step...
</split_the_work>

here is that plan (you probably won't found and docs folder with md files because I removed them, but if really its needed - git history can help):

<plan>
================================================================================
ETF BRAND WATCHLIST - END-TO-END BUILD PLAN (UNIVERSAL, ANY BRAND)
Repository: daggerok/<BRAND>   |   Pages: https://daggerok.github.io/<BRAND>/
Plan version: 2026-09-19 (compiled from daggerok/{WisdomTree,SPDR,Vanguard,
Amplify,iShares,Fidelity,Invesco} repos and their GitHub Pages deployments)
================================================================================

HOW TO USE THIS PLAN
  1. Read the whole document before writing any code. It is written to be
     executed mechanically by a single implementation agent with no memory of
     the conversations that produced it.
  2. The ONLY input you need from the human is the brand slug. Replace every
     {{BRAND}} (display name), {{brand}} (lowercase storage/feed prefix), and
     {{REPO}} (GitHub repo name, usually the brand name as-is) token below.
  3. Everything that is not explicitly marked BRAND-SPECIFIC is identical for
     every brand. Do not "improve", rename, restyle or reorganize it. The goal
     is a byte-for-byte sibling of the existing applications in structure,
     behaviour, styling and wording; only the data source, the fund universe
     and the documented data gaps change between brands.
  4. Where this plan says "verify live", you MUST do fresh research at
     implementation time (see section 22 for the full list of what cannot be
     answered now). Record findings in the repo's README and in
     docs/ui-contract.md so the next brand inherits the knowledge.
  5. Deliverable is a finished, tested repository pushed to
     github.com/daggerok/{{REPO}} and published at
     https://daggerok.github.io/{{REPO}}/ . The plan is only complete when
     section 19 (automated tests), section 20 (end-to-end testing on the
     deployed URL) and section 21 (final acceptance checklist) are all green.

--------------------------------------------------------------------------------
0. IRON RULES (violating any of these = rework)
--------------------------------------------------------------------------------
0.1  Static site only. No framework, no bundler, no build step, no server, no
     CDN assets other than the three documented ones (Tailwind CDN, Babel
     standalone, Google Inter font). GitHub Pages deploys the repository root.
0.2  Zero npm runtime dependencies. The only devDependencies are
     @types/bun, @types/node and, only where a repo already needs them,
     typescript / happy-dom / playwright.
0.3  Bun is the only toolchain: `bun test`, `bun ./scripts/update-data.ts`,
     `bunx serve . -p 1234` for local preview.
0.4  All browser logic lives in `app.tsx`, loaded by `index.html` through
     `<script type="text/babel" data-presets="typescript" src="./app.tsx">`
     (see 4.2 for the one allowed alternative). No src/ directory, no .js app
     files, no JSX component tree: app.tsx renders HTML strings into
     document.getElementById(...) containers.
0.5  The app reads ONLY relative URLs under ./api/{{brand}}/ so the same
     artifact works on Pages, on any static host and from file://.
0.6  Never fabricate data. A metric the brand does not publish stays `—`
     (em dash) in the UI and null in the feed, and must be explained by the
     column tooltip and by the Overview data-provenance rows. An em dash must
     never mean "still loading".
0.7  Every generated file is deterministic: same inputs produce a byte
     identical api/{{brand}}/** tree, so a rerun with unchanged upstream data
     yields an empty `git diff`. Sort keys are stable, numbers are normalized,
     stamps that the vendor rotates for no reason are stripped before compare.
0.8  Accessibility, focus, reduced motion, dark mode, keyboard use and mobile
     wrapping are part of the contract, not polish.
0.9  Copy/CSV/TXT exports always use the complete filtered result of the
     active tab, never only the rendered chunk, and always mirror the visible
     column order (including the coded Frequency column).
0.10 If a feature is genuinely impossible for this brand (no upstream field),
     implement everything else and document the gap explicitly in
     README "Data sources" / "Known value limitations" and in the commit
     message. Do not silently drop a column, a tab or a control.

--------------------------------------------------------------------------------
1. REFERENCE SET (already shipped - your source of truth)
--------------------------------------------------------------------------------
Each row is an existing, deployed application this build must match. Clone or
download them and read them; they are the normative specification alongside
this document.

  Brand        Repo                          Pages deployment                   Feed root               App file
  WisdomTree   daggerok/WisdomTree           https://daggerok.github.io/WisdomTree/   api/wisdomtree/     index.html + app.tsx
  SPDR         daggerok/SPDR                 https://daggerok.github.io/SPDR/         api/spdr/           index.html + app.tsx
  Vanguard     daggerok/Vanguard             https://daggerok.github.io/Vanguard/     api/vanguard/       index.html (inline)
  Amplify      daggerok/Amplify              https://daggerok.github.io/Amplify/      api/data.json       index.html (inline)
  iShares      daggerok/iShares              https://daggerok.github.io/iShares/      api/ishares/        index.html (inline)
  Fidelity     daggerok/Fidelity             https://daggerok.github.io/Fidelity/     api/fidelity/       index.html + app.tsx
  Invesco      daggerok/Invesco              https://daggerok.github.io/Invesco/      api/invesco/        index.html + app.tsx

Primary template for a NEW brand: daggerok/Invesco (most recently updated, has
the full shared UI contract implemented: per-tab search + sort memory, pinned
catalog and Watchlist columns, chunked Watchlist, animated blacklist panel,
N-PORT dropzone) with daggerok/Fidelity as the co-template (same architecture,
SEC-EDGAR-based updater) and daggerok/WisdomTree as the mechanism reference
ui contract is shared acros all of our repos
Secondary/architecture alternatives (only if the brand's data shape forces
them): daggerok/iShares and daggerok/Vanguard (upload-first, IndexedDB, generic
renderTable, "ETF Catalog" + "Holdings/Historical/Performance/Distributions"
sheet names). Never mix architectures inside one repo.

Verified shared wording (all of SPDR, WisdomTree, Vanguard, Amplify, Fidelity,
Invesco use exactly this family; iShares is the only deviation):
  <title>{{BRAND}} ETF Holdings to Watchlist</title>
  <meta name="description" content="{{BRAND}} ETF holdings to Watchlist from
        the static api/{{brand}} JSON feed, generated from ...">   (brand tail)
  <h1 class="min-w-0 text-xl font-bold tracking-tight text-slate-900
        dark:text-white leading-tight">{{BRAND}} ETF Holdings to Watchlist</h1>
  <body class="min-h-screen font-sans bg-slate-50 text-slate-900
        dark:bg-slate-900 dark:text-slate-100 transition-colors duration-300">
  Export file names: `{{brand}}-<scope>-<YYYY-MM-DD>.csv|.txt` where scope is
  `catalog`, `watchlist`, `<TICKER>-overview`, `<TICKER>-distributions`,
  `<TICKER>-holdings`, `<TICKER>-history` (lowercased, spaces to hyphens).
  iShares-style titles ("iShares Excel .xls file to Watchlist", dark:bg-slate-
  950, #020617 page background) are legacy: do NOT copy them for a new brand.

--------------------------------------------------------------------------------
2. BRAND BRIEFING (do this before writing code)
--------------------------------------------------------------------------------
2.1 Build the brand card (put it in README.md "Data sources":
      - official US product catalog URL and its machine-readable form
        (JSON endpoint / CSV "Excel download" / XLSX workbook / server-rendered
        HTML / GraphQL / Firestore or other NoSQL feed);
      - per-fund page URL pattern;
      - per-fund daily holdings download URL pattern;
      - NAV / price history download URL pattern;
      - distributions or dividend history source (issuer feed, else Yahoo);
      - SEC registration: trust registrant CIK(s) + Form N-PORT-P series IDs
        via https://www.sec.gov/files/company_tickers_mf.json (needed both for
        the holdings fallback and for the browser N-PORT dropzone);
      - rate-limit / bot-protection behaviour (Cloudflare? Akamai? plain 403
        on bursts? does r.jina.ai read-only rendering of the same official URL
        work as a fallback, as in WisdomTree?);
      - which of the shared metrics the brand does NOT publish (SEC yield,
        multi-year returns, expense ratio, CUSIP/ISIN, distributions, etc.).
2.2 Decide the source ladder for each block, preferring in this order:
      (a) official issuer bulk download (CSV/XLSX/JSON/API) - the brand's own
          specific source;
      (b) issuer server-rendered product pages, parsed, optionally through the
          read-only r.jina.ai proxy when a WAF blocks direct fetches;
      (c) SEC EDGAR Form N-PORT-P for full holdings (quarterly-ish, honest
          as-of date) - the general-purpose source;
      (d) Yahoo Finance public chart API
          /v8/finance/chart/{TICKER}?period1=0&period2=..&interval=1d
          &events=div%7Csplit&includeAdjustedClose=true
          - general-purpose source for daily history, distributions and any
          missing return;
      (e) browser dropzone upload of the official file format (N-PORT XML, or
          issuer workbook) for anything (a)-(d) cannot cover;
      (f) nothing - render `—` and document why.
    Record the ladder per block, per column, exactly like the sibling READMEs.
2.3 Enumerate the fund universe: fetch the catalog, count funds, list the
    brand's tickers, and note which are not ETFs (e.g. Fidelity ZERO mutual
    funds such as FNILX are out of scope; commodity trusts such as GLD/GLDM in
    SPDR are catalog-only because they publish no holdings workbook).
2.4 Record brand-specific column facts you will need later: max ticker length
    (drives the pinned Ticker width, see 8.7), whether the brand publishes a
    discrete distribution-frequency label or it must be derived, which
    identifier columns exist (CUSIP/ISIN/SEDOL/FIGI/Security ID), whether bond
    and cash positions exist (drives the Watchlist dedupe fallback), whether
    the brand's holdings use `Ticker: "-"` for non-equity rows.

--------------------------------------------------------------------------------
3. REPOSITORY LAYOUT (exact, same for every brand)
--------------------------------------------------------------------------------
{{REPO}}/
  .github/workflows/update-data.yml      # manual data refresh, section 17
  .gitignore                             # 4 lines + .DS_Store (copy verbatim):
      .idea/
      .parcel-cache/
      dist/
      node_modules/
      .DS_Store
  LICENSE                                # MIT, "Copyright (c) 2026 Maksim Kostromin"
  README.md                              # structure in section 18
  favicon.ico                            # byte-identical copy from a sibling repo
  index.html                             # markup + <style> + bootstrap (section 5-6)
  app.tsx                                # the whole browser app (section 7-15)
  bun.lock
  package.json
  # shared contract, brand-prefixed keys (section 12)
  # coded Frequency + pinned columns (section 8.6-8.7)
  # the brand's own data plan (may be Russian,
  scripts/update-data.ts                 # Bun updater, executable, shebang (section 16)
  scripts/update-data.test.ts            # updater unit tests (section 19.2)
  scripts/ui-harness.ts                  # headless fake DOM + feed fetch (section 19.1)
  scripts/ui.test.ts                     # 17 acceptance UI tests (section 19.1)
  scripts/check-index.ts                 # validates index.html/app.tsx inline script
                                         #   (node --check on the transpiled app; WisdomTree has it)
  api/{{brand}}/index.json               # generated catalog (section 14.1)
  api/{{brand}}/update-state.json        # bounded-run cursor + savedAt
  api/{{brand}}/funds/<TICKER>/meta.json # per-fund manifest (section 14.2)
  api/{{brand}}/funds/<TICKER>/holdings/001.json, 002.json, ...
  api/{{brand}}/funds/<TICKER>/history/001.json, 002.json, ...
  api/{{brand}}/raw/<optional raw sources, only when STORE_RAW_DOWNLOADS is on>

package.json (exact shape):
  {
    "scripts": {
      "test": "bun test scripts/update-data.test.ts scripts/ui.test.ts",
      "update": "bun scripts/update-data.ts"
    },
    "dependencies": {},
    "devDependencies": { "@types/bun": "1.4.0", "@types/node": "26.2.0" }
  }
  (Add "happy-dom"/"typescript"/"@types/bun" only if you reuse the Amplify-style
  contract test or the typecheck script; do not introduce a tsconfig.json -
  typechecking is done with the inline `bunx tsc --noEmit ...` invocation in 19.4.)

--------------------------------------------------------------------------------
4. TWO ACCEPTABLE APP ARCHITECTURES (pick one, never mix)
--------------------------------------------------------------------------------
4.1 Variant A - DEFAULT, use it: index.html = markup + styles + bootstrap,
    app.tsx = all logic (Babel-standalone inline TypeScript). Used by
    Invesco, Fidelity, WisdomTree, SPDR. index.html stays 205-280 lines,
    app.tsx 2100-2400 lines.
4.2 Variant B - only if you are literally forking iShares/Vanguard: everything
    inline in index.html (2300-4100 lines), plain `<script>` block, no
    app.tsx, no Babel, generic renderTable() for every sheet, IndexedDB for
    uploaded workbooks. A new brand built from scratch must use variant A.
4.3 index.html head (verbatim contract, variant A):
    - <meta charset>, <meta name="viewport" content="width=device-width, initial-scale=1.0">
    - <title>, <meta name="description">, <link rel="icon" href="./favicon.ico">
    - Google Fonts preconnect x2 + Inter 300/400/500/600/700 stylesheet
    - <script src="https://cdn.tailwindcss.com"></script>
    - tailwind.config = { darkMode: 'class', theme: { extend: {
        fontFamily: { sans: ['Inter', 'sans-serif'] } } } }
    - <script src="https://unpkg.com/@babel/standalone@7.24.0/babel.min.js"></script>
    - synchronous anti-flash theme bootstrap:
        (function () {
          var dark = localStorage.getItem('{{brand}}-theme') === 'dark';
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.style.backgroundColor = dark ? '#020617' : '#f8fafc';
        })();
    - the single <style> block (section 6)
4.4 index.html body (variant A), in this order, with these exact ids:
    header (bg-white dark:bg-slate-950 border-b ... z-40 shadow-xs shrink-0)
      - inline SVG trend-up icon, w-6 h-6 text-blue-600 dark:text-blue-400
      - h1 (title, section 1)
      - <span id="app-subtitle" aria-live="polite"> - brand sentence + links to
        ./api/{{brand}}/index.json and to the official source (section 11.1)
      - <span id="ticker-count"> pill (bg-blue-100 dark:bg-blue-900/50 ...) -
        "Loading..." on boot, "N ETFs" / "N,NNN holdings" / "<TICKER>" later
      - <button id="theme-toggle"> with 🌙 / ☀️, title "Toggle Theme"
    main class="flex-1 w-full max-w-full p-4 sm:p-8 space-y-6"
      1) toolbar card: search input + #search-clear-btn + #tabs-bar +
         actions (upload dropzone when enabled, Copy Tickers, Export .csv,
         Export .txt, Clear, Blacklist)
      2) <div id="blacklist-panel"> blacklist manager (section 13.5)
      3) <nav id="selected-tabs-panel"><div id="selected-tabs-bar"></div></nav>
      4) table card: <div id="table-scroll" class="overflow-x-auto
         overflow-y-auto themed-scroll"><table class="w-full text-left
         border-collapse whitespace-nowrap"><thead id="table-head" class=
         "... sticky top-0 z-20 backdrop-blur">...</thead><tbody id=
         "table-body" class="divide-y divide-slate-100 dark:divide-slate-
         700/50 text-sm">...</tbody></table><div id="static-load-sentinel">
         <span id="static-load-status"></span></div></div>
    <script type="text/babel" data-presets="typescript" src="./app.tsx"></script>

--------------------------------------------------------------------------------
5. DESIGN SYSTEM (identical across all brands - no brand theming)
--------------------------------------------------------------------------------
5.1 Typography: Inter (300-700) as the only sans; `font-mono` (Tailwind
    default) for tickers, prices, percentages, dates, counts, identifiers;
    table headers `text-xs uppercase tracking-wider`; body `text-sm`; row
    cells `py-2.5 px-4`; header cells `py-3.5 px-4`.
5.2 Palette (light / dark):
    page        bg-slate-50              dark:bg-slate-900
    header      bg-white                 dark:bg-slate-950
    card        bg-white                 dark:bg-slate-800/80 (toolbar, panels)
                                         dark:bg-slate-800/50 (table card)
    border      border-slate-200         dark:border-slate-700
    text        text-slate-900 / slate-700 / slate-500
                dark:text-slate-100 / slate-300 / slate-400
    links/primary #2563eb blue-600       dark blue-400
    success/CSV-adjacent emerald-600 hover emerald-500 (Export .txt button)
    danger      rose-100/rose-700/rose-200  dark:rose-900/40, rose-300, rose-700/50
    selected row  background:#eff6ff     dark rgba(30,64,175,.22)
    row hover   bg-slate-50              dark:bg-slate-700/30
    pill        bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300
                border-blue-200 dark:border-blue-500/30 rounded-full px-3.5 py-1.5
5.3 Motion: fadeIn .3s ease-out on first paint (.animate-fade-in),
    tableRefresh .22s ease-out applied to #table-body on every table update
    (class .table-content-enter), expand/collapse transitions
    max-height/opacity/transform/padding/border-color (.32s ease, opacity
    .22s ease) for the detail-tabs and blacklist panels, `active:scale-95` on
    all buttons. Everything inside
    @media (prefers-reduced-motion:reduce){ animation:none; transition:none }.
5.4 Scrollbars: `.themed-scroll` utility - webkit 10px, thumb #cbd5e1 (dark
    #334155), hover #94a3b8 (dark #475569), radius 8px, 2px transparent
    border, background-clip:padding-box; plus scrollbar-width:thin and
    scrollbar-color for Firefox. Apply to #table-scroll, #tabs-bar,
    #selected-tabs-bar, the subtitle badge strip.
5.5 Scroll containment: `#table-scroll{overscroll-behavior:contain}` and the
    JS `fitTableHeight()` / `fitTableScrollHeight()` that sets
    maxHeight = max(240, innerHeight - rect.top - (innerWidth<640?12:24)).
    Called after every render, on window resize, and whenever the layout above
    the table changes. The document itself must never scroll vertically or
    horizontally - only #table-scroll does.
5.6 Responsive: toolbar is flex-col lg:flex-row; search w-full lg:w-80;
    actions wrap right-aligned; header wraps with gap-x-3 gap-y-1.5; tabs bar
    `flex flex-wrap items-center justify-center gap-1.5 overflow-x-auto py-1`.

--------------------------------------------------------------------------------
6. index.html <style> BLOCK (copy verbatim from daggerok/Invesco/index.html)
--------------------------------------------------------------------------------
It contains, in this order, and every rule is required:
  1) @keyframes fadeIn + .animate-fade-in
  2) .themed-scroll rules (5.4)
  3) .selected-row + .dark .selected-row
  4) #table-scroll{overscroll-behavior:contain}
  5) long comment + pinned-column block:
      #table-scroll table{min-width:max-content;border-collapse:separate;
        border-spacing:0;isolation:isolate}
      #table-scroll tbody, #table-scroll tbody tr {position:relative;z-index:0}
      #table-scroll .catalog-sticky-col{position:sticky;background:#fff;
        background-clip:padding-box}
      #table-scroll thead .catalog-sticky-col{top:0;z-index:30;background:#f8fafc}
      #table-scroll tbody .catalog-sticky-col{z-index:20}
      #table-scroll .catalog-sticky-use{left:0;width:5rem;min-width:5rem}
      #table-scroll .catalog-sticky-ticker{left:5rem;width:<W>;min-width:<W>;
        box-shadow:4px 0 6px -6px rgba(15,23,42,.7)}
      #table-scroll .watchlist-sticky-ticker{position:sticky;left:0;
        width:<WW>;min-width:<WW>;max-width:<WW>;overflow:hidden;
        text-overflow:ellipsis;background:#fff;background-clip:padding-box;
        box-shadow:4px 0 6px -6px rgba(15,23,42,.7)}
      #table-scroll thead .watchlist-sticky-ticker{top:0;z-index:30;background:#f8fafc}
      #table-scroll tbody .watchlist-sticky-ticker{z-index:20}
      .dark #table-scroll .catalog-sticky-col,.dark #table-scroll
        .watchlist-sticky-ticker{background:#172033}
      .dark #table-scroll thead .catalog-sticky-col,.dark #table-scroll
        thead .watchlist-sticky-ticker{background:#0f172a}
      #table-scroll tbody tr:hover .catalog-sticky-col,#table-scroll tbody tr:hover
        .watchlist-sticky-ticker{background:#f8fafc}
      #table-scroll tbody tr.selected-row .catalog-sticky-col{background:#eff6ff}
      .dark #table-scroll tbody tr:hover .catalog-sticky-col,.dark #table-scroll
        tbody tr:hover .watchlist-sticky-ticker{background:#1f2a3d}
      .dark #table-scroll tbody tr.selected-row .catalog-sticky-col{background:#19274e}
    <W> default 5rem (SPDR/WisdomTree) and 6rem (Fidelity spec) - MEASURE:
    render the catalog and confirm the longest brand ticker plus the ↑/↓ sort
    arrow never clips, then pick the round rem value that fits.
  - the `#selected-tabs-panel` and `#blacklist-panel` expand/collapse rules
    (5.3) including the `.is-visible` variants and the dark border override
  - @keyframes tableRefresh + #table-body.table-content-enter
  - the prefers-reduced-motion media block
  Dark-mode pinned backgrounds are PRE-BLENDED OPAQUE hexes (slate-800/50 over
  slate-900 = #172033; slate-700/30 hover over that = #1f2a3d;
  rgba(30,64,175,.22) selected over that = #19274e; header #0f172a). Never
  reuse a translucent rgba() for a pinned cell - scrolled text bleeds through.
  If you base a new brand on iShares/Vanguard colours (page background
  #020617 / dark:bg-slate-950), recompute the blend for that stack instead
  (iShares uses base #101829, hover #1b2436, selected #132046, header #0e1629).

--------------------------------------------------------------------------------
7. CATALOG TABLE (the "All ETFs" / category view) - full column contract
--------------------------------------------------------------------------------
7.1 Column order (25 <th>/<td> per row: # + Use + 23 data columns). Keep the
    order even when a value is unavailable; render `—`:
      #  Use  Ticker  Fund Name  Type  NAV  Net Assets  Expense
      Dividend Yield  SEC Yield  Frequency  YTD Return  TR 1Y  TR 3Y  TR 5Y
      TR 10Y  CAGR 3Y  CAGR 5Y  CAGR 10Y  SI Ann.  Return As Of  Inception
      Holdings  History  As Of
7.2 Header rendering helpers (identical names, identical behaviour):
    indexHeader() -> <th class="py-3.5 px-4 w-12 text-center" title=tooltip>#
    useHeader()   -> pinned <th class="catalog-sticky-col catalog-sticky-use
                     py-3.5 px-4 w-20 text-center"> containing
                     <input type="checkbox" id="select-all-checkbox" ...>
                     plus the label "Use"; title "Select / Deselect all visible
                     ETFs (current tab + search filter)"
    sortHeader(label, key, numeric = false, extraClass = '') ->
      <th class="py-3.5 px-4{align}{extraClass}" title=tooltip>
        <button data-sort="{key}" title=tooltip class="uppercase tracking-wider
          hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none
          focus:text-blue-600 dark:focus:text-blue-400">{label}{arrow}</button>
      </th>
      arrow = ' ↑' | ' ↓' when active; align = ' text-right' when numeric.
      The extraClass parameter exists ONLY so the catalog Ticker header can be
      pinned; every other call site passes nothing.
7.3 Cell styling: numbers `text-right font-mono text-slate-700
    dark:text-slate-300`; labels/dates `font-mono text-slate-600
    dark:text-slate-400`; Fund Name `font-medium` with title=full name; Type
    plain; Ticker `catalog-sticky-col catalog-sticky-ticker py-2.5 px-4
    font-mono font-semibold text-blue-600 dark:text-blue-400` wrapping a
    <button data-open-fund="TICKER" title="Open TICKER details">; Use cell
    `catalog-sticky-col catalog-sticky-use py-2.5 px-4 text-center` holding
    <input data-checkbox="TICKER"> + <button data-blacklist="TICKER"> (✕,
    w-4 h-4 rounded text-slate-300 dark:text-slate-600 hover:text-rose-500
    dark:hover:text-rose-400, title "Blacklist TICKER — hide it from All ETFs").
7.4 Formatting helpers (verbatim semantics): numberOrNull, numberCell,
    formatPercent (2 decimals + %), formatInteger (en-US thousands),
    formatMoney ($ + compact M/B for AUM), formatDistributionFrequency (7.6),
    normalizeSearchText, sanitizeTicker (strip non-alnum, uppercase),
    escapeHtml (used for EVERY interpolation), getHeaderTooltip(header)
    reading COLUMN_TOOLTIPS.
7.5 Search: case-insensitive substring over a precomputed lowercase
    `searchIndex` string per row (ticker + name + category + identifiers +
    extra brand fields). Placeholder for catalog tabs:
      'Search ETFs, fund names, holdings, tickers, CUSIPs/ISINs, SEDOLs...'
    (WisdomTree/Fidelity use 'Search ETFs, fund names, holdings, tickers,
    CUSIPs, ISINs...'; pick one and keep it in docs/ui-contract.md). For every
    other view: `Search <tab label>...`.
7.6 Frequency column (BRAND-SPECIFIC SOURCE, IDENTICAL PRESENTATION):
    values are the coded, sortable labels
      00 - —   00 - None   00 - Unknown   01 - Monthly   04 - Quarterly
      06 - Semi-annually   12 - Annually   99 - Irregular
    Normalization table (client-side formatter, defensive about hyphen
    variants and dashes): monthly->01, quarterly->04, semiannually|
    semiannual|semi-annual|semi-annually->06, annually|annual->12,
    none->00 - None, unknown->00 - Unknown, ''/-/—->00 - —,
    irregular->99 - Irregular, anything else passthrough.
    Cadence MUST be computed once at data-update time (server-side in
    scripts/update-data.ts) and stored in index.json, never derived in the
    browser from per-fund files. If the brand publishes a label, map it; if
    not, derive it from the fund's own distribution rows already downloaded
    (count of distinct ex/payable dates in the trailing 12 months; <3
    observations -> 00 - Unknown; ambiguity -> 99 - Irregular), like
    Fidelity/Invesco's inferDistributionFrequency() and the iShares
    deriveDistributionFrequency()
    Sorting works for free: values are non-numeric strings so the comparator
    falls back to localeCompare with {numeric:true}; zero-padded prefixes keep
    00 < 01 < 04 < 06 < 12 < 99. Do NOT add special cases to the numeric
    detector.
7.7 Column tooltips (COLUMN_TOOLTIPS map) - one entry per header, style
    "Label — Explanation". Required entries with the exact tone used by the
    siblings (adjust only the source names): #, Use, Ticker, Fund Name,
    Category, Type, Name, Identifier, SEDOL, TER, Expense, NAV, Net Assets,
    Weight, Weight Sum, Max Weight, # ETFs, ETFs, Dividend Yield (say whether
    it is trailing-12M, indicated = latest distribution x payments/yr / NAV, or
    distribution-derived), SEC Yield (if the brand does not publish it:
    'Not published by {{BRAND}}; shown as "—" (data limitation)'), Frequency
    (source + the numeric code legend), YTD Return, TR 1Y/3Y/5Y/10Y,
    CAGR 3Y/5Y/10Y, SI Ann., Return As Of, Inception, Exchange, Close,
    Prem/Disc, Holdings, History, As Of, Ex-Date, Dividend, Flags.
    Tooltips feed BOTH the <th title> and the sort button title, so a native
    tooltip appears on hover for the whole header cell.
7.8 Row interactions: click on the row toggles Use; clicks on <a>,
    button[data-blacklist] and button[data-open-fund] stopPropagation and do
    their own thing; hovering and selection are pure CSS; selected row keeps
    .selected-row; sort/selection/search never reset each other.
7.9 Empty state: `<tr><td colspan="25" class="py-12 text-center text-slate-400
    dark:text-slate-500">No ETFs match your search.</td></tr>` - colspan is
    column-count + 2 and must be bumped when a column is added.
7.10 Status line after each render (console debug + aria-live subtitle):
    'Showing N ETFs matching "<q>". Click rows to select ETFs. M selected.
    Active ETF detail tabs are for TICKER.' tones info|success|error.

--------------------------------------------------------------------------------
8. SHARED INTERACTION CONTRACT (per-tab state, selection, reactivity)
--------------------------------------------------------------------------------
8.1 localStorage keys, ALL prefixed `{{brand}}-`:
      {{brand}}-theme            'dark' | 'light'
      {{brand}}-selected-etfs    JSON array of tickers
      {{brand}}-active-fund      single ticker (key removed when none)
      {{brand}}-blacklisted-etfs JSON array
      {{brand}}-tab-filters      JSON map tabId -> non-empty query only
      {{brand}}-tab-sorts        JSON map tabId -> { key, dir } (explicit only)
      {{brand}}-site-state       { activeTab, activeFundTicker, sheetFilter,
                                 sheetSort } compatibility mirror
      {{brand}}-searches         LEGACY only: read at boot, migrate into
                                 tab-filters, delete on first write
    tabId values: 'All', each category label, 'watchlist',
    'detail:overview', 'detail:holdings', 'detail:history',
    'detail:distributions' (variant B names: 'ETF Catalog', 'Watchlist',
    'Holdings', 'Historical', 'Performance', 'Distributions').
8.2 Boot sanitization: malformed JSON, arrays where an object is expected,
    non-string filter values, empty sort keys, unknown directions, unknown
    tickers and blacklisted tickers are all dropped; a corrupted store can
    never throw or blank the page (accepted test case, see 19.1 #14).
8.3 Sort persistence: only explicit header clicks write {{brand}}-tab-sorts.
    Restored on tab switch and full reload. Defaults never written:
    catalog + detail sheets = source order (rank), Watchlist = Weight Sum
    desc, Overview = Section asc. NO control may reset sorting: not row Use,
    not header Use, not the All ETFs pill, not tab buttons, not search, not
    Copy Tickers, not exports, not theme, not blacklist, not Clear.
    Clear drops selection + filters only.
8.4 Per-tab filters: typing affects only the active tab; switching tabs saves
    the outgoing query and restores the destination's (guard: only when
    destination != current, so boot hydration cannot clobber a restored query);
    backspacing removes the entry; #search-clear-btn (✕, same glyph as the
    blacklist button) is hidden while empty, clears only the active tab,
    refocuses the input, re-renders synchronously; its visibility is refreshed
    on input, tab switch, restore, Clear-all and the one-click clear.
8.5 Three distinct selection scopes:
      - row Use checkbox / row click: exactly one ETF;
      - header Use checkbox: exactly the rows currently rendered (active tab +
        active filter + blacklist exclusion); checked state computed with
        .every() over those visible rows; unchecking never touches selections
        hidden by another filter;
      - All ETFs pill checkbox (#select-all-toggle next to the "All ETFs (N)"
        label inside #tabs-bar): always the ENTIRE non-blacklisted catalog from
        ANY tab (detail, watchlist, filtered), toggle-only, never navigates;
        checked iff .every() over all non-blacklisted catalog tickers.
    Every selection writer updates immediately: subtitle count + clickable
    ticker badges (active one highlighted), active fund (first selected
    fallback), detail-tabs panel visibility + per-sheet counts, Watchlist
    visibility/loading/count, localStorage. Debounce only background data
    refreshes (75 ms coalescing), never the UI feedback.
8.6 Coded-frequency contract is same acros all the repos
    of the new repo (copy the SPDR/Fidelity version and re-derive the colours
    and line numbers for this repo) - the doc is part of the deliverable.
8.7 Pinned columns rule: `position:sticky` goes on the <th>/<td> element
    itself, never on a nested wrapper (a sticky child cannot escape its static
    parent cell, so the pin silently breaks once that cell scrolls off).
    Pinned: catalog Use (left 0) + catalog Ticker (left 5rem) + Watchlist
    Ticker (left 0). `#` is deliberately NOT pinned. The `.catalog-sticky-*` /
    `.watchlist-sticky-*` classes must be emitted ONLY in the branches that
    build the catalog and Watchlist tables - #table-scroll is shared by every
    other sheet, and a positional :nth-child() selector would leak pinning
    into Holdings/History/Overview/Distributions.
8.8 Tab bar: first tab is a pill containing the whole-catalog checkbox:
      <input type="checkbox" id="select-all-toggle" class="w-3.5 h-3.5
      accent-blue-600 cursor-pointer" title="Select / Deselect all ETFs">
      <button id="all-etfs-tab-btn" data-tab="All">All ETFs (N)</button>
    followed by one button per category (label = provider category, count in
    parentheses), styled like the siblings' tab buttons (active = blue pill).
    Detail tabs live in #selected-tabs-panel and are only rendered when an
    active fund exists; the first detail tab label is
    "<TICKER> Overview", the rest are "Holdings", "History", "Distributions".
    Watchlist tab appears as soon as one ETF is selected.

--------------------------------------------------------------------------------
9. DETAIL VIEWS (per selected fund)
--------------------------------------------------------------------------------
9.1 Tabs: Overview | Holdings | History | Distributions (variant B: Historical,
    plus Performance). Keep every tab even when the brand has no data for it -
    show an explanatory empty state instead of removing the tab.
9.2 Overview = a 3-column metric table (#, Section, Metric, Value) built from
    meta.json + index.json, sections: Fund (Ticker, Fund Name, Asset Class,
    Inception, Exchange, Fund Page, Factsheet/Official page/Issuer links,
    identifiers CUSIP/ISIN when the brand has them), Cost (TER gross/net),
    Price (NAV, Close Price, Premium/Discount, As Of), Assets (Net Assets
    formatted + published string), Returns (Month-End As Of + YTD/1Y/3Y/5Y/
    10Y/SI Ann. ME, Quarter-End As Of + same QE), Distributions (Frequency -
    RAW provider label, not the code -; Ex-Date; Latest Dividend; Dividend
    Yield (indicated) with the formula spelled out; SEC Yield or the plain
    sentence "not published by {{BRAND}} for its ETFs"), Holdings (Rows, As
    Of, Source string), History (Rows, As Of, Source). Any value that is a
    URL renders as an `open link` anchor with target=_blank rel=
    noopener noreferrer. Data provenance (which source produced which number,
    as-of dates, NAV-total-return vs adjusted-market-price-return, trailing
    vs indicated yield, coverage limits) MUST be readable here - that is the
    brand's differentiation surface.
9.3 Holdings / History: lazily fetched, paginated, infinite scroll.
      - fetch ./api/{{brand}}/funds/<T>/meta.json, read .holdings/.history
        manifests { totalRows, pageSize, pageCount, pages:["./holdings/001.json",...],
        asOfDate, source };
      - page envelopes: { ticker, page, pageSize, totalRows, headers:[...],
        rows:[{col:value}|[...]] } - rows keyed by the literal header strings;
      - append next page when the user scrolls near #static-load-sentinel;
        clicking the sentinel also loads; sentinel text 'Loading more rows...'
        / 'Scroll or click to load more rows...' and hides at the last page;
      - per-ticker in-flight de-dup (detail view and Watchlist loader share one
        request), one page-writer chain per ticker (a rapid re-selection can
        never duplicate or skip a page), bounded global concurrency (6),
        page envelopes cached per fund and shared by both consumers;
      - switching fund/sheet resets the paging generation; the previous fund's
        table is replaced by a loading placeholder, never left visible;
      - failures render 'Could not load <TICKER> data — <reason>' in rose;
        catalog-only funds (no workbook) and funds with no pages render an
        explanatory sentence, not a spinner.
9.4 Distributions: raw provider rows in the provider's own column order (e.g.
    Frequency, Ex-Date, Record Date, Payable Date, Dividend, ST Cap Gains,
    LT Cap Gains). Sortable per column, searchable, exported as-is. WisdomTree
    uses the actual ex-date under an 'Ex-Date' column. Do not merge this with
    the coded catalog Frequency.

--------------------------------------------------------------------------------
10. WATCHLIST (aggregated holdings of the selected ETFs)
--------------------------------------------------------------------------------
10.1 Columns: # | Ticker (pinned left:0) | Name | ETFs | # ETFs | Weight Sum |
     Max Weight | Market Value | Sector (or Flags for brands with row flags,
     or Category) | Identifier. ETFs cell = one clickable badge per selected
     fund holding that security (font-mono text-xs rounded-full pill,
     bg-blue-50 dark:bg-blue-900/30 ...), badge click opens that fund's
     detail view. Weight Sum / Max Weight render with 3 decimals + '%';
     Market Value via formatMoney or '—'; Identifier mono text-xs.
10.2 Dedupe key fallback (never drop a row for lack of an identifier):
       Ticker -> CUSIP -> ISIN -> Identifier / Security ID -> SEDOL / FIGI ->
       published Name
     namespaced keys T: C: I: D: S: N: (uppercased) so tiers never collide.
     Missing values = '', '-', '--', '—', '–', 'N/A', 'NA', 'NONE', 'NULL'
     (case-insensitive); all-zero CUSIP '000000000' is also missing
     (WisdomTree/EDGAR quirk - never emit key 'D:000000000'). Numeric local
     listing tickers (005930, 8306) are valid keys. Bond, cash (CASH, USD,
     US DOLLAR), futures/swaps/derivatives and zero-weight rows are retained.
     Header alias matching is normalization-based
     (lowercase, strip non-alphanumerics) so old/new provider column names
     both resolve.
10.3 Aggregation: for each dedup key accumulate funds[] (unique, sorted),
     weightSum, maxWeight, marketValue, sectors[] (joined ', '), identifier
     (first sorted), name (latest non-empty), searchIndex = symbol + name +
     identifiers + sectors + funds (lowercase), fundCount = funds.length.
     The result is memoized and invalidated when the selection or the number
     of loaded rows changes; recomputation is throttled (~150 ms) and keeps
     running while the user stays on another tab.
10.4 The tab count is the number of deduplicated HOLDING ROWS, not the number
     of selected ETFs. While loading: 'Watchlist (Loading…)' with nothing
     aggregated yet, 'Watchlist (N+)' while pages stream, exact count only
     when every selected fund has finished or failed. The failed-funds case
     adds an incomplete label and can be retried by reopening the tab.
10.5 Chunked rendering: 250 rows per chunk (Invesco/Fidelity/WisdomTree), 500
     where a whole-catalog feed is embedded in one file (SPDR/Amplify),
     grown by scrolling near the bottom or by the sentinel row
     (#load-more-row / #watchlist-more in variant B). Copy/CSV/TXT always use
     the full filtered set. Search may shrink the exported set but never the
     other way round.
10.6 Empty states: no selection -> 'No ETFs selected yet. Select ETFs in All
     ETFs to build the aggregated Watchlist.'; filter matched nothing ->
     'No Watchlist holdings match your search.'; loading -> 'Loading
     holdings… k of n selected ETF files ready.'; nothing published ->
     'Holdings data is not available yet for the selected ETFs. Run the data
     refresh workflow to publish holdings pages.'; failures -> 'Holdings data
     could not be loaded for one or more selected ETFs. Refresh the page or
     run the data refresh workflow.'
10.7 Ticker-count pill in the header on this tab shows
     '<N,NNN>+ holdings' while loading, exact count after; subtitle shows
     'Watchlist from N selected ETFs · showing X of Y deduplicated holdings...'.

--------------------------------------------------------------------------------
11. TOOLBAR ACTIONS
--------------------------------------------------------------------------------
11.1 Subtitle: '<base sentence> · updated <generatedAt locale string> · <F>
     ETFs · <H> holdings rows · <Y> history rows. Data: <a>api/{{brand}}/
     index.json</a> generated from <a>official source</a>' plus, when a
     selection exists, a live region 'N selected:' followed by the badge
     strip. base sentence per brand, e.g. 'Search {{BRAND}} ETFs, select rows,
     then use the Watchlist tab.'
11.2 Copy Tickers (function copyTickers): per active tab - catalog tabs copy
     the visible filtered catalog tickers, the Watchlist copies the aggregated
     symbols, detail tabs copy the first column of their export rows; the list
     is sorted with localeCompare(..., {numeric:true}), joined by ', ',
     returned early when empty, written via navigator.clipboard.writeText with
     a document.execCommand fallback; on success the button label becomes
     'Copied!' for 1000 ms and then restores. Buttons are disabled while the
     feed is not loaded (Copy/.csv/.txt/Clear all carry `disabled` initially).
11.3 Export .csv: toCsv([headers, ...rows]) with RFC-style quoting (wrap cells
     containing " , or newline, doubling quotes), MIME
     'text/csv;charset=utf-8;', blob download named per section 1.
     Export .txt: the same rows joined by '\t', MIME
     'text/plain;charset=utf-8;'. Both operate on the ACTIVE TAB's filtered
     result set, and the catalog branch must include the coded Frequency at the
     same position as the visible column. Export row shape per tab (keep these
     header lists in sync with the on-screen columns by hand - they are a
     separate code path):
       catalog   ['Selected','Ticker','Fund Name','Type','NAV','Net Assets ($)',
                  'Expense (%)','Dividend Yield (%)','SEC Yield (%)','Frequency',
                  'YTD Return (%)','TR 1Y (%)','TR 3Y (%)','TR 5Y (%)',
                  'TR 10Y (%)','CAGR 3Y (%)','CAGR 5Y (%)','CAGR 10Y (%)',
                  'SI Ann. (%)','Return As Of','Inception','Holdings','History',
                  'As Of'] with Selected = 'yes'|'no'
       watchlist ['Ticker','Name','ETFs','# ETFs','Weight Sum (%)','Max Weight
                  (%)','Market Value','Sector','Identifiers'] with ETFs and
                  identifiers joined by '|' and weights at 6 decimals
       overview  one row of the fund's headline metrics (scope
                  '<TICKER>-overview'); distributions = the raw worksheet
                  headers/rows (scope '<TICKER>-distributions'); holdings /
                  history = the loaded page headers/rows filtered by the active
                  query. Both exports return early (no download) when the
                  current filtered result has zero rows.
11.4 Clear (#reset-btn): clears selection, all tab filters, active fund,
     returns to the 'All' tab, keeps remembered sorts, removes
     {{brand}}-active-fund, empties the search input, updates both storage
     keys, re-applies the tab sort, re-renders. Never resets sort.
11.5 Blacklist: #blacklist-btn toggles #blacklist-panel via
     classList.toggle('is-visible') + aria-expanded +
     syncBlacklistPanelHeight() (JS-measured scrollHeight, because the chip
     list is unbounded; the detail-tabs panel uses the static 8rem max-height
     variant of the same transition). Panel content: #blacklist-input
     (placeholder 'Add ETF tickers to blacklist (e.g. XXXX, YYYY)'),
     #blacklist-add-btn, #blacklist-clear-btn, #blacklist-chips (rose pills
     with a ✕ remove button, title 'Remove TICKER from blacklist'),
     #blacklist-empty helper paragraph. Input accepts space/comma/semicolon
     separated tickers, validates against the known catalog (unknown tickers
     are ignored), removes blacklisted funds from the catalog AND from the
     selection, reassigns the active fund, and persists
     {{brand}}-blacklisted-etfs. Per-row ✕ blacklists one fund in one click.
11.6 Theme toggle: swaps 🌙/☀️, toggles .dark on <html>, writes
     {{brand}}-theme, keeps documentElement.style.backgroundColor in sync
     (#020617 / #f8fafc). No other state changes.
11.7 Upload dropzone (include it whenever the brand has a user-obtainable
     official file; see 2.2 (e)): #dropzone div with dashed border + cloud
     SVG + #dropzone-text label, hidden <input type="file" id="file-input">.
     Two flavours already shipped - implement whichever fits the brand:
       N-PORT flavour (Fidelity, Invesco, WisdomTree): accept=".xml", label
         'Upload / Drop N-PORT XML', parse Form N-PORT-P primary_doc.xml with
         DOMParser entirely in the browser (no network), extract fundInfo,
         invstOrSec positions (name, cusip/identifier, balance, valUSD,
         pctVal, assetCat), repPdDate; merge the fund into the catalog and
         OVERRIDE its holdings when the ticker already exists; session-only
         (never persisted); states dz-active / dz-loaded / dz-error with the
         label restored after 1600/2200 ms; errors like 'Invalid N-PORT XML'
         and 'no genInfo/invstOrSec entries found (is this a Form N-PORT
         primary_doc.xml?)'.
       workbook flavour (iShares, Vanguard): accept=".xls,.xlsx,.xml,.csv",
         label 'Upload / Drop .xls', parse SpreadsheetML/Excel exports into
         sheets, persist to IndexedDB (DB name '{{brand}}WatchlistDB') so a
         reload restores the workbook, and let the static feed and the upload
         coexist (static mode vs uploaded mode, filters stored per mode).
     Uploaded holdings must supersede in-flight feed requests, and uploads
     arriving mid-request must not be lost by the cache writer.

--------------------------------------------------------------------------------
12. ui contract (copy the WisdomTree + SPDR pair and re-brand)
--------------------------------------------------------------------------------
Required sections, in this order: Tabs · Storage keys (table) ·
1. Sort persistence · 2. Per-tab filter persistence & 1-click clear ·
3. Selection scopes · 4. Immediate selection reactivity · 5. Holdings &
Watchlist reactivity · 6. Watchlist aggregation & identifier fallbacks ·
7. Cache & paging races · 8. Payload contract · 9. Detail views ·
10. Sticky columns · 11. Acceptance tests. Also state the shared contract bits
from the other siblings: search placeholder, "opens with no funds selected",
"category tabs filter, they never change the saved selection", data-state
vocabulary (loading vs unavailable vs not applicable), the per-fund
provenance checklist (source + URL, holdings/history as-of, return basis, yield
kind, freshness limits), the target information architecture
'Overview · Holdings · History · Performance · Allocations · Distributions ·
Yields · Price' with the rule "keep the navigation entry and explain the gap",
and the accessibility baseline (accessible names, aria-selected on tabs,
aria-sort on sortable headers, polite live region for status, visible focus,
prefers-reduced-motion).

--------------------------------------------------------------------------------
13. DATA CONTRACT - generated static feed (api/{{brand}}/)
--------------------------------------------------------------------------------
13.1 api/{{brand}}/index.json
  {
    "generatedAt": "<ISO 8601 UTC>",
    "source": { "provider": "<Brand + legal entity>", "market": "us",
                "site": "https://...", "catalog": "<exact bulk URL>",
                "<anything else you want traceable>": "..." },
    "counts": { "funds": N, "holdings": N, "history": N },
    "funds": [ { ... } ]
  }
  funds[] in deterministic alphabetical ticker order, each entry (all display
  values are PRE-FORMATTED strings so the client does no number formatting,
  and every *Value field is the raw number for sorting; unavailable = null and
  the display field is '—'):
    ticker, name, category, fundPage, dataFile ('./funds/T/meta.json'),
    cusip, isin (where the brand has them),
    ter/terValue, nav/navValue, aum/aumValue, asOfDate, inceptionDate,
    exchange, closePrice/closePriceValue, premiumDiscount/premiumDiscountValue,
    distributions: { frequency, exDate, dividend },
    returns: { monthEnd: { asOfDate, mo1, qtd, ytd, yr1, yr3, yr5, yr10,
               sinceInception, inceptionDate, and every *Text '%' variant },
                quarterEnd: { ... } },
    metrics: { tr1y, tr3y, tr5y, tr10y, cagr3y, cagr5y, cagr10y, siAnn,
               dividendYield, secYield, + *Text variants,
               returnsBasis: '<NAV total return | adjusted market price>' },
    distributionFrequency: 'Monthly' | 'Quarterly' | 'Semiannually' |
                           'Annually' | 'None' | 'Unknown' | 'Irregular'
      (BRAND-SPECIFIC: the raw label; the client maps it to the code - or, if
       the brand publishes the code directly like Vanguard, store the label and
       still let the client normalize),
    holdings: <row count>, history: <row count>,
    plus brand extras (netAssetsAsOf, secYieldAsOf, officialMetrics, type...).
  iShares-style variants may instead expose trailingYield/secYield/
  gross+netExpenseRatio/performance/totalReturn/navAsOf; the client's
  normalizeFundRow() is the single place that flattens provider differences
  onto the shared FundRow shape used by columns 7.1.
13.2 api/{{brand}}/funds/<T>/meta.json - superset of the index entry with:
    ticker, name, category, categoryPath,
    source { fundPage, holdingsDownload, navDownload/pricesDownload, factsheet,
             officialProductPage, yahooChart, holdingsSource, historySource,
             provider, nportDoc (EDGAR-based brands) },
    identifiers { cusip, isin, indexTicker },
    expenseRatio { display, value }, nav { display, value, asOfDate },
    marketPrice { display, value, asOfDate }, premiumDiscount { display, value },
    aum { display, value, asOfDate, source },
    yields { dividendYield, dividendYieldText, dividendYieldKind,
             distributionRate, secYield, secYieldText, secYieldKind },
    returns { derivedFrom, monthEnd{}, quarterEnd{} },
    distributions { frequency, paymentsPerYear, headers[], rows[] },
    holdings { pages[], pageSize, totalRows, asOfDate, asOf, source },
    history { pages[], pageSize, totalRows, asOf, source },
    worksheets { ... } only in the workbook flavours (iShares/Vanguard).
13.3 Page envelopes (both folders, files 001.json, 002.json, ... pad3):
    { ticker, page, pageSize, totalRows, headers: [...], rows: [...] }
    Holdings headers (equity): Name, Ticker, Identifier, Weight, Market Value,
    Shares Held (+ Notional Value for SSGA-style feeds, + Asset Category /
    Coupon / Maturity where bonds exist, + Sector/Currency/Location/Exchange
    where the brand publishes them). Non-equity positions carry Ticker '-'
    and a real Identifier.
    History headers: Date, Close, Adj Close, Volume (Yahoo-based brands) or
    Date, NAV, Shares Outstanding, Total Net Assets (issuer NAV-history
    workbooks); Vanguard variant: Date, Open, High, Low, Close, Adj Close,
    Volume. Date rendering follows the brand's source format; the client sorts
    dd-Mmm-yyyy strings chronologically (see compareValues special case).
13.4 api/{{brand}}/update-state.json: { "cursor": "<lastProcessedTicker>" |
    null, "savedAt": "<ISO>" }. Written only by bounded runs
    (MAX_FETCHES>0 with candidates); MAX_FETCHES=0 processes everything and
    resets/omits the cursor. Deleting the file restarts from the first ticker.
13.5 Growth rules: the `returns`/`metrics` blocks are replaced in place, never
    appended; history and distribution rows are appended only when the
    upstream published new rows; paginated files are rewritten only when a
    page-size boundary is crossed; funds that failed to update keep their
    previously published files untouched (no partial overwrite); a transient
    outage of the catalog source falls back to the previously committed
    index.json rather than emptying the site.

--------------------------------------------------------------------------------
14. UPDATER PIPELINE (scripts/update-data.ts)
--------------------------------------------------------------------------------
14.1 Zero dependencies: node:fs/promises + global fetch only (plus node:zlib
     if you must unzip XLSX workbooks - copy SPDR's readZipEntries +
     parseXlsxSheet hand-rolled SpreadsheetML/OOXML reader; copy Invesco's CSV
     reader for CSV brands; copy Fidelity's N-PORT XML reader for EDGAR-only
     brands; copy Amplify's Firestore REST decoder + deterministic
     sortedFieldEntries for NoSQL brands). Shebang `#!/usr/bin/env bun`,
     executable bit, `/// <reference types="bun" />`.
14.2 Shared CLI/env surface (every repo has it; keep names identical):
      -h | --help   prints USAGE with every variable, default and examples
      MAX_FETCHES, REQUEST_SLEEP, CONCURRENCY, MAX_RETRIES, TICKERS,
      AUM, TER, DIVIDEND_YIELD, SEC_YIELD, PERFORMANCE_YTD|1Y|3Y|5Y|10Y,
      TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y, HOLDINGS_PAGE_SIZE (250),
      HISTORY_PAGE_SIZE (1000, alias HISTORICAL_PAGE_SIZE),
      HISTORY_RANGE (max), STORE_RAW_DOWNLOADS, SEC_UA (EDGAR brands),
      plus brand switches: EDGAR_FALLBACK, SKIP_YAHOO, SKIP_{{BRAND}}
      (e.g. SKIP_WISDOMTREE / SKIP_INVESCO), REFRESH_CATALOG,
      AUDIENCE_TYPE, PRICES_HISTORY, CATEGORY, legacy *_LIMIT aliases kept
      working (ISHARES_LIMIT / INVESCO_LIMIT / FIDELITY_LIMIT).
14.3 Filter semantics (unchanged across brands): AND logic; TICKERS combines
      with (never overrides) the rest; catalog filters (TICKERS, AUM, TER)
      apply BEFORE MAX_FETCHES batching; return filters apply on catalog
      values before each download; a young fund missing a requested 3Y/5Y/10Y
      metric PASSES the filter, a fund missing AUM/TER under an active filter
      FAILS; since-inception is stored but not filterable.
14.4 Range syntax: strict `min:max` with exactly one colon; '' and ':' mean no
      restriction; percent and $ signs optional; a configured min must not
      exceed max; anything else throws a usage error. AUM bounds accept plain
      amounts, K/M/B/T suffixes, or the presets
      nano <$10M | micro $10M-$300M | small $300M-$2B | mid $2B-$10B |
      large >=$10B; a preset on the left contributes its lower bound, on the
      right its exclusive upper bound; numeric bounds are inclusive.
      Implement once as parseRange/parseAumRange and test it hard.
14.5 Politeness and resilience: globally paced request starts,
      retries only on network errors + 408/425/429/5xx (and rate-limit 403
      where the issuer returns 403 while throttled) with bounded exponential
      backoff (15s/30s/...); declared User-Agent for SEC (and never send
      secrets); a browser-like UA for Yahoo; per-source skip switches so a
      partial refresh never destroys good data; workflow summary/`console`
      logs with updated / unchanged / skipped / failed counts.
14.6 Math rules: multi-year cumulative total returns derived from annualized
      source figures as TR nY = (1 + CAGR nY)^n − 1 and the inverse for
      annualizing (never mix bases, and record the basis in
      metrics.returnsBasis / returns.derivedFrom); indicated dividend yield =
      latest distribution x payments per year / NAV (labelled "indicated");
      premium/discount = (close - nav)/nav when the source omits it;
      normalizeNumberText expands scientific notation ("2.97E8" -> "297057744");
      treat SSGA-style 5e-324 sentinels (|x| < 1e-290) as missing;
      strip ® and ™, collapse whitespace in names.
14.7 Output writing: write pages/meta/index only when the serialized content
      changed (content-compare against the existing file); strip vendor
      UpdatedAt stamps before comparing (Amplify's preserveUnchangedBlock);
      raw downloads only under STORE_RAW_DOWNLOADS truthy
      (1|true|yes|y|on).

--------------------------------------------------------------------------------
15. CI/CD - .github/workflows/update-data.yml + Pages
--------------------------------------------------------------------------------
15.1 One workflow named 'Update {{BRAND}} ETF data', trigger
     `workflow_dispatch` ONLY (no schedule, no push trigger). `permissions:
     contents: write`. `concurrency: { group: update-data,
     cancel-in-progress: false }`.
15.2 inputs: exactly the 2.2-relevant subset of { max_fetches, request_sleep,
     aum, ter, concurrency, holdings_page_size, history_page_size,
     store_raw_downloads, max_retries, tickers, dividend_yield, history_range,
     edgar_fallback, skip_yahoo, skip_{{brand}}, audience_type,
     prices_history, refresh_catalog, category, sec_yield,
     performance_ytd/1y/3y/5y/10y, total_return_ytd/1y/3y/5y/10y }, each with
     a one-line `description:` and the updater's default, then mirrored into
     `env:` with `${{ inputs.x || '<default>' }}`.
15.3 steps: actions/checkout@v4 -> oven-sh/setup-bun@v2 (latest) ->
     [Validate inline browser script: `bun ./scripts/check-index.ts`] ->
     `bun test scripts/update-data.test.ts` -> `bunx tsc --noEmit` (or the
     inline flags variant in 19.4) -> `bun ./scripts/update-data.ts` ->
     'Commit updated data' guarded by `git diff --quiet -- api/{{brand}}` with
     echo 'api/{{brand}} is already up to date'; commit as
     github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>
     with message 'Update {{BRAND}} ETF data'; git push.
15.4 Pages: deploy from the repository root branch (main), job for the
     deployment is not needed - the Pages build already used by the siblings
     deploys the pushed commit; the catalog UI only changes when generated data
     changed, because index.html/app.tsx are static.
15.5 Rules to preserve: merging code changes never triggers a data run; a
     successful data run may commit ONLY api/{{brand}}/**; never commit
     secrets; never let the workflow push unrelated files.

--------------------------------------------------------------------------------
16. README.md (structure, in this order)
--------------------------------------------------------------------------------
# {{REPO}}
<one paragraph>: '<Brand> ETF holdings to Watchlist. A single-file client-side
tool that reads the generated ./api/{{brand}} static feed (<source list>) into a
searchable ETF / asset-class catalog with per-fund tabs, Watchlist
aggregation, ticker copy and CSV/TXT export - the same look, feel, columns and
business logic as the sibling applications. <Tech line: Vanilla inline
TypeScript + TailwindCSS, light/dark theme, no build step.>'
## Shared UI contract        -> ui contract +
                                catalog ui requirements + bullets
## Sibling applications      -> table: Application | Data provider | Repository
                                (link repo + published app) - include the new
                                brand in every sibling's table via a follow-up
                                PR when asked
## Using Bun                 -> the degit + bunx serve + open snippet, then the
                                published URL and the static-site sentence
## Updating the static <Brand> data
   ### Data sources          -> block/source table (section 2.1 facts)
   ### Known value limitations (or 'Known coverage and freshness limitations')
   ### Update controls       -> env-var table (name, default, meaning)
   ### Resuming bounded runs / Full passes and resuming bounded runs
   ### Strict range syntax   -> the valid/invalid table
   ### AUM ranges and presets -> bounds code block
   ### Return ranges          -> PERFORMANCE_* vs TOTAL_RETURN_* explanation
   ### Examples              -> 3-5 copy-pasteable command lines
## Uploading N-PORT files in the browser   (only if the dropzone ships)
## Developer notes           -> one bullet per subsystem: updater internals,
                                what is stored, paging behaviour, reactivity,
                                blacklist, the two select-all scopes, per-tab
                                search, per-tab sort, table-scroll containment,
                                pinned columns, workflow summary, PR gate
## TypeScript                -> the 'intentionally single-file ... Babel
                                standalone ... no-src-files approach' paragraph
## Brands table              -> '| Бренд | Фонды | Где брать данные |' with the
                                ✅ mark on integrated brands
## Brands list               -> numbered 'Бренд\tФонды из списка (кол-во)\t
                                Официальный сайт / страницы фондов' list
These last two sections are written in Russian in every sibling repo and are
part of the shared documentation set: update them to include the new brand.

--------------------------------------------------------------------------------
17. PER-BRAND DIFFERENCES OBSERVED (what "brand-specific" really means)
--------------------------------------------------------------------------------
17.1 WisdomTree: catalog from wisdomtree.com/us/products (+ r.jina.ai
     rendering fallback because of Cloudflare), full holdings from SEC
     EDGAR Form N-PORT-P (WisdomTree Trust CIK 1350487 via
     company_tickers_mf.json, series Atom feed, raw accession .txt payload),
     history+distributions from Yahoo; BTCW has no SEC mutual-fund row so the
     issuer page's top-holdings table is an explicitly labelled fallback;
     all-zero CUSIPs are treated as missing; no separate Performance tab
     (returns live in the Overview `Returns` section); extra controls
     EDGAR_FALLBACK / SKIP_YAHOO / SKIP_WISDOMTREE / HISTORY_RANGE;
     REQUEST_SLEEP default 1.5-2, CONCURRENCY 2-3; extra script
     scripts/check-index.ts.
17.2 SPDR: SSGA fundfinder + dividend-distribution JSON APIs, per-fund
     holdings-daily and navhist XLSX (real OOXML zips parsed with zlib + a
     hand-rolled reader), browser-UA style fetch, 403-while-rate-limited so
     REQUEST_SLEEP >= 1; SEC Yield always '—'; Dividend Yield is INDICATED;
     bond holdings workbooks have no Ticker column (Identifier identifies them);
     commodity trusts (GLD, GLDM) are catalog-only; no update-state cursor
     committed in some runs; extra env: none beyond the common set.
17.3 Fidelity: holdings from SEC EDGAR N-PORT-P only (two Fidelity trusts plus
     FBTC/FETH registrants), Yahoo for history/NAV/distributions/inception;
     seed files scripts/fidelity-funds.ts (ticker <-> seriesId <-> trust CIK,
     categories, accessions, inceptions, exchange names, expense ratios) and
     scripts/held-tickers.ts (name -> ticker seed from company_tickers.json +
     Nasdaq/NYSE/NYSE American directories, extended live via the Yahoo symbol
     search and written back); FBTC/FETH have no N-PORT (catalog + history +
     distributions, no holdings); mutual funds out of scope; extra env SEC_UA,
     REFRESH_CATALOG, SKIP_YAHOO; 
17.4 Invesco: invesco.com 'Excel Product List Download' CSV catalog (~260
     funds) + per-fund holdings CSV + per-fund pricing history CSV
     (audienceType Investor/Advisor switch), Yahoo for history/distributions,
     N-PORT only as fallback; extra env AUDIENCE_TYPE, PRICES_HISTORY,
     EDGAR_FALLBACK, SKIP_YAHOO, SKIP_INVESCO; catalog URL pattern
     /us/en/financial-products/etfs/<ticker>.html, detail pattern
     ...?ticker=<TICKER>; tsconfig.json exists here only.
17.5 iShares: BlackRock varnish API get-fund-document (SpreadsheetML .xls per
     portfolioId) + get-product-data fundHeader, catalog from
     ishares.com/us/products/etf-investments; dual mode (static feed AND
     browser upload) with IndexedDB persistence; per-fund worksheets are
     Holdings/History/Performance/Distributions/SEC Yield etc. and the
     distribution frequency is DERIVED from the Distributions worksheet rows;
     page background slate-950 with its own blended hex set; playwright
     browser test scripts/ui-parity.browser.mjs + package script
     "test:ui": "node scripts/ui-parity.browser.mjs".
17.6 Vanguard: workplace.vanguard.com fundDetails JSON (portIds) with
     Referer header, investor.vanguard.com/irr/funds/profile per-fund JSON,
     advisors.vanguard.com HTML parse as fallback, EDGAR N-PORT-P for holdings,
     Yahoo for daily history; a checked-in FUNDS_SEED table of
     [ticker, legal name, category] in the updater; distributionFrequency comes
     from fundCharacteristics.fundDistributionFrequency; index.json entry keeps
     extra fields (portfolioId/portId, type, officialPage, officialMetrics,
     netAssetsAsOf, secYieldAsOf, trailingYield as a raw number); inline app in
     index.html (variant B) with DETAIL_SHEETS
     Holdings/Historical/Performance/Distributions; README is a stub - the
     new brand must NOT copy that: ship the full README (section 18).
17.7 Amplify: Google Firestore REST feed (project amplify-etfs-data-feed,
     collections fund_category, funds/<t>/fund_metadata/overview,
     distributions subcollection, holdings), all data embedded in a single
     api/data.json ({generatedAt, source, counts, funds[], holdings{ticker},
     details{ticker}}) so there are no per-fund fetches and no page races
     (Watchlist count is always exact); 'Flags' column instead of 'Sector';
     extra env CATEGORY, SEC_YIELD; stamp-stripping idempotency trick
     (preserveUnchangedBlock); tests use happy-dom + scripts/
     ui-contract.test.ts + scripts/typecheck-app.ts.
17.8 Lesson: a new brand may need ANY of {issuer bulk download, HTML scrape +
     proxy, EDGAR N-PORT, Yahoo, Firestore/other API, workbook upload, name ->
     ticker seed file}. The UI never learns which: it only consumes
     api/{{brand}}/** and, optionally, a browser upload. Keep that boundary.

--------------------------------------------------------------------------------
18. IMPLEMENTATION STAGES (execute in order; each stage ends green)
--------------------------------------------------------------------------------
S0  Research the brand (section 2). Write docs/plan-{{brand}}.md and the
    README 'Data sources' + 'Known value limitations' skeleton BEFORE code.
    Exit: every metric in 7.1 has a decided source or a documented gap.
S1  Scaffold (section 3): repo name, LICENSE, .gitignore, favicon.ico,
    package.json, bun.lock, empty api/{{brand}}/ with a hand-written 3-5 fund
    fixture feed matching 13.1-13.3 exactly.
    Exit: `bunx serve . -p 1234` serves the fixture index.json.
S2  index.html shell (sections 4.3, 5, 6): head, theme bootstrap, <style>,
    header, toolbar, blacklist panel, detail-tabs nav, table card, sentinel.
    Exit: page renders, dark/light toggles with no flash, no horizontal
    document scroll, ids all present (check against section 4.4 list).
S3  Catalog view (section 7): fetchJson + loadCatalog + normalizeFundRow +
    renderFundsTable (headers, rows, tooltips, empty state, status line,
    ticker-count pill, subtitle), search, sort, row click, blacklist ✕,
    pinned Use+Ticker (8.7), coded Frequency column (7.6).
    Exit: 25 columns in the exact order, all sortable, search view-scoped,
    pinned columns verified by scrolling to the far right in a real browser.
S4  Tabs + per-tab state (sections 8.1-8.5, 8.8): category tabs, All ETFs pill
    checkbox, detail-tabs panel, localStorage map keys, migration of
    {{brand}}-searches, boot sanitization, Clear semantics.
    Exit: the 17-test contract list (19.1) passes for filters/sorts/scopes.
S5  Detail views (section 9): meta.json loading, Overview, paginated
    Holdings/History with sentinel + per-ticker dedup + concurrency 6,
    Distributions, loading/error/no-data states, generation reset.
    Exit: switching funds never flashes stale rows; a 404 on one fund file
    shows the explanatory state.
S6  Watchlist (section 10): dedupe chain, aggregation cache + invalidation,
    Loading…/N+/exact count, 250-row chunks, ETF badges, pinned Ticker,
    Copy/CSV/TXT over the full set.
    Exit: rapid overlapping selections produce no duplicate/skipped page and
    the aggregate equals an independently computed oracle over the feed.
S7  Exports + upload (sections 11.2-11.3, 11.7): CSV quoting, TXT tabs,
    file names, dropzone flavour chosen in S0, session-only merge semantics.
    Exit: exporting each tab reproduces exactly what is on screen, including
    Frequency; an uploaded official file merges and overrides holdings.
S8  Updater (section 14) against the LIVE brand sources, first with
    TICKERS="<one ticker>" then MAX_FETCHES=10, then a full pass.
    Exit: rerun on unchanged upstream = `git diff` empty; index/counts/meta
    consistent; update-state cursor advances and wraps.
S9  Workflow (section 15) + Pages settings (deploy from main root) + first
    real data commit. Exit: workflow_dispatch run succeeds and Pages serves
    https://daggerok.github.io/{{REPO}}/ with the live feed.
S10 Tests + docs (sections 12, 16, 19) and the README 'Developer notes'
    rewrite for this brand's specifics. Exit: `bun test` green; typecheck
    green; node --check green; README renders in GitHub with working links.
S11 Polish/parity audit: diff your rendered DOM against the sibling site
    (same headings, same order, same tooltips style, same button text, same
    pill/spacing/hover/motion). Exit: a side-by-side click-through shows no
    behavioural divergence except documented data gaps.
S12 End-to-end testing on the deployed Pages URL (section 20), plus the
    follow-up PRs that add the new brand to every sibling README 'Brands
    table' / 'Sibling applications' / 'Brands list' (section 16) if the human
    asks for it.

--------------------------------------------------------------------------------
19. TESTING CONTRACT (mirrors what the siblings actually run)
--------------------------------------------------------------------------------
19.1 scripts/ui.test.ts + scripts/ui-harness.ts (the real acceptance suite).
    The harness boots the ACTUAL app source (it transpiles app.tsx or extracts
    the inline script) inside a hand-written fake DOM (FakeElement,
    querySelector/All, classList, dataset, dataset events, innerHTML parsing),
    MemoryStorage for localStorage, optional IndexedDB stub, and a file-backed
    fetch over api/{{brand}}/ that counts requests. Helpers exported:
    until(), sleep(), createApp({storage}), feedJson(rel), catalogTickers(),
    fundHoldingRows(t), cleanFeedValue(), watchlistKey(), parseFeedNumber(),
    expectedWatchlist(tickers) (the independent oracle).
    Required tests, numbered exactly as in daggerok/WisdomTree:
      1  per-tab sort survives tabs, checkboxes, buttons, Clear and reload
      1b Watchlist remembers its own sort separately from the catalog
      2  header Use check selects exactly the filtered ETFs
      2b filtered bulk selection immediately opens the selected-fund panel
      3  header Use uncheck removes only visible tickers; hidden survive
      4  All ETFs pill selects the whole non-blacklisted catalog without
         navigating
      5  selecting one ETF shows Watchlist Loading then the exact count
      6  rapid overlapping selections load without duplicate or skipped pages
      7  deselecting an ETF updates subtitle, tabs and Watchlist immediately
      8  selecting all ETFs aggregates the whole feed and keeps the DOM bounded
      9  reload restores selection, active fund and rebuilds the Watchlist
      10 Holdings, History, Overview and Distributions render real rows
      11 a fund whose files fail to load shows an explanatory state
      12 bond rows fall back to identifiers; cash and zero-weight rows kept
      13 sticky classes are on catalog Use/Ticker and Watchlist Ticker cells
      14 malformed localStorage is sanitized and boot still succeeds
      15 index.json / meta.json / page manifests stay consistent
      16 per-tab filter persistence: each tab keeps its own query independently
      17 #search-clear-btn visibility, active-tab clearing, immediate re-render
    Expected values are computed from THIS repo's generated feed, never copied
    from another brand's numbers.
19.2 scripts/update-data.test.ts: pure-function unit tests with inline
    fixtures - range parser (empty/':'/inclusive/optional %/$/colonless
    rejected/min>max rejected), AUM presets and suffixes, number-text
    normalization (sci notation, provider placeholders), date normalization
    (US, ISO, 'Mon D YYYY', epoch days), the provider file readers (CSV with
    quotes/CRLF/BOM/preamble, XLSX sheet, XML/N-PORT, Firestore value
    decoder), identifier resolution, return derivations (annualized <->
    cumulative, young-fund nulls, quarter anchoring), catalog metric
    derivation, distribution-frequency derivation, page splitting and
    deterministic write decisions.
19.3 Optional but recommended: a happy-dom DOM test (Amplify-style
    scripts/ui-contract.test.ts) and a playwright scroll test (iShares-style
    scripts/ui-parity.browser.mjs) whose sole job is to scroll the catalog and
    Watchlist tables fully right in BOTH themes and assert no bleed-through and
    working clicks - this is the class of bug that CSS review cannot catch.
19.4 Verification gate before every push/PR (Bun only, no tsconfig):
      bun install --frozen-lockfile
      bun test
      bunx tsc --noEmit --target es2022 --module esnext \
        --moduleResolution bundler --types bun,node --skipLibCheck \
        scripts/update-data.ts scripts/update-data.test.ts
      bun ./scripts/check-index.ts        (node --check on the transpiled
                                           inline/browser script)
      git diff --check
    All five must pass; paste their output in the PR description.

--------------------------------------------------------------------------------
20. END-TO-END TESTING (manual, on the deployed Pages URL)
--------------------------------------------------------------------------------
E1  Fresh profile, no localStorage: title, favicon, fonts, header pill
    'Loading…' -> 'N ETFs', zero funds selected, no console errors.
E2  Search: type in All ETFs, confirm only the catalog filters; switch to a
    fund detail tab (input clears to that tab's own query); type there; return;
    both queries intact; ✕ clears only the active tab and refocuses; reload -
    both restored.
E3  Sort: click YTD Return, tab to Watchlist and a detail tab, toggle header
    Use, export CSV, toggle theme, press Clear - the YTD Return order survives
    every one of them; a never-sorted tab keeps its default; click Ticker asc
    to get back to a default-ish order.
E4  Selection scopes: filter to 5 rows, header Use -> exactly those 5 selected;
    clear filter, header Use uncheck -> only the visible 5 deselected, others
    survive; All ETFs pill from a detail tab -> whole catalog, no navigation;
    blacklist one fund while selected -> it leaves the catalog, the selection
    and the Watchlist immediately.
E5  Watchlist: select 3 overlapping funds; count starts 'Loading…'/'N+', ends
    exact; # ETFs and Weight Sum/Max Weight match a hand-computed oracle on
    api data; ETF badges open details; scroll to load all chunks; export CSV/TXT
    contains the FULL set; the page never scrolls, only the table does.
E6  Detail: click a ticker -> Overview renders sections; Holdings infinite
    scroll loads page 2 exactly once per page (Network panel: no duplicate
    requests, no skipped pages); History same; Distributions shows raw rows;
    force a bad fund (temporarily rename a file locally) -> 'Could not load
    <TICKER> data — ...' replaces the table, no stale rows.
E7  Pinned columns: scroll right to the end in light and dark, on a hovered
    row and on a selected row - Use + Ticker stay opaque, nothing bleeds,
    checkbox and ✕ clickable, header cell matches header row colour, `#`
    scrolls away, and the Watchlist Ticker stays pinned at the left edge.
E8  Export parity: for every tab, the CSV header order equals the on-screen
    order (Frequency between SEC Yield and YTD Return, coded value identical),
    TXT is the tab-separated twin, file name is
    {{brand}}-<scope>-<YYYY-MM-DD>.<ext>.
E9  Upload: drop a real official file (N-PORT XML / .xls export) -> parsed
    in-browser with no network call, catalog/detail/Watchlist update, label
    states animate, reload wipes it (session-only).
E10 Theme + motion: toggle persists across reload with no flash; with
    'prefers-reduced-motion' emulated, animations and transitions are off.
E11 Mobile: at 375px and 768px the toolbar wraps, tabs scroll horizontally
    inside the card, table is horizontally scrollable, no layout overflow.
E12 Keyboard/a11y: every control reachable by Tab with a visible focus ring,
    tab buttons expose aria-selected, sort buttons have accessible names,
    status changes are announced (aria-live), theme button and search clear
    have titles/labels.
E13 Data freshness loop: run the workflow manually with MAX_FETCHES=10 ->
    it commits only api/**, Pages rebuilds, the catalog reflects new numbers;
    run again with no upstream change -> 'already up to date', no commit.
E14 Feed integrity: curl index.json + a sample meta.json + every page listed
    in a manifest; counts.funds == len(funds); per-fund holdings/history
    counts == sum of page rows; a page's headers match its row keys.

--------------------------------------------------------------------------------
21. FINAL ACCEPTANCE CHECKLIST (all must be true before you say "done")
--------------------------------------------------------------------------------
[ ] Repository layout byte-comparable to daggerok/Invesco (same file names,
    same section order in README, same script names).
[ ] index.html: exact ids from 4.4, exact <style> rules from 6, no extra
    framework/CDN.
[ ] Title/description/h1/body classes match section 1's shared wording.
[ ] Catalog columns in the exact 7.1 order; `—` for unavailable metrics;
    coded Frequency between SEC Yield and YTD Return; tooltip names the source
    and the code legend; Overview keeps the RAW label.
[ ] Pinned: catalog Use (0/5rem) + catalog Ticker (5rem/<W>) + Watchlist
    Ticker (0/<WW>), sticky on the cells themselves, opaque pre-blended
    backgrounds for default/hover/selected in both themes, right-edge shadow,
    no leakage into any other sheet; verified by scrolling in a browser.
[ ] localStorage keys all {{brand}}-prefixed, sanitization at boot, legacy
    searches migration, sorts never reset by any control, Clear = selection +
    filters only.
[ ] Three selection scopes behave exactly as 8.5, including the
    .every()-based checked states.
[ ] Watchlist: dedupe fallback chain + namespaced keys + placeholder rules +
    zero-CUSIP rule + retention of cash/bond/derivative/zero-weight rows;
    Loading…/N+/exact count; 250-row chunks; full-set exports; concurrency
    bound and per-ticker single writer.
[ ] Detail: paging, shared cache, generation reset, explanatory states for
    missing/failed data, provenance rows readable in Overview.
[ ] Exports: CSV quoting, TXT tab-separated twin, filename scheme, Selected
    yes/no first column on the catalog branch.
[ ] Blacklist panel animates via .is-visible + JS-measured scrollHeight;
    chips removable; ✕ in rows works.
[ ] Updater: USAGE help, all env switches, strict ranges, AND filters,
    resumable cursor, retries/backoff, deterministic and idempotent writes,
    honest metadata (source strings, as-of dates, return/yield basis).
[ ] Workflow: manual dispatch, input parity with the env table, only api/**
    committed, Pages deployment verified live.
[ ] Tests: 19.1 suite (all numbered tests), 19.2 updater unit tests,
    19.4 gate all green; playwright/happy-dom variant test where chosen.
[ ] Docs: docs/ui-contract.md re-branded; docs/catalog-ui-requirements.md
    with this repo's real line numbers and colours; README complete per
    section 16 including Brands table/list updated with the new brand.
[ ] Live URL reachable: https://daggerok.github.io/{{REPO}}/ with the feed and
    app.tsx served (200), relative paths only, works offline-cacheable, no
    mixed content, no console errors on load.

--------------------------------------------------------------------------------
22. RESEARCH THE AGENT MUST DO AT IMPLEMENTATION TIME (impossible now)
--------------------------------------------------------------------------------
22.1 Live endpoint reconnaissance for the brand: exact current URLs, query
     parameters, pagination, required headers (User-Agent, Referer, Accept),
     content types (JSON/CSV/XLSX/SpreadsheetML/HTML/NoSQL REST), bot
     protection, rate-limit response shapes (403 vs 429), robots/ToS and any
     licensing constraint that changes what may be redistributed as a static
     feed. Endpoints and payload shapes drift; re-verify every URL with a real
     request from the updater and store one raw sample under
     api/{{brand}}/raw (with STORE_RAW_DOWNLOADS on) while developing, then
     decide whether to keep them committed.
22.2 The current fund universe: ticker list, closed/merged funds, non-ETF
     vehicles to exclude, share-class rows to collapse, and each fund's
     category/asset-class naming (the category tab labels come verbatim from
     the provider, so capture the provider's vocabulary exactly).
22.3 Which shared metrics the brand truly publishes today (SEC yield,
     trailing-12M vs indicated yield, month-end vs quarter-end return series,
     inception, CUSIP/ISIN, premium/discount, distributions) and the exact
     provider column names/aliases to normalize - this determines both the
     `—` set and the tooltip wording.
22.4 Whether a discrete distribution-frequency label exists; if not, the
     empirical thresholds for deriving it from that brand's actual payment
     rows (measure the real gaps for 20 funds before fixing the
     20-40/70-110/150-215/330-400 day windows).
22.5 Identifier reality of the brand's holdings: are bond/cash/derivative
     rows present, do they publish Ticker '-' with CUSIP/ISIN/SEDOL, any
     all-zero placeholders; this drives the dedupe tier that actually fires.
22.6 SEC registration mapping (trust CIK <-> series/class ids) if EDGAR is
     used at all, plus the accession-fetch quirk (primary_doc.xml at the
     archive root may lack positions: parse the raw accession .txt), and the
     current N-PORT filing cadence so the Holdings As Of date is explained
     honestly.
22.7 Yahoo Finance availability/limits for the brand's tickers (new listings
     may be missing; intraday vs adjusted closes; dividend event coverage),
     because Yahoo is the fallback for history and distributions.
22.8 Number/measure UI specifics: longest ticker (pinned Ticker width),
    whether the Watchlist first column can contain long names (fixed width vs
    ellipsis), whether any provider header text wraps the 12-column toolbar.
22.9 Whether the brand's own data is obtainable in a user-uploadable official
    format (which dropzone flavour to ship, its accept= list and label), and
    how the uploaded file's columns map to the shared position contract.
22.10 GitHub-specific live checks: Pages build setting actually enabled for the
    new repo (Settings -> Pages -> Deploy from a branch -> main/root), Actions
    permissions for the workflow (Read and write, or contents: write), whether
    the repo is added to the org/repo list used by the sibling READMEs, and
    the workflow's first successful run time (Pages rebuild lag).
22.11 Regression sweep against the six existing deployments AFTER your build:
    open each sibling app side by side with yours and diff the interaction you
    just shipped - if a sibling changed while you were building (they move
    fast: the shared contract has been amended four times in the last days),
    port the change rather than shipping the older behaviour, and record it in
    docs/ui-contract.md.
22.12 Anything the plan does not answer: prefer the most recently updated
    sibling implementation (currently daggerok/Invesco, daggerok/iShares,
    daggerok/Fidelity) as the tie-breaker, and read their git log and docs/
    for the latest contract amendments (docs/catalog-ui-requirements.md,
    docs/ui-parity-plan.md, docs/parity-recheck.md) before deciding.

--------------------------------------------------------------------------------
23. KNOWN PITFALLS (each one already cost a real bug in a sibling repo)
--------------------------------------------------------------------------------
P1  Sticky applied to a nested span/div inside the cell -> pin silently fails
    past scrollLeft 0. Put it on the <th>/<td>. (SPDR shipped this 3 times.)
P2  Translucent rgba() backgrounds on pinned cells -> scrolled text bleeds
    through. Use pre-blended opaque hexes for this repo's own colour stack.
P3  Missing `background` on `thead .catalog-sticky-col` -> the pinned header
    cell mismatches the header row. Always add the header rule.
P4  `border-collapse:collapse` from the Tailwind utility on <table> ->
    sticky seams glitch; the #table-scroll table{border-collapse:separate}
    id rule overrides it intentionally - do not "fix" it by deleting the rule.
P5  Positional :nth-child() selectors on #table-scroll -> leaks pinning into
    Watchlist and every detail sheet. Use opt-in classes only.
P6  Computing frequency client-side from per-fund files -> hundreds of extra
    requests; derive it once in the updater into index.json.
P7  A control that silently resets sort (Clear, blacklist, select-all, theme)
    -> violates the contract; sort state changes only on header clicks.
P8  Header Use checked-state by comparing sizes (selected.size == count) ->
    wrong under filters; must be .every() over the visible rows.
P9  Showing an exact Watchlist count while holdings still stream -> must be
    'Loading…' or 'N+'.
P10 Dropping rows without a ticker (bonds/cash/derivatives) -> must fall back
    through identifiers to the published name.
P11 Duplicated or skipped pages when selection changes fast -> per-ticker
    serialized writer chain + shared page cache.
P12 Boot hydration overwriting a restored filter with '' -> save outgoing query
    only when the destination differs from the current tab.
P13 Non-deterministic ordering / vendor stamp churn -> empty git diff on no-op
    runs is a feature, not a coincidence: sort everything, strip UpdatedAt.
P14 Committing unrelated files from the workflow -> restrict to api/{{brand}}.
P15 Editing only index.html and forgetting app.tsx (variant A) or vice versa;
    and in variant B, leaving a stale dist/ or .parcel-cache/ - they are
    gitignored dead weight, never wire a Parcel build.
P16 Assuming `document` scroll behaviour: only #table-scroll scrolls; if you
    add a max-height or remove overscroll-behavior you break the whole layout.
P17 Using an em dash for a loading value, or a spinner for a not-published
    value. The three states are distinct in text and in tooltips.
P18 Copying iShares/Vanguard's legacy page background (#020617,
    dark:bg-slate-950) or their upload-only title into a new brand built on
    variant A - their colour blend constants differ; pick one stack and blend
    against it.

================================================================================
BRAND: <<FILL IN ONE OF: WisdomTree | SPDR | Vanguard | Amplify | iShares |
Fidelity | Invesco | <new brand, e.g. Schwab | VanEck | JPMorgan | Global X |
abrdn | NEOS | Goldman Sachs | Sprott | First Trust | Capital Group |
FlexShares | Roundhill | ProShares | Themes ETFs | SP Funds>>>
================================================================================
Do, in this exact order, without asking for further instructions:
  1. Read this plan in full, then clone and read the three reference repos
     named in section 1 (Invesco, Fidelity, WisdomTree) plus any other sibling
     listed in 17.x that matches the brand's data situation
     README 'Developer notes'.
  2. Run stage S0: research the brand end to end (section 2 + 22), write the
     brand data plan doc, and list every metric with its decided source or
     documented gap. Do not proceed with assumptions - verify live.
  3. Execute stages S1..S12 mechanically (section 18), keeping the shared
     wording, ids, classes, columns, storage keys and CSS exactly as specified;
     substitute only the brand name, the source URLs, the seed files, the
     column tooltips that name the source, the subtitle sentence, and the
     documented gaps.
  4. Run the 19.4 verification gate plus the 19.1 suite after every stage, not
     just at the end; fix regressions immediately instead of at the end.
  5. Finish with the section 20 end-to-end test pass on the deployed
     https://daggerok.github.io/{{REPO}}/ URL (and locally via `bunx serve .`),
     then the section 21 checklist item by item, quoting the actual command
     output or measured value for each item in your final report.
  6. Report back: the commit hash, the Pages URL, the feed size (funds /
     holdings rows / history rows), the full list of metrics shown as `—` with
     the reason, and any contract deviation - there should be none, so if you
     made one, explain it explicitly.
================================================================================
</plan>
-->
