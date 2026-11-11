// node --test tests/  で実行（依存パッケージなし）
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../js/engine.js");

const base = {
  ticker: "NVDA", totalMaxLoss: 200000, n: 1, currentPrice: 595, useThreeEntries: true,
  p1Price: 611, e1Price: 574, p2Price: 571, e2Price: 532, e3Price: 501, l1Price: 480,
  p2MarginBias: 0.5
};

function assertInvariants(input, out) {
  const ctx = JSON.stringify({ input, shares: [out.e1Shares, out.e2Shares, out.e3Shares] });
  assert.ok(out.allFilledLossAtL1 <= out.tradeMaxLoss + 1e-6, "budget exceeded " + ctx);
  if (out.stage2.cumulativeShares > 0) {
    assert.ok(out.stage2.averageCost <= input.p2Price + 1e-9, "Avg(E1,E2) > P2 " + ctx);
  }
  if (out.stage3 && out.stage3.cumulativeShares > 0) {
    assert.ok(out.stage3.averageCost <= input.p2Price + 1e-9, "Avg(E1..E3) > P2 " + ctx);
  }
  if (out.e1Shares === 0) assert.equal(out.e2Shares + out.e3Shares, 0, "E2/E3 without E1 " + ctx);
  if (!input.useThreeEntries) assert.equal(out.e3Shares, 0);
}

test("総額÷4 と制約（Android版 ExampleUnitTest と同じ）", () => {
  const out = E.calculate(base);
  assert.ok(out.isValid);
  assert.equal(out.divisor, 4);
  assert.equal(out.tradeMaxLoss, 50000);
  assert.deepEqual([out.e1Shares, out.e2Shares, out.e3Shares], [191, 382, 573]);
  assert.ok(out.stage2.profitAtP2 > 0);
  assert.ok(out.stage3.profitAtP2 > 0);
  assert.ok(out.stage3.profitAtP1 > out.stage3.profitAtP2);
  assertInvariants(base, out);
});

test("総額 / (3n + n): 40,000 → n=1で10,000、n=2で5,000", () => {
  const i = Object.assign({}, base, { totalMaxLoss: 40000, n: 1 });
  assert.equal(E.calculate(i).tradeMaxLoss, 10000);
  const o2 = E.calculate(Object.assign({}, i, { n: 2 }));
  assert.equal(o2.divisor, 8);
  assert.equal(o2.tradeMaxLoss, 5000);
});

test("P2がE1より上なら入力エラー", () => {
  const out = E.calculate(Object.assign({}, base, { totalMaxLoss: 100000, p2Price: 580 }));
  assert.equal(out.isValid, false);
  assert.ok(out.validationErrors.length > 0);
});

test("小さな予算で Avg(E1,E2) ≤ P2 を守れない場合は0株", () => {
  const input = { totalMaxLoss: 400, n: 1, p1Price: 110, e1Price: 100, p2Price: 91, e2Price: 90, e3Price: 85, l1Price: 80, useThreeEntries: true };
  const out = E.calculate(input);
  assert.ok(out.isValid);
  assert.equal(out.tradeMaxLoss, 100);
  assert.equal(out.totalShares, 0);
  assert.ok(out.warnings.some((w) => w.includes("0株")));
  assertInvariants(input, out);
});

test("E3が入らない予算ではE1・E2だけを返す", () => {
  const input = { totalMaxLoss: 132, n: 1, p1Price: 110, e1Price: 100, p2Price: 99, e2Price: 90, e3Price: 85, l1Price: 80, useThreeEntries: true };
  const out = E.calculate(input);
  assert.deepEqual([out.e1Shares, out.e2Shares, out.e3Shares], [1, 1, 0]);
  assert.ok(out.stage2.profitAtP2 > 0);
  assertInvariants(input, out);
});

