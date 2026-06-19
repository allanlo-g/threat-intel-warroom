# 企業情資戰情看板（Threat-Intel War-Room）

一套**設定驅動的單頁靜態看板**，把你每月在 Google Sheet 維護的內外部資安情資，自動彙整成
**當月 + 年度累積**的即時統計戰情看板。同一份程式碼可服務多家企業，並支援
「**顧問統一維護標準來源 ⊕ 客戶自行客製**」的雙層機制。

- 本機雙擊 `start.bat` 即可開啟，也能整包上 GitHub Pages 當線上 Demo。
- 無需後端、無需建置（vanilla HTML/JS + Chart.js）。

## 兩種版本（重要）

`config/app.json` 的 `mode` 決定看板形態：

| 版本 | mode | 公司切換下拉 | 用途 |
|------|------|------|------|
| **顧問維護版** | `consultant` | 有 | 你自己用，切換維護多家客戶資料與標準來源（本專案根目錄即此版） |
| **客戶獨立版** | `client` | 無，鎖定單一公司 | 交接給客戶，安裝在客戶自己電腦的獨立網頁；客戶只看也只維護自己 |

客戶版**不是**靠下拉切換，而是用打包腳本為每家客戶各自產生一個獨立資料夾：
```
python scripts/package_client.py --id acme     # 產生 dist/acme/（單一公司、無切換）
python scripts/package_client.py --all          # 一次產生所有客戶
python scripts/package_client.py --id acme --refresh   # 先更新快照再打包
```
把 `dist/<id>/` 整包交給客戶，雙擊裡面的 `start.bat` 即可執行；客戶也可放自己的 GitHub Pages。

---

## 1. 快速開始

### 本機執行
```
雙擊 start.bat            (Windows)
# 或
python -m http.server 8080   →  瀏覽 http://localhost:8080
```
> 直接用 `file://` 雙擊 `index.html` 會被瀏覽器擋住讀取設定檔，請務必透過本機伺服器開啟。

### 上線 GitHub Pages
本專案已附自動部署設定 `.github/workflows/pages.yml`：
1. 將整個資料夾推上 GitHub repo（push 到 `main`）。
2. Settings → Pages → Source 選 **GitHub Actions**。
3. Actions 跑完即可用 `https://<帳號>.github.io/<repo>/` 開啟（已附 `.nojekyll`）。

> 預設部署的是「顧問維護版」（含切換）。若要公開某客戶獨立版，把 workflow 的 `path` 指向 `dist/<id>`。

### 離線可用
Chart.js 已內建於 `vendor/`（非 CDN），因此**客戶電腦完全離線**也能正常顯示圖表；
只有「🔄 即時更新」需要連到 Google Sheet，其餘（快照、統計、圖表、CSV 下載）皆可離線運作。

---

## 2. 功能總覽

| 分頁 | 內容 |
|------|------|
| 📊 戰情看板 | 當月／年度 KPI、威脅程度、情報類別、內外部占比、來源 Top10、全年趨勢、因應對策 |
| 📋 情資明細 | 當月（或全年）明細表，可搜尋、可**下載 CSV**（含 BOM，Excel 開中文不亂碼） |
| ✏️ 情資維護 | 用統一下拉新增情資（內外部/類別/威脅程度/影響系統/因應對策/進度），複製或匯出貼回 Sheet，或設定端點**直接寫入**（見第 5 節） |
| 🗂️ 來源維護 | 顯示生效中的來源（標準／自訂），可新增/隱藏來源、自訂因應對策，**匯出 company.json** |
| 📅 年度設定 | 維護各年度（含未來如 2027）對應的 Google 試算表，**匯出 companies.json** |
| ℹ️ 說明 | 看板架構說明 |

- 上方可切換**企業**、**年度**、**月份**（預設＝今天所在的年月）。
- 「🔄 即時更新」直接從 Google Sheet 抓取所選月份的最新資料（混合模式，見下）。

---

## 3. 雙層設定機制（顧問標準 ⊕ 客戶客製）

```
config/
  app.json                ← 模式設定（consultant 顧問版 / client 客戶版），見「兩種版本」
  companies.json          ← 企業清單 + 各企業的年度→試算表對應（顧問版用）
  standard-sources.json   ← 【顧問標準層】標準來源、威脅分類詞彙、因應對策範本（含 version）
  company.<id>.json       ← 【客戶客製層】在標準之上的 新增/隱藏/自訂 覆寫
data/
  snapshot.<id>.json      ← 各企業資料快照（離線 / Pages Demo 用）
```

**運作方式**：看板載入時把 `standard-sources.json` 與 `company.<id>.json` **合併**成「生效設定」。

`company.<id>.json` 可用的覆寫欄位：
```jsonc
{
  "basedOnStandard": "2026.06",        // 依據的標準版本；標準更新時看板會提示「建議檢視」
  "sourcesAdd":   [ {"short":"CISA","name":"...","url":"...","tags":["資安漏洞"]} ],
  "sourcesHide":  ["NCHU"],            // 隱藏不適用的標準來源
  "countermeasuresAdd": ["啟動緊急應變(IR)流程"],
  "taxonomyExtend": { "riskScope": ["OT/產線設備"] }
}
```

**客戶自行維護流程**：在「🗂️ 來源維護」頁直接新增/隱藏/自訂 → 變更會暫存在該瀏覽器 →
按「⬇️ 匯出本企業設定」下載 `company.<id>.json` → 交回顧問或自行 commit 到 repo 取代舊檔。
（顧問日後更新 `standard-sources.json` 的 `version`，客戶看板會提示標準層已更新。）

---

## 4. 資料來源（混合模式）

