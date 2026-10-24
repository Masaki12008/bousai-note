// 段階3（公開用サイト：機能ごとのページ・文章のページ・地図の同梱・カレンダー・CSP）の試験
// 先に `python3 build-site.py` で dist/ を作り、dist で `python3 -m http.server 8767` を動かしておく
// Playwright は、入っていればそれを使い、なければこの開発環境の場所から読む
const { chromium } = await import('playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));
import fs from 'fs';
const S = process.env.SHOT_DIR || '/tmp';
const BASE = 'http://localhost:8767/';
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const external = [];
// 外部通信はこの環境では遮断されているため、国土地理院はテスト用の固定応答（実データではない）
await ctx.route('**/*', (r) => {
  const u = r.request().url();
  if (u.startsWith('http://localhost:8767')) return r.continue();
  if (u.includes('msearch.gsi.go.jp')) return r.fulfill({ json: [{ geometry: { coordinates: [138.1878, 36.6616] }, properties: { title: 'テスト住所' } }] });
  if (u.includes('/skhb04/10/')) return r.fulfill({ json: { features: [{ geometry: { type: 'Point', coordinates: [138.19, 36.662] }, properties: { name: 'テスト施設', address: '住所' } }] } });
  if (u.includes('/skhb')) return r.fulfill({ status: 404, body: '' });
  external.push(u);
  return r.abort();
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/.test(m.text())) errors.push(`CSP: ${m.text()}`); });

const pages = [
  ['', 'guide', 'わが家の防災ノート'],
  ['bichiku/', 'stock', '防災備蓄の計算'],
  ['hinan/', 'evac', '災害の種類ごとの避難場所'],
  ['kimegoto/', 'rules', '家族の防災の決め事'],
  ['171/', 'guide', '災害用伝言ダイヤル171の使い方'],
];
for (const [path, tab, h1] of pages) {
  await p.goto(BASE + path);
  const shown = await p.$eval(`#panel-${tab}`, (n) => !n.hidden);
  const title = await p.textContent('h1');
  const desc = await p.$eval('meta[name=description]', (m) => m.content.length);
  const faq = await p.$$eval('.faq details', (d) => d.length);
  ok(shown && title.includes(h1) && desc > 50 && faq === 3, `/${path}：最初に開くタブ・見出し・説明文・よくある質問`);
}
// サブページから CSS・JS・アイコンが読める（相対パスの書き換え）
await p.goto(BASE + 'bichiku/');
ok(await p.evaluate(() => getComputedStyle(document.querySelector('.tabbar')).position === 'fixed'), 'サブページでもCSSが効く');
ok(await p.evaluate(() => typeof STOCK_RULES !== 'undefined'), 'サブページでもJSが動く');
const footerHref = await p.$eval('.footer-links a[href$="privacy/"]', (a) => a.getAttribute('href'));
ok(footerHref === '../privacy/', `サブページのフッターのリンク（${footerHref}）`);
ok((await p.$$eval('.stock-table .guide-link', (a) => a.map((x) => x.getAttribute('href')))).includes('../erabikata/water/'), '備蓄の品目から選び方のページへ');

// 地図（Leafletを同梱）
await p.goto(BASE + 'hinan/');
await p.fill('#addr', '長野市');
await p.click('#addr-form button[type=submit]');
await p.waitForFunction(() => document.querySelector('#evac-status').textContent.includes('テスト住所'));
await p.waitForSelector('#map .leaflet-container, #map.leaflet-container', { timeout: 10000 }).catch(() => {});
ok(await p.evaluate(() => !!window.L && !document.querySelector('#map').hidden), '地図ライブラリを自分のサイトから読み込んで地図を出す');

// カレンダー
await p.goto(BASE + 'bichiku/');
await p.fill('#stock-body-priority input[type=month] >> nth=0', '2027-03').catch(async () => {
  await p.$eval('#stock-body-priority input[type=month]', (i) => { i.value = '2027-03'; i.dispatchEvent(new Event('change')); });
});
await p.$eval('#stock-body-priority input[type=month]', (i) => { i.value = '2027-03'; i.dispatchEvent(new Event('change')); });
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#ics-download')]);
const ics = fs.readFileSync(await dl.path(), 'utf8');
ok(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('DTSTART;VALUE=DATE:20270301') && ics.includes('RRULE:FREQ=MONTHLY;BYMONTHDAY=1') && ics.includes('\r\n'), 'カレンダー（.ics）に期限・毎月の点検日を入れる');

// ホーム画面への追加の案内
await p.goto(BASE);
ok(await p.isVisible('#install-card'), 'ホーム画面への追加の案内を出す');
await p.click('#install-dismiss');
await p.reload();
ok(await p.isHidden('#install-card'), '「今は追加しない」を覚える');

// 文章のページ
for (const path of ['about/', 'disclaimer/', 'privacy/', 'erabikata/', 'erabikata/toilet/']) {
  const res = await p.goto(BASE + path);
  ok(res.status() === 200 && (await p.$$('h1')).length === 1, `/${path} が開ける`);
}
await p.goto(BASE + 'erabikata/toilet/');
ok((await p.textContent('main')).includes('1人1日5回') && (await p.$$('.shop-links a')).length === 2, '選び方のページに目安とショップのリンク');
ok(await p.evaluate(() => getComputedStyle(document.querySelector('.site-header')).borderBottomStyle === 'solid'), '2階層下のページでもCSSが効く');

// Service Worker と manifest
await p.goto(BASE + 'kimegoto/');
const scope = await p.evaluate(async () => (await navigator.serviceWorker.ready).scope);
ok(scope === BASE, `Service Worker がサイト全体を担当する（${scope}）`);
const manifest = await (await p.request.get(BASE + 'manifest.json')).json();
ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), 'manifestにPNG・maskableのアイコン');
await ctx.setOffline(true);
await p.goto(BASE + 'bichiku/').catch(() => {});
ok((await p.title()).includes('防災備蓄'), '圏外でもサブページが開く');
await ctx.setOffline(false);

ok(errors.length === 0, `ページのエラー・CSP違反なし ${JSON.stringify(errors)}`);
ok(!external.some((u) => u.includes('cdnjs')), '外部のCDNを使っていない');
await p.goto(BASE + 'hinan/');
await p.screenshot({ path: `${S}/site-hinan.png`, fullPage: false });
await p.goto(BASE + 'erabikata/water/');
await p.screenshot({ path: `${S}/site-water.png`, fullPage: true });
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
if (fail) process.exitCode = 1;
await b.close();