test("2段モード（TSLAプリセット）", () => {
  const input = { ticker: "TSLA", totalMaxLoss: 6000, n: 1, currentPrice: 262, useThreeEntries: false, p1Price: 275, e1Price: 250, p2Price: 247, e2Price: 232, e3Price: 218, l1Price: 215, p2MarginBias: 0.5 };
  const out = E.calculate(input);
  assert.equal(out.stage3, null);
  assert.deepEqual([out.e1Shares, out.e2Shares, out.e3Shares], [21, 42, 0]);
  assert.ok(out.allFilledProfitAtP2 > 0);
  assertInvariants(input, out);
});

test("スライダー 0→1 でE1からE2・E3へ比重が移る", () => {
  const low = E.calculate(Object.assign({}, base, { p2MarginBias: 0 }));
  const high = E.calculate(Object.assign({}, base, { p2MarginBias: 1 }));
  assert.deepEqual([low.e1Shares, low.e2Shares, low.e3Shares], [338, 253, 241]);
  assert.deepEqual([high.e1Shares, high.e2Shares, high.e3Shares], [133, 399, 797]);
  assert.ok(high.finalAverageCost < low.finalAverageCost);
});

test("スライダー既定位置は E1:E2:E3 = 1:2:3（プリセット3件）", () => {
  assert.equal(E.DEFAULT_BIAS, 0.5);
  assert.equal(E.defaultInput().p2MarginBias, 0.5);
  const aapl = E.calculate({ totalMaxLoss: 4000, n: 1, p1Price: 235, e1Price: 222, p2Price: 220, e2Price: 212, e3Price: 204, l1Price: 196, useThreeEntries: true });
  assert.deepEqual([aapl.e1Shares, aapl.e2Shares, aapl.e3Shares], [12, 24, 36]);
});

test("既定位置の比率誤差: E1が10株以上なら各比率は1:2:3の±12%以内、95%以上は±5%以内", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let checked = 0, within5 = 0;
  for (let k = 0; k < 2000; k++) {
    const l1 = [50, 100, 480, 1800][Math.floor(rnd() * 4)];
    const st = l1 * (0.01 + rnd() * 0.09);
    const e3 = l1 + st * (0.5 + rnd() * 2.5), e2 = e3 + st * (0.5 + rnd() * 2.5);
    const p2 = e2 + st * (0.3 + rnd() * 1.7), e1 = p2 + st * (0.05 + rnd() * 1.5);
    // Avg(E1,E2) <= P2 の保証に 1:2 より多くの E2 が要る銘柄は対象外（保証を優先するため）
    if (((e1 - p2) / (p2 - e2)) * 1.455 > 2) continue;
    const three = rnd() < 0.6;
    const out = E.calculate({ totalMaxLoss: (e1 - l1) * (30 + rnd() * 300) * 4, n: 1, p1Price: e1 + st, e1Price: e1, p2Price: p2, e2Price: e2, e3Price: e3, l1Price: l1, useThreeEntries: three });
    if (!out.isValid || out.e1Shares < 10) continue;
    const dev = Math.max(Math.abs(out.e2Shares / out.e1Shares - 2) / 2, three ? Math.abs(out.e3Shares / out.e1Shares - 3) / 3 : 0);
    assert.ok(dev <= 0.12, `ratio ${out.e1Shares}:${out.e2Shares}:${out.e3Shares}`);
    if (dev <= 0.05) within5++;
    checked++;
  }
  assert.ok(checked > 1000);
  assert.ok(within5 / checked >= 0.95, `within5 ${within5}/${checked}`);
});

test("手動調整は予算超過を許すが警告を出す", () => {
  const out = E.calculate(Object.assign({}, base, { manualE1Shares: 211, manualE2Shares: 382, manualE3Shares: 573 }));
  assert.ok(out.isManualOverride);
  assert.ok(out.allFilledLossAtL1 > out.tradeMaxLoss);
  assert.ok(out.warnings.some((w) => w.includes("超過")));
});

