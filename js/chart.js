/*
 * TACTICAL PRICE MAP（Android版 PriceTrajectoryChart.kt の Canvas 描画を移植）
 *
 * シナリオキー:
 *   all  : 全6パターン表示
 *   e1p1 : ① E1→P1
 *   e12p2: ② E1+E2→P2
 *   e12p1: ③ E1+E2→P1
 *   allp2: ④ 全約定(E1〜E3)→P2   (3段モードのみ)
 *   allp1: ⑤ 全約定(E1〜E3)→P1   (3段モードのみ)
 *   l1   : 全損切→L1
 */
(function (root) {
  "use strict";

  const F = root.SPEngine;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function rgba(hex, alpha) {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  let dotScale = 1;
  const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';
  const SANS = '"Segoe UI", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function line(ctx, x1, y1, x2, y2, color, width, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function path(ctx, points, color, width, dash) {
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
    ctx.restore();
  }

  function circle(ctx, x, y, r, fill, stroke, strokeWidth) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  }

  function nodeDot(ctx, x, y, color, innerBg, r) {
    r = r * Math.sqrt(dotScale);
    circle(ctx, x, y, r * 2.1, rgba(color, 0.28));
    circle(ctx, x, y, r, innerBg);
    circle(ctx, x, y, r * 0.72, color);
  }

  function targetRing(ctx, x, y, color, centerColor) {
    const q = Math.sqrt(dotScale);
    circle(ctx, x, y, 10 * q, rgba(color, 0.22));
    circle(ctx, x, y, 5.5 * q, null, color, 2);
    circle(ctx, x, y, 2 * q, centerColor);
  }

  function exitCallout(ctx, c, o) {
    const k = c.k;
    const accent = o.isProfit ? c.profit : c.loss;
    ctx.font = `bold ${8 * k}px ${SANS}`;
    const tagW = ctx.measureText(o.tag).width;
    ctx.font = `bold ${9.5 * k}px ${MONO}`;
    const amtW = ctx.measureText(o.amount).width;
    const padH = 5 * k;
    const padV = 2.5 * k;
    const boxW = Math.max(tagW, amtW) + padH * 2;
    const boxH = 24 * k;
    const offset = 8 * k;
    const rawTop = o.isAbove ? o.y - offset - boxH : o.y + offset;
    const boxTop = clamp(rawTop, 4, c.h - boxH - 4);
    const boxLeft = clamp(o.x - boxW / 2, o.minX + 2, Math.max(o.maxX - boxW - 2, o.minX + 2));

    const stemY = o.isAbove ? boxTop + boxH : boxTop;
    const stemX = clamp(o.x, boxLeft + 4, boxLeft + boxW - 4);
    line(ctx, o.x, o.y, stemX, stemY, rgba(accent, o.isHi ? 0.95 : 0.5), o.isHi ? 1.5 : 1);

    roundRect(ctx, boxLeft, boxTop, boxW, boxH, 6);
    ctx.fillStyle = rgba(c.surface, 0.96);
    ctx.fill();
    ctx.strokeStyle = rgba(accent, o.isHi ? 1 : 0.75);
    ctx.lineWidth = o.isHi ? 1.8 : 1;
    ctx.stroke();

    ctx.fillStyle = c.text;
    ctx.font = `bold ${8 * k}px ${SANS}`;
    ctx.fillText(o.tag, boxLeft + (boxW - tagW) / 2, boxTop + padV + 7.5 * k);
    ctx.fillStyle = accent;
    ctx.font = `bold ${9.5 * k}px ${MONO}`;
    ctx.fillText(o.amount, boxLeft + (boxW - amtW) / 2, boxTop + boxH - padV);
  }

  /** 左右の列に置くラベル（現在値・E1〜E3・P1・P2・L1）が収まる幅 */
  function badgeWidth(ctx, k, items, minWidth) {
    let w = 0;
    items.forEach(([title, subtitle]) => {
      ctx.font = `bold ${10.5 * k}px ${MONO}`;
      w = Math.max(w, ctx.measureText(title).width);
      ctx.font = `${9 * k}px ${SANS}`;
      w = Math.max(w, ctx.measureText(subtitle).width);
    });
    return Math.max(minWidth * k, w + 12 * k);
  }

  function levelBadge(ctx, c, x, centerY, title, subtitle, width, color) {
    const k = c.k;
    const boxH = 32 * k;
    const top = centerY - boxH / 2;
    roundRect(ctx, x, top, width, boxH, 7);
    ctx.fillStyle = rgba(c.surface, 0.96);
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.85);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.font = `bold ${10.5 * k}px ${MONO}`;
    ctx.fillStyle = c.text;
    const tw = ctx.measureText(title).width;
    ctx.fillText(title, x + (width - tw) / 2, top + 12.5 * k);

    ctx.font = `${9 * k}px ${SANS}`;
    ctx.fillStyle = color;
    const sw = ctx.measureText(subtitle).width;
    ctx.fillText(subtitle, x + (width - sw) / 2, top + boxH - 4.5 * k);
  }

  function rightInlineTag(ctx, c, rightX, centerY, text, color) {
    const k = c.k;
    ctx.font = `${9 * k}px ${SANS}`;
    const padH = 6 * k;
    const tw = ctx.measureText(text).width;
    const boxW = tw + padH * 2;
    const boxH = 17 * k;
    const left = rightX - boxW;
    const top = centerY - boxH / 2;
    roundRect(ctx, left, top, boxW, boxH, 4);
    ctx.fillStyle = rgba(c.surface, 0.95);
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.75);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, left + padH, centerY + 3.5 * k);
  }

  /**
   * p: { currentPrice, useThreeEntries, p1, e1, p2, e2, e3, l1, output, scenario, avg12, avg123 }
   */
  function draw(canvas, p) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(rect.width, 280);
    const h = Math.max(rect.height, 200);
    const dpr = root.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 横幅に応じて文字・ラベルを拡大（全幅表示の PC で約 1.45 倍）
    const k = clamp(w / 700, 1, 1.45);
    dotScale = k;
    const c = {
      w: w, h: h, k: k,
      grid: cssVar("--outline-variant"),
      surface: cssVar("--surface"),
      text: cssVar("--on-surface"),
      entry: cssVar("--primary"),
      profit: cssVar("--secondary"),
      average: cssVar("--tertiary"),
      loss: cssVar("--error"),
      current: cssVar("--current")
    };

    const out = p.output;
    const three = p.useThreeEntries;
    const s = p.scenario;
    const avg12 = p.avg12;
    const avg123 = p.avg123;

    const topPad = 42 * k;
    const bottomPad = 34 * k;
    const usableH = Math.max(h - topPad - bottomPad, 100);
    const leftLabels = [["E1 " + F.formatNumber(p.e1), "+" + out.e1Shares + "株"], ["E2 " + F.formatNumber(p.e2), "+" + out.e2Shares + "株"]];
    if (three) leftLabels.push(["E3 " + F.formatNumber(p.e3), "+" + out.e3Shares + "株"]);
    if (p.currentPrice > 0) leftLabels.push(["現在値", F.formatNumber(p.currentPrice)]);
    // Exit 損益（金額＋投資額に対する%）。分母はそのパターンの投資額
    const st1 = out.stage1, st2 = out.stage2, st3 = out.stage3;
    const b1 = st1 ? st1.cumulativeInvestment : 0;
    const b2 = st2 ? st2.cumulativeInvestment : 0;
    const b3 = st3 ? st3.cumulativeInvestment : out.totalInvestment;
    const s1P1 = st1 ? st1.profitAtP1 : 0;
    const s2P2 = st2 ? st2.profitAtP2 : 0;
    const s2P1 = st2 ? st2.profitAtP1 : 0;
    const s3P2 = st3 ? st3.profitAtP2 : out.allFilledProfitAtP2;
    const s3P1 = st3 ? st3.profitAtP1 : out.allFilledProfitAtP1;
    const s3L1 = st3 ? st3.lossAtL1 : out.allFilledLossAtL1;
    const amt = F.formatSignedWithPercent;
    const p1Sub = s === "e1p1" ? amt(s1P1, b1) : s === "e12p1" ? amt(s2P1, b2) : s === "allp1" ? amt(s3P1, b3) : "目標利確";
    const p2Sub = s === "e12p2" ? amt(s2P2, b2) : s === "allp2" ? amt(s3P2, b3) : "安全利確";
    const rightLabels = [["P1 " + F.formatNumber(p.p1), p1Sub], ["P2 " + F.formatNumber(p.p2), p2Sub], ["L1 " + F.formatNumber(p.l1), "損切ライン"]];
    const leftBadgeW = badgeWidth(ctx, k, leftLabels, 58);
    const rightBadgeW = badgeWidth(ctx, k, rightLabels, 60);
    const leftZoneEnd = leftBadgeW + 16;
    const rightZoneStart = w - rightBadgeW - 16;

    const raw = [];
    if (p.currentPrice > 0) raw.push(p.currentPrice);
    raw.push(p.p1, p.e1, p.p2, avg12, p.e2);
    if (three) raw.push(avg123, p.e3);
    raw.push(p.l1);
    const maxP = Math.max.apply(null, raw);
    const minP = Math.min.apply(null, raw);
    const span = Math.max(maxP - minP, 1e-3);
    const rawY = (price) => topPad + clamp((maxP - price) / span, 0, 1) * usableH;

    // 主要ライン間の最小間隔を確保
    const primary = [["P1", p.p1], ["E1", p.e1], ["P2", p.p2], ["E2", p.e2]];
    if (three) primary.push(["E3", p.e3]);
    primary.push(["L1", p.l1]);
    primary.sort((a, b) => b[1] - a[1]);

    const minGap = Math.min(usableH / (primary.length + 1.5), 38 * k);
    const Y = {};
    primary.forEach(([k, v]) => { Y[k] = rawY(v); });
    for (let i = 1; i < primary.length; i++) {
      const prev = Y[primary[i - 1][0]];
      if (Y[primary[i][0]] - prev < minGap) Y[primary[i][0]] = prev + minGap;
    }
    const bottomMost = Y[primary[primary.length - 1][0]];
    if (bottomMost > topPad + usableH) {
      const topMost = Y[primary[0][0]];
      const actualSpan = Math.max(bottomMost - topMost, 1);
      Object.keys(Y).forEach((k) => { Y[k] = topPad + ((Y[k] - topMost) / actualSpan) * usableH; });
    }

    function mappedY(price) {
      if (price >= primary[0][1]) return topPad * 0.65;
      if (price <= primary[primary.length - 1][1]) return topPad + usableH;
      for (let i = 0; i < primary.length - 1; i++) {
        const [kHi, pHi] = primary[i];
        const [kLo, pLo] = primary[i + 1];
        if (price <= pHi && price >= pLo) {
          const ratio = Math.abs(pHi - pLo) > 1e-6 ? (pHi - price) / (pHi - pLo) : 0.5;
          return Y[kHi] + ratio * (Y[kLo] - Y[kHi]);
        }
      }
      return rawY(price);
    }

    const yP1 = Y.P1, yE1 = Y.E1, yP2 = Y.P2, yE2 = Y.E2, yL1 = Y.L1;
    const yE3 = three ? Y.E3 : yE2;
    const yCur = Math.min(Math.max(mappedY(p.currentPrice), 18 * k), Math.max(18 * k, yE1 - 34 * k));
    const yAvg12 = clamp(mappedY(avg12), yP2 + 26 * k, Math.max(yP2 + 26 * k, yL1 - 28 * k));
    const yAvg123 = three ? clamp(mappedY(avg123), yAvg12 + 22 * k, Math.max(yAvg12 + 22 * k, yL1 - 26 * k)) : yAvg12;

    // シナリオごとの表示判定
    const showE2Path = s !== "e1p1";
    const showE3Path = three && (s === "all" || s === "allp2" || s === "allp1" || s === "l1");
    const isP1Active = s === "all" || s === "e1p1" || s === "e12p1" || s === "allp1";
    const isP2Active = s === "all" || s === "e12p2" || s === "allp2";
    const isL1Active = s === "all" || s === "l1";
    const isL1Selected = s === "l1";
    const showAvg12 = (s === "all" || s === "e12p2" || s === "e12p1") && out.stage2 && out.stage2.cumulativeShares > 0;
    const showAvg123 = three && (s === "all" || s === "allp2" || s === "allp1" || s === "l1") &&
      out.stage3 && out.stage3.cumulativeShares > 0;

    // 1. グリッドとゾーン
    for (let col = 1; col < 6; col++) {
      const gx = (w / 6) * col;
      line(ctx, gx, 0, gx, h, rgba(c.grid, 0.5), 1);
    }
    let g = ctx.createLinearGradient(0, yP1, 0, yP2);
    g.addColorStop(0, rgba(c.profit, 0.12));
    g.addColorStop(1, rgba(c.profit, 0.03));
    ctx.fillStyle = g;
    ctx.fillRect(0, yP1, w, Math.max(yP2 - yP1, 2));

    const lastEntryY = three ? yE3 : yE2;
    g = ctx.createLinearGradient(0, lastEntryY, 0, yL1);
    g.addColorStop(0, rgba(c.loss, 0.02));
    g.addColorStop(1, rgba(c.loss, isL1Selected ? 0.25 : 0.12));
    ctx.fillStyle = g;
    ctx.fillRect(0, lastEntryY, w, Math.max(yL1 - lastEntryY, 2));

    // 2. 水平ライン
    const dash = [12, 8];
    const fineDash = [6, 6];
    line(ctx, leftZoneEnd * 0.5, yP1, w - 12, yP1, rgba(c.profit, isP1Active ? 0.9 : 0.35), isP1Active && s !== "all" ? 2.6 : 2);
    line(ctx, leftZoneEnd * 0.5, yP2, w - 12, yP2, rgba(c.profit, isP2Active ? 0.9 : 0.35), isP2Active && s !== "all" ? 2.6 : 2);
    line(ctx, 12, yE1, rightZoneStart * 1.15, yE1, rgba(c.entry, 0.85), 2);
    line(ctx, 12, yE2, rightZoneStart * 1.15, yE2, rgba(c.entry, showE2Path ? 0.85 : 0.35), 2);
    if (three) line(ctx, 12, yE3, rightZoneStart * 1.15, yE3, rgba(c.entry, showE3Path ? 0.85 : 0.35), 2);
    if (showAvg12) line(ctx, leftZoneEnd, yAvg12, w - 8, yAvg12, rgba(c.average, 0.85), 1.5, dash);
    if (showAvg123) line(ctx, leftZoneEnd, yAvg123, w - 8, yAvg123, rgba(c.average, 0.9), 1.5, fineDash);
    line(ctx, 12, yL1, w - 12, yL1, rgba(c.loss, isL1Active ? 0.95 : 0.45), isL1Selected ? 3 : 2, dash);

    // 3. 軌道
    const usableW = Math.max(rightZoneStart - leftZoneEnd, 140);
    const X = (r) => leftZoneEnd + usableW * r;
    const xStart = X(0.04), xE1 = X(0.15), xP1FromE1 = X(0.28);
    const xE2 = X(0.35), xP2FromE2 = X(0.48), xP1FromE2 = X(0.58);
    const xE3 = X(0.52), xP2FromE3 = X(0.74), xP1FromE3 = X(0.88), xL1 = X(0.7);

    const down = [[xStart, yCur], [xE1, yE1]];
    if (showE2Path) down.push([xE2, yE2]);
    if (showE3Path) down.push([xE3, yE3]);
    path(ctx, down, rgba(c.entry, 0.9), 3);

    const hiW = 3.5;
    if (s === "all" || s === "e1p1") path(ctx, [[xE1, yE1], [xP1FromE1, yP1]], rgba(c.profit, s === "e1p1" ? 1 : 0.8), s === "e1p1" ? hiW : 2.2);
    if (s === "all" || s === "e12p2") path(ctx, [[xE2, yE2], [xP2FromE2, yP2]], rgba(c.profit, s === "e12p2" ? 1 : 0.85), s === "e12p2" ? hiW : 2.4);
    if (s === "all" || s === "e12p1") path(ctx, [[xE2, yE2], [xP2FromE2, yP2], [xP1FromE2, yP1]], rgba(c.profit, s === "e12p1" ? 1 : 0.8), s === "e12p1" ? hiW : 2.2);
    if (three && (s === "all" || s === "allp2")) path(ctx, [[xE3, yE3], [xP2FromE3, yP2]], rgba(c.profit, s === "allp2" ? 1 : 0.85), s === "allp2" ? hiW : 2.4);
    if (three && (s === "all" || s === "allp1")) path(ctx, [[xE3, yE3], [xP2FromE3, yP2], [xP1FromE3, yP1]], rgba(c.profit, s === "allp1" ? 1 : 0.9), s === "allp1" ? hiW : 2.5);
    if (isL1Active) {
      const sx = three ? xE3 : xE2;
      const sy = three ? yE3 : yE2;
      path(ctx, [[sx, sy], [xL1, yL1]], rgba(c.loss, isL1Selected ? 1 : 0.75), isL1Selected ? hiW : 2, fineDash);
    }

    nodeDot(ctx, xStart, yCur, c.current, c.surface, 5);
    nodeDot(ctx, xE1, yE1, c.entry, c.surface, 6);
    if (showE2Path) nodeDot(ctx, xE2, yE2, c.entry, c.surface, 6.5);
    if (showE3Path) nodeDot(ctx, xE3, yE3, c.entry, c.surface, 7);

    // Exit 損益コールアウト（スタッガー配置）
    const bounds = { minX: leftZoneEnd, maxX: rightZoneStart };

    function callout(x, y, tag, value, base, isAbove, isHi) {
      targetRing(ctx, x, y, value >= 0 ? c.profit : c.loss, c.text);
      exitCallout(ctx, c, Object.assign({ x, y, tag, amount: amt(value, base), isProfit: value >= 0, isAbove, isHi }, bounds));
    }
    if (s === "all" || s === "e1p1") callout(xP1FromE1, yP1, "① E1→P1", s1P1, b1, true, s === "e1p1");
    if (s === "all" || s === "e12p2") callout(xP2FromE2, yP2, "② E1+2→P2", s2P2, b2, false, s === "e12p2");
    if (s === "all" || s === "e12p1") callout(xP1FromE2, yP1, "③ E1+2→P1", s2P1, b2, false, s === "e12p1");
    if (three && (s === "all" || s === "allp2")) callout(xP2FromE3, yP2, "④ 全約定→P2", s3P2, b3, true, s === "allp2");
    if (three && (s === "all" || s === "allp1")) callout(xP1FromE3, yP1, "⑤ 全約定→P1", s3P1, b3, true, s === "allp1");
    if (isL1Active) {
      exitCallout(ctx, c, Object.assign({
        x: xL1, y: yL1, tag: three ? "⑥ 全損切→L1" : "④ 全損切→L1",
        amount: amt(-Math.abs(s3L1), b3), isProfit: false, isAbove: true, isHi: isL1Selected
      }, bounds));
    }

    // 4. 左列（現在値・E1〜E3）と右列（P1・P2・L1・平均単価）
    const leftX = 8;
    if (p.currentPrice > 0) {
      line(ctx, leftX + leftBadgeW, yCur, xStart, yCur, rgba(c.current, 0.5), 1.2, fineDash);
      levelBadge(ctx, c, leftX, yCur, "現在値", F.formatNumber(p.currentPrice), leftBadgeW, c.current);
    }
    levelBadge(ctx, c, leftX, yE1, "E1 " + F.formatNumber(p.e1), "+" + out.e1Shares + "株", leftBadgeW, c.entry);
    levelBadge(ctx, c, leftX, yE2, "E2 " + F.formatNumber(p.e2), "+" + out.e2Shares + "株", leftBadgeW, c.entry);
    if (three) levelBadge(ctx, c, leftX, yE3, "E3 " + F.formatNumber(p.e3), "+" + out.e3Shares + "株", leftBadgeW, c.entry);

    if (showAvg12) rightInlineTag(ctx, c, w - 8, yAvg12, `E1+E2平均 ${F.formatNumber(avg12)} (≤P2)`, c.average);
    if (showAvg123) rightInlineTag(ctx, c, w - 8, yAvg123, `E1〜E3平均 ${F.formatNumber(avg123)} (≤P2)`, c.average);

    const rightX = w - rightBadgeW - 8;
    levelBadge(ctx, c, rightX, yP1, "P1 " + F.formatNumber(p.p1), p1Sub, rightBadgeW, c.profit);
    levelBadge(ctx, c, rightX, yP2, "P2 " + F.formatNumber(p.p2), p2Sub, rightBadgeW, c.profit);
    levelBadge(ctx, c, rightX, yL1, "L1 " + F.formatNumber(p.l1), s !== "all" ? "損切実行" : "損切ライン", rightBadgeW, c.loss);
  }

  root.SPChart = { draw: draw };
})(window);
