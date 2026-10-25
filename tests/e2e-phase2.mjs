// 段階2（自宅の危険・家族に合わせた表示・一人暮らし・0次ポーチ・家の安全対策・帰宅困難）の試験
// Playwright は、入っていればそれを使い、なければこの開発環境の場所から読む
const { chromium } = await import('playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));
const S = process.env.SHOT_DIR || '/tmp';
const BASE = 'http://localhost:8765/index.html';
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('**/*', (r) => (r.request().url().startsWith('http://localhost:8765') ? r.continue() : r.abort()));
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await p.goto(BASE);

// 自宅の危険
await p.click('#tab-evac');
ok(await p.isHidden('[data-q="depth"]'), '浸水の深さは「浸水する区域」のときだけ聞く');
await p.check('input[name=hz-flood][value=yes]');
ok(await p.isVisible('[data-q="depth"]'), '浸水する区域なら深さを聞く');
await p.check('input[name=hz-depth][value="05to3"]');
await p.check('input[name=hz-collapse][value=no]');
await p.check('input[name=hz-floors][value="1"]');
ok((await p.textContent('#hazard-result')).includes('1階しか使えない家は'), '浸水0.5〜3m・1階のみ→区域の外へ');
await p.check('input[name=hz-floors][value="2"]');
ok((await p.textContent('#hazard-result')).includes('屋内安全確保'), '浸水0.5〜3m・2階あり→とどまることも選べる');
await p.check('input[name=hz-collapse][value=yes]');
ok((await p.textContent('#hazard-result')).includes('家にとどまれません'), '家屋倒壊等氾濫想定区域→とどまれない');
await p.check('input[name=hz-landslide][value=yes]');
await p.check('input[name=hz-tsunami][value=no]');
ok((await p.textContent('#hazard-result')).includes('家にとどまる選択はできません'), '土砂災害警戒区域→必ず区域の外へ');
await p.click('#tab-guide');
await p.click('.action-btn[data-action=landslide]');
ok((await p.textContent('#action-panel')).includes('わが家の場合：土砂災害警戒区域です'), '災害ボタンに「わが家の場合」を出す');
await p.click('.action-btn[data-action=stranded]');
ok((await p.textContent('#action-panel')).includes('むやみに歩いて帰り始めない'), '「外出先で帰れない」ボタン');

// 家族に合わせた表示
await p.click('#tab-rules');
ok(await p.isHidden('fieldset[data-show=care]') && await p.isHidden('fieldset[data-show=pet]'), '該当しない家族向けの欄は隠す');
await p.click('#tab-stock');
await p.fill('#family-form [name=elderly]', '1');
ok((await p.textContent('#care-guides')).includes('65歳以上の家族') && !(await p.textContent('#care-guides')).includes('介護が必要'), '65歳以上だけなら介護の話は出さない');
await p.fill('#family-form [name=careNeeded]', '1');
await p.fill('#family-form [name=disability]', '1');
await p.fill('#family-form [name=children]', '1');
await p.fill('#family-form [name=dogs]', '1');
await p.fill('#family-form [name=medDevice]', '1');
const guides = await p.textContent('#care-guides');
ok(guides.includes('介護が必要な家族') && guides.includes('医療機器') && guides.includes('ペットがいる'), '家族に合わせた準備を出す');
ok(guides.includes('障害のある家族') && guides.includes('web171') && guides.includes('子どもがいる'), '障害のある家族・子ども向けの準備を出す');
ok(guides.includes('同伴避難'), 'ペット：同行避難と同伴避難の違い');
const bag = await p.textContent('#bag-list');
ok(bag.includes('ヘルメット') && bag.includes('介護用品'), '持ち出し袋にヘルメット・介護用品');
ok(bag.includes('防犯ブザー') && bag.includes('子どもの名前') && bag.includes('耳が聞こえません'), '持ち出し袋に防犯ブザー・子どものカード・伝えるカード');
ok((await p.textContent('#home-list')).includes('溺れる事故'), '子どもがいる家に風呂の水の注意');
await p.click('#tab-rules');
ok(await p.isVisible('fieldset[data-show=care]') && await p.isVisible('fieldset[data-show=med]') && await p.isVisible('fieldset[data-show=pet]'), '介護・医療機器・ペットの欄が出る');
ok(await p.isVisible('#r-pickupBackup'), '子どもがいる家に迎えの代わりの人の欄');
await p.fill('#r-careFacility', '〇〇デイサービス 026-111-1111');
await p.fill('#r-startSignal', 'レベル3で祖母を連れて出る');
await p.click('#tab-guide');
const quick = await p.textContent('#my-rules-quick');
ok(quick.includes('レベル3で祖母を連れて出る') && quick.includes('〇〇デイサービス'), 'いざという時に合図・施設を出す');

// 段階4-2：新しい災害のボタン、自宅の危険の追加の質問
for (const id of ['volcano', 'snow', 'storm']) {
  await p.click(`.action-btn[data-action=${id}]`);
  ok((await p.textContent('#action-panel')).includes('すぐにやること'), `${id} のボタンで説明を出す`);
}
ok((await p.textContent('#action-panel')).length > 0 && (await p.evaluate(() => ACTIONS.find((a) => a.id === 'volcano').more.join(''))).includes('噴火警戒レベル'), '火山：噴火警戒レベルは別のもの');
await p.click('#tab-evac');
await p.check('input[name=hz-landslide][value=yes]');
ok(await p.isVisible('[data-q=landslideRed]'), '土砂の区域なら特別警戒区域を聞く');
await p.check('input[name=hz-landslideRed][value=yes]');
ok((await p.textContent('#hazard-result')).includes('レッドゾーン'), '特別警戒区域の目安');
await p.check('input[name=hz-flood][value=yes]');
await p.check('input[name=hz-depth][value="05to3"]');
await p.check('input[name=hz-collapse][value=no]');
await p.check('input[name=hz-floors][value="2"]');
await p.check('input[name=hz-duration][value=long]');
ok((await p.textContent('#hazard-result')).includes('3日以上'), '浸水が続く時間で目安を変える');

// 位置情報が許可されていないときは、理由と直し方を出す
{
  const ctxN = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: [] });
  await ctxN.route('**/*', (r) => (r.request().url().startsWith('http://localhost') ? r.continue() : r.abort()));
  const pN = await ctxN.newPage();
  await pN.goto(BASE + '#evac');
  await pN.click('#use-geo');
  await pN.waitForFunction(() => document.querySelector('#evac-status').classList.contains('error'));
  ok((await pN.textContent('#evac-status')).includes('許可'), '位置情報が許可されていないときは、許可の仕方を案内する');
  await ctxN.close();
}

