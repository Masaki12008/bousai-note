// わが家の防災ノート
// サーバーを持たない静的アプリ。保存は端末の localStorage、共有はURLの # 以降にデータを入れる。

const STORAGE_KEY = 'ienokoto-bousai-v1';
const BACKUP_KEY = 'ienokoto-bousai-backup';
const STATE_VERSION = 2;
// 確認用ページ（外部通信・位置情報・印刷が使えない環境）では、使えない機能を隠す
const PREVIEW = window.BOUSAI_MODE === 'preview';
const GSI_GEOCODE = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=';
const GSI_TILE = (layer, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/${layer}/10/${x}/${y}.geojson`;
// サイトの一番上のフォルダへの相対パス（機能ごとのページでは '../'）
const ROOT = document.body.dataset.root || './';
const CONFIG = window.SITE_CONFIG || {};
const LEAFLET_JS = `${ROOT}vendor/leaflet/leaflet.js`;
const LEAFLET_CSS = `${ROOT}vendor/leaflet/leaflet.css`;
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Zen+Maru+Gothic:wght@700&display=swap';
const TILE_ZOOM = 10;
const NEAREST_COUNT = 3;
// これより遠い場所は「近くの避難場所」として出さない（内陸で海沿いの津波・高潮の避難場所が出ないように）
const MAX_KM = 10;
// 海の災害。近くにデータがないときは、内陸向けの説明を出す
const COASTAL_TYPES = ['tsunami', 'stormSurge'];
const EXPIRY_WARN_DAYS = 30;
const SHARE_URL_LIMIT = 6000;
const TABS = ['guide', 'evac', 'rules', 'stock'];
const TEXT_SIZES = ['m', 'l', 'xl'];

const DEFAULT_FAMILY = {
  adults: 2, elderly: 0, children: 0, infants: 0, dogs: 0, cats: 0,
  medsPeople: 0, diaperAdults: 0, careNeeded: 0, disability: 0, sanitaryPeople: 0, medDevice: 0, days: 7,
};
const RULE_FIELDS = ['meet1', 'evacWater', 'evacLandslide', 'evacQuake', 'evacTsunami', 'familyContact', 'startSignal', 'startWho', 'startWhere',
  'meetTime', 'daytime', 'pickupBackup', 'contacts', 'dengonNumber', 'relay', 'contactOrder', 'careFacility', 'careManager', 'careSupport',
  'careRegistry', 'medPlan', 'medBattery', 'medDest', 'petPlan', 'rolePickup', 'roleBag', 'roleHome', 'roleFarm', 'health', 'memo'];
// 健康のことは人ごとに書く（お薬手帳がなくても薬が分かるように）
const PEOPLE_FIELDS = [['name', '名前・続柄'], ['cond', '持病'], ['meds', '薬の名前と量'], ['allergy', 'アレルギー'], ['doctor', 'かかりつけ医']];
const PEOPLE_MAX = 10;
const PRIVATE_RULE_FIELDS = ['health', 'careRegistry', 'medPlan', 'medBattery', 'medDest', 'memo'];

const RULE_LABELS = {
  meet1: '家の近くの集合場所',
  evacWater: '避難先（洪水）',
  evacLandslide: '避難先（土砂災害）',
  evacQuake: '避難先（地震・火事）',
  evacTsunami: '避難先（津波・高潮）',
  familyContact: '離れて住む家族への連絡',
  startSignal: '動き始める合図',
  startWho: '誰が・誰と動くか',
  startWhere: 'どこへ行くか',
  meetTime: '連絡がつかないときの待ち合わせ',
  daytime: '昼間の居場所の決まり',
  pickupBackup: '迎えに行けないときに頼む人',
  contacts: 'かかりつけ医・学校・職場',
  careFacility: 'デイサービス・施設',
  careManager: 'ケアマネジャーなど',
  careSupport: '手助けしてくれる人',
  careRegistry: '要支援者名簿・個別避難計画',
  medPlan: '医療機器（停電時の電源・連絡先）',
  medBattery: 'バッテリー・酸素ボンベが持つ時間',
  medDest: '停電したときに行く先',
  petPlan: 'ペット',
  dengonNumber: '171・web171で使う番号',
  relay: '中継をお願いする人',
  contactOrder: '連絡の順番',
  rolePickup: '迎えの担当',
  roleBag: '持ち出し袋・ペット',
  roleHome: '家を出るときにすること',
  roleFarm: '田畑・家畜・車・店など',
  health: '健康のこと',
  memo: 'メモ',
};
// 「いざという時」に出す項目。QUICK_TOP はいつも見せ、残りは「すべて見る」で開く
const QUICK_TOP = ['meet1', 'evacWater', 'evacLandslide', 'evacQuake', 'evacTsunami', 'dengonNumber'];
const QUICK_FIELDS = [...QUICK_TOP, 'startSignal', 'meetTime', 'relay',
  'familyContact', 'rolePickup', 'pickupBackup', 'careFacility', 'medPlan', 'medBattery', 'medDest', 'health'];

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

// ---------- 保存 ----------

function readStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null; // 保存領域が使えない環境（プライベートモード等）でも動くようにする
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function normalizeFamily(src) {
  const family = { ...DEFAULT_FAMILY };
  for (const key of Object.keys(DEFAULT_FAMILY)) {
    const n = Number(src?.[key]);
    if (src?.[key] !== '' && Number.isFinite(n) && n >= 0) family[key] = Math.min(Math.floor(n), 20);
  }
  if (family.days !== 3 && family.days !== 7) family.days = 7;
  return family;
}

function normalizeRules(src) {
  const rules = {};
  for (const key of RULE_FIELDS) rules[key] = typeof src?.[key] === 'string' ? src[key].slice(0, 2000) : '';
  // 以前は「大雨・洪水・土砂災害」で1つの欄だった。土砂災害の欄がない古い保存・共有リンクは、同じ避難先を引き継ぐ
  if (typeof src?.evacLandslide !== 'string' && rules.evacWater) rules.evacLandslide = rules.evacWater;
  return rules;
}

function normalizePeople(src) {
  return (Array.isArray(src) ? src : []).slice(0, PEOPLE_MAX)
    .map((p) => Object.fromEntries(PEOPLE_FIELDS.map(([k]) => [k, typeof p?.[k] === 'string' ? p[k].slice(0, 300) : ''])));
}

function peopleLines(people) {
  return people
    .filter((p) => PEOPLE_FIELDS.some(([k]) => p[k].trim()))
    .map((p) => `${p.name.trim() || '（名前なし）'}：${PEOPLE_FIELDS.slice(1).filter(([k]) => p[k].trim()).map(([k, label]) => `${label} ${p[k].trim()}`).join('／')}`);
}

function normalizeState(s, version) {
  const rules = normalizeRules(s.rules);
  // 第1版の「避難場所（1つだけ）」は、災害の種類が分からないためメモに移す
  if (typeof s.rules?.meet2 === 'string' && s.rules.meet2.trim()) {
    rules.memo = `以前の「避難場所」の記入：${s.rules.meet2.trim()}${rules.memo ? `\n${rules.memo}` : ''}`.slice(0, 2000);
  }

  const stock = {};
  for (const item of STOCK_RULES) {
    const v = s.stock?.[item.id];
    let have = v?.have === null || v?.have === '' || v?.have === undefined ? null : Number(v.have);
    if (!Number.isFinite(have) || have < 0) have = null;
    // 第1版は未入力も0で保存していたので、0は未入力として扱う
    if (version < STATE_VERSION && have === 0) have = null;
    const exp = typeof v?.expiry === 'string' ? v.expiry.slice(0, 7) : '';
    stock[item.id] = { have, expiry: /^\d{4}-\d{2}$/.test(exp) ? exp : '' };
  }

  const checks = (items, src) => Object.fromEntries(items.map((item) => [item.id, src?.[item.id] === true]));
  const hazard = {};
  for (const q of HAZARD_QUESTIONS) {
    const v = s.hazard?.[q.id];
    hazard[q.id] = q.options.some(([value]) => value === v) ? v : '';
  }

  return {
    v: STATE_VERSION,
    family: normalizeFamily(s.family),
    rules,
    people: normalizePeople(s.people),
    stock,
    bag: checks(BAG_ITEMS, s.bag),
    pouch: checks(POUCH_ITEMS, s.pouch),
    home: checks(HOME_CHECKS, s.home),
    hazard,
    solo: s.solo === true,
    homeEvac: normalizeEvac(s.homeEvac ?? s.lastEvac),
    textSize: TEXT_SIZES.includes(s.textSize) ? s.textSize : 'm',
    ruby: s.ruby === true,
    installDismissed: s.installDismissed === true,
  };
}

// 避難場所の結果は、保存するときも読み込むときも { origin, at, results: [{ typeId, sites, failed }] } の形にそろえる
function normalizeEvac(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.results)) return null;
  const num = (n) => (n === null || n === '' || !Number.isFinite(Number(n)) ? null : Number(n));
  const origin = { lat: num(v.origin?.lat), lon: num(v.origin?.lon), label: String(v.origin?.label ?? '') };
  if (origin.lat === null || origin.lon === null) return null;
  const results = DISASTER_TYPES.map((type) => {
    const r = v.results.find((x) => (x?.typeId ?? x?.type?.id) === type.id);
    const sites = (Array.isArray(r?.sites) ? r.sites : []).slice(0, NEAREST_COUNT)
      .map((x) => ({ name: String(x?.name ?? ''), address: String(x?.address ?? ''), lat: num(x?.lat), lon: num(x?.lon), km: num(x?.km) }))
      .filter((x) => x.lat !== null && x.lon !== null && x.km !== null && x.km <= MAX_KM);
    return { typeId: type.id, sites, failed: r?.failed === true };
  });
  return { origin, results, at: typeof v.at === 'string' ? v.at : '' };
}

function loadState() {
  const saved = readStorage(STORAGE_KEY) ?? {};
  return normalizeState(saved, Number(saved.v) || 1);
}

let state = loadState();
let persistAsked = false;

function saveState() {
  const ok = writeStorage(STORAGE_KEY, state);
  // ふだん開かないアプリでも、ブラウザに消されにくくする
  if (ok && !persistAsked && navigator.storage?.persist) {
    persistAsked = true;
    navigator.storage.persist().catch(() => {});
  }
  return ok;
}

function showSaved(target) {
  const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  target.textContent = `この端末に保存しました（${time}）`;
}

function setStatus(node, text, isError = false) {
  node.textContent = text;
  node.classList.toggle('error', isError);
}

// ---------- タブ ----------

function currentTab() {
  const name = location.hash.slice(1);
  if (TABS.includes(name)) return name;
  return TABS.includes(document.body.dataset.defaultTab) ? document.body.dataset.defaultTab : 'guide';
}

function showTab(name, { focus = false } = {}) {
  for (const tab of document.querySelectorAll('.tab')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== `panel-${name}`;
  if (name === 'evac' && evacMap) evacMap.invalidateSize();
}

function goTab(name, { focus = false } = {}) {
  if (location.hash !== `#${name}`) history.pushState(null, '', `#${name}`);
  showTab(name, { focus });
  window.scrollTo(0, 0);
}

