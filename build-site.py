"""公開用のサイトを dist/ に組み立てる。

使い方: python3 build-site.py [--release] [出力先フォルダ（省略時は dist）]

--release：公開用。問い合わせ先（contact）とサイトのURL（siteUrl）が空なら止める。
--noindex：公開前の確認用。検索エンジンに載せない（全ページに noindex、robots.txt で全体を拒否）。

- トップと、機能ごとのページ（備蓄の計算・避難場所・決め事・171の使い方）を、同じアプリ（index.html）から作る。
  ページごとに title・description・見出し・説明文・よくある質問を変え、最初に開くタブを変える。
- 運営者情報・免責事項・プライバシーポリシー・防災用品の選び方のページを作る。
- 設定は site-config.js から読む（siteUrl があれば canonical・OGP・sitemap.xml を出す）。
"""
import hashlib
import html
import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).parent
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
RELEASE = '--release' in sys.argv[1:]
NOINDEX = '--noindex' in sys.argv[1:]
OUT = Path(ARGS[0]) if ARGS else HERE / 'dist'

ASSETS = ['style.css', 'app.js', 'data.js', 'site-config.js', 'manifest.json', 'icon.svg',
          'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']


def read_config():
    text = (HERE / 'site-config.js').read_text(encoding='utf-8')
    return {k: v for k, v in re.findall(r"^\s*(\w+):\s*'([^']*)'", text, re.M)}


CONFIG = read_config()
SITE_URL = CONFIG.get('siteUrl', '')
AMAZON_TAG = CONFIG.get('amazonTag', '')
RAKUTEN_ID = CONFIG.get('rakutenAffiliateId', '')
CONTACT = CONFIG.get('contact', '')
HAS_AFFILIATE = bool(AMAZON_TAG or RAKUTEN_ID)
if RELEASE and not (SITE_URL and CONTACT):
    sys.exit('公開用（--release）には、site-config.js の contact と siteUrl の両方が必要です。')
SITE_NAME = 'わが家の防災ノート'

# ---------- アプリのページ ----------

