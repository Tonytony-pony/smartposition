/*
 * SmartPosition 計算エンジン（Android版 ScaleEntryCalculatorEngine.kt の忠実な移植）
 *
 * - 本トレード許容損失額 = 総額 ÷ (3n + n)
 * - 全損切時の総損失 N1*(E1-L1) + N2*(E2-L1) + N3*(E3-L1) <= 本トレード許容損失額
 * - Avg(E1,E2) <= P2、Avg(E1..E3) <= P2（P2で全決済すればプラス）
 * - 条件を満たせない小さな予算では 0株 を返す（条件を破った株数は出さない）
 *
 * ブラウザでは window.SPEngine、Node では module.exports として公開する。
 */
(function (root) {
  "use strict";

  function defaultInput() {
    return {
      ticker: "NVDA",
      totalMaxLoss: 4000,
      n: 1,
      currentPrice: 595,
      useThreeEntries: true,
      p1Price: 611,
      e1Price: 574,
      p2Price: 571,
      e2Price: 532,
      e3Price: 501,
      l1Price: 480,
      p2MarginBias: DEFAULT_BIAS,
      manualE1Shares: null,
      manualE2Shares: null,
      manualE3Shares: null,
      tradeMaxLossOverride: null
    };
  }

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  /** Kotlin の Int 除算 / toInt() と同じ 0 方向への切り捨て */
  function toInt(v) {
    return Math.trunc(v);
  }

  /** Kotlin の roundToInt()（四捨五入、.5 は +∞ 方向） */
  function roundToInt(v) {
    return Math.round(v);
  }

  function formatNum(v) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
  }

  function formatMoney(v) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(roundHalfEven(v));
  }

  /** kotlin.math.round と同じ偶数丸め */
  function roundHalfEven(v) {
    const r = Math.round(v);
    if (Math.abs(v % 1) === 0.5 && r % 2 !== 0) return r - 1;
    return r;
  }

  function calculate(rawInput) {
    const input = Object.assign(defaultInput(), rawInput || {});
    const safeN = Math.max(1, input.n);
    const divisor = 3 * safeN + safeN; // 3n + n = 4n
    const autoTradeMaxLoss = Math.max(0, input.totalMaxLoss / divisor);
    // 本トレードの許容損失額を手入力した時はそれを使う（null = 自動計算）
    const isTradeMaxLossManual = input.tradeMaxLossOverride != null;
    const tradeMaxLoss = isTradeMaxLossManual ? Math.max(0, input.tradeMaxLossOverride) : autoTradeMaxLoss;
    const errors = [];
    const warnings = [];

    if (isTradeMaxLossManual) {
      if (!(input.tradeMaxLossOverride > 0)) {
        errors.push("本トレードの損失許容額には0より大きい数値を入力してください。");
      }
    } else if (!(input.totalMaxLoss > 0)) {
      errors.push("総額の損失許容額には0より大きい数値を入力してください。");
    }
    if (input.n < 1) {
      errors.push("nには1以上の整数を入力してください。");
    }
    if (input.p1Price <= input.e1Price) {
      errors.push(`利確ライン P1 (${formatNum(input.p1Price)}) は E1 (${formatNum(input.e1Price)}) より高い価格にしてください。`);
    }
    if (input.p2Price >= input.e1Price) {
      errors.push(`利確ライン P2 (${formatNum(input.p2Price)}) は E1 (${formatNum(input.e1Price)}) より少し下の価格にしてください。`);
    }
    if (input.p2Price <= input.e2Price) {
      errors.push(`利確ライン P2 (${formatNum(input.p2Price)}) は E2 (${formatNum(input.e2Price)}) より上の価格にしてください（E1・E2平均をP2以下にするため）。`);
    }
    if (input.useThreeEntries) {
      if (input.e2Price <= input.e3Price) {
        errors.push(`第3反発ライン E3 (${formatNum(input.e3Price)}) は E2 (${formatNum(input.e2Price)}) より低い価格にしてください。`);
      }
      if (input.l1Price >= input.e3Price) {
        errors.push(`損切ライン L1 (${formatNum(input.l1Price)}) は E3 (${formatNum(input.e3Price)}) より低い価格にしてください。`);
      }
    } else if (input.l1Price >= input.e2Price) {
      errors.push(`損切ライン L1 (${formatNum(input.l1Price)}) は E2 (${formatNum(input.e2Price)}) より低い価格にしてください。`);
    }
    if (input.l1Price <= 0) {
      errors.push("損切ライン L1 には0より大きい価格を入力してください。");
    }
    if (input.currentPrice < input.e1Price && input.currentPrice > 0) {
      warnings.push(`現在値 (${formatNum(input.currentPrice)}) が E1 (${formatNum(input.e1Price)}) を下回っています。`);
    }

    if (errors.length > 0) {
      return {
        isValid: false,
        validationErrors: errors,
        warnings: warnings,
        totalMaxLoss: input.totalMaxLoss,
        n: safeN,
        divisor: divisor,
        tradeMaxLoss: tradeMaxLoss,
        autoTradeMaxLoss: autoTradeMaxLoss,
        isTradeMaxLossManual: isTradeMaxLossManual,
        e1Shares: 0, e2Shares: 0, e3Shares: 0,
        totalShares: 0, totalInvestment: 0,
        e1LossPerShare: 0, e2LossPerShare: 0, e3LossPerShare: 0,
        minN2ToN1RatioForP2: 0, actualN2ToN1Ratio: 0,
        stage1: null, stage2: null, stage3: null,
        finalAverageCost: 0, allFilledProfitAtP1: 0, allFilledProfitAtP2: 0, allFilledLossAtL1: 0,
        riskBudgetUtilizationPercent: 0,
        isManualOverride: false
      };
    }

    const d1 = input.e1Price - input.l1Price;
    const d2 = input.e2Price - input.l1Price;
    const d3 = input.useThreeEntries ? input.e3Price - input.l1Price : 0;
    const minRatioN2N1 = (input.e1Price - input.p2Price) / (input.p2Price - input.e2Price);

    const isManual = input.manualE1Shares != null ||
      input.manualE2Shares != null ||
      (input.useThreeEntries && input.manualE3Shares != null);

    const auto = findOptimalIntegerShares(
      tradeMaxLoss, input.e1Price, input.e2Price, input.e3Price, input.p2Price,
      d1, d2, d3, input.useThreeEntries, clamp(input.p2MarginBias, 0, 1)
    );
    let n1 = auto[0], n2 = auto[1], n3 = auto[2];
    if (isManual) {
      n1 = Math.max(0, input.manualE1Shares != null ? input.manualE1Shares : auto[0]);
      n2 = Math.max(0, input.manualE2Shares != null ? input.manualE2Shares : auto[1]);
      n3 = input.useThreeEntries ? Math.max(0, input.manualE3Shares != null ? input.manualE3Shares : auto[2]) : 0;
    }

    if (n1 + n2 + n3 === 0) {
      warnings.push(`本トレードの損失許容額 (${formatMoney(tradeMaxLoss)}) が1株あたりの損切幅に対して小さすぎるため、許容内の購入株数が0株となっています。`);
    }

    // Stage 1: E1 only
    const stage1Shares = n1;
    const stage1Cost = n1 * input.e1Price;
    const stage1Avg = stage1Shares > 0 ? input.e1Price : 0;
    const stage1ProfitP1 = stage1Shares * (input.p1Price - stage1Avg);
    const stage1ProfitP2 = stage1Shares * (input.p2Price - stage1Avg);
    const stage1LossL1 = stage1Shares * d1;
    const stage1 = {
      stageIndex: 1,
      stageLabel: "E1のみ約定",
      stageDescription: `E1 (${formatNum(input.e1Price)}) で反発し決済した場合`,
      entryPrice: input.e1Price,
      stageShares: n1,
      cumulativeShares: stage1Shares,
      cumulativeInvestment: stage1Cost,
      averageCost: stage1Avg,
      isAvgBelowP2: stage1Avg <= input.p2Price && stage1Shares > 0,
      profitAtP1: stage1ProfitP1,
      profitAtP2: stage1ProfitP2,
      lossAtL1: stage1LossL1,
      riskRewardAtP1: stage1LossL1 > 0 ? stage1ProfitP1 / stage1LossL1 : 0,
      riskRewardAtP2: stage1LossL1 > 0 ? stage1ProfitP2 / stage1LossL1 : 0
    };

    // Stage 2: E1 + E2
    const stage2Shares = n1 + n2;
    const stage2Cost = stage1Cost + n2 * input.e2Price;
    const stage2Avg = stage2Shares > 0 ? stage2Cost / stage2Shares : 0;
    const stage2ProfitP1 = stage2Shares * (input.p1Price - stage2Avg);
    const stage2ProfitP2 = stage2Shares * (input.p2Price - stage2Avg);
    const stage2LossL1 = n1 * d1 + n2 * d2;

    if (stage2Shares > 0 && stage2Avg > input.p2Price) {
      warnings.push(`E1+E2の平均取得単価 (${formatNum(stage2Avg)}) が P2 (${formatNum(input.p2Price)}) を上回っています。P2で利確するにはE2の株数を増やすかE1を減らしてください。`);
    } else if (stage2Shares > 0 && Math.abs(stage2ProfitP2) < 1e-6) {
      warnings.push("E1+E2の平均取得単価が P2 と同値のため、P2決済時の利益は ±0 です。");
    }

    const stage2 = {
      stageIndex: 2,
      stageLabel: "E1 + E2 約定",
      stageDescription: `E2 (${formatNum(input.e2Price)}) で反発しP2等で全決済した場合`,
      entryPrice: input.e2Price,
      stageShares: n2,
      cumulativeShares: stage2Shares,
      cumulativeInvestment: stage2Cost,
      averageCost: stage2Avg,
      isAvgBelowP2: stage2Avg <= input.p2Price && stage2Shares > 0,
      profitAtP1: stage2ProfitP1,
      profitAtP2: stage2ProfitP2,
      lossAtL1: stage2LossL1,
      riskRewardAtP1: stage2LossL1 > 0 ? stage2ProfitP1 / stage2LossL1 : 0,
      riskRewardAtP2: stage2LossL1 > 0 ? stage2ProfitP2 / stage2LossL1 : 0
    };

    // Stage 3: E1 + E2 + E3
    let stage3 = null;
    if (input.useThreeEntries) {
      const stage3Shares = n1 + n2 + n3;
      const stage3Cost = stage2Cost + n3 * input.e3Price;
      const stage3Avg = stage3Shares > 0 ? stage3Cost / stage3Shares : 0;
      const stage3ProfitP1 = stage3Shares * (input.p1Price - stage3Avg);
      const stage3ProfitP2 = stage3Shares * (input.p2Price - stage3Avg);
      const stage3LossL1 = n1 * d1 + n2 * d2 + n3 * d3;

      if (stage3Shares > 0 && stage3Avg > input.p2Price) {
        warnings.push(`E1〜E3の平均取得単価 (${formatNum(stage3Avg)}) が P2 (${formatNum(input.p2Price)}) を上回っています。`);
      }

      stage3 = {
        stageIndex: 3,
        stageLabel: "E1 + E2 + E3 全約定",
        stageDescription: `E3 (${formatNum(input.e3Price)}) まで約定後に全決済した場合`,
        entryPrice: input.e3Price,
        stageShares: n3,
        cumulativeShares: stage3Shares,
        cumulativeInvestment: stage3Cost,
        averageCost: stage3Avg,
        isAvgBelowP2: stage3Avg <= input.p2Price && stage3Shares > 0,
        profitAtP1: stage3ProfitP1,
        profitAtP2: stage3ProfitP2,
        lossAtL1: stage3LossL1,
        riskRewardAtP1: stage3LossL1 > 0 ? stage3ProfitP1 / stage3LossL1 : 0,
        riskRewardAtP2: stage3LossL1 > 0 ? stage3ProfitP2 / stage3LossL1 : 0
      };
    }

    const finalSim = stage3 || stage2;
    if (finalSim.lossAtL1 > tradeMaxLoss + 1e-6) {
      warnings.push(`L1損切り時の損失額 (${formatMoney(finalSim.lossAtL1)}) が本トレードの損失許容額 (${formatMoney(tradeMaxLoss)}) を超過しています。`);
    }

    return {
      isValid: true,
      validationErrors: [],
      warnings: warnings,
      totalMaxLoss: input.totalMaxLoss,
      n: safeN,
      divisor: divisor,
      tradeMaxLoss: tradeMaxLoss,
      autoTradeMaxLoss: autoTradeMaxLoss,
      isTradeMaxLossManual: isTradeMaxLossManual,
      e1Shares: n1,
      e2Shares: n2,
      e3Shares: n3,
      totalShares: finalSim.cumulativeShares,
      totalInvestment: finalSim.cumulativeInvestment,
      e1LossPerShare: d1,
      e2LossPerShare: d2,
      e3LossPerShare: d3,
      minN2ToN1RatioForP2: minRatioN2N1,
      actualN2ToN1Ratio: n1 > 0 ? n2 / n1 : 0,
      stage1: stage1,
      stage2: stage2,
      stage3: stage3,
      finalAverageCost: finalSim.averageCost,
      allFilledProfitAtP1: finalSim.profitAtP1,
      allFilledProfitAtP2: finalSim.profitAtP2,
      allFilledLossAtL1: finalSim.lossAtL1,
      riskBudgetUtilizationPercent: tradeMaxLoss > 0 ? (finalSim.lossAtL1 / tradeMaxLoss) * 100 : 0,
      isManualOverride: isManual
    };
  }

  /** スライダーの既定位置（E1:E2:E3 ≒ 1:2:3） */
  const DEFAULT_BIAS = 0.5;
  /** 目標比率からのずれの重み（予算消化率 100% = 100点に対して） */
  const RATIO_WEIGHT = 60;
  /** E3 株数の候補数（残り予算を使い切る株数から何株まで減らして比べるか） */
  const N3_CANDIDATES = 20;

  /**
   * スライダー値から目標の株数比 N2/N1・N3/N2 を決める（区分線形）。
   *   0.0 → 1 : 0.75 : 0.71   E1重視（浅い押し目での利益を最大化）
   *   0.5 → 1 : 2    : 3      既定
   *   1.0 → 1 : 3    : 6      下値重視（平均単価をP2より大きく引き下げる）
   */
  function biasTargets(bias) {
    if (bias <= DEFAULT_BIAS) {
      const t = bias / DEFAULT_BIAS;
      return { r12: 0.75 + 1.25 * t, r23: 0.95 + 0.55 * t };
    }
    const t = (bias - DEFAULT_BIAS) / (1 - DEFAULT_BIAS);
    return { r12: 2 + t, r23: 1.5 + 0.5 * t };
  }

  /**
   * 1株単位の最適株数 (N1, N2, N3) を探索する。
   * bias: 0.0 = E1重視 / 1.0 = E2・E3（下値）重視
   */
  function findOptimalIntegerShares(tradeMaxLoss, e1, e2, e3, p2, d1, d2, d3, useThreeEntries, bias) {
    if (tradeMaxLoss < Math.min(d1, d2)) return [0, 0, 0];

    const minR12 = (e1 - p2) / (p2 - e2);
    const targets = biasTargets(bias);
    // Avg(E1,E2) <= P2 に必要な比率が 1:2 を上回る銘柄では、保証を優先して E2 を増やす
    const targetR12 = Math.max(minR12 * (1.08 + 0.75 * bias), targets.r12);
    const targetR23 = useThreeEntries ? targets.r23 : 0;

    const w1 = 1;
    const w2 = targetR12;
    const w3 = useThreeEntries ? w2 * targetR23 : 0;
    const unitLoss = w1 * d1 + w2 * d2 + w3 * d3;
    const idealN1 = (tradeMaxLoss / unitLoss) * w1;

    const baseN1 = Math.floor(idealN1);
    const radius = Math.max(12, Math.min(40, toInt(baseN1 / 4) + 10));
    const minN1Search = Math.max(1, baseN1 - radius);
    const maxN1Search = Math.max(1, Math.min(toInt(tradeMaxLoss / d1), baseN1 + radius));

    let best = null;
    let bestScore = -Infinity;

    for (let n1 = minN1Search; n1 <= maxN1Search; n1++) {
      const loss1 = n1 * d1;
      if (loss1 > tradeMaxLoss) break;

      const ratio = (n1 * (e1 - p2)) / (p2 - e2);
      const minN2ForBreakeven = Math.max(1, Math.ceil(ratio - 1e-9));
      const minN2ForProfit = Math.floor(ratio + 1e-9) + 1;

      const remainingAfter1 = tradeMaxLoss - loss1;
      const maxPossibleN2 = Math.floor(remainingAfter1 / d2);
      if (maxPossibleN2 < minN2ForBreakeven) continue;

      const centerN2 = clamp(roundToInt(n1 * targetR12), minN2ForBreakeven, maxPossibleN2);
      const n2Low = Math.max(minN2ForBreakeven, centerN2 - 10);
      const n2High = Math.min(maxPossibleN2, centerN2 + 10);

      for (let n2 = n2Low; n2 <= n2High; n2++) {
        const loss12 = loss1 + n2 * d2;
        if (loss12 > tradeMaxLoss) break;

        if (!useThreeEntries) {
          const strict = n2 >= minN2ForProfit;
          const budgetRatio = loss12 / tradeMaxLoss;
          const ratioDiff = Math.abs(n2 / n1 - targetR12) / Math.max(1, targetR12);
          const score = budgetRatio * 100 - ratioDiff * RATIO_WEIGHT + (strict ? 20 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = [n1, n2, 0];
          }
        } else {
          // E3 は予算の残りを全部使う株数から少しずつ減らした候補も比べ、比率と予算消化のバランスで選ぶ
          const maxN3 = Math.floor((tradeMaxLoss - loss12) / d3);
          const targetN3PerN1 = targetR12 * targetR23;
          for (let n3 = maxN3; n3 >= Math.max(1, maxN3 - N3_CANDIDATES); n3--) {
            const avg123 = (n1 * e1 + n2 * e2 + n3 * e3) / (n1 + n2 + n3);
            if (avg123 > p2 + 1e-9) break; // n3 を減らすほど平均は上がる

            const totalLoss = loss12 + n3 * d3;
            const strict = n2 >= minN2ForProfit;
            const budgetRatio = totalLoss / tradeMaxLoss;
            const penalty =
              (Math.abs(n2 / n1 - targetR12) / Math.max(1, targetR12)) * RATIO_WEIGHT +
              (Math.abs(n3 / n1 - targetN3PerN1) / Math.max(1, targetN3PerN1)) * RATIO_WEIGHT;
            const score = budgetRatio * 100 - penalty + (strict ? 25 : 0);
            if (score > bestScore) {
              bestScore = score;
              best = [n1, n2, n3];
            }
          }
        }
      }
    }

    if (best) return best;
    return findFallbackShares(tradeMaxLoss, e1, e2, p2, d1, d2, d3, useThreeEntries);
  }

  /**
   * 近傍探索で解が見つからない小さな予算向け。
   * 予算超過や Avg(E1,E2) > P2 になる株数は返さず、満たせなければ (0,0,0)。
   */
  function findFallbackShares(tradeMaxLoss, e1, e2, p2, d1, d2, d3, useThreeEntries) {
    let best = [0, 0, 0];
    let bestScore = -Infinity;
    const maxN1 = Math.floor(tradeMaxLoss / d1);

    for (let n1 = 1; n1 <= maxN1; n1++) {
      const ratio = (n1 * (e1 - p2)) / (p2 - e2);
      const minN2ForBreakeven = Math.max(1, Math.ceil(ratio - 1e-9));
      const minN2ForProfit = Math.floor(ratio + 1e-9) + 1;

      const remainingAfter1 = tradeMaxLoss - n1 * d1;
      const maxN2 = Math.floor(remainingAfter1 / d2);
      if (maxN2 < minN2ForBreakeven) continue;

      let n2, n3;
      if (useThreeEntries && d3 > 0) {
        n2 = maxN2 >= minN2ForProfit ? minN2ForProfit : minN2ForBreakeven;
        n3 = Math.max(0, Math.floor((remainingAfter1 - n2 * d2) / d3));
      } else {
        n2 = maxN2;
        n3 = 0;
      }

      const totalLoss = n1 * d1 + n2 * d2 + n3 * d3;
      if (totalLoss > tradeMaxLoss + 1e-9) continue;

      const score = (totalLoss / tradeMaxLoss) * 100 + (n2 >= minN2ForProfit ? 25 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = [n1, n2, n3];
      }
    }
    return best;
  }

  // ---- 表示フォーマット（CLAUDE.md §4-⑤ と同じ規則） ----

  /** 株価・平均単価: 小数は最大2桁、カンマ区切り（例: 548.05, 611.9, 1,234.5） */
  function formatNumber(value) {
    const fraction = value % 1 === 0 ? 0 : 2;
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: fraction }).format(value);
  }

  /** 金額: 小数点以下を丸めて整数、カンマ区切り（例: 124,558） */
  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(roundHalfEven(value));
  }

  /** 符号付き金額（例: +8,224 / -49,991） */
  function formatSigned(value) {
    const rounded = roundHalfEven(value);
    const sign = rounded >= 0 ? "+" : "-";
    return sign + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.abs(rounded));
  }

  // 投資額に対する損益率。整数%に丸め、符号を付ける（例: "+6%", "-12%"）。投資額が0なら空文字。
  function formatPercent(value, base) {
    if (!(base > 0) || !isFinite(value)) return "";
    const pct = roundHalfEven(Math.abs(value) / base * 100);
    return (value < 0 && pct > 0 ? "-" : "+") + pct + "%";
  }

  // 符号付き金額＋損益率（例: "+148(+6%)", "-992(-12%)"）。損切は value に負の値を渡す。
  function formatSignedWithPercent(value, base) {
    const pct = formatPercent(value, base);
    return formatSigned(value) + (pct ? "(" + pct + ")" : "");
  }

  const api = {
    DEFAULT_BIAS: DEFAULT_BIAS,
    defaultInput: defaultInput,
    calculate: calculate,
    formatNumber: formatNumber,
    formatCurrency: formatCurrency,
    formatSigned: formatSigned,
    formatPercent: formatPercent,
    formatSignedWithPercent: formatSignedWithPercent
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.SPEngine = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