function onTabKey(e) {
  const idx = TABS.indexOf(e.currentTarget.dataset.tab);
  let next = null;
  if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
  if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
  if (e.key === 'Home') next = 0;
  if (e.key === 'End') next = TABS.length - 1;
  if (next === null) return;
  e.preventDefault();
  goTab(TABS[next], { focus: true });
}

// ---------- 文字の大きさ ----------

let sizeStatusTimer = null;

function applyTextSize() {
  document.documentElement.dataset.size = state.textSize;
  for (const btn of document.querySelectorAll('.size-btn')) btn.setAttribute('aria-pressed', String(btn.dataset.size === state.textSize));
}

// ---------- ふりがな ----------

// 画面の言葉にふりがなを付ける（日本語を学んでいる人・子ども向け）。長い言葉から先に当てはめる
const RUBY = {
  '指定緊急避難場所': 'していきんきゅうひなんばしょ', '指定避難所': 'していひなんじょ', '避難所': 'ひなんじょ', '避難': 'ひなん',
  '緊急': 'きんきゅう', '警戒': 'けいかい', '災害': 'さいがい', '地震': 'じしん', '津波': 'つなみ', '大雨': 'おおあめ',
  '洪水': 'こうずい', '土砂': 'どしゃ', '氾濫': 'はんらん', '浸水': 'しんすい', '高潮': 'たかしお', '火事': 'かじ',
  '停電': 'ていでん', '断水': 'だんすい', '噴火': 'ふんか', '火山': 'かざん', '大雪': 'おおゆき', '竜巻': 'たつまき',
  '雷': 'かみなり', '外出先': 'がいしゅつさき', '被災': 'ひさい', '帰宅': 'きたく', '備蓄': 'びちく', '備え': 'そなえ',
  '決め事': 'きめごと', '集合場所': 'しゅうごうばしょ', '伝言': 'でんごん', '安否': 'あんぴ', '連絡': 'れんらく',
  '危険': 'きけん', '区域': 'くいき', '確保': 'かくほ', '家族': 'かぞく', '高齢者': 'こうれいしゃ', '障害': 'しょうがい',
  '介護': 'かいご', '乳児': 'にゅうじ', '持病': 'じびょう', '薬': 'くすり', '携帯': 'けいたい', '耐震': 'たいしん',
  '診断': 'しんだん', '熱中症': 'ねっちゅうしょう', '一酸化炭素': 'いっさんかたんそ', '中毒': 'ちゅうどく',
  '揺': 'ゆ', '頭': 'あたま', '守': 'まも', '逃': 'に', '迎': 'むか', '戻': 'もど', '靴': 'くつ',
  '市区町村': 'しくちょうそん', '気象庁': 'きしょうちょう', '情報': 'じょうほう', '自宅': 'じたく',
};
const RUBY_RE = new RegExp(Object.keys(RUBY).sort((a, b) => b.length - a.length).join('|'), 'g');
const RUBY_TEST = new RegExp(RUBY_RE.source); // test() 用（g を付けると前回の位置を覚えてしまう）
const RUBY_SKIP = 'script, style, textarea, input, select, option, ruby, svg, title, .print-card';
let rubyObserver = null;

function addRuby(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (!n.parentElement || n.parentElement.closest(RUBY_SKIP) || !RUBY_TEST.test(n.data)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of node.data.matchAll(RUBY_RE)) {
      frag.append(node.data.slice(last, m.index));
      frag.append(el('ruby', { className: 'auto-ruby' }, m[0], el('rt', { textContent: RUBY[m[0]] })));
      last = m.index + m[0].length;
    }
    frag.append(node.data.slice(last));
    node.replaceWith(frag);
  }
}

function removeRuby() {
  for (const r of document.querySelectorAll('ruby.auto-ruby')) r.replaceWith(r.firstChild.data);
  document.body.normalize();
}

function applyRuby() {
  $('#ruby-btn').setAttribute('aria-pressed', String(state.ruby));
  rubyObserver?.disconnect();
  if (!state.ruby) {
    removeRuby();
    return;
  }
  addRuby(document.body);
  rubyObserver = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) addRuby(n.nodeType === Node.TEXT_NODE ? n.parentNode : n);
    }
  });
  rubyObserver.observe(document.body, { childList: true, subtree: true });
}

// ---------- いざという時 ----------

// 電話番号らしい部分をタップで発信できるリンクにし、途中で改行させない
const PHONE_RE = /(0\d{1,4}-\d{1,4}-\d{3,4}|0\d{9,10}|#\d{4})/g;

function linkifyPhones(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(PHONE_RE)) {
    frag.append(text.slice(last, m.index));
    frag.append(el('a', { href: `tel:${m[0].replace(/-/g, '').replace('#', '%23')}`, className: 'tel', textContent: m[0] }));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function quickRuleItem(key, value) {
  const dd = el('dd', {}, linkifyPhones(value));
  if (key === 'dengonNumber') {
    dd.append(el('span', { className: 'fine dengon-action', textContent: '伝言を残す：171 → 1 → この番号　聞く：171 → 2 → この番号' }));
  }
  return el('div', {}, el('dt', { textContent: RULE_LABELS[key] }), dd);
}

function renderQuickRules() {
  const filled = QUICK_FIELDS.filter((key) => state.rules[key].trim());
  const top = filled.filter((key) => QUICK_TOP.includes(key));
  const rest = filled.filter((key) => !QUICK_TOP.includes(key));
  $('#my-rules-list').replaceChildren(...top.map((key) => quickRuleItem(key, state.rules[key].trim())));
  $('#my-rules-rest').replaceChildren(...rest.map((key) => quickRuleItem(key, state.rules[key].trim())));
  const health = peopleLines(state.people);
  if (health.length) $('#my-rules-rest').append(el('div', {}, el('dt', { textContent: '健康のこと（人ごと）' }), el('dd', { textContent: health.join('\n') })));
  const restCount = rest.length + (health.length ? 1 : 0);
  $('#my-rules-list').hidden = top.length === 0;
  $('#my-rules-more').hidden = restCount === 0;
  $('#my-rules-more').querySelector('summary').textContent = top.length ? `ほかの決め事を見る（${restCount}項目）` : `決め事を見る（${restCount}項目）`;
  const hasRules = filled.length > 0 || health.length > 0;
  $('#my-rules-quick').hidden = !hasRules;
  $('#my-rules-empty').hidden = hasRules;
}

// 災害のボタンの絵（24×24の線画）。中身は下の固定の文字列だけで、入力した内容は入らない
const ACTION_ICONS = {
  quake: '<path d="M4 11 L12 4 L20 11 V20 H4 Z"/><path d="M9 20 V14 H15 V20"/><path d="M1 8 L2.5 10 L1 12"/><path d="M23 8 L21.5 10 L23 12"/>',
  tsunami: '<path d="M2 17 C5 17 6 9 11 9 C14 9 15 12 13 13 C17 13 18 8 22 8"/><path d="M2 21 C5 19 8 21 11 19 C14 21 17 19 22 21"/>',
  rain: '<path d="M6 13 A4 4 0 0 1 7 5 A5 5 0 0 1 17 6 A3.5 3.5 0 0 1 18 13 Z"/><path d="M8 16 L7 19"/><path d="M12 16 L11 19"/><path d="M16 16 L15 19"/>',
  landslide: '<path d="M2 20 L10 6 L22 20 Z"/><circle cx="15" cy="16" r="1.5"/><circle cx="18" cy="18.5" r="1"/><path d="M11 10 L13 13"/>',
  fire: '<path d="M12 3 C14 7 18 9 18 14 A6 6 0 0 1 6 14 C6 11 8 10 9 7 C10 9 11 9 12 3 Z"/><path d="M12 13 C13 15 14 16 14 17.5 A2 2 0 0 1 10 17.5 C10 16 11 15 12 13 Z"/>',
  outage: '<path d="M9 18 H15"/><path d="M10 21 H14"/><path d="M8.5 15 C6 13 5.5 10.5 6.5 8 A6 6 0 0 1 17.5 8 C18.5 10.5 18 13 15.5 15 Z"/><path d="M4 4 L20 20"/>',
  volcano: '<path d="M2 21 L8.5 9 H15.5 L22 21 Z"/><path d="M10 6 L9 3"/><path d="M12 6 V2"/><path d="M14 6 L15 3"/>',
  snow: '<path d="M12 2 V22"/><path d="M3.3 7 L20.7 17"/><path d="M3.3 17 L20.7 7"/><path d="M9.5 3.5 L12 6 L14.5 3.5"/><path d="M9.5 20.5 L12 18 L14.5 20.5"/>',
  storm: '<path d="M3 5 H21"/><path d="M5 9 H18"/><path d="M8 13 H15"/><path d="M10 17 H13"/><path d="M11 21 H12"/>',
  stranded: '<circle cx="13" cy="4" r="2"/><path d="M10 22 L12 15 L15 17 V22"/><path d="M12 15 L13 9 L17 12"/><path d="M13 9 L9 11 L8 14"/>',
};

function actionIcon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'action-icon');
  svg.innerHTML = ACTION_ICONS[id] || '';
  return svg;
}

let openAction = null;

function renderActionButtons() {
  const box = $('#action-buttons');
  box.replaceChildren(...ACTIONS.map((a) => {
    const btn = el('button', { type: 'button', className: 'action-btn' }, actionIcon(a.id), el('span', { textContent: a.button || a.label }));
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'action-panel');
    btn.dataset.action = a.id;
    btn.addEventListener('click', () => toggleAction(a.id));
    return btn;
  }));
}

