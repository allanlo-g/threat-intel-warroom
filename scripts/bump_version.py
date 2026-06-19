# -*- coding: utf-8 -*-
"""
Bump the cache-busting version on the dashboard assets.

顧問每次改完前端程式（assets/*.js、styles.css）後執行本腳本，會把 index.html 上
所有資產的 ?v=... 版本號換成新值，客戶重新整理即會自動載入新版（破除瀏覽器快取）。

用法：
    python scripts/bump_version.py                 # 版本＝今天時間戳 (YYYY.MM.DD.HHMM)
    python scripts/bump_version.py --version 2026.07  # 指定版本字串
    python scripts/bump_version.py --package          # 順便重新打包所有客戶版 dist/

只動 index.html；dist/ 由 package_client.py 重新產生，故建議搭配 --package 一起執行。
"""
import argparse
import io
import os
import re
import subprocess
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
ASSETS = ["assets/styles.css", "assets/data.js", "assets/stats.js", "assets/ui.js", "assets/app.js"]


def log(m):
    sys.stdout.write(m + "\n"); sys.stdout.flush()


def bump(version):
    html = io.open(INDEX, encoding="utf-8").read()
    changed = 0
    for asset in ASSETS:
        # match  href/src="<asset>"  or  "<asset>?v=anything"  -> set ?v=<version>
        pat = re.compile(r'(href|src)="(' + re.escape(asset) + r')(\?v=[^"]*)?"')

        def repl(m):
            return m.group(1) + '="' + m.group(2) + "?v=" + version + '"'

        html, n = pat.subn(repl, html)
        changed += n
    io.open(INDEX, "w", encoding="utf-8").write(html)
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", help="explicit version string (default: timestamp)")
    ap.add_argument("--package", action="store_true", help="also re-package all client builds")
    args = ap.parse_args()

    version = args.version or datetime.now().strftime("%Y.%m.%d.%H%M")
    n = bump(version)
    log("已將 %d 個資產版本更新為 ?v=%s（index.html）" % (n, version))
    if n == 0:
        log("警告：未找到資產引用，請確認 index.html 的 <script>/<link> 路徑。")

    if args.package:
        log("重新打包客戶版 ...")
        subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "package_client.py"), "--all"], check=False)
    else:
        log("提醒：如需同步客戶交付版，請執行  python scripts/package_client.py --all")


if __name__ == "__main__":
    main()
