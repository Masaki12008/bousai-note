// Playwright は、入っていればそれを使い、なければこの開発環境の場所から読む
const { chromium } = await import('playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));
const S = process.env.SHOT_DIR || '/tmp';
const BASE = 'http://localhost:8765/index.html';
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
// 外部通信はこの環境では遮断されているため、テスト用の固定応答（実データではない）
let gsiMode = 'ok';
const route = async (ctx) => ctx.route('**/*', (r) => {
  const u = r.request().url();
  if (u.startsWith('http://localhost:8765')) return r.continue();
  if (u.includes('msearch.gsi.go.jp')) return r.fulfill({ json: [{ geometry: { coordinates: [138.1878, 36.6616] }, properties: { title: 'テスト住所' } }] });
  if (u.includes('/skhb')) {
    if (gsiMode === 'down') return r.abort();
    const m = u.match(/skhb0(\d)/); const n = Number(m[1]);
    if (n === 5) return r.fulfill({ status: 404, body: '' });
    // 火山（8）だけは約100km先に置き、10kmより遠い場所を出さないことを確かめる
    const lon = n === 8 ? 139.3 : 138.19 + n * 0.001;
    return r.fulfill({ json: { features: [{ geometry: { type: 'Point', coordinates: [lon, 36.662] }, properties: { name: `テスト施設${n}`, address: '住所' } }] } });
  }
  return r.abort();
});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write', 'geolocation'], geolocation: { latitude: 36.66, longitude: 138.19 } });
await route(ctx);
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await p.goto(BASE);

// タブ（下部固定・4つとも見える）
const tabsVisible = await p.$$eval('.tab', (ts) => ts.every((t) => { const r = t.getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight && r.width > 60; }));
ok(tabsVisible, '4つのタブがスマホ画面内にすべて見える');
ok(await p.isVisible('#my-rules-empty'), '決め事が空のとき「まだ決まっていません」を出す');

// 災害ボタン
await p.click('.action-btn[data-action=tsunami]');
const tsunami = await p.textContent('#action-panel');
ok(tsunami.includes('迎えに戻らない') && tsunami.includes('車は使わない'), '津波：迎えに戻らない・車を使わない');
await p.click('.action-btn[data-action=landslide]');
ok((await p.textContent('#action-panel')).includes('前ぶれがなくても起きる'), '土砂：前ぶれがなくても起きる');

// 避難場所（自宅）
await p.click('#tab-evac');
ok((await p.evaluate(() => location.hash)) === '#evac', 'タブがURLのハッシュに反映される');
await p.click('#addr-form button[type=submit]');
ok((await p.textContent('#evac-status')).includes('住所を入れて'), '住所が空のとき案内を出す');
await p.fill('#addr', '長野市');
await p.click('#addr-form button[type=submit]');
await p.waitForFunction(() => document.querySelector('#evac-status').textContent.includes('テスト住所'));
const cards = await p.$$eval('.evac-card h3', (h) => h.map((x) => x.textContent));
ok(cards.length === 6 && !cards.includes('津波') && !cards.includes('火山の噴火'), `10km以内にデータのある災害だけカードにする（${cards.length}枚）`);
const none = await p.textContent('#evac-results');
ok(none.includes('津波：10km以内に避難場所の指定はありません') && none.includes('海から離れた地域'), '内陸で津波の避難場所がないときは、内陸向けの説明を出す');
ok(none.includes('10km以内にデータがなかった災害：火山の噴火'), '10kmより遠い避難場所は出さない');
await p.click('.evac-card .map-choice summary >> nth=0');
const mapApps = await p.$$eval('.evac-card .map-choice[open] .map-choice-links a', (l) => l.map((a) => a.textContent + '|' + a.href));
ok(mapApps.some((x) => x.startsWith('Googleマップ|https://www.google.com/maps/')) && mapApps.some((x) => x.startsWith('Appleマップ|https://maps.apple.com/')) && mapApps.some((x) => x.startsWith('地理院地図|')), '地図で場所を見る：Googleマップ・Appleマップ・地理院地図から選べる');
ok(!(await p.content()).includes('google.com/maps/dir'), 'Googleの徒歩ルートへのリンクがない');
// 避難先にする
await p.click('.evac-card:has(h3:text-is("洪水")) button');
ok((await p.textContent('#evac-status')).includes('避難先として決め事に書きました'), '「避難先にする」で決め事に書く');

// 再読み込み2回＋保存の操作を挟んでも自宅の結果が消えない（以前のバグ）
await p.reload();
await p.click('#tab-stock');
await p.check('.bag-item input >> nth=0');
await p.reload();
await p.click('#tab-evac');
const names = await p.$$eval('.site-name', (n) => n.map((x) => x.textContent));
ok(names.length === 6, `2回の再読み込み後も自宅の結果が残る（${names.length}件）`);

// 通信失敗は「避難場所なし」と区別し、自宅の結果を上書きしない
gsiMode = 'down';
await p.fill('#addr', '長野市');
await p.click('#addr-form button[type=submit]');
await p.waitForFunction(() => document.querySelector('#evac-status').classList.contains('error'));
ok((await p.textContent('#evac-status')).includes('読み込めませんでした'), '全部失敗したら「読み込めませんでした」');
await p.reload(); await p.click('#tab-evac');
ok((await p.$$('.site-name')).length === 6, '通信失敗のあとも自宅の結果は残る');
gsiMode = 'ok';

// 現在地で探しても自宅は上書きしない
await p.click('#use-geo');
await p.waitForFunction(() => document.querySelector('#evac-status').textContent.includes('現在地'));
await p.waitForTimeout(800);
ok(await p.$eval('#evac-status', (n) => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), '現在地で探したら、結果の案内が画面に見える');
ok((await p.textContent('#use-geo')) === 'いる場所（現在地）で探す' && !(await p.$eval('#use-geo', (b) => b.disabled)), '探し終わったらボタンを元に戻す');
ok(await p.isVisible('#show-home'), '現在地の結果のとき「自宅の周りに戻す」が出る');
await p.reload(); await p.click('#tab-evac');
ok((await p.textContent('#evac-status')).includes('テスト住所'), '現在地で探しても、保存は自宅の結果のまま');

// 決め事
await p.click('#tab-rules');
await p.fill('#r-meet1', '家の前の公園');
await p.fill('#r-dengonNumber', '026-000-0000');
await p.fill('#r-health', '祖母は血圧の薬');
ok((await p.textContent('#rules-saved')).includes('保存しました'), '自動保存を表示する');
await p.click('#tab-guide');
const quick = await p.textContent('#my-rules-quick');
ok(quick.includes('家の前の公園') && quick.includes('テスト施設1'), 'いざという時に決め事（避難先を含む）を出す');
ok(await p.$eval('#my-rules-list a.tel', (a) => a.getAttribute('href') === 'tel:0260000000'), '電話番号をタップで発信できる');
await p.click('.action-btn[data-action=rain]');
ok((await p.textContent('#action-panel')).includes('テスト施設1'), '大雨のボタンでわが家の避難先を出す');
await p.waitForTimeout(800);
ok(await p.$eval('#action-panel', (n) => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2; }), '災害のボタンを押すと、説明が画面の上の方に見える');

