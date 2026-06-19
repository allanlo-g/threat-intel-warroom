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
 * 安全性建議：若擔心被亂寫，設定下方 SECRET，並在看板端一併送出相同字串
 *           （可改 app.js 的 writeToSheet 加上 body.secret）。預設為空＝不驗證。
 */

var SECRET = ""; // 留空＝不驗證；要驗證就填一段隨機字串，並在前端送出相同值

// 欄位對應（1-indexed）：1日期 2來源 3標題 4連結 5內外部 6類別 7威脅程度 8影響系統 9受影響版本 10因應對策 11進度
var COL = { origin: 5, category: 6, severity: 7, riskScope: 8, countermeasure: 10, progress: 11 };

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (SECRET && data.secret !== SECRET) return json({ ok: false, error: "unauthorized" });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(data.sheet);
    if (!sh) return json({ ok: false, error: "找不到分頁：" + data.sheet });

    // 動作 update：依「標題（＋連結）」找到既有列，更新分類欄位（客戶線上維護分類用）
    if (data.action === "update") {
      var values = sh.getDataRange().getValues();
      var f = data.fields || {};
      for (var i = 1; i < values.length; i++) {
        var titleMatch = String(values[i][2]).trim() === String(data.title).trim();
        var urlMatch = !data.url || String(values[i][3]).trim() === String(data.url).trim();
        if (titleMatch && urlMatch) {
          Object.keys(f).forEach(function (k) {
            if (COL[k]) sh.getRange(i + 1, COL[k]).setValue(f[k]);
          });
          return json({ ok: true, action: "update", row: i + 1 });
        }
      }
      return json({ ok: false, error: "找不到符合的列：" + data.title });
    }

    // 預設動作 append：新增一列（新增情資用）
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
