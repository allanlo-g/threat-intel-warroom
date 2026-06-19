#!/usr/bin/env bash
# 企業情資戰情看板 - 本機啟動 (macOS / Linux)
cd "$(dirname "$0")" || exit 1
echo "啟動本機伺服器 http://localhost:8080 ..."
( sleep 1; (command -v xdg-open >/dev/null && xdg-open http://localhost:8080/index.html) \
  || (command -v open >/dev/null && open http://localhost:8080/index.html) ) &
python3 -m http.server 8080
