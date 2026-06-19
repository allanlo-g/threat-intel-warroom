#!/usr/bin/env bash
# 企業情資戰情看板 - 本機啟動 (macOS / Linux)
cd "$(dirname "$0")" || exit 1
echo "唯讀看板： http://localhost:8080/index.html"
echo "維護後台： http://localhost:8080/maintenance.html"
( sleep 1; (command -v xdg-open >/dev/null && xdg-open http://localhost:8080/maintenance.html) \
  || (command -v open >/dev/null && open http://localhost:8080/maintenance.html) ) &
python3 -m http.server 8080
