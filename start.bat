@echo off
chcp 65001 >nul
echo ============================================
echo   企業情資戰情看板 - 本機啟動
echo   War-Room dashboard local launcher
echo ============================================
echo.
echo 啟動本機伺服器 http://localhost:8080 ...
echo 關閉視窗即可停止伺服器。
echo.
start "" http://localhost:8080/index.html
python -m http.server 8080