APP_PAGES = [
    {
        'path': '', 'tab': 'guide',
        'title': 'わが家の防災ノート｜避難場所・家族の決め事・備蓄を1つに【無料・登録なし】',
        'description': '災害の種類ごとの避難場所、家族の集合場所や連絡方法、家族の人数に合わせた備蓄と持ち出し袋のチェックを、1つの画面で。登録なし・無料で、入力した内容は端末の外に送りません。',
        'h1': 'わが家の防災ノート',
        'intro': ['いざという時の行動と家族の無事の確かめ方、災害の種類ごとの避難場所、家族の決め事、備蓄をまとめた無料のツールです。',
                  '登録は不要です。入力した内容は、この端末の中だけに保存されます。'],
        'faq': [
            ('お金はかかりますか？', '無料です。登録やログインもいりません。'),
            ('入力した内容はどこに保存されますか？', 'お使いの端末（スマホやパソコン）の中だけに保存されます。運営者のサーバーには送られません。住所で避難場所を探すときだけ、位置を調べるために住所の文字を国土地理院のサービスに送ります。'),
            ('電波がないときも使えますか？', '一度開いた端末なら、この画面の文章、自宅の周りの避難場所、入力した決め事と備えは、電波がなくても見られます。ホーム画面に追加しておくと、すぐに開けます。'),
        ],
    },
    {
        'path': 'bichiku', 'tab': 'stock',
        'title': '防災備蓄リストの計算｜家族の人数で必要な量がわかる【水・食料・トイレ】',
        'description': '家族の人数（大人・高齢者・子ども・乳児・ペット）を入れると、水・食料・携帯トイレなど防災の備蓄の目安量を計算。今ある量を入れると足りないものが分かり、持ち出し袋のチェックリストも使えます。',
        'h1': '防災備蓄の計算（家族の人数で必要な量がわかる）',
        'intro': ['家族の人数と備える日数を入れると、水・食料・携帯トイレなどの目安の量が出ます。今ある量を入れると、足りないものが分かります。',
                  '乳児・高齢者・介護・ペット・一人暮らしにも合わせて、必要な物が変わります。'],
        'faq': [
            ('水は1人何リットル必要ですか？', '飲み水と調理用で、1人1日3リットルが目安です。最低3日分、できれば7日分を備えましょう。トイレや洗い物に使う生活用水は別に考えます（風呂の水をためておくなど）。'),
            ('携帯トイレはどれくらい必要ですか？', '1人1日5回が目安とされています。家族4人・7日分なら140回分です。大きな地震のあとは、水が出ていても排水管が壊れていることがあるため、安全が分かるまで水洗トイレは流さずに使います。'),
            ('何から備えればいいですか？', 'まずは水・携帯トイレ・食料・明かりの4つからです。ふだん食べている物を少し多めに買い、使ったら買い足す「ローリングストック」が続けやすい方法です。'),
        ],
    },
    {
        'path': 'hinan', 'tab': 'evac',
        'title': '災害の種類ごとの避難場所を調べる｜洪水・土砂・地震・津波【指定緊急避難場所】',
        'description': '住所や現在地から、洪水・土砂災害・地震・津波など災害の種類ごとに近くの指定緊急避難場所を表示。ハザードマップを見ながら自宅の危険を確かめ、避難が必要か、家にとどまれるかの目安も分かります。',
        'h1': '災害の種類ごとの避難場所を調べる',
        'intro': ['避難場所は、災害の種類によって使える場所が違います。地震では使えても、洪水では使えない場所もあります。',
                  '住所や現在地から、災害の種類ごとに近くの指定緊急避難場所を表示します。まず自宅の危険をハザードマップで確かめましょう。'],
        'faq': [
            ('指定緊急避難場所と指定避難所の違いは？', '指定緊急避難場所は、命を守るためにまず逃げる場所です。指定避難所は、家に戻れないときに過ごす場所です。同じ場所が両方に指定されていることもあります。'),
            ('一番近い避難場所に行けばいいですか？', '近い場所が安全とは限りません。川の向こう側や、浸水・土砂の危険がある道を通る場所もあります。避難場所と道順は、ハザードマップで事前に確かめてください。'),
            ('必ず避難所に行かないといけませんか？', 'いいえ。ハザードマップで自宅が危険な区域の外にあり、家が無事なら、家で過ごす在宅避難も選べます。安全な親戚・知人の家に避難する方法もあります。'),
        ],
    },
    {
        'path': 'kimegoto', 'tab': 'rules',
        'title': '家族の防災の決め事テンプレート｜集合場所・連絡方法・避難先を決めて共有',
        'description': '災害のときの集合場所、災害の種類ごとの避難先、171で使う電話番号、いつ動き始めるか（マイ・タイムライン）などを家族で決めて保存。LINEなどで家族に送ったり、印刷したりできます。',
        'h1': '家族の防災の決め事（集合場所・連絡方法・避難先）',
        'intro': ['災害が起きたとき、家族が別々の場所にいることはよくあります。集合場所や連絡の方法を、ふだんから決めておきましょう。',
                  '書いた内容は、リンクや文章で家族に送れます。印刷して、財布や持ち出し袋にも入れておきましょう。'],
        'faq': [
            ('家族で何を決めておけばいいですか？', '家の近くの集合場所、災害の種類ごとの避難先、171で伝言に使う電話番号、遠くの親戚など連絡の中継をお願いする人、子どもや家族の迎えの担当、いつ動き始めるかの合図です。'),
            ('マイ・タイムラインとは？', '大雨や台風のときに、どの情報が出たら、誰が、どこへ動き始めるかを、あらかじめ決めておくことです。たとえば「レベル3が出たら、祖母を連れて親戚の家へ」のように決めます。'),
            ('共有リンクを送っても大丈夫ですか？', '共有リンクには決め事の内容そのものが入っていて、リンクを知っている人は誰でも読めます。家族以外には送らないでください。持病などの健康のことは、初めは含めない設定になっています。'),
        ],
    },
    {
        'path': '171', 'tab': 'guide',
        'title': '災害用伝言ダイヤル171の使い方｜録音・再生の手順と体験できる日',
        'description': '災害用伝言ダイヤル171の録音（171→1）と再生（171→2）の手順、web171・携帯電話会社の災害用伝言板の使い方、ふだんから練習できる体験利用日をまとめました。',
        'h1': '災害用伝言ダイヤル171の使い方',
        'intro': ['大きな災害の直後は、電話がつながりにくくなります。家族の無事は、171やweb171などの伝言サービスで確かめましょう。',
                  '伝言を残す：171 → 1 → 電話番号。伝言を聞く：171 → 2 → 電話番号。家族全員が同じ電話番号を使うことが大事です。'],
        'faq': [
            ('171はいつ使えますか？', '大きな災害が起きたときに提供が始まります。ふだんも、毎月1日・15日、正月三が日、防災とボランティア週間（1月15日〜21日）、防災週間（8月30日〜9月5日）に体験できます。'),
            ('どの電話番号で伝言を残せばいいですか？', '家族で決めた1つの番号（自宅の固定電話など）です。固定電話がなければ、家族の誰かの携帯電話の番号で構いません。家族全員が同じ番号を使います。'),
            ('格安SIMでも使えますか？', '171は固定電話・携帯電話から使えます（一部使えない場合があります）。携帯電話会社の災害用伝言板は会社によって違うため、格安SIMの場合はインターネットで使えるweb171やJ-anpiが確実です。'),
        ],
    },
]

