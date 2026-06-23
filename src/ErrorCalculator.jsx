import { useState, useMemo, useRef } from "react";
import {
  BarChart, Bar, ScatterChart, Scatter, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ErrorBar, Cell,
  ResponsiveContainer, Legend
} from "recharts";
import {
  FlaskConical, Plus, Trash2, Copy, Check, Upload, Calculator,
  TrendingUp, AlertTriangle, GitCompare, Sigma, Trophy, Percent,
  ArrowDownNarrowWide, ArrowUpNarrowWide
} from "lucide-react";

// ---- statistics helpers ----
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const stdev = (a, sample = true) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  const ss = a.reduce((s, x) => s + (x - m) ** 2, 0);
  return Math.sqrt(ss / (a.length - (sample ? 1 : 0)));
};
const sem = (a) => stdev(a) / Math.sqrt(a.length);

// Korean particle picker based on final consonant (받침)
const josa = (word, withBatchim, withoutBatchim) => {
  if (!word) return withoutBatchim;
  const code = word.charCodeAt(word.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 !== 0 ? withBatchim : withoutBatchim;
  }
  return withBatchim;
};

// two-sided t critical (approx via inverse, good enough for reporting)
const tCrit = (df, alpha = 0.05) => {
  // Cornish-Fisher style approximation for 95%
  const z = 1.959963985;
  const g1 = (z ** 3 + z) / 4;
  const g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96;
  const g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384;
  return z + g1 / df + g2 / df ** 2 + g3 / df ** 3;
};

// t-distribution CDF (for p-value) via continued fraction on regularized incomplete beta
function betacf(x, a, b) {
  const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function gammaln(x) {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) { y++; ser += cof[j] / y; }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betai(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) +
    a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}
// two-sided p from t
const tPValue = (t, df) => betai(df / 2, 0.5, df / (df + t * t));

const fmt = (x, d = 4) => {
  if (!isFinite(x)) return "—";
  if (x === 0) return "0";
  const abs = Math.abs(x);
  if (abs < 1e-3 || abs >= 1e6) return x.toExponential(2);
  return Number(x.toFixed(d)).toString();
};

const C = {
  ink: "#1c2b24", paper: "#f6f3ea", line: "#d8d0bd",
  sage: "#6b8f71", sageDeep: "#4a6b52", clay: "#c2683f",
  gold: "#c9a227", mute: "#8a8576", soft: "#fbfaf5",
};

