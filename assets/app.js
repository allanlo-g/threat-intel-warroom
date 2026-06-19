/* app.js — bootstrap, state and event wiring. */
(function (global) {
  "use strict";
  var D = global.TID.data, S = global.TID.stats, U = global.TID.ui;

  var state = {
    mode: "consultant",       // "consultant" (multi-company) or "client" (locked single company)
    consultantName: "資安顧問",
    branding: {},
    companies: [], standard: null,
    company: null,            // active company meta (from companies.json, + local year edits)
    override: {},             // active company override layer (config.<id>.json + local edits)
    effective: null,          // merged effective config
    normalize: null,
    allRecords: [],           // normalized snapshot records
    liveMonth: null,          // {year, month, recs}
    pending: [],              // locally-added raw records not yet written back to the Sheet
    edits: {},                // client classification edits on fetched records {sig: {field:value}}
    editMode: false,
    year: null, month: null,  // month=number or 'all'
    view: "dashboard"
  };

  var LS = {
    cfg: function (id) { return "tid.cfg." + id; },
    years: function (id) { return "tid.years." + id; },
    add: function (id) { return "tid.add." + id; },
    edit: function (id) { return "tid.edit." + id; },
    webapp: function (id, y) { return "tid.webapp." + id + "." + y; },
    lastCompany: "tid.lastCompany"
  };
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { } }

  // DOM helpers — tolerate elements that don't exist (read-only index.html omits many)
  function $(id) { return document.getElementById(id); }
  function on(id, ev, fn) { var el = $(id); if (el) el["on" + ev] = fn; }

  function status(html, cls) {
    document.getElementById("dataStatus").innerHTML =
      cls ? '<span class="' + cls + '">' + html + "</span>" : html;
  }

  // ---------- bootstrap ----------
  // app.json decides the mode:
  //   { "mode":"client", "company":{...}, "branding":{...} }  -> single locked company, no switcher
  //   { "mode":"consultant", "companiesFile":"config/companies.json" } (or app.json absent) -> switcher
  function boot() {
    if (location.protocol === "file:") document.getElementById("fileWarn").hidden = false;
    D.jget("config/app.json").catch(function () { return null; }).then(function (app) {
      return D.jget("config/standard-sources.json").then(function (std) {
        state.standard = std;
        buildAbout();
        if (app && app.mode === "client" && app.company) {
          state.mode = "client";
          state.consultantName = app.consultantName || state.consultantName;
          state.branding = app.branding || {};
          state.companies = [app.company];
          applyMode();
          setFooter();
          fillCompanySelect(app.company.id);
          wireGlobal();
          selectCompany(app.company.id);
          return;
        }
        var companiesFile = (app && app.companiesFile) || "config/companies.json";
        return D.jget(companiesFile).then(function (cs) {
          state.mode = "consultant";
          state.consultantName = (app && app.consultantName) || cs.consultantName || state.consultantName;
          state.defaultCompany = cs.defaultCompany;
          state.companies = cs.companies || [];
          applyMode();
          setFooter();
          var last = lsGet(LS.lastCompany);
          var pick = state.companies.some(function (c) { return c.id === last; })
            ? last : (cs.defaultCompany || (state.companies[0] && state.companies[0].id));
          fillCompanySelect(pick);
          wireGlobal();
          selectCompany(pick);
        });
      });
    }).catch(function (e) {
      status("無法載入設定檔：" + e.message + "（若以 file:// 開啟，請改用 start.bat 或本機伺服器）", "err");
    });
  }

  function fillCompanySelect(pick) {
    var sel = document.getElementById("companySel");
    sel.innerHTML = state.companies.map(function (c) {
      return '<option value="' + U.esc(c.id) + '">' + U.esc(c.name) + "</option>";
    }).join("");
    sel.value = pick;
  }

  function applyMode() {
    var client = state.mode === "client";
    // hide the company switcher in client deliverables
    document.getElementById("companyCtrl").style.display = client ? "none" : "";
    // client builds usually don't expose the multi-company "年度設定 匯出 companies.json" wording
    var expBtn = document.getElementById("exportCompaniesBtn");
    if (expBtn) expBtn.textContent = client ? "⬇️ 匯出年度設定 (app.json)" : "⬇️ 匯出 companies.json";
    if (client && state.branding && state.branding.subtitle) {
      document.getElementById("brandSub").textContent = state.branding.subtitle;
    }
  }

  function setFooter() {
    document.getElementById("footInfo").textContent =
      (state.mode === "client" ? "本看板由 " + state.consultantName + " 建置交付" : state.consultantName) +
      " · 標準層 " + state.standard.version +
      " · " + (state.mode === "client" ? "客戶獨立版" : "顧問維護版") + "（本機 / GitHub Pages 靜態看板）";
  }

  function brandTitleFor(meta) {
    if (state.mode === "client" && state.branding && state.branding.title) return state.branding.title;
    return meta.name + " · 情資戰情看板";
  }

  // ---------- company selection ----------
  function selectCompany(id) {
    var meta = state.companies.filter(function (c) { return c.id === id; })[0];
    if (!meta) return;
    lsSet(LS.lastCompany, id);
    // merge local year edits over companies.json years
    var localYears = lsGet(LS.years(id));
    state.company = Object.assign({}, meta, { years: Object.assign({}, meta.years, localYears || {}) });

    var ovPath = meta.configFile || ("config/company." + id + ".json");
    var snapPath = meta.snapshotFile || ("data/snapshot." + id + ".json");

    status("載入「" + meta.name + "」資料中 ...");
    D.jget(ovPath).catch(function () { return {}; }).then(function (fileOv) {
      state.fileOverride = fileOv || {};            // cached so cross-tab "reset" can fall back
      var localOv = lsGet(LS.cfg(id));
      state.override = localOv || fileOv || {};
      state.effective = S.mergeConfig(state.standard, state.override);
      state.normalize = D.makeNormalizer(state.effective.sources);
      return D.jget(snapPath).catch(function () { return { years: {} }; });
    }).then(function (snap) {
      var recs = [];
      Object.keys(snap.years || {}).forEach(function (y) {
        (snap.years[y] || []).forEach(function (r) { recs.push(state.normalize(r)); });
      });
      state.allRecords = recs;
      state.liveMonth = null;
      state.pending = lsGet(LS.add(id)) || [];
      state.edits = lsGet(LS.edit(id)) || {};
      document.getElementById("brandTitle").textContent = brandTitleFor(meta);
      initYearMonth();
      renderAll();
      var n = recs.length;
      status(n
        ? '已載入快照 <b>' + n + '</b> 筆（' + (snap.name || meta.name) + '），正在自動更新本月最新情資 ...'
        : '尚無快照資料，正在自動抓取本月最新情資 ...', "snap");
      autoRefreshCurrentMonth();   // 每次開啟/切換企業，自動先更新當月為最新
    });
  }

  // ---------- year / month selectors ----------
  function availableYears() {
    var set = {};
    state.allRecords.forEach(function (r) { if (r.year) set[r.year] = 1; });
    Object.keys(state.company.years || {}).forEach(function (y) { set[parseInt(y, 10)] = 1; });
    return Object.keys(set).map(Number).filter(function (y) { return y; }).sort(function (a, b) { return a - b; });
  }
  function initYearMonth() {
    var years = availableYears();
    var now = new Date();
    var curY = now.getFullYear();
    var ysel = document.getElementById("yearSel");
    ysel.innerHTML = years.map(function (y) { return '<option value="' + y + '">' + y + " 年</option>"; }).join("");
    state.year = years.indexOf(curY) >= 0 ? curY : (years[years.length - 1] || curY);
    ysel.value = state.year;
    buildMonthSel(state.year, curY, now.getMonth() + 1);
  }
  function buildMonthSel(year, curY, curM) {
    var msel = document.getElementById("monthSel");
    var opts = ['<option value="all">全年累計</option>'];
    for (var m = 1; m <= 12; m++) opts.push('<option value="' + m + '">' + m + " 月</option>");
    msel.innerHTML = opts.join("");
    state.month = (year === curY) ? curM : "all";
    msel.value = state.month;
  }

  // ---------- record access ----------
  function yearRecords(year) {
    var recs = state.allRecords.filter(function (r) { return r.year === year; });
    if (state.liveMonth && state.liveMonth.year === year) {
      recs = recs.filter(function (r) { return r.month !== state.liveMonth.month; })
        .concat(state.liveMonth.recs);
    }
    if (state.pending.length) {
      recs = recs.concat(state.pending.filter(function (p) { return p.year === year; })
        .map(state.normalize));
    }
    return withEdits(recs);
  }

  // stable signature of a fetched record, used to attach client edits
  function recSig(r) {
    return [r.year, r.month, r.title || "", r.url || ""].join("␟");
  }
  // overlay client classification edits (re-canonicalized so stats stay clean)
  function withEdits(recs) {
    if (!state.edits || !Object.keys(state.edits).length) return recs;
    var C = D.canon;
    return recs.map(function (r) {
      var e = state.edits[recSig(r)];
      if (!e) return r;
      var c = Object.assign({}, r);
      if (e.origin != null) c.origin = C.origin(e.origin);
      if (e.category != null) c.category = C.category(e.category);
      if (e.severity != null) c.severity = C.severity(e.severity);
      if (e.riskScope != null) c.riskScope = e.riskScope;
      if (e.countermeasure != null) c.countermeasure = C.counter(e.countermeasure);
      if (e.progress != null) c.progress = e.progress;
      c._edited = true;
      return c;
    });
  }
  // the month new records are written to (current month when "全年累計" is selected)
  function targetMonth() {
    return state.month === "all" ? (new Date().getMonth() + 1) : parseInt(state.month, 10);
  }
  function selectedRecords() {
    var yr = yearRecords(state.year);
    if (state.month === "all") return yr;
    var m = parseInt(state.month, 10);
    return yr.filter(function (r) { return r.month === m; });
  }
  function monthLabel() {
    return state.month === "all" ? "全年累計" : (state.year + " 年 " + state.month + " 月");
  }

  // ---------- render ----------
  function renderAll() {
    var monthRecs = selectedRecords();
    var yearRecs = yearRecords(state.year);
    if (state.view === "dashboard") {
      U.renderDashboard({
        monthRecs: monthRecs, yearRecs: yearRecs,
        year: state.year, monthLabel: monthLabel()
      });
    } else if (state.view === "detail") {
      renderDetailView();
    } else if (state.view === "maintain") {
      renderMaintainView();
    } else if (state.view === "sources") {
      renderSourcesView();
    } else if (state.view === "years") {
      U.renderYears(state.company, yearHandlers);
    }
  }

  function renderSourcesView() {
    U.renderSources(state.effective, {
      delSource: function (i) {
        var s = state.effective.sources[i];
        if (!s || s.layer !== "cust") return;
        state.override.sourcesAdd = (state.override.sourcesAdd || []).filter(function (x) { return x.short !== s.short; });
        commitOverride();
      },
      hideSource: function (shortName) {
        var hide = state.override.sourcesHide || [];
        if (hide.indexOf(shortName) < 0) hide.push(shortName);
        state.override.sourcesHide = hide;
        commitOverride();
      },
      delCounter: function (i) {
        var c = state.effective.countermeasures[i];
        var stdHas = (state.standard.countermeasures || []).indexOf(c) >= 0;
        if (stdHas) { alert("標準層的因應對策不可刪除（避免影響標準一致性）。"); return; }
        state.override.countermeasuresAdd = (state.override.countermeasuresAdd || []).filter(function (x) { return x !== c; });
        commitOverride();
      }
    });
    document.getElementById("cfgHint").textContent =
      "本企業客製已" + (lsGet(LS.cfg(state.company.id)) ? "暫存於此瀏覽器" : "與檔案一致") + "。";
  }

  // re-run the normalizer on a record using its raw source (so source-list edits apply)
  function reNorm(r) {
    return state.normalize({
      date: r.date, day: r.day, year: r.year, month: r.month, source: r.sourceRaw,
      title: r.title, url: r.url, origin: r.origin, category: r.category,
      severity: r.severity, riskScope: r.riskScope, affected: r.affected,
      countermeasure: r.countermeasure, progress: r.progress
    });
  }
  function rebuildFromOverride() {
    state.effective = S.mergeConfig(state.standard, state.override);
    state.normalize = D.makeNormalizer(state.effective.sources);
    state.allRecords = state.allRecords.map(reNorm);
    if (state.liveMonth) state.liveMonth.recs = state.liveMonth.recs.map(reNorm);
  }
  function commitOverride() {
    state.override.basedOnStandard = state.standard.version;
    rebuildFromOverride();
    lsSet(LS.cfg(state.company.id), state.override);
    renderSourcesView();
  }

  // Re-apply settings/edits saved by another tab (same origin) and re-render.
  function reloadLocalState() {
    var id = state.company.id;
    state.override = lsGet(LS.cfg(id)) || state.fileOverride || {};
    state.pending = lsGet(LS.add(id)) || [];
    state.edits = lsGet(LS.edit(id)) || {};
    rebuildFromOverride();
    renderAll();
  }

  // ---------- record maintenance ----------
  var REC_KEYS = ["date", "source", "title", "url", "origin", "category",
    "severity", "riskScope", "affected", "countermeasure", "progress"];

  function savePending() { lsSet(LS.add(state.company.id), state.pending); }

  // POST to an Apps Script Web App. no-cors: the request executes server-side even
  // though we can't read the (cross-origin) response; we verify by re-reading the sheet.
  function postEndpoint(url, payload) {
    return fetch(url, { method: "POST", mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
  }
  function verifyMonth(year, month) {
    var sid = state.company.years[year];
    if (!sid) return Promise.resolve(null);
    return D.fetchMonthLive(sid, year, month)
      .then(function (raw) { return raw.map(state.normalize); })
      .catch(function () { return null; });
  }
  function canonField(k, v) {
    if (k === "origin") return D.canon.origin(v);
    if (k === "severity") return D.canon.severity(v);
    if (k === "category") return D.canon.category(v);
    if (k === "countermeasure") return D.canon.counter(v);
    return String(v == null ? "" : v).trim();
  }

  function fmtDateISO(iso) {
    var p = (iso || "").split("-");
    return p.length === 3 ? p[0] + "/" + (+p[1]) + "/" + (+p[2]) : iso;
  }

  function formRecord() {
    function v(id) { var el = document.getElementById(id); return el ? (el.value || "").trim() : ""; }
    var iso = v("f_date");
    var p = iso.split("-");
    var rec = {
      date: fmtDateISO(iso), source: v("f_source"), title: v("f_title"), url: v("f_url"),
      origin: v("f_origin"), category: v("f_category"), severity: v("f_severity"),
      riskScope: v("f_riskScope"), affected: v("f_affected"),
      countermeasure: v("f_counter"), progress: v("f_progress")
    };
    if (p.length === 3) { rec.year = +p[0]; rec.month = +p[1]; rec.day = +p[2]; }
    else { rec.year = state.year; rec.month = targetMonth(); rec.day = ""; }
    return rec;
  }

  function renderMaintainView() {
    var today = new Date().toISOString().slice(0, 10);
    U.renderMaintain(state.effective, state.year + " 年 " + targetMonth() + " 月", today, state.effective.sources);
    U.renderPending(state.pending, {
      delPending: function (i) { state.pending.splice(i, 1); savePending(); renderMaintainView(); }
    });
    var url = lsGet(LS.webapp(state.company.id, state.year)) || "";
    document.getElementById("webAppUrl").value = url;
    document.getElementById("webAppHint").innerHTML = url
      ? "已設定 " + state.year + " 年端點；「🔗 直接寫入」會依資料日期新增到對應的「YYYY年M月」分頁。"
      : "未設定。部署說明見 <code>scripts/apps_script_endpoint.gs</code> 與 README；未設定時請用「📋 複製／⬇️ 匯出」貼回 Sheet。";
  }

  function addRecord() {
    var rec = formRecord();
    if (!rec.title) { alert("請填寫資料標題。"); return; }
    if (!rec.date) { alert("請選擇資料日期。"); return; }
    state.pending.push(rec); savePending();
    ["f_title", "f_url", "f_affected", "f_progress"].forEach(function (id) { document.getElementById(id).value = ""; });
    renderMaintainView();
    status("已加入 1 列（共 " + state.pending.length + " 列待寫回）。可「📋 複製」或「⬇️ 匯出」貼回 Google Sheet。", "snap");
  }

  function pendingTSV() {
    return state.pending.map(function (r) {
      return REC_KEYS.map(function (k) {
        return String(r[k] == null ? "" : r[k]).replace(/\t/g, " ").replace(/\r?\n/g, " ");
      }).join("\t");
    }).join("\n");
  }

  function copyRows() {
    if (!state.pending.length) { alert("清單是空的。"); return; }
    var tsv = pendingTSV();
    function ok() { status("已複製 " + state.pending.length + " 列到剪貼簿。請到 Google Sheet 該月分頁最後一列貼上（欄位順序已對齊）。", "live"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).then(ok).catch(function () { exportRows(); });
    } else { exportRows(); }
  }

  function exportRows() {
    if (!state.pending.length) { alert("清單是空的。"); return; }
    var headers = ["資料日期", "資料來源", "資料標題", "訊息網址連結", "威脅情資來源",
      "威脅情報類別", "對組織的現況威脅程度", "風險之層面/影響系統", "受影響系統版本", "因應對策", "執行進度說明"];
    function cell(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lines = [headers.join(",")];
    state.pending.forEach(function (r) { lines.push(REC_KEYS.map(function (k) { return cell(r[k]); }).join(",")); });
    download("﻿" + lines.join("\r\n"), state.company.name + "_新增情資列.csv", "text/csv");
  }

  function clearRows() {
    if (!state.pending.length) return;
    if (!confirm("確定清空「待寫回」清單？（請確認已貼回或寫入 Google Sheet）")) return;
    state.pending = []; savePending(); renderMaintainView();
  }

  function writeToSheet() {
    var url = (document.getElementById("webAppUrl").value || "").trim() || lsGet(LS.webapp(state.company.id, state.year));
    var rec = formRecord();
    if (!rec.title) { alert("請填寫資料標題。"); return; }
    if (!rec.date) { alert("請選擇資料日期。"); return; }
    if (!url) { alert("尚未設定本年度的 Apps Script Web App 端點。\n請展開下方「進階」貼上端點，或改用「📋 複製／⬇️ 匯出」貼回 Sheet。\n部署說明見 README 與 scripts/apps_script_endpoint.gs。"); return; }
    var sheetName = rec.year + "年" + rec.month + "月";
    var row = REC_KEYS.map(function (k) { return rec[k] || ""; });
    status("寫入 Google Sheet（" + sheetName + "）...");
    postEndpoint(url, { action: "append", sheet: sheetName, row: row })
      .then(function () { return verifyMonth(rec.year, rec.month); })
      .then(function (live) {
        if (live) { state.liveMonth = { year: rec.year, month: rec.month, recs: live }; renderAll(); }
        var found = live && live.some(function (r) { return r.title === rec.title; });
        ["f_title", "f_url", "f_affected", "f_progress"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
        if (found) status("✓ 已寫入並確認：" + sheetName + " 已新增該列，看板已更新。", "live");
        else if (live) status("已送出，但回讀 " + sheetName + " 尚未看到該列。請確認 Apps Script 端點部署為「任何人可存取」，或稍候再按「🔄 即時更新」。", "err");
        else status("已送出寫入請求，但此年度未設 Sheet ID 無法回讀確認。", "snap");
      })
      .catch(function (e) {
        status("直接寫入失敗（" + e.message + "）。請改用「📋 複製／⬇️ 匯出」貼回 Sheet。", "err");
      });
  }

  // ---------- year settings handlers ----------
  var yearHandlers = {
    setYear: function (y, raw) {
      var id = D.sheetId(raw);
      state.company.years[y] = id;
      persistYears();
    },
    delYear: function (y) {
      delete state.company.years[y];
      persistYears();
      U.renderYears(state.company, yearHandlers);
    }
  };
  function persistYears() { lsSet(LS.years(state.company.id), state.company.years); }

  // ---------- live refresh ----------
  // Core live refresh for one month. auto=true => triggered automatically on load
  // (gentler messaging, never blocks on missing sheet id).
  function refreshMonth(year, month, auto) {
    var id = state.company.years[year];
    if (!id) {
      if (!auto) status("此年度尚未設定試算表 ID，無法即時更新。請至「年度設定」。", "err");
      return Promise.resolve(false);
    }
    if (!auto) status("即時抓取 " + year + " 年 " + month + " 月 ...");
    return D.fetchMonthLive(id, year, month).then(function (rawRecs) {
      var recs = rawRecs.map(function (r) { return state.normalize(r); });
      state.liveMonth = { year: year, month: month, recs: recs };
      if (state.year === year && state.month !== "all") {
        state.month = month; var ms = $("monthSel"); if (ms) ms.value = month;
      }
      renderAll();
      status((auto ? "✓ 已自動更新本月最新情資：" : "✓ 即時更新成功：") +
        year + " 年 " + month + " 月共 <b>" + recs.length + "</b> 筆（來源：Google Sheet 即時）。", "live");
      return true;
    }).catch(function (e) {
      if (auto) status("本月自動更新失敗（" + e.message + "），先顯示快照資料；可按「🔄 即時更新」重試。", "snap");
      else status("即時更新失敗（" + e.message + "）。可能是該年度試算表未開放連結存取，已沿用快照資料。", "err");
      return false;
    });
  }

  function liveRefresh() {
    var m = state.month === "all" ? (new Date().getMonth() + 1) : parseInt(state.month, 10);
    refreshMonth(state.year, m, false);
  }

  // Auto-refresh the current calendar month on every page open / company switch.
  function autoRefreshCurrentMonth() {
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth() + 1;
    if (!state.company.years[y]) return;   // current year not configured -> keep snapshot
    refreshMonth(y, m, true);
  }

  // ---------- CSV export ----------
  function exportCSV() {
    var recs = selectedRecords();
    var headers = ["資料日期", "資料來源", "資料標題", "訊息網址連結", "威脅情資來源",
      "威脅情報類別", "威脅程度", "風險之層面/影響系統", "受影響系統版本", "因應對策", "執行進度說明"];
    var keys = ["date", "source", "title", "url", "origin", "category", "severity", "riskScope", "affected", "countermeasure", "progress"];
    function cell(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lines = [headers.join(",")];
    recs.forEach(function (r) { lines.push(keys.map(function (k) { return cell(r[k]); }).join(",")); });
    var scope = state.month === "all" ? state.year + "年全年" : state.year + "年" + state.month + "月";
    download("﻿" + lines.join("\r\n"), state.company.name + "_" + scope + "_情資明細.csv", "text/csv");
  }

  function download(text, name, mime) {
    var blob = new Blob([text], { type: (mime || "application/json") + ";charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }

  // ---------- detail + classification editing ----------
  function renderDetailView() {
    var canEdit = !!$("editToggle");                 // read-only page omits the edit toggle
    var editing = canEdit && state.editMode && state.month !== "all";
    var search = $("detailSearch");
    U.renderDetail(selectedRecords(), search ? search.value : "",
      { edit: editing, eff: state.effective, sig: recSig, onEdit: editField });
    refreshEditControls();
  }
  function refreshEditControls() {
    if (!$("editToggle")) return;                     // edit controls absent (read-only page)
    var n = Object.keys(state.edits).length;
    $("exportEditsBtn").hidden = !n;
    $("writeEditsBtn").hidden = !n;
    var hint = $("editHint");
    if (state.editMode && state.month === "all") {
      hint.hidden = false;
      hint.innerHTML = "編輯分類請先在上方選擇<b>單一月份</b>（非「全年累計」）。";
    } else if (state.editMode) {
      hint.hidden = false;
      hint.innerHTML = "編輯模式：直接修改下表的<b>內外部／類別／威脅程度／影響系統／因應對策／進度</b>，" +
        "會即時更新統計並存於本機；可「⬇️ 匯出分類修改」或「🔗 寫回 Sheet」。目前已編輯 <b>" + n + "</b> 筆。";
    } else {
      hint.hidden = true;
    }
  }
  function editField(sig, field, value) {
    var e = state.edits[sig] || {};
    // 下拉欄位選「—」(空) = 取消覆寫；但「進度」空白是有意義的狀態(尚未處理) → 仍儲存
    if (value === "" && field !== "progress") delete e[field]; else e[field] = value;
    if (Object.keys(e).length) state.edits[sig] = e; else delete state.edits[sig];
    lsSet(LS.edit(state.company.id), state.edits);
    refreshEditControls();
    status("已更新分類（本機暫存，共 " + Object.keys(state.edits).length + " 筆已編輯）。", "snap");
  }
  function editedRecords(scopeYear, scopeMonth) {
    var base = state.allRecords.concat(state.pending.map(state.normalize));
    if (scopeYear != null) base = base.filter(function (r) {
      return r.year === scopeYear && (scopeMonth == null || r.month === scopeMonth);
    });
    return withEdits(base).filter(function (r) { return state.edits[recSig(r)]; });
  }
  function exportEdits() {
    var edited = editedRecords();
    if (!edited.length) { alert("尚無分類修改。"); return; }
    var headers = ["資料日期", "資料來源", "資料標題", "訊息網址連結", "威脅情資來源",
      "威脅情報類別", "對組織的現況威脅程度", "風險之層面/影響系統", "因應對策", "執行進度說明"];
    var keys = ["date", "source", "title", "url", "origin", "category", "severity", "riskScope", "countermeasure", "progress"];
    function cell(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lines = [headers.join(",")];
    edited.forEach(function (r) { lines.push(keys.map(function (k) { return cell(r[k]); }).join(",")); });
    download("﻿" + lines.join("\r\n"), state.company.name + "_分類修改.csv", "text/csv");
  }
  function writeEdits() {
    var url = lsGet(LS.webapp(state.company.id, state.year)) || (document.getElementById("webAppUrl") && document.getElementById("webAppUrl").value);
    if (!url) { alert("尚未設定本年度寫入端點。\n請至「情資維護 → 進階：直接寫入端點設定」貼上 Apps Script Web App URL，\n或用「⬇️ 匯出分類修改」在 Google Sheet 手動更新。"); return; }
    var m = targetMonth();
    var recs = editedRecords(state.year, m);
    if (!recs.length) { alert("本月沒有已編輯的列（請選單一月份）。"); return; }
    var sheetName = state.year + "年" + m + "月";
    status("寫回 " + recs.length + " 列分類至 " + sheetName + " ...");
    var chain = Promise.resolve();
    recs.forEach(function (r) {
      var e = state.edits[recSig(r)] || {};
      var fields = {}; Object.keys(e).forEach(function (k) { fields[k] = e[k]; });
      chain = chain.then(function () {
        return postEndpoint(url, { action: "update", sheet: sheetName, title: r.title, url: r.url, fields: fields });
      });
    });
    chain.then(function () { return verifyMonth(state.year, m); })
      .then(function (live) {
        if (!live) { status("已送出 " + recs.length + " 筆更新；此年度未設 Sheet ID，無法回讀確認。", "snap"); return; }
        state.liveMonth = { year: state.year, month: m, recs: live };
        var confirmed = 0;
        recs.forEach(function (r) {
          var e = state.edits[recSig(r)] || {};
          var f = live.filter(function (x) { return x.title === r.title && (!r.url || x.url === r.url); })[0];
          if (f && Object.keys(e).every(function (k) { return canonField(k, e[k]) === f[k]; })) confirmed++;
        });
        renderAll();
        if (confirmed === recs.length)
          status("✓ 已寫回並確認 " + confirmed + "/" + recs.length + " 筆至 " + sheetName + "，看板已更新。", "live");
        else
          status("已送出 " + recs.length + " 筆，回讀確認 " + confirmed + "/" + recs.length +
            "（Google 試算表回讀可能延遲數秒，或端點未設為「任何人可存取」）。可稍候按「🔄 即時更新」再確認。", "err");
      })
      .catch(function (e) {
        status("寫回失敗（" + e.message + "）。請改用「⬇️ 匯出分類修改」於 Sheet 手動更新。", "err");
      });
  }

  // ---------- about ----------
  function buildAbout() {
    if (!$("aboutBox")) return;                       // read-only page has no 說明 view
    document.getElementById("aboutBox").innerHTML =
      '<h2>關於本戰情看板</h2>' +
      '<p>這是一套<b>設定驅動的靜態看板</b>，同一份程式碼可服務多家企業；資料結構一致（Google Sheet 月份分頁），各企業只需替換設定。</p>' +
      '<h3>顧問標準層 ⊕ 客戶客製層</h3><ul>' +
      '<li><code>config/standard-sources.json</code>：顧問統一維護的標準情資來源、威脅分類詞彙、因應對策範本。</li>' +
      '<li><code>config/company.&lt;id&gt;.json</code>：各客戶在標準之上的<b>新增 / 隱藏 / 自訂</b>覆寫層，並以 <code>basedOnStandard</code> 記錄所依據的標準版本，標準更新時看板會提示。</li>' +
      '<li>客戶在「來源維護」頁的編輯會暫存於瀏覽器，可<b>匯出 company.json</b> 交回顧問或提交 Git。</li></ul>' +
      '<h3>資料來源（混合模式）</h3><ul>' +
      '<li><b>即時</b>：按「🔄 即時更新」直接讀取 Google Sheet 當月分頁。</li>' +
      '<li><b>快照</b>：<code>data/snapshot.&lt;id&gt;.json</code>，由 <code>python scripts/snapshot.py</code> 產生，供離線 / GitHub Pages Demo 使用。</li></ul>' +
      '<h3>年度設定</h3><p>於「年度設定」維護各年度（含 2027 等未來年份）對應的試算表；月份分頁命名須為「YYYY年M月」。</p>' +
      '<h3>部署</h3><ul><li>本機：執行 <code>start.bat</code>（或 <code>python -m http.server 8080</code>）後開啟 localhost。</li>' +
      '<li>GitHub Pages：將整個資料夾推上 repo，啟用 Pages 即為線上 Demo。</li></ul>' +
      '<h3>看板名詞定義</h3><ul>' +
      '<li><b>本月情資總數</b>：所選月份的情資筆數。</li>' +
      '<li><b>年度累積總數</b>：所選年度全年情資筆數。</li>' +
      '<li><b>本月中高威脅</b>：威脅程度為「高」或「中」的筆數。</li>' +
      '<li><b>本月待處理</b>：' + U.esc(S.PENDING_DEF) + '</li>' +
      '<li><b>本月來源數</b>：當月出現的情資來源（已去重、已正規化）數量。</li></ul>' +
      '<h3>版權宣告</h3><p>製作：<b>Allan Lo 顧問</b><br>' +
      'Email：<a href="mailto:allanlo.plus@gmail.com">allanlo.plus@gmail.com</a><br>' +
      '網站：<a href="http://www.123hi.org" target="_blank" rel="noopener">http://www.123hi.org</a><br>' +
      '© 2026 年 6 月　版權所有</p>';
  }

  // ---------- events ----------
  function wireGlobal() {
    // Live sync across same-origin tabs (e.g. maintenance.html ↔ index.html):
    // localStorage writes in another tab fire here; re-apply for the active company.
    window.addEventListener("storage", function (e) {
      if (!state.company || !e.key) return;
      var id = state.company.id;
      if (e.key === LS.cfg(id) || e.key === LS.edit(id) || e.key === LS.add(id)) {
        reloadLocalState();
        status("🔄 已同步其他分頁的設定／編輯變更。", "live");
      } else if (e.key === LS.years(id)) {
        var meta = state.companies.filter(function (c) { return c.id === id; })[0] || {};
        state.company.years = Object.assign({}, meta.years, lsGet(LS.years(id)) || {});
        reloadLocalState();
        status("🔄 已同步其他分頁的年度設定變更。", "live");
      }
    });

    document.getElementById("companySel").onchange = function () { selectCompany(this.value); };
    document.getElementById("yearSel").onchange = function () {
      state.year = parseInt(this.value, 10);
      var now = new Date();
      buildMonthSel(state.year, now.getFullYear(), now.getMonth() + 1);
      renderAll();
    };
    document.getElementById("monthSel").onchange = function () {
      state.month = this.value === "all" ? "all" : parseInt(this.value, 10);
      renderAll();
    };
    document.getElementById("refreshBtn").onclick = liveRefresh;

    document.querySelectorAll(".tab").forEach(function (t) {
      t.onclick = function () {
        document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
        state.view = t.getAttribute("data-view");
        document.querySelectorAll(".view").forEach(function (v) { v.hidden = true; });
        document.getElementById("view-" + state.view).hidden = false;
        renderAll();
      };
    });

    on("detailSearch", "input", function () { renderDetailView(); });
    on("csvBtn", "click", exportCSV);
    on("editToggle", "change", function () {
      state.editMode = this.checked; renderDetailView();
    });
    on("exportEditsBtn", "click", exportEdits);
    on("writeEditsBtn", "click", writeEdits);

    // record maintenance (absent on the read-only index.html)
    on("addRecBtn", "click", addRecord);
    on("writeSheetBtn", "click", writeToSheet);
    on("copyRowsBtn", "click", copyRows);
    on("exportRowsBtn", "click", exportRows);
    on("clearRowsBtn", "click", clearRows);
    on("saveWebAppBtn", "click", function () {
      var u = (document.getElementById("webAppUrl").value || "").trim();
      lsSet(LS.webapp(state.company.id, state.year), u);
      renderMaintainView();
      status(u ? "已儲存 " + state.year + " 年寫入端點。" : "已清除端點設定。", "snap");
    });

    // source editor add buttons
    on("addSrcBtn", "click", function () {
      var short = val("newSrcShort"), name = val("newSrcName");
      if (!short || !name) { alert("請至少填入簡稱與單位名稱。"); return; }
      var tags = val("newSrcTags").split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      state.override.sourcesAdd = (state.override.sourcesAdd || []).concat([{ short: short, name: name, url: val("newSrcUrl"), tags: tags }]);
      ["newSrcShort", "newSrcName", "newSrcUrl", "newSrcTags"].forEach(function (i) { document.getElementById(i).value = ""; });
      commitOverride();
    });
    on("addCounterBtn", "click", function () {
      var c = val("newCounter"); if (!c) return;
      state.override.countermeasuresAdd = (state.override.countermeasuresAdd || []).concat([c]);
      document.getElementById("newCounter").value = "";
      commitOverride();
    });
    on("exportCfgBtn", "click", function () {
      var out = Object.assign({ id: state.company.id, name: state.company.name }, state.override,
        { basedOnStandard: state.standard.version, updatedAt: new Date().toISOString().slice(0, 10) });
      download(JSON.stringify(out, null, 2), "company." + state.company.id + ".json");
    });
    on("resetCfgBtn", "click", function () {
      if (!confirm("確定還原為顧問標準層？將清除此瀏覽器暫存的本企業客製。")) return;
      lsDel(LS.cfg(state.company.id));
      selectCompany(state.company.id);
      var st = document.querySelector('.tab[data-view="sources"]'); if (st) st.click();
    });

    // year settings
    on("addYearBtn", "click", function () {
      var y = val("newYear").replace(/\D/g, ""); var id = D.sheetId(val("newYearId"));
      if (!y) { alert("請輸入年度。"); return; }
      state.company.years[y] = id; persistYears();
      document.getElementById("newYear").value = ""; document.getElementById("newYearId").value = "";
      U.renderYears(state.company, yearHandlers);
      initYearMonth();
    });
    on("exportCompaniesBtn", "click", function () {
      if (state.mode === "client") {
        // client deliverable: export app.json with the updated years for this single company
        var company = Object.assign({}, state.company, { years: state.company.years });
        download(JSON.stringify({
          mode: "client", consultantName: state.consultantName,
          branding: state.branding, company: company
        }, null, 2), "app.json");
        return;
      }
      // consultant: export companies.json with this company's current years merged in
      var companies = state.companies.map(function (c) {
        if (c.id !== state.company.id) return c;
        return Object.assign({}, c, { years: state.company.years });
      });
      download(JSON.stringify({ consultantName: state.consultantName, standardVersion: state.standard.version, defaultCompany: state.defaultCompany || state.company.id, companies: companies }, null, 2), "companies.json");
    });
  }
  function val(id) { return (document.getElementById(id).value || "").trim(); }

  boot();
})(window);
