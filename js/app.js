/*
 * SmartPosition Web — 状態管理と画面更新（Android版 TradePlannerViewModel.kt に対応）
 * 保存先はブラウザの localStorage のみ。
 */
(function () {
  "use strict";

  const E = window.SPEngine;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- storage
  const KEY = {
    plans: "smartposition.plans.v1",
    seeded: "smartposition.presetsSeeded",
    theme: "smartposition.theme",
    draft: "smartposition.draft.v1"
  };

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        showBanner("ブラウザの保存領域に書き込めませんでした（プライベートモードや容量不足の可能性があります）");
      }
    }
  };

  // ---------------------------------------------------------------- presets
  const PRESETS = [
    { name: "標準モデル (574/532/501)", ticker: "NVDA", note: "P1:611 / P2:571 / L1:480 反発3段", totalMaxLoss: "200000", n: "1", currentPrice: "595", useThreeEntries: true, p1Price: "611", e1Price: "574", p2Price: "571", e2Price: "532", e3Price: "501", l1Price: "480" },
    { name: "AAPL 押し目3段 ($220帯)", ticker: "AAPL", note: "サポートライン3箇所での分割エントリー", totalMaxLoss: "4000", n: "1", currentPrice: "228", useThreeEntries: true, p1Price: "235", e1Price: "222", p2Price: "220", e2Price: "212", e3Price: "204", l1Price: "196" },
    { name: "TSLA 反発2段 ($250帯)", ticker: "TSLA", note: "E1・E2の2段階エントリー計画", totalMaxLoss: "6000", n: "1", currentPrice: "262", useThreeEntries: false, p1Price: "275", e1Price: "250", p2Price: "247", e2Price: "232", e3Price: "218", l1Price: "215" }
  ];

  // ---------------------------------------------------------------- state
  function defaultState() {
    return {
      editingPlanId: 0,
      ticker: "NVDA",
      note: "反発3段階スケールイン計画",
      totalMaxLossText: "200000",
      nText: "1",
      currentPriceText: "595",
      useThreeEntries: true,
      p1PriceText: "611",
      e1PriceText: "574",
      p2PriceText: "571",
      e2PriceText: "532",
      e3PriceText: "501",
      l1PriceText: "480",
      p2MarginBias: 0.45,
      manualE1Shares: null,
      manualE2Shares: null,
      manualE3Shares: null,
      selectedChartScenario: "all",
      searchQuery: "",
      statusBannerMessage: null,
      isDarkTheme: true,
      tab: "calculator",
      input1Expanded: false
    };
  }

  const DRAFT_FIELDS = ["editingPlanId", "ticker", "note", "totalMaxLossText", "nText", "currentPriceText", "useThreeEntries",
    "p1PriceText", "e1PriceText", "p2PriceText", "e2PriceText", "e3PriceText", "l1PriceText", "p2MarginBias",
    "manualE1Shares", "manualE2Shares", "manualE3Shares"];

  const state = Object.assign(defaultState(), pick(store.get(KEY.draft, {}), DRAFT_FIELDS));
  state.isDarkTheme = store.get(KEY.theme, "dark") !== "light";
  let output = null;
  let plans = loadPlans();

  function pick(obj, fields) {
    const r = {};
    if (!obj || typeof obj !== "object") return r;
    fields.forEach((f) => { if (f in obj) r[f] = obj[f]; });
    return r;
  }

  function saveDraft() {
    store.set(KEY.draft, pick(state, DRAFT_FIELDS));
  }

  // ---------------------------------------------------------------- parsing
  /** 全角数字・全角ピリオドを半角に、カンマ等を除去。小数点は1つだけ残す。 */
  function sanitizeDecimal(input) {
    const half = String(input)
      .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[．。]/g, ".");
    const filtered = half.replace(/[^0-9.]/g, "");
    const parts = filtered.split(".");
    return parts.length <= 2 ? filtered : parts[0] + "." + parts.slice(1).join("");
  }

  function sanitizeInt(input) {
    return String(input)
      .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[^0-9]/g, "");
  }

  function toNum(text) {
    if (text == null || text === "" || text === ".") return null;
    const v = Number(text);
    return Number.isFinite(v) ? v : null;
  }

  function formatInputDouble(v) {
    return v % 1 === 0 ? String(Math.trunc(v)) : String(v);
  }

  function currentInput() {
    const s = state;
    return {
      ticker: s.ticker.trim() || "TICKER",
      totalMaxLoss: toNum(s.totalMaxLossText) ?? 0,
      n: parseInt(s.nText, 10) || 1,
      currentPrice: toNum(s.currentPriceText) ?? 0,
      useThreeEntries: s.useThreeEntries,
      p1Price: toNum(s.p1PriceText) ?? 0,
      e1Price: toNum(s.e1PriceText) ?? 0,
      p2Price: toNum(s.p2PriceText) ?? 0,
      e2Price: toNum(s.e2PriceText) ?? 0,
      e3Price: toNum(s.e3PriceText) ?? 0,
      l1Price: toNum(s.l1PriceText) ?? 0,
      p2MarginBias: s.p2MarginBias,
      manualE1Shares: s.manualE1Shares,
      manualE2Shares: s.manualE2Shares,
      manualE3Shares: s.manualE3Shares
    };
  }

  function recalculate() {
    output = E.calculate(currentInput());
  }

  // ---------------------------------------------------------------- plans
  function loadPlans() {
    const list = store.get(KEY.plans, []);
    return Array.isArray(list) ? list.filter((p) => p && typeof p === "object" && p.id) : [];
  }

  function persistPlans() {
    store.set(KEY.plans, plans);
  }

  function nextPlanId() {
    return plans.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  }

  function entityFrom(input, out, id, ticker, note, updatedAt) {
    return {
      id: id,
      ticker: ticker,
      note: note,
      totalMaxLoss: out.totalMaxLoss,
      n: out.n,
      tradeMaxLoss: out.tradeMaxLoss,
      currentPrice: input.currentPrice,
      useThreeEntries: input.useThreeEntries,
      p1Price: input.p1Price,
      e1Price: input.e1Price,
      p2Price: input.p2Price,
      e2Price: input.e2Price,
      e3Price: input.e3Price,
      l1Price: input.l1Price,
      p2MarginBias: input.p2MarginBias,
      e1Shares: out.e1Shares,
      e2Shares: out.e2Shares,
      e3Shares: out.e3Shares,
      finalAverageCost: out.finalAverageCost,
      allFilledProfitAtP1: out.allFilledProfitAtP1,
      allFilledProfitAtP2: out.allFilledProfitAtP2,
      allFilledLossAtL1: out.allFilledLossAtL1,
      updatedAt: updatedAt
    };
  }

  /** 初回アクセス時だけサンプル計画を投入（全件削除後に復活させない） */
  function seedInitialPlansOnce() {
    if (store.get(KEY.seeded, false)) return;
    if (plans.length === 0) {
      const now = Date.now();
      PRESETS.forEach((preset, i) => {
        const input = {
          ticker: preset.ticker,
          totalMaxLoss: Number(preset.totalMaxLoss),
          n: 1,
          currentPrice: Number(preset.currentPrice),
          useThreeEntries: preset.useThreeEntries,
          p1Price: Number(preset.p1Price),
          e1Price: Number(preset.e1Price),
          p2Price: Number(preset.p2Price),
          e2Price: Number(preset.e2Price),
          e3Price: Number(preset.e3Price),
          l1Price: Number(preset.l1Price),
          p2MarginBias: 0.45
        };
        const out = E.calculate(input);
        if (out.isValid) {
          plans.push(entityFrom(input, out, i + 1, preset.ticker, preset.note, now - i));
        }
      });
      persistPlans();
    }
    store.set(KEY.seeded, true);
  }

  // ---------------------------------------------------------------- actions
  function clearManual() {
    state.manualE1Shares = null;
    state.manualE2Shares = null;
    state.manualE3Shares = null;
  }

  function onPriceFieldChange(field, value, resetsManual) {
    state[field] = value;
    if (resetsManual) clearManual();
    state.statusBannerMessage = null;
    update();
  }

  function adjustShares(level, delta) {
    if (!output.isValid) return;
    const curE1 = state.manualE1Shares ?? output.e1Shares;
    const curE2 = state.manualE2Shares ?? output.e2Shares;
    const curE3 = state.manualE3Shares ?? output.e3Shares;
    state.manualE1Shares = level === 1 ? Math.max(0, curE1 + delta) : curE1;
    state.manualE2Shares = level === 2 ? Math.max(0, curE2 + delta) : curE2;
    state.manualE3Shares = level === 3 ? Math.max(0, curE3 + delta) : curE3;
    update();
  }

  function resetToOptimalShares() {
    clearManual();
    state.statusBannerMessage = "最適株数に再計算しました";
    update();
  }

  function loadSavedPlan(plan) {
    Object.assign(state, {
      editingPlanId: plan.id,
      ticker: plan.ticker,
      note: plan.note || "",
      totalMaxLossText: formatInputDouble(plan.totalMaxLoss),
      nText: String(plan.n || 1),
      currentPriceText: formatInputDouble(plan.currentPrice),
      useThreeEntries: !!plan.useThreeEntries,
      p1PriceText: formatInputDouble(plan.p1Price),
      e1PriceText: formatInputDouble(plan.e1Price),
      p2PriceText: formatInputDouble(plan.p2Price),
      e2PriceText: formatInputDouble(plan.e2Price),
      e3PriceText: formatInputDouble(plan.e3Price),
      l1PriceText: formatInputDouble(plan.l1Price),
      p2MarginBias: typeof plan.p2MarginBias === "number" ? plan.p2MarginBias : 0.45,
      manualE1Shares: plan.e1Shares,
      manualE2Shares: plan.e2Shares,
      manualE3Shares: plan.useThreeEntries ? plan.e3Shares : null,
      selectedChartScenario: "all",
      statusBannerMessage: `${plan.ticker} のトレード計画を読み込みました`
    });
    syncInputs();
    switchTab("calculator");
    update();
    window.scrollTo(0, 0);
  }

  function saveCurrentPlan() {
    if (!output.isValid) {
      state.statusBannerMessage = "入力価格にエラーがあるため保存できません";
      update();
      return;
    }
    const input = currentInput();
    const ticker = state.ticker.trim() || "UNTITLED";
    const existingIndex = plans.findIndex((p) => p.id === state.editingPlanId);
    const id = state.editingPlanId && existingIndex >= 0 ? state.editingPlanId : nextPlanId();
    const entity = entityFrom(input, output, id, ticker, state.note.trim(), Date.now());
    if (existingIndex >= 0) plans[existingIndex] = entity;
    else plans.push(entity);
    persistPlans();
    state.editingPlanId = id;
    state.statusBannerMessage = `「${ticker}」のトレード計画をこのブラウザに保存しました`;
    update();
  }

  function startNewPlanAsCopy() {
    state.editingPlanId = 0;
    state.statusBannerMessage = "新規トレード計画として複製モードに切り替えました";
    update();
  }

  function deleteSavedPlan(plan) {
    openModal({
      title: "計画を削除",
      text: `「${plan.ticker}」の計画を削除しますか？\nこの操作は取り消せません。`,
      actions: [
        { label: "キャンセル" },
        {
          label: "削除する",
          kind: "danger",
          onClick: () => {
            plans = plans.filter((p) => p.id !== plan.id);
            persistPlans();
            if (state.editingPlanId === plan.id) state.editingPlanId = 0;
            update();
          }
        }
      ]
    });
  }

  // ---------------------------------------------------------------- modal
  // window.confirm / ダウンロードが使えない環境（claude.ai の Artifact 枠内）でも動くよう、確認はページ内で行う。
  let modalReturnFocus = null;

  function openModal(opts) {
    const modal = $("modal");
    const area = $("modal-textarea");
    $("modal-title").textContent = opts.title;
    $("modal-text").textContent = opts.text || "";
    setModalFeedback("");
    area.hidden = !opts.textarea;
    if (opts.textarea) {
      area.value = opts.textarea.value || "";
      area.readOnly = !!opts.textarea.readOnly;
      area.placeholder = opts.textarea.placeholder || "";
    }
    const actions = $("modal-actions");
    actions.replaceChildren();
    opts.actions.forEach((a) => {
      const cls = a.kind === "primary" ? "primary-btn" : a.kind === "danger" ? "danger-btn" : "outline-btn";
      actions.append(el("button", {
        type: "button",
        class: cls,
        onclick: async () => {
          const keepOpen = a.onClick ? await a.onClick() : false;
          if (keepOpen !== true) closeModal();
        }
      }, [a.label]));
    });
    modalReturnFocus = document.activeElement;
    modal.hidden = false;
    (opts.textarea && !opts.textarea.readOnly ? area : actions.lastElementChild).focus();
  }

  function closeModal() {
    $("modal").hidden = true;
    if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus();
  }

  function setModalFeedback(text, isError) {
    const f = $("modal-feedback");
    f.textContent = text;
    f.classList.toggle("ng", !!isError);
  }

  // ---------------------------------------------------------------- backup
  function backupFilename() {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `smartposition-backup-${stamp}.json`;
  }

  function hasClaudeRuntime() {
    return typeof window.claude === "object" && window.claude !== null && typeof window.claude.use === "function";
  }

  async function saveBackupFile(json) {
    const filename = backupFilename();
    if (hasClaudeRuntime()) {
      // claude.ai 上では downloads capability 経由で保存（閲覧者の確認が入る）
      const downloads = await window.claude.use("downloads");
      if (!downloads) {
        setModalFeedback("この画面ではファイル保存が使えません。「コピー」でJSONをコピーして、メモ帳などに貼り付けて保存してください。", true);
        return;
      }
      try {
        await downloads.save({ filename: filename, data: json });
        setModalFeedback("保存しました");
      } catch (e) {
        setModalFeedback("保存がキャンセルされたか、失敗しました。「コピー」も使えます。", true);
      }
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setModalFeedback("ダウンロードを開始しました");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      setModalFeedback("コピーしました");
    } catch (e) {
      const area = $("modal-textarea");
      area.focus();
      area.select();
      setModalFeedback("自動コピーできませんでした。選択済みなので Ctrl+C でコピーしてください。", true);
    }
  }

  function exportPlans() {
    const json = JSON.stringify({ app: "SmartPosition", version: 1, exportedAt: new Date().toISOString(), plans: plans }, null, 2);
    openModal({
      title: "バックアップを書き出す",
      text: `保存済みの計画 ${plans.length}件を JSON にしました。\n保存しておくと、別のPCやブラウザで「バックアップを読み込む」から復元できます。`,
      textarea: { value: json, readOnly: true },
      actions: [
        { label: "閉じる" },
        { label: "コピー", onClick: async () => { await copyText(json); return true; } },
        { label: "ファイルに保存", kind: "primary", onClick: async () => { await saveBackupFile(json); return true; } }
      ]
    });
  }

  function openImportDialog() {
    openModal({
      title: "バックアップを読み込む",
      text: "書き出した JSON ファイルを選ぶか、JSON の中身を下に貼り付けてください。\n今ある計画は消えず、読み込んだ計画が追加されます。",
      textarea: { value: "", placeholder: "ここに JSON を貼り付け" },
      actions: [
        { label: "キャンセル" },
        { label: "ファイルを選ぶ", onClick: () => { $("import-file").click(); return true; } },
        { label: "貼り付けた内容を読み込む", kind: "primary", onClick: () => !importText($("modal-textarea").value) }
      ]
    });
  }

  const NUMERIC_FIELDS = ["totalMaxLoss", "tradeMaxLoss", "currentPrice", "p1Price", "e1Price", "p2Price", "e2Price", "e3Price", "l1Price",
    "finalAverageCost", "allFilledProfitAtP1", "allFilledProfitAtP2", "allFilledLossAtL1"];

  /** 読み込めたら true。失敗時はダイアログ内にエラーを表示して false。 */
  function importText(text) {
    let incoming;
    try {
      const data = JSON.parse(text);
      incoming = Array.isArray(data) ? data : data.plans;
      if (!Array.isArray(incoming)) throw new Error("plans がありません");
    } catch (e) {
      setModalFeedback("読み込めませんでした（SmartPosition のバックアップ JSON ではありません）", true);
      return false;
    }
    let added = 0;
    incoming.forEach((p) => {
      if (!p || typeof p.ticker !== "string" || !NUMERIC_FIELDS.every((f) => typeof p[f] === "number" && Number.isFinite(p[f]))) return;
      plans.push(Object.assign({}, p, {
        id: nextPlanId(),
        ticker: p.ticker.slice(0, 20),
        note: String(p.note || "").slice(0, 500),
        n: Number(p.n) || 1,
        useThreeEntries: !!p.useThreeEntries,
        p2MarginBias: typeof p.p2MarginBias === "number" ? p.p2MarginBias : 0.45,
        e1Shares: Number(p.e1Shares) || 0,
        e2Shares: Number(p.e2Shares) || 0,
        e3Shares: Number(p.e3Shares) || 0,
        updatedAt: Number(p.updatedAt) || Date.now()
      }));
      added++;
    });
    persistPlans();
    showBanner(`${added}件の計画を読み込みました`);
    return true;
  }

  // ---------------------------------------------------------------- UI helpers
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== false && attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach((c) => { if (c != null) node.append(c); });
    return node;
  }

  function showBanner(msg) {
    state.statusBannerMessage = msg;
    update();
  }

  function switchTab(tab) {
    state.tab = tab;
    update();
  }

  const INPUT_BINDINGS = [
    ["in-total", "totalMaxLossText", sanitizeDecimal, true],
    ["in-n", "nText", sanitizeInt, true],
    ["in-current", "currentPriceText", sanitizeDecimal, false],
    ["in-p1", "p1PriceText", sanitizeDecimal, true],
    ["in-e1", "e1PriceText", sanitizeDecimal, true],
    ["in-p2", "p2PriceText", sanitizeDecimal, true],
    ["in-e2", "e2PriceText", sanitizeDecimal, true],
    ["in-e3", "e3PriceText", sanitizeDecimal, true],
    ["in-l1", "l1PriceText", sanitizeDecimal, true]
  ];

  function syncInputs() {
    INPUT_BINDINGS.forEach(([id, field]) => { $(id).value = state[field]; });
    $("in-ticker").value = state.ticker;
    $("in-note").value = state.note;
    $("in-three").checked = state.useThreeEntries;
    $("bias-slider").value = String(state.p2MarginBias);
  }

  // ---------------------------------------------------------------- render
  function render() {
    const out = output;
    const s = state;
    const three = s.useThreeEntries;
    const input = currentInput();

    // theme
    document.documentElement.dataset.theme = s.isDarkTheme ? "dark" : "light";
    $("theme-toggle").textContent = s.isDarkTheme ? "☀ 白" : "🌙 黒";

    // banner
    $("status-banner").hidden = !s.statusBannerMessage;
    $("status-text").textContent = s.statusBannerMessage || "";

    // tabs
    const calc = s.tab === "calculator";
    $("tab-calculator").hidden = !calc;
    $("tab-saved").hidden = calc;
    $("nav-calculator").setAttribute("aria-selected", String(calc));
    $("nav-saved").setAttribute("aria-selected", String(!calc));
    $("saved-count").textContent = String(plans.length);
    $("slider-dock").hidden = !(calc && out.isValid);

    // INPUT 1
    $("trade-max-loss-value").textContent = E.formatCurrency(out.tradeMaxLoss);
    $("actual-l1-loss-value").textContent = "-" + E.formatCurrency(out.allFilledLossAtL1);
    const isOver = out.allFilledLossAtL1 > out.tradeMaxLoss + 1e-6;
    const progress = out.tradeMaxLoss > 0 ? Math.min(out.allFilledLossAtL1 / out.tradeMaxLoss, 1) : 0;
    $("loss-progress").classList.toggle("over", isOver);
    $("loss-progress").firstElementChild.style.width = (progress * 100).toFixed(1) + "%";
    $("loss-progress").title = `許容損失枠の消化率 ${out.riskBudgetUtilizationPercent.toFixed(1)}%`;
    const status = $("loss-status");
    status.className = "status-line " + (isOver ? "ng" : "ok");
    status.textContent = isOver ? "⚠ 許容損失枠を超過しています" : "✓ L1損切り時も許容損失額以内に収まっています";
    $("input1-summary").textContent = `総額の損失許容額とn (${E.formatCurrency(out.totalMaxLoss)}, n=${out.n})`;
    $("input1-toggle-label").textContent = s.input1Expanded ? "▲ 閉じる" : "▼ 変更";
    $("input1-toggle").setAttribute("aria-expanded", String(s.input1Expanded));
    $("input1-body").hidden = !s.input1Expanded;
    $("divisor-hint").textContent = `除数 (3n+n) = ${out.divisor} (本トレード = 総額 ÷ ${out.divisor})`;
    $("n-minus").disabled = (parseInt(s.nText, 10) || 1) <= 1;

    // INPUT 2
    $("mode-label").textContent = three ? "反発ライン数: 3段階 (E1・E2・E3)" : "反発ライン数: 2段階 (E1・E2)";
    $("l1-sub").textContent = three ? "E3より下" : "E2より下";
    $("entry-section-label").textContent = `買いエントリー反発ライン (E1・E2${three ? "・E3" : ""})`;
    $("e3-row").hidden = !three;
    renderMessages(out);

    // Allocation
    $("alloc-heading").textContent = `分割購入株数 (E1・E2${three ? "・E3" : ""}) と平均単価`;
    $("manual-badge").hidden = !out.isManualOverride;
    $("reset-optimal").hidden = !out.isManualOverride;
    renderShares(out, input);
    renderPatterns(out, input);
    $("save-plan").textContent = s.editingPlanId ? "この銘柄の計画を上書き保存" : "この銘柄の計画を保存";
    $("duplicate-plan").hidden = !s.editingPlanId;

    // Slider dock
    $("ratio-value").textContent = `N2/N1: ${out.actualN2ToN1Ratio.toFixed(2)}x`;
    $("min-ratio-label").textContent = `◀ E1確保 (最低比率 ${out.minN2ToN1RatioForP2.toFixed(2)}x)`;
    if (document.activeElement !== $("bias-slider")) $("bias-slider").value = String(s.p2MarginBias);

    // Chart
    $("chart-heading").textContent = `${s.ticker.trim() || "TICKER"} エントリー玉数・決済ライン軌道図`;
    $("chart-mode-chip").textContent = three ? "3段 (E1-E3) + L1" : "2段 (E1-E2) + L1";
    renderScenarioChips(out);
    $("chart-wrap").hidden = !out.isValid;
    $("chart-legend").hidden = !out.isValid;
    $("chart-empty").hidden = out.isValid;
    if (out.isValid && calc) scheduleChart();

    // Saved plans
    if (!calc) renderSavedPlans();
  }

  function renderMessages(out) {
    const vbox = $("validation-box");
    vbox.replaceChildren();
    if (!out.isValid) {
      vbox.append(el("div", { class: "msg-title", text: "⛔ 価格ラインの順序エラー" }),
        el("ul", null, out.validationErrors.map((m) => el("li", { text: m }))));
    }
    vbox.hidden = out.isValid;

    const wbox = $("warning-box");
    wbox.replaceChildren();
    if (out.warnings.length) {
      wbox.append(el("div", { class: "msg-title", text: "⚠ 注意" }),
        el("ul", null, out.warnings.map((m) => el("li", { text: m }))));
    }
    wbox.hidden = out.warnings.length === 0;
  }

  function renderShares(out, input) {
    const list = $("share-list");
    list.replaceChildren();
    const rows = [
      { level: 1, badge: "E1", name: "第1反発買い", price: input.e1Price, shares: out.e1Shares, loss: out.e1LossPerShare, avg: out.stage1 ? out.stage1.averageCost : input.e1Price, check: false },
      { level: 2, badge: "E2", name: "第2反発買い", price: input.e2Price, shares: out.e2Shares, loss: out.e2LossPerShare, avg: out.stage2 ? out.stage2.averageCost : input.e2Price, check: true }
    ];
    if (input.useThreeEntries) {
      rows.push({ level: 3, badge: "E3", name: "第3反発買い", price: input.e3Price, shares: out.e3Shares, loss: out.e3LossPerShare, avg: out.stage3 ? out.stage3.averageCost : input.e3Price, check: true });
    }
    rows.forEach((r) => {
      const minus = el("button", { type: "button", class: "round-btn", "aria-label": `${r.badge} 株数を減らす`, onclick: () => adjustShares(r.level, -1) }, ["−"]);
      const plus = el("button", { type: "button", class: "round-btn", "aria-label": `${r.badge} 株数を増やす`, onclick: () => adjustShares(r.level, 1) }, ["+"]);
      minus.disabled = !out.isValid || r.shares <= 0;
      plus.disabled = !out.isValid;
      const card = el("div", { class: "share-card" }, [
        el("div", { class: "share-top" }, [
          el("div", { class: "share-info" }, [
            el("div", { class: "share-title" }, [el("span", { class: "level-pill", text: r.badge }), `${r.name} @ ${E.formatNumber(r.price)}`]),
            el("div", { class: "share-sub mono", text: `1株リスク: -${E.formatNumber(r.loss)} / 投資: ${E.formatCurrency(r.price * r.shares)}` })
          ]),
          el("div", { class: "share-stepper" }, [
            minus,
            el("span", { class: "share-value mono", text: String(r.shares) }),
            el("span", { class: "share-unit", text: "株" }),
            plus
          ])
        ])
      ]);
      if (r.check) {
        const ok = r.avg <= input.p2Price + 1e-9 && r.shares > 0;
        card.append(el("div", { class: "avg-row" + (ok ? "" : " ng") }, [
          el("span", { class: "avg mono", text: `${ok ? "✔" : "⚠"} 平均取得単価: ${E.formatNumber(r.avg)}` }),
          el("span", { class: "judge", text: ok ? `≤ P2(${E.formatNumber(input.p2Price)}) 利確可` : `> P2(${E.formatNumber(input.p2Price)}) 利確不可` })
        ]));
      }
      list.append(card);
    });
  }

  function exitCell(label, price, value, note, isLossCell) {
    const amount = isLossCell ? "-" + E.formatCurrency(value) : E.formatSigned(value);
    const negative = isLossCell || value < 0;
    return el("div", { class: "exit-cell" + (negative ? " loss" : "") }, [
      el("div", { class: "exit-top" }, [el("b", { text: label }), el("span", { class: "mono", text: "@" + E.formatNumber(price) })]),
      el("div", { class: "exit-amt mono", text: amount }),
      note ? el("div", { class: "exit-note", text: note }) : null
    ]);
  }

  function stageMeta(st) {
    return `累計 ${st.cumulativeShares}株 (平均 ${E.formatNumber(st.averageCost)}) | 投資 ¥${E.formatCurrency(st.cumulativeInvestment)}`;
  }

  function renderPatterns(out, input) {
    const box = $("pattern-rows");
    box.replaceChildren();
    if (!out.isValid || !out.stage1) return;
    const three = input.useThreeEntries;
    const final = out.stage3 || out.stage2;

    box.append(
      el("div", { class: "pattern-row" }, [
        el("div", { class: "pattern-title", text: "E1 → P1" }),
        el("div", { class: "pattern-meta mono", text: stageMeta(out.stage1) }),
        el("div", { class: "exit-cells" }, [exitCell("P1 利確", input.p1Price, out.stage1.profitAtP1, "第1反発で全利確（※下落時はE2約定へ移行）")])
      ]),
      el("div", { class: "pattern-row" }, [
        el("div", { class: "pattern-title", text: "E1+E2 → P1 または P2" }),
        el("div", { class: "pattern-meta mono", text: stageMeta(out.stage2) }),
        el("div", { class: "exit-cells" }, [
          exitCell("P2 利確", input.p2Price, out.stage2.profitAtP2, "安全ターゲット (Avg≤P2)"),
          exitCell("P1 利確", input.p1Price, out.stage2.profitAtP1, "全利確ストレッチ")
        ])
      ]),
      el("div", { class: "pattern-row" }, [
        el("div", { class: "pattern-title", text: three ? "E1+E2+E3 → P1 または P2 または L1" : "E1+E2 (全約定) → P1 または P2 または L1" }),
        el("div", { class: "pattern-meta mono", text: stageMeta(final) }),
        el("div", { class: "exit-cells" }, [
          exitCell("P2 利確", input.p2Price, final.profitAtP2, "第3反発利確"),
          exitCell("P1 利確", input.p1Price, final.profitAtP1, "全利確"),
          exitCell("L1 損切", input.l1Price, final.lossAtL1, "許容内", true)
        ])
      ])
    );
  }

  function scenarioList(out, three) {
    const s1 = out.stage1 ? out.stage1.profitAtP1 : 0;
    const s2p2 = out.stage2 ? out.stage2.profitAtP2 : 0;
    const s2p1 = out.stage2 ? out.stage2.profitAtP1 : 0;
    const s3p2 = out.stage3 ? out.stage3.profitAtP2 : out.allFilledProfitAtP2;
    const s3p1 = out.stage3 ? out.stage3.profitAtP1 : out.allFilledProfitAtP1;
    const s3l1 = out.stage3 ? out.stage3.lossAtL1 : out.allFilledLossAtL1;
    const list = [
      ["all", "全6パターン表示"],
      ["e1p1", `① E1→P1 (${E.formatSigned(s1)})`],
      ["e12p2", `② E1+2→P2 (${E.formatSigned(s2p2)})`],
      ["e12p1", `③ E1+2→P1 (${E.formatSigned(s2p1)})`]
    ];
    if (three) {
      list.push(["allp2", `④ 全約定→P2 (${E.formatSigned(s3p2)})`], ["allp1", `⑤ 全約定→P1 (${E.formatSigned(s3p1)})`], ["l1", `⑥ 全損切→L1 (-${E.formatCurrency(s3l1)})`]);
    } else {
      list.push(["l1", `④ 全損切→L1 (-${E.formatCurrency(s3l1)})`]);
    }
    return list;
  }

  function renderScenarioChips(out) {
    const box = $("scenario-chips");
    box.replaceChildren();
    const three = state.useThreeEntries;
    const list = scenarioList(out, three);
    if (!list.some(([k]) => k === state.selectedChartScenario)) state.selectedChartScenario = "all";
    list.forEach(([key, label]) => {
      const accent = key === "all" ? "var(--primary)" : key === "l1" ? "var(--error)" : "var(--secondary)";
      const chip = el("button", {
        type: "button",
        class: "scenario-chip mono",
        "aria-pressed": String(state.selectedChartScenario === key),
        onclick: () => { state.selectedChartScenario = key; update(); }
      }, [label]);
      chip.style.setProperty("--chip-accent", accent);
      box.append(chip);
    });
  }

  // 平均単価ラインのアニメーション（Android版の spring アニメーション相当）
  const anim = { avg12: null, avg123: null, from12: 0, from123: 0, to12: 0, to123: 0, start: 0, raf: 0 };

  function scheduleChart() {
    const out = output;
    const input = currentInput();
    const target12 = out.stage2 ? out.stage2.averageCost : input.e2Price;
    const target123 = out.stage3 ? out.stage3.averageCost : target12;
    if (anim.avg12 == null) {
      anim.avg12 = target12;
      anim.avg123 = target123;
    }
    anim.from12 = anim.avg12;
    anim.from123 = anim.avg123;
    anim.to12 = target12;
    anim.to123 = target123;
    anim.start = performance.now();
    cancelAnimationFrame(anim.raf);
    const duration = 280;
    const step = (now) => {
      const t = Math.min((now - anim.start) / duration, 1);
      const k = 1 - Math.pow(1 - t, 3);
      anim.avg12 = anim.from12 + (anim.to12 - anim.from12) * k;
      anim.avg123 = anim.from123 + (anim.to123 - anim.from123) * k;
      drawChart();
      if (t < 1) anim.raf = requestAnimationFrame(step);
    };
    anim.raf = requestAnimationFrame(step);
  }

  function drawChart() {
    if (!output || !output.isValid || state.tab !== "calculator") return;
    const input = currentInput();
    window.SPChart.draw($("chart-canvas"), {
      currentPrice: input.currentPrice,
      useThreeEntries: input.useThreeEntries,
      p1: input.p1Price, e1: input.e1Price, p2: input.p2Price,
      e2: input.e2Price, e3: input.e3Price, l1: input.l1Price,
      output: output,
      scenario: state.selectedChartScenario,
      avg12: anim.avg12,
      avg123: anim.avg123
    });
  }

  function formatDate(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function renderSavedPlans() {
    const q = state.searchQuery.trim().toLowerCase();
    const sorted = plans.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const filtered = q ? sorted.filter((p) => p.ticker.toLowerCase().includes(q) || (p.note || "").toLowerCase().includes(q)) : sorted;
    const grid = $("plan-grid");
    grid.replaceChildren();
    $("plans-empty").hidden = plans.length !== 0;

    if (plans.length && filtered.length === 0) {
      grid.append(el("p", { class: "hint", text: `「${state.searchQuery}」に一致する計画はありません` }));
    }

    filtered.forEach((plan) => {
      const total = plan.e1Shares + plan.e2Shares + (plan.useThreeEntries ? plan.e3Shares : 0);
      const shareBadges = [
        el("span", { class: "plan-share mono" }, ["E1 @" + E.formatNumber(plan.e1Price) + " ", el("b", { text: plan.e1Shares + "株" })]),
        el("span", { class: "plan-share mono" }, ["E2 @" + E.formatNumber(plan.e2Price) + " ", el("b", { text: plan.e2Shares + "株" })])
      ];
      if (plan.useThreeEntries) {
        shareBadges.push(el("span", { class: "plan-share mono" }, ["E3 @" + E.formatNumber(plan.e3Price) + " ", el("b", { text: plan.e3Shares + "株" })]));
      }
      grid.append(el("article", { class: "card plan-card" }, [
        el("div", { class: "plan-head" }, [
          el("div", null, [
            el("div", { class: "plan-ticker mono", text: plan.ticker }),
            el("div", { class: "plan-note", text: plan.note || "反発分割エントリー計画" }),
            el("div", { class: "plan-sub mono", text: `現在値 ${E.formatNumber(plan.currentPrice)} / 本トレード許容損失 ${E.formatCurrency(plan.tradeMaxLoss)}` })
          ]),
          el("button", { type: "button", class: "icon-btn", "aria-label": `${plan.ticker} を削除`, title: "削除", onclick: () => deleteSavedPlan(plan) }, ["🗑"])
        ]),
        el("div", { class: "plan-shares" }, shareBadges),
        el("div", { class: "plan-stats" }, [
          el("span", { text: `平均単価 (計${total}株)` }),
          el("span", { class: "v avg mono", text: `${E.formatNumber(plan.finalAverageCost)} (P2:${E.formatNumber(plan.p2Price)})` }),
          el("span", { text: "P1 / P2 全決済利確" }),
          el("span", { class: "v profit mono", text: `${E.formatSigned(plan.allFilledProfitAtP1)} / ${E.formatSigned(plan.allFilledProfitAtP2)}` }),
          el("span", { text: `L1 (${E.formatNumber(plan.l1Price)}) 損切` }),
          el("span", { class: "v loss mono", text: "-" + E.formatCurrency(plan.allFilledLossAtL1) })
        ]),
        el("div", { class: "plan-foot" }, [
          el("span", { class: "plan-sub", text: "更新: " + formatDate(plan.updatedAt) }),
          el("button", { type: "button", class: "text-btn", onclick: () => loadSavedPlan(plan) }, ["計算画面に展開 →"])
        ])
      ]));
    });
  }

  function update() {
    recalculate();
    render();
    saveDraft();
  }

  // ---------------------------------------------------------------- wiring
  function bind() {
    INPUT_BINDINGS.forEach(([id, field, sanitize, resetsManual]) => {
      const input = $(id);
      input.addEventListener("input", () => {
        const clean = sanitize(input.value);
        if (clean !== input.value) input.value = clean;
        onPriceFieldChange(field, clean, resetsManual);
      });
    });
    $("in-ticker").addEventListener("input", (e) => {
      state.ticker = e.target.value.toUpperCase();
      state.statusBannerMessage = null;
      update();
    });
    $("in-note").addEventListener("input", (e) => {
      state.note = e.target.value;
      state.statusBannerMessage = null;
      update();
    });
    $("in-three").addEventListener("change", (e) => {
      state.useThreeEntries = e.target.checked;
      clearManual();
      state.statusBannerMessage = null;
      update();
    });
    $("n-plus").addEventListener("click", () => {
      state.nText = String((parseInt(state.nText, 10) || 1) + 1);
      $("in-n").value = state.nText;
      clearManual();
      update();
    });
    $("n-minus").addEventListener("click", () => {
      const cur = parseInt(state.nText, 10) || 1;
      if (cur > 1) {
        state.nText = String(cur - 1);
        $("in-n").value = state.nText;
        clearManual();
        update();
      }
    });
    $("input1-toggle").addEventListener("click", () => {
      state.input1Expanded = !state.input1Expanded;
      render();
    });
    $("bias-slider").addEventListener("input", (e) => {
      state.p2MarginBias = Math.min(Math.max(Number(e.target.value), 0), 1);
      clearManual();
      state.statusBannerMessage = null;
      update();
    });
    $("reset-optimal").addEventListener("click", resetToOptimalShares);
    $("save-plan").addEventListener("click", saveCurrentPlan);
    $("duplicate-plan").addEventListener("click", startNewPlanAsCopy);
    $("theme-toggle").addEventListener("click", () => {
      state.isDarkTheme = !state.isDarkTheme;
      store.set(KEY.theme, state.isDarkTheme ? "dark" : "light");
      render();
    });
    $("status-close").addEventListener("click", () => {
      state.statusBannerMessage = null;
      render();
    });
    $("nav-calculator").addEventListener("click", () => switchTab("calculator"));
    $("nav-saved").addEventListener("click", () => switchTab("saved"));
    $("saved-search").addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderSavedPlans();
    });
    $("export-plans").addEventListener("click", exportPlans);
    $("import-plans").addEventListener("click", openImportDialog);
    $("import-file").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (importText(String(reader.result))) closeModal();
      };
      reader.readAsText(file);
    });
    $("modal").addEventListener("click", (e) => {
      if (e.target === $("modal")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("modal").hidden) closeModal();
      else if (state.tab !== "calculator") switchTab("calculator");
    });
    new ResizeObserver(() => drawChart()).observe($("chart-wrap"));
  }

  seedInitialPlansOnce();
  syncInputs();
  bind();
  update();
})();
