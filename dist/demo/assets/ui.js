/* ui.js — rendering: KPIs, charts, detail table, source editor, year settings. */
(function (global) {
  "use strict";
  var S = global.TID.stats;
  var charts = {};

  var COL = {
    blue: "#3da5ff", teal: "#27e0b0", red: "#ff5d6c", amber: "#ffb02e",
    green: "#4cc38a", purple: "#a78bfa", pink: "#f472b6", gray: "#5b6b85",
    cyan: "#22d3ee", orange: "#fb923c"
  };
  var PALETTE = [COL.blue, COL.teal, COL.amber, COL.purple, COL.green, COL.pink,
    COL.cyan, COL.orange, COL.red, COL.gray];
  var SEV_COL = { "高": COL.red, "中": COL.amber, "低": COL.green, "現行不影響": COL.blue, "未分類": COL.gray };
  var GRID = "#e6ecf5", TICK = "#475569", DBORDER = "#ffffff";

  Chart.defaults.color = TICK;
  Chart.defaults.font.family = '"Segoe UI","Microsoft JhengHei",sans-serif';

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

  function doughnut(id, pairs, colorFn) {
    destroy(id);
    var ctx = document.getElementById(id);
    if (!ctx) return;
    charts[id] = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: pairs.map(function (p) { return p[0]; }),
        datasets: [{
          data: pairs.map(function (p) { return p[1]; }),
          backgroundColor: pairs.map(function (p, i) { return colorFn ? colorFn(p[0], i) : PALETTE[i % PALETTE.length]; }),
          borderColor: DBORDER, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "58%",
        plugins: { legend: { position: "right", labels: { boxWidth: 12, padding: 8, font: { size: 12 } } } }
      }
    });
  }

  function bar(id, pairs, horizontal, colorFn) {
    destroy(id);
    var ctx = document.getElementById(id);
    if (!ctx) return;
    charts[id] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: pairs.map(function (p) { return p[0]; }),
        datasets: [{
          data: pairs.map(function (p) { return p[1]; }),
          backgroundColor: pairs.map(function (p, i) { return colorFn ? colorFn(p[0], i) : COL.blue; }),
          borderRadius: 5, maxBarThickness: 34
        }]
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: GRID }, ticks: { font: { size: 11 } } },
          y: { grid: { color: GRID }, ticks: { font: { size: 11 } } }
        }
      }
    });
  }

  function lineTrend(id, arr) {
    destroy(id);
    var ctx = document.getElementById(id);
    if (!ctx) return;
    charts[id] = new Chart(ctx, {
      type: "line",
      data: {
        labels: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
        datasets: [{
          data: arr, borderColor: COL.teal, backgroundColor: "#27e0b022",
          fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: COL.teal
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: GRID } },
          y: { grid: { color: GRID }, beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  // ---- dashboard ----------------------------------------------------------
  function renderDashboard(ctx) {
    var month = ctx.monthRecs, year = ctx.yearRecs;
    var k = S.kpis(month, year);
    var scope = ctx.monthLabel;
    document.getElementById("scope1").textContent = "（" + scope + "）";

    var cards = [
      { cls: "acc", num: k.monthTotal, lab: "本月情資總數", sub: scope },
      { cls: "", num: k.yearTotal, lab: ctx.year + " 年累積總數", sub: "全年累計" },
      { cls: "hi", num: k.monthHi, lab: "本月中高威脅", sub: "威脅程度＝高 + 中" },
      { cls: "mid", num: k.pending, lab: "本月待處理", sub: "進度未結案", help: S.PENDING_DEF },
      { cls: "", num: k.sources, lab: "本月來源數", sub: "去重後" }
    ];
    document.getElementById("kpis").innerHTML = cards.map(function (c) {
      var help = c.help ? '<span class="help" data-tip="' + esc(c.help) + '" title="' + esc(c.help) + '">?</span>' : "";
      return '<div class="kpi ' + c.cls + '"><div class="num">' + c.num +
        '</div><div class="lab">' + c.lab + help + '</div><div class="sub">' + c.sub + "</div></div>";
    }).join("");

    var sevOrder = ["高", "中", "低", "現行不影響", "未分類"];
    doughnut("chartSeverity", S.sortedPairs(S.countBy(month, "severity"), sevOrder),
      function (lab) { return SEV_COL[lab] || COL.gray; });
    bar("chartCategory", S.topN(S.countBy(month, "category"), 8), true);
    doughnut("chartOrigin", S.sortedPairs(S.countBy(month, "origin")),
      function (lab) { return lab === "內部" ? COL.amber : lab === "外部" ? COL.blue : COL.gray; });
    bar("chartSource", S.topN(S.countBy(month, "source"), 10), true,
      function (_, i) { return PALETTE[i % PALETTE.length]; });
    lineTrend("chartTrend", S.monthlyTrend(year, ctx.year));
    doughnut("chartCounter", S.topN(S.countBy(month, "countermeasure"), 8));
  }

  // ---- detail table -------------------------------------------------------
  function sevTag(s) {
    var cls = s === "高" ? "sev-hi" : s === "中" ? "sev-mid" : s === "低" ? "sev-lo" : "sev-na";
    return '<span class="sev ' + cls + '">' + esc(s) + "</span>";
  }
  // edit-mode <select> for one classification cell
  function cellSelect(field, sig, options, current, isOrigin) {
    var opts = (options || []).slice();
    var matched;
    if (isOrigin) {
      matched = null;
      for (var i = 0; i < opts.length; i++) {
        if (current && (opts[i].indexOf("內") >= 0) === (current.indexOf("內") >= 0)) { matched = opts[i]; break; }
      }
    } else {
      matched = opts.indexOf(current) >= 0 ? current : null;
      if (!matched && current && current !== "(未填)" && current !== "未分類") { opts = [current].concat(opts); matched = current; }
    }
    return '<select class="cell-sel" data-sig="' + esc(sig) + '" data-field="' + field + '">' +
      '<option value=""' + (matched ? "" : " selected") + ">—</option>" +
      opts.map(function (o) { return "<option" + (o === matched ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") +
      "</select>";
  }
  // edit-mode free-text input (used for 進度)
  function cellInput(field, sig, current) {
    return '<input class="cell-input" data-sig="' + esc(sig) + '" data-field="' + field +
      '" value="' + esc(current || "") + '" placeholder="如：OK／處理中">';
  }

  function renderDetail(recs, filter, opts) {
    opts = opts || {};
    var edit = opts.edit, eff = opts.eff, sigOf = opts.sig;
    var f = (filter || "").trim().toLowerCase();
    var rows = recs.filter(function (r) {
      if (!f) return true;
      return (r.title + " " + r.source + " " + r.category + " " + r.countermeasure).toLowerCase().indexOf(f) >= 0;
    });
    document.getElementById("detailCount").textContent = "共 " + rows.length + " 筆";
    var tb = document.querySelector("#detailTable tbody");
    tb.innerHTML = rows.map(function (r) {
      var title = r.url
        ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.title) + "</a>"
        : esc(r.title);
      var mark = r._edited ? '<span title="已編輯，與原始 Sheet 不同" style="color:#2563eb">✎ </span>' : "";
      var c4, c5, c6, c7, c8, c9;
      if (edit) {
        var s = sigOf(r), t = eff.taxonomy;
        c4 = cellSelect("origin", s, t.origin, r.origin, true);
        c5 = cellSelect("category", s, t.category, r.category, false);
        c6 = cellSelect("severity", s, t.severity, r.severity, false);
        c7 = cellSelect("riskScope", s, t.riskScope, r.riskScope, false);
        c8 = cellSelect("countermeasure", s, eff.countermeasures, r.countermeasure, false);
        c9 = cellInput("progress", s, r.progress);
      } else {
        c4 = esc(r.origin); c5 = esc(r.category); c6 = sevTag(r.severity);
        c7 = esc(r.riskScope); c8 = esc(r.countermeasure); c9 = esc(r.progress);
      }
      return "<tr><td>" + mark + esc(r.date) + "</td><td>" + esc(r.source) + "</td><td>" + title +
        "</td><td>" + c4 + "</td><td>" + c5 + "</td><td>" + c6 +
        "</td><td>" + c7 + "</td><td>" + c8 + "</td><td>" + c9 +
        "</td></tr>";
    }).join("") || '<tr><td colspan="9" class="muted" style="padding:20px;text-align:center">沒有符合的資料</td></tr>';

    if (edit && opts.onEdit) {
      tb.querySelectorAll(".cell-sel, .cell-input").forEach(function (el) {
        el.onchange = function () {
          opts.onEdit(el.getAttribute("data-sig"), el.getAttribute("data-field"), el.value);
        };
      });
    }
  }

  // ---- record maintenance (data entry) ------------------------------------
  function opt(v, sel) { return '<option' + (v === sel ? " selected" : "") + ">" + esc(v) + "</option>"; }
  function selectField(id, label, values, required) {
    return '<div class="field"><label>' + esc(label) + (required ? ' <span class="req">*</span>' : "") + "</label>" +
      '<select id="' + id + '"><option value="">— 請選擇 —</option>' +
      values.map(function (v) { return opt(v, null); }).join("") + "</select></div>";
  }
  function inputField(id, label, ph, type, full) {
    return '<div class="field' + (full ? " full" : "") + '"><label>' + esc(label) + "</label>" +
      '<input id="' + id + '" type="' + (type || "text") + '" placeholder="' + esc(ph || "") + '"></div>';
  }
  function renderMaintain(eff, scopeLabel, today, sources) {
    document.getElementById("maintainScope").textContent = scopeLabel;
    document.getElementById("maintainHint").innerHTML =
      "Google Sheet 是情資的<b>系統真相來源</b>。此表單用統一的下拉詞彙協助新增情資，提供兩種寫回方式：" +
      "<b>①</b> 加入清單後「📋 複製／⬇️ 匯出」貼回 Sheet（免設定、可離線）；" +
      "<b>②</b> 設定 Apps Script 端點後「🔗 直接寫入」（免手動貼上）。" +
      "下拉選項來自「🗂️ 來源維護」維護的詞彙。";
    var t = eff.taxonomy;
    var srcList = '<datalist id="srcList">' + (sources || []).map(function (s) {
      return '<option value="' + esc(s.short) + '">' + esc(s.name) + "</option>";
    }).join("") + "</datalist>";
    document.getElementById("maintainForm").innerHTML =
      '<div class="field"><label>資料日期 <span class="req">*</span></label>' +
        '<input id="f_date" type="date" value="' + esc(today) + '"></div>' +
      '<div class="field"><label>資料來源</label><input id="f_source" list="srcList" placeholder="可輸入或選擇簡稱">' + srcList + "</div>" +
      inputField("f_title", "資料標題", "情資標題（必填）", "text", true) +
      inputField("f_url", "訊息網址連結", "https://...", "text", true) +
      selectField("f_origin", "威脅情資來源（內外部）", t.origin || []) +
      selectField("f_category", "威脅情報類別", t.category || []) +
      selectField("f_severity", "對組織的現況威脅程度", t.severity || []) +
      selectField("f_riskScope", "風險之層面/影響系統", t.riskScope || []) +
      inputField("f_affected", "受影響之系統/版本", "選填") +
      selectField("f_counter", "因應對策", eff.countermeasures || []) +
      inputField("f_progress", "執行進度說明", "如：OK、處理中、密集觀察", "text", true);
  }

  function renderPending(rows, handlers) {
    document.getElementById("pendingCount").textContent = rows.length ? "（" + rows.length + " 列）" : "（無）";
    var tb = document.querySelector("#pendingTable tbody");
    tb.innerHTML = rows.map(function (r, i) {
      return "<tr><td>" + esc(r.date) + "</td><td>" + esc(r.source) + "</td><td>" + esc(r.title) +
        "</td><td>" + esc(r.category) + "</td><td>" + sevTag(r.severity || "未分類") +
        "</td><td><button class='icon-btn' data-del-pending='" + i + "'>✕</button></td></tr>";
    }).join("") || '<tr><td colspan="6" class="muted" style="padding:16px;text-align:center">尚無新增列</td></tr>';
    tb.querySelectorAll("[data-del-pending]").forEach(function (b) {
      b.onclick = function () { handlers.delPending(parseInt(b.getAttribute("data-del-pending"), 10)); };
    });
  }

  // ---- source editor ------------------------------------------------------
  function renderSources(eff, handlers) {
    var st = document.getElementById("stdStatus");
    st.innerHTML = "標準層版本 <b>" + esc(eff.standardVersion) + "</b>" +
      (eff.basedOnStandard ? "<br>本企業依據 <b>" + esc(eff.basedOnStandard) + "</b>" : "") +
      (eff.outdated ? '<span class="badge warn">標準層已更新，建議檢視</span>'
        : '<span class="badge ok">與標準層一致</span>');

    var tb = document.querySelector("#srcTable tbody");
    tb.innerHTML = eff.sources.map(function (s, i) {
      var layer = s.layer === "cust"
        ? '<span class="layer cust">自訂</span>' : '<span class="layer std">標準</span>';
      var del = s.layer === "cust"
        ? '<button class="icon-btn" data-del-src="' + i + '" title="刪除">✕</button>'
        : '<button class="icon-btn" data-hide-src="' + esc(s.short) + '" title="隱藏此標準來源">🚫</button>';
      return "<tr><td><b>" + esc(s.short) + "</b></td><td>" + esc(s.name) + "</td><td>" +
        (s.tags || []).map(function (t) { return '<span class="pill">' + esc(t) + "</span>"; }).join(" ") +
        "</td><td>" + layer + "</td><td>" + del + "</td></tr>";
    }).join("");

    var cl = document.getElementById("counterList");
    cl.innerHTML = eff.countermeasures.map(function (c, i) {
      return "<li><span>" + esc(c) + "</span><button class='icon-btn' data-del-counter='" + i + "'>✕</button></li>";
    }).join("");

    var tv = document.getElementById("taxoView");
    var labels = { origin: "內外部", category: "威脅情報類別", severity: "威脅程度", riskScope: "風險層面/系統" };
    tv.innerHTML = Object.keys(eff.taxonomy).map(function (k) {
      return '<div><div class="tg">' + (labels[k] || k) + '</div><div class="tv">' +
        eff.taxonomy[k].map(function (v) { return '<span class="pill">' + esc(v) + "</span>"; }).join("") +
        "</div></div>";
    }).join("");

    // wire row buttons
    tb.querySelectorAll("[data-del-src]").forEach(function (b) {
      b.onclick = function () { handlers.delSource(parseInt(b.getAttribute("data-del-src"), 10)); };
    });
    tb.querySelectorAll("[data-hide-src]").forEach(function (b) {
      b.onclick = function () { handlers.hideSource(b.getAttribute("data-hide-src")); };
    });
    cl.querySelectorAll("[data-del-counter]").forEach(function (b) {
      b.onclick = function () { handlers.delCounter(parseInt(b.getAttribute("data-del-counter"), 10)); };
    });
  }

  // ---- year settings ------------------------------------------------------
  function renderYears(company, handlers) {
    var tb = document.querySelector("#yearTable tbody");
    var years = company.years || {};
    tb.innerHTML = Object.keys(years).sort().map(function (y) {
      var id = years[y];
      var status = id
        ? '<span class="layer std">已設定</span>'
        : '<span class="layer cust" style="background:#5b6b8522;color:#aebed6">未設定</span>';
      return "<tr><td><b>" + esc(y) + "</b></td><td>" +
        '<input class="year-input" data-year-id="' + esc(y) + '" value="' + esc(id) + '" ' +
        'placeholder="貼上試算表 ID 或分享網址"></td><td>' + status + "</td><td>" +
        '<button class="icon-btn" data-del-year="' + esc(y) + '">✕</button></td></tr>';
    }).join("");
    tb.querySelectorAll("[data-year-id]").forEach(function (inp) {
      inp.onchange = function () { handlers.setYear(inp.getAttribute("data-year-id"), inp.value); };
    });
    tb.querySelectorAll("[data-del-year]").forEach(function (b) {
      b.onclick = function () { handlers.delYear(b.getAttribute("data-del-year")); };
    });
  }

  global.TID = global.TID || {};
  global.TID.ui = {
    renderDashboard: renderDashboard,
    renderDetail: renderDetail,
    renderMaintain: renderMaintain,
    renderPending: renderPending,
    renderSources: renderSources,
    renderYears: renderYears,
    esc: esc
  };
})(window);
