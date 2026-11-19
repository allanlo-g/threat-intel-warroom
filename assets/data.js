/* data.js — config loading, Google Sheet live fetch, and normalization.
   Code/comments in English; user-facing strings in zh-TW. */
(function (global) {
  "use strict";

  function jget(path) {
    return fetch(path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(path + " -> HTTP " + r.status);
      return r.json();
    });
  }

  // Extract a spreadsheet id from a raw id or a full share URL.
  function sheetId(raw) {
    if (!raw) return "";
    var m = String(raw).match(/\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : String(raw).trim();
  }

  // ---- sheet columns ------------------------------------------------------
  // Monthly tabs do NOT share one fixed column order (2023-25 have 11 columns,
  // some 2026 tabs dropped 風險層面/受影響版本, and 2026-11 onward adds the two
  // vulnerability columns). Columns are therefore resolved from the header row,
  // never by position. `match` is tested against the header with whitespace removed.
  var FIELDS = [
    { key: "date", label: "資料日期", match: /資料日期/ },
    { key: "source", label: "資料來源", match: /^資料來源/ },
    { key: "title", label: "資料標題", match: /資料標題/ },
    { key: "url", label: "訊息網址連結", match: /網址/ },
    { key: "origin", label: "威脅情資來源", match: /威脅情資來源/ },
    { key: "category", label: "威脅情報類別", match: /威脅情報類別/ },
    { key: "severity", label: "對組織的現況威脅程度", match: /威脅程度/ },
    { key: "riskScope", label: "風險之層面/影響資通系統", match: /風險之層面|影響資通系統/ },
    { key: "affected", label: "受影響之作業系統或應用程式版本", match: /受影響/ },
    { key: "countermeasure", label: "因應對策", match: /因應對策/ },
    { key: "progress", label: "執行進度說明", match: /執行進度/ },
    { key: "kev", label: "弱點已知被利用(CISA KEV)", match: /KEV|已知被利用/i },
    { key: "automatable", label: "弱點能否被自動化利用", match: /自動化/ }
  ];
  var FIELD_KEYS = FIELDS.map(function (f) { return f.key; });
  var FIELD_LABEL = {};
  FIELDS.forEach(function (f) { FIELD_LABEL[f.key] = f.label; });

  // Layouts assumed when a tab's real header row is unknown (not fetched yet).
  var LAYOUT_LEGACY = ["date", "source", "title", "url", "origin", "category",
    "severity", "riskScope", "affected", "countermeasure", "progress"];
  var LAYOUT_V2 = ["date", "source", "title", "url", "origin", "category",
    "severity", "countermeasure", "progress", "kev", "automatable"];
  var V2_FROM = 202611;   // the two vulnerability columns are standard from 2026-11
  function hasVulnFields(year, month) { return year * 100 + month >= V2_FROM; }
  function defaultLayout(year, month) {
    return hasVulnFields(year, month) ? LAYOUT_V2 : LAYOUT_LEGACY;
  }

  // Header labels -> layout: one entry per sheet column, a field key or null.
  function layoutFromHeaders(labels) {
    var used = {};
    var layout = (labels || []).map(function (raw) {
      var lab = String(raw || "").replace(/[\s　]+/g, "");
      if (!lab) return null;
      for (var i = 0; i < FIELDS.length; i++) {
        var f = FIELDS[i];
        if (!used[f.key] && f.match.test(lab)) { used[f.key] = 1; return f.key; }
      }
      return null;
    });
    // The first four columns are fixed on every known tab; fall back to position
    // when their header cell is blank (e.g. 2026年1月 has no 資料日期 label).
    ["date", "source", "title", "url"].forEach(function (k, i) {
      if (!used[k] && i < layout.length && !layout[i]) { layout[i] = k; used[k] = 1; }
    });
    while (layout.length && !layout[layout.length - 1]) layout.pop();
    return layout;
  }

  // ---- normalization ------------------------------------------------------
  // Map messy source spellings (iTHome/ITHome, TWCERT/TWCET, FISAC/FICAS ...)
  // to a canonical short name, using the standard source list + alias table.
  var SOURCE_ALIAS = {
    TWCET: "Twcert", TCERT: "Twcert", TWCERT: "Twcert", TCRET: "Twcert",
    FICAS: "Fisac", FISAC: "Fisac",
    ITHOME: "iTHome", ITHOME資安週報: "iTHome",
    TECHNEWS: "TechNews",
    趨勢: "Trendmicro", TRENDMICRO: "Trendmicro", 趨勢科技: "Trendmicro",
    NICS: "NICS", HISAC: "HISAC", NCHU: "NCHU"
  };
  function keyify(s) { return String(s || "").toUpperCase().replace(/[\s　]+/g, ""); }

  function makeSourceCanon(sources) {
    var lookup = {};
    (sources || []).forEach(function (s) {
      lookup[keyify(s.short)] = s.short;
      lookup[keyify(s.name)] = s.short;
    });
    Object.keys(SOURCE_ALIAS).forEach(function (k) { lookup[keyify(k)] = SOURCE_ALIAS[k]; });
    return function (raw) {
      var k = keyify(raw);
      if (!k) return "(未填)";
      if (lookup[k]) return lookup[k];
      // strip a trailing descriptor, retry
      var k2 = k.replace(/[（(].*$/, "");
      return lookup[k2] || String(raw).trim();
    };
  }

  function canonOrigin(raw) {
    var s = String(raw || "");
    if (s.indexOf("內") >= 0) return "內部";
    if (s.indexOf("外") >= 0) return "外部";
    return s.trim() || "(未填)";
  }

  var SEV_SET = { "高": 1, "中": 1, "低": 1, "現行不影響": 1 };
  function canonSeverity(raw) {
    var s = String(raw || "").trim();
    if (SEV_SET[s]) return s;
    return "未分類";
  }

  function canonCategory(raw) {
    var s = String(raw || "").trim();
    if (!s) return "(未填)";
    // legacy 3-layer threat-intel taxonomy -> unified
    if (/(戰略|戰術|作戰).*威脅情報/.test(s)) return "外部：威脅情報";
    return s;
  }

  function canonCounter(raw) {
    var s = String(raw || "").trim();
    return s || "(未填)";
  }

  // 是/否 flags of the two vulnerability columns; blank stays blank (no data).
  function canonYesNo(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (/^(是|y|yes|true|v|1)$/i.test(s)) return "是";
    if (/^(否|n|no|false|x|0)$/i.test(s)) return "否";
    return s;
  }

  // Build the normalizer bound to the active company's source list.
  function makeNormalizer(sources) {
    var canonSrc = makeSourceCanon(sources);
    return function (rec) {
      return {
        date: rec.date || "",
        day: rec.day || "",
        year: rec.year, month: rec.month,
        source: canonSrc(rec.source),
        sourceRaw: rec.source || "",
        title: rec.title || "",
        url: rec.url || "",
        origin: canonOrigin(rec.origin),
        category: canonCategory(rec.category),
        severity: canonSeverity(rec.severity),
        riskScope: (rec.riskScope || "").trim(),
        affected: (rec.affected || "").trim(),
        countermeasure: canonCounter(rec.countermeasure),
        progress: (rec.progress || "").trim(),
        kev: canonYesNo(rec.kev),
        automatable: canonYesNo(rec.automatable)
      };
    };
  }

  // ---- live fetch from Google Sheet (gviz) --------------------------------
  // Fetch one month tab "YYYY年M月". Resolves to { recs, layout }: raw records
  // plus the tab's column layout (used to write rows back in the right order).
  function fetchMonthLive(id, year, month, timeoutMs) {
    var sheet = year + "年" + month + "月";
    var url = "https://docs.google.com/spreadsheets/d/" + id +
      "/gviz/tq?tqx=out:json&headers=1&sheet=" + encodeURIComponent(sheet);
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
    return fetch(url, { signal: ctrl.signal }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function (txt) {
      clearTimeout(to);
      var s = txt.indexOf("{"), e = txt.lastIndexOf("}");
      if (s < 0 || e < 0) throw new Error("bad gviz payload");
      var j = JSON.parse(txt.slice(s, e + 1));
      if (!j.table || !j.table.rows) return { recs: [], layout: defaultLayout(year, month) };
      var layout = layoutFromHeaders((j.table.cols || []).map(function (c) { return c.label; }));
      // header row unreadable -> assume the standard layout for that period
      if (layout.indexOf("title") < 0) layout = defaultLayout(year, month);
      var out = [];
      j.table.rows.forEach(function (row) {
        var c = row.c || [];
        var rec = { year: year, month: month };
        layout.forEach(function (k, i) {
          if (k) rec[k] = c[i] && c[i].v != null ? String(c[i].v).trim() : "";
        });
        if (!rec.title) return;
        var dateRaw = rec.date || "";
        var day = "";
        var dm = dateRaw.match(/(\d{1,2})[/-](\d{1,2})(?:[/-](\d{1,2}))?/);
        // gviz often returns Date(y,m,d); handle that too
        var dM = dateRaw.match(/Date\((\d+),(\d+),(\d+)/);
        if (dM) { day = parseInt(dM[3], 10); dateRaw = dM[1] + "/" + (parseInt(dM[2], 10) + 1) + "/" + dM[3]; }
        else if (dm) { day = parseInt(dm[3] || dm[2], 10); }
        rec.date = dateRaw; rec.day = day;
        out.push(rec);
      });
      return { recs: out, layout: layout };
    }).catch(function (err) { clearTimeout(to); throw err; });
  }

  global.TID = global.TID || {};
  global.TID.data = {
    jget: jget,
    sheetId: sheetId,
    makeNormalizer: makeNormalizer,
    fetchMonthLive: fetchMonthLive,
    FIELD_KEYS: FIELD_KEYS,
    FIELD_LABEL: FIELD_LABEL,
    defaultLayout: defaultLayout,
    hasVulnFields: hasVulnFields,
    layoutFromHeaders: layoutFromHeaders,
    // individual canonicalizers, reused by the client-side edit layer
    canon: {
      origin: canonOrigin,
      severity: canonSeverity,
      category: canonCategory,
      counter: canonCounter,
      yesNo: canonYesNo
    }
  };
})(window);