# ---------- 防災用品の選び方 ----------

GUIDES = [
    {
        'slug': 'water', 'name': '飲料水', 'keyword': '保存水',
        'lead': '飲み水と調理に使う水です。1人1日3リットルが目安で、最低3日分、できれば7日分を備えます。',
        'points': [
            '長く保存できる「保存水」（5年・7年など）と、ふだん飲んでいるミネラルウォーターを多めに買って回す方法（ローリングストック）があります。続けやすい方を選びましょう。',
            '家に置くのは2リットルのボトル、持ち出し袋には500ミリリットルのボトルが使いやすいです。',
            '直射日光の当たらない涼しい場所に、何か所かに分けて置くと、家具が倒れても取り出しやすくなります。',
            '粉ミルクを作る水は、軟水を選びます。',
            'トイレや洗い物に使う生活用水は別に考えます（風呂の水をためておく、給水袋・ポリタンクを用意する）。',
        ],
    },
    {
        'slug': 'food', 'name': '非常食（主食・おかず）', 'keyword': '非常食 セット',
        'lead': '1人1日3食が目安です。調理しなくても、お湯や水だけで食べられる物があると安心です。',
        'points': [
            'ふだん食べているレトルト食品・缶詰・乾麺などを多めに買い、使ったら買い足すのが続けやすい方法です。',
            'アルファ米やパンの缶詰など、長く保存できる物も組み合わせます。缶切りがいらない物を選びましょう。',
            '食物アレルギー・飲み込みにくい人の介護食・乳児の離乳食は、避難所では手に入りにくいので、家族に合わせて多めに。',
            '甘い物や好きなお菓子は、気持ちを落ち着かせるのにも役立ちます。',
            'お湯をわかすカセットコンロとボンベもあわせて備えます。',
        ],
    },
    {
        'slug': 'toilet', 'name': '携帯トイレ', 'keyword': '携帯トイレ 防災',
        'lead': '見落とされやすい備えです。1人1日5回が目安とされていて、家族4人・7日分なら140回分になります。',
        'points': [
            '便器にかぶせる袋と、固める薬（凝固剤）がセットになった物が一般的です。回数分そろっているかを確かめます。',
            '大きな地震のあとは、水が出ていても排水管が壊れていることがあります。安全が分かるまで水洗トイレは流さず、携帯トイレを使います。マンションでは特に注意が必要です。',
            'においを防ぐ袋や、使い終わった袋を保管するふた付きの容器もあると安心です。',
            '保存できる年数を確かめて、期限が近づいたら入れ替えましょう。',
        ],
    },
    {
        'slug': 'light', 'name': '懐中電灯・ランタン・乾電池', 'keyword': 'LED ランタン 防災',
        'lead': '停電の夜に必要です。1人1つの懐中電灯と、部屋全体を照らすランタンがあると便利です。',
        'points': [
            '電池の持ちがよいLEDの物を選びます。',
            '頭につけるヘッドライトは、両手が使えるので片付けや避難のときに役立ちます。',
            '使う電池の種類（単3など）をそろえると、予備の電池を共有できます。',
            'ろうそくは、地震の揺れなどで火事の原因になるので避けましょう。',
            '寝る場所のそばにも1つ置いておきます。',
        ],
    },
    {
        'slug': 'battery', 'name': 'モバイルバッテリー', 'keyword': 'モバイルバッテリー',
        'lead': '災害のときは、スマホが連絡・情報・明かりの頼りになります。大人1人1個が目安です。',
        'points': [
            'スマホを何回充電できるか（容量）を確かめて選びます。',
            'いざという時に空にならないよう、ふだんから充電しておきます。',
            '乾電池で充電できる物や、手回し・太陽光で充電できる物もあると、停電が長いときに安心です。',
            '安全のため、PSEマークの付いた物を選び、熱くなる場所に置かないようにします。',
        ],
    },
    {
        'slug': 'stove', 'name': 'カセットコンロとボンベ', 'keyword': 'カセットコンロ',
        'lead': '電気やガスが止まったときに、お湯をわかしたり、温かい食事を作ったりできます。',
        'points': [
            'ボンベは家族の人数と日数に合わせて多めに。目安はツールの「備え」で計算できます。',
            'ボンベはコンロと同じメーカーの物を使うよう、取扱説明書で確かめます。',
            'ボンベやコンロにも使用期限の目安があります。製品の表示を確かめ、古い物は入れ替えましょう。',
            '使うときは換気をします。コンロを2台並べたり、大きな鍋でボンベを覆ったりしないようにします。',
        ],
    },
]