function toggleAction(id) {
  openAction = openAction === id ? null : id;
  for (const btn of document.querySelectorAll('.action-btn')) btn.setAttribute('aria-expanded', String(btn.dataset.action === openAction));
  renderActionPanel();
  if (!openAction) return;
  // 説明はボタンの下に出るので、画面の外に出ないよう説明の先頭まで動かす
  const panel = $('#action-panel');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  panel.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  panel.focus({ preventScroll: true });
}

function renderActionPanel() {
  const panel = $('#action-panel');
  const a = ACTIONS.find((x) => x.id === openAction);
  if (!a) {
    panel.hidden = true;
    return;
  }
  panel.replaceChildren(
    el('h3', {}, actionIcon(a.id), `${a.label}：すぐにやること`),
    el('ol', {}, ...a.now.map((t) => el('li', { textContent: t }))),
  );
  const note = hazardAdvice()[{ rain: 'flood', landslide: 'landslide', tsunami: 'tsunami' }[a.id]];
  if (note) panel.append(el('p', { className: 'hazard-note', textContent: `わが家の場合：${note}` }));
  const group = EVAC_GROUPS.find((g) => g.id === a.group);
  if (group) {
    const dest = state.rules[group.field].trim();
    const box = el('div', { className: 'my-evac' });
    box.append(el('p', {}, el('strong', { textContent: `わが家の避難先（${group.label}）：` }), dest || 'まだ決めていません'));
    if (!dest) box.append(el('p', {}, el('a', { href: '#rules', textContent: '決め事で避難先を決める' })));
    if (state.rules.meet1.trim()) box.append(el('p', { textContent: `家の近くの集合場所：${state.rules.meet1.trim()}` }));
    panel.append(box);
  }
  if (a.more.length) {
    const more = el('details', { className: 'more' }, el('summary', { textContent: 'あわせて知っておくこと' }));
    more.append(el('div', { className: 'detail-body' }, el('ul', {}, ...a.more.map((t) => el('li', { textContent: t })))));
    panel.append(more);
  }
  const back = el('button', { type: 'button', className: 'btn small back-to-actions', textContent: 'ほかの災害を選ぶ' });
  back.addEventListener('click', () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    $('#action-title').scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    document.querySelector(`.action-btn[data-action="${a.id}"]`)?.focus({ preventScroll: true });
  });
  panel.append(back);
  panel.hidden = false;
}

function renderProgress() {
  const hasHome = !!state.homeEvac;
  const hasRules = ['meet1', 'evacWater', 'evacLandslide', 'evacQuake', 'dengonNumber'].some((k) => state.rules[k].trim());
  const entered = STOCK_RULES.filter((item) => item.need(state.family) > 0 && state.stock[item.id].have !== null).length;
  const bagItems = bagItemsFor(state.family);
  const bagDone = bagItems.filter((item) => state.bag[item.id]).length;
  const hazardDone = ['flood', 'landslide', 'tsunami'].every((k) => state.hazard[k]);
  const homeDone = HOME_CHECKS.filter((c) => state.home[c.id]).length;
  const steps = [
    { done: hazardDone, text: '自宅の危険を確かめる', tab: 'evac' },
    { done: hasHome, text: '自宅の周りの避難場所を調べる', tab: 'evac' },
    { done: hasRules, text: '家族の決め事を作る', tab: 'rules' },
    { done: entered > 0, text: '備蓄の今ある量を入れる', tab: 'stock' },
    { done: bagDone > 0, text: `持ち出し袋をそろえる（${bagDone}/${bagItems.length}）`, tab: 'stock' },
    { done: homeDone > 0, text: `家の安全対策（${homeDone}/${HOME_CHECKS.length}）`, tab: 'stock' },
  ];
  $('#progress-list').replaceChildren(...steps.map((s) => el('li', { className: s.done ? 'done' : 'todo' },
    el('span', { className: 'mark', textContent: s.done ? '済み' : 'まだ' }),
    el('a', { href: `#${s.tab}`, textContent: s.text }))));
}

// ---------- 避難場所 ----------

let evacMap = null;
let evacLayer = null;
let leafletLoading = null;
let shownEvac = null; // いま画面に出している結果（自宅 or 現在地）

async function geocode(address) {
  const res = await fetch(GSI_GEOCODE + encodeURIComponent(address));
  if (!res.ok) throw new Error('geocode');
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('geocode');
  const hit = list.find((x) => Array.isArray(x?.geometry?.coordinates) && x.geometry.coordinates.length >= 2);
  if (!hit) return null;
  const [lon, lat] = hit.geometry.coordinates.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: String(hit.properties?.title || address) };
}

function tileOf(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}

function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 中心のタイルと周囲8枚を読む。1枚も読めなかったときは「取得失敗」として、「避難場所なし」と区別する。
// （データがない区域のタイルは404になるため、一部の失敗は「データなし」として扱う）
async function fetchSites(layer, origin) {
  const { x, y } = tileOf(origin.lat, origin.lon, TILE_ZOOM);
  const requests = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      requests.push(
        fetch(GSI_TILE(layer, x + dx, y + dy))
          .then(async (r) => {
            if (r.status === 404) return { ok: true, features: [] };
            if (!r.ok) return { ok: false };
            const geo = await r.json();
            return { ok: true, features: Array.isArray(geo?.features) ? geo.features : [] };
          })
          .catch(() => ({ ok: false })),
      );
    }
  }
  const tiles = await Promise.all(requests);
  if (!tiles.some((t) => t.ok)) return { sites: [], failed: true };

  const seen = new Set();
  const sites = [];
  for (const tile of tiles) {
    for (const f of tile.features || []) {
      if (f?.geometry?.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) continue;
      const [lon, lat] = f.geometry.coordinates.map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const p = f.properties || {};
      const name = String(p.name ?? p['施設・場所名'] ?? '名称不明');
      const address = String(p.address ?? p['住所'] ?? '');
      const key = `${name}|${lat}|${lon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sites.push({ name, address, lat, lon, km: distanceKm(origin, { lat, lon }) });
    }
  }
  sites.sort((a, b) => a.km - b.km);
  const near = sites.filter((x) => x.km <= MAX_KM);
  return { sites: near.slice(0, NEAREST_COUNT), failed: !tiles.every((t) => t.ok) && near.length === 0 };
}

// 「地図で場所を見る」：使い慣れた地図アプリを選べるようにする（送るのは避難場所の位置だけ）
const IS_APPLE = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
const IS_ANDROID = /Android/.test(navigator.userAgent);

function mapLinks(s) {
  const name = encodeURIComponent(s.name);
  const links = [
    ['Googleマップ', `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`],
    ['Appleマップ', `https://maps.apple.com/?ll=${s.lat},${s.lon}&q=${name}`],
    ['地理院地図', `https://maps.gsi.go.jp/#17/${s.lat}/${s.lon}/`],
  ];
  if (IS_ANDROID) links.unshift(['ほかの地図アプリ', `geo:${s.lat},${s.lon}?q=${s.lat},${s.lon}(${name})`]);
  // Appleマップは iPhone・Mac で使うので、それ以外では後ろに回す
  if (!IS_APPLE) links.push(links.splice(links.findIndex(([label]) => label === 'Appleマップ'), 1)[0]);
  return links;
}

function mapChooser(s) {
  const box = el('details', { className: 'map-choice' }, el('summary', { className: 'btn small', textContent: '地図で場所を見る' }));
  box.append(el('div', { className: 'map-choice-links' }, ...mapLinks(s).map(([label, href]) =>
    el('a', { className: 'btn small', href, target: href.startsWith('geo:') ? '' : '_blank', rel: 'noopener', textContent: label }))));
  return box;
}

function formatKm(km) {
  return km < 1 ? `約${Math.round((km * 1000) / 10) * 10}m` : `約${km.toFixed(1)}km`;
}

function typeById(id) {
  return DISASTER_TYPES.find((t) => t.id === id);
}

function renderEvac(evac, { isHome }) {
  shownEvac = { evac, isHome };
  const box = $('#evac-results');
  box.replaceChildren();
  const found = evac.results.filter((r) => r.sites.length > 0);
  const failed = evac.results.filter((r) => r.failed);
  const empty = evac.results.filter((r) => r.sites.length === 0 && !r.failed);

  if (found.length) {
    const grid = el('div', { className: 'evac-grid' });
    for (const r of found) {
      const type = typeById(r.typeId);
      const group = EVAC_GROUPS.find((g) => g.id === type.group);
      const card = el('div', { className: 'evac-card' }, el('h3', { textContent: type.label }));
      card.append(el('p', { className: 'type-desc', textContent: type.desc || ' ' }));
      const ul = el('ul', { className: 'evac-sites' });
      for (const s of r.sites) {
        const actions = el('div', { className: 'site-actions' },
          mapChooser(s),
          el('a', { className: 'btn small', href: `https://disaportal.gsi.go.jp/maps/?ll=${s.lat},${s.lon}&z=15`, target: '_blank', rel: 'noopener', textContent: 'ハザードマップで確認' }));
        if (group) {
          const pick = el('button', { type: 'button', className: 'btn small', textContent: `${group.short}の避難先にする` });
          pick.addEventListener('click', () => {
            state.rules[group.field] = s.name;
            saveState();
            fillRulesForm();
            renderQuickRules();
            renderProgress();
            setStatus($('#evac-status'), `「${s.name}」を${group.label}の避難先として決め事に書きました。`);
          });
          actions.append(pick);
        }
        ul.append(el('li', {},
          el('div', { className: 'site-head' }, el('span', { className: 'site-name', textContent: s.name }), el('span', { className: 'site-km', textContent: formatKm(s.km) })),
          el('span', { className: 'site-addr', textContent: `${s.address}（距離は直線距離）` }),
          actions));
      }
      card.append(ul);
      grid.append(card);
    }
    box.append(grid);
  }

  if (failed.length) {
    box.append(el('div', { className: 'caution evac-none' },
      el('strong', { textContent: `読み込めなかった災害：${failed.map((r) => typeById(r.typeId).label).join('・')}` }),
      el('p', { textContent: '通信がうまくいかず、データを読み込めませんでした。電波のよい所でもう一度探すか、市区町村のハザードマップで確認してください。' })));
  }
  const coastal = empty.filter((r) => COASTAL_TYPES.includes(r.typeId));
  const others = empty.filter((r) => !COASTAL_TYPES.includes(r.typeId));
  if (coastal.length) {
    box.append(el('div', { className: 'tip evac-none' },
      el('strong', { textContent: `${coastal.map((r) => typeById(r.typeId).label).join('・')}：10km以内に避難場所の指定はありません` }),
      el('p', { textContent: '海から離れた地域では、津波や高潮の心配はふつう小さいと考えられます。ただし、大きな川の河口に近い所や、海の近くへ出かけたときは注意してください。自宅の区域は、ハザードマップの「津波」「高潮」で確かめられます。' })));
  }
  if (others.length) {
    box.append(el('div', { className: 'tip evac-none' },
      el('strong', { textContent: `10km以内にデータがなかった災害：${others.map((r) => typeById(r.typeId).label).join('・')}` }),
      el('p', { textContent: 'データがないことは、安全な場所がないことや、その災害の危険がないことを意味しません。市区町村のハザードマップで確認してください。' })));
  }

  if (isHome) fillEvacDatalists();
  renderMap(evac);
}

