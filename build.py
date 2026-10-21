"""index.html / style.css / app.js をまとめて、1ファイル版 habit-app.html を作る。

使い方:  python3 build.py
編集は分割版のファイルで行い、配布・利用するときにこのスクリプトで1ファイル版を作り直す。
"""
from pathlib import Path

ROOT = Path(__file__).parent
CSS_TAG = '<link rel="stylesheet" href="style.css" />'
JS_TAG = '<script src="app.js"></script>'

html = (ROOT / "index.html").read_text(encoding="utf-8")
css = (ROOT / "style.css").read_text(encoding="utf-8")
js = (ROOT / "app.js").read_text(encoding="utf-8")

# 置き換え先のタグが見つからない場合は、壊れたファイルを作らずに止める
for tag in (CSS_TAG, JS_TAG):
    if tag not in html:
        raise SystemExit(f"index.html に {tag} が見つかりません")

html = html.replace(CSS_TAG, f"<style>\n{css}\n</style>")
html = html.replace(JS_TAG, f"<script>\n{js}\n</script>")

out = ROOT / "habit-app.html"
out.write_text(html, encoding="utf-8")
print(f"作成しました: {out.name} ({len(html.encode('utf-8')) // 1024}KB)")