def amazon_url(keyword):
    url = f'https://www.amazon.co.jp/s?k={quote(keyword)}'
    return url + (f'&tag={quote(AMAZON_TAG)}' if AMAZON_TAG else '')


def rakuten_url(keyword):
    search = f'https://search.rakuten.co.jp/search/mall/{quote(keyword)}/'
    if RAKUTEN_ID:
        # 楽天アフィリエイトのリンク形式は、公開前に楽天の管理画面で作るリンクと照合すること
        return f'https://hb.afl.rakuten.co.jp/hgc/{quote(RAKUTEN_ID)}/?pc={quote(search, safe="")}&m={quote(search, safe="")}'
    return search


# ---------- 共通の部品 ----------

def esc(text):
    return html.escape(text, quote=True)


def seo_head(title, description, path, root):
    parts = [
        f'<meta name="description" content="{esc(description)}">',
        f'<meta property="og:title" content="{esc(title)}">',
        f'<meta property="og:description" content="{esc(description)}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:site_name" content="{SITE_NAME}">',
        '<meta property="og:locale" content="ja_JP">',
        '<meta name="twitter:card" content="summary">',
    ]
    if NOINDEX:
        parts.append('<meta name="robots" content="noindex, nofollow">')
    if SITE_URL:
        url = SITE_URL + (f'{path}/' if path else '')
        parts += [f'<link rel="canonical" href="{esc(url)}">',
                  f'<meta property="og:url" content="{esc(url)}">',
                  f'<meta property="og:image" content="{esc(SITE_URL)}icon-512.png">']
    return '\n'.join(parts)


def json_ld(data):
    return f'<script type="application/ld+json">{json.dumps(data, ensure_ascii=False)}</script>'


def prefix_relative(markup, root):
    """サブフォルダのページでは、相対パスの href・src の先頭に root を付ける。"""
    if root == './':
        return markup

    def fix(m):
        attr, url = m.group(1), m.group(2)
        if re.match(r'^(https?:|#|tel:|mailto:|data:|/)', url):
            return m.group(0)
        return f'{attr}="{root}{url}"'
    return re.sub(r'\b(href|src)="([^"]*)"', fix, markup)