export default function ErrorCalculator() {
  const [mode, setMode] = useState("vs"); // 'vs' = 실험 vs 이론, 'compare' = 실험 vs 실험
  const [theoretical, setTheoretical] = useState("9.8");
  const [unit, setUnit] = useState("m/s²");
  const [rowsA, setRowsA] = useState([
    { id: 1, v: "9.71" }, { id: 2, v: "9.83" }, { id: 3, v: "9.66" },
    { id: 4, v: "9.79" }, { id: 5, v: "9.74" },
  ]);
  const [rowsB, setRowsB] = useState([
    { id: 1, v: "9.92" }, { id: 2, v: "10.01" }, { id: 3, v: "9.88" },
    { id: 4, v: "9.95" }, { id: 5, v: "9.90" },
  ]);
  const [labelA, setLabelA] = useState("실험군 A");
  const [labelB, setLabelB] = useState("실험군 B");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef(null);
  const [csvTarget, setCsvTarget] = useState("A");

  // ---- efficiency (baseline comparison) mode state ----
  const [effGroups, setEffGroups] = useState([
    { id: 1, name: "황토 (A)", v: "0.141" },
    { id: 2, name: "옥수수속대 (B)", v: "0.058" },
    { id: 3, name: "왕겨 (C)", v: "0.018" },
    { id: 4, name: "사탕수수 (D)", v: "0.022" },
  ]);
  const [baselineId, setBaselineId] = useState(1);
  const [effDir, setEffDir] = useState("lower"); // 'lower' = 낮을수록 좋음(잔류·오염), 'higher' = 높을수록 좋음(수율·효율)
  const [effMetric, setEffMetric] = useState("흡광도");
  const [effUnit, setEffUnit] = useState("");
  const [perfNoun, setPerfNoun] = useState("흡착 성능");
  const [residNoun, setResidNoun] = useState("잔류율");

  const parse = (rows) =>
    rows.map((r) => parseFloat(r.v)).filter((x) => !isNaN(x));

  const dataA = useMemo(() => parse(rowsA), [rowsA]);
  const dataB = useMemo(() => parse(rowsB), [rowsB]);
  const theo = parseFloat(theoretical);

  const addRow = (which) => {
    const rows = which === "A" ? rowsA : rowsB;
    const setRows = which === "A" ? setRowsA : setRowsB;
    const nid = Math.max(0, ...rows.map((r) => r.id)) + 1;
    setRows([...rows, { id: nid, v: "" }]);
  };
  const delRow = (which, id) => {
    const setRows = which === "A" ? setRowsA : setRowsB;
    const rows = which === "A" ? rowsA : rowsB;
    setRows(rows.filter((r) => r.id !== id));
  };
  const editRow = (which, id, v) => {
    const setRows = which === "A" ? setRowsA : setRowsB;
    const rows = which === "A" ? rowsA : rowsB;
    setRows(rows.map((r) => (r.id === id ? { ...r, v } : r)));
  };

  const handleCSV = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target.result);
      const nums = text
        .split(/[\s,;\n\r\t]+/)
        .map((s) => parseFloat(s))
        .filter((x) => !isNaN(x));
      const rows = nums.map((n, i) => ({ id: i + 1, v: String(n) }));
      if (rows.length) {
        if (csvTarget === "A") setRowsA(rows);
        else setRowsB(rows);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ---- core stats ----
  const statsA = useMemo(() => {
    if (dataA.length === 0) return null;
    const m = mean(dataA);
    const sd = stdev(dataA);
    const se = sem(dataA);
    const n = dataA.length;
    const df = Math.max(1, n - 1);
    const tc = tCrit(df);
    const ciHalf = tc * se;
    return { m, sd, se, n, df, ciHalf, min: Math.min(...dataA), max: Math.max(...dataA) };
  }, [dataA]);

  const statsB = useMemo(() => {
    if (dataB.length === 0) return null;
    const m = mean(dataB);
    const sd = stdev(dataB);
    const se = sem(dataB);
    const n = dataB.length;
    const df = Math.max(1, n - 1);
    const tc = tCrit(df);
    const ciHalf = tc * se;
    return { m, sd, se, n, df, ciHalf, min: Math.min(...dataB), max: Math.max(...dataB) };
  }, [dataB]);

  // error vs theoretical
  const errInfo = useMemo(() => {
    if (!statsA || isNaN(theo)) return null;
    const absErr = statsA.m - theo;
    const relErr = (absErr / theo) * 100;
    const pctChange = relErr; // same thing relative to theoretical baseline
    return { absErr, relErr: Math.abs(relErr), signedRel: relErr, pctChange };
  }, [statsA, theo]);

  // outliers via modified z-score (MAD) + IQR
  const outlierInfo = useMemo(() => {
    const calc = (arr) => {
      if (arr.length < 4) return { flags: [], lo: null, hi: null };
      const sorted = [...arr].sort((a, b) => a - b);
      const q = (p) => {
        const idx = (sorted.length - 1) * p;
        const lo = Math.floor(idx), hi = Math.ceil(idx);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
      };
      const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
      const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
      const flags = arr.map((x) => x < lo || x > hi);
      return { flags, lo, hi, q1, q3, iqr };
    };
    return { A: calc(dataA), B: calc(dataB) };
  }, [dataA, dataB]);

  // Welch's t-test for compare mode
  const tTest = useMemo(() => {
    if (mode !== "compare" || !statsA || !statsB || statsA.n < 2 || statsB.n < 2)
      return null;
    const { m: m1, sd: s1, n: n1 } = statsA;
    const { m: m2, sd: s2, n: n2 } = statsB;
    const v1 = s1 ** 2 / n1, v2 = s2 ** 2 / n2;
    const t = (m1 - m2) / Math.sqrt(v1 + v2);
    const df = (v1 + v2) ** 2 / (v1 ** 2 / (n1 - 1) + v2 ** 2 / (n2 - 1));
    const p = tPValue(Math.abs(t), df);
    const pooledSD = Math.sqrt((s1 ** 2 + s2 ** 2) / 2);
    const cohenD = (m1 - m2) / pooledSD;
    const diffPct = ((m1 - m2) / m2) * 100;
    return { t, df, p, cohenD, diff: m1 - m2, diffPct, sig: p < 0.05 };
  }, [mode, statsA, statsB]);

  // ---- efficiency / baseline comparison ----
  const effResult = useMemo(() => {
    const valid = effGroups
      .map((g) => ({ ...g, num: parseFloat(g.v) }))
      .filter((g) => !isNaN(g.num));
    if (valid.length < 2) return null;
    const base = valid.find((g) => g.id === baselineId) || valid[0];
    if (base.num === 0) return null;

    const rows = valid.map((g) => {
      // residual/relative value vs baseline (baseline = 100%)
      const residual = (g.num / base.num) * 100;
      // performance improvement / change depends on direction
      // lower-is-better: improvement = how much the measured quantity dropped = 100 - residual
      // higher-is-better: improvement = how much it rose = residual - 100
      const improvement =
        effDir === "lower" ? 100 - residual : residual - 100;
      const isBase = g.id === base.id;
      return { ...g, residual, improvement, isBase };
    });

    // ranking: best performer first
    // lower-is-better → smallest measured value is best
    // higher-is-better → largest measured value is best
    const ranked = [...rows].sort((a, b) =>
      effDir === "lower" ? a.num - b.num : b.num - a.num
    );
    ranked.forEach((r, i) => (r.rank = i + 1));
    // map rank back
    const rankMap = Object.fromEntries(ranked.map((r) => [r.id, r.rank]));
    rows.forEach((r) => (r.rank = rankMap[r.id]));

    return { rows, ranked, base };
  }, [effGroups, baselineId, effDir]);

  // chart data
  const barData = useMemo(() => {
    if (mode === "vs") {
      if (!statsA) return [];
      const base = [{ name: "이론값", val: theo, err: 0, kind: "theo" }];
      base.push({ name: labelA + " (평균)", val: statsA.m, err: statsA.ciHalf, kind: "exp" });
      return base;
    } else {
      const arr = [];
      if (statsA) arr.push({ name: labelA, val: statsA.m, err: statsA.ciHalf, kind: "a" });
      if (statsB) arr.push({ name: labelB, val: statsB.m, err: statsB.ciHalf, kind: "b" });
      return arr;
    }
  }, [mode, statsA, statsB, theo, labelA, labelB]);

  const scatterA = useMemo(
    () => dataA.map((v, i) => ({ x: i + 1, y: v, out: outlierInfo.A.flags[i] })),
    [dataA, outlierInfo]
  );
  const scatterB = useMemo(
    () => dataB.map((v, i) => ({ x: i + 1, y: v, out: outlierInfo.B.flags[i] })),
    [dataB, outlierInfo]
  );

  // histogram
  const makeHist = (arr) => {
    if (arr.length < 2) return [];
    const lo = Math.min(...arr), hi = Math.max(...arr);
    const span = hi - lo || 1;
    const bins = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(arr.length))));
    const w = span / bins;
    const buckets = Array.from({ length: bins }, (_, i) => ({
      range: `${fmt(lo + i * w, 2)}`,
      mid: lo + (i + 0.5) * w,
      count: 0,
    }));
    arr.forEach((x) => {
      let idx = Math.floor((x - lo) / w);
      if (idx >= bins) idx = bins - 1;
      buckets[idx].count++;
    });
    return buckets;
  };
  const histA = useMemo(() => makeHist(dataA), [dataA]);
  const histB = useMemo(() => makeHist(dataB), [dataB]);

  // ---- report sentences ----
  const report = useMemo(() => {
    const lines = [];
    if (mode === "vs" && statsA && errInfo && !isNaN(theo)) {
      lines.push(
        `${labelA}의 측정값 ${statsA.n}회를 평균한 결과는 ${fmt(statsA.m)} ${unit}로, 이론값 ${fmt(theo)} ${unit}과 비교하여 ${errInfo.signedRel >= 0 ? "+" : ""}${fmt(errInfo.signedRel, 2)}%의 상대오차를 보였다.`
      );
      lines.push(
        `측정값의 표본표준편차는 ${fmt(statsA.sd)} ${unit}, 표준오차는 ${fmt(statsA.se)} ${unit}이며, 95% 신뢰구간은 ${fmt(statsA.m - statsA.ciHalf)} ~ ${fmt(statsA.m + statsA.ciHalf)} ${unit}이다.`
      );
      const inCI = theo >= statsA.m - statsA.ciHalf && theo <= statsA.m + statsA.ciHalf;
      lines.push(
        inCI
          ? `이론값이 95% 신뢰구간 안에 포함되므로, 측정 결과는 이론값과 통계적으로 일치한다고 볼 수 있다.`
          : `이론값이 95% 신뢰구간을 벗어나므로, 측정 결과와 이론값 사이에 유의미한 계통오차가 존재할 가능성이 있다.`
      );
      const nOut = outlierInfo.A.flags.filter(Boolean).length;
      if (nOut > 0)
        lines.push(
          `IQR 기준(Q1−1.5×IQR ~ Q3+1.5×IQR) 이상치가 ${nOut}개 검출되었으며, 해당 데이터는 측정 오류 가능성을 검토할 필요가 있다.`
        );
      else if (statsA.n >= 4)
        lines.push(`IQR 기준 이상치는 검출되지 않아 데이터의 분산이 안정적임을 확인하였다.`);
    }
    if (mode === "compare" && statsA && statsB && tTest) {
      lines.push(
        `${labelA}의 평균은 ${fmt(statsA.m)} ${unit} (n=${statsA.n}, SD=${fmt(statsA.sd)}), ${labelB}의 평균은 ${fmt(statsB.m)} ${unit} (n=${statsB.n}, SD=${fmt(statsB.sd)})로, 두 집단의 평균 차이는 ${fmt(tTest.diff)} ${unit} (${tTest.diffPct >= 0 ? "+" : ""}${fmt(tTest.diffPct, 2)}%)이다.`
      );
      lines.push(
        `Welch의 t-검정 결과 t(${fmt(tTest.df, 1)}) = ${fmt(tTest.t, 3)}, p = ${tTest.p < 0.001 ? "< 0.001" : fmt(tTest.p, 3)}로 나타났다.`
      );
      lines.push(
        tTest.sig
          ? `유의수준 0.05에서 두 집단의 평균은 통계적으로 유의한 차이를 보였다 (p < 0.05). 효과크기 Cohen's d = ${fmt(tTest.cohenD, 2)}이다.`
          : `유의수준 0.05에서 두 집단의 평균 차이는 통계적으로 유의하지 않았다 (p ≥ 0.05). 즉 두 조건의 측정 결과는 구별되지 않는다.`
      );
    }
    if (mode === "eff" && effResult) {
      const { rows, ranked, base } = effResult;
      const unitStr = effUnit ? ` ${effUnit}` : "";
      const measured = rows
        .map((r) => `${r.name} ${fmt(r.num, 3)}${unitStr}`)
        .join(", ");
      lines.push(
        `${effMetric}${josa(effMetric, "은", "는")} ${measured}로 나타났다.`
      );
      const others = rows.filter((r) => !r.isBase);
      const parts = others.map((r) => {
        const nm = r.name.replace(/\s*\(.*\)/, "");
        return `${nm}${josa(nm, "은", "는")} ${residNoun} ${fmt(r.residual, 1)}%로 ${fmt(Math.abs(r.improvement), 1)}%의 ${perfNoun} ${r.improvement >= 0 ? "향상" : "저하"}`;
      });
      lines.push(
        `${base.name}${josa(base.name, "을", "를")} 기준점(${residNoun} 100%)으로 설정하였을 때, ${parts.join("을, ")}을 나타내었다.`
      );
      const rankStr = ranked.map((r) => r.name).join(" > ");
      lines.push(
        `이를 통해 ${perfNoun} 순위는 ${rankStr} 순으로 확인되었다.`
      );
    }
    return lines;
  }, [mode, statsA, statsB, errInfo, tTest, theo, unit, labelA, labelB, outlierInfo,
      effResult, effMetric, effUnit, residNoun, perfNoun]);

  const copyReport = () => {
    navigator.clipboard.writeText(report.join("\n\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // ---- UI ----
  const tabBtn = (id, label, icon) => (
    <button
      onClick={() => setMode(id)}
      style={{
        flex: 1, padding: "10px 14px", border: "none", cursor: "pointer",
        background: mode === id ? C.sageDeep : "transparent",
        color: mode === id ? C.soft : C.mute,
        fontWeight: mode === id ? 700 : 500, fontSize: 13,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        transition: "all .15s", borderRadius: 8, fontFamily: "inherit",
      }}
    >
      {icon} {label}
    </button>
  );

  const stat = (label, value, sub) => (
    <div style={{
      background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10,
      padding: "12px 14px",
    }}>
      <div style={{ fontSize: 11, color: C.mute, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const renderRows = (which) => {
    const rows = which === "A" ? rowsA : rowsB;
    const data = which === "A" ? dataA : dataB;
    const flags = which === "A" ? outlierInfo.A.flags : outlierInfo.B.flags;
    const label = which === "A" ? labelA : labelB;
    const setLabel = which === "A" ? setLabelA : setLabelB;
    let di = -1;
    return (
      <div>
        {(mode === "compare" || which === "A") && (
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{
              width: "100%", border: "none", borderBottom: `2px solid ${which === "A" ? C.sage : C.clay}`,
              background: "transparent", fontSize: 14, fontWeight: 700, color: C.ink,
              padding: "4px 2px", marginBottom: 10, fontFamily: "inherit", outline: "none",
            }}
          />
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r, i) => {
            const valid = !isNaN(parseFloat(r.v));
            if (valid) di++;
            const isOut = valid && flags[di];
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontSize: 11, color: C.mute, width: 20, textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}>{i + 1}</span>
                <input
                  value={r.v}
                  onChange={(e) => editRow(which, r.id, e.target.value)}
                  placeholder="값 입력"
                  inputMode="decimal"
                  style={{
                    flex: 1, padding: "8px 10px", borderRadius: 8,
                    border: `1px solid ${isOut ? C.clay : C.line}`,
                    background: isOut ? "#fbeee6" : "#fff", fontSize: 14,
                    color: C.ink, fontVariantNumeric: "tabular-nums",
                    fontFamily: "inherit", outline: "none",
                  }}
                />
                {isOut && (
                  <span title="이상치" style={{ color: C.clay, display: "flex" }}>
                    <AlertTriangle size={15} />
                  </span>
                )}
                <button
                  onClick={() => delRow(which, r.id)}
                  style={{
                    border: "none", background: "transparent", cursor: "pointer",
                    color: C.mute, display: "flex", padding: 4,
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => addRow(which)}
          style={{
            marginTop: 10, width: "100%", padding: "8px", borderRadius: 8,
            border: `1px dashed ${C.line}`, background: "transparent",
            color: C.sageDeep, fontSize: 13, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            fontFamily: "inherit",
          }}
        >
          <Plus size={15} /> 행 추가
        </button>
      </div>
    );
  };

  const chartBox = (title, children) => (
    <div style={{
      background: C.soft, border: `1px solid ${C.line}`, borderRadius: 12,
      padding: "16px 14px 8px", marginBottom: 14,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.sageDeep, marginBottom: 10, letterSpacing: ".02em" }}>
        {title}
      </div>
      {children}
    </div>
  );

  return (
    <div style={{
      fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      background: C.paper, minHeight: "100vh", color: C.ink, padding: "0 0 40px",
    }}>
      <style>{`
        @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
        * { box-sizing: border-box; }
        input:focus { border-color: ${C.sage} !important; }
        @media (max-width: 760px) { .grid2 { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* header */}
      <div style={{
        borderBottom: `1px solid ${C.line}`, padding: "20px 20px 18px",
        display: "flex", alignItems: "center", gap: 12,
        background: `linear-gradient(180deg, ${C.soft}, ${C.paper})`,
      }}>
        <div style={{
          width: 42, height: 42, borderRadius: 11, background: C.sageDeep,
          display: "flex", alignItems: "center", justifyContent: "center", color: C.soft,
          flexShrink: 0,
        }}>
          <FlaskConical size={22} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: "-.01em" }}>
            실험 오차 계산기
          </h1>
          <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.mute }}>
            오차율 · 표준편차 · t-검정 · 기준점 대비 효율 — 보고서 문장까지
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "18px 16px 0" }}>
        {/* mode tabs */}
        <div style={{
          display: "flex", gap: 4, background: C.soft, padding: 4, borderRadius: 11,
          border: `1px solid ${C.line}`, marginBottom: 18,
        }}>
          {tabBtn("vs", "실험값 ↔ 이론값", <Calculator size={15} />)}
          {tabBtn("compare", "실험값 ↔ 실험값", <GitCompare size={15} />)}
          {tabBtn("eff", "기준점 대비 효율", <Percent size={15} />)}
        </div>

        {/* ===== EFFICIENCY MODE INPUTS ===== */}
        {mode === "eff" && (
          <EfficiencyInputs
            groups={effGroups} setGroups={setEffGroups}
            baselineId={baselineId} setBaselineId={setBaselineId}
            dir={effDir} setDir={setEffDir}
            metric={effMetric} setMetric={setEffMetric}
            unit={effUnit} setUnit={setEffUnit}
            perfNoun={perfNoun} setPerfNoun={setPerfNoun}
            residNoun={residNoun} setResidNoun={setResidNoun}
          />
        )}

        {/* inputs (vs / compare only) */}
        {mode !== "eff" && (
        <div className="grid2" style={{
          display: "grid",
          gridTemplateColumns: mode === "compare" ? "1fr 1fr" : "1fr",
          gap: 14, marginBottom: 18,
        }}>
          <div style={{
            background: C.soft, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16,
          }}>
            {renderRows("A")}
          </div>
          {mode === "compare" && (
            <div style={{
              background: C.soft, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16,
            }}>
              {renderRows("B")}
            </div>
          )}
        </div>
        )}

        {/* theoretical / unit + csv (vs / compare only) */}
        {mode !== "eff" && (
        <div style={{
          display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end",
          marginBottom: 22,
        }}>
          {mode === "vs" && (
            <div style={{ flex: "1 1 140px" }}>
              <label style={{ fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: ".04em", display: "block", marginBottom: 4 }}>
                이론값
              </label>
              <input
                value={theoretical}
                onChange={(e) => setTheoretical(e.target.value)}
                inputMode="decimal"
                style={{
                  width: "100%", padding: "9px 11px", borderRadius: 8,
                  border: `1px solid ${C.line}`, fontSize: 14, color: C.ink,
                  fontVariantNumeric: "tabular-nums", fontFamily: "inherit", outline: "none",
                  background: "#fff",
                }}
              />
            </div>
          )}
          <div style={{ flex: "1 1 120px" }}>
            <label style={{ fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: ".04em", display: "block", marginBottom: 4 }}>
              단위
            </label>
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="예: m/s²"
              style={{
                width: "100%", padding: "9px 11px", borderRadius: 8,
                border: `1px solid ${C.line}`, fontSize: 14, color: C.ink,
                fontFamily: "inherit", outline: "none", background: "#fff",
              }}
            />
          </div>
          <div style={{ flex: "1 1 200px", display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: ".04em", display: "block", marginBottom: 4 }}>
                CSV 불러오기
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                {mode === "compare" && (
                  <select
                    value={csvTarget}
                    onChange={(e) => setCsvTarget(e.target.value)}
                    style={{
                      padding: "9px 8px", borderRadius: 8, border: `1px solid ${C.line}`,
                      fontSize: 13, fontFamily: "inherit", background: "#fff", color: C.ink,
                    }}
                  >
                    <option value="A">{labelA}</option>
                    <option value="B">{labelB}</option>
                  </select>
                )}
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{
                    flex: 1, padding: "9px 11px", borderRadius: 8, border: `1px solid ${C.line}`,
                    background: "#fff", color: C.sageDeep, fontSize: 13, fontWeight: 600,
                    cursor: "pointer", display: "flex", alignItems: "center",
                    justifyContent: "center", gap: 6, fontFamily: "inherit",
                  }}
                >
                  <Upload size={14} /> 파일 선택
                </button>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleCSV} style={{ display: "none" }} />
            </div>
          </div>
        </div>
        )}

        {/* ===== EFFICIENCY RESULTS ===== */}
        {mode === "eff" && effResult && (
          <EfficiencyResults
            result={effResult} metric={effMetric} unit={effUnit}
            dir={effDir} perfNoun={perfNoun} residNoun={residNoun}
          />
        )}
        {mode === "eff" && !effResult && (
          <div style={{ textAlign: "center", padding: "30px 20px", color: C.mute, fontSize: 14 }}>
            기준점을 포함해 2개 이상의 그룹에 측정값을 입력하세요.
          </div>
        )}

        {/* ===== RESULTS ===== */}
        {mode === "vs" && statsA && (
          <>
            <SectionTitle icon={<Sigma size={16} />} text="기술통계" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 18 }}>
              {stat("평균", `${fmt(statsA.m)}`, unit)}
              {stat("표본표준편차", `${fmt(statsA.sd)}`, `n=${statsA.n}`)}
              {stat("표준오차 (SEM)", `${fmt(statsA.se)}`, unit)}
              {stat("범위", `${fmt(statsA.min)}–${fmt(statsA.max)}`)}
            </div>

            {errInfo && !isNaN(theo) && (
              <>
                <SectionTitle icon={<TrendingUp size={16} />} text="오차 분석" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 18 }}>
                  {stat("절대오차", `${errInfo.absErr >= 0 ? "+" : ""}${fmt(errInfo.absErr)}`, unit)}
                  {stat("상대오차(오차율)", `${fmt(errInfo.relErr, 2)}%`, errInfo.signedRel >= 0 ? "과대측정" : "과소측정")}
                  {stat("이론 대비 증감", `${errInfo.signedRel >= 0 ? "+" : ""}${fmt(errInfo.signedRel, 2)}%`)}
                  {stat("95% 신뢰구간", `±${fmt(statsA.ciHalf)}`, `${fmt(statsA.m - statsA.ciHalf)} ~ ${fmt(statsA.m + statsA.ciHalf)}`)}
                </div>
              </>
            )}
          </>
        )}

        {mode === "compare" && statsA && statsB && (
          <>
            <SectionTitle icon={<Sigma size={16} />} text="기술통계" />
            <div className="grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.sage, marginBottom: 8 }}>{labelA}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {stat("평균", fmt(statsA.m), `n=${statsA.n}`)}
                  {stat("SD", fmt(statsA.sd), `SE=${fmt(statsA.se)}`)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.clay, marginBottom: 8 }}>{labelB}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {stat("평균", fmt(statsB.m), `n=${statsB.n}`)}
                  {stat("SD", fmt(statsB.sd), `SE=${fmt(statsB.se)}`)}
                </div>
              </div>
            </div>

            {tTest && (
              <>
                <SectionTitle icon={<GitCompare size={16} />} text="Welch t-검정" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10, marginBottom: 8 }}>
                  {stat("평균 차이", `${tTest.diff >= 0 ? "+" : ""}${fmt(tTest.diff)}`, `${tTest.diffPct >= 0 ? "+" : ""}${fmt(tTest.diffPct, 1)}%`)}
                  {stat("t 값", fmt(tTest.t, 3), `df=${fmt(tTest.df, 1)}`)}
                  {stat("p 값", tTest.p < 0.001 ? "<0.001" : fmt(tTest.p, 3))}
                  {stat("Cohen's d", fmt(tTest.cohenD, 2), "효과크기")}
                </div>
                <div style={{
                  padding: "10px 14px", borderRadius: 10, marginBottom: 18, fontSize: 13, fontWeight: 600,
                  background: tTest.sig ? "#eaf2eb" : "#f3efe3",
                  color: tTest.sig ? C.sageDeep : C.mute,
                  border: `1px solid ${tTest.sig ? C.sage : C.line}`,
                }}>
                  {tTest.sig
                    ? `✓ 유의수준 0.05에서 통계적으로 유의한 차이 (p < 0.05)`
                    : `· 유의수준 0.05에서 유의한 차이 없음 (p ≥ 0.05)`}
                </div>
              </>
            )}
          </>
        )}

        {/* ===== CHARTS ===== */}
        {(statsA || statsB) && (
          <>
            <SectionTitle icon={<TrendingUp size={16} />} text="그래프" />

            {/* bar + error bars */}
            {chartBox(mode === "vs" ? "평균값 비교 (95% CI 오차막대)" : "집단 평균 비교 (95% CI)", (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.mute }} />
                  <YAxis tick={{ fontSize: 11, fill: C.mute }} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 12 }}
                    formatter={(v) => [`${fmt(v)} ${unit}`, "값"]}
                  />
                  {mode === "vs" && !isNaN(theo) && (
                    <ReferenceLine y={theo} stroke={C.gold} strokeDasharray="5 4"
                      label={{ value: "이론값", fontSize: 10, fill: C.gold, position: "right" }} />
                  )}
                  <Bar dataKey="val" radius={[6, 6, 0, 0]} maxBarSize={90}>
                    {barData.map((d, i) => (
                      <Cell key={i} fill={
                        d.kind === "theo" ? C.gold : d.kind === "b" ? C.clay : C.sage
                      } />
                    ))}
                    <ErrorBar dataKey="err" width={6} strokeWidth={2} stroke={C.ink} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ))}

            {/* scatter with outliers */}
            {chartBox("측정값 산점도 (이상치 표시)", (
              <ResponsiveContainer width="100%" height={230}>
                <ScatterChart margin={{ top: 10, right: 14, left: 0, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis type="number" dataKey="x" name="측정 회차" tick={{ fontSize: 11, fill: C.mute }}
                    label={{ value: "측정 회차", fontSize: 11, fill: C.mute, position: "insideBottom", offset: -2 }} />
                  <YAxis type="number" dataKey="y" name="값" tick={{ fontSize: 11, fill: C.mute }} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 12 }}
                    formatter={(v, n) => [fmt(v), n === "y" ? "값" : n]}
                  />
                  {mode === "vs" && statsA && (
                    <>
                      <ReferenceLine y={statsA.m} stroke={C.sage} strokeDasharray="4 3"
                        label={{ value: "평균", fontSize: 10, fill: C.sage, position: "left" }} />
                      {!isNaN(theo) && (
                        <ReferenceLine y={theo} stroke={C.gold} strokeDasharray="5 4"
                          label={{ value: "이론", fontSize: 10, fill: C.gold, position: "left" }} />
                      )}
                    </>
                  )}
                  <Scatter name={labelA} data={scatterA}>
                    {scatterA.map((d, i) => (
                      <Cell key={i} fill={d.out ? C.clay : C.sage} r={d.out ? 7 : 5} />
                    ))}
                  </Scatter>
                  {mode === "compare" && (
                    <Scatter name={labelB} data={scatterB}>
                      {scatterB.map((d, i) => (
                        <Cell key={i} fill={d.out ? "#a03d1c" : C.clay} />
                      ))}
                    </Scatter>
                  )}
                  {mode === "compare" && <Legend wrapperStyle={{ fontSize: 11 }} />}
                </ScatterChart>
              </ResponsiveContainer>
            ))}

            {/* histogram */}
            {histA.length > 0 && chartBox(
              mode === "compare" ? `분포 — ${labelA}` : "측정값 분포 (히스토그램)", (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={histA} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                  <XAxis dataKey="range" tick={{ fontSize: 10, fill: C.mute }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.mute }} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 12 }}
                    formatter={(v) => [`${v}회`, "빈도"]} />
                  <Bar dataKey="count" fill={C.sage} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ))}
            {mode === "compare" && histB.length > 0 && chartBox(`분포 — ${labelB}`, (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={histB} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                  <XAxis dataKey="range" tick={{ fontSize: 10, fill: C.mute }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.mute }} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 12 }}
                    formatter={(v) => [`${v}회`, "빈도"]} />
                  <Bar dataKey="count" fill={C.clay} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ))}
          </>
        )}

        {/* ===== REPORT ===== */}
        {report.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 0 12px" }}>
              <SectionTitle icon={<Copy size={16} />} text="보고서용 문장" noMargin />
              <button
                onClick={copyReport}
                style={{
                  padding: "7px 13px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: copied ? C.sage : C.sageDeep, color: C.soft, fontSize: 12.5,
                  fontWeight: 600, display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit",
                }}
              >
                {copied ? <><Check size={14} /> 복사됨</> : <><Copy size={14} /> 전체 복사</>}
              </button>
            </div>
            <div style={{
              background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12,
              padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12,
            }}>
              {report.map((line, i) => (
                <p key={i} style={{
                  margin: 0, fontSize: 13.5, lineHeight: 1.7, color: C.ink,
                  paddingLeft: 14, borderLeft: `3px solid ${C.sage}`,
                }}>
                  {line}
                </p>
              ))}
            </div>
            <p style={{ fontSize: 11, color: C.mute, marginTop: 10, lineHeight: 1.6 }}>
              {mode === "eff"
                ? "※ 기준점 대비 상대값입니다. 측정값이 '낮을수록 좋음'인지 '높을수록 좋음'인지 방향 설정을 확인하세요. 통계적 유의성 검정은 반복 측정 데이터가 있을 때 'A↔B 비교' 탭을 이용하세요."
                : "※ 신뢰구간·t-검정은 정규성 가정에 기반합니다. 표본 수가 적으면(n<5) 해석에 주의하세요. 이상치는 IQR(Q1−1.5×IQR ~ Q3+1.5×IQR) 기준으로 자동 표시됩니다."}
            </p>
          </>
        )}

        {mode !== "eff" && !statsA && !statsB && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: C.mute, fontSize: 14 }}>
            측정값을 입력하면 자동으로 분석이 시작됩니다.
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ icon, text, noMargin }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7,
      margin: noMargin ? 0 : "4px 0 12px", color: "#4a6b52",
      fontSize: 14, fontWeight: 800, letterSpacing: "-.01em",
    }}>
      {icon} {text}
    </div>
  );
}

const EC = {
  ink: "#1c2b24", line: "#d8d0bd", sage: "#6b8f71", sageDeep: "#4a6b52",
  clay: "#c2683f", gold: "#c9a227", mute: "#8a8576", soft: "#fbfaf5", paper: "#f6f3ea",
};
const efmt = (x, d = 1) => {
  if (!isFinite(x)) return "—";
  return Number(x.toFixed(d)).toString();
};

function EfficiencyInputs({
  groups, setGroups, baselineId, setBaselineId, dir, setDir,
  metric, setMetric, unit, setUnit, perfNoun, setPerfNoun, residNoun, setResidNoun,
}) {
  const addGroup = () => {
    const nid = Math.max(0, ...groups.map((g) => g.id)) + 1;
    setGroups([...groups, { id: nid, name: `그룹 ${nid}`, v: "" }]);
  };
  const delGroup = (id) => {
    if (groups.length <= 2) return;
    setGroups(groups.filter((g) => g.id !== id));
    if (baselineId === id) {
      const remaining = groups.filter((g) => g.id !== id);
      if (remaining[0]) setBaselineId(remaining[0].id);
    }
  };
  const edit = (id, field, val) =>
    setGroups(groups.map((g) => (g.id === id ? { ...g, [field]: val } : g)));

  const dirBtn = (val, label, icon, hint) => (
    <button
      onClick={() => setDir(val)}
      style={{
        flex: 1, padding: "10px 12px", borderRadius: 9, cursor: "pointer",
        border: `1.5px solid ${dir === val ? EC.sageDeep : EC.line}`,
        background: dir === val ? "#eaf2eb" : "#fff",
        color: dir === val ? EC.sageDeep : EC.mute, fontFamily: "inherit",
        textAlign: "left", transition: "all .15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 11, marginTop: 3, color: EC.mute }}>{hint}</div>
    </button>
  );

  const field = (label, value, onChange, placeholder) => (
    <div style={{ flex: 1 }}>
      <label style={{ fontSize: 11, color: EC.mute, textTransform: "uppercase", letterSpacing: ".04em", display: "block", marginBottom: 4 }}>
        {label}
      </label>
      <input
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: "100%", padding: "9px 11px", borderRadius: 8, border: `1px solid ${EC.line}`,
          fontSize: 14, color: EC.ink, fontFamily: "inherit", outline: "none", background: "#fff",
        }}
      />
    </div>
  );

  return (
    <div style={{ marginBottom: 20 }}>
      {/* direction selector */}
      <SectionTitle text="측정값 방향" />
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        {dirBtn("lower", "낮을수록 좋음", <ArrowDownNarrowWide size={15} />, "잔류 흡광도, 오염물 농도, 잔존량 등")}
        {dirBtn("higher", "높을수록 좋음", <ArrowUpNarrowWide size={15} />, "수율, 발아율, 제거효율, 생산량 등")}
      </div>

      {/* metric labels */}
      <SectionTitle text="용어 설정" />
      <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        {field("측정 항목", metric, setMetric, "예: 흡광도")}
        {field("단위 (선택)", unit, setUnit, "예: Abs, mg/L")}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        {field("상대값 이름", residNoun, setResidNoun, "예: 잔류율")}
        {field("성능 이름", perfNoun, setPerfNoun, "예: 흡착 성능")}
      </div>

      {/* groups table */}
      <SectionTitle text="실험군 데이터" />
      <div style={{
        background: EC.soft, border: `1px solid ${EC.line}`, borderRadius: 12, padding: 14,
      }}>
        <div style={{ display: "flex", gap: 8, fontSize: 11, color: EC.mute, fontWeight: 600, padding: "0 4px 8px", textTransform: "uppercase", letterSpacing: ".03em" }}>
          <span style={{ width: 56, textAlign: "center" }}>기준</span>
          <span style={{ flex: 1 }}>실험군 이름</span>
          <span style={{ width: 110 }}>{metric || "측정값"}</span>
          <span style={{ width: 28 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {groups.map((g) => {
            const isBase = g.id === baselineId;
            return (
              <div key={g.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={() => setBaselineId(g.id)}
                  title="기준점으로 설정"
                  style={{
                    width: 56, padding: "6px 0", borderRadius: 7, cursor: "pointer",
                    border: `1.5px solid ${isBase ? EC.gold : EC.line}`,
                    background: isBase ? "#fdf6e3" : "#fff",
                    color: isBase ? "#9a7b0f" : EC.mute, fontSize: 11, fontWeight: 700,
                    fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
                  }}
                >
                  {isBase ? "기준★" : "설정"}
                </button>
                <input
                  value={g.name}
                  onChange={(e) => edit(g.id, "name", e.target.value)}
                  placeholder="이름"
                  style={{
                    flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${EC.line}`,
                    fontSize: 14, color: EC.ink, fontFamily: "inherit", outline: "none", background: "#fff",
                  }}
                />
                <input
                  value={g.v}
                  onChange={(e) => edit(g.id, "v", e.target.value)}
                  placeholder="값"
                  inputMode="decimal"
                  style={{
                    width: 110, padding: "8px 10px", borderRadius: 8,
                    border: `1px solid ${isBase ? EC.gold : EC.line}`,
                    background: isBase ? "#fdf9ef" : "#fff",
                    fontSize: 14, color: EC.ink, fontVariantNumeric: "tabular-nums",
                    fontFamily: "inherit", outline: "none",
                  }}
                />
                <button
                  onClick={() => delGroup(g.id)}
                  disabled={groups.length <= 2}
                  style={{
                    width: 28, border: "none", background: "transparent",
                    cursor: groups.length <= 2 ? "not-allowed" : "pointer",
                    color: groups.length <= 2 ? EC.line : EC.mute, display: "flex", justifyContent: "center", padding: 4,
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          onClick={addGroup}
          style={{
            marginTop: 10, width: "100%", padding: 8, borderRadius: 8,
            border: `1px dashed ${EC.line}`, background: "transparent", color: EC.sageDeep,
            fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "inherit",
          }}
        >
          <Plus size={15} /> 실험군 추가
        </button>
      </div>
    </div>
  );
}

function EfficiencyResults({ result, metric, unit, dir, perfNoun, residNoun }) {
  const { rows, ranked, base } = result;
  const unitStr = unit ? ` ${unit}` : "";
  const medal = ["🥇", "🥈", "🥉"];

  return (
    <>
      {/* ranking podium */}
      <SectionTitle icon={<Trophy size={16} />} text={`${perfNoun} 순위`} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {ranked.map((r, i) => {
          const barW = dir === "lower"
            ? Math.max(4, 100 - r.residual)   // improvement magnitude
            : Math.max(4, r.residual);
          const isBase = r.isBase;
          return (
            <div key={r.id} style={{
              background: EC.soft, border: `1px solid ${isBase ? EC.gold : EC.line}`,
              borderRadius: 10, padding: "10px 14px", position: "relative", overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${Math.min(100, barW)}%`,
                background: isBase
                  ? "linear-gradient(90deg,#fdf6e3,#f8edcf)"
                  : i === 0 ? "linear-gradient(90deg,#eaf2eb,#dcebdd)" : "#f1ede2",
                opacity: 0.7, transition: "width .4s ease",
              }} />
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 18, width: 28, textAlign: "center" }}>
                  {i < 3 ? medal[i] : <span style={{ fontSize: 13, color: EC.mute, fontWeight: 700 }}>{i + 1}</span>}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: EC.ink }}>
                    {r.name} {isBase && <span style={{ fontSize: 11, color: "#9a7b0f", fontWeight: 600 }}>· 기준점</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: EC.mute, marginTop: 1 }}>
                    {metric} {efmt(r.num, 3)}{unitStr} · {residNoun} {efmt(r.residual, 1)}%
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {isBase ? (
                    <span style={{ fontSize: 13, color: EC.mute, fontWeight: 600 }}>기준 100%</span>
                  ) : (
                    <>
                      <div style={{
                        fontSize: 17, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                        color: r.improvement >= 0 ? EC.sageDeep : EC.clay,
                      }}>
                        {r.improvement >= 0 ? "+" : ""}{efmt(r.improvement, 1)}%
                      </div>
                      <div style={{ fontSize: 10.5, color: EC.mute }}>
                        {perfNoun} {r.improvement >= 0 ? "향상" : "저하"}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* measured-value bar chart */}
      <div style={{
        background: EC.soft, border: `1px solid ${EC.line}`, borderRadius: 12,
        padding: "16px 14px 8px", marginBottom: 14,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: EC.sageDeep, marginBottom: 10 }}>
          {metric} 측정값 비교
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={EC.line} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: EC.mute }} interval={0} />
            <YAxis tick={{ fontSize: 11, fill: EC.mute }} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: `1px solid ${EC.line}`, fontSize: 12 }}
              formatter={(v) => [`${efmt(v, 3)}${unitStr}`, metric]}
            />
            <ReferenceLine y={base.num} stroke={EC.gold} strokeDasharray="5 4"
              label={{ value: "기준", fontSize: 10, fill: "#9a7b0f", position: "right" }} />
            <Bar dataKey="num" radius={[6, 6, 0, 0]} maxBarSize={70}>
              {rows.map((r, i) => (
                <Cell key={i} fill={r.isBase ? EC.gold : (r.rank === 1 ? EC.sageDeep : EC.sage)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* improvement bar chart */}
      <div style={{
        background: EC.soft, border: `1px solid ${EC.line}`, borderRadius: 12,
        padding: "16px 14px 8px", marginBottom: 18,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: EC.sageDeep, marginBottom: 10 }}>
          기준 대비 {perfNoun} 변화 (%)
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={rows.filter((r) => !r.isBase)} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={EC.line} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: EC.mute }} interval={0} />
            <YAxis tick={{ fontSize: 11, fill: EC.mute }} unit="%" />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: `1px solid ${EC.line}`, fontSize: 12 }}
              formatter={(v) => [`${efmt(v, 1)}%`, `${perfNoun} 변화`]}
            />
            <ReferenceLine y={0} stroke={EC.mute} />
            <Bar dataKey="improvement" radius={[6, 6, 0, 0]} maxBarSize={70}>
              {rows.filter((r) => !r.isBase).map((r, i) => (
                <Cell key={i} fill={r.improvement >= 0 ? EC.sage : EC.clay} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
