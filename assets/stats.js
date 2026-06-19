/* stats.js — config layering (standard ⊕ company) and aggregations. */
(function (global) {
  "use strict";

  // Merge consultant standard layer with a company's override layer.
  // Returns the effective config the dashboard/editor operate on.
  function mergeConfig(standard, company) {
    company = company || {};
    var hide = {};
    (company.sourcesHide || []).forEach(function (s) { hide[s] = 1; });

    var sources = (standard.sources || [])
      .filter(function (s) { return !hide[s.short]; })
      .map(function (s) { return Object.assign({ layer: "std" }, s); });

    (company.sourcesAdd || []).forEach(function (s) {
      sources.push(Object.assign({ layer: "cust" }, s));
    });

    var counters = (standard.countermeasures || []).slice();
    (company.countermeasuresAdd || []).forEach(function (c) {
      if (counters.indexOf(c) < 0) counters.push(c);
    });

    var taxo = JSON.parse(JSON.stringify(standard.taxonomy || {}));
    var ext = company.taxonomyExtend || {};
    Object.keys(ext).forEach(function (k) {
      taxo[k] = (taxo[k] || []).concat(ext[k].filter(function (v) {
        return (taxo[k] || []).indexOf(v) < 0;
      }));
    });

    return {
      standardVersion: standard.version,
      basedOnStandard: company.basedOnStandard || null,
      outdated: company.basedOnStandard && company.basedOnStandard !== standard.version,
      sources: sources,
      countermeasures: counters,
      taxonomy: taxo
    };
  }

  function countBy(records, key) {
    var m = {};
    records.forEach(function (r) {
      var k = r[key] || "(未填)";
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }

  function sortedPairs(obj, order) {
    var keys = Object.keys(obj);
    if (order) {
      keys.sort(function (a, b) {
        var ia = order.indexOf(a), ib = order.indexOf(b);
        if (ia < 0) ia = 999; if (ib < 0) ib = 999;
        return ia - ib || obj[b] - obj[a];
      });
    } else {
      keys.sort(function (a, b) { return obj[b] - obj[a]; });
    }
    return keys.map(function (k) { return [k, obj[k]]; });
  }

  function topN(obj, n) {
    return sortedPairs(obj).slice(0, n);
  }

  // Monthly trend for a given year (1..12).
  function monthlyTrend(records, year) {
    var arr = new Array(12).fill(0);
    records.forEach(function (r) {
      if (r.year === year && r.month >= 1 && r.month <= 12) arr[r.month - 1]++;
    });
    return arr;
  }

  // ---- "待處理" definition (transparent & documented) --------------------
  // 待處理 = 因應對策需採取行動（非「僅列入知識庫」），
  //         且「執行進度說明」尚未標記為結案（OK/完成/結案/已處理/已修補/N/A，空白視為未處理）。
  var CLOSED_RE = /(^|[^a-z])(ok|done|closed|n\/?a)([^a-z]|$)|完成|結案|已處理|已修補|已關閉|已完成|毋需|無需|不需處理/i;
  var NO_ACTION = "僅列入知識庫";
  var PENDING_DEF = "待處理 ＝ 因應對策非「僅列入知識庫」，且「執行進度說明」尚未標記結案" +
    "（OK／完成／結案／已處理／已修補／N/A）的情資筆數；進度欄空白者視為尚未處理。";

  function isPending(r) {
    if ((r.countermeasure || "") === NO_ACTION) return false; // 知識庫留存，毋須處理
    return !CLOSED_RE.test(r.progress || "");
  }

  // KPI summary for the current selection.
  function kpis(monthRecs, yearRecs) {
    function sev(recs, s) { return recs.filter(function (r) { return r.severity === s; }).length; }
    function pending(recs) { return recs.filter(isPending).length; }
    return {
      monthTotal: monthRecs.length,
      yearTotal: yearRecs.length,
      monthHi: sev(monthRecs, "高") + sev(monthRecs, "中"),
      yearHi: sev(yearRecs, "高") + sev(yearRecs, "中"),
      sources: new Set(monthRecs.map(function (r) { return r.source; })).size,
      pending: pending(monthRecs)
    };
  }

  global.TID = global.TID || {};
  global.TID.stats = {
    mergeConfig: mergeConfig,
    countBy: countBy,
    sortedPairs: sortedPairs,
    topN: topN,
    monthlyTrend: monthlyTrend,
    kpis: kpis,
    isPending: isPending,
    PENDING_DEF: PENDING_DEF
  };
})(window);