function fillEvacDatalists() {
  for (const g of EVAC_GROUPS) {
    const names = new Set();
    for (const r of state.homeEvac?.results ?? []) {
      if (typeById(r.typeId).group === g.id) r.sites.forEach((s) => names.add(s.name));
    }
    $(`#evac-names-${g.id}`).replaceChildren(...[...names].map((n) => el('option', { value: n })));
  }
}

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletLoading) {
    leafletLoading = new Promise((resolve, reject) => {
      document.head.append(el('link', { rel: 'stylesheet', href: LEAFLET_CSS }));
      const s = el('script', { src: LEAFLET_JS });
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
  }
  return leafletLoading;
}

async function renderMap(evac) {
  if (PREVIEW) return;
  try {
    await loadLeaflet();
  } catch (e) {
    return; // 地図ライブラリが読めない環境では一覧だけ出す
  }
  const mapEl = $('#map');
  mapEl.hidden = false;
  if (!evacMap) {
    evacMap = L.map(mapEl);
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
      maxZoom: 18,
    }).addTo(evacMap);
  }
  if (evacLayer) evacLayer.remove();
  evacLayer = L.layerGroup().addTo(evacMap);
  const { origin } = evac;
  L.circleMarker([origin.lat, origin.lon], { radius: 9, color: '#B5562A', fillOpacity: 0.9 })
    .bindTooltip('探した場所').addTo(evacLayer);

  const bySite = new Map();
  for (const r of evac.results) {
    for (const s of r.sites) {
      const key = `${s.lat},${s.lon}`;
      if (!bySite.has(key)) bySite.set(key, { site: s, types: [] });
      bySite.get(key).types.push(typeById(r.typeId).label);
    }
  }
  const points = [[origin.lat, origin.lon]];
  for (const { site, types } of bySite.values()) {
    const tip = el('div', {}, el('strong', { textContent: site.name }), el('br'), types.join('・'));
    L.circleMarker([site.lat, site.lon], { radius: 7, color: '#2F5D8A', fillOpacity: 0.8 })
      .bindPopup(tip).bindTooltip(`${site.name}（${types.join('・')}）`).addTo(evacLayer);
    points.push([site.lat, site.lon]);
  }
  evacMap.invalidateSize();
  evacMap.fitBounds(points, { padding: [24, 24], maxZoom: 16 });
}

// 押したボタンを「探しています…」にし、終わったら結果の案内まで画面を動かす（案内が画面の外に出ないように）
async function runEvacSearch(getOrigin, originErrorText, { isHome, button }) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '探しています…';
  try {
    await searchEvac(getOrigin, originErrorText, { isHome });
  } finally {
    button.disabled = false;
    button.textContent = label;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    $('#evac-status').scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }
}

async function searchEvac(getOrigin, originErrorText, { isHome }) {
  const status = $('#evac-status');
  setStatus(status, '探しています…');
  let origin;
  try {
    origin = await getOrigin();
  } catch (e) {
    setStatus(status, typeof originErrorText === 'function' ? originErrorText(e) : originErrorText, true);
    return;
  }
  if (!origin) {
    setStatus(status, '住所が見つかりませんでした。都道府県や市区町村の名前から入れてみてください。', true);
    return;
  }
  const results = await Promise.all(DISASTER_TYPES.map(async (type) => {
    const { sites, failed } = await fetchSites(type.layer, origin);
    return { typeId: type.id, sites, failed };
  }));
  if (results.every((r) => r.failed)) {
    setStatus(status, '避難場所のデータを読み込めませんでした。電波のよい所でもう一度お試しください。前に調べた結果は消していません。', true);
    return;
  }
  const evac = normalizeEvac({ origin, results, at: new Date().toISOString() });
  if (isHome) {
    // 一部が読めなかったときは、前回その災害で読めていた結果を残す
    if (state.homeEvac) {
      evac.results = evac.results.map((r) => {
        const prev = state.homeEvac.results.find((p) => p.typeId === r.typeId);
        return r.failed && prev && prev.sites.length ? prev : r;
      });
    }
    state.homeEvac = evac;
    saveState();
    renderProgress();
  }
  renderEvac(evac, { isHome });
  $('#evac-switch').hidden = isHome || !state.homeEvac;
  setStatus(status, isHome
    ? `「${origin.label}」の周りの避難場所です（自宅の周りとして保存しました）。住所が合っているか確かめてください。`
    : 'いる場所（現在地）の周りの避難場所です。この結果は保存していません。');
}

// 位置情報が使えなかった理由ごとに、次にすることを案内する
function geoErrorText(e) {
  if (e?.code === 1) {
    return IS_APPLE
      ? '位置情報の利用が許可されていません。iPhoneは「設定」→「プライバシーとセキュリティ」→「位置情報サービス」をオンにし、その中の「Safari Webサイト」を「使用中のみ」にしてから、もう一度押してください。住所で探すこともできます。'
      : '位置情報の利用が許可されていません。ブラウザのアドレス欄の横のマークから位置情報を「許可」にして、もう一度押してください。住所で探すこともできます。';
  }
  if (e?.code === 3) return '現在地が分かるまでに時間がかかりすぎました。空の見える場所でもう一度押すか、住所で探してください。';
  return '現在地が分かりませんでした。位置情報をオンにしてもう一度押すか、住所で探してください。';
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('geo'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: '現在地' }),
      reject,
      { enableHighAccuracy: false, timeout: 15000 },
    );
  });
}

function showHomeEvac() {
  if (!state.homeEvac) return;
  renderEvac(state.homeEvac, { isHome: true });
  $('#evac-switch').hidden = true;
  const when = state.homeEvac.at ? new Date(state.homeEvac.at).toLocaleString('ja-JP') : '';
  setStatus($('#evac-status'), `「${state.homeEvac.origin.label}」の周りの避難場所です（${when}に調べた結果）。最新の情報は、もう一度探して確認してください。`);
}

// ---------- 家族の決め事 ----------

function fillRulesForm() {
  const form = $('#rules-form');
  for (const key of RULE_FIELDS) form.elements[key].value = state.rules[key];
}

function shareableRules() {
  const includePrivate = $('#share-health').checked;
  const rules = { ...state.rules };
  if (!includePrivate) for (const key of PRIVATE_RULE_FIELDS) rules[key] = '';
  return rules;
}

function shareablePeople() {
  return $('#share-health').checked ? state.people : [];
}

function rulesAsText(rules, people = []) {
  const lines = ['【わが家の防災の決め事】'];
  for (const key of RULE_FIELDS) {
    const value = rules[key].trim();
    if (value) lines.push(`■${RULE_LABELS[key]}`, value);
  }
  const health = peopleLines(people);
  if (health.length) lines.push('■健康のこと（人ごと）', ...health);
  return lines;
}

function showFallback(boxSel, text) {
  const box = $(boxSel);
  const area = box.querySelector('textarea');
  area.value = text;
  box.hidden = false;
  area.focus();
  area.select();
}

async function copyText(text, statusSel, okText, fallbackSel) {
  $(fallbackSel).hidden = true;
  try {
    await navigator.clipboard.writeText(text);
    setStatus($(statusSel), okText);
  } catch (e) {
    setStatus($(statusSel), '');
    showFallback(fallbackSel, text);
  }
}

async function copyRulesText() {
  const lines = rulesAsText(shareableRules(), shareablePeople());
  if (lines.length === 1) {
    setStatus($('#share-status'), 'まだ何も書かれていません。', true);
    return;
  }
  await copyText(lines.join('\n'), '#share-status', '決め事を文章でコピーしました。LINEなどに貼り付けて家族に送れます。', '#share-fallback');
}