def footer_links(root):
    links = [('', 'トップ'), ('bichiku/', '防災備蓄の計算'), ('hinan/', '災害の種類ごとの避難場所'), ('kimegoto/', '家族の防災の決め事'),
             ('171/', '災害用伝言ダイヤル171の使い方'), ('erabikata/', '防災用品の選び方'), ('about/', '運営者情報'),
             ('disclaimer/', '免責事項'), ('privacy/', 'プライバシーポリシー')]
    return '<nav class="footer-links" aria-label="サイトの案内">' + ''.join(
        f'<a href="{root}{href or "./"}">{text}</a>' if href else f'<a href="{root}">{text}</a>' for href, text in links) + '</nav>'


# ---------- アプリのページを作る ----------

def build_app_pages():
    template = (HERE / 'index.html').read_text(encoding='utf-8')
    sitemap = []
    for page in APP_PAGES:
        root = '../' if page['path'] else './'
        markup = template.replace('<title>わが家の防災ノート</title>', f'<title>{esc(page["title"])}</title>')
        markup = markup.replace('<!--SEO_HEAD-->', seo_head(page['title'], page['description'], page['path'], root) + '\n' + json_ld({
            '@context': 'https://schema.org', '@type': 'WebApplication', 'name': SITE_NAME, 'applicationCategory': 'UtilitiesApplication',
            'operatingSystem': 'Any', 'inLanguage': 'ja', 'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'JPY'},
            'description': page['description'],
        }))
        intro = f'<section class="intro"><h1>{esc(page["h1"])}</h1>' + ''.join(f'<p>{esc(p)}</p>' for p in page['intro']) + '</section>'
        faq = ('<section class="faq"><h2 class="section-title">よくある質問</h2>'
               + ''.join(f'<details><summary>{esc(q)}</summary><div class="detail-body"><p>{esc(a)}</p></div></details>' for q, a in page['faq'])
               + '</section>' + json_ld({'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [
                   {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in page['faq']]}))
        markup = markup.replace('<!--INTRO-->', intro).replace('<!--FAQ-->', faq)
        markup = markup.replace('<body data-root="./" data-default-tab="guide">', f'<body data-root="{root}" data-default-tab="{page["tab"]}">')
        markup = prefix_relative(markup, root)
        target = OUT / page['path'] / 'index.html' if page['path'] else OUT / 'index.html'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(markup, encoding='utf-8')
        sitemap.append(f'{page["path"]}/' if page['path'] else '')
    return sitemap


# ---------- 文章だけのページを作る ----------

def static_page(path, title, description, body_html):
    root = '../' * (path.count('/') + 1)
    page = f'''<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{esc(title)}｜{SITE_NAME}</title>
{seo_head(title, description, path, root)}
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'self'; form-action 'none'">
<link rel="stylesheet" href="{root}style.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&amp;family=Zen+Maru+Gothic:wght@700&amp;display=swap">
<link rel="icon" href="{root}icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="{root}apple-touch-icon.png">
<meta name="theme-color" content="#2F5D8A">
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <div class="brand">
      <svg class="logo" width="36" height="36" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 30 L32 12 L54 30"></path><path d="M16 26 V52 H48 V26"></path><path d="M26 52 V38 H38 V52"></path></svg>
      <div><p class="brand-name"><a href="{root}">{SITE_NAME}</a></p><p class="brand-sub">いえのこと帖</p></div>
    </div>
  </div>
</header>
<main class="wrap page">
{body_html}
<p><a class="btn primary" href="{root}">ツールを使う</a></p>
</main>
<footer class="site-footer page-footer">
  <div class="wrap">
    <p>このサイトは個人が作った非公式のもので、国や自治体とは関係ありません。</p>
    {'<p>このサイトには、商品を紹介する広告（アフィリエイト）リンクを含むページがあります。</p>' if HAS_AFFILIATE else ''}
    {footer_links(root)}
  </div>
</footer>
</body>
</html>
'''
    target = OUT / path / 'index.html'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(page, encoding='utf-8')


def contact_html():
    if not CONTACT:
        return '<p>（問い合わせ先は準備中です）</p>'
    if CONTACT.startswith('http'):
        return f'<p><a href="{esc(CONTACT)}" target="_blank" rel="noopener">お問い合わせフォーム</a></p>'
    return f'<p>メール：{esc(CONTACT)}</p>'


