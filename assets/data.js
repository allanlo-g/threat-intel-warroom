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
        progress: (rec.progress || "").trim()
      };
    };
  }

  // ---- live fetch from Google Sheet (gviz) --------------------------------
  // Fetch one month tab "YYYY年M月" and return normalized raw records.
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
      if (!j.table || !j.table.rows) return [];
      var rows = j.table.rows;
      var out = [];
      rows.forEach(function (row) {
        var c = row.c || [];
        function v(i) { return c[i] && c[i].v != null ? String(c[i].v).trim() : ""; }
        var title = v(2);
        if (!title) return;
        var dateRaw = v(0);
        var day = "";
        var dm = dateRaw.match(/(\d{1,2})[/-](\d{1,2})(?:[/-](\d{1,2}))?/);
        // gviz often returns Date(y,m,d); handle that too
        var dM = dateRaw.match(/Date\((\d+),(\d+),(\d+)/);
        if (dM) { day = parseInt(dM[3], 10); dateRaw = dM[1] + "/" + (parseInt(dM[2], 10) + 1) + "/" + dM[3]; }
        else if (dm) { day = parseInt(dm[3] || dm[2], 10); }
        out.push({
          date: dateRaw, day: day, year: year, month: month,
          source: v(1), title: title, url: v(3), origin: v(4), category: v(5),
          severity: v(6), riskScope: v(7), affected: v(8),
          countermeasure: v(9), progress: v(10)
        });
      });
      return out;
    }).catch(function (err) { clearTimeout(to); throw err; });
  }

  global.TID = global.TID || {};
  global.TID.data = {
    jget: jget,
    sheetId: sheetId,
    makeNormalizer: makeNormalizer,
    fetchMonthLive: fetchMonthLive,
    // individual canonicalizers, reused by the client-side edit layer
    canon: {
      origin: canonOrigin,
      severity: canonSeverity,
      category: canonCategory,
      counter: canonCounter
    }
  };
})(window);
