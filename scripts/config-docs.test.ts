/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTROL_NAMES, parseConfig, resolveControls, runtimeControls, usageText } from './update-data';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = () => JSON.parse(read('scripts/update-data.config.json'));
const workflow = () => read('.github/workflows/update-data.yml');
const inputNames = (yml: string) => [...yml.slice(yml.indexOf('    inputs:'), yml.indexOf('\npermissions:')).matchAll(/^      (\w+):$/gm)].map((m) => m[1]);

test('precedence: file < advanced < nonblank input < env', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'FLIN' }, { CONCURRENCY: 3, TICKERS: 'FLGR' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '6' });
  expect(c.CONCURRENCY).toBe('6');
  expect(c.TICKERS).toBe('FLGR');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
});

test('blank input inherits the file value; advanced may deliberately blank a key', () => {
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(resolveControls({ TICKERS: 'FLIN' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
});

test('HISTORICAL_PAGE_SIZE stays a brand alias of HISTORY_PAGE_SIZE; the canonical name wins', () => {
  expect(resolveControls({ HISTORY_PAGE_SIZE: '1000' }, {}, {}, { HISTORICAL_PAGE_SIZE: '500' }).HISTORY_PAGE_SIZE).toBe('500');
  expect(resolveControls({}, {}, {}, { HISTORY_PAGE_SIZE: '300', HISTORICAL_PAGE_SIZE: '500' }).HISTORY_PAGE_SIZE).toBe('300');
});

test('scheduled path (empty inputs and advanced) equals the config defaults', () => {
  const defaults = file();
  const scheduled = resolveControls(defaults, JSON.parse('{}'), {});
  expect(scheduled).toEqual(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, String(v)])));
  expect(resolveControls(defaults, {}, Object.fromEntries(inputNames(workflow()).filter((n) => n !== 'advanced').map((n) => [n.toUpperCase(), '']))))
    .toEqual(scheduled);
});

test('invalid layers, unknown keys, non-scalars and newlines are rejected', () => {
  for (const value of [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { EDGAR_FALLBACK: 'sometimes' }, { AUM: '1:2:3' }, { TER: '5:1' }, { PERFORMANCE_1Y: 'x:y' }, { TICKERS: ['FLIN'] }, { TICKERS: { a: 1 } }, null, []]) {
    expect(() => resolveControls(value)).toThrow();
  }
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: 'A\nB' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
  expect(() => resolveControls({}, [])).toThrow();
  expect(() => JSON.parse('{bad')).toThrow();
});

test('provider-specific defaults', () => {
  const config = parseConfig(resolveControls(file()));
  expect(config.maxFetches).toBe(0);
  expect(config.requestSleep).toBe(1.5);
  expect(config.concurrency).toBe(3);
  expect(config.holdingsPageSize).toBe(250);
  expect(config.historyPageSize).toBe(1000);
  expect(config.maxRetries).toBe(2);
  expect(config.edgarFallback).toBe(true);
  expect(config.skipYahoo).toBe(false);
  expect(config.skipFranklin).toBe(false);
  expect(config.storeRawDownloads).toBe(false);
  expect(config.tickers).toBeNull();
  expect(config.category).toBe('');
  expect(config.historyRange).toBe('max');
  expect(config.aum).toBeUndefined();
  expect(config.performance).toEqual({});
  expect(config.totalReturn).toEqual({});
  expect(file().SEC_UA).not.toMatch(/@/);
});

test('runtimeControls reads the checked-in file and lets env override it', async () => {
  expect(await runtimeControls({})).toEqual(resolveControls(file()));
  expect((await runtimeControls({ TICKERS: 'FLIN FLGR', SKIP_YAHOO: '1' })).TICKERS).toBe('FLIN FLGR');
});

test('config file keys, CONTROL_NAMES, README rows and --help stay in sync', () => {
  expect(Object.keys(file()).sort()).toEqual([...CONTROL_NAMES].sort());
  for (const value of Object.values(file())) expect(typeof value).toBe('string');
  const doc = read('README.md');
  const help = usageText();
  for (const name of CONTROL_NAMES) {
    const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(YTD|1Y|3Y|5Y|10Y)$/);
    expect(doc).toContain(tenor ? '`' + tenor[1] + '_' + tenor[2] + '`' : '`' + name + '`');
    expect(help).toContain(tenor ? tenor[1] + '_YTD|1Y|3Y|5Y|10Y' : name);
  }
  expect(doc).toContain('scripts/update-data.config.json');
  const rows = [...doc.slice(doc.indexOf('### Update controls'), doc.indexOf('### Examples')).matchAll(/^\| `([A-Z0-9_]+)`/gm)].map((m) => m[1]);
  expect(rows.filter((r) => !(CONTROL_NAMES as readonly string[]).includes(r))).toEqual([]);
});

test('workflow: schedule, bounded inputs, one resolver, fixed output dir', () => {
  const yml = workflow();
  const names = inputNames(yml);
  expect(names.length).toBeLessThanOrEqual(25);
  expect(names).toContain('advanced');
  expect(yml).toMatch(/advanced:\n(?: {8}.*\n)*? {8}default: '\{\}'/);
  for (const name of names.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as never);
  expect(names).not.toContain('output_dir');
  expect(yml).toContain("cron: '0 0 * * 0'");
  expect(yml).not.toMatch(/^ {2}push:/m);
  expect(yml).toContain('toJSON(inputs)');
  expect(yml).toContain('resolveControls(file, advanced, individual, protectedVars)');
  expect(yml).not.toMatch(/\$\{\{\s*inputs\./);
  expect(yml).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
  expect(yml).toContain('git add api/franklin\n');
  expect(yml.match(/git add /g)?.length).toBe(1);
  expect(yml).not.toContain('bunx tsc');
});

test('updater only writes below api/franklin and exposes no output-dir control', () => {
  expect(CONTROL_NAMES.some((name) => /OUTPUT|DIR/.test(name))).toBe(false);
  const source = read('scripts/update-data.ts');
  expect(source).toContain("new URL('../api/franklin/'");
});

test('inline browser script contract (check-index) still passes', () => {
  const run = Bun.spawnSync(['bun', 'scripts/check-index.ts'], { cwd: new URL('..', import.meta.url).pathname });
  expect(run.exitCode).toBe(0);
});