// 共有（健康は既定で含めない）→ 別端末で読み込み → 元に戻す
await p.click('#tab-rules');
await p.evaluate(() => { navigator.share = undefined; });
await p.click('#share-link');
await p.waitForTimeout(300);
const link = await p.evaluate(() => navigator.clipboard.readText());
ok(link.includes('#share='), '共有リンクを作る');
const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } });
await route(ctx2);
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push('p2:' + e.message));
await p2.goto(BASE);
await p2.click('#tab-rules'); await p2.fill('#r-meet1', 'もとの集合場所');
await p2.goto(link);
await p2.waitForSelector('#share-banner:not([hidden])');
const prev = await p2.textContent('#share-preview');
ok(prev.includes('家の前の公園') && !prev.includes('血圧'), '読み込む前に中身を見せ、健康のことは含まない');
ok(prev.includes('作った日'), '共有リンクに作った日を出す');
ok(await p2.isHidden('#share-line-note'), 'LINEの外ではLINEの注意を出さない');
await p2.click('#share-accept');
await p2.click('#tab-rules');
ok((await p2.inputValue('#r-meet1')) === '家の前の公園', '読み込める');
await p2.click('#undo-import');
ok((await p2.inputValue('#r-meet1')) === 'もとの集合場所', '元に戻せる');
// LINEの中のブラウザで開いたとき
const ctxL = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0' });
await route(ctxL);
const pL = await ctxL.newPage();
await pL.goto(link);
await pL.waitForSelector('#share-banner:not([hidden])');
ok(await pL.isVisible('#share-line-note'), 'LINEの中で開いたら「ブラウザで開く」を案内する');
await ctxL.close();

