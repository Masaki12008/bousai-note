# わが家の防災ノート

災害のときの行動、家族の無事の確かめ方、災害の種類ごとの避難場所、家族の決め事、備蓄の準備を1つにまとめた、無料・登録なしの Web ツールです。

- サーバーを持たない静的なサイトです。入力した内容は、使う人の端末（ブラウザ）の中だけに保存されます
- 避難場所は、国土地理院「指定緊急避難場所データ」を使います（住所で探すときだけ、住所の文字を国土地理院のサービスに送ります）
- このツールは個人が作った非公式のもので、国や自治体とは関係ありません。避難の判断は、市区町村の発表とハザードマップをもとに行ってください

**現在は公開前の確認中です**（検索エンジンには載せていません）。

## 組み立て

```sh
python3 build-site.py --noindex   # 確認用（検索に載せない）
python3 build-site.py --release   # 本公開用（site-config.js の contact と siteUrl が必要）
```

`dist/` に組み立てたものを GitHub Pages で公開します（`.github/workflows/pages.yml`）。

## 試験

```sh
python3 -m http.server 8765 &            # このフォルダで
(cd dist && python3 -m http.server 8767 &)
node tests/e2e.mjs && node tests/e2e-phase2.mjs && node tests/e2e-site.mjs
```

## ライセンス

地図の表示に [Leaflet](https://leafletjs.com/)（BSD-2-Clause、`vendor/leaflet/LICENSE`）を使っています。