- **即時**：按「🔄 即時更新」時，瀏覽器以 Google `gviz` 介面直接讀取該年度試算表的「YYYY年M月」分頁。
  － 需求：該年度試算表需「知道連結的人可檢視」。
- **快照**：`data/snapshot.<id>.json`，供離線與 GitHub Pages Demo 使用（不必把客戶 Sheet 公開）。

### 重新產生快照
```
pip install openpyxl
python scripts/snapshot.py            # 依 companies.json 產生所有 active 企業
python scripts/snapshot.py --id demo  # 只做單一企業
```
快照腳本會自動：抓取各年度試算表 → 解析所有「YYYY年M月」分頁 → 正規化欄位 → 輸出 JSON。
（看板端另有正規化層，會把 `iTHome/ITHome`、`TWCERT/TWCET`、`Fisac/FICAS` 等大小寫/拼寫差異
與「外部/外部資訊」自動歸一，統計才乾淨。）

---

## 5. 情資維護（客戶自行維護的機制）

> 分工：顧問負責**蒐集事實**（日期／來源／標題／連結），客戶負責**判斷分類與對策**
> （內外部／類別／威脅程度／影響系統／因應對策）。以下兩種維護都用同一組下拉詞彙。

### 5.1 編輯既有情資的分類（Google Sheet 抓回來的資料）
在「📋 情資明細」勾選 **✏️ 編輯分類**（需先選單一月份）：
- 內外部／類別／威脅程度／影響系統／因應對策 變成下拉，**進度**為文字輸入，直接修改即可。
- 修改會**即時更新戰情看板統計**、以 ✎ 標記該列、並存於客戶瀏覽器（跨工作階段保留）。
- 「⬇️ 匯出分類修改」匯出已改的列；或設定端點後「🔗 寫回 Sheet」直接更新 Google Sheet 對應列
  （依「標題＋連結」比對既有列，更新那 5 個欄位）。

### 5.2 新增情資
「✏️ 情資維護」頁讓客戶用**統一下拉詞彙**
（內外部／威脅情報類別／威脅程度／影響系統／因應對策，選項來自「來源維護」所維護的詞彙）
填寫新情資，提供兩種寫回方式：

**① 免設定、可離線（預設）**
1. 填好表單 →「＋ 加入本月清單」（新列會立即反映在看板統計，並暫存於瀏覽器）。
2. 「📋 複製新增列」→ 到 Google Sheet 該月分頁最後一列貼上（欄位順序已對齊）；或「⬇️ 匯出新增列 CSV」。
3. 確認貼回後按「🗑 清空清單」。

**② 直接寫入 Google Sheet（選配，免手動貼上）**
1. 為該年度試算表部署一支 Apps Script Web App（範本見 `scripts/apps_script_endpoint.gs`，內含步驟）。
2. 把產生的 Web App URL 貼到「情資維護 → 進階：直接寫入端點設定」並儲存。
3. 之後填表按「🔗 直接寫入 Google Sheet」即依資料日期附加到對應「YYYY年M月」分頁，並自動回讀確認。

> 說明：表單以「新增情資列」為主（每月新增情資的 90% 情境）。若要**修改既有列**，請直接在 Google Sheet 編輯。
> 威脅程度／類別／因應對策等下拉清單，建議也在 Google Sheet 對應欄位設「資料驗證」用同一組詞彙，確保兩邊一致。

---

## 6. 新增一家客戶並交付（標準作業）

1. 在 `config/companies.json` 的 `companies` 加一筆：`id`、`name`、各年度試算表 ID（或在顧問版「年度設定」貼網址後匯出）。
2. 建立 `config/company.<id>.json`（可從 `company.demo.json` 複製；不客製就留空陣列）。
3. 執行 `python scripts/snapshot.py --id <id>` 產生快照。
4. 顧問版重新整理 → 上方「企業」下拉即可切到該客戶檢視/維護。
5. **交付客戶**：執行 `python scripts/package_client.py --id <id>`，把產生的 `dist/<id>/` 整包交給客戶。
   該資料夾是客戶獨立版（無公司切換、鎖定該客戶、附 `start.bat` 與 `README.txt`）。

> Sheet 結構需與範例一致：月份分頁命名「YYYY年M月」，欄位順序為
> 資料日期 / 資料來源 / 資料標題 / 訊息網址連結 / 威脅情資來源 / 威脅情報類別 /
> 對組織的現況威脅程度 / 風險之層面 / 受影響系統版本 / 因應對策 / 執行進度說明。

---

## 7. 檔案結構
```
index.html              看板頁面
assets/  styles.css     樣式
         data.js        設定載入 + Google Sheet 即時抓取 + 正規化
         stats.js       設定合併（標準⊕客製）+ 統計彙整
         ui.js          圖表 / 表格 / 編輯器渲染
         app.js         流程控制與事件
vendor/  chart.umd.min.js  Chart.js（本機內建，離線可用）
.github/workflows/pages.yml  GitHub Pages 自動部署
config/  app.json       模式設定（顧問版 / 客戶版）
         *.json         其餘設定（見第 3 節）
data/    snapshot.*.json 快照
scripts/ snapshot.py        快照產生器
         package_client.py  產生客戶獨立版 dist/<id>/
         apps_script_endpoint.gs  直接寫入端點範本（選配）
start.bat / start.sh    本機啟動
dist/    <id>/          客戶交付資料夾（打包產出，預設不進 Git）
```

---

## 版權宣告

- 製作：**Allan Lo 顧問**
- Email：allanlo.plus@gmail.com
- 網站：http://www.123hi.org
- © 2026 年 6 月　版權所有
