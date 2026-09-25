/**
 * @file Franklin Watchlist Application
     * Client-side static feed viewer for api/franklin/** with multi-ETF Watchlist
     * aggregation. Same single-file approach as daggerok/Amplify: the paginated
     * static API and lazy sheet loading follow daggerok/iShares.
     *
     * Babel standalone note: the inline pipeline strips type annotations, but it
     * does not accept every TypeScript-only expression. Follow the Amplify dev
     * style — plain `byId()` instead of DOM casts, no `as` casts, no non-null
     * `!`, no interfaces or enums.
     */

    // =========================================================================
    // 1. Types, constants & column tooltips
    // =========================================================================

    type ActiveTab = string;
    type SortDirection = 'asc' | 'desc';
    type TableRow = Record<string, unknown> & { searchIndex?: string };
    type TabInfo = { id: ActiveTab; label: string; count: number };

    type IndexFund = {
      ticker: string;
      name: string;
      category: string;
      fundPage: string;
      dataFile: string;
      ter: string;
      terValue: number;
      nav: string;
      navValue: number;
      aum: string;
      aumValue: number;
      asOfDate: string;
      inceptionDate: string;
      exchange: string;
      closePrice: string;
      premiumDiscount: string;
      cusip?: string | null;
      isin?: string | null;
      distributions: { frequency: string; exDate: string; dividend: string };
      returns: { monthEnd: Record<string, any>; quarterEnd: Record<string, any> };
      metrics?: {
        tr1y?: number | null;
        tr3y?: number | null;
        tr5y?: number | null;
        tr10y?: number | null;
        cagr3y?: number | null;
        cagr5y?: number | null;
        cagr10y?: number | null;
        siAnn?: number | null;
        dividendYield?: number | null;
        dividendYieldText?: string | null;
        secYield?: number | null;
      };
      holdings: number;
      history: number;
    };

    type FundRow = TableRow & {
      ticker: string;
      name: string;
      category: string;
      fundPage: string;
      ter: string;
      terValue: number;
      nav: string;
      navValue: number;
      aum: string;
      aumValue: number;
      asOfDate: string;
      inceptionDate: string;
      exchange: string;
      closePrice: string;
      premiumDiscount: string;
      ytd: number;
      yr1: number;
      yr3: number;
      yr5: number;
      yr10: number;
      si: number;
      tr3y?: number | null;
      tr5y?: number | null;
      tr10y?: number | null;
      cagr3y?: number | null;
      cagr5y?: number | null;
      cagr10y?: number | null;
      dividendYield?: number | null;
      secYield?: number | null;
      frequencyCode?: string;
      returnAsOf: string;
      returns?: { monthEnd: Record<string, any>; quarterEnd: Record<string, any> };
      distributions?: { frequency: string; exDate: string; dividend: string };
      holdings: number;
      history: number;
    };

    type WatchlistRow = TableRow & {
      symbol: string;
      name: string;
      funds: string[];
      fundCount: number;
      weightSum: number;
      maxWeight: number;
      cusips: string[];
      identifier: string;
    };

    const INDEX_URL = './api/franklin/index.json';
    const THEME_KEY = 'franklin-theme';
    const SELECTED_KEY = 'franklin-selected-etfs';
    const BLACKLIST_KEY = 'franklin-blacklisted-etfs';
    const ACTIVE_FUND_KEY = 'franklin-active-fund';
    const SEARCHES_KEY = 'franklin-searches';
    const SORTS_KEY = 'franklin-tab-sorts';
    const DEFAULT_SELECTED_TICKERS: string[] = []; // start clean: no pre-selected funds
    const WATCHLIST_PAGE_SIZE = 250; // chunked Watchlist rendering (sentinel appends the next chunk)
    const MAX_CONCURRENT_HOLDINGS_LOADS = 6; // bounded parallelism for the per-fund holdings preload

    const DETAIL_TABS: Array<{ key: string; label: string }> = [
      { key: 'overview', label: 'Overview' },
      { key: 'holdings', label: 'Holdings' },
      { key: 'history', label: 'History' },
      { key: 'distributions', label: 'Distributions' },
    ];

    const NUMERIC_SHEET_HEADERS = ['Weight', 'Shares Held', 'Shares Outstanding', 'Total Net Assets', 'Par Value', 'Market Value', 'Coupon', 'NAV'];

    // Hover explanations for table headers. Native `title` tooltips, same pattern as daggerok/iShares.
    const COLUMN_TOOLTIPS: Record<string, string> = {
      '#': 'Row index in current table view.',
      Use: 'Use / Multi-ETF Selection — Check this box to include this ETF\'s underlying holdings in the combined Watchlist tab.',
      Ticker: 'Ticker Symbol — Unique stock market identifier. For holdings: the exchange ticker resolved from public SEC / exchange data at data-build time. "—" when the position has no exchange ticker (bond, private debt) — then the Identifier is the key.',
      'Fund Name': 'Fund Name — Official legal name of the Franklin exchange-traded fund (ETF), as published on the franklintempleton.com product list.',
      Category: 'Category — franklintempleton.com groups its ETFs by asset class and sub-category ("Equity, US Equity"); the tab shows the asset class, the full grouping is kept in meta.json.',
      Name: 'Security Name — Full registered legal name of the company or underlying financial asset.',
      Identifier: 'CUSIP / ISIN — Security identifier as published by franklintempleton.com (or taken from the N-PORT filing when that fallback supplied the sheet). Positions without an exchange ticker (bonds, cash, futures) are identified in the Watchlist by this.',
      SEDOL: 'SEDOL — Stock Exchange Daily Official List identifier.',
      TER: 'Gross Expense Ratio — Total annual fund operating expenses as a % of assets.',
      NAV: 'NAV (Net Asset Value) — Per-share dollar value of the fund.',
      'Net Assets': 'Net Assets (AUM) — Total market value of all fund assets minus liabilities.',
      Weight: 'Weight — Position weight as a percentage of the fund\'s total net assets.',
      'Weight Sum': 'Weight Sum — Summed weight of this holding across all selected ETFs (%).',
      'Max Weight': 'Max Weight — Highest single-fund weight for this holding across selected ETFs (%).',
      '# ETFs': 'Number of selected ETFs that currently hold this security.',
      ETFs: 'Selected ETFs holding this security.',
      Type: 'Category — the asset-class part of the franklintempleton.com grouping (see the Category column). Same source as the category tabs.',
      Expense: 'Gross Expense Ratio — Total annual fund operating expenses as a % of assets.',
      'Dividend Yield': 'Dividend Yield — the trailing-12-month yield published by franklintempleton.com when present; otherwise indicated (latest distribution per share x payments per year / market price) from the Yahoo dividend history.',
      'SEC Yield': 'SEC Yield (30-Day) — The 30-day SEC yield as published by franklintempleton.com (mostly fixed income funds); "—" when Franklin lists none for the fund.',
      'YTD Return': 'YTD Return — Market-price total return since the start of the year, computed from adjusted closes (Yahoo). Not an official NAV return.',
      'TR 1Y': 'TR 1Y (1-Year Total Return) — NAV total return over the past year, including reinvested distributions.',
      'TR 3Y': 'TR 3Y (3-Year Total Return) — Cumulative market-price return over 3 years, derived exactly from the 3Y CAGR: (1 + CAGR 3Y)^3 - 1 (adjusted closes).',
      'TR 5Y': 'TR 5Y (5-Year Total Return) — Cumulative market-price return over 5 years, derived exactly from the 5Y CAGR: (1 + CAGR 5Y)^5 - 1 (adjusted closes).',
      'TR 10Y': 'TR 10Y (10-Year Total Return) — Cumulative market-price return over 10 years, derived exactly from the 10Y CAGR: (1 + CAGR 10Y)^10 - 1 (adjusted closes).',
      'CAGR 3Y': 'CAGR 3Y (3-Year Compound Annual Growth Rate) — Annualized market-price return over 3 years, computed from adjusted closes.',
      'CAGR 5Y': 'CAGR 5Y (5-Year Compound Annual Growth Rate) — Annualized market-price return over 5 years, computed from adjusted closes.',
      'CAGR 10Y': 'CAGR 10Y (10-Year Compound Annual Growth Rate) — Annualized market-price return over 10 years, computed from adjusted closes.',
      YTD: 'YTD market-price total return, last trading day (adjusted closes).',
      '1Y': '1-year NAV return, month-end series.',
      '3Y': '3-year average annual NAV return (CAGR), month-end series.',
      '5Y': '5-year average annual NAV return (CAGR), month-end series.',
      '10Y': '10-year average annual NAV return (CAGR), month-end series.',
      'SI Ann.': 'Since-inception annualized NAV return, month-end series.',
      'Return As Of': 'As-of date of the month-end return series.',
      Inception: 'Fund inception date.',
      Exchange: 'Primary listing exchange.',
      Close: 'Most recent closing market price.',
      'Prem/Disc': 'Premium / Discount — Closing price versus NAV (%).',
      Holdings: 'Rows in the fund\'s latest daily holdings file.',
      History: 'Rows in the fund\'s NAV history file.',
      'As Of': 'NAV / AUM as-of date.',
      Frequency: 'Distribution frequency — coded for sorting. scripts/update-data.ts publishes the canonical label from the franklintempleton.com distributions row (normalizeDistributionFrequency), falling back to inferDistributionFrequency over the Yahoo Finance dividend-history feed, and this recodes it. Codes: 01 Monthly, 04 Quarterly, 06 Semi-annually, 12 Annually, 99 Irregular, 00 Unknown/None/—.',
      'Ex-Date': 'Ex-dividend date of the latest distribution.',
      Dividend: 'Latest dividend per share.',
      Coupon: 'Bond annual coupon rate (%).',
      Maturity: 'Bond maturity date.',
      'Market Value': 'Position market value in local currency.',
      Section: 'Section — Grouping of the overview metric (Fund, Cost, Price, Assets, Returns, Distributions, Holdings).',
      Metric: 'Metric — Overview metric name.',
      Value: 'Overview metric value.',
      Date: 'NAV history date.',
      'Shares Outstanding': 'Fund shares outstanding on that date.',
      'Total Net Assets': 'Fund total net assets on that date (USD).',
    };

    // =========================================================================
    // 2. DOM references, application state & lazy fund data
    // =========================================================================

    function byId(id: string): any {
      const element = document.getElementById(id);
      if (!element) throw new Error(`Missing element #${id}`);
      return element;
    }

    const dropzone = document.getElementById('dropzone');
    const dropzoneText = document.getElementById('dropzone-text');
    const fileInput = document.getElementById('file-input');

    const el = {
      themeToggle: byId('theme-toggle'),
      tickerCount: byId('ticker-count'),
      subtitle: byId('app-subtitle'),
      searchInput: byId('search-input'),
      searchClearBtn: byId('search-clear-btn'),
      tabsBar: byId('tabs-bar'),
      selectedTabsPanel: byId('selected-tabs-panel'),
      selectedTabsBar: byId('selected-tabs-bar'),
      copyBtn: byId('copy-btn'),
      exportCsvBtn: byId('export-csv-btn'),
      exportTxtBtn: byId('export-txt-btn'),
      resetBtn: byId('reset-btn'),
      blacklistBtn: byId('blacklist-btn'),
      blacklistPanel: byId('blacklist-panel'),
      blacklistInput: byId('blacklist-input'),
      blacklistAddBtn: byId('blacklist-add-btn'),
      blacklistClearBtn: byId('blacklist-clear-btn'),
      blacklistChips: byId('blacklist-chips'),
      blacklistEmpty: byId('blacklist-empty'),
      tableHead: byId('table-head'),
      tableBody: byId('table-body'),
      tableScroll: byId('table-scroll'),
      staticLoadSentinel: byId('static-load-sentinel'),
      staticLoadStatus: byId('static-load-status'),
    };

    type AppState = {
      funds: FundRow[];
      selected: Set<string>;
      blacklist: Set<string>;
      activeTab: ActiveTab;
      activeFundTicker: string | null;
      queryByTab: Record<string, string>;
      sortKey: string;
      sortDir: SortDirection;
      sortByTab: Record<ActiveTab, { key: string; dir: SortDirection }>;
      generatedAt: string | null;
      counts: { funds: number; holdings: number; history: number } | null;
    };

    const state: AppState = {
      funds: [],
      selected: new Set(),
      blacklist: new Set(),
      activeTab: 'All',
      activeFundTicker: null,
      queryByTab: {},
      sortKey: 'rank',
      sortDir: 'asc',
      sortByTab: {},
      generatedAt: null,
      counts: null,
    };

    // Lazy per-fund data: meta.json plus accumulated sheet pages (iShares-style).
    type SheetEntry = {
      headers: string[];
      rows: string[][];
      nextPage: number;
      manifest: any;
      loading: boolean;
    };

    const fundMetaCache: Map<string, any> = new Map();
    const sheetState: Map<string, SheetEntry> = new Map();
    let sheetGeneration = 0;

    // Per-ticker serialized holdings loads: rapid checkbox changes and the
    // detail view must never fetch the same page twice or interleave writes
    // into one cache entry (that used to duplicate rows in the Watchlist).
    const holdingsLoadPromises: Map<string, Promise<void>> = new Map();
    const holdingsLoadFailures: Set<string> = new Set();
    const holdingsLoadWaiters: Array<() => void> = [];
    let activeHoldingsLoads = 0;
    const sheetPageRequests: Map<string, Promise<void>> = new Map();
    const sheetLoadFailures: Map<string, string> = new Map();

    // Watchlist aggregation result cache (recomputed only when holdings change).
    let watchlistRevision = 0;
    let cachedWatchlistRevision = -1;
    let cachedWatchlistRows: WatchlistRow[] = [];
    let watchlistVisibleLimit = WATCHLIST_PAGE_SIZE;
    let renderedWatchlistTotal = 0;
    let selectionDataRefreshTimer: any = null;
    const selectionDataChangedTickers: Set<string> = new Set();

    init();

    // =========================================================================
    // 3. Theme & small helpers
    // =========================================================================

    function applyTheme(dark: boolean): void {
      document.documentElement.classList.toggle('dark', dark);
      el.themeToggle.textContent = dark ? '☀️' : '🌙';
    }

    function escapeHtml(value: unknown): string {
      return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
      }[char] || char));
    }

    function numberOrNull(value: unknown): number | null {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value !== 'string' || value.trim() === '' || value.trim() === '-') return null;
      const parsed = Number(value.replace(/[$,%\s,]/g, ''));
      return Number.isFinite(parsed) ? parsed : null;
    }

    function numberCell(value: unknown): string {
      const parsed = numberOrNull(value);
      return parsed === null ? '' : String(parsed);
    }

    function formatPercent(value: unknown): string {
      const parsed = numberOrNull(value);
      return parsed === null ? '—' : `${parsed.toFixed(2)}%`;
    }

    function formatInteger(value: unknown): string {
      const parsed = numberOrNull(value);
      return parsed === null || parsed === 0 ? '—' : parsed.toLocaleString('en-US');
    }

    function formatMoney(value: unknown): string {
      const parsed = numberOrNull(value);
      if (parsed === null) return '—';
      if (Math.abs(parsed) >= 1e12) return `$${(parsed / 1e12).toFixed(2)}T`;
      if (Math.abs(parsed) >= 1e9) return `$${(parsed / 1e9).toFixed(2)}B`;
      if (Math.abs(parsed) >= 1e6) return `$${(parsed / 1e6).toFixed(2)}M`;
      if (Math.abs(parsed) >= 1e3) return `$${(parsed / 1e3).toFixed(2)}K`;
      return `$${parsed.toFixed(2)}`;
    }

    // Two-digit numeric prefix keeps the catalog column's normal ascending sort
    // meaningful; the value is derived once in scripts/update-data.ts
    // (inferDistributionFrequency, from the Yahoo dividend-history feed) — this
    // only recodes the label already published in fund.distributions.frequency.
    function formatDistributionFrequency(value: unknown): string {
      const raw = String(value ?? '').trim();
      const normalized = raw.toLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ');
      if (!normalized || normalized === '-' || normalized === '—') return '00 - —';
      // Keyword matching keeps older feeds readable: the pages ship the row as
      // "Monthly This fund is an ex-Dividend fund" / ", if any Semiannually".
      if (/semi-?annual|semi annual|half-?year/.test(normalized)) return '06 - Semi-annually';
      if (/month/.test(normalized)) return '01 - Monthly';
      if (/quarter/.test(normalized)) return '04 - Quarterly';
      if (/annual|yearly/.test(normalized)) return '12 - Annually';
      if (/\bnone\b/.test(normalized)) return '00 - None';
      if (/\bunknown\b/.test(normalized)) return '00 - Unknown';
      if (/irregular/.test(normalized)) return '99 - Irregular';
      return raw;
    }

    function sanitizeTicker(value: unknown): string {
      return String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    }

    function normalizeSearchText(value: string): string {
      return value.trim().toLowerCase();
    }

    function getHeaderTooltip(header: string): string {
      if (!header) return '';
      if (COLUMN_TOOLTIPS[header]) return COLUMN_TOOLTIPS[header];
      const clean = String(header).trim();
      const keys = Object.keys(COLUMN_TOOLTIPS);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key.toLowerCase() === clean.toLowerCase()) return COLUMN_TOOLTIPS[key];
      }
      return clean;
    }

    async function copyText(text: string): Promise<void> {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall through to the legacy path.
      }
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }

    function downloadText(text: string, fileName: string, mime: string): void {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    function toCsv(rows: string[][]): string {
      return rows
        .map(row => row.map(cell => {
          const value = String(cell ?? '');
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        }).join(','))
        .join('\n');
    }

    function exportFileName(scope: string, extension: string): string {
      const stamp = new Date().toISOString().slice(0, 10);
      return `franklin-${scope.toLowerCase().replace(/\s+/g, '-')}-${stamp}.${extension}`;
    }

    function setStatus(message: string, tone: 'info' | 'success' | 'error'): void {
      console.debug(`[${tone}] ${message}`);
    }

    // =========================================================================
    // 4. Static API loading & paginated sheets (api/franklin/**, iShares-style)
    // =========================================================================

    async function fetchJson(url: string): Promise<any> {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-cache' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    }

    /** Flattens index.json month-end metrics onto the row so sorting works. */
    function normalizeFundRow(fund: IndexFund): FundRow {
      const monthEnd = (fund.returns && fund.returns.monthEnd) || {};
      const metrics = fund.metrics || {};
      const row: any = {
        ...fund,
        ytd: monthEnd.ytd ?? null,
        yr1: metrics.tr1y ?? monthEnd.yr1 ?? null,
        yr3: monthEnd.yr3 ?? null,
        yr5: monthEnd.yr5 ?? null,
        yr10: monthEnd.yr10 ?? null,
        si: metrics.siAnn ?? monthEnd.sinceInception ?? null,
        tr3y: metrics.tr3y ?? null,
        tr5y: metrics.tr5y ?? null,
        tr10y: metrics.tr10y ?? null,
        cagr3y: metrics.cagr3y ?? monthEnd.yr3 ?? null,
        cagr5y: metrics.cagr5y ?? monthEnd.yr5 ?? null,
        cagr10y: metrics.cagr10y ?? monthEnd.yr10 ?? null,
        dividendYield: metrics.dividendYield ?? null,
        secYield: metrics.secYield ?? null, // franklintempleton.com publishes it for most fixed income funds only.
        frequencyCode: formatDistributionFrequency(fund.distributions && fund.distributions.frequency),
        returnAsOf: monthEnd.asOfDate ?? null,
        searchIndex: '',
      };
      row.searchIndex = [
        fund.ticker, fund.name, fund.category, fund.ter, fund.nav, fund.aum,
        fund.exchange, fund.inceptionDate, fund.asOfDate, monthEnd.asOfDate,
        fund.distributions && fund.distributions.frequency, metrics.dividendYieldText, metrics.secYieldText,
        fund.cusip, fund.isin,
      ].map(value => String(value ?? '').toLowerCase()).join(' ');
      return row;
    }

    async function loadCatalog(): Promise<void> {
      setStatus('Loading Franklin ETF data from api/franklin/index.json…', 'info');
      const data = await fetchJson(INDEX_URL);
      state.funds = (data.funds || [])
        .map((fund: IndexFund) => normalizeFundRow(fund))
        .sort((a: FundRow, b: FundRow) => a.ticker.localeCompare(b.ticker));
      state.generatedAt = data.generatedAt || null;
      state.counts = data.counts || null;

      // A restored selection/blacklist must reference known funds only.
      state.blacklist = new Set([...state.blacklist].filter(ticker => state.funds.some(fund => fund.ticker === ticker)));
      state.selected = new Set([...state.selected].filter(ticker => state.funds.some(fund => fund.ticker === ticker) && !state.blacklist.has(ticker)));
      if (!state.activeFundTicker && state.selected.size) state.activeFundTicker = [...state.selected][0] || null;
      if (state.activeFundTicker && !state.selected.has(state.activeFundTicker)) {
        state.activeFundTicker = [...state.selected][0] || null;
      }

      el.searchInput.disabled = false;
      [el.copyBtn, el.exportCsvBtn, el.exportTxtBtn, el.resetBtn].forEach(button => { button.disabled = false; });
      applyRestoredTab();
      render();
      void ensureHoldingsForSelection();
      const activeTicker = state.activeFundTicker;
      if (activeTicker) {
        void loadFundMeta(activeTicker).then(meta => {
          if (meta && state.activeTab === 'detail:holdings') void ensureSheet('holdings', meta.holdings);
        });
      }
    }

    async function loadFundMeta(ticker: string): Promise<any> {
      const cached = fundMetaCache.get(ticker);
      if (cached) return cached;
      const known = state.funds.find(fund => fund.ticker === ticker);
      if (known && !known.holdings && !known.history) return null; // catalog-only fund: no workbook exists
      try {
        const meta = await fetchJson(`./api/franklin/funds/${encodeURIComponent(ticker)}/meta.json`);
        fundMetaCache.set(ticker, meta);
        return meta;
      } catch (error) {
        console.warn(`Failed to load meta.json for ${ticker}:`, error);
        return null;
      }
    }

    function sheetKey(sheet: string): string {
      return `${state.activeFundTicker}:${sheet}`;
    }

    function resetSheetPaging(): void {
      sheetGeneration += 1;
    }

    async function fetchPage(ticker: string, pagePath: string): Promise<{ headers: string[]; rows: string[][] }> {
      const path = String(pagePath).replace(/^\.?\//, '');
      const page = await fetchJson(`./api/franklin/funds/${encodeURIComponent(ticker)}/${path}`);
      const headers: string[] = Array.isArray(page.headers) ? page.headers : [];
      const rows: any[] = Array.isArray(page.rows) ? page.rows : [];
      return { headers, rows: rows.map(row => headers.map(header => String(row[header] ?? ''))) };
    }

    /** Loads the first page of a paginated sheet and prepares lazy appending. */
    async function ensureSheet(sheet: 'holdings' | 'history', manifest: any): Promise<void> {
      const key = sheetKey(sheet);
      if (sheetState.has(key) || !manifest || !Array.isArray(manifest.pages) || !manifest.pages.length) return;
      sheetState.set(key, { headers: [], rows: [], nextPage: 0, manifest, loading: false });
      await loadNextSheetPage(sheet);
    }

    async function acquireHoldingsLoadSlot(): Promise<void> {
      if (activeHoldingsLoads < MAX_CONCURRENT_HOLDINGS_LOADS) {
        activeHoldingsLoads += 1;
        return;
      }
      // releaseHoldingsLoadSlot transfers an occupied slot directly to this
      // waiter, so there is no decrement/increment race between microtasks.
      await new Promise<void>(resolve => holdingsLoadWaiters.push(resolve));
    }

    function releaseHoldingsLoadSlot(): void {
      const next = holdingsLoadWaiters.shift();
      if (next) next();
      else activeHoldingsLoads = Math.max(0, activeHoldingsLoads - 1);
    }

    function holdingsEntryIsComplete(entry: SheetEntry | undefined): boolean {
      return Boolean(entry && entry.manifest && Array.isArray(entry.manifest.pages) && entry.nextPage >= entry.manifest.pages.length);
    }

    /** Loads every holdings page for one selected ETF, exactly once at a time. */
    function ensureAllHoldingsForTicker(ticker: string): Promise<void> {
      const key = `${ticker}:holdings`;
      if (holdingsEntryIsComplete(sheetState.get(key))) return Promise.resolve();
      const pending = holdingsLoadPromises.get(ticker);
      if (pending) return pending;

      const request = (async () => {
        await acquireHoldingsLoadSlot();
        try {
          // A queued all-catalog request can become obsolete while it waits (for
          // example, the user immediately unchecks some ETFs). Do no wasted I/O.
          if (!state.selected.has(ticker)) return;
          holdingsLoadFailures.delete(ticker);
          const meta = await loadFundMeta(ticker);
          if (!state.selected.has(ticker)) return;
          const manifest = meta && meta.holdings;
          if (!manifest || !Array.isArray(manifest.pages) || !manifest.pages.length) {
            const known = state.funds.find(fund => fund.ticker === ticker);
            if (known && known.holdings > 0) holdingsLoadFailures.add(ticker);
            return;
          }

          // If the detail-view loader got here first, let its page finish
          // before taking ownership of this same cache entry.
          const detailPageRequest = sheetPageRequests.get(key);
          if (detailPageRequest) await detailPageRequest;

          let entry = sheetState.get(key);
          if (!entry) {
            entry = { headers: [], rows: [], nextPage: 0, manifest, loading: false };
            sheetState.set(key, entry);
          } else {
            entry.manifest = manifest;
          }
          entry.loading = true;
          while (entry.nextPage < manifest.pages.length && state.selected.has(ticker)) {
            const pageIndex = entry.nextPage;
            const page = await fetchPage(ticker, manifest.pages[pageIndex]);
            if (!entry.headers.length && page.headers.length) entry.headers = page.headers;
            entry.rows = entry.rows.concat(page.rows);
            entry.nextPage = pageIndex + 1;
            sheetLoadFailures.delete(key);
            invalidateWatchlistRows();
            scheduleSelectionDataRefresh(ticker);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          holdingsLoadFailures.add(ticker);
          sheetLoadFailures.set(key, message);
          console.error(`Failed to preload ${ticker} holdings:`, error);
        } finally {
          const entry = sheetState.get(key);
          if (entry) entry.loading = false;
          releaseHoldingsLoadSlot();
        }
      })();

      holdingsLoadPromises.set(ticker, request);
      void request.finally(() => {
        if (holdingsLoadPromises.get(ticker) === request) holdingsLoadPromises.delete(ticker);
        scheduleSelectionDataRefresh(ticker);
        // Close the narrow uncheck/recheck race: a reselect can reuse a promise
        // that was just about to stop because the ticker was momentarily absent.
        if (state.selected.has(ticker) && !holdingsEntryIsComplete(sheetState.get(key)) && !holdingsLoadFailures.has(ticker)) {
          void ensureAllHoldingsForTicker(ticker);
        }
      });
      return request;
    }

    /**
     * Appends one page to a sheet the user is looking at. An in-flight page
     * request for the same sheet is reused instead of duplicated, and a
     * selection preload (which owns every page of the fund's holdings) is
     * awaited rather than raced — both used to double-fetch a page and append
     * its rows twice.
     */
    async function loadNextSheetPage(sheet: 'holdings' | 'history'): Promise<void> {
      const ticker = state.activeFundTicker;
      if (!ticker) return;
      const key = `${ticker}:${sheet}`;

      // Selection preloading owns the holdings entry while it is filling every
      // page for Watchlist aggregation. Reuse that work instead of racing it.
      const fullHoldingsLoad = sheet === 'holdings' ? holdingsLoadPromises.get(ticker) : null;
      if (fullHoldingsLoad) {
        await fullHoldingsLoad;
        return;
      }

      const pending = sheetPageRequests.get(key);
      if (pending) {
        await pending;
        return;
      }
      const entry = sheetState.get(key);
      if (!entry || entry.nextPage >= entry.manifest.pages.length) return;

      const request = (async () => {
        entry.loading = true;
        renderStaticLoadSentinel();
        try {
          const generation = sheetGeneration;
          const pageIndex = entry.nextPage;
          const page = await fetchPage(ticker, entry.manifest.pages[pageIndex]);
          if (generation !== sheetGeneration) return;
          if (!entry.headers.length && page.headers.length) entry.headers = page.headers;
          entry.rows = entry.rows.concat(page.rows);
          entry.nextPage = pageIndex + 1;
          sheetLoadFailures.delete(key);
          if (sheet === 'holdings') {
            invalidateWatchlistRows();
            scheduleSelectionDataRefresh(ticker);
          }
          if (state.activeFundTicker === ticker && state.activeTab === `detail:${sheet}`) render();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sheetLoadFailures.set(key, message);
          console.error(`Failed to load ${ticker} ${sheet} page:`, error);
        } finally {
          entry.loading = false;
          renderStaticLoadSentinel();
        }
      })();
      sheetPageRequests.set(key, request);
      try {
        await request;
      } finally {
        if (sheetPageRequests.get(key) === request) sheetPageRequests.delete(key);
      }
    }

    /**
     * Watchlist aggregation needs every holdings page of every selected ETF
     * (same pipeline as daggerok/iShares). Watchlist holdings are cached under
     * each fund's own key, independent of the active fund. Per-ticker promise
     * deduplication and bounded concurrency avoid duplicate / skipped pages
     * when checkboxes change quickly and avoid a request burst when the whole
     * catalog is selected from the All ETFs pill.
     */
    async function ensureHoldingsForSelection(): Promise<void> {
      const tickers = [...state.selected].filter(ticker => {
        const fund = state.funds.find(candidate => candidate.ticker === ticker);
        return Boolean(fund && fund.holdings > 0);
      });
      await Promise.all(tickers.map(ticker => ensureAllHoldingsForTicker(ticker)));
      scheduleSelectionDataRefresh();
    }

    function activeSheetTab(): 'holdings' | 'history' | null {
      if (state.activeTab === 'detail:holdings') return 'holdings';
      if (state.activeTab === 'detail:history') return 'history';
      return null;
    }

    function maybeLoadMoreRows(): void {
      if (state.activeTab === 'watchlist') {
        if (watchlistVisibleLimit < renderedWatchlistTotal) {
          watchlistVisibleLimit += WATCHLIST_PAGE_SIZE;
          renderWatchlistTable();
          fitTableHeight();
          renderStaticLoadSentinel();
        }
        return;
      }
      const sheet = activeSheetTab();
      if (!sheet) return;
      void loadNextSheetPage(sheet);
    }

    function renderStaticLoadSentinel(): void {
      if (state.activeTab === 'watchlist') {
        const progress = selectedHoldingsLoadState();
        const shown = Math.min(watchlistVisibleLimit, renderedWatchlistTotal);
        const moreRows = shown < renderedWatchlistTotal;
        const show = moreRows || progress.loading;
        el.staticLoadSentinel.classList.toggle('hidden', !show);
        el.staticLoadStatus.textContent = moreRows
          ? `Showing ${shown.toLocaleString('en-US')} of ${renderedWatchlistTotal.toLocaleString('en-US')} holdings — scroll or click to load more…`
          : progress.loading
            ? `Loading holdings… ${progress.completeFunds} of ${progress.sourceFunds} selected ETF files ready.`
            : '';
        return;
      }

      const sheet = activeSheetTab();
      if (!sheet || !state.activeFundTicker) {
        el.staticLoadSentinel.classList.add('hidden');
        return;
      }
      const entry = sheetState.get(sheetKey(sheet));
      if (!entry) {
        el.staticLoadSentinel.classList.add('hidden');
        return;
      }
      const more = entry.nextPage < entry.manifest.pages.length;
      el.staticLoadSentinel.classList.toggle('hidden', !more);
      el.staticLoadStatus.textContent = entry.loading ? 'Loading more rows…' : more ? 'Scroll or click to load more rows…' : '';
    }

    // =========================================================================
    // 5. Navigation tabs & tab switching
    // =========================================================================

    function categoryLabel(category: string): string {
      return category || 'ETF';
    }

    function uniqueCategories(): string[] {
      const categories = [...new Set(state.funds.map(fund => fund.category).filter(Boolean))];
      return categories.sort((a, b) => b.length - a.length || a.localeCompare(b));
    }

    function visibleFunds(): FundRow[] {
      const tab = isEtfCatalogTab(state.activeTab) ? state.activeTab : 'All';
      return state.funds.filter(fund => (tab === 'All' || fund.category === tab) && !state.blacklist.has(fund.ticker));
    }

    function getTabs(): TabInfo[] {
      const tabs: TabInfo[] = [];
      tabs.push({ id: 'All', label: 'All ETFs', count: state.funds.filter(fund => !state.blacklist.has(fund.ticker)).length });
      uniqueCategories().forEach(category => {
        tabs.push({
          id: category,
          label: categoryLabel(category),
          count: state.funds.filter(fund => fund.category === category && !state.blacklist.has(fund.ticker)).length,
        });
      });
      return tabs;
    }

    function getSelectedTabs(): TabInfo[] {
      const tabs: TabInfo[] = [];
      const activeFund = getActiveFund();

      if (activeFund) {
        DETAIL_TABS.forEach(tab => {
          tabs.push({
            id: `detail:${tab.key}`,
            label: tab.key === 'overview' ? `${activeFund.ticker} ${tab.label}` : tab.label,
            count: getDetailCount(tab.key),
          });
        });
      }

      if (state.selected.size > 0) {
        tabs.push({ id: 'watchlist', label: 'Watchlist', count: getDedupedWatchlistRows().length });
      }

      return tabs;
    }

    function getAllTabIds(): ActiveTab[] {
      return [...getTabs(), ...getSelectedTabs()].map(tab => tab.id);
    }

    function getActiveFund(): FundRow | null {
      if (!state.activeFundTicker || !state.selected.has(state.activeFundTicker)) return null;
      return state.funds.find(fund => fund.ticker === state.activeFundTicker) || null;
    }

    function getDetailCount(key: string): number {
      const activeFund = getActiveFund();
      if (!activeFund) return 0;
      if (key === 'holdings') return activeFund.holdings || 0;
      if (key === 'history') return activeFund.history || 0;
      if (key === 'distributions') {
        const meta = fundMetaCache.get(activeFund.ticker);
        return meta && meta.distributions && Array.isArray(meta.distributions.rows) ? meta.distributions.rows.length : 0;
      }
      return 0;
    }

    function ensureValidTab(): void {
      const tabIds = getAllTabIds();
      if (!tabIds.includes(state.activeTab)) {
        state.activeTab = 'All';
        applySortForTab(state.activeTab);
        el.searchInput.value = currentQuery();
        syncSearchInput();
      }
    }

    function applyRestoredTab(): void {
      const tabIds = getAllTabIds();
      if (!tabIds.includes(state.activeTab)) state.activeTab = 'All';
      applySortForTab(state.activeTab);
      el.searchInput.value = currentQuery();
      syncSearchInput();
    }

    function renderTabs(): void {
      renderTabButtons(el.tabsBar, getTabs());
      const selectedTabs = getSelectedTabs();
      el.selectedTabsPanel.classList.toggle('is-visible', selectedTabs.length > 0);
      renderTabButtons(el.selectedTabsBar, selectedTabs);
    }

    function renderTabButtons(container: any, tabs: TabInfo[]): void {
      container.classList.toggle('hidden', tabs.length <= 1);
      // The pill box covers the whole catalog (it sits next to the
      // "All ETFs (N)" count), so its checked state ignores the current tab
      // and search filter.
      const nonBlacklisted = state.funds.filter(fund => !state.blacklist.has(fund.ticker));
      const allSelected = nonBlacklisted.length > 0 && nonBlacklisted.every(fund => state.selected.has(fund.ticker));
      container.innerHTML = tabs.map(tab => {
        const isActive = tab.id === state.activeTab;
        const activeClasses = 'bg-blue-600 text-white font-medium border-blue-500 shadow-sm';
        const inactiveClasses = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700';
        if (tab.id === 'All') {
          return `
            <div class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs transition border whitespace-nowrap ${isActive ? activeClasses : inactiveClasses}">
              <input type="checkbox" id="select-all-toggle" ${allSelected ? 'checked' : ''} class="w-3.5 h-3.5 accent-blue-600 cursor-pointer" title="Select / Deselect all ETFs" />
              <button data-tab="All" class="font-medium hover:underline focus:outline-none">
                ${escapeHtml(tab.label)} (${tab.count})
              </button>
            </div>
          `;
        }
        return `
          <button
            data-tab="${escapeHtml(tab.id)}"
            class="px-3.5 py-1.5 rounded-full text-xs transition border whitespace-nowrap ${isActive ? activeClasses : inactiveClasses}">
            ${escapeHtml(tab.label)} (${tab.count})
          </button>
        `;
      }).join('');

      container.querySelectorAll('button[data-tab]').forEach((button: any) => {
        button.addEventListener('click', () => {
          const previousActiveFund = state.activeFundTicker;
          state.activeTab = button.dataset.tab || 'All';
          applySortForTab(state.activeTab);
          if (state.activeTab === 'watchlist') {
            watchlistVisibleLimit = WATCHLIST_PAGE_SIZE;
            void ensureHoldingsForSelection();
          }
          if (previousActiveFund !== state.activeFundTicker) resetSheetPaging();
          el.searchInput.value = currentQuery();
          syncSearchInput();
          render();
          maybeLoadMoreRows();
        });
      });

      const selectAllToggle = container.querySelector('#select-all-toggle');
      if (selectAllToggle) {
        selectAllToggle.addEventListener('change', (event: any) => {
          event.stopPropagation();
          // 'catalog': the pill keeps whole-catalog semantics — it selects or
          // deselects every non-blacklisted ETF, regardless of tab or filter.
          toggleSelectAll(Boolean(event.target.checked), 'catalog');
        });
        selectAllToggle.addEventListener('click', (event: any) => event.stopPropagation());
      }
    }

    /**
     * Restores the sort the user last chose on this tab (recorded on every
     * column-header click, persisted in localStorage) or falls back to the tab
     * default when the tab was never explicitly sorted.
     */
    function applySortForTab(tab: ActiveTab): void {
      const remembered = state.sortByTab[tab];
      if (remembered) {
        state.sortKey = remembered.key;
        state.sortDir = remembered.dir;
        return;
      }
      applyDefaultSortForTab(tab);
    }

    /** Records the current sort as this tab's remembered sort. */
    function rememberSortForCurrentTab(): void {
      state.sortByTab[state.activeTab] = { key: state.sortKey, dir: state.sortDir };
      persistTabSorts();
    }

    function applyDefaultSortForTab(tab: ActiveTab): void {
      if (tab === 'watchlist') {
        state.sortKey = 'weightSum';
        state.sortDir = 'desc';
      } else if (tab === 'detail:overview') {
        state.sortKey = 'section';
        state.sortDir = 'asc';
      } else {
        // Holdings, History and Distributions arrive already ordered by the
        // source workbook (weight / date); keep the source order by default.
        state.sortKey = 'rank';
        state.sortDir = 'asc';
      }
    }

    function tabLabel(tab: ActiveTab): string {
      const match = /^detail:(.+)$/.exec(tab);
      if (match) {
        const found = DETAIL_TABS.find(item => item.key === match[1]);
        return found ? found.label : tab;
      }
      return tab === 'watchlist' ? 'Watchlist' : categoryLabel(tab);
    }

    function isEtfCatalogTab(tab: ActiveTab): boolean {
      return tab === 'All' || uniqueCategories().includes(tab);
    }

    function isDetailTab(tab: ActiveTab): boolean {
      return /^detail:(overview|holdings|history|distributions)$/.test(tab);
    }

    function detailTabKey(tab: ActiveTab): string {
      const match = /^detail:(.+)$/.exec(tab);
      return match ? match[1] : 'overview';
    }

    // =========================================================================
    // 6. Table rendering, sorting & tooltips
    // =========================================================================

    function render(): void {
      ensureValidTab();
      renderTabs();
      renderBlacklistPanel();
      animateTableUpdate();
      if (state.activeTab === 'watchlist') renderWatchlistTable();
      else if (isDetailTab(state.activeTab)) renderDetailTable(detailTabKey(state.activeTab));
      else renderFundsTable();
      fitTableHeight();
      renderStaticLoadSentinel();
    }

    function animateTableUpdate(): void {
      el.tableBody.classList.remove('table-content-enter');
      void el.tableBody.offsetWidth; // reflow to restart the animation
      el.tableBody.classList.add('table-content-enter');
    }

    function currentQuery(): string {
      return state.queryByTab[state.activeTab] || '';
    }

    function setCurrentQuery(value: string): void {
      if (value) state.queryByTab[state.activeTab] = value;
      else delete state.queryByTab[state.activeTab];
      persistSearches();
    }

    function updateSearchClearBtn(): void {
      if (!el.searchClearBtn) return;
      el.searchClearBtn.classList.toggle('hidden', !el.searchInput.value);
    }

    function syncSearchInput(): void {
      const query = currentQuery();
      if (document.activeElement !== el.searchInput && el.searchInput.value !== query) {
        el.searchInput.value = query;
      }
      el.searchInput.placeholder = isEtfCatalogTab(state.activeTab)
        ? 'Search ETFs, fund names, holdings, tickers, CUSIPs/ISINs, SEDOLs...'
        : `Search ${tabLabel(state.activeTab)}...`;
      updateSearchClearBtn();
    }

    function clearActiveSearchFilter(): void {
      el.searchInput.value = '';
      delete state.queryByTab[state.activeTab];
      persistSearches();
      updateSearchClearBtn();
      el.searchInput.focus?.();
      if (state.activeTab === 'watchlist') watchlistVisibleLimit = WATCHLIST_PAGE_SIZE;
      render();
    }

    function filterRows(rows: any[]): any[] {
      const query = normalizeSearchText(currentQuery());
      if (!query) return rows;
      return rows.filter(row => String(row.searchIndex || '').includes(query));
    }

    function sortValue(row: Record<string, unknown>, key: string): unknown {
      return row[key];
    }

    function compareValues(a: unknown, b: unknown): number {
      const an = numberOrNull(a);
      const bn = numberOrNull(b);
      if (an !== null && bn !== null) return an - bn;
      const as = String(a ?? '');
      const bs = String(b ?? '');
      // History dates ("Aug 21 2026") sort chronologically.
      if (/^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(as) || /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(bs)) {
        const ad = Date.parse(as.replace(/-/g, ' '));
        const bd = Date.parse(bs.replace(/-/g, ' '));
        if (!Number.isNaN(ad) && !Number.isNaN(bd)) return ad - bd;
      }
      return as.localeCompare(bs, undefined, { numeric: true });
    }

    function sortRows(rows: any[]): any[] {
      if (state.sortKey === 'rank') return rows;
      const direction = state.sortDir === 'asc' ? 1 : -1;
      const key = state.sortKey;
      return [...rows].sort((a, b) => compareValues(sortValue(a, key), sortValue(b, key)) * direction);
    }

    // `extraClass` lets the catalog pin its own Ticker column without
    // special-casing the column name here: the Watchlist table and every
    // detail sheet share this builder and must keep getting a plain <th>.
    function sortHeader(label: string, key: string, numeric = false, extraClass = ''): string {
      const active = state.sortKey === key;
      const arrow = active ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
      const align = numeric ? ' text-right' : '';
      const tooltip = getHeaderTooltip(label);
      const classAttr = `py-3.5 px-4${align}${extraClass ? ` ${extraClass}` : ''}`;
      return `<th class="${classAttr}" title="${escapeHtml(tooltip)}"><button data-sort="${escapeHtml(key)}" title="${escapeHtml(tooltip)}" class="uppercase tracking-wider hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:text-blue-600 dark:focus:text-blue-400">${escapeHtml(label)}${arrow}</button></th>`;
    }

    function indexHeader(): string {
      return `<th class="py-3.5 px-4 w-12 text-center" title="${escapeHtml(getHeaderTooltip('#'))}">#</th>`;
    }

    function useHeader(): string {
      // The checked state tracks exactly the rows the table currently renders
      // (current tab + active search filter), the same set select-all toggles.
      const candidates = filterRows(visibleFunds());
      const allSelected = candidates.length > 0 && candidates.every(fund => state.selected.has(fund.ticker));
      return `<th class="catalog-sticky-col catalog-sticky-use py-3.5 px-4 w-20 text-center" title="${escapeHtml(getHeaderTooltip('Use'))}">
        <div class="inline-flex items-center justify-center gap-1">
          <input type="checkbox" id="select-all-checkbox" ${allSelected ? 'checked' : ''} class="w-4 h-4 accent-blue-600 cursor-pointer" title="Select / Deselect all ETFs" />
          <span>Use</span>
        </div>
      </th>`;
    }

    function bindSortHeaders(): void {
      el.tableHead.querySelectorAll('button[data-sort]').forEach((button: any) => {
        button.addEventListener('click', () => {
          const key = button.dataset.sort || 'rank';
          if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          else {
            state.sortKey = key;
            state.sortDir = ['ticker', 'name', 'category', 'symbol', 'section', 'metric', 'identifier', 'label'].includes(key) ? 'asc' : 'desc';
          }
          rememberSortForCurrentTab();
          if (state.activeTab === 'watchlist') watchlistVisibleLimit = WATCHLIST_PAGE_SIZE;
          render();
          renderStaticLoadSentinel();
        });
      });
    }

    function bindSelectAllCheckbox(): void {
      const checkbox = el.tableHead.querySelector('#select-all-checkbox');
      if (!checkbox) return;
      checkbox.addEventListener('change', (event: any) => {
        event.stopPropagation();
        // 'visible': the header box manages only the rows currently rendered
        // (current tab + active search filter), never the hidden ones.
        toggleSelectAll(Boolean(event.target.checked), 'visible');
      });
      checkbox.addEventListener('click', (event: any) => event.stopPropagation());
    }

    function renderFundsTable(): void {
      const rows = sortRows(filterRows(visibleFunds()));
      el.tableHead.innerHTML = `
        <tr>
          ${indexHeader()}
          ${useHeader()}
          ${sortHeader('Ticker', 'ticker', false, 'catalog-sticky-col catalog-sticky-ticker w-24')}
          ${sortHeader('Fund Name', 'name')}
          ${sortHeader('Type', 'category')}
          ${sortHeader('NAV', 'navValue', true)}
          ${sortHeader('Net Assets', 'aumValue', true)}
          ${sortHeader('Expense', 'terValue', true)}
          ${sortHeader('Dividend Yield', 'dividendYield', true)}
          ${sortHeader('SEC Yield', 'secYield', true)}
          ${sortHeader('Frequency', 'frequencyCode')}
          ${sortHeader('YTD Return', 'ytd', true)}
          ${sortHeader('TR 1Y', 'yr1', true)}
          ${sortHeader('TR 3Y', 'tr3y', true)}
          ${sortHeader('TR 5Y', 'tr5y', true)}
          ${sortHeader('TR 10Y', 'tr10y', true)}
          ${sortHeader('CAGR 3Y', 'cagr3y', true)}
          ${sortHeader('CAGR 5Y', 'cagr5y', true)}
          ${sortHeader('CAGR 10Y', 'cagr10y', true)}
          ${sortHeader('SI Ann.', 'si', true)}
          ${sortHeader('Return As Of', 'returnAsOf')}
          ${sortHeader('Inception', 'inceptionDate')}
          ${sortHeader('Holdings', 'holdings', true)}
          ${sortHeader('History', 'history', true)}
          ${sortHeader('As Of', 'asOfDate')}
        </tr>
      `;
      bindSortHeaders();
      bindSelectAllCheckbox();

      if (!rows.length) {
        el.tableBody.innerHTML = `<tr><td colspan="25" class="py-12 text-center text-slate-400 dark:text-slate-500">No ETFs match your search.</td></tr>`;
      } else {
        el.tableBody.innerHTML = rows.map((fund, index) => {
          const selected = state.selected.has(fund.ticker);
          return `
            <tr data-ticker="${escapeHtml(fund.ticker)}" class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition border-b border-slate-100 dark:border-slate-700/30 ${selected ? 'selected-row' : ''}">
              <td class="py-2.5 px-4 text-slate-400 dark:text-slate-500 text-xs text-center font-mono">${index + 1}</td>
              <td class="catalog-sticky-col catalog-sticky-use py-2.5 px-4 text-center">
                <div class="inline-flex items-center justify-center gap-1.5">
                  <input data-checkbox="${escapeHtml(fund.ticker)}" type="checkbox" ${selected ? 'checked' : ''} class="w-4 h-4 accent-blue-600 cursor-pointer" aria-label="Use ${escapeHtml(fund.ticker)}" />
                  <button data-blacklist="${escapeHtml(fund.ticker)}" class="w-4 h-4 rounded text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 leading-none transition" title="Blacklist ${escapeHtml(fund.ticker)} — hide it from All ETFs">✕</button>
                </div>
              </td>
              <td class="catalog-sticky-col catalog-sticky-ticker py-2.5 px-4 font-mono font-semibold text-blue-600 dark:text-blue-400">${escapeHtml(fund.ticker)}</td>
              <td class="py-2.5 px-4 text-slate-700 dark:text-slate-300 font-medium" title="${escapeHtml(fund.name)}">${escapeHtml(fund.name)}</td>
              <td class="py-2.5 px-4 text-slate-600 dark:text-slate-300">${escapeHtml(categoryLabel(fund.category))}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${escapeHtml(fund.nav || '—')}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatMoney(fund.aumValue)}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${escapeHtml(fund.ter || '—')}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.dividendYield)}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.secYield)}</td>
              <td class="py-2.5 px-4 text-slate-600 dark:text-slate-300 font-mono">${escapeHtml(fund.frequencyCode || '00 - —')}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.ytd)}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.yr1)}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.tr3y)}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.tr5y)}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.tr10y)}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.cagr3y)}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.cagr5y)}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.cagr10y)}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatPercent(fund.si)}</td>
              <td class="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400">${escapeHtml(fund.returnAsOf || '—')}</td>
              <td class="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400">${escapeHtml(fund.inceptionDate || '—')}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatInteger(fund.holdings)}</td>
              <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${formatInteger(fund.history)}</td>
              <td class="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400">${escapeHtml(fund.asOfDate || '—')}</td>
            </tr>
          `;
        }).join('');
      }

      el.tableBody.querySelectorAll('input[data-checkbox]').forEach((checkbox: any) => {
        checkbox.addEventListener('change', (event: any) => {
          event.stopPropagation();
          const ticker = (checkbox as any).dataset.checkbox || '';
          toggleFund(ticker);
        });
        checkbox.addEventListener('click', (event: any) => event.stopPropagation());
      });

      el.tableBody.querySelectorAll('button[data-blacklist]').forEach((button: any) => {
        button.addEventListener('click', (event: any) => {
          event.stopPropagation();
          blacklistTickers([button.dataset.blacklist || '']);
        });
      });

      const selected = state.selected.size;
      const queryText = currentQuery() ? ` matching “${currentQuery()}”` : '';
      const activeText = state.activeFundTicker ? ` Active ETF detail tabs are for ${state.activeFundTicker}.` : '';
      setStatus(`Showing ${rows.length} ETF${rows.length === 1 ? '' : 's'}${queryText}. Use the checkboxes in the “Use” column to select ETFs.${selected ? ` ${selected} selected.` : ' No ETFs selected yet.'}${activeText}`, selected ? 'success' : 'info');
      el.tickerCount.textContent = `${rows.length} ETFs`;
      renderSubtitle();
    }

    // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

    type HoldingPosition = {
      fund: string;
      symbol: string;
      key: string;
      name: string;
      weight: number;
      cusip: string;
      isin: string;
      identifier: string;
      sedol: string;
    };

    function normalizeHoldingHeader(value: string): string {
      return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    // Provider exports spell "no value" in several ways; a placeholder must
    // never become a security identifier.
    const MISSING_HOLDING_VALUES = new Set(['', '-', '--', '—', '–', 'n/a', 'na', 'none', 'null', '0']);
    const IDENTIFIER_PLACEHOLDER = /^(n\/?a|none|null|-+|—+|\.+)$/i;

    function usableHoldingValue(value: unknown): string {
      const clean = String(value ?? '').trim();
      return !clean || MISSING_HOLDING_VALUES.has(clean.toLowerCase()) ? '' : clean;
    }

    /**
     * Bond, cash, loan and futures rows carry no exchange ticker ("-"), so the
     * Watchlist falls back to a stable security identifier. The same
     * ticker -> CUSIP -> ISIN -> Identifier -> SEDOL/FIGI -> name order is
     * used by the sibling applications, which keeps one security from
     * appearing once per identifier flavour.
     */
    function sheetPositions(ticker: string): HoldingPosition[] {
      const entry = sheetState.get(`${ticker}:holdings`);
      if (!entry || !entry.headers.length) return [];
      const headerIndexes: Map<string, number> = new Map();
      entry.headers.forEach((header, index) => headerIndexes.set(normalizeHoldingHeader(header), index));
      const value = (row: string[], aliases: string[]): string => {
        for (let i = 0; i < aliases.length; i++) {
          const index = headerIndexes.get(normalizeHoldingHeader(aliases[i]));
          if (index === undefined) continue;
          const found = usableHoldingValue(row[index]);
          if (found) return found;
        }
        return '';
      };

      const positions: HoldingPosition[] = [];
      entry.rows.forEach(row => {
        const publishedTicker = value(row, ['Ticker', 'Symbol', 'Security Ticker', 'Holding Ticker']);
        const cusip = value(row, ['CUSIP']);
        const isin = value(row, ['ISIN']);
        let identifier = value(row, ['Identifier', 'Security ID', 'securityId', 'Security Identifier']);
        const sedol = value(row, ['SEDOL', 'FIGI']);
        const name = value(row, ['Name', 'Holding Name', 'holdingName', 'Security Long Description', 'securityLongDescription', 'Security Description']);
        // Franklin publishes one Identifier column that holds a CUSIP, an ISIN
        // or a provider code, so it is classified by shape into its own slot
        // instead of masking the specific identifiers.
        let detectedCusip = cusip;
        let detectedIsin = isin;
        let detectedSedol = sedol;
        if (identifier && !IDENTIFIER_PLACEHOLDER.test(identifier)) {
          const compact = identifier.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(compact)) detectedIsin = detectedIsin || identifier;
          else if (/^[A-Z0-9]{9}$/.test(compact)) detectedCusip = detectedCusip || identifier;
          else if (/^[A-Z0-9]{7}$/.test(compact)) detectedSedol = detectedSedol || identifier;
        } else {
          identifier = '';
        }
        let key = '';
        let shown = '';
        if (publishedTicker) { key = `T:${publishedTicker.toUpperCase()}`; shown = publishedTicker; }
        else if (detectedCusip) { key = `C:${detectedCusip.toUpperCase()}`; shown = detectedCusip; }
        else if (detectedIsin) { key = `I:${detectedIsin.toUpperCase()}`; shown = detectedIsin; }
        else if (identifier) { key = `D:${identifier.toUpperCase()}`; shown = identifier; }
        else if (detectedSedol) { key = `S:${detectedSedol.toUpperCase()}`; shown = detectedSedol; }
        else if (name) { key = `N:${name.toUpperCase()}`; shown = name; }
        else return;
        const weight = numberOrNull(value(row, ['Weight', 'Weight (%)', 'PercentageOfFund']));
        positions.push({
          fund: ticker,
          symbol: shown,
          key,
          name,
          weight: weight === null ? 0 : weight,
          cusip: detectedCusip || identifier,
          isin: detectedIsin,
          identifier: identifier || detectedCusip || detectedIsin || detectedSedol,
          sedol: detectedSedol,
        });
      });
      return positions.filter(position => usableHoldingValue(position.symbol) !== '');
    }

    function getSelectedPositions(): HoldingPosition[] {
      return [...state.selected].flatMap(ticker => sheetPositions(ticker));
    }

    function invalidateWatchlistRows(): void {
      watchlistRevision += 1;
    }

    /**
     * Aggregates every selected fund's holdings into one deduplicated row per
     * security. The aggregation walks every position of every selected fund
     * (the whole catalog is ~56k rows), so the result is cached until the
     * holdings caches or the selection change.
     */
    function getDedupedWatchlistRows(): WatchlistRow[] {
      if (cachedWatchlistRevision === watchlistRevision) return cachedWatchlistRows;
      const map: Map<string, WatchlistRow> = new Map();
      getSelectedPositions().forEach(position => {
        const symbol = position.symbol;
        const dedupeKey = position.key || `T:${String(symbol).toUpperCase()}`;
        if (!map.has(dedupeKey)) {
          map.set(dedupeKey, {
            symbol,
            name: position.name,
            funds: [],
            fundCount: 0,
            weightSum: 0,
            maxWeight: 0,
            cusips: [],
            identifier: '',
            searchIndex: '',
          });
        }
        const row = map.get(dedupeKey);
        if (!row) return;
        if (!row.funds.includes(position.fund)) row.funds.push(position.fund);
        row.weightSum += position.weight;
        row.maxWeight = Math.max(row.maxWeight, position.weight);
        if (position.cusip && !row.cusips.includes(position.cusip)) row.cusips.push(position.cusip);
        if (position.name) row.name = position.name;
      });
      map.forEach(row => {
        row.fundCount = row.funds.length;
        row.funds.sort();
        row.cusips.sort();
        row.identifier = row.cusips[0] || '';
        row.searchIndex = [row.symbol, row.name, row.cusips.join(' '), row.funds.join(' ')].join(' ').toLowerCase();
      });
      cachedWatchlistRows = [...map.values()];
      cachedWatchlistRevision = watchlistRevision;
      return cachedWatchlistRows;
    }

    function getVisibleWatchlistRows(): WatchlistRow[] {
      return sortRows(filterRows(getDedupedWatchlistRows()));
    }

    /**
     * How many of the selected funds still have holdings pages in flight —
     * drives the Watchlist "still loading" copy and the table's empty state.
     */
    function selectedHoldingsLoadState(): { sourceFunds: number; completeFunds: number; failedFunds: number; loading: boolean } {
      const sourceTickers = [...state.selected].filter(ticker => {
        const fund = state.funds.find(candidate => candidate.ticker === ticker);
        return Boolean(fund && fund.holdings > 0);
      });
      const completeFunds = sourceTickers.filter(ticker => holdingsEntryIsComplete(sheetState.get(`${ticker}:holdings`))).length;
      const failedFunds = sourceTickers.filter(ticker => holdingsLoadFailures.has(ticker)).length;
      return {
        sourceFunds: sourceTickers.length,
        completeFunds,
        failedFunds,
        loading: completeFunds + failedFunds < sourceTickers.length,
      };
    }

    /**
     * Coalesces the renders that follow background holdings loads: several
     * funds (or several pages) usually finish within the same tick, and only
     * the Watchlist / the affected detail sheet actually needs the repaint.
     */
    function scheduleSelectionDataRefresh(ticker = ''): void {
      if (ticker) selectionDataChangedTickers.add(ticker);
      if (selectionDataRefreshTimer !== null) return;
      selectionDataRefreshTimer = setTimeout(() => {
        selectionDataRefreshTimer = null;
        const activeFundChanged = Boolean(state.activeFundTicker && selectionDataChangedTickers.has(state.activeFundTicker));
        selectionDataChangedTickers.clear();
        ensureValidTab();
        if (state.activeTab === 'watchlist' || (isDetailTab(state.activeTab) && activeFundChanged)) {
          render();
        } else {
          // Keep the current table/scroll position stable while only selected-tab
          // counts (especially Watchlist) change in the background.
          renderTabs();
          fitTableHeight();
        }
      }, 75);
    }

    function renderWatchlistTable(): void {
      const allRows = getVisibleWatchlistRows();
      const rows = allRows.slice(0, watchlistVisibleLimit);
      const progress = selectedHoldingsLoadState();
      renderedWatchlistTotal = allRows.length;
      el.tableHead.innerHTML = `
        <tr>
          ${indexHeader()}
          ${sortHeader('Ticker', 'symbol', false, 'watchlist-sticky-col watchlist-sticky-ticker')}
          ${sortHeader('Name', 'name')}
          ${sortHeader('ETFs', 'funds')}
          ${sortHeader('# ETFs', 'fundCount', true)}
          ${sortHeader('Weight Sum', 'weightSum', true)}
          ${sortHeader('Max Weight', 'maxWeight', true)}
          ${sortHeader('Identifier', 'identifier')}
        </tr>
      `;
      bindSortHeaders();

      let emptyMessage = '';
      if (!state.selected.size) {
        emptyMessage = 'Select ETFs in All ETFs to build the aggregated Watchlist.';
      } else if (!allRows.length && currentQuery() && getDedupedWatchlistRows().length > 0) {
        emptyMessage = 'No Watchlist holdings match your search.';
      } else if (!allRows.length && progress.loading) {
        emptyMessage = `Loading holdings… ${progress.completeFunds} of ${progress.sourceFunds} selected ETF files ready.`;
      } else if (!allRows.length) {
        emptyMessage = progress.failedFunds > 0
          ? 'Holdings data could not be loaded for one or more selected ETFs. Refresh the page or run the data refresh workflow.'
          : 'Holdings data is not available yet for the selected ETFs. Run the data refresh workflow to publish holdings pages.';
      }

      if (emptyMessage) {
        el.tableBody.innerHTML = `<tr><td colspan="8" class="py-12 text-center text-slate-400 dark:text-slate-500">${escapeHtml(emptyMessage)}</td></tr>`;
      } else {
        el.tableBody.innerHTML = rows.map((row, index) => `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition border-b border-slate-100 dark:border-slate-700/30">
            <td class="py-2.5 px-4 text-slate-400 dark:text-slate-500 text-xs text-center font-mono">${index + 1}</td>
            <td class="watchlist-sticky-col watchlist-sticky-ticker py-2.5 px-4 font-mono font-semibold text-blue-600 dark:text-blue-400" title="${escapeHtml(row.symbol)}">${escapeHtml(row.symbol)}</td>
            <td class="py-2.5 px-4 text-slate-700 dark:text-slate-300 font-medium" title="${escapeHtml(row.name)}">${escapeHtml(row.name || '—')}</td>
            <td class="py-2.5 px-4 text-slate-700 dark:text-slate-300">
              <div class="flex flex-wrap gap-1 max-w-md">
                ${row.funds.map((ticker: string) => `<span class="font-mono text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800 rounded-full px-2 py-0.5">${escapeHtml(ticker)}</span>`).join('')}
              </div>
            </td>
            <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${row.fundCount}</td>
            <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${row.weightSum.toFixed(3)}%</td>
            <td class="py-2.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300">${row.maxWeight.toFixed(3)}%</td>
            <td class="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400 text-xs">${escapeHtml(row.identifier || '—')}</td>
          </tr>
        `).join('');
      }

      const queryText = currentQuery() ? ` matching “${currentQuery()}”` : '';
      const loadingText = progress.loading ? ` Holdings are still loading (${progress.completeFunds}/${progress.sourceFunds} ETF files).` : '';
      setStatus(`Watchlist built from ${state.selected.size} selected ETF${state.selected.size === 1 ? '' : 's'}: ${allRows.length} deduplicated holding${allRows.length === 1 ? '' : 's'}${queryText}.${loadingText} Deduplicated by ticker, or by identifier for bond rows.`, progress.loading ? 'info' : 'success');
      el.tickerCount.textContent = `${allRows.length.toLocaleString('en-US')}${progress.loading ? '+' : ''} tickers`;
      renderSubtitle(`Watchlist from ${state.selected.size} selected ETF${state.selected.size === 1 ? '' : 's'} · showing ${rows.length.toLocaleString('en-US')} of ${allRows.length.toLocaleString('en-US')} deduplicated holdings${progress.loading ? ' while remaining files load' : ''}.`);
    }

    // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

    function renderDetailTable(key: string): void {
      const activeFund = getActiveFund();
      if (!activeFund) {
        renderEmptyDetail('Select an ETF row to see ETF details.');
        return;
      }

      if (key === 'overview') return renderOverviewTable(activeFund);
      if (key === 'distributions') return renderDistributionsTable(activeFund);
      return renderSheetTable(activeFund, key === 'history' ? 'history' : 'holdings');
    }

    function renderEmptyDetail(message: string): void {
      el.tableHead.innerHTML = `<tr>${indexHeader()}<th class="py-3.5 px-4">Details</th></tr>`;
      el.tableBody.innerHTML = `<tr><td colspan="2" class="py-12 text-center text-slate-400 dark:text-slate-500">${escapeHtml(message)}</td></tr>`;
      el.tickerCount.textContent = activeDetailTickerText();
    }

    function activeDetailTickerText(): string {
      return state.activeFundTicker ? `${state.activeFundTicker}` : '0 ETFs';
    }

    function renderSheetTable(fund: FundRow, sheet: 'holdings' | 'history'): void {
      const catalogCount = sheet === 'holdings' ? fund.holdings : fund.history;
      const entry = sheetState.get(sheetKey(sheet));

      if (!catalogCount) {
        el.tableHead.innerHTML = `<tr>${indexHeader()}<th class="py-3.5 px-4">${escapeHtml(fund.ticker)}</th></tr>`;
        el.tableBody.innerHTML = `<tr><td colspan="2" class="py-12 text-center text-slate-400 dark:text-slate-500">${escapeHtml(fund.ticker)} publishes no ${sheet === 'holdings' ? 'holdings workbook' : 'NAV history workbook'} (catalog-only fund, e.g. a commodity trust).</td></tr>`;
        el.tickerCount.textContent = fund.ticker;
        renderSubtitle(`${fund.ticker} is catalog-only: no N-PORT ${sheet} file exists for it (crypto funds file no N-PORT).`);
        return;
      }

      if (!entry) {
        el.tableHead.innerHTML = `<tr>${indexHeader()}<th class="py-3.5 px-4">Loading…</th></tr>`;
        el.tableBody.innerHTML = `<tr><td colspan="2" class="py-12 text-center text-slate-400 dark:text-slate-500">Loading ${escapeHtml(fund.ticker)} ${sheet}…</td></tr>`;
        el.tickerCount.textContent = fund.ticker;
        void loadFundMeta(fund.ticker).then(meta => {
          if (!meta) {
            el.tableBody.innerHTML = `<tr><td colspan="2" class="py-12 text-center text-rose-500">Unable to load meta.json for ${escapeHtml(fund.ticker)}</td></tr>`;
            return;
          }
          void ensureSheet(sheet, sheet === 'holdings' ? meta.holdings : meta.history).then(() => render());
        });
        return;
      }

      const headers = entry.headers;
      const rows = sortRows(filterRows(entry.rows.map((row, sourceIndex) => {
        const cells: Record<string, unknown> = { values: row, searchIndex: row.join(' ').toLowerCase() };
        headers.forEach((header, index) => { cells[`col${index}`] = row[index] ?? ''; });
        cells.rank = sourceIndex;
        return cells;
      })));

      el.tableHead.innerHTML = `
        <tr>
          ${indexHeader()}
          ${headers.map((header, index) => sortHeader(header || `Col ${index + 1}`, `col${index}`, NUMERIC_SHEET_HEADERS.includes(header))).join('')}
        </tr>
      `;
      bindSortHeaders();

      if (!rows.length) {
        // An em dash / empty table must not imply "still loading" when a page
        // request actually failed (see the UI contract's data states).
        const failure = sheetLoadFailures.get(sheetKey(sheet));
        const message = failure
          ? `Could not load ${fund.ticker} ${sheet} pages: ${failure}`
          : `No rows match your search${entry.loading ? ' (still loading…)' : ''}.`;
        el.tableBody.innerHTML = `<tr><td colspan="${headers.length + 1}" class="py-12 text-center ${failure ? 'text-rose-500 dark:text-rose-300' : 'text-slate-400 dark:text-slate-500'}">${escapeHtml(message)}</td></tr>`;
      } else {
        el.tableBody.innerHTML = rows.map((row, index) => {
          const values: string[] = row.values || [];
          return `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition border-b border-slate-100 dark:border-slate-700/30">
            <td class="py-2.5 px-4 text-slate-400 dark:text-slate-500 text-xs text-center font-mono">${index + 1}</td>
            ${values.map((cell, columnIndex) => `
              <td class="py-2.5 px-4 ${NUMERIC_SHEET_HEADERS.includes(headers[columnIndex]) ? 'text-right font-mono text-slate-700 dark:text-slate-300' : 'text-slate-700 dark:text-slate-300'}">${escapeHtml(cell === '' ? '—' : cell)}</td>
            `).join('')}
          </tr>
        `;}).join('');
      }

      el.tickerCount.textContent = fund.ticker;
      renderSubtitle(`${fund.ticker} ${sheet === 'holdings' ? 'Holdings' : 'NAV History'} — ${entry.rows.length.toLocaleString('en-US')} of ${(entry.manifest.totalRows || 0).toLocaleString('en-US')} rows loaded${entry.manifest.asOfDate ? ` (as of ${entry.manifest.asOfDate})` : ''}.`);
    }

    function renderOverviewTable(fund: FundRow): void {
      const meta = fundMetaCache.get(fund.ticker);
      const monthEnd = (fund.returns && fund.returns.monthEnd) || {};
      const quarterEnd = (fund.returns && fund.returns.quarterEnd) || {};
      const overview: Array<{ section: string; metric: string; value: unknown }> = [
        { section: 'Fund', metric: 'Ticker', value: fund.ticker },
        { section: 'Fund', metric: 'Fund Name', value: fund.name },
        { section: 'Fund', metric: 'Asset Class', value: categoryLabel(fund.category) },
        { section: 'Fund', metric: 'Inception', value: fund.inceptionDate },
        { section: 'Fund', metric: 'Exchange', value: fund.exchange },
        { section: 'Fund', metric: 'Fund Page', value: fund.fundPage },
        { section: 'Fund', metric: 'CUSIP', value: meta && meta.identifiers ? meta.identifiers.cusip : null },
        { section: 'Fund', metric: 'ISIN', value: meta && meta.identifiers ? meta.identifiers.isin : null },
        { section: 'Fund', metric: 'Benchmark Index', value: meta && meta.identifiers ? meta.identifiers.indexTicker : null },
        { section: 'Fund', metric: 'Holdings Source', value: meta && meta.source ? meta.source.holdingsSource : null },
        { section: 'Fund', metric: 'History Source', value: meta && meta.source ? meta.source.historySource : null },
        { section: 'Fund', metric: 'Provider', value: meta && meta.source ? meta.source.provider : null },
        { section: 'Cost', metric: 'TER (Gross Expense Ratio)', value: fund.ter },
        { section: 'Price', metric: 'NAV', value: fund.nav },
        { section: 'Price', metric: 'Close Price', value: fund.closePrice },
        { section: 'Price', metric: 'Premium / Discount', value: fund.premiumDiscount },
        { section: 'Price', metric: 'As Of', value: fund.asOfDate },
        { section: 'Assets', metric: 'Net Assets', value: formatMoney(fund.aumValue) },
        { section: 'Assets', metric: 'Net Assets (published)', value: fund.aum },
        { section: 'Returns', metric: 'Month-End As Of', value: monthEnd.asOfDate },
        { section: 'Returns', metric: 'YTD (ME)', value: formatPercent(monthEnd.ytd) },
        { section: 'Returns', metric: '1Y (ME)', value: formatPercent(monthEnd.yr1) },
        { section: 'Returns', metric: '3Y CAGR (ME)', value: formatPercent(monthEnd.yr3) },
        { section: 'Returns', metric: '5Y CAGR (ME)', value: formatPercent(monthEnd.yr5) },
        { section: 'Returns', metric: '10Y CAGR (ME)', value: formatPercent(monthEnd.yr10) },
        { section: 'Returns', metric: 'SI Ann. (ME)', value: formatPercent(monthEnd.sinceInception) },
        { section: 'Returns', metric: 'Quarter-End As Of', value: quarterEnd.asOfDate },
        { section: 'Returns', metric: 'YTD (QE)', value: formatPercent(quarterEnd.ytd) },
        { section: 'Returns', metric: '1Y (QE)', value: formatPercent(quarterEnd.yr1) },
        { section: 'Returns', metric: '3Y CAGR (QE)', value: formatPercent(quarterEnd.yr3) },
        { section: 'Returns', metric: '5Y CAGR (QE)', value: formatPercent(quarterEnd.yr5) },
        { section: 'Returns', metric: '10Y CAGR (QE)', value: formatPercent(quarterEnd.yr10) },
        { section: 'Returns', metric: 'SI Ann. (QE)', value: formatPercent(quarterEnd.sinceInception) },
        { section: 'Distributions', metric: 'Frequency', value: fund.distributions ? fund.distributions.frequency : null },
        { section: 'Distributions', metric: 'Ex-Date', value: fund.distributions ? fund.distributions.exDate : null },
        { section: 'Distributions', metric: 'Latest Dividend', value: fund.distributions ? fund.distributions.dividend : null },
        { section: 'Distributions', metric: 'Dividend Yield (indicated)', value: fund.dividendYield === null || fund.dividendYield === undefined ? null : `${fund.dividendYield.toFixed(2)}% (latest distribution x frequency / price)` },
        { section: 'Distributions', metric: 'SEC Yield (30-day)', value: meta && meta.yields ? (meta.yields.secYieldText || '—') : (fund.secYield === null || fund.secYield === undefined ? 'not published by franklintempleton.com for this fund' : `${fund.secYield.toFixed(2)}%`) },
        { section: 'Distributions', metric: 'Dividend Yield Basis', value: meta && meta.yields ? meta.yields.dividendYieldKind : null },
        { section: 'Distributions', metric: 'SEC Yield Basis', value: meta && meta.yields ? meta.yields.secYieldKind : null },
        { section: 'Holdings', metric: 'Holdings Rows', value: fund.holdings },
        { section: 'Holdings', metric: 'Holdings As Of', value: meta && meta.holdings ? meta.holdings.asOfDate : null },
        { section: 'Holdings', metric: 'History Rows', value: fund.history },
      ];
      const rows = sortRows(filterRows(overview.map(item => ({
        section: item.section,
        metric: item.metric,
        value: item.value === null || item.value === undefined || item.value === '' ? '—' : item.value,
        searchIndex: `${item.section} ${item.metric} ${item.value}`.toLowerCase(),
      }))));

      el.tableHead.innerHTML = `
        <tr>
          ${indexHeader()}
          ${sortHeader('Section', 'section')}
          ${sortHeader('Metric', 'metric')}
          ${sortHeader('Value', 'value')}
        </tr>
      `;
      bindSortHeaders();

      if (!rows.length) {
        el.tableBody.innerHTML = `<tr><td colspan="4" class="py-12 text-center text-slate-400 dark:text-slate-500">No overview metrics match your search.</td></tr>`;
      } else {
        el.tableBody.innerHTML = rows.map((row, index) => `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition border-b border-slate-100 dark:border-slate-700/30">
            <td class="py-2.5 px-4 text-slate-400 dark:text-slate-500 text-xs text-center font-mono">${index + 1}</td>
            <td class="py-2.5 px-4 text-slate-500 dark:text-slate-400">${escapeHtml(row.section)}</td>
            <td class="py-2.5 px-4 text-slate-700 dark:text-slate-300 font-medium">${escapeHtml(row.metric)}</td>
            <td class="py-2.5 px-4 text-slate-700 dark:text-slate-300 font-mono">${
              /^https?:\/\//.test(String(row.value))
                ? `<a class="text-blue-600 dark:text-blue-400 hover:underline" href="${escapeHtml(row.value)}" target="_blank" rel="noopener noreferrer">open link</a>`
                : escapeHtml(row.value)
            }</td>
          </tr>
        `).join('');
      }

      el.tickerCount.textContent = fund.ticker;
      renderSubtitle(`${fund.ticker} overview · ${rows.length} metrics. Returns are derived from adjusted market-price closes, not official NAV returns.`);
    }

    /**
     * Distributions ship in meta.json as records keyed by header (the same
     * shape as the paginated holdings/history pages); fetchPage() flattens
     * those for the paginated sheets, so the worksheet path must do the same
     * before the shared join/index based renderer touches the rows.
     */
    function worksheetRows(worksheet: any): string[][] {
      const headers: string[] = worksheet && Array.isArray(worksheet.headers) ? worksheet.headers : [];
      const rows: any[] = worksheet && Array.isArray(worksheet.rows) ? worksheet.rows : [];
      return rows.map(row => Array.isArray(row)
        ? row.map(cell => String(cell ?? ''))
        : headers.map(header => String(row ? row[header] ?? '' : '')));
    }

    function renderDistributionsTable(fund: FundRow): void {
      const meta = fundMetaCache.get(fund.ticker);
      const worksheet = meta && meta.distributions ? meta.distributions : { headers: [], rows: [] };
      const headers: string[] = Array.isArray(worksheet.headers) ? worksheet.headers : [];
      const sourceRows: string[][] = worksheetRows(worksheet);
      const rows = sortRows(filterRows(sourceRows.map((row, sourceIndex) => {
        const cells: Record<string, unknown> = { values: row, searchIndex: row.join(' ').toLowerCase(), rank: sourceIndex };
        headers.forEach((header, index) => { cells[`col${index}`] = row[index] ?? ''; });
        return cells;
      })));

      el.tableHead.innerHTML = `
        <tr>
          ${indexHeader()}
          ${headers.map((header, index) => sortHeader(header, `col${index}`)).join('')}
        </tr>
      `;
      bindSortHeaders();

      if (!rows.length) {
        el.tableBody.innerHTML = `<tr><td colspan="${headers.length + 1}" class="py-12 text-center text-slate-400 dark:text-slate-500">No published distribution for ${escapeHtml(fund.ticker)}.</td></tr>`;
      } else {
        el.tableBody.innerHTML = rows.map((row, index) => {
          const values: string[] = row.values || [];
          return `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition border-b border-slate-100 dark:border-slate-700/30">
            <td class="py-2.5 px-4 text-slate-400 dark:text-slate-500 text-xs text-center font-mono">${index + 1}</td>
            ${values.map(cell => `<td class="py-2.5 px-4 text-slate-700 dark:text-slate-300 font-mono">${escapeHtml(cell || '—')}</td>`).join('')}
          </tr>
        `;}).join('');
      }

      el.tickerCount.textContent = fund.ticker;
      renderSubtitle(`${fund.ticker} distributions · dividend history from the Yahoo chart feed (ex-date, amount); frequency is inferred from the cadence.`);
    }

    // =========================================================================
    // 7. Subtitle
    // =========================================================================

    function renderSubtitle(text?: string): void {
      const generated = state.generatedAt ? new Date(state.generatedAt).toLocaleString() : '';
      const countsText = state.counts
        ? `${state.counts.funds} ETFs · ${(state.counts.holdings || 0).toLocaleString('en-US')} holdings rows · ${(state.counts.history || 0).toLocaleString('en-US')} history rows`
        : '';
      const base = text ? String(text) : 'Search Franklin ETFs, select rows, then use the Watchlist tab.';
      el.subtitle.innerHTML = `
        <span class="block sm:inline">${escapeHtml(base)}</span>
        <span class="block sm:inline">·${generated ? ` updated ${escapeHtml(generated)}` : ''}${countsText ? ` · ${escapeHtml(countsText)}.` : '.'} Data: <a href="./api/franklin/index.json" target="_blank" rel="noopener noreferrer" class="font-semibold text-blue-600 dark:text-blue-400 hover:underline">api/franklin/index.json</a> generated from <a href="https://www.franklintempleton.com/investments/options/exchange-traded-funds" target="_blank" rel="noopener noreferrer" class="font-semibold text-blue-600 dark:text-blue-400 hover:underline">franklintempleton.com ETF listings</a> + SEC EDGAR + Yahoo Finance</span>
      `;
    }

    function setStatusRow(message: string, tone: 'info' | 'error'): void {
      el.tableBody.innerHTML = `<tr><td colspan="10" class="py-12 text-center ${tone === 'error' ? 'text-rose-500 dark:text-rose-300' : 'text-slate-400 dark:text-slate-500'}">${escapeHtml(message)}</td></tr>`;
    }

    // =========================================================================
    // 8. Selection & blacklist
    // =========================================================================

    function toggleFund(ticker: string): void {
      const cleanTicker = sanitizeTicker(ticker);
      if (!cleanTicker) return;
      const previousActiveFund = state.activeFundTicker;

      if (state.selected.has(cleanTicker)) {
        state.selected.delete(cleanTicker);
        if (state.activeFundTicker === cleanTicker) state.activeFundTicker = [...state.selected][0] || null;
      } else {
        state.selected.add(cleanTicker);
        state.activeFundTicker = cleanTicker;
      }

      invalidateWatchlistRows();
      watchlistVisibleLimit = WATCHLIST_PAGE_SIZE;
      if (previousActiveFund !== state.activeFundTicker) resetSheetPaging();
      persistSelection();
      ensureValidTab();
      render();
      void ensureHoldingsForSelection();
      const activeTicker = state.activeFundTicker;
      if (activeTicker && state.activeTab.startsWith('detail:')) void loadFundMeta(activeTicker);
    }

    /**
     * Toggles the selection in bulk. `scope`:
     *  - 'visible' (header "Use" checkbox) — only the rows currently rendered
     *    in the catalog table: current tab + active search filter (visibleFunds
     *    is already tab-scoped and blacklist-excluded). Selecting with a filter
     *    active must not drag the hidden ETFs into the selection, and unchecking
     *    must not drop selections made under a different filter.
     *  - 'catalog' (checkbox in the All ETFs pill) — every non-blacklisted ETF,
     *    regardless of the current tab or filter; it sits next to the
     *    "All ETFs (N)" count and represents the whole catalog.
     */
    function toggleSelectAll(selectAll: boolean, scope: 'visible' | 'catalog'): void {
      const previousActiveFund = state.activeFundTicker;
      const candidates = scope === 'visible'
        ? filterRows(visibleFunds())
        : state.funds.filter(fund => !state.blacklist.has(fund.ticker));
      candidates.forEach(fund => {
        if (selectAll) state.selected.add(fund.ticker);
        else state.selected.delete(fund.ticker);
      });
      if (!state.selected.size) state.activeFundTicker = null;
      else if (!state.activeFundTicker || !state.selected.has(state.activeFundTicker)) {
        state.activeFundTicker = [...state.selected][0] || null;
      }
      invalidateWatchlistRows();
      watchlistVisibleLimit = WATCHLIST_PAGE_SIZE;
      if (previousActiveFund !== state.activeFundTicker) resetSheetPaging();
      persistSelection();
      ensureValidTab();
      render();
      void ensureHoldingsForSelection();
    }

    function clearSelectionAndSearch(): void {
      state.selected.clear();
      state.activeFundTicker = null;
      state.queryByTab = {};
      resetSheetPaging();
      state.activeTab = 'All';
      // Sort preferences survive Clear: a sort configured in the past is kept
      // per tab in localStorage and reused. Clear only resets the selection
      // and the searches — never the sort order.
      applySortForTab('All');
      invalidateWatchlistRows();
      watchlistVisibleLimit = WATCHLIST_PAGE_SIZE;
      persistSelection();
      localStorage.removeItem(ACTIVE_FUND_KEY);
      el.searchInput.value = '';
      updateSearchClearBtn();
      persistSearches();
      render();
    }

    function blacklistTickers(rawTickers: string[]): void {
      const previousActiveFund = state.activeFundTicker;
      const known = new Set(state.funds.map(fund => fund.ticker));
      rawTickers
        .flatMap(raw => String(raw || '').split(/[\s,;]+/))
        .map(sanitizeTicker)
        .filter(Boolean)
        .filter(ticker => known.has(ticker))
        .forEach(ticker => state.blacklist.add(ticker));
      state.selected = new Set([...state.selected].filter(ticker => !state.blacklist.has(ticker)));
      if (state.activeFundTicker && state.blacklist.has(state.activeFundTicker)) {
        state.activeFundTicker = [...state.selected][0] || null;
      }
      invalidateWatchlistRows();
      watchlistVisibleLimit = WATCHLIST_PAGE_SIZE;
      if (previousActiveFund !== state.activeFundTicker) resetSheetPaging();
      persistBlacklist();
      persistSelection();
      ensureValidTab();
      render();
      void ensureHoldingsForSelection();
    }

    function submitBlacklistInput(): void {
      blacklistTickers([el.blacklistInput.value || '']);
      el.blacklistInput.value = '';
      fitTableHeight();
    }

    function unblacklistTicker(ticker: string): void {
      state.blacklist.delete(sanitizeTicker(ticker));
      persistBlacklist();
      render();
    }

    function clearBlacklist(): void {
      state.blacklist.clear();
      persistBlacklist();
      render();
    }

    /**
     * The blacklist panel's max-height is content-driven (an unbounded number
     * of chips), unlike the fixed-height detail nav, so it cannot use a static
     * max-height in CSS — it is measured from scrollHeight instead, and
     * re-measured on every render so the panel resizes smoothly as chips are
     * added or removed while it is open.
     */
    function syncBlacklistPanelHeight(): void {
      el.blacklistPanel.style.maxHeight = el.blacklistPanel.classList.contains('is-visible')
        ? `${el.blacklistPanel.scrollHeight}px`
        : '';
    }

    /**
     * Opening the panel transitions its own padding in from 0, so a measurement
     * taken in the click handler is short by that padding and the cap would
     * clip the last line of the panel. Re-measure once the expansion has
     * settled (and after any later padding/size transition), never while the
     * panel is collapsed.
     */
    function bindBlacklistPanelResize(): void {
      el.blacklistPanel.addEventListener('transitionend', (event: any) => {
        if (event.target !== el.blacklistPanel) return;
        if (!el.blacklistPanel.classList.contains('is-visible')) return;
        syncBlacklistPanelHeight();
        fitTableHeight();
      });
    }

    function renderBlacklistPanel(): void {
      el.blacklistChips.innerHTML = '';
      const tickers = [...state.blacklist].sort();
      tickers.forEach(ticker => {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center gap-1.5 bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-700/50 rounded-full pl-3 pr-1.5 py-1 text-xs font-medium';
        chip.innerHTML = `${escapeHtml(ticker)}<button data-unblacklist="${escapeHtml(ticker)}" class="w-5 h-5 rounded-full hover:bg-rose-200 dark:hover:bg-rose-800 transition" title="Remove ${escapeHtml(ticker)} from blacklist">✕</button>`;
        el.blacklistChips.appendChild(chip);
      });
      el.blacklistEmpty.classList.toggle('hidden', tickers.length > 0);
      el.blacklistChips.querySelectorAll('button[data-unblacklist]').forEach((button: any) => {
        button.addEventListener('click', () => unblacklistTicker(button.dataset.unblacklist || ''));
      });
      syncBlacklistPanelHeight();
    }

    // =========================================================================
    // 9. Actions & exports (CSV, TXT, Copy Tickers)
    // =========================================================================

    function currentExportRows(): { headers: string[]; rows: string[][]; scope: string } {
      if (state.activeTab === 'watchlist') {
        return {
          headers: ['Ticker', 'Name', 'ETFs', '# ETFs', 'Weight Sum (%)', 'Max Weight (%)', 'Identifiers'],
          rows: getVisibleWatchlistRows().map(row => [
            row.symbol,
            row.name,
            row.funds.join('|'),
            String(row.fundCount),
            row.weightSum.toFixed(6),
            row.maxWeight.toFixed(6),
            row.cusips.join('|'),
          ]),
          scope: 'watchlist',
        };
      }

      if (state.activeTab === 'detail:overview') {
        const fund = getActiveFund();
        const monthEnd = (fund && fund.returns && fund.returns.monthEnd) || {};
        const quarterEnd = (fund && fund.returns && fund.returns.quarterEnd) || {};
        return {
          headers: ['Ticker', 'Fund Name', 'Category', 'TER', 'NAV', 'Net Assets ($)', 'YTD (ME)', '1Y (ME)', '3Y (ME)', '5Y (ME)', '10Y (ME)', 'SI Ann. (ME)', 'ME As Of', '1Y (QE)', '3Y (QE)', 'Inception', 'Holdings', 'History'],
          rows: [[
            fund ? fund.ticker : '',
            fund ? fund.name : '',
            fund ? fund.category : '',
            fund ? fund.ter : '',
            fund ? fund.nav : '',
            fund ? numberCell(fund.aumValue) : '',
            numberCell(monthEnd.ytd),
            numberCell(monthEnd.yr1),
            numberCell(monthEnd.yr3),
            numberCell(monthEnd.yr5),
            numberCell(monthEnd.yr10),
            numberCell(monthEnd.sinceInception),
            monthEnd.asOfDate || '',
            numberCell(quarterEnd.yr1),
            numberCell(quarterEnd.yr3),
            fund ? fund.inceptionDate : '',
            fund ? String(fund.holdings) : '0',
            fund ? String(fund.history) : '0',
          ]],
          scope: fund ? `${fund.ticker}-overview` : 'overview',
        };
      }

      if (state.activeTab === 'detail:distributions') {
        const fund = getActiveFund();
        const meta = fund ? fundMetaCache.get(fund.ticker) : null;
        const worksheet = meta && meta.distributions ? meta.distributions : { headers: [], rows: [] };
        return {
          headers: worksheet.headers || [],
          rows: worksheetRows(worksheet),
          scope: fund ? `${fund.ticker}-distributions` : 'distributions',
        };
      }

      if (state.activeTab === 'detail:holdings' || state.activeTab === 'detail:history') {
        const sheet = state.activeTab === 'detail:history' ? 'history' : 'holdings';
        const fund = getActiveFund();
        const entry = fund ? sheetState.get(sheetKey(sheet)) : null;
        if (entry) {
          return {
            headers: entry.headers,
            rows: filterRows(entry.rows.map(row => ({ values: row, searchIndex: row.join(' ').toLowerCase() }))).map((row: any) => row.values),
            scope: fund ? `${fund.ticker}-${sheet}` : sheet,
          };
        }
        return { headers: [], rows: [], scope: sheet };
      }

      return {
        headers: ['Selected', 'Ticker', 'Fund Name', 'Type', 'NAV', 'Net Assets ($)', 'Expense (%)', 'Dividend Yield (%)', 'SEC Yield (%)', 'Frequency', 'YTD Return (%)', 'TR 1Y (%)', 'TR 3Y (%)', 'TR 5Y (%)', 'TR 10Y (%)', 'CAGR 3Y (%)', 'CAGR 5Y (%)', 'CAGR 10Y (%)', 'SI Ann. (%)', 'Return As Of', 'Inception', 'Holdings', 'History', 'As Of'],
        rows: filterRows(visibleFunds()).map(fund => [
          state.selected.has(fund.ticker) ? 'yes' : 'no',
          fund.ticker,
          fund.name,
          fund.category,
          fund.nav || '',
          numberCell(fund.aumValue),
          numberCell(fund.terValue),
          numberCell(fund.dividendYield),
          numberCell(fund.secYield),
          fund.frequencyCode || '',
          numberCell(fund.ytd),
          numberCell(fund.yr1),
          numberCell(fund.tr3y),
          numberCell(fund.tr5y),
          numberCell(fund.tr10y),
          numberCell(fund.cagr3y),
          numberCell(fund.cagr5y),
          numberCell(fund.cagr10y),
          numberCell(fund.si),
          fund.returnAsOf || '',
          fund.inceptionDate || '',
          String(fund.holdings),
          String(fund.history),
          fund.asOfDate || '',
        ]),
        scope: 'etfs',
      };
    }

    function copyTickers(): void {
      let values: string[] = [];
      if (state.activeTab === 'watchlist') values = getVisibleWatchlistRows().map(row => row.symbol);
      else if (isDetailTab(state.activeTab)) values = currentExportRows().rows.map(row => String(row[0] ?? '')).filter(Boolean);
      else values = filterRows(visibleFunds()).map(fund => fund.ticker);
      values = values.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (!values.length) return;
      void copyText(values.join(', ')).then(() => {
        const oldText = el.copyBtn.textContent;
        el.copyBtn.textContent = 'Copied!';
        setTimeout(() => { el.copyBtn.textContent = oldText || 'Copy Tickers'; }, 1000);
      });
    }

    function exportCsv(): void {
      const exportData = currentExportRows();
      if (!exportData.rows.length) return;
      downloadText(
        toCsv([exportData.headers, ...exportData.rows.map(row => row.map(cell => String(cell ?? '')))]),
        exportFileName(exportData.scope, 'csv'),
        'text/csv;charset=utf-8;',
      );
    }

    function exportTxt(): void {
      const exportData = currentExportRows();
      if (!exportData.rows.length) return;
      downloadText(exportData.rows.map(row => row.join('\t')).join('\n'), exportFileName(exportData.scope, 'txt'), 'text/plain;charset=utf-8;');
    }

    // =========================================================================
    // 10. Scroll fix: only the table scrolls (same fix as daggerok/iShares)
    // =========================================================================

    function fitTableHeight(): void {
      const rect = el.tableScroll.getBoundingClientRect();
      const bottomPad = window.innerWidth < 640 ? 12 : 24;
      const max = Math.max(240, window.innerHeight - rect.top - bottomPad);
      el.tableScroll.style.maxHeight = `${max}px`;
    }

    // =========================================================================
    // 11. State persistence
    // =========================================================================

    function persistSelection(): void {
      localStorage.setItem(SELECTED_KEY, JSON.stringify([...state.selected]));
      if (state.activeFundTicker) localStorage.setItem(ACTIVE_FUND_KEY, state.activeFundTicker);
      else localStorage.removeItem(ACTIVE_FUND_KEY);
    }

    function persistBlacklist(): void {
      localStorage.setItem(BLACKLIST_KEY, JSON.stringify([...state.blacklist]));
    }

    function persistSearches(): void {
      localStorage.setItem(SEARCHES_KEY, JSON.stringify(state.queryByTab));
    }

    function restoreSelectedEtfs(): void {
      try {
        const saved = JSON.parse(localStorage.getItem(SELECTED_KEY) || '[]');
        state.selected = new Set((Array.isArray(saved) ? saved : []).map(sanitizeTicker).filter(Boolean));
        if (!state.selected.size && localStorage.getItem(SELECTED_KEY) === null) state.selected = new Set(DEFAULT_SELECTED_TICKERS);
      } catch {
        state.selected = new Set(DEFAULT_SELECTED_TICKERS);
      }
      const savedActive = sanitizeTicker(localStorage.getItem(ACTIVE_FUND_KEY) || '');
      state.activeFundTicker = savedActive && state.selected.has(savedActive) ? savedActive : ([...state.selected][0] || null);
    }

    function restoreBlacklist(): void {
      try {
        const saved = JSON.parse(localStorage.getItem(BLACKLIST_KEY) || 'null');
        if (Array.isArray(saved)) state.blacklist = new Set(saved.map(sanitizeTicker));
      } catch {
        // Ignore malformed storage.
      }
    }

    function restoreSearches(): void {
      try {
        state.queryByTab = JSON.parse(localStorage.getItem(SEARCHES_KEY) || '{}') || {};
      } catch {
        state.queryByTab = {};
      }
    }

    function cleanTabSorts(value: any): Record<string, { key: string; dir: SortDirection }> {
      const clean: Record<string, { key: string; dir: SortDirection }> = {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
      Object.keys(value).forEach(tab => {
        const entry = value[tab];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
        if (typeof entry.key !== 'string' || !entry.key) return;
        if (entry.dir !== 'asc' && entry.dir !== 'desc') return;
        clean[tab] = { key: entry.key, dir: entry.dir };
      });
      return clean;
    }

    function restoreTabSorts(): void {
      try {
        state.sortByTab = cleanTabSorts(JSON.parse(localStorage.getItem(SORTS_KEY) || 'null'));
      } catch {
        state.sortByTab = {};
      }
    }

    function persistTabSorts(): void {
      try {
        const clean = cleanTabSorts(state.sortByTab);
        if (Object.keys(clean).length > 0) localStorage.setItem(SORTS_KEY, JSON.stringify(clean));
        else localStorage.removeItem(SORTS_KEY);
      } catch {
        // Ignore quota / private-mode failures.
      }
    }

    // =========================================================================
    // 12. Bootstrap lifecycle
    // =========================================================================

    // =========================================================================
    // 12. N-PORT upload (drag & drop, client-side parse; iShares dropzone twin)
    // =========================================================================

    /**
     * Parses a SEC Form N-PORT-P primary_doc.xml in the browser (DOMParser, no
     * network). Same normalization as the Bun updater, so uploaded holdings
     * merge into the Watchlist exactly like static-feed holdings.
     */
    function parseNportUpload(text: string): { seriesName: string; repPdDate: string; headers: string[]; rows: string[][] } {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('not a valid XML file');
      const headers = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
      const rows: string[][] = [];
      let seriesName = '';
      let repPdDate = '';
      const all = doc.getElementsByTagName('*');
      let inGenInfo = false;
      for (let i = 0; i < all.length; i++) {
        const node = all[i];
        const tag = node.localName || '';
        if (tag === 'genInfo') inGenInfo = true;
        if (inGenInfo && !seriesName && tag === 'seriesName') seriesName = (node.textContent || '').trim();
        if (inGenInfo && !repPdDate && tag === 'repPdDate') repPdDate = (node.textContent || '').trim();
        if (tag === 'invstOrSecs') inGenInfo = false;
        if (tag !== 'invstOrSec') continue;
        const pick = (parent: Element, name: string): string => {
          const children = parent.getElementsByTagName('*');
          for (let c = 0; c < children.length; c++) {
            if ((children[c].localName || '') === name) return (children[c].textContent || '').trim();
          }
          return '';
        };
        const name = pick(node, 'name') || pick(node, 'title') || '-';
        const cusip = pick(node, 'cusip');
        let identifier = cusip && cusip.toUpperCase() !== 'N/A' ? cusip : '';
        if (!identifier) {
          const ids = node.getElementsByTagName('*');
          for (let c = 0; c < ids.length; c++) {
            const value = ids[c].getAttribute && ids[c].getAttribute('value');
            if (value && ['isin', 'sedol', 'other', 'cusip'].includes(ids[c].localName || '')) {
              identifier = value;
              break;
            }
          }
        }
        let marketValue = pick(node, 'valUSD');
        let balance = pick(node, 'balance');
        rows.push([
          name,
          '-',
          identifier || '-',
          pick(node, 'pctVal') || '0',
          marketValue || '0',
          balance || '-',
          pick(node, 'assetCat') || '-',
        ]);
      }
      if (!rows.length && !seriesName) throw new Error('no genInfo/invstOrSec entries found (is this a Form N-PORT primary_doc.xml?)');
      return { seriesName, repPdDate, headers, rows };
    }

    const uploadedFunds = new Map(); // ticker -> { headers, rows }

    function normalizeUploadName(value: string): string {
      return String(value || '')
        .toUpperCase()
        .replace(/REG/ig, '')
        .replace(/\u00ae/g, '')
        .replace(/\u2122/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b(ETF|FUND|INDEX|THE)\b/g, '')
        .trim();
    }

    function setDropzoneState(stateName: 'loaded' | 'error' | null, text?: string): void {
      if (!dropzone || !dropzoneText) return;
      dropzone.classList.remove('dz-loaded', 'dz-error');
      if (stateName) dropzone.classList.add(stateName);
      if (text) dropzoneText.textContent = text;
    }

    function handleUploadedFile(file: File): void {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = parseNportUpload(String(reader.result || ''));
          const known = state.funds.find(fund => normalizeUploadName(fund.name) === normalizeUploadName(parsed.seriesName));
          let ticker = known ? known.ticker : '';
          if (!ticker) {
            const answer = window.prompt(`Ticker symbol for "${parsed.seriesName}" (as listed on EDGAR):`, '');
            ticker = sanitizeTicker(answer);
          }
          if (!ticker) {
            setDropzoneState('error', 'Upload cancelled');
            window.setTimeout(() => setDropzoneState(null, 'Upload / Drop N-PORT XML'), 1600);
            return;
          }
          uploadedFunds.set(ticker, { headers: parsed.headers, rows: parsed.rows });

          // Merge the uploaded fund into the catalog (override static holdings).
          const base = known || {
            ticker, name: parsed.seriesName || ticker, category: 'Uploaded', fundPage: null, dataFile: null,
            ter: '—', terValue: null, nav: '—', navValue: null, aum: '—', aumValue: null,
            asOfDate: parsed.repPdDate || '—', inceptionDate: '—', exchange: '', closePrice: '—', closePriceValue: null,
            premiumDiscount: '—', premiumDiscountValue: null,
            distributions: { frequency: '—', exDate: '—', dividend: '—' },
            returns: { monthEnd: null, quarterEnd: null },
          };
          const indexFund: any = {
            ...base,
            ticker,
            name: parsed.seriesName || (known ? known.name : ticker),
            category: known ? known.category : 'Uploaded',
            metrics: { dividendYield: null, secYield: null },
            holdings: parsed.rows.length,
            history: known ? known.history : 0,
          };
          const row = normalizeFundRow(indexFund);
          const existingIndex = state.funds.findIndex(fund => fund.ticker === ticker);
          if (existingIndex >= 0) state.funds[existingIndex] = row;
          else state.funds.push(row);
          state.funds.sort((a, b) => a.ticker.localeCompare(b.ticker));

          // Holdings live in memory: feed the sheet cache + a minimal meta so
          // detail tabs, lazy paging and Watchlist aggregation all work.
          sheetState.set(`${ticker}:holdings`, { headers: parsed.headers, rows: parsed.rows, nextPage: 1, manifest: { pages: [], pageSize: parsed.rows.length, totalRows: parsed.rows.length }, loading: false });
          fundMetaCache.set(ticker, {
            ...fundMetaCache.get(ticker),
            ticker,
            name: row.name,
            category: row.category,
            source: { fundPage: row.fundPage, edgarFiling: null, nportDoc: null, provider: 'uploaded N-PORT XML (session only)' },
            distributions: { frequency: known && known.distributions ? known.distributions.frequency : '—', headers: ['Ex-Date', 'Amount'], rows: [] },
            holdings: { pages: [], pageSize: parsed.rows.length, totalRows: parsed.rows.length, asOfDate: parsed.repPdDate || 'uploaded' },
            history: known && fundMetaCache.get(ticker) ? fundMetaCache.get(ticker).history : { pages: [], pageSize: 0, totalRows: 0, asOfDate: '—' },
            uploaded: true,
          });

          setDropzoneState('loaded', `${uploadedFunds.size} fund${uploadedFunds.size === 1 ? '' : 's'} uploaded`);
          setStatus(`Loaded ${ticker} (${parsed.seriesName || 'N-PORT'}): ${parsed.rows.length} holdings${parsed.repPdDate ? ` as of ${parsed.repPdDate}` : ''}. Uploads live for this session.`, 'info');
          fitTableHeight();
          render();
        } catch (error) {
          console.error('Failed to parse uploaded file:', error);
          setDropzoneState('error', 'Invalid N-PORT XML');
          window.setTimeout(() => setDropzoneState(null, 'Upload / Drop N-PORT XML'), 2200);
        }
      };
      reader.readAsText(file);
    }

    function bindEvents(): void {
      el.themeToggle.addEventListener('click', () => {
        const dark = !document.documentElement.classList.contains('dark');
        localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
        applyTheme(dark);
      });

      el.searchInput.addEventListener('input', () => {
        setCurrentQuery(el.searchInput.value.trim());
        updateSearchClearBtn();
        if (state.activeTab === 'watchlist') watchlistVisibleLimit = WATCHLIST_PAGE_SIZE;
        render();
      });

      el.searchClearBtn.addEventListener('click', () => {
        clearActiveSearchFilter();
      });

      // N-PORT dropzone (iShares dropzone parity)
      if (dropzone && fileInput) {
        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', (event: Event) => {
          event.preventDefault();
          dropzone.classList.add('dz-active');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dz-active'));
        dropzone.addEventListener('drop', (event: DragEvent) => {
          event.preventDefault();
          dropzone.classList.remove('dz-active');
          if (event.dataTransfer && event.dataTransfer.files.length) handleUploadedFile(event.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', (event: Event) => {
          const target: any = event.target;
          if (target && target.files && target.files.length) handleUploadedFile(target.files[0]);
        });
      }

      el.copyBtn.addEventListener('click', copyTickers);
      el.exportCsvBtn.addEventListener('click', exportCsv);
      el.exportTxtBtn.addEventListener('click', exportTxt);
      el.resetBtn.addEventListener('click', clearSelectionAndSearch);

      el.blacklistBtn.addEventListener('click', () => {
        const visible = el.blacklistPanel.classList.toggle('is-visible');
        el.blacklistBtn.setAttribute('aria-expanded', String(visible));
        renderBlacklistPanel();
        bindBlacklistPanelResize();
        fitTableHeight();
      });
      el.blacklistAddBtn.addEventListener('click', submitBlacklistInput);
      el.blacklistInput.addEventListener('keydown', (event: any) => {
        if (event.key === 'Enter') submitBlacklistInput();
      });
      el.blacklistClearBtn.addEventListener('click', clearBlacklist);

      // Paginated sheets: append more rows as the sentinel scrolls into view.
      if (typeof IntersectionObserver === 'function') {
        const observer = new IntersectionObserver(
          entries => {
            if (entries.some(entry => entry.isIntersecting)) maybeLoadMoreRows();
          },
          { root: el.tableScroll, rootMargin: '600px 0px' },
        );
        observer.observe(el.staticLoadSentinel);
      }
      el.staticLoadSentinel.addEventListener('click', () => maybeLoadMoreRows());
      el.tableScroll.addEventListener('scroll', () => {
        const distanceToBottom = el.tableScroll.scrollHeight - el.tableScroll.scrollTop - el.tableScroll.clientHeight;
        if (state.activeTab === 'watchlist') {
          if (distanceToBottom < 600) maybeLoadMoreRows();
          return;
        }
        const sheet = activeSheetTab();
        if (!sheet || !state.activeFundTicker) return;
        const entry = sheetState.get(sheetKey(sheet));
        if (!entry || entry.loading || entry.nextPage >= entry.manifest.pages.length) return;
        if (distanceToBottom < 600) void loadNextSheetPage(sheet);
      }, { passive: true });

      // Keep only the table scrolling: refit on viewport changes and whenever
      // the content above the table (wrapping toolbar, panels) changes height.
      window.addEventListener('resize', fitTableHeight);
      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => fitTableHeight()).observe(document.body);
      }
    }

    function init(): void {
      restoreSelectedEtfs();
      restoreBlacklist();
      restoreSearches();
      restoreTabSorts();
      applyTheme(localStorage.getItem(THEME_KEY) === 'dark');
      bindEvents();
      syncSearchInput();
      fitTableHeight();
      renderSubtitle();
      void loadCatalog().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        el.tickerCount.textContent = 'Error';
        setStatusRow(`Unable to load api/franklin/index.json: ${message}. Run bun ./scripts/update-data.ts and serve the folder (for example bunx serve . -p 1234).`, 'error');
      });
    }

  
  
  