def build_static_pages():
    paths = []
    static_page('about', '運営者情報', 'わが家の防災ノートの運営者と、このサイトを作った目的です。', f'''
<h1>運営者情報</h1>
<h2>運営者</h2>
<p>いえのこと帖（長野県に住む会社員の夫婦が、家族の防災のために作っています）</p>
<h2>このサイトの目的</h2>
<p>災害の種類ごとの避難場所、家族の決め事、備蓄の準備を、誰でも無料で、登録なしで使えるようにするためのツールです。入力した内容は運営者には届かず、使う人の端末の中だけに保存されます。</p>
<h2>情報の確かめ方</h2>
<p>運営者は防災の専門家ではありません。内容は、国・気象庁・自治体などの公開資料をもとに作っています。制度や名前は変わることがあるため、年に1回以上、出水期の前に見直します。誤りを見つけた場合は、下の問い合わせ先からお知らせください。</p>
<h2>お問い合わせ</h2>
{contact_html()}
''')
    paths.append('about/')
    static_page('disclaimer', '免責事項', 'わが家の防災ノートの免責事項です。', '''
<h1>免責事項</h1>
<ul>
<li>このサイトは個人が作った非公式のもので、国・自治体・気象庁・国土地理院とは関係ありません。</li>
<li>掲載している情報は、正確さや最新であることを保証できません。避難の判断は、市区町村の発表とハザードマップをもとに行ってください。</li>
<li>避難場所は、国土地理院「指定緊急避難場所データ」を加工して表示しています。データは市区町村が作成したもので、未登録や更新の遅れがあります。指定されていても、災害のときに開いているとは限りません。</li>
<li>距離は直線距離です。避難場所までの道の安全は考えていません。</li>
<li>備蓄の量は一般的な目安です。家族の状況や地域に合わせて調整してください。</li>
<li>このサイトの利用によって生じた損害について、運営者は責任を負いません。</li>
<li>このサイトからリンクしている外部のサイトの内容について、運営者は責任を負いません。</li>
</ul>
''')
    paths.append('disclaimer/')
    affiliate = ('<h2>広告（アフィリエイト）について</h2><p>防災用品の選び方のページには、Amazon・楽天市場などの商品を紹介する広告リンクがあります。リンクから商品を購入すると、運営者に紹介料が支払われることがあります。そのため、各ショップがCookieを使うことがあります。商品の価格や在庫は、各ショップで確かめてください。避難場所や「いざという時」の画面には広告を置きません。</p>'
                 if HAS_AFFILIATE else '')
    static_page('privacy', 'プライバシーポリシー', 'わが家の防災ノートで入力した内容の扱いについてです。', f'''
<h1>プライバシーポリシー</h1>
<h2>入力した内容の保存</h2>
<p>家族の決め事・家族の人数・備蓄の量・チェックリストなど、入力した内容は、お使いの端末のブラウザの中（localStorage）だけに保存します。運営者のサーバーには送りません。運営者は、入力した内容を見ることができません。</p>
<h2>外部のサービスに送る情報</h2>
<ul>
<li>住所で避難場所を探すとき：位置を調べるため、入力した住所の文字を国土地理院の住所検索サービスに送ります。</li>
<li>避難場所と地図：国土地理院のデータと地図を読み込みます。そのとき、表示している場所の周りの地図の範囲が国土地理院に伝わります。</li>
<li>現在地で探すとき：端末の位置情報を、その検索にだけ使います。保存はしません。</li>
<li>文字の書体：Google Fonts を使うため、閲覧したときのIPアドレスなどがGoogleに送られます。</li>
</ul>
<h2>共有リンク</h2>
<p>「家族にリンクを送る」で作るリンクには、決め事の内容そのものが入っています。リンクを知っている人は誰でも内容を読めます。家族以外には送らないでください。持病などの健康のことは、初めは含めない設定になっています。</p>
<h2>アクセス解析</h2>
<p>現在、アクセス解析のツールは使っていません。使い始める場合は、このページでお知らせします。</p>
{affiliate}
<h2>お問い合わせ</h2>
{contact_html()}
''')
    paths.append('privacy/')

    items = ''.join(f'<li><a href="{g["slug"]}/">{esc(g["name"])}</a></li>' for g in GUIDES)
    static_page('erabikata', '防災用品の選び方', '防災の備蓄で特に大切な、水・非常食・携帯トイレ・明かり・モバイルバッテリー・カセットコンロの選び方。',
                f'<h1>防災用品の選び方</h1><p>まず備えたいものの選び方をまとめました。必要な量は、ツールの「備え」で家族の人数から計算できます。</p><ul>{items}</ul>')
    paths.append('erabikata/')
    for g in GUIDES:
        shop = ''
        pr = '<p class="pr">PR</p>' if HAS_AFFILIATE else ''
        rel = 'sponsored noopener' if HAS_AFFILIATE else 'noopener'
        shop = (f'<h2>探す</h2><p>選ぶときの目安を確かめてから、各ショップで探せます。</p><div class="shop-links">'
                f'<a class="btn" href="{esc(amazon_url(g["keyword"]))}" target="_blank" rel="{rel}" referrerpolicy="origin">Amazonで「{esc(g["keyword"])}」を探す</a>'
                f'<a class="btn" href="{esc(rakuten_url(g["keyword"]))}" target="_blank" rel="{rel}" referrerpolicy="origin">楽天市場で「{esc(g["keyword"])}」を探す</a></div>')
        points = ''.join(f'<li>{esc(p)}</li>' for p in g['points'])
        static_page(f'erabikata/{g["slug"]}', f'{g["name"]}の選び方', g['lead'], f'''
<p class="breadcrumb"><a href="../">防災用品の選び方</a> ＞ {esc(g["name"])}</p>
{pr}
<h1>{esc(g["name"])}の選び方</h1>
<p>{esc(g["lead"])}</p>
<h2>選ぶときのポイント</h2>
<ul>{points}</ul>
<h2>家族に必要な量</h2>
<p><a href="../../bichiku/">防災備蓄の計算</a>で、家族の人数と日数から目安の量が分かります。</p>
{shop}
''')
        paths.append(f'erabikata/{g["slug"]}/')
    return paths