function toBase64Url(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function streamBytes(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// 共有するのは決め事と家族構成。備蓄の在庫は端末ごとに違うので含めない。
async function encodeShare(rules) {
  const at = new Date().toISOString().slice(0, 10);
  const people = shareablePeople().filter((p) => PEOPLE_FIELDS.some(([k]) => p[k].trim()));
  const bytes = new TextEncoder().encode(JSON.stringify({ rules, family: state.family, at, ...(people.length ? { people } : {}) }));
  if (window.CompressionStream) return `z.${toBase64Url(await streamBytes(bytes, new CompressionStream('deflate-raw')))}`;
  return `b.${toBase64Url(bytes)}`;
}

async function decodeShare(token) {
  const kind = token.slice(0, 2);
  let bytes = fromBase64Url(token.slice(2));
  if (kind === 'z.') {
    if (!window.DecompressionStream) throw new Error('unsupported');
    bytes = await streamBytes(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind !== 'b.') {
    throw new Error('broken');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function makeShareLink() {
  const status = $('#share-status');
  const url = `${location.origin}${location.pathname}#share=${await encodeShare(shareableRules())}`;
  if (url.length > SHARE_URL_LIMIT) {
    setStatus(status, '書いた内容が長すぎて、リンクにできません。メモなどを短くするか、「文章でコピーする」を使ってください。', true);
    return;
  }
  const text = '災害のときの集合場所と連絡方法を決めました。開いて「この内容を読み込む」を押してください。';
  if (navigator.share) {
    try {
      await navigator.share({ title: 'わが家の防災の決め事', text, url });
      setStatus(status, '送りました。');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  await copyText(url, '#share-status', 'リンクをコピーしました。LINEなどに貼り付けて家族に送ってください。', '#share-fallback');
}

let pendingShare = null;

function clearShareHash() {
  history.replaceState(null, '', location.pathname + location.search);
}

async function checkSharedLink() {
  const m = location.hash.match(/^#share=([A-Za-z0-9._-]+)$/);
  if (!m) return false;
  try {
    pendingShare = await decodeShare(m[1]);
  } catch (e) {
    $('#share-error-text').textContent = e.message === 'unsupported'
      ? 'お使いのブラウザが古いため、届いた決め事を読み込めませんでした。ブラウザを新しくするか、送った人に「文章でコピーする」で送ってもらってください。'
      : '届いたリンクが途中で切れているか、壊れているため読み込めませんでした。送った人に、もう一度送ってもらってください。';
    $('#share-error').hidden = false;
    clearShareHash();
    return true;
  }
  const rules = normalizeRules(pendingShare.rules);
  const family = normalizeFamily(pendingShare.family);
  const preview = $('#share-preview');
  preview.replaceChildren();
  for (const key of RULE_FIELDS) {
    if (rules[key].trim()) preview.append(el('dt', { textContent: RULE_LABELS[key] }), el('dd', { textContent: rules[key].trim() }));
  }
  const sharedPeople = peopleLines(normalizePeople(pendingShare.people));
  if (sharedPeople.length) preview.append(el('dt', { textContent: '健康のこと（人ごと）' }), el('dd', { textContent: sharedPeople.join('\n') }));
  const total = family.adults + family.elderly + family.children + family.infants;
  preview.append(el('dt', { textContent: '家族の人数' }), el('dd', { textContent: `${total}人` }));
  if (/^\d{4}-\d{2}-\d{2}$/.test(pendingShare.at ?? '')) {
    const [y, mo, d] = pendingShare.at.split('-').map(Number);
    preview.prepend(el('dt', { textContent: '作った日' }), el('dd', { textContent: `${y}年${mo}月${d}日` }));
  }
  // LINEなどアプリの中のブラウザは、保存場所がホーム画面のアプリやSafariと別になる
  $('#share-line-note').hidden = !/ Line\//i.test(navigator.userAgent);
  $('#share-banner').hidden = false;
  clearShareHash();
  showTab('guide');
  return true;
}

function acceptShare() {
  if (!pendingShare) return;
  writeStorage(BACKUP_KEY, { rules: state.rules, family: state.family, people: state.people });
  state.rules = normalizeRules(pendingShare.rules);
  state.family = normalizeFamily(pendingShare.family);
  if (Array.isArray(pendingShare.people) && pendingShare.people.length) state.people = normalizePeople(pendingShare.people);
  pendingShare = null;
  saveState();
  refreshAll();
  $('#share-banner').hidden = true;
  $('#undo-banner').hidden = false;
}

function undoImport() {
  const backup = readStorage(BACKUP_KEY);
  if (backup?.full) {
    state = normalizeState(backup.full, Number(backup.full.v) || 1);
    saveState();
    applyTextSize();
    renderHazardForm();
    refreshAll();
  } else if (backup) {
    state.rules = normalizeRules(backup.rules);
    state.family = normalizeFamily(backup.family);
    if (Array.isArray(backup.people)) state.people = normalizePeople(backup.people);
    saveState();
    refreshAll();
  }
  $('#undo-banner').hidden = true;
}

// ---------- 健康のこと（人ごと） ----------

function renderPeople() {
  const list = $('#people-list');
  list.replaceChildren(...state.people.map((p, i) => {
    const box = el('div', { className: 'person' });
    box.dataset.index = String(i);
    for (const [key, label] of PEOPLE_FIELDS) {
      const id = `person-${i}-${key}`;
      box.append(el('label', { htmlFor: id, textContent: label }),
        el('input', { id, type: 'text', value: p[key], name: key, autocomplete: 'off' }));
    }
    const del = el('button', { type: 'button', className: 'btn small person-del', textContent: 'この人の欄を消す' });
    del.addEventListener('click', () => {
      state.people.splice(i, 1);
      saveState();
      renderPeople();
      renderQuickRules();
    });
    box.append(del);
    return box;
  }));
  $('#person-add').hidden = state.people.length >= PEOPLE_MAX;
}

function setupPeople() {
  $('#people-list').addEventListener('input', (e) => {
    const box = e.target.closest('.person');
    if (!box || !PEOPLE_FIELDS.some(([k]) => k === e.target.name)) return;
    state.people[Number(box.dataset.index)][e.target.name] = e.target.value.slice(0, 300);
    saveState();
    showSaved($('#rules-saved'));
    renderQuickRules();
  });
  $('#person-add').addEventListener('click', () => {
    state.people.push(normalizePeople([{}])[0]);
    saveState();
    renderPeople();
    $(`#person-${state.people.length - 1}-name`).focus();
  });
}

// ---------- ファイルに保存・戻す・すべて消す ----------

function saveBackupFile() {
  const blob = new Blob([JSON.stringify({ app: 'ienokoto-bousai', savedAt: new Date().toISOString(), ...state }, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const name = `bousai-note-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus($('#backup-status'), `「${name}」を作りました。メールで自分に送る、クラウドに入れるなどして保管してください。`);
}

async function restoreBackupFile(file) {
  const status = $('#backup-status');
  let data;
  try {
    if (file.size > 1_000_000) throw new Error('size');
    data = JSON.parse(await file.text());
    if (data?.app !== 'ienokoto-bousai') throw new Error('app');
  } catch (e) {
    setStatus(status, 'このファイルは読み込めませんでした。「ファイルに保存する」で作ったファイルを選んでください。', true);
    return;
  }
  const next = normalizeState(data, Number(data.v) || 1);
  const rulesCount = RULE_FIELDS.filter((k) => next.rules[k].trim()).length;
  const f = next.family;
  const when = typeof data.savedAt === 'string' ? new Date(data.savedAt).toLocaleDateString('ja-JP') : '日付不明';
  if (!window.confirm(`${when}に保存したファイルです（決め事${rulesCount}項目・家族${f.adults + f.elderly + f.children + f.infants}人）。この端末の入力を、この内容に置きかえますか？`)) return;
  writeStorage(BACKUP_KEY, { full: state });
  state = next;
  saveState();
  applyTextSize();
  renderHazardForm();
  refreshAll();
  if (state.homeEvac && !PREVIEW) showHomeEvac();
  setStatus(status, 'ファイルから戻しました。');
  $('#undo-banner').hidden = false;
}

function clearAll() {
  if (!window.confirm('この端末の入力をすべて消します。元に戻せません。よろしいですか？')) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BACKUP_KEY);
  } catch (e) { /* 保存領域が使えない環境 */ }
  location.reload();
}

// ---------- 備え ----------

function fillFamilyForm() {
  const form = $('#family-form');
  for (const key of Object.keys(DEFAULT_FAMILY)) form.elements[key].value = String(state.family[key]);
  const f = state.family;
  $('#family-total').textContent = `合計 ${f.adults + f.elderly + f.children + f.infants}人${f.dogs + f.cats ? `・ペット${f.dogs + f.cats}匹` : ''}、${f.days}日分で計算しています。`;
}

// 期限は「年・月」。その月の末日までの日数を返す
function daysUntilMonthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  const end = new Date(y, m, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end - today) / 86400000);
}

function stockRows() {
  return STOCK_RULES
    .map((item) => ({ item, need: item.need(state.family), entry: state.stock[item.id] }))
    .filter((r) => r.need > 0);
}

let stockSavedTimer = null;

function noteStockSaved() {
  clearTimeout(stockSavedTimer);
  stockSavedTimer = setTimeout(() => showSaved($('#stock-saved')), 400);
}

function stockRow(item, need, entry) {
  const nameCell = el('th', { scope: 'row', textContent: item.name }, el('span', { className: 'hint', textContent: item.hint }));
  if (item.guide && !PREVIEW) nameCell.append(el('a', { className: 'guide-link', href: `${ROOT}erabikata/${item.guide}/`, textContent: '選び方を見る' }));
  const needCell = el('td', { textContent: `${need}${item.unit}` });
  needCell.dataset.label = '目安';
  if (item.extra) needCell.append(el('span', { className: 'hint', textContent: item.extra(need) }));
  if (state.family.days === 7) {
    const first = item.need({ ...state.family, days: 3 });
    if (first > 0 && first < need) needCell.append(el('span', { className: 'hint', textContent: `まず3日分なら${first}${item.unit}` }));
  }

  const have = el('input', { type: 'number', min: '0', inputMode: 'numeric', value: entry.have === null ? '' : String(entry.have), placeholder: '未入力' });
  have.setAttribute('aria-label', `${item.name}の今ある量（${item.unit}）`);
  const haveCell = el('td', {}, have);
  haveCell.dataset.label = `今ある量（${item.unit}）`;

  const diffCell = el('td');
  diffCell.dataset.label = '過不足';
  const paintDiff = () => {
    const h = state.stock[item.id].have;
    diffCell.className = '';
    if (h === null) {
      diffCell.textContent = '未入力';
      diffCell.classList.add('diff-unset');
      return;
    }
    const diff = h - need;
    diffCell.textContent = diff < 0 ? `${-diff}${item.unit} 足りない` : 'OK';
    diffCell.classList.add(diff < 0 ? 'diff-short' : 'diff-ok');
  };
  have.addEventListener('input', () => {
    const n = Number(have.value);
    state.stock[item.id].have = have.value === '' || !Number.isFinite(n) || n < 0 ? null : n;
    saveState();
    paintDiff();
    renderSummary();
    renderProgress();
    noteStockSaved();
  });
  paintDiff();

  const expiryCell = el('td', { className: 'expiry' });
  if (item.expiry) {
    const month = el('input', { type: 'month', className: 'month', value: entry.expiry, placeholder: '2027-03' });
    month.setAttribute('aria-label', `${item.name}のいちばん近い期限（年・月）`);
    const warn = el('span', { className: 'expiry-warn' });
    const paintWarn = () => {
      const ym = state.stock[item.id].expiry;
      const d = ym ? daysUntilMonthEnd(ym) : null;
      warn.textContent = d === null ? '' : d < 0 ? '期限切れ' : d <= EXPIRY_WARN_DAYS ? `期限まであと${d}日` : '';
    };
    month.addEventListener('change', () => {
      state.stock[item.id].expiry = /^\d{4}-\d{2}$/.test(month.value) ? month.value : '';
      saveState();
      paintWarn();
      renderSummary();
      noteStockSaved();
    });
    paintWarn();
    expiryCell.dataset.label = 'いちばん近い期限（年・月）';
    expiryCell.append(month, warn);
  } else {
    expiryCell.textContent = '―';
    expiryCell.classList.add('no-expiry');
  }
  return el('tr', {}, nameCell, needCell, haveCell, diffCell, expiryCell);
}

function renderStockBody(body, rows) {
  body.replaceChildren();
  let lastCat = '';
  for (const { item, need, entry } of rows) {
    if (item.cat !== lastCat) {
      lastCat = item.cat;
      const th = el('th', { colSpan: 5, scope: 'colgroup', textContent: item.cat });
      body.append(el('tr', { className: 'cat-row' }, th));
    }
    body.append(stockRow(item, need, entry));
  }
}

function renderStock() {
  const rows = stockRows();
  renderStockBody($('#stock-body-priority'), rows.filter((r) => r.item.priority));
  renderStockBody($('#stock-body-other'), rows.filter((r) => !r.item.priority));
  renderSummary();
}

function shortages() {
  return stockRows()
    .filter(({ entry }) => entry.have !== null)
    .map(({ item, need, entry }) => ({ item, short: need - entry.have }))
    .filter((r) => r.short > 0);
}

function renderSummary() {
  const box = $('#stock-summary');
  const rows = stockRows();
  const entered = rows.filter(({ entry }) => entry.have !== null);
  const short = shortages();
  const expiring = rows.filter(({ entry }) => entry.expiry && daysUntilMonthEnd(entry.expiry) <= EXPIRY_WARN_DAYS);
  const total = state.family.adults + state.family.elderly + state.family.children + state.family.infants;
  box.replaceChildren();
  if (total === 0) {
    box.append(el('p', { textContent: '家族の人数を入れてください。' }));
    return;
  }
  if (entered.length === 0) {
    box.append(el('p', { textContent: 'まずは「まず備えたいもの」の4品目から、今ある量を入れてみましょう。' }));
  } else {
    box.append(el('p', {}, '足りないもの ', el('span', { className: 'big', textContent: `${short.length}品目` }),
      `（入れた${entered.length}品目のうち。未入力${rows.length - entered.length}品目）`));
  }
  if (expiring.length) box.append(el('p', { className: 'diff-short', textContent: `期限切れ・期限が近いもの：${expiring.map((r) => r.item.name).join('、')}` }));
}

async function copyShoppingList() {
  const short = shortages();
  if (short.length === 0) {
    const noneEntered = stockRows().every(({ entry }) => entry.have === null);
    setStatus($('#stock-status'), noneEntered ? '今ある量がまだ入っていません。' : '入れた品目の中に、足りないものはありません。');
    return;
  }
  const text = ['防災の買い物リスト', ...short.map((r) => `・${r.item.name}：${r.short}${r.item.unit}`)].join('\n');
  await copyText(text, '#stock-status', '足りないもののリストをコピーしました。', '#stock-fallback');
}

function renderSources() {
  const list = $('#source-list');
  list.replaceChildren(...STOCK_RULES.map((item) => el('li', { textContent: `${item.name}：${item.hint}（${item.source}）` })));
  $('#checked-on').textContent = `内容の確認日：${CONTENT_CHECKED_ON}`;
  $('#footer-checked-on').textContent = CONTENT_CHECKED_ON;
}

// ---------- 持ち出し袋 ----------

function bagItemsFor(f) {
  return BAG_ITEMS.filter((item) => !item.when || item.when(f, state.solo));
}

function renderBag() {
  const box = $('#bag-list');
  box.replaceChildren();
  const items = bagItemsFor(state.family);
  const paintProgress = () => {
    const done = items.filter((item) => state.bag[item.id]).length;
    $('#bag-progress').textContent = `${items.length}品目のうち ${done}品目を入れました。`;
  };
  for (const item of items) {
    const box2 = el('input', { type: 'checkbox', checked: state.bag[item.id] });
    box2.addEventListener('change', () => {
      state.bag[item.id] = box2.checked;
      saveState();
      paintProgress();
      renderProgress();
    });
    box.append(el('label', { className: 'bag-item' }, box2, item.name));
  }
  paintProgress();
}

// ---------- チェックリスト（0次ポーチ・家の安全対策） ----------

function renderChecklist(items, key, listSel, progressSel, doneWord) {
  const list = $(listSel);
  const paint = () => {
    const done = items.filter((item) => state[key][item.id]).length;
    $(progressSel).textContent = `${items.length}項目のうち ${done}項目を${doneWord}。`;
  };
  list.replaceChildren(...items.map((item) => {
    const box = el('input', { type: 'checkbox', checked: state[key][item.id] });
    box.addEventListener('change', () => {
      state[key][item.id] = box.checked;
      saveState();
      paint();
      renderProgress();
    });
    const extra = item.extra?.(state.family);
    return el('label', { className: 'bag-item' }, box, el('span', {}, item.name, extra ? el('span', { className: 'item-warn', textContent: extra }) : null));
  }));
  paint();
}

// ---------- 自宅の危険 ----------

function hazardAdvice() {
  const h = state.hazard;
  const floors = Number(h.floors) || 0;
  const out = {};
  if (h.landslide === 'yes') out.landslide = h.landslideRed === 'yes'
    ? '土砂災害特別警戒区域（レッドゾーン）です。建物ごと壊れるおそれがあります。レベル3（高齢者等避難）で準備を始め、遅くともレベル4までに、必ず区域の外へ避難します。家にとどまる選択はできません。'
    : '土砂災害警戒区域です。レベル4（避難指示・レベル4土砂災害危険警報）までに、必ず区域の外へ避難します。家にとどまる選択はできません。';
  if (h.landslide === 'no') out.landslide = '自宅は土砂災害警戒区域の外です。ただし、近くのがけや沢の変化には注意します。';
  if (h.flood === 'yes') {
    if (h.collapse === 'yes') out.flood = '家が流される恐れのある区域です。レベル4までに、区域の外へ避難します。家にとどまれません。';
    else if (h.depth === 'gt5') out.flood = '2階も水につかる深さの想定です。レベル4までに、区域の外へ避難します。';
    else if (h.depth === '3to5') out.flood = floors >= 3
      ? '3階以上にいて、水が引くまで過ごせる水・食料・トイレがあれば、家の上の階にとどまる（屋内安全確保）ことも選べます。'
      : '2階の床より上まで水が来る想定です。レベル4までに、区域の外へ避難します。';
    else if (h.depth === '05to3') out.flood = floors >= 2
      ? '2階以上にいて、水が引くまで過ごせる水・食料・トイレがあれば、家の上の階にとどまる（屋内安全確保）ことも選べます。'
      : '1階しか使えない家は、レベル4までに区域の外へ避難します。';
    else if (h.depth === 'lt05') out.flood = '浸水は浅い想定です。水が引くまで過ごせる備えがあれば、家にとどまることも選べます。避難の情報には注意します。';
    else out.flood = '浸水する区域です。想定される浸水の深さと「家が流される恐れのある区域」かどうかを、ハザードマップで確かめてください。';
    const canStay = out.flood.includes('とどまる');
    if (canStay && h.duration === 'long') out.flood += ' ただし水が3日以上引かない想定です。家にとどまるなら、その日数分の水・食料・トイレが要ります。用意できなければ、区域の外へ避難します。';
    if (canStay && h.duration === 'days') out.flood += ' 水が引くまで最大3日ほどの想定です。3日分以上の水・食料・トイレを備えます。';
  }
  if (h.flood === 'no') out.flood = '自宅は洪水で浸水する区域の外です。ただし、大雨で道路が水につかる（内水氾濫）ことには注意します。';
  if (h.tsunami === 'yes') out.tsunami = '津波で浸水する区域です。大きな揺れや長い揺れを感じたら、警報を待たずにすぐ高い所へ逃げます。';
  if (h.tsunami === 'no') out.tsunami = '自宅は津波で浸水する区域の外です。海の近くに出かけたときは注意します。';
  return out;
}

function renderHazardForm() {
  const form = $('#hazard-form');
  form.replaceChildren(...HAZARD_QUESTIONS.map((q) => {
    const fs = el('fieldset', { className: 'radio-group' }, el('legend', { textContent: q.label }));
    fs.dataset.q = q.id;
    for (const [value, text] of q.options) {
      const radio = el('input', { type: 'radio', name: `hz-${q.id}`, value, checked: state.hazard[q.id] === value });
      radio.addEventListener('change', () => {
        state.hazard[q.id] = value;
        saveState();
        renderHazardVisibility();
        renderHazardResult();
        renderProgress();
        renderActionPanel();
      });
      fs.append(el('label', { className: 'radio-line' }, radio, text));
    }
    return fs;
  }));
  renderHazardVisibility();
  renderHazardResult();
}

function renderHazardVisibility() {
  for (const q of HAZARD_QUESTIONS) {
    const fs = $(`#hazard-form [data-q="${q.id}"]`);
    if (fs) fs.hidden = !!q.when && !q.when(state.hazard);
  }
}

function renderHazardResult() {
  const box = $('#hazard-result');
  const advice = hazardAdvice();
  const h = state.hazard;
  box.replaceChildren();
  const lines = [];
  if (advice.flood) lines.push(['洪水', advice.flood]);
  if (advice.landslide) lines.push(['土砂災害', advice.landslide]);
  if (advice.tsunami) lines.push(['津波', advice.tsunami]);
  if (!lines.length) return;
  const ul = el('ul', {}, ...lines.map(([k, t]) => el('li', {}, el('strong', { textContent: `${k}：` }), t)));
  box.append(el('h4', { textContent: 'わが家の避難の目安' }), ul);
  if (h.flood === 'no' && h.landslide === 'no' && h.tsunami === 'no') {
    box.append(el('p', { textContent: '洪水・土砂災害・津波の区域の外です。地震で家が無事なら、家で過ごす「在宅避難」が基本です。在宅避難でも、避難所で食料や情報を受け取れます。' }));
  }
  if (h.flood === 'yes' && !h.duration) box.append(el('p', { textContent: '水が引くまでの時間（浸水継続時間）もハザードマップで確かめ、その日数分の水・食料・トイレを備えます。' }));
  if (Object.values(h).includes('unknown')) box.append(el('p', { textContent: '「分からない」の項目は、ハザードマップで確かめましょう。' }));
  box.append(el('p', { className: 'fine', textContent: 'ハザードマップの想定にもとづく目安です。実際の避難は、市区町村の情報に従ってください。想定を超える災害もあります。' }));
}

// ---------- 自宅の危険を自動で調べる（試験中） ----------

// その地点の、地図画像の3×3の点の色を読む。タイルがない（404）ときは「データなし」
async function samplePixels(layer, lat, lon) {
  const n = 2 ** HAZARD_TILE_ZOOM;
  const px = ((lon + 180) / 360) * n * 256;
  const rad = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n * 256;
  const tx = Math.floor(px / 256);
  const ty = Math.floor(py / 256);
  const res = await fetch(`${HAZARD_TILE_BASE}${layer}/${HAZARD_TILE_ZOOM}/${tx}/${ty}.png`);
  if (res.status === 404) return { status: 'none', colors: [] };
  if (!res.ok) throw new Error('tile');
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = el('canvas', { width: 256, height: 256 });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const cx = Math.min(254, Math.max(1, Math.floor(px - tx * 256)));
  const cy = Math.min(254, Math.max(1, Math.floor(py - ty * 256)));
  const data = ctx.getImageData(cx - 1, cy - 1, 3, 3).data;
  const colors = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 40) colors.push([data[i], data[i + 1], data[i + 2]]);
  return { status: 'ok', colors };
}

function depthOf(colors) {
  const order = ['lt05', '05to3', '3to5', 'gt5'];
  let best = null;
  for (const c of colors) {
    const hit = DEPTH_COLORS
      .map((d) => ({ d, dist: Math.hypot(d.rgb[0] - c[0], d.rgb[1] - c[1], d.rgb[2] - c[2]) }))
      .sort((a, b) => a.dist - b.dist)[0];
    if (hit.dist > 40) continue;
    // 3×3の中で一番深いものを取る（境目では安全側に）
    if (!best || order.indexOf(hit.d.depth) > order.indexOf(best.depth) || (hit.d.depth === best.depth && DEPTH_COLORS.indexOf(hit.d) > DEPTH_COLORS.indexOf(best))) best = hit.d;
  }
  return best;
}

async function checkHazardAt(lat, lon) {
  const out = {};
  for (const h of HAZARD_LAYERS) {
    const results = await Promise.all(h.layers.map((layer) => samplePixels(layer, lat, lon).catch(() => ({ status: 'fail', colors: [] }))));
    const colors = results.flatMap((r) => r.colors);
    out[h.id] = {
      found: colors.length > 0,
      failed: results.every((r) => r.status === 'fail'),
      colors,
      layers: h.layers.map((layer, i) => `${layer}：${{ ok: '読めた', none: 'データなし', fail: '読めなかった' }[results[i].status]}${results[i].colors.length ? '（色あり）' : ''}`),
    };
  }
  return out;
}

async function runAutoHazard() {
  const box = $('#auto-hazard-result');
  const btn = $('#auto-hazard');
  let origin = state.homeEvac?.origin;
  const address = $('#addr').value.trim();
  btn.disabled = true;
  btn.textContent = '調べています…';
  box.replaceChildren(el('p', { textContent: '調べています…' }));
  try {
    if (address) origin = await geocode(address).catch(() => null) ?? origin;
    if (!origin) {
      box.replaceChildren(el('p', { className: 'status error', textContent: 'この画面の上の「自宅の住所で探す」に住所を入れてから押してください。' }));
      return;
    }
    const r = await checkHazardAt(origin.lat, origin.lon);
    if (Object.values(r).every((x) => x.failed)) {
      box.replaceChildren(el('p', { className: 'status error', textContent: '地図データを読み込めませんでした。電波のよい所でもう一度押すか、ハザードマップを見ながら選んでください。' }));
      return;
    }
    const lines = [];
    const h = state.hazard;
    const line = (label, x, foundText) => lines.push(`${label}：${x.failed ? '調べられませんでした' : x.found ? foundText : '見つかりませんでした（ハザードマップでも確かめてください）'}`);
    const depth = depthOf(r.flood.colors);
    if (r.flood.found) {
      h.flood = 'yes';
      if (depth) h.depth = depth.depth;
    }
    line('洪水', r.flood, `浸水する区域です${depth ? `（想定の深さ ${depth.text}）` : '（深さはハザードマップで確かめてください）'}`);
    if (r.collapse.found) h.collapse = 'yes';
    line('家屋倒壊等氾濫想定区域', r.collapse, '入っています');
    const red = r.landslide.colors.some(([cr, cg, cb]) => cr > 180 && cg < 110 && cb < 110);
    if (r.landslide.found) {
      h.landslide = 'yes';
      if (red) h.landslideRed = 'yes';
    }
    line('土砂災害警戒区域', r.landslide, red ? '入っています（特別警戒区域＝レッドゾーンの色もあります）' : '入っています');
    const tsunamiDepth = depthOf(r.tsunami.colors);
    if (r.tsunami.found) h.tsunami = 'yes';
    line('津波', r.tsunami, `浸水する区域です${tsunamiDepth ? `（想定の深さ ${tsunamiDepth.text}）` : ''}`);
    line('高潮', r.stormSurge, '浸水する区域です（ハザードマップの高潮でも確かめてください）');
    saveState();
    renderHazardForm();
    renderProgress();
    renderActionPanel();
    box.replaceChildren(
      el('h4', { textContent: `「${origin.label}」の地点を調べた結果（目安）` }),
      el('ul', {}, ...lines.map((t) => el('li', { textContent: t }))),
      el('p', { className: 'fine', textContent: '「入っている」と分かった項目だけを上の質問で選びました。区域の境目の近くでは、ずれることがあります。見つからなかったことは、安全という意味ではありません。必ずハザードマップでも確かめてください。出典：ハザードマップポータルサイト（国土交通省）' }),
      el('details', {}, el('summary', { textContent: '調べた地図データ（答え合わせ用）' }),
        el('div', { className: 'detail-body' }, el('ul', {}, ...Object.values(r).flatMap((x) => x.layers).map((t) => el('li', { className: 'fine', textContent: t }))))),
    );
  } finally {
    btn.disabled = false;
    btn.textContent = '住所から自動で調べる（試験中）';
  }
}

// ---------- 家族に合わせた表示 ----------

function applyConditionals() {
  const f = state.family;
  const flags = {
    solo: state.solo,
    // 前の版で高齢者の人数だけで出していた介護の欄に書いた内容は、見えなくならないようにする
    care: f.careNeeded + f.diaperAdults > 0 || ['careFacility', 'careManager', 'careSupport', 'careRegistry'].some((k) => state.rules[k].trim()),
    med: f.medDevice > 0,
    kids: f.children + f.infants > 0,
    pet: f.dogs + f.cats > 0,
  };
  for (const node of document.querySelectorAll('[data-show]')) node.hidden = !flags[node.dataset.show];
  for (const node of document.querySelectorAll('[data-hide]')) node.hidden = !!flags[node.dataset.hide];
  $('#solo-select').value = state.solo ? 'solo' : 'family';
}

function renderCareGuides() {
  const guides = CARE_GUIDES.filter((g) => g.when(state.family, state.solo));
  const box = $('#care-guides');
  box.replaceChildren();
  if (!guides.length) return;
  box.append(el('h3', { className: 'sub-title', textContent: state.solo ? 'あなたに合わせた準備' : '家族に合わせた準備' }));
  for (const g of guides) {
    const d = el('details', { className: 'care-guide', open: guides.length <= 2 }, el('summary', { textContent: g.title }));
    d.append(el('div', { className: 'detail-body' }, el('ul', {}, ...g.items.map((t) => el('li', { textContent: t })))));
    box.append(d);
  }
}

function setSolo(solo) {
  state.solo = solo;
  if (solo) {
    const f = state.family;
    const total = f.adults + f.elderly + f.children + f.infants;
    if (total !== 1) {
      const elderlyOnly = f.adults === 0 && f.elderly > 0;
      Object.assign(f, { adults: elderlyOnly ? 0 : 1, elderly: elderlyOnly ? 1 : 0, children: 0, infants: 0 });
    }
  }
  saveState();
  refreshAll();
}

// ---------- 起動 ----------

function refreshAll() {
  applyConditionals();
  renderCareGuides();
  renderChecklist(POUCH_ITEMS, 'pouch', '#pouch-list', '#pouch-progress', '入れました');
  renderChecklist(HOME_CHECKS, 'home', '#home-list', '#home-progress', '済ませました');
  fillRulesForm();
  renderPeople();
  fillFamilyForm();
  renderStock();
  renderBag();
  renderQuickRules();
  renderActionPanel();
  renderProgress();
}

function onHashChange() {
  checkSharedLink().then((handled) => {
    if (!handled) showTab(currentTab());
  });
}

// ---------- 印刷用の家族カード ----------

// 印刷は入力欄のままではなく、書いた項目だけを1枚にまとめる（空欄の例文は出さない）
function buildPrintCard() {
  const rules = shareableRules();
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const filled = RULE_FIELDS.filter((key) => rules[key].trim());
  const items = filled.map((key) => el('div', { className: 'pc-item' }, el('dt', { textContent: RULE_LABELS[key] }), el('dd', { textContent: rules[key].trim() })));
  const health = peopleLines(shareablePeople());
  if (health.length) items.push(el('div', { className: 'pc-item' }, el('dt', { textContent: '健康のこと（人ごと）' }), el('dd', { textContent: health.join('\n') })));
  const dengon = rules.dengonNumber.trim();
  const wallet = el('div', { className: 'pc-wallet' },
    el('p', { className: 'pc-wallet-title', textContent: 'わが家の防災カード（切り取って財布に）' }),
    ...['meet1', 'evacWater', 'evacLandslide', 'evacQuake', 'evacTsunami', 'relay'].filter((k) => rules[k].trim())
      .map((k) => el('p', {}, el('b', { textContent: `${RULE_LABELS[k]}：` }), rules[k].trim())),
    el('p', {}, el('b', { textContent: '171：' }), dengon ? `残す 171→1→${dengon}／聞く 171→2→${dengon}` : '残す 171→1→番号／聞く 171→2→番号'));
  $('#print-card').replaceChildren(
    el('h1', { textContent: 'わが家の防災の決め事' }),
    el('p', { className: 'pc-date', textContent: `${today} 作成　見直したら日付を書き直しましょう：　　年　　月　　日` }),
    el('div', { className: 'pc-calls' },
      el('span', {}, el('b', { textContent: '119' }), ' 火事・救急'),
      el('span', {}, el('b', { textContent: '110' }), ' 事件・事故'),
      el('span', {}, el('b', { textContent: '171' }), ' 災害用伝言ダイヤル'),
      el('span', {}, el('b', { textContent: 'web171' }), ' 文字の伝言板')),
    items.length ? el('dl', { className: 'pc-list' }, ...items) : el('p', { textContent: '決め事はまだ書かれていません。' }),
    wallet,
    el('p', { className: 'pc-foot', textContent: '迎えに戻らない（津波・火事）。レベル4までに危険な場所から避難。わが家の防災ノートで作成' }));
}

function printRules() {
  buildPrintCard();
  window.print();
}

// ---------- 人数の −・＋ ----------

function setupSteppers() {
  const form = $('#family-form');
  for (const input of form.querySelectorAll('input[type="number"]')) {
    const label = input.closest('label');
    const text = label.firstChild.textContent.trim();
    const step = (d) => {
      const n = Math.min(20, Math.max(0, (Number(input.value) || 0) + d));
      input.value = String(n);
      form.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const minus = el('button', { type: 'button', className: 'step', textContent: '−' });
    const plus = el('button', { type: 'button', className: 'step', textContent: '＋' });
    minus.setAttribute('aria-label', `${text}を1減らす`);
    plus.setAttribute('aria-label', `${text}を1増やす`);
    minus.addEventListener('click', () => step(-1));
    plus.addEventListener('click', () => step(1));
    label.classList.add('stepper-row');
    label.firstChild.replaceWith(el('span', { className: 'stepper-label', textContent: text }));
    const box = el('span', { className: 'stepper' }, minus);
    input.replaceWith(box);
    box.append(input, plus);
  }
}

// ---------- ページの中の移動 ----------

function setupJumpNav() {
  for (const btn of document.querySelectorAll('[data-jump]')) {
    btn.addEventListener('click', () => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      document.getElementById(btn.dataset.jump)?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    });
  }
}

// ---------- 内容の更新のお知らせ ----------

function watchUpdates() {
  if (!navigator.serviceWorker?.controller) return; // 初めて開いたときは知らせない
  navigator.serviceWorker.addEventListener('controllerchange', () => { $('#update-banner').hidden = false; });
  $('#update-reload').addEventListener('click', () => location.reload());
}

// ---------- カレンダー（.ics） ----------

function icsDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function icsEscape(text) {
  return text.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
}

function buildIcs() {
  const now = new Date();
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const events = [];
  const add = (date, summary, description, rrule) => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    events.push([
      'BEGIN:VEVENT',
      `UID:${icsDate(date)}-${events.length}-${Math.random().toString(36).slice(2)}@ienokoto-bousai`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(date)}`,
      `DTEND;VALUE=DATE:${icsDate(next)}`,
      ...(rrule ? [`RRULE:${rrule}`] : []),
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      'END:VEVENT',
    ].join('\r\n'));
  };
  for (const { item, entry } of stockRows()) {
    if (!entry.expiry) continue;
    const [y, m] = entry.expiry.split('-').map(Number);
    add(new Date(y, m - 1, 1), `【防災】${item.name}の期限（${y}年${m}月）`, '期限が来る月です。使ってから買い足しましょう（ローリングストック）。');
  }
  const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  add(firstOfNextMonth, '【防災】毎月の点検日', '備蓄の期限と持ち出し袋を確かめる日です。今日は171・web171の体験日でもあります。', 'FREQ=MONTHLY;BYMONTHDAY=1');
  const sept = new Date(now.getMonth() < 8 ? now.getFullYear() : now.getFullYear() + 1, 8, 1);
  add(sept, '【防災】防災の日：家族の決め事を見直す', '集合場所・避難先・連絡方法を家族で確かめましょう。', 'FREQ=YEARLY');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ienokoto//bousai-note//JA', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
}

function downloadIcs() {
  const blob = new Blob([buildIcs()], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: 'bousai-calendar.ics' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus($('#stock-status'), 'カレンダーのファイルを作りました。開いて、カレンダーに追加してください。');
}

// ---------- ホーム画面への追加・サイトの設定 ----------

let installPrompt = null;

function setupInstallCard() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const card = $('#install-card');
  card.hidden = PREVIEW || standalone || state.installDismissed;
  $('#install-dismiss').addEventListener('click', () => {
    state.installDismissed = true;
    saveState();
    card.hidden = true;
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $('#install-btn').hidden = false;
  });
  $('#install-btn').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $('#install-btn').hidden = true;
  });
}

function applySiteConfig() {
  if (CONFIG.amazonTag || CONFIG.rakutenAffiliateId) $('#affiliate-note').hidden = false;
  if (CONFIG.notebookUrl && !PREVIEW) {
    const p = $('#notebook-link');
    p.replaceChildren('冷蔵庫に貼れる、書き込める紙の版もあります：',
      el('a', { href: CONFIG.notebookUrl, target: '_blank', rel: 'noopener', textContent: '紙の「わが家の防災ノート」' }));
    p.hidden = false;
  }
}

function init() {
  document.head.append(el('link', { rel: 'stylesheet', href: FONTS_CSS }));
  if (!PREVIEW && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    watchUpdates();
    navigator.serviceWorker.register(`${ROOT}sw.js`).catch(() => {});
  }
  if (PREVIEW) {
    document.querySelectorAll('[data-full-only]').forEach((node) => { node.hidden = true; });
    document.querySelectorAll('[data-preview-only]').forEach((node) => { node.hidden = false; });
  }
  applyTextSize();
  for (const btn of document.querySelectorAll('.size-btn')) {
    btn.addEventListener('click', () => {
      state.textSize = btn.dataset.size;
      const saved = saveState();
      applyTextSize();
      const status = $('#size-status');
      status.textContent = saved ? `文字を「${btn.textContent}」にしました。次に開くときも、この大きさです。` : '';
      clearTimeout(sizeStatusTimer);
      sizeStatusTimer = setTimeout(() => { status.textContent = ''; }, 5000);
    });
  }

  $('#ruby-btn').addEventListener('click', () => {
    state.ruby = !state.ruby;
    saveState();
    applyRuby();
  });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => goTab(tab.dataset.tab));
    tab.addEventListener('keydown', onTabKey);
  }
  window.addEventListener('hashchange', onHashChange);

  renderActionButtons();

  $('#addr-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const address = $('#addr').value.trim();
    if (!address) {
      setStatus($('#evac-status'), '住所を入れてから「探す」を押してください。', true);
      $('#addr').focus();
      return;
    }
    runEvacSearch(() => geocode(address), '住所を調べられませんでした。電波のよい所でもう一度お試しください。', { isHome: true, button: $('#addr-form button[type=submit]') });
  });
  $('#use-geo').addEventListener('click', () => {
    runEvacSearch(currentPosition, geoErrorText, { isHome: false, button: $('#use-geo') });
  });
  $('#show-home').addEventListener('click', showHomeEvac);

  const rulesForm = $('#rules-form');
  rulesForm.addEventListener('input', (e) => {
    if (RULE_FIELDS.includes(e.target.name)) {
      state.rules[e.target.name] = e.target.value;
      saveState();
      showSaved($('#rules-saved'));
      renderQuickRules();
      renderProgress();
    }
  });
  $('#share-link').addEventListener('click', makeShareLink);
  $('#copy-rules').addEventListener('click', copyRulesText);
  $('#print-rules').addEventListener('click', printRules);
  window.addEventListener('beforeprint', buildPrintCard);
  $('#share-accept').addEventListener('click', acceptShare);
  $('#share-dismiss').addEventListener('click', () => {
    pendingShare = null;
    $('#share-banner').hidden = true;
  });
  $('#share-error-close').addEventListener('click', () => { $('#share-error').hidden = true; });
  $('#undo-import').addEventListener('click', undoImport);
  $('#backup-save').addEventListener('click', saveBackupFile);
  $('#backup-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) restoreBackupFile(file);
    e.target.value = '';
  });
  $('#clear-all').addEventListener('click', clearAll);
  $('#auto-hazard').addEventListener('click', runAutoHazard);

  const familyForm = $('#family-form');
  familyForm.addEventListener('input', () => {
    const next = {};
    for (const key of Object.keys(DEFAULT_FAMILY)) next[key] = familyForm.elements[key].value;
    state.family = normalizeFamily(next);
    saveState();
    renderStock();
    renderBag();
    renderProgress();
    applyConditionals();
    renderCareGuides();
    renderChecklist(HOME_CHECKS, 'home', '#home-list', '#home-progress', '済ませました');
    noteStockSaved();
  });
  $('#solo-select').addEventListener('change', (e) => setSolo(e.target.value === 'solo'));
  // 入力し終えたら、範囲外の値を直した結果を欄に戻す
  familyForm.addEventListener('change', fillFamilyForm);
  familyForm.addEventListener('input', () => {
    const f = state.family;
    $('#family-total').textContent = `合計 ${f.adults + f.elderly + f.children + f.infants}人${f.dogs + f.cats ? `・ペット${f.dogs + f.cats}匹` : ''}、${f.days}日分で計算しています。`;
  });
  $('#copy-shopping').addEventListener('click', copyShoppingList);
  $('#ics-download').addEventListener('click', downloadIcs);
  setupInstallCard();
  setupSteppers();
  setupPeople();
  setupJumpNav();
  applySiteConfig();

  renderSources();
  renderHazardForm();
  refreshAll();
  if (state.homeEvac && !PREVIEW) showHomeEvac();

  if (PREVIEW) showTab(currentTab());
  else onHashChange();
  if (state.ruby) applyRuby();
}

init();