// ファイルに保存して、別の端末で戻す
await p.click('#tab-rules');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#backup-save')]);
const backupPath = await dl.path();
ok(dl.suggestedFilename().startsWith('bousai-note-'), 'ファイルに保存する');
await p2.goto(BASE + '#rules');
p2.once('dialog', (d) => d.accept());
await p2.setInputFiles('#backup-file', backupPath);
await p2.waitForTimeout(400);
ok((await p2.inputValue('#r-health')) === '祖母は血圧の薬', 'ファイルから戻す（健康のことも戻る）');
await p2.click('#undo-import');
ok((await p2.inputValue('#r-meet1')) === 'もとの集合場所', 'ファイルから戻したあとも元に戻せる');
await p2.setInputFiles('#backup-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
await p2.waitForTimeout(300);
ok((await p2.textContent('#backup-status')).includes('読み込めません'), '違うファイルは読み込まない');
p2.once('dialog', (d) => d.accept());
await p2.click('.danger-zone summary');
await Promise.all([p2.waitForEvent('load'), p2.click('#clear-all')]);
ok(await p2.evaluate(() => localStorage.getItem('ienokoto-bousai-v1') === null || !JSON.parse(localStorage.getItem('ienokoto-bousai-v1')).rules.meet1), 'すべて消す');

await p2.goto(BASE + '#share=z.broken!!');
await p2.goto(BASE + '#share=z.AAAA');
await p2.waitForSelector('#share-error:not([hidden])');
ok(true, '壊れたリンクは理由を表示する');

// 備え
await p.click('#tab-stock');
const firstDiff = await p.textContent('#stock-body-priority tr:not(.cat-row) td:nth-child(4)');
ok(firstDiff.includes('未入力'), '未入力は「足りない」ではなく「未入力」');
await p.fill('#family-form [name=diaperAdults]', '1');
await p.fill('#family-form [name=sanitaryPeople]', '1');
const bag = await p.$$eval('.bag-item', (l) => l.map((x) => x.textContent).join('|'));
ok(bag.includes('大人用おむつ') && bag.includes('生理用品'), '持ち出し袋に大人用おむつ・生理用品が出る');
await p.fill('#stock-body-priority input[type=number] >> nth=0', '10');
ok((await p.textContent('#stock-summary')).includes('足りないもの'), '入れた品目で足りないものを数える');
await p.fill('#family-form [name=adults]', '25');
await p.press('#family-form [name=adults]', 'Tab');
ok((await p.inputValue('#family-form [name=adults]')) === '20', '範囲外の人数を直して欄に戻す');

// 文字の大きさ
await p.click('.size-btn[data-size=xl]');
await p.reload();
ok((await p.evaluate(() => document.documentElement.dataset.size)) === 'xl', '文字の大きさを保存する');
const fs = await p.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
ok(fs >= 22, `特大で本文が22px以上（${fs}px）`);
await p.click('.size-btn[data-size=m]');

// 圏外でも開く
await p.evaluate(() => navigator.serviceWorker.ready);
await p.reload();
await p.evaluate(() => navigator.serviceWorker.ready);
await ctx.setOffline(true);
await p.reload();
await p.click('#tab-evac');
ok((await p.$$('.site-name')).length === 6, '圏外でも自宅の周りの避難場所が見られる');
await ctx.setOffline(false);

// スクリーンショット
for (const tab of ['guide', 'evac', 'rules', 'stock']) {
  await p.click(`#tab-${tab}`);
  if (tab === 'guide') await p.click('.action-btn[data-action=quake]');
  await p.screenshot({ path: `${S}/v2-${tab}.png`, fullPage: true });
}
const ctxD = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
await route(ctxD);
const pd = await ctxD.newPage(); await pd.goto(BASE);
await pd.screenshot({ path: `${S}/v2-guide-dark.png`, fullPage: true });
ok(errors.length === 0, `ページのエラーなし ${JSON.stringify(errors)}`);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
if (fail) process.exitCode = 1;
await b.close();