// 一人暮らし
await p.click('#tab-stock');
await p.selectOption('#solo-select', 'solo');
const f = await p.evaluate(() => JSON.parse(localStorage.getItem('ienokoto-bousai-v1')).family);
ok(f.adults + f.elderly + f.children + f.infants === 1, `一人暮らしにすると人数を1人に（大人${f.adults}・高齢者${f.elderly}）`);
ok((await p.textContent('#care-guides')).includes('一人暮らし'), '一人暮らし向けの準備を出す');
await p.click('#tab-rules');
ok(await p.isVisible('fieldset[data-show=solo]') && await p.isHidden('fieldset[data-hide=solo]'), '一人暮らしは実家への連絡欄を出し、役割分担を隠す');

// 0次ポーチ・家の安全対策・備蓄の追加品目
await p.click('#tab-stock');
await p.check('#pouch-list input >> nth=0');
await p.check('#home-list input >> nth=0');
ok((await p.textContent('#pouch-progress')).includes('1項目を入れました'), '0次ポーチのチェック');
ok((await p.textContent('#home-progress')).includes('1項目を済ませました'), '家の安全対策のチェック');
await p.click('.more-stock summary');
ok((await p.textContent('#stock-body-other')).includes('口の中を清潔にする物'), '備蓄に口腔ケア用品');
await p.reload();
await p.click('#tab-stock');
ok(await p.isChecked('#home-list input >> nth=0'), '家の安全対策の保存');
await p.click('#tab-guide');
const prog = await p.textContent('#progress-list');
ok(prog.includes('自宅の危険を確かめる') && prog.includes('家の安全対策（1/'), '準備の進み具合に新しい項目');