# ---------- 組み立て ----------

def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for name in ASSETS:
        shutil.copy2(HERE / name, OUT / name)
    shutil.copytree(HERE / 'vendor', OUT / 'vendor')

    pages = build_app_pages() + build_static_pages()

    # Service Worker：アプリのページと必要なファイルを最初に保存する
    sw = (HERE / 'sw.js').read_text(encoding='utf-8')
    precache = ['./'] + [p for p in pages if p] + [a for a in ASSETS if a != 'icon-maskable-512.png'] + ['vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css']
    sw = re.sub(r"const APP_FILES = \[.*?\];", 'const APP_FILES = ' + json.dumps(precache, ensure_ascii=False) + ';', sw, flags=re.S)
    # 中身が変わったら保存の名前も変え、古い保存を入れ替える
    digest = hashlib.sha256(b''.join((OUT / p).read_bytes() for p in sorted(str(f.relative_to(OUT)) for f in OUT.rglob('*') if f.is_file()))).hexdigest()[:10]
    sw = re.sub(r"const CACHE = '[^']*';", f"const CACHE = 'bousai-{digest}';", sw)
    (OUT / 'sw.js').write_text(sw, encoding='utf-8')

    robots = 'User-agent: *\nDisallow: /\n' if NOINDEX else 'User-agent: *\nAllow: /\n'
    if SITE_URL and not NOINDEX:
        urls = ''.join(f'<url><loc>{esc(SITE_URL + p)}</loc></url>' for p in pages)
        (OUT / 'sitemap.xml').write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n', encoding='utf-8')
        robots += f'Sitemap: {SITE_URL}sitemap.xml\n'
    (OUT / 'robots.txt').write_text(robots, encoding='utf-8')
    (OUT / '.nojekyll').write_text('', encoding='utf-8')
    print(f'wrote {OUT} ({len(pages)} pages)')


main()
