/**
 * 情資戰情看板 — 直接寫入端點（Google Apps Script Web App）
 * ============================================================
 * 用途：讓看板「🔗 直接寫入 Google Sheet」能把新情資列附加到對應的「YYYY年M月」分頁，
 *       免去手動複製貼上。每一個「年度試算表」各部署一支（因為每年一個試算表）。
 *
 * 部署步驟（每個年度試算表做一次）：
 *   1. 開啟該年度的 Google 試算表 → 擴充功能 → Apps Script。
 *   2. 把本檔內容貼進去，存檔。
 *   3. 右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」。
 *      - 執行身分：我（你自己）
 *      - 具有存取權的使用者：任何人
 *   4. 複製產生的 Web App URL，貼到看板「情資維護 → 進階：直接寫入端點設定」。
 *
 * ※ 已部署舊版（固定欄位位置）的試算表請重新貼上本檔並「管理部署作業 → 編輯 → 新版本」，
 *   否則在欄位不同的分頁（例如 2026 年 11 月起多了 KEV／自動化利用二欄）會寫到錯的欄位。
 *
 * 安全性建議：若擔心被亂寫，設定下方 SECRET，並在看板端一併送出相同字串
 *           （可改 app.js 的 writeToSheet 加上 body.secret）。預設為空＝不驗證。
 */

var SECRET = ""; // 留空＝不驗證；要驗證就填一段隨機字串，並在前端送出相同值

// 各月分頁的欄位順序並不固定，因此一律依「標題列」找欄位，不寫死位置。
// 規則需與 assets/data.js 的 FIELDS、scripts/snapshot.py 的 HEADER_RULES 一致。
var HEADER_RULES = [
  ["date", /資料日期/],
  ["source", /^資料來源/],
  ["title", /資料標題/],
  ["url", /網址/],
  ["origin", /威脅情資來源/],
  ["category", /威脅情報類別/],
  ["severity", /威脅程度/],
  ["riskScope", /風險之層面|影響資通系統/],
  ["affected", /受影響/],
  ["countermeasure", /因應對策/],
  ["progress", /執行進度/],
  ["kev", /KEV|已知被利用/i],
  ["automatable", /自動化/],
  ["impact", /技術影響/],
  ["duePublic", /處置期限(?!.*未曝露)/],   // 弱點處置期限(曝露於公眾網路)
  ["dueInternal", /處置期限.*未曝露/]      // 弱點處置期限(未曝露於公眾網路)
];
// 允許由看板「編輯分類」更新的欄位
var EDITABLE = ["origin", "category", "severity", "riskScope", "countermeasure", "progress", "kev", "automatable",
  "impact", "duePublic", "dueInternal"];

// 讀標題列 → { 欄位鍵: 欄號(1-indexed) }
function headerMap(sh) {
  var width = Math.max(sh.getLastColumn(), 1);
  var labels = sh.getRange(1, 1, 1, width).getValues()[0];
  var map = {}, taken = {};
  labels.forEach(function (raw, i) {
    var lab = String(raw || "").replace(/\s+/g, "");
    if (!lab) return;
    for (var r = 0; r < HEADER_RULES.length; r++) {
      var key = HEADER_RULES[r][0];
      if (!map[key] && HEADER_RULES[r][1].test(lab)) { map[key] = i + 1; taken[i + 1] = 1; return; }
    }
  });
  // 前四欄在所有分頁都固定；標題格空白時以位置補上
  ["date", "source", "title", "url"].forEach(function (key, i) {
    if (!map[key] && !taken[i + 1]) { map[key] = i + 1; taken[i + 1] = 1; }
  });
  return map;
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (SECRET && data.secret !== SECRET) return json({ ok: false, error: "unauthorized" });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(data.sheet);
    if (!sh) return json({ ok: false, error: "找不到分頁：" + data.sheet });
    var col = headerMap(sh);

    // 動作 update：依「標題（＋連結）」找到既有列，更新分類欄位（客戶線上維護分類用）
    if (data.action === "update") {
      var values = sh.getDataRange().getValues();
      var f = data.fields || {};
      var tCol = col.title - 1, uCol = col.url - 1;
      for (var i = 1; i < values.length; i++) {
        var titleMatch = String(values[i][tCol]).trim() === String(data.title).trim();
        var urlMatch = !data.url || String(values[i][uCol]).trim() === String(data.url).trim();
        if (titleMatch && urlMatch) {
          var skipped = [];
          Object.keys(f).forEach(function (k) {
            if (EDITABLE.indexOf(k) < 0) return;
            if (col[k]) sh.getRange(i + 1, col[k]).setValue(f[k]);
            else skipped.push(k);   // 此分頁沒有這個欄位（例如舊月份沒有 KEV）
          });
          return json({ ok: true, action: "update", row: i + 1, skipped: skipped });
        }
      }
      return json({ ok: false, error: "找不到符合的列：" + data.title });
    }

    // 預設動作 append：新增一列（新增情資用）
    // 新版看板送 record（欄位物件）→ 依標題列放到正確欄位；舊版只送 row（已排好的陣列）。
    if (data.record) {
      var row = [];
      Object.keys(col).forEach(function (k) {
        var v = data.record[k];
        row[col[k] - 1] = v == null ? "" : v;
      });
      for (var c = 0; c < row.length; c++) if (row[c] === undefined) row[c] = "";
      sh.appendRow(row);
      return json({ ok: true, action: "append", appended: row.length });
    }
    if (!data.row) return json({ ok: false, error: "missing row" });
    sh.appendRow(data.row);
    return json({ ok: true, action: "append", appended: data.row.length });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, msg: "情資看板寫入端點運作中" });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