test("ランダム入力3,000件で予算・平均単価の不変条件を満たす", () => {
  let seed = 20261106;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const r2 = (v) => Math.round(v * 100) / 100;
  let checked = 0;
  for (let k = 0; k < 3000; k++) {
    const l1 = [50, 100, 480, 1800][Math.floor(rnd() * 4)];
    const step = l1 * (0.01 + rnd() * 0.09);
    const e3 = r2(l1 + step * (0.5 + rnd() * 2.5));
    const e2 = r2(e3 + step * (0.5 + rnd() * 2.5));
    const p2 = r2(e2 + step * (0.05 + rnd() * 1.95));
    const e1 = r2(p2 + step * (0.05 + rnd() * 2.95));
    const p1 = r2(e1 + step);
    if (!(p1 > e1 && e1 > p2 && p2 > e2 && e2 > e3 && e3 > l1)) continue;
    const d1 = e1 - l1;
    const mode = Math.floor(rnd() * 3);
    const t = mode === 0 ? 1 + rnd() * d1 * 5 : mode === 1 ? 1 + rnd() * d1 * 60 : 1000 + rnd() * 99000;
    const input = { totalMaxLoss: t * 4, n: 1, useThreeEntries: rnd() < 0.6, p1Price: p1, e1Price: e1, p2Price: p2, e2Price: e2, e3Price: e3, l1Price: l1, p2MarginBias: rnd() };
    const out = E.calculate(input);
    assert.ok(out.isValid, JSON.stringify(out.validationErrors));
    assertInvariants(input, out);
    checked++;
  }
  assert.ok(checked > 2000);
});

test("数値フォーマット規約", () => {
  assert.equal(E.formatSigned(8224.4), "+8,224");
  assert.equal(E.formatSigned(-49991), "-49,991");
  assert.equal(E.formatCurrency(124557.6), "124,558");
  assert.equal(E.formatNumber(548.05), "548.05");
  assert.equal(E.formatNumber(611.9), "611.9");
  assert.equal(E.formatNumber(1234.5), "1,234.5");
  assert.equal(E.formatNumber(600), "600");
});

test("損益率(%)は投資額に対する整数%で、金額の後ろに括弧で付く", () => {
  assert.equal(E.formatPercent(148, 2296), "+6%");
  assert.equal(E.formatPercent(-992, 7000), "-14%");
  assert.equal(E.formatPercent(0, 1000), "+0%");
  assert.equal(E.formatPercent(-1, 100000), "+0%");
  assert.equal(E.formatPercent(100, 0), "");
  assert.equal(E.formatSignedWithPercent(148, 2296), "+148(+6%)");
  assert.equal(E.formatSignedWithPercent(-992, 7000), "-992(-14%)");
  assert.equal(E.formatSignedWithPercent(500, 0), "+500");
});

test("本トレードの許容損失額を手入力すると総額÷4nより優先され、不変条件も保たれる", () => {
  const auto = E.calculate({ totalMaxLoss: 4000 });
  assert.equal(auto.tradeMaxLoss, 1000);
  assert.equal(auto.isTradeMaxLossManual, false);

  const out = E.calculate({ totalMaxLoss: 4000, tradeMaxLossOverride: 2500 });
  assert.equal(out.isValid, true);
  assert.equal(out.isTradeMaxLossManual, true);
  assert.equal(out.tradeMaxLoss, 2500);
  assert.equal(out.autoTradeMaxLoss, 1000);
  assert.ok(out.allFilledLossAtL1 <= 2500 + 1e-6);
  assert.ok(out.e1Shares + out.e2Shares + out.e3Shares > auto.e1Shares + auto.e2Shares + auto.e3Shares);
  assert.ok(out.stage3.averageCost <= 571 + 1e-9);

  // 手入力時は総額が0でもエラーにしない。手入力値が0ならエラー
  assert.equal(E.calculate({ totalMaxLoss: 0, tradeMaxLossOverride: 1000 }).isValid, true);
  assert.equal(E.calculate({ tradeMaxLossOverride: 0 }).isValid, false);
});
