// 自宅の危険を自動で調べる（ハザードマップポータルサイトの地図画像の色を読む）の試験
// 外部通信はこの環境では遮断されているため、地図画像は試験用に作った単色のPNG（実データではない）
const { chromium } = await import('playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));
import zlib from 'node:zlib';

const BASE = 'http://localhost:8765/index.html';
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };

// 256×256 の単色PNGを作る
function crc32(buf) {
  let c = ~0;
  for (const x of buf) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png([r, g, bl]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA
  const row = Buffer.alloc(1 + 256 * 4);
  for (let i = 0; i < 256; i++) row.set([r, g, bl, 255], 1 + i * 4);
  const raw = Buffer.concat(Array(256).fill(row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function run(tiles) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith('http://localhost:8765')) return r.continue();
    if (u.includes('msearch.gsi.go.jp')) return r.fulfill({ json: [{ geometry: { coordinates: [138.31, 36.65] }, properties: { title: 'テスト住所' } }] });
    if (u.includes('disaportaldata.gsi.go.jp')) {
      const layer = Object.keys(tiles).find((k) => u.includes(`/${k}/17/`));
      if (tiles === 'down') return r.abort();
      if (!layer) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ status: 200, contentType: 'image/png', body: png(tiles[layer]), headers: { 'access-control-allow-origin': '*' } });
    }
    return r.abort();
  });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE + '#evac');
  await p.fill('#addr', '須坂市');
  await p.click('#auto-hazard');
  await p.waitForFunction(() => !document.querySelector('#auto-hazard').disabled && document.querySelector('#auto-hazard-result').textContent.length > 10);
  const result = await p.textContent('#auto-hazard-result');
  const hazard = await p.evaluate(() => JSON.parse(localStorage.getItem('ienokoto-bousai-v1') || '{}').hazard || {});
  const advice = await p.textContent('#hazard-result');
  await ctx.close();
  return { result, hazard, advice, errors };
}

// 洪水 0.5〜3m・土砂の特別警戒区域（赤）
const a = await run({ '01_flood_l2_shinsuishin_data': [255, 216, 192], '05_dosekiryukeikaikuiki': [230, 30, 30] });
ok(a.hazard.flood === 'yes' && a.hazard.depth === '05to3', `洪水の区域と深さを選ぶ（${a.hazard.flood}・${a.hazard.depth}）`);
ok(a.hazard.landslide === 'yes' && a.hazard.landslideRed === 'yes', '土砂災害警戒区域と特別警戒区域を選ぶ');
ok(a.result.includes('0.5〜3m') && a.result.includes('レッドゾーン'), '結果に深さと特別警戒区域を出す');
ok(!a.hazard.tsunami && !a.hazard.collapse, '見つからなかった項目は「入っていない」にせず空けておく');
ok(a.result.includes('津波：見つかりませんでした'), '見つからなかった項目は「見つかりませんでした」と出す');
ok(a.advice.includes('レッドゾーン'), '自動で選んだ結果から、わが家の避難の目安を出す');
ok(a.errors.length === 0, `ページのエラーなし ${JSON.stringify(a.errors)}`);

// 凡例と合わない色：区域は選ぶが、深さは選ばない
const c = await run({ '01_flood_l2_shinsuishin_data': [10, 200, 10] });
ok(c.hazard.flood === 'yes' && !c.hazard.depth && c.result.includes('深さはハザードマップで'), '凡例と合わない色は、深さを選ばない');

// 通信できないとき
const d = await run('down');
ok(d.result.includes('読み込めませんでした') && !d.hazard.flood, '地図データを読めないときは、何も選ばずに案内を出す');

console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
if (fail) process.exitCode = 1;
await b.close();
