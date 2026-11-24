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
echo 唯讀看板：  http://localhost:8080/index.html
echo 維護後台：  http://localhost:8080/maintenance.html
echo.
start "" http://localhost:8080/maintenance.html
python -m http.server 8080
