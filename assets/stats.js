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
  // 待處理 = 「執行進度說明」尚未標記為結案的情資筆數。
  //   結案關鍵字：OK / done / closed / N/A / 完成 / 結案 / 已處理 / 已修補 / 已關閉 / 不需處理。
  //   進度欄空白者視為「尚未處理」→ 計入待處理。
  var CLOSED_RE = /(^|[^a-z])(ok|done|closed|n\/?a)([^a-z]|$)|完成|結案|已處理|已修補|已關閉|已完成|已結案|毋需|無需|不需處理|不需追蹤/i;
  var PENDING_DEF = "待處理 ＝「執行進度說明」尚未標記結案的情資筆數。" +
    "結案關鍵字：OK／done／N/A／完成／結案／已處理／已修補／已關閉／不需處理；進度欄空白者視為尚未處理。";

  function isPending(r) {
    return !CLOSED_RE.test(r.progress || "");
  }

  // ---- vulnerability assessment (columns added to the sheet from 2026-11) ----
  // Tabs before 2026-11 have no such columns, so only records that actually
  // carry a value are counted — older months never show up as "否".
  var VULN_DEF = "弱點評估欄位（已知被利用 KEV、能否被自動化利用、技術影響程度、處置期限）為 2026 年 11 月起新增，" +
    "統計只計入有填值的情資；之前的月份無此資料。";
  var DUE_GUIDE = global.TID.data.DUE_GUIDE;
  var DUE_DEF = "「弱點處置期限」的天數係參考《" + DUE_GUIDE + "》（115 年 11 月 6 日訂定）表一：" +
    "依「是否曝露於公眾網路、弱點已知被利用、能否被自動化利用、技術影響程度」四項指標對應期限；" +
    "期限自知悉日起算，以日曆天計。";
  function vulnStats(records) {
    function tally(key) {
      var m = {}, n = 0;
      records.forEach(function (r) {
        if (!r[key]) return;
        m[r[key]] = (m[r[key]] || 0) + 1; n++;
      });
      return { counts: m, total: n };
    }
    function carrying(keys) {
      return records.filter(function (r) { return keys.some(function (k) { return r[k]; }); }).length;
    }
    return {
      kev: tally("kev"), automatable: tally("automatable"), impact: tally("impact"),
      duePublic: tally("duePublic"), dueInternal: tally("dueInternal"),
      // records carrying at least one field of each chart
      total: carrying(["kev", "automatable"]),
      dueTotal: carrying(["duePublic", "dueInternal"])
    };
  }

  // Table 1 of the guideline: (曝露於公眾網路, KEV, 自動化利用, 技術影響) -> 處置期限.
  // Returns { duePublic, dueInternal } or null when an indicator is not 是/否 / 完全|部分控制.
  var DUE_LATER = "待下次系統更新";
  var DUE_TABLE = {            // key = KEV + 自動化 + 影響(T 完全控制 / P 部分控制)
    public:   { YYT: "3天", YYP: "3天", YNT: "3天", YNP: "14天", NYT: "3天", NYP: "14天", NNT: "14天", NNP: "60天" },
    internal: { YYT: "3天", YYP: "14天", YNT: "14天", YNP: "14天", NYT: "60天", NYP: "60天", NNT: DUE_LATER, NNP: DUE_LATER }
  };
  function dueByGuide(kev, automatable, impact) {
    function yn(v) { v = String(v || "").replace(/（.*$/, "").trim(); return v === "是" ? "Y" : v === "否" ? "N" : ""; }
    var i = String(impact || "");
    var t = i.indexOf("完全控制") === 0 ? "T" : i.indexOf("部分控制") === 0 ? "P" : "";
    var k = yn(kev), a = yn(automatable);
    if (!k || !a || !t) return null;
    return { duePublic: DUE_TABLE.public[k + a + t], dueInternal: DUE_TABLE.internal[k + a + t] };
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
      pending: pending(monthRecs),
      kev: monthRecs.filter(function (r) { return r.kev === "是"; }).length,
      kevRated: monthRecs.filter(function (r) { return r.kev; }).length,
      // most urgent deadline under the worst case (asset exposed to the public network)
      due3: monthRecs.filter(function (r) { return r.duePublic === "3天"; }).length,
      dueRated: monthRecs.filter(function (r) { return r.duePublic; }).length
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
    PENDING_DEF: PENDING_DEF,
    vulnStats: vulnStats,
    VULN_DEF: VULN_DEF,
    DUE_DEF: DUE_DEF,
    DUE_GUIDE: DUE_GUIDE,
    DUE_LATER: DUE_LATER,
    dueByGuide: dueByGuide
  };
})(window);