// 段階4-1：人数の −・＋、印刷用の家族カード、例文は入力欄の外
await p.click('#tab-stock');
const before = Number(await p.inputValue('#family-form [name=dogs]'));
await p.click('#family-form [aria-label="犬を1増やす"]');
ok(Number(await p.inputValue('#family-form [name=dogs]')) === before + 1, '＋ボタンで人数を増やす');
ok((await p.textContent('#bag-list')).includes('ペット用品'), '＋ボタンの変更が持ち出し袋に反映される');
await p.click('#tab-rules');
ok(await p.$eval('#r-meet1', (n) => !n.placeholder) && (await p.textContent('#r-meet1-ex')).startsWith('例：'), '例文は入力欄の外に出す');
await p.evaluate(() => buildPrintCard());
const card = await p.textContent('#print-card');
ok(card.includes('わが家の防災カード') && card.includes('171'), '印刷用の家族カードを作る');
ok(!card.includes('例：'), '印刷に例文を出さない');

// 追加：健康のことを人ごとに、ふりがな、災害ボタンの絵、警戒レベルの要点
await p.click('#tab-rules');
await p.click('#person-add');
await p.fill('#person-0-name', '祖母');
await p.fill('#person-0-meds', '〇〇錠 5mg 朝1錠');
await p.click('#tab-guide');
ok((await p.textContent('#my-rules-quick')).includes('祖母：薬の名前と量 〇〇錠'), '健康のことを人ごとに書いて、いざという時に出す');
await p.reload();
await p.click('#tab-rules');
ok((await p.inputValue('#person-0-meds')) === '〇〇錠 5mg 朝1錠', '人ごとの健康のことを保存する');
await p.click('#share-health');
await p.evaluate(() => buildPrintCard());
ok((await p.textContent('#print-card')).includes('祖母'), '含めると選んだら、印刷にも人ごとの健康のことを出す');
await p.click('#share-health');
await p.click('#tab-guide');
ok(await p.$$eval('.action-btn svg.action-icon', (l) => l.length) === 10, '災害のボタンに絵');
ok(await p.isVisible('.level-summary') && !(await p.$eval('.levels-more', (d) => d.open)), '警戒レベルは要点を見せ、詳しくは折りたたむ');
await p.click('#ruby-btn');
ok(await p.$$eval('ruby.auto-ruby', (l) => l.length) > 20 && (await p.textContent('#action-title')).includes('さいがい'), 'ふりがなを付ける');
await p.click('.action-btn[data-action=tsunami]');
ok(await p.$$eval('#action-panel ruby', (l) => l.length) > 0, 'あとから出した説明にもふりがな');
await p.reload();
ok(await p.$$eval('ruby.auto-ruby', (l) => l.length) > 20, 'ふりがなの設定を保存する');
await p.click('#ruby-btn');
ok(await p.$$eval('ruby.auto-ruby', (l) => l.length) === 0 && (await p.textContent('#action-title')) === 'いま起きている災害は？', 'ふりがなを外す');

for (const tab of ['evac', 'rules', 'stock']) {
  await p.click(`#tab-${tab}`);
  await p.screenshot({ path: `${S}/p2-${tab}.png`, fullPage: true });
}
ok(errors.length === 0, `ページのエラーなし ${JSON.stringify(errors)}`);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
if (fail) process.exitCode = 1;
await b.close();
