/* ============ تحصيل: app.js — خط سير تفاعلي، تقييم المحصلين، سداد فوري، ومزامنة ردود الواتساب ============ */
"use strict";

const DATA_URL = "data/data.json";
const POLL_MS = 30000;
const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const fmt = (n) => (n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const money = (n) => fmt(n) + " ج.م";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() {
  const d = new Date();
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}
function dueLabel(due) {
  if (!due) return "—";
  const parts = String(due).split("-");
  if (parts.length === 3) {
    return `${Number(parts[2])}/${Number(parts[1])}/${parts[0]}`;
  }
  return due;
}

/* ---------- سداد يدوي (يخزن محلياً على الجهاز) ---------- */
const LS_PAYS = "tahsil_manual_pays";
function loadManualPays() {
  try { return JSON.parse(localStorage.getItem(LS_PAYS)) || []; } catch (e) { return []; }
}
function saveManualPays() {
  try { localStorage.setItem(LS_PAYS, JSON.stringify(state.manualPays)); } catch (e) {}
}
function manualToday(collector) {
  const t = todayISO();
  return state.manualPays.filter((p) => p.date === t && (!collector || p.collector === collector));
}
function addManualPay(customer, amount, collector) {
  const numAmt = Number(amount) || 0;
  if (numAmt <= 0) return null;
  const p = {
    id: Date.now() + Math.random(),
    customer,
    amount: numAmt,
    collector: collector || "عام",
    date: todayISO(),
    time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
  };
  state.manualPays.push(p);
  saveManualPays();

  // تحديث في خط السير التفاعلي إن وُجد العميل
  if (state.interactiveRoute) {
    const item = state.interactiveRoute.find((x) => x.customer === customer);
    if (item) {
      item.paid = (Number(item.paid) || 0) + numAmt;
      if (item.paid >= item.balance && item.balance > 0) {
        item.status = "خالص";
      } else if (item.paid > 0) {
        item.status = "سداد جزئي";
      }
      if (item.comm === "لم يتم التواصل" || item.comm === "لم يذهب إليه المحصل") {
        item.comm = "عميل مستجيب";
      }
      item.notVisited = false;
      saveInteractiveRoute();
    }
  }

  alertSound("pay");
  return p;
}

/* ---------- إدارة خط السير التفاعلي (Interactive Daily Route) ---------- */
const LS_ROUTE_PREFIX = "tahsil_interactive_route_";

function getRouteStorageKey() {
  return LS_ROUTE_PREFIX + todayISO();
}

function loadInteractiveRoute() {
  try {
    const saved = localStorage.getItem(getRouteStorageKey());
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
}

function saveInteractiveRoute() {
  try {
    localStorage.setItem(getRouteStorageKey(), JSON.stringify(state.interactiveRoute || []));
  } catch (e) {}
}

function initInteractiveRouteIfNeeded() {
  if (!state.data) return;
  const existing = loadInteractiveRoute();
  if (existing && Array.isArray(existing) && existing.length > 0) {
    state.interactiveRoute = existing;
    return;
  }

  // إنشاء خط السير التفاعلي الأولي بناءً على أهداف اليوم والشيتات
  const d = state.data;
  const targets = d.daily_targets || [];
  const routeLines = d.route_line || [];
  const ratingMap = new Map(routeLines.map((r) => [r.customer, r]));
  const masterMap = new Map((d.master || []).map((m) => [m.name, m]));

  const routeList = [];
  const addedNames = new Set();

  // 1. إضافة أهداف اليوم من Master_Data
  targets.forEach((t) => {
    if (addedNames.has(t.customer)) return;
    addedNames.add(t.customer);
    const rl = ratingMap.get(t.customer);
    const mm = masterMap.get(t.customer);
    const rep = t.collector || (mm ? mm.collector : "") || "مصطفى";
    const lastResp = rl ? rl.last_response : (t.notes || (mm ? mm.notes : ""));
    const bal = Number(t.balance) || (mm ? Number(mm.balance) : 0) || 0;

    routeList.push({
      customer: t.customer,
      collector: rep,
      area: t.area || (mm ? mm.area : "—") || "—",
      balance: bal,
      paid: 0,
      status: "لم يسدد",
      comm: "لم يتم التواصل",
      response: lastResp || "",
      notVisited: false,
      last_payment: t.last_payment || (mm ? mm.last_payment : ""),
      last_visit: t.last_visit || (mm ? mm.last_visit : ""),
      due: t.due || (mm ? mm.due_date : ""),
      rating: rl ? rl.rating : "",
      updatedAt: "",
    });
  });

  // 2. دمج أي عملاء إضافيين من شيتات المحصلين اليومية إن وُجدوا
  const routeSheets = d.route_sheets || {};
  Object.entries(routeSheets).forEach(([repName, sheet]) => {
    const clients = (sheet.today || []).concat(sheet.overdue || []);
    clients.forEach((c) => {
      if (addedNames.has(c.customer)) return;
      addedNames.add(c.customer);
      const rl = ratingMap.get(c.customer);
      const mm = masterMap.get(c.customer);
      const bal = Number(c.balance) || (mm ? Number(mm.balance) : 0) || 0;
      routeList.push({
        customer: c.customer,
        collector: repName,
        area: mm ? mm.area : "—",
        balance: bal,
        paid: 0,
        status: "لم يسدد",
        comm: "لم يتم التواصل",
        response: rl ? rl.last_response : (mm ? mm.notes : ""),
        notVisited: false,
        last_payment: c.last_payment || (mm ? mm.last_payment : ""),
        last_visit: mm ? mm.last_visit : "",
        due: mm ? mm.due_date : "",
        rating: rl ? rl.rating : "",
        updatedAt: "",
      });
    });
  });

  // مزامنة السدادات المسجلة اليوم بالفعل
  const todayPays = manualToday();
  todayPays.forEach((p) => {
    const item = routeList.find((x) => x.customer === p.customer);
    if (item) {
      item.paid += p.amount;
      if (item.paid >= item.balance && item.balance > 0) item.status = "خالص";
      else if (item.paid > 0) item.status = "سداد جزئي";
      item.comm = "عميل مستجيب";
      item.notVisited = false;
    }
  });

  state.interactiveRoute = routeList;
  saveInteractiveRoute();
}

function calculateRouteStats(clients) {
  const list = clients || state.interactiveRoute || [];
  const totalDue = list.reduce((s, c) => s + (Number(c.balance) || 0), 0);
  const collected = list.reduce((s, c) => s + (Number(c.paid) || 0), 0);
  const remaining = Math.max(0, totalDue - collected);
  const collectionRate = totalDue > 0 ? (collected / totalDue) * 100 : 0;

  const contactedCount = list.filter((c) => c.comm === "تم التواصل" || c.comm === "عميل مستجيب" || c.comm === "عميل غير مستجيب").length;
  const responsiveCount = list.filter((c) => c.comm === "عميل مستجيب").length;
  const unresponsiveCount = list.filter((c) => c.comm === "عميل غير مستجيب").length;
  const notVisitedCount = list.filter((c) => c.notVisited || c.comm === "لم يذهب إليه المحصل").length;
  const notContactedCount = list.filter((c) => c.comm === "لم يتم التواصل" || c.comm === "لم يذهب إليه المحصل" || c.notVisited).length;
  const responseRate = contactedCount > 0 ? (responsiveCount / contactedCount) * 100 : (list.length > 0 ? (responsiveCount / list.length) * 100 : 0);

  return {
    totalDue,
    collected,
    remaining,
    collectionRate,
    contactedCount,
    responsiveCount,
    unresponsiveCount,
    notVisitedCount,
    notContactedCount,
    responseRate,
    totalCount: list.length,
  };
}

/* ---------- State Definition ---------- */
const state = {
  data: null,
  view: "dashboard",
  paySeen: new Set(),
  invSeen: new Set(),
  soundOn: true,
  bellBusy: false,
  sort: {},
  filters: {
    routeRep: "all",
    routeStatus: "all",
    routeSearch: "",
  },
  manualPays: loadManualPays(),
  interactiveRoute: null,
  activeEditingCustomer: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Sorting ---------- */
const RATE_ORDER = { "خطر 🔴 (متوقف/راكد)": 0, "سيء ⚫ (بطيء جداً)": 1, "جيد 🟡 (منتظم)": 2, "ممتاز 🟢 (سريع الدوران)": 3 };
function sortTh(key, col, type, label, cls) {
  const s = state.sort[key] || null;
  const on = s && s.col === col;
  const arrow = on ? (s.dir === 1 ? "▲" : "▼") : "⇅";
  return `<th class="${(cls || "")} ${on ? "sorted" : ""}" data-sortable="${key}" data-k="${col}" data-t="${type}" title="اضغط للترتيب">${label}<span class="th-arrow">${arrow}</span></th>`;
}
function sortArray(rows, key, get) {
  const s = state.sort[key];
  if (!s) return rows;
  const { col, dir, type } = s;
  const r = rows.slice();
  const v = (x) => (get ? get(x, col) : x[col]);
  r.sort((a, b) => {
    let av = v(a), bv = v(b);
    if (type === "num") { av = Number(av) || 0; bv = Number(bv) || 0; return (av - bv) * dir; }
    if (type === "rate") { av = RATE_ORDER[av] ?? 9; bv = RATE_ORDER[bv] ?? 9; return (av - bv) * dir; }
    av = String(av ?? ""); bv = String(bv ?? "");
    return av.localeCompare(bv, "ar") * dir;
  });
  return r;
}
function clearSortBtn(key) {
  return `<button class="clear-sort" data-clear-sort="${key}" title="الرجوع لترتيب الشيت الأصلي">↺ ترتيب الشيت</button>`;
}

function viewFn(name) {
  return { dashboard: viewDashboard, route: viewRoute, collectors: viewCollectors, cashflow: viewCashflow, cycle: viewCycle }[name];
}

function onTableClick(e) {
  const th = e.target.closest("th[data-sortable]");
  if (th) {
    const key = th.dataset.sortable;
    const col = th.dataset.k;
    const cur = state.sort[key];
    if (cur && cur.col === col) state.sort[key] = cur.dir === 1 ? { col, dir: -1, type: th.dataset.t } : null;
    else state.sort[key] = { col, dir: 1, type: th.dataset.t };
    viewFn(state.view)();
    return;
  }
  const clr = e.target.closest("[data-clear-sort]");
  if (clr) {
    state.sort[clr.dataset.clearSort] = null;
    viewFn(state.view)();
  }
}

/* ---------- Data Syncing ---------- */
async function fetchData(quiet) {
  try {
    const r = await fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const json = await r.json();
    const changed = state.data ? detectChanges(json) : false;
    state.data = json;
    initInteractiveRouteIfNeeded();
    setSync(true);
    render();
    if (changed) render();
    return json;
  } catch (e) {
    setSync(false);
    if (!quiet) toast("عرض بيانات محلي", "تعذر الاتصال — يتم العرض من آخر نسخة محفوظة", "warn");
    return null;
  }
}

function setSync(ok) {
  $("syncDot").className = "dot " + (ok ? "ok" : "err");
  $("syncText").textContent = ok ? "متصل — تحديث تلقائي كل 30 ثانية" : "تعذر الاتصال بالبيانات";
  $("lastUpdate").textContent = ok && state.data ? "آخر تحديث: " + state.data.meta.generated_at : "—";
}

/* ---------- Alerts & Notifications ---------- */
function detectChanges(json) {
  const alerts = [];
  const pay = json.payments || [];
  const inv = json.invoices || [];
  const oldPay = state.data.payments || [];
  const oldInv = state.data.invoices || [];
  const oldPayKeys = new Set(oldPay.map((p) => p.customer + "|" + p.date + "|" + p.amount));
  const oldInvKeys = new Set(oldInv.map((p) => p.num + "|" + p.amount));
  const newPays = pay.filter((p) => !oldPayKeys.has(p.customer + "|" + p.date + "|" + p.amount));
  const newInvs = inv.filter((p) => !oldInvKeys.has(p.num + "|" + p.amount));

  if (!state.payInit) {
    state.payInit = true;
    pay.forEach((p) => state.paySeen.add(p.customer + "|" + p.date + "|" + p.amount));
    inv.forEach((p) => state.invSeen.add(p.num + "|" + p.amount));
    return true;
  }
  const freshPays = newPays.filter((p) => {
    const k = p.customer + "|" + p.date + "|" + p.amount;
    if (state.paySeen.has(k)) return false;
    state.paySeen.add(k);
    return true;
  });
  const freshInvs = newInvs.filter((p) => {
    const k = p.num + "|" + p.amount;
    if (state.invSeen.has(k)) return false;
    state.invSeen.add(k);
    return true;
  });
  if (freshPays.length) {
    const total = freshPays.reduce((s, p) => s + p.amount, 0);
    const names = freshPays.slice(0, 3).map((p) => p.customer).join("، ");
    alerts.push({ type: "pay", title: `💸 سداد جديد — ${money(total)}`, body: `${names}${freshPays.length > 3 ? " وآخرون" : ""}`, pays: freshPays });
  }
  if (freshInvs.length) {
    alerts.push({ type: "inv", title: `🧾 فاتورة جديدة — ${freshInvs.length} فاتورة`, body: freshInvs.slice(0, 2).map((p) => `${p.customer} (${money(p.amount)})`).join("، ") + (freshInvs.length > 2 ? " والبقية…" : "") });
  }
  if (alerts.length) fireAlerts(alerts);
  return alerts.length > 0;
}

function fireAlerts(alerts) {
  for (const a of alerts) {
    showToast(a);
    if (a.type === "pay") showModal(a);
    if (state.soundOn) alertSound(a.type === "pay" ? "pay" : "inv");
    if (a.type === "pay" && "Notification" in window && Notification.permission === "granted") {
      try {
        const n = new Notification(a.title, { body: a.body, tag: "pay-" + Date.now() });
        n.onclick = () => { window.focus(); switchView("dashboard"); };
      } catch (e) {}
    }
  }
  $("bellDot").hidden = false;
  if (!state.bellBusy) {
    state.bellBusy = true;
    setTimeout(() => { $("bellDot").hidden = true; state.bellBusy = false; }, 8000);
  }
}

function alertSound(kind) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const play = (freq, start, dur, type = "sine") => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.45, ctx.currentTime + start + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur + 0.05);
    };
    if (kind === "pay") { play(880, 0, .18, "triangle"); play(1174, .18, .25, "triangle"); }
    else { play(660, 0, .15); play(660, .18, .15); }
  } catch (e) {}
}

function showToast(a) {
  const el = document.createElement("div");
  el.className = "toast " + (a.type === "pay" ? "pay" : "");
  const icon = a.type === "pay"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5.5H9.8a2.8 2.8 0 0 0 0 5.6h4.4a2.8 2.8 0 0 1 0 5.6H7"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>';
  const title = a.type === "pay" ? a.title.replace("💸 ", "") : a.title.replace("🧾 ", "");
  el.innerHTML = `${icon}<div style="flex:1;min-width:0"><div class="toast-title">${esc(title)}</div><div class="toast-body">${esc(a.body)}</div></div><button class="toast-close" aria-label="إغلاق">×</button>`;
  el.querySelector(".toast-close").addEventListener("click", () => el.remove());
  $("toastArea").appendChild(el);
  setTimeout(() => el.remove(), 7000);
}

let dismissTimer = null;
function showModal(a) {
  if (!$("paymentModal").hidden) return;
  $("modalCustomer").textContent = a.pays.map((p) => p.customer).join("، ");
  $("modalAmount").textContent = money(a.pays.reduce((s, p) => s + p.amount, 0));
  $("paymentModal").hidden = false;
  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(closeModal, 10000);
}
function closeModal() { $("paymentModal").hidden = true; }
function toast(title, body, type = "pay") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.innerHTML = `<div><div class="toast-title">${esc(title)}</div><div class="toast-body">${esc(body)}</div></div>`;
  $("toastArea").appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/* ---------- Views Controller ---------- */
function render() {
  if (!state.data) return;
  $("dateToday").textContent = todayStr();
  const routeCount = (state.interactiveRoute || []).length;
  $("navRouteCount").hidden = routeCount === 0;
  $("navRouteCount").textContent = routeCount;
  switchView(state.view, true);
}

function switchView(name, force) {
  state.view = name;
  if (location.hash !== "#" + name) { try { location.hash = name; } catch (e) {} }
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const titles = { dashboard: "لوحة التحكم", route: "خط سير اليوم", collectors: "تقييم المحصلين", cashflow: "التدفق النقدي", cycle: "عملاء بالدورة" };
  $("pageTitle").textContent = titles[name] || "لوحة التحكم";
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
  if (force || !state.data) return;
  const fns = { dashboard: viewDashboard, route: viewRoute, collectors: viewCollectors, cashflow: viewCashflow, cycle: viewCycle };
  if (fns[name]) fns[name]();
}

/* ---------- 1. DASHBOARD ---------- */
function viewDashboard() {
  const d = state.data;
  const master = d.master || [];
  const cf = d.cash_flow || [];
  const totalBal = master.reduce((s, m) => s + m.balance, 0);
  const active = master.filter((m) => m.status === "نشط");
  const activeBal = active.reduce((s, m) => s + m.balance, 0);

  const routeStats = calculateRouteStats();
  const expToday = cf.reduce((s, c) => s + c.expected, 0);
  const colToday = cf.reduce((s, c) => s + c.collected, 0) + routeStats.collected;
  const manualPays = manualToday();
  const payToday = manualPays.reduce((s, p) => s + p.amount, 0);

  const repBal = {};
  master.forEach((m) => { if (m.collector) repBal[m.collector] = (repBal[m.collector] || 0) + m.balance; });
  const repCount = {};
  active.forEach((m) => { if (m.collector) repCount[m.collector] = (repCount[m.collector] || 0) + 1; });

  const topAreas = [...master.reduce((map, m) => {
    if (m.area) map.set(m.area, (map.get(m.area) || 0) + m.balance);
    return map;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxArea = topAreas.length ? topAreas[0][1] : 1;

  const kp = (label, value, sub, cls) => `<div class="kpi-card ${cls || ""}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ""}</div>`;
  $("view-dashboard").innerHTML = `
    <div class="kpi-grid">
      ${kp("إجمالي المديونية المستحقة", money(totalBal), `${active.length} عميل نشط`, "c-danger")}
      ${kp("إجمالي مديونية النشطاء", money(activeBal), "بدون الخالصين", "")}
      ${kp("أهداف اليوم (خط السير)", money(routeStats.totalDue), `${routeStats.totalCount} عميل — تم تحصيل ${money(routeStats.collected)}`, "c-accent")}
      ${kp("المتوقع اليوم — كاش فلو", money(expToday), "خطة السداد", "c-info")}
      ${kp("المُحصّل اليوم (إجمالي)", money(colToday), `نسبة ${expToday ? Math.round(colToday / expToday * 100) : 0}% من المتوقع`, "c-success")}
      ${kp("سداد اليوم (قبض يدوي)", money(payToday), `${manualPays.length} عملية سداد مسجلة`, "c-info")}
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-head">
          <span class="card-title">🎯 خط سير اليوم — أبرز العملاء</span>
          <button class="btn btn-ghost" onclick="switchView('route')" style="font-size:0.8rem;padding:4px 10px;">فتح خط السير التفاعلي ➔</button>
        </div>
        ${(state.interactiveRoute || []).length ? `<div class="table-wrap"><table>
          <thead><tr>
            <th class="row-num">م</th>
            <th>العميل</th>
            <th>المحصل</th>
            <th>المنطقة</th>
            <th>المبلغ المستحق</th>
            <th>المسدد</th>
            <th>الحالة</th>
          </tr></thead>
          <tbody>${(state.interactiveRoute || []).slice(0, 10).map((t, i) => `<tr>
            <td class="row-num">${i + 1}</td>
            <td><b>${esc(t.customer)}</b></td>
            <td>${esc(t.collector)}</td>
            <td>${esc(t.area)}</td>
            <td class="tbl-amount neg">${money(t.balance)}</td>
            <td class="tbl-amount pos">${t.paid ? money(t.paid) : "—"}</td>
            <td><span class="chip ${t.paid >= t.balance && t.balance > 0 ? "chip-green" : t.paid > 0 ? "chip-amber" : "chip-red"}">${esc(t.status || "لم يسدد")}</span></td>
          </tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">✅ لا توجد أهداف لخط السير اليوم</div>`}
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">توزيع المديونية حسب المحصل</span></div>
        <div class="rating-strip">
          ${Object.entries(repBal).map(([rep, bal]) => `<div class="rating-tile"><b>${money(bal)}</b>${esc(rep)}<span style="font-size:.72rem;opacity:.7">${repCount[rep] || 0} عميل</span></div>`).join("")}
        </div>
        <div class="card-title" style="margin-bottom:12px">أعلى 8 مناطق مديونية</div>
        ${topAreas.map(([area, bal]) => `<div class="bar-row"><div class="bar-label">${esc(area)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, bal / maxArea * 100)}%;background:linear-gradient(90deg,var(--primary),var(--secondary))"></div></div>
          <div class="bar-val">${money(bal)}</div></div>`).join("")}
      </div>
    </div>`;
}

/* ---------- 2. ROUTE (خط سير اليوم التفاعلي + سداد يدوي + إحصائيات الإكسل) ---------- */
function viewRoute() {
  const d = state.data;
  if (!d) return;

  initInteractiveRouteIfNeeded();
  const allRoute = state.interactiveRoute || [];
  const master = d.master || [];
  const reps = ["مصطفى", "محمد شعبان"];

  // تطبيق الفلاتر
  const fRep = state.filters.routeRep || "all";
  const fStatus = state.filters.routeStatus || "all";
  const fSearch = (state.filters.routeSearch || "").trim().toLowerCase();

  let filtered = allRoute.filter((item) => {
    if (fRep !== "all" && item.collector !== fRep) return false;
    if (fStatus === "not_visited" && !item.notVisited && item.comm !== "لم يذهب إليه المحصل") return false;
    if (fStatus === "paid" && (!item.paid || item.paid <= 0)) return false;
    if (fStatus === "responsive" && item.comm !== "عميل مستجيب") return false;
    if (fStatus === "unresponsive" && item.comm !== "عميل غير مستجيب") return false;
    if (fStatus === "pending" && (item.paid > 0 || item.comm === "عميل مستجيب")) return false;
    if (fSearch && !item.customer.toLowerCase().includes(fSearch) && !item.area.toLowerCase().includes(fSearch)) return false;
    return true;
  });

  // فرز
  filtered = sortArray(filtered, "route", (x, col) => {
    if (col === "notes" || col === "response") return x.response || "";
    if (col === "paid") return x.paid || 0;
    if (col === "balance") return x.balance || 0;
    return x[col];
  });

  // حساب المؤشرات المطابقة لشيت الإكسل
  const stats = calculateRouteStats(fRep === "all" ? allRoute : allRoute.filter((x) => x.collector === fRep));

  $("view-route").innerHTML = `
    <!-- شريط أدوات خط السير: فلاتر، إضافة عميل، نسخ للواتساب -->
    <div class="card" style="margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4);">
      <div class="route-toolbar">
        <div class="add-client-form">
          <span style="font-size:0.85rem; font-weight:800; color:var(--primary);">➕ إضافة عميل لليوم:</span>
          <input id="addClientInput" class="search-input" list="masterDataList" placeholder="اختر عميلاً من Master Data…" style="min-width: 240px;">
          <datalist id="masterDataList">
            ${master.map((m) => `<option value="${esc(m.name)}">${esc(m.name)} — ${esc(m.area)} (${money(m.balance)})</option>`).join("")}
          </datalist>
          <select id="addClientRepSelect" class="select">
            ${reps.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("")}
          </select>
          <button type="button" id="addClientBtn" class="btn btn-primary" style="padding: 7px 14px; font-size: 0.82rem;">إضافة ＋</button>
        </div>

        <div class="route-actions-group">
          <button type="button" id="resetRouteBtn" class="clear-sort" title="استعادة خط السير من الشيت الأصلي">↺ استعادة المقترح</button>
        </div>
      </div>

      <!-- تصفيات سريعة -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-top:8px;">
        <div class="seg" id="routeRepSeg">
          <button data-f="all" class="${fRep === "all" ? "active" : ""}">كل المحصلين (${allRoute.length})</button>
          ${reps.map((r) => `<button data-f="${esc(r)}" class="${fRep === r ? "active" : ""}">${esc(r)} (${allRoute.filter((x) => x.collector === r).length})</button>`).join("")}
        </div>

        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          <input class="search-input" id="routeTableSearch" placeholder="بحث باسم العميل أو المنطقة…" value="${esc(state.filters.routeSearch || "")}" style="padding:6px 12px; min-width:200px;">
          <select id="routeStatusFilter" class="select" style="padding:6px 10px;">
            <option value="all" ${fStatus === "all" ? "selected" : ""}>كل الحالات</option>
            <option value="not_visited" ${fStatus === "not_visited" ? "selected" : ""}>❌ لم يذهب إليهم (${allRoute.filter((x) => x.notVisited || x.comm === "لم يذهب إليه المحصل").length})</option>
            <option value="paid" ${fStatus === "paid" ? "selected" : ""}>💰 تم السداد اليوم (${allRoute.filter((x) => x.paid > 0).length})</option>
            <option value="responsive" ${fStatus === "responsive" ? "selected" : ""}>✅ عميل مستجيب (${allRoute.filter((x) => x.comm === "عميل مستجيب").length})</option>
            <option value="unresponsive" ${fStatus === "unresponsive" ? "selected" : ""}>⚠️ عميل غير مستجيب (${allRoute.filter((x) => x.comm === "عميل غير مستجيب").length})</option>
            <option value="pending" ${fStatus === "pending" ? "selected" : ""}>⏳ قيد المتابعة / لم يسدد</option>
          </select>
          ${clearSortBtn("route")}
        </div>
      </div>
    </div>

    <!-- إحصائيات سريعة علوية نظيفة ومتناسقة بنسبة 100% -->
    <div class="kpi-grid" style="margin-bottom: var(--space-4);">
      <div class="kpi-card c-danger">
        <div class="kpi-label">اجمالي المطلوب</div>
        <div class="kpi-value">${money(stats.totalDue)}</div>
        <div class="kpi-sub">${stats.totalCount} عميل</div>
      </div>
      <div class="kpi-card c-success">
        <div class="kpi-label">المحصل اليوم</div>
        <div class="kpi-value">${money(stats.collected)}</div>
        <div class="kpi-sub">نسبة التحصيل: ${stats.collectionRate.toFixed(1)}%</div>
      </div>
      <div class="kpi-card c-accent">
        <div class="kpi-label">المتبقي</div>
        <div class="kpi-value">${money(stats.remaining)}</div>
        <div class="kpi-sub">قيد التحصيل</div>
      </div>
      <div class="kpi-card c-info">
        <div class="kpi-label">تم التواصل / الزيارة</div>
        <div class="kpi-value">${stats.contactedCount}</div>
        <div class="kpi-sub">${stats.responsiveCount} مستجيب | ${stats.unresponsiveCount} غير مستجيب</div>
      </div>
      <div class="kpi-card" style="border-inline-start: 4px solid var(--danger);">
        <div class="kpi-label" style="color:var(--danger);">لم يذهب إليهم ❌</div>
        <div class="kpi-value" style="color:var(--danger);">${stats.notVisitedCount}</div>
        <div class="kpi-sub">عملاء لم يزرهم المحصل</div>
      </div>
    </div>

    <!-- الجدول التفاعلي الرئيسي بعرض كامل ونظيف 100% -->
    <div class="card" style="padding: var(--space-4);">
      <div class="table-wrap">
        <table class="interactive-table">
          <thead>
            <tr>
              <th class="row-num">م</th>
              ${sortTh("route", "customer", "str", "العميل")}
              ${sortTh("route", "balance", "num", "المبلغ المستحق")}
              ${sortTh("route", "paid", "num", "المسدد")}
              ${sortTh("route", "status", "str", "الحالة")}
              ${sortTh("route", "comm", "str", "التواصل")}
              ${sortTh("route", "response", "str", "الرد (رد العميل الوارد)")}
              <th style="width: 90px; text-align: center;">إجراءات</th>
            </tr>
          </thead>
          <tbody id="routeTableBody">
              ${filtered.length ? filtered.map((c, idx) => {
                const isNotVisited = c.notVisited || c.comm === "لم يذهب إليه المحصل";
                const isFullPaid = c.paid >= c.balance && c.balance > 0;
                const isPartial = c.paid > 0 && !isFullPaid;
                const rowClass = isFullPaid ? "row-status-green" : isNotVisited ? "row-status-red" : isPartial ? "row-status-amber" : (c.comm === "عميل مستجيب" ? "row-status-amber" : "");
                const commClass = c.comm === "عميل مستجيب" ? "st-responsive" : c.comm === "عميل غير مستجيب" ? "st-unresponsive" : c.comm === "تم التواصل" ? "st-contacted" : c.comm === "لم يذهب إليه المحصل" ? "st-not-visited" : "st-none";
                const statusChip = isFullPaid ? "chip-green" : isPartial ? "chip-amber" : "chip-gray";

                return `
                  <tr class="${rowClass}" data-customer="${esc(c.customer)}">
                    <td class="row-num">${idx + 1}</td>
                    
                    <!-- العميل -->
                    <td style="min-width: 170px;">
                      <div style="font-weight: 800; font-size: 0.92rem; color: var(--foreground);">${esc(c.customer)}</div>
                      <div style="display: flex; gap: 6px; align-items: center; margin-top: 2px;">
                        <span style="font-size: 0.72rem; opacity: 0.7;">📍 ${esc(c.area || "—")}</span>
                        <select class="table-rep-select" data-action="change-rep" data-customer="${esc(c.customer)}" title="نقل العميل لمحصل آخر">
                          ${reps.map((r) => `<option value="${esc(r)}" ${c.collector === r ? "selected" : ""}>${esc(r)}</option>`).join("")}
                        </select>
                      </div>
                    </td>

                    <!-- المبلغ المستحق -->
                    <td class="tbl-amount neg" style="font-size: 0.92rem;">${money(c.balance)}</td>

                    <!-- المسدد -->
                    <td style="min-width: 110px;">
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <b class="${c.paid > 0 ? "pos" : ""}" style="font-variant-numeric: tabular-nums;">${c.paid ? money(c.paid) : "0 ج.م"}</b>
                        <button type="button" class="table-pay-btn" data-action="quick-pay" data-customer="${esc(c.customer)}" title="تسجيل سداد فوري">
                          ＋سداد
                        </button>
                      </div>
                    </td>

                    <!-- الحالة -->
                    <td>
                      <span class="chip ${statusChip}">${esc(c.status || "لم يسدد")}</span>
                    </td>

                    <!-- التواصل -->
                    <td style="min-width: 160px;">
                      <div style="display: flex; flex-direction: column; gap: 4px;">
                        <select class="comm-select ${commClass}" data-action="change-comm" data-customer="${esc(c.customer)}">
                          <option value="لم يتم التواصل" ${c.comm === "لم يتم التواصل" ? "selected" : ""}>لم يتم التواصل</option>
                          <option value="تم التواصل" ${c.comm === "تم التواصل" ? "selected" : ""}>تم التواصل</option>
                          <option value="عميل مستجيب" ${c.comm === "عميل مستجيب" ? "selected" : ""}>عميل مستجيب</option>
                          <option value="عميل غير مستجيب" ${c.comm === "عميل غير مستجيب" ? "selected" : ""}>عميل غير مستجيب</option>
                          <option value="لم يذهب إليه المحصل" ${c.comm === "لم يذهب إليه المحصل" ? "selected" : ""}>لم يذهب إليه المحصل ❌</option>
                        </select>
                        <label class="not-visited-check" title="تحديد أن المحصل لم يذهب إلى هذا العميل اليوم">
                          <input type="checkbox" data-action="toggle-not-visited" data-customer="${esc(c.customer)}" ${isNotVisited ? "checked" : ""}>
                          <span style="color: ${isNotVisited ? "var(--danger)" : "inherit"};">لم يذهب إليه</span>
                        </label>
                      </div>
                    </td>

                    <!-- الرد (رد العميل الوارد من الواتساب مع زر التعديل) -->
                    <td style="min-width: 220px;">
                      <div class="resp-cell-content">
                        <div class="resp-text-preview" title="${esc(c.response || "لا يوجد رد مسجل")}">
                          ${c.response ? esc(c.response) : `<span style="opacity:0.45; font-style:italic;">لا يوجد رد مسجل</span>`}
                        </div>
                        <button type="button" class="resp-edit-btn" data-action="edit-resp" data-customer="${esc(c.customer)}" title="تعديل رد العميل الوارد من الواتساب">
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                          تعديل
                        </button>
                      </div>
                    </td>

                    <!-- إجراءات -->
                    <td style="text-align: center;">
                      <div class="tbl-actions" style="justify-content: center;">
                        <button type="button" class="tbl-action-icon" data-action="delete-route-client" data-customer="${esc(c.customer)}" title="إزالة العميل من خط سير اليوم">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>`;
              }).join("") : `<tr><td colspan="8" class="empty-state">لا يوجد عملاء مطابقون لهذا الفلتر</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
  `;

  // ربط الأحداث
  bindRouteEvents();
}

function bindRouteEvents() {
  // 1. تصفية المحصلين Tabs
  document.querySelectorAll("#routeRepSeg button").forEach((b) => {
    b.addEventListener("click", () => {
      state.filters.routeRep = b.dataset.f;
      viewRoute();
    });
  });

  // 2. تصفية الحالة والبحث
  const statusSelect = $("routeStatusFilter");
  if (statusSelect) {
    statusSelect.addEventListener("change", (e) => {
      state.filters.routeStatus = e.target.value;
      viewRoute();
    });
  }

  const tableSearch = $("routeTableSearch");
  if (tableSearch) {
    tableSearch.addEventListener("input", (e) => {
      state.filters.routeSearch = e.target.value;
      viewRoute();
    });
  }

  // 3. نموذج السداد اليدوي
  const payForm = $("routePayForm");
  if (payForm) {
    payForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const collector = $("routePayCollector").value;
      const customer = $("routePayCustomer").value.trim();
      const amount = Number($("routePayAmount").value);
      if (!customer) return toast("تنبيه", "يرجى تحديد اسم العميل أولاً", "warn");
      if (!amount || amount <= 0) return toast("تنبيه", "يرجى إدخال مبلغ صحيح", "warn");

      addManualPay(customer, amount, collector);
      toast("تم السداد ✓", `تم تسجيل سداد مبلغ ${money(amount)} للعميل ${customer}`, "pay");
      $("routePayAmount").value = "";
      $("routePayCustomer").value = "";
      viewRoute();
    });
  }

  // 4. إضافة عميل لليوم
  const addBtn = $("addClientBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const custInput = $("addClientInput");
      const repInput = $("addClientRepSelect");
      const name = (custInput.value || "").trim();
      const rep = repInput.value;
      if (!name) return toast("تنبيه", "يرجى كتابة أو اختيار اسم العميل", "warn");

      // البحث في ماستر داتا
      const master = (state.data && state.data.master) || [];
      const match = master.find((m) => m.name === name || m.name.includes(name));
      const customerName = match ? match.name : name;
      const bal = match ? Number(match.balance) || 0 : 0;
      const area = match ? match.area : "—";

      // التحقق من وجوده بالفعل
      const existing = (state.interactiveRoute || []).find((x) => x.customer === customerName);
      if (existing) {
        existing.collector = rep;
        toast("تم التحديث", `العميل ${customerName} موجود بالفعل وتم تعيينه للمحصل ${rep}`, "pay");
      } else {
        state.interactiveRoute.unshift({
          customer: customerName,
          collector: rep,
          area: area,
          balance: bal,
          paid: 0,
          status: "لم يسدد",
          comm: "لم يتم التواصل",
          response: match ? match.notes : "",
          notVisited: false,
          last_payment: match ? match.last_payment : "",
          last_visit: match ? match.last_visit : "",
          due: match ? match.due_date : "",
          rating: "",
          updatedAt: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
        });
        toast("تمت الإضافة ✓", `تمت إضافة ${customerName} إلى خط سير ${rep}`, "pay");
      }

      saveInteractiveRoute();
      custInput.value = "";
      viewRoute();
    });
  }

  // 5. استعادة المقترح
  const resetBtn = $("resetRouteBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (confirm("هل تريد استعادة قائمة خط السير المقترحة من الشيت الأصلي؟")) {
        localStorage.removeItem(getRouteStorageKey());
        state.interactiveRoute = null;
        initInteractiveRouteIfNeeded();
        toast("تمت الاستعادة", "تمت استعادة خط السير الأصلي من الشيت", "pay");
        viewRoute();
      }
    });
  }

  // 6. نسخ خط السير للواتساب
  const waBtn = $("waRouteShareBtn");
  if (waBtn) {
    waBtn.addEventListener("click", () => {
      openWhatsAppShareModal(state.filters.routeRep || "all");
    });
  }

  // 7. أحداث الجدول التفاعلية (Event Delegation)
  const tbody = $("routeTableBody");
  if (tbody) {
    tbody.addEventListener("change", (e) => {
      const target = e.target;
      const customer = target.dataset.customer;
      if (!customer) return;

      const item = state.interactiveRoute.find((x) => x.customer === customer);
      if (!item) return;

      if (target.dataset.action === "change-rep") {
        item.collector = target.value;
        saveInteractiveRoute();
        toast("نقل عميل", `تم نقل العميل ${customer} للمحصل ${item.collector}`, "pay");
        viewRoute();
      } else if (target.dataset.action === "change-comm") {
        item.comm = target.value;
        if (item.comm === "لم يذهب إليه المحصل") item.notVisited = true;
        else if (item.notVisited && item.comm !== "لم يتم التواصل") item.notVisited = false;
        saveInteractiveRoute();
        viewRoute();
      } else if (target.dataset.action === "toggle-not-visited") {
        item.notVisited = target.checked;
        if (item.notVisited) item.comm = "لم يذهب إليه المحصل";
        else if (item.comm === "لم يذهب إليه المحصل") item.comm = "لم يتم التواصل";
        saveInteractiveRoute();
        viewRoute();
      }
    });

    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const customer = btn.dataset.customer;
      if (!customer) return;

      if (action === "edit-resp") {
        openResponseModal(customer);
      } else if (action === "quick-pay") {
        openQuickPayModal(customer);
      } else if (action === "delete-route-client") {
        if (confirm(`هل تريد إزالة العميل "${customer}" من خط سير اليوم؟`)) {
          state.interactiveRoute = state.interactiveRoute.filter((x) => x.customer !== customer);
          saveInteractiveRoute();
          toast("تم الحذف", `تمت إزالة ${customer} من خط السير`, "warn");
          viewRoute();
        }
      }
    });
  }
}

/* ---------- 3. COLLECTORS (تقييم المحصلين المرتبط بالتفاعل اللحظي) ---------- */
function viewCollectors() {
  const d = state.data;
  if (!d) return;

  initInteractiveRouteIfNeeded();
  const allRoute = state.interactiveRoute || [];
  const master = d.master || [];
  const cf = d.cash_flow || [];
  const repOf = new Map(master.filter((m) => m.collector).map((m) => [m.name, m.collector]));
  const reps = ["مصطفى", "محمد شعبان"];

  const currentTab = state.filters.collectorTab || "all";

  // حساب بيانات التقييم الشاملة لكل محصل
  const repMetrics = reps.map((rep) => {
    const clients = allRoute.filter((c) => c.collector === rep);
    const stats = calculateRouteStats(clients);

    const sheet = (d.route_sheets || {})[rep] || { today: [], overdue: [] };
    const todayClients = sheet.today || [];
    const overdueClients = sheet.overdue || [];
    const sheetBal = todayClients.reduce((s, c) => s + c.balance, 0) + overdueClients.reduce((s, c) => s + c.balance, 0);

    const cfRep = cf.filter((c) => repOf.get(c.customer) === rep);
    const expCol = cfRep.reduce((s, c) => s + c.expected, 0) || stats.totalDue;
    const colCol = cfRep.reduce((s, c) => s + c.collected, 0);
    const repPays = manualToday(rep);
    const repManual = repPays.reduce((s, p) => s + p.amount, 0);
    const totalCollected = stats.collected + repManual;
    const collectionPct = stats.totalDue > 0 ? Math.round((totalCollected / stats.totalDue) * 100) : 0;
    const coveragePct = stats.totalCount > 0 ? Math.round((stats.contactedCount / stats.totalCount) * 100) : 0;

    return {
      rep,
      clients,
      stats,
      sheetBal,
      repPays,
      totalCollected,
      collectionPct,
      coveragePct,
      expCol,
    };
  });

  // إذا تم اختيار محصل معين (عرض مخصص وتفصيلي)
  if (currentTab !== "all") {
    const data = repMetrics.find((x) => x.rep === currentTab) || repMetrics[0];
    const { rep, clients, stats, repPays, totalCollected, collectionPct, coveragePct } = data;
    const pctColor = collectionPct >= 70 ? "var(--success)" : collectionPct >= 40 ? "var(--warning)" : "var(--danger)";

    $("view-collectors").innerHTML = `
      <!-- شريط التنقل العلوي بين المحصلين والمقارنة الشاملة -->
      <div class="collector-nav-bar">
        <div class="seg" id="collectorTabSeg">
          <button data-tab="all" class="${currentTab === "all" ? "active" : ""}">📊 مقارنة الأداء الشاملة</button>
          ${reps.map((r) => `<button data-tab="${esc(r)}" class="${currentTab === r ? "active" : ""}">👤 ${esc(r)}</button>`).join("")}
        </div>

        <div style="display:flex; gap:8px; align-items:center;">
          <button type="button" class="btn btn-primary" onclick="copyCollectorSummaryReport('${esc(rep)}')" style="font-size:0.8rem; padding:7px 14px;">
            📋 تقرير الإنجاز اليومي
          </button>
        </div>
      </div>

      <!-- بطاقة المحصل الرئيسية ومؤشرات الإنجاز التنفيذية -->
      <div class="card" style="margin-bottom: var(--space-4);">
        <div class="collector-hero-header">
          <div class="col-avatar">${esc(rep.substring(0, 1))}</div>
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap:8px;">
              <h2 style="font-size:1.35rem; font-weight:900;">${esc(rep)}</h2>
              <span class="chip chip-blue">محصل ميداني نشط</span>
            </div>
            <div style="font-size:0.8rem; opacity:0.7; margin-top:2px;">تقييم نشاط ومتابعة العملاء الميدانية لليوم — ${todayStr()}</div>
          </div>
        </div>

        <!-- مؤشرات الإنجاز الرئيسية للمحصل -->
        <div class="kpi-grid" style="margin: var(--space-4) 0 var(--space-3) 0;">
          <div class="kpi-card c-danger">
            <div class="kpi-label">المطلوب الميداني اليوم</div>
            <div class="kpi-value">${money(stats.totalDue)}</div>
            <div class="kpi-sub">${stats.totalCount} عميل مكلف بهم</div>
          </div>
          <div class="kpi-card c-success">
            <div class="kpi-label">المُحصّل الفعلي اليوم</div>
            <div class="kpi-value">${money(totalCollected)}</div>
            <div class="kpi-sub">نسبة التحصيل: ${collectionPct}%</div>
          </div>
          <div class="kpi-card c-info">
            <div class="kpi-label">التغطية الميدانية (الزيارات)</div>
            <div class="kpi-value">${coveragePct}%</div>
            <div class="kpi-sub">${stats.contactedCount} تمت زيارتهم من ${stats.totalCount}</div>
          </div>
          <div class="kpi-card" style="border-inline-start: 4px solid var(--danger);">
            <div class="kpi-label" style="color:var(--danger);">لم يذهب إليهم ❌</div>
            <div class="kpi-value" style="color:var(--danger);">${stats.notVisitedCount}</div>
            <div class="kpi-sub">${stats.totalCount > 0 ? Math.round(stats.notVisitedCount / stats.totalCount * 100) : 0}% من العملاء لم يزرهم</div>
          </div>
          <div class="kpi-card c-accent">
            <div class="kpi-label">الاستجابة والتعثر</div>
            <div class="kpi-value">${stats.responsiveCount}</div>
            <div class="kpi-sub">${stats.unresponsiveCount} غير مستجيب | استجابة: ${stats.responseRate.toFixed(1)}%</div>
          </div>
        </div>

        <!-- شريط التقدم الفعلي للتحصيل والتغطية -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-4); margin-top:var(--space-3);">
          <div>
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:800; margin-bottom:5px;">
              <span>نسبة تحقيق التحصيل المالي</span>
              <b style="color:${pctColor};">${collectionPct}%</b>
            </div>
            <div class="prog-track" style="height:10px;"><div class="prog-fill" style="width:${Math.min(100, collectionPct)}%; background:${pctColor};"></div></div>
          </div>
          <div>
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:800; margin-bottom:5px;">
              <span>نسبة إنجاز الزيارات الميدانية</span>
              <b>${coveragePct}%</b>
            </div>
            <div class="prog-track" style="height:10px;"><div class="prog-fill" style="width:${Math.min(100, coveragePct)}%; background:var(--secondary);"></div></div>
          </div>
        </div>
      </div>

      <!-- كشف نشاط المحصل وتفاعل العملاء الميداني اليوم مع أسهم الترتيب -->
      <div class="card" style="padding: var(--space-4); margin-top: var(--space-4);">
        <div class="card-head">
          <span class="card-title">📋 تفاصيل نشاط المحصل وتفاعل العملاء الميداني اليوم (${clients.length} عميل)</span>
          <span class="card-sub">اضغط على أي عمود لترتيب العملاء حسب الأولوية أو المبالغ أو الردود</span>
          ${clearSortBtn("collector_clients")}
        </div>

        <div class="table-wrap">
          <table class="interactive-table">
            <thead>
              <tr>
                <th class="row-num">م</th>
                ${sortTh("collector_clients", "customer", "str", "العميل")}
                ${sortTh("collector_clients", "area", "str", "المنطقة")}
                ${sortTh("collector_clients", "balance", "num", "المطلوب")}
                ${sortTh("collector_clients", "paid", "num", "المسدد اليوم")}
                ${sortTh("collector_clients", "comm", "str", "حالة الزيارة والتواصل")}
                ${sortTh("collector_clients", "response", "str", "رد العميل الوارد من الواتساب")}
              </tr>
            </thead>
            <tbody>
              ${(() => {
                let sortedClients = sortArray(clients, "collector_clients", (x, col) => {
                  if (col === "paid") return x.paid || 0;
                  if (col === "balance") return x.balance || 0;
                  return x[col] || "";
                });
                return sortedClients.length ? sortedClients.map((c, idx) => {
                  const isDone = c.paid > 0;
                  const isNotVisited = c.notVisited || c.comm === "لم يذهب إليه المحصل";
                  const rowClass = isDone ? "row-status-green" : isNotVisited ? "row-status-red" : (c.comm === "عميل مستجيب" ? "row-status-amber" : "");
                  const commClass = c.comm === "عميل مستجيب" ? "chip-green" : c.comm === "عميل غير مستجيب" ? "chip-amber" : c.comm === "تم التواصل" ? "chip-blue" : c.comm === "لم يذهب إليه المحصل" ? "chip-red" : "chip-gray";

                  return `
                    <tr class="${rowClass}">
                      <td class="row-num">${idx + 1}</td>
                      <td>
                        <b style="font-size:0.92rem;">${esc(c.customer)}</b>
                        ${c.status === "خالص" ? `<span class="chip chip-green" style="font-size:0.65rem; padding:1px 5px; margin-inline-start:4px;">خالص</span>` : ""}
                      </td>
                      <td>📍 ${esc(c.area || "—")}</td>
                      <td class="tbl-amount neg">${money(c.balance)}</td>
                      <td class="tbl-amount ${isDone ? "pos" : ""}">${isDone ? "+" + money(c.paid) : "0 ج.م"}</td>
                      <td>
                        <span class="chip ${commClass}">${esc(c.comm)}</span>
                        ${isNotVisited ? `<span style="display:block; font-size:0.7rem; color:var(--danger); font-weight:700; margin-top:2px;">لم يذهب إليه المحصل ❌</span>` : ""}
                      </td>
                      <td>
                        <div class="resp-cell-content">
                          <div class="resp-text-preview" title="${esc(c.response || "لا يوجد رد مسجل")}">
                            ${c.response ? esc(c.response) : `<span style="opacity:0.4; font-style:italic;">لا يوجد رد مسجل بعد</span>`}
                          </div>
                          <button type="button" class="resp-edit-btn" onclick="openResponseModal('${esc(c.customer)}')">
                            ✏️ تعديل
                          </button>
                        </div>
                      </td>
                    </tr>`;
                }).join("") : `<tr><td colspan="7" class="empty-state">لا يوجد عملاء مخصصون للمحصل في خط السير اليوم</td></tr>`;
              })()}
            </tbody>
          </table>
        </div>
      </div>

      <!-- آخر عمليات سداد مسجلة للمحصل اليوم -->
      <div class="card" style="margin-top: var(--space-4);">
        <div class="card-head">
          <span class="card-title">💵 سجل المقبوضات والسداد المباشر للمحصل اليوم (${repPays.length} عملية)</span>
        </div>
        <div class="mini-feed">
          ${repPays.length ? repPays.slice().reverse().map((p) => `
            <div class="mini-item" style="padding: 10px 14px;">
              <div>
                <b style="font-size:0.9rem;">${esc(p.customer)}</b>
                <div style="font-size:0.74rem; opacity:0.7;">سداد نقدي مباشر في الميدان</div>
              </div>
              <div style="text-align:end;">
                <b class="pos" style="font-size:1.05rem;">+${money(p.amount)}</b>
                <em style="display:block; font-size:0.72rem; opacity:0.7;">⏰ ${esc(p.time)}</em>
              </div>
            </div>`).join("") : `<div class="mini-item muted">لا توجد عمليات سداد مسجلة للمحصل اليوم حتى الآن</div>`}
        </div>
      </div>
    `;
  } else {
    // عرض المقارنة الشاملة (All Collectors Side-by-Side Comparison)
    const scorecards = repMetrics.map((data) => {
      const { rep, stats, repPays, totalCollected, collectionPct, coveragePct } = data;
      const pctColor = collectionPct >= 70 ? "var(--success)" : collectionPct >= 40 ? "var(--warning)" : "var(--danger)";

      return `
        <div class="comp-scorecard highlight">
          <div class="scorecard-head">
            <div style="display:flex; align-items:center; gap:10px;">
              <div class="col-avatar">${esc(rep.substring(0, 1))}</div>
              <div>
                <h3 style="font-size:1.15rem; font-weight:800;">${esc(rep)}</h3>
                <div style="font-size:0.74rem; opacity:0.7;">محصل ميداني</div>
              </div>
            </div>
          </div>

          <!-- شريط الإنجاز -->
          <div class="collector-progress" style="margin-bottom:var(--space-3);">
            <div class="prog-head">
              <span>نسبة التحصيل المالي</span>
              <b style="color:${pctColor};">${collectionPct}%</b>
            </div>
            <div class="prog-track" style="height:9px;"><div class="prog-fill" style="width:${Math.min(100, collectionPct)}%; background:${pctColor};"></div></div>
            <div class="prog-sub">تم تحصيل ${money(totalCollected)} من أصل ${money(stats.totalDue)} مطلوب</div>
          </div>

          <!-- إحصائيات النشاط -->
          <div class="stat-pills">
            <div class="stat-pill">
              <b>${stats.totalCount}</b>
              <span>عملاء اليوم</span>
            </div>
            <div class="stat-pill">
              <b style="color:var(--info);">${stats.contactedCount} (${coveragePct}%)</b>
              <span>تمت الزيارة</span>
            </div>
            <div class="stat-pill" style="background:color-mix(in srgb, var(--danger) 10%, transparent);">
              <b style="color:var(--danger);">${stats.notVisitedCount}</b>
              <span>لم يذهب إليهم ❌</span>
            </div>
            <div class="stat-pill">
              <b style="color:var(--success);">${stats.responsiveCount}</b>
              <span>مستجيب</span>
            </div>
          </div>

          <!-- زر فتح الكشف التفصيلي للمحصل -->
          <div style="margin-top:14px; text-align:center;">
            <button type="button" class="btn btn-ghost" onclick="setCollectorTab('${esc(rep)}')" style="width:100%; font-size:0.82rem; font-weight:700;">
              عرض تقرير نشاط ${esc(rep)} التفصيلي ➔
            </button>
          </div>
        </div>
      `;
    }).join("");

    $("view-collectors").innerHTML = `
      <!-- شريط التنقل العلوي -->
      <div class="collector-nav-bar">
        <div class="seg" id="collectorTabSeg">
          <button data-tab="all" class="active">📊 مقارنة الأداء الشاملة</button>
          ${reps.map((r) => `<button data-tab="${esc(r)}">👤 ${esc(r)}</button>`).join("")}
        </div>
      </div>

      <!-- بطاقات المقارنة الشاملة -->
      <div class="comparison-grid">${scorecards}</div>

      <!-- جدول تقييم العملاء التاريخي (مرتب من الأخطر للأفضل) -->
      <div class="card">
        <div class="card-head">
          <span class="card-title">تقييم العملاء التاريخي العام — من الأخطر للأفضل (خط سير)</span>
          <div class="legend">
            <span><i style="background:var(--danger)"></i>خطر</span>
            <span><i style="background:var(--warning)"></i>سيء</span>
            <span><i style="background:var(--info)"></i>جيد</span>
            <span><i style="background:var(--success)"></i>ممتاز</span>
          </div>
          ${clearSortBtn("collectors")}
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="row-num">م</th>
                ${sortTh("collectors", "customer", "str", "العميل")}
                ${sortTh("collectors", "rep", "str", "المحصل")}
                ${sortTh("collectors", "area", "str", "المنطقة")}
                ${sortTh("collectors", "target_debt", "num", "المديونية")}
                ${sortTh("collectors", "turnover", "num", "معدل الدوران")}
                ${sortTh("collectors", "rating", "rate", "التقييم")}
                ${sortTh("collectors", "last_response", "str", "آخر رد")}
              </tr>
            </thead>
            <tbody id="collectBody"></tbody>
          </table>
        </div>
      </div>
    `;

    // رسم جدول التقييمات التاريخي
    const allRates = (d.route_line || []).filter((r) => r.rating);
    const rows = allRates.map((r) => {
      const m = master.find((x) => x.name === r.customer);
      return { r, rep: m ? m.collector : "" };
    }).sort((a, b) => (RATE_ORDER[a.r.rating] ?? 0) - (RATE_ORDER[b.r.rating] ?? 0));

    const drawCollect = () => {
      if (!$("collectBody")) return;
      let list = sortArray(rows, "collectors", (x, col) => (col === "rep" ? x.rep : x.r[col]));
      if (!state.sort.collectors) list = rows.slice().sort((a, b) => (RATE_ORDER[a.r.rating] ?? 0) - (RATE_ORDER[b.r.rating] ?? 0));
      $("collectBody").innerHTML = list.map(({ r, rep }, idx) => {
        const c = r.rating.includes("ممتاز") ? "chip-green" : r.rating.includes("جيد") ? "chip-blue" : r.rating.includes("سيء") ? "chip-amber" : "chip-red";
        const t = r.turnover && r.turnover !== "0" ? Number(r.turnover).toFixed(1) : "—";
        return `<tr>
          <td class="row-num">${idx + 1}</td>
          <td><b>${esc(r.customer)}</b></td>
          <td>${esc(rep || "—")}</td>
          <td>${esc(r.area)}</td>
          <td class="tbl-amount neg">${money(r.target_debt)}</td>
          <td>${t}</td>
          <td><span class="chip ${c}">${esc(r.rating)}</span></td>
          <td class="note-text">${esc(r.last_response || "—")}</td>
        </tr>`;
      }).join("") || '<tr><td colspan="8" class="empty-state">لا توجد تقييمات</td></tr>';
    };
    drawCollect();
  }

  // ربط أزرار التاب
  document.querySelectorAll("#collectorTabSeg button").forEach((b) => {
    b.addEventListener("click", () => {
      setCollectorTab(b.dataset.tab);
    });
  });
}

function setCollectorTab(tabName) {
  state.filters.collectorTab = tabName;
  viewCollectors();
}

function copyCollectorSummaryReport(collector) {
  const all = state.interactiveRoute || [];
  const list = all.filter((x) => x.collector === collector);
  const stats = calculateRouteStats(list);
  const pays = manualToday(collector);
  const totalPaid = stats.collected + pays.reduce((s, p) => s + p.amount, 0);

  let report = `📊 *تقرير إنجاز المحصل اليومي*\n👤 *المحصل:* ${collector}\n📅 *التاريخ:* ${todayStr()}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `💰 *التحصيل المالي:*\n`;
  report += `• المطلوب: ${money(stats.totalDue)}\n`;
  report += `• المحصل الفعلي: ${money(totalPaid)}\n`;
  report += `• نسبة التحصيل: ${stats.totalDue > 0 ? (totalPaid / stats.totalDue * 100).toFixed(1) : 0}%\n\n`;

  report += `🚶‍♂️ *الموقف الميداني والتغطية:*\n`;
  report += `• إجمالي العملاء: ${stats.totalCount}\n`;
  report += `• تمت الزيارة / التواصل: ${stats.contactedCount} (${stats.totalCount > 0 ? (stats.contactedCount / stats.totalCount * 100).toFixed(1) : 0}%)\n`;
  report += `• لم يذهب إليهم: ${stats.notVisitedCount} ❌\n`;
  report += `• عملاء مستجيبون: ${stats.responsiveCount}\n`;
  report += `• غير مستجيبين / تعثر: ${stats.unresponsiveCount}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `📋 *تفاصيل ردود وسداد العملاء:*\n`;

  list.forEach((c, idx) => {
    const isDone = c.paid > 0;
    const isNotVisited = c.notVisited || c.comm === "لم يذهب إليه المحصل";
    report += `${idx + 1}. *${c.customer}* (${c.area || "—"})\n`;
    report += `   - المطلوب: ${money(c.balance)}${isDone ? ` | مسدد: ${money(c.paid)} ✓` : ""}\n`;
    report += `   - الموقف: ${isNotVisited ? "❌ لم يذهب إليه المحصل" : c.comm}\n`;
    if (c.response) report += `   - الرد: ${c.response}\n`;
    report += `   ───────────────\n`;
  });

  navigator.clipboard.writeText(report).then(() => {
    toast("تم النسخ ✓", `تم نسخ تقرير إنجاز ${collector} الكامل إلى الحافظة بنجاح`, "pay");
  }).catch(() => {
    toast("تم التوليد", "يمكنك نسخ التقرير", "pay");
  });
}



/* ---------- 5. CASHFLOW (التدفق النقدي) ---------- */
function viewCashflow() {
  const d = state.data;
  const cf = d.cash_flow || [];
  const exp = cf.reduce((s, c) => s + c.expected, 0);
  const col = cf.reduce((s, c) => s + c.collected, 0);
  const rem = cf.reduce((s, c) => s + c.remaining, 0);
  const chipOf = (s) => s === "مكتمل" ? "chip-green" : s === "جزئي" ? "chip-amber" : "chip-red";
  const statusOf = (s) => s === "مكتمل" ? "مكتمل" : s === "جزئي" ? "جزئي" : "لم يسدد";
  const done = cf.filter((c) => c.pay_status === "مكتمل").length;
  const pct = exp ? (col / exp) * 100 : 0;
  $("view-cashflow").innerHTML = `
    <div class="card">
      <div class="kpi-grid" style="margin-bottom:var(--space-3)">
        <div class="kpi-card c-info"><div class="kpi-label">إجمالي المتوقع (الخطة)</div><div class="kpi-value">${money(exp)}</div></div>
        <div class="kpi-card c-success"><div class="kpi-label">إجمالي المحصّل</div><div class="kpi-value">${money(col)}</div></div>
        <div class="kpi-card c-danger"><div class="kpi-label">المتبقي</div><div class="kpi-value">${money(rem)}</div></div>
        <div class="kpi-card c-accent"><div class="kpi-label">نسبة التحصيل</div><div class="kpi-value">${pct.toFixed(1)}%</div><div class="kpi-sub">${done} من ${cf.length} عميل مكتمل</div></div>
      </div>
      <div class="bar-row"><div class="bar-label">نسبة الإنجاز اليومي</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, pct)}%;background:${pct >= 80 ? "var(--success)" : pct >= 40 ? "var(--warning)" : "var(--danger)"}"></div></div>
        <div class="bar-val">${pct.toFixed(1)}%</div></div>
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">خطة السداد اليومية — ${cf.length} عميل</span>
        <div class="legend"><span><i style="background:var(--success)"></i>مكتمل</span><span><i style="background:var(--warning)"></i>جزئي</span><span><i style="background:var(--danger)"></i>لم يسدد</span></div>
        ${clearSortBtn("cash")}
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th class="row-num">م</th>
          ${sortTh("cash", "customer", "str", "العميل")}
          ${sortTh("cash", "balance", "num", "الرصيد")}
          ${sortTh("cash", "expected", "num", "المتوقع")}
          ${sortTh("cash", "collected", "num", "المحصّل")}
          ${sortTh("cash", "pay_ratio", "num", "النسبة")}
          ${sortTh("cash", "due", "date", "موعد السداد")}
          ${sortTh("cash", "pay_status", "str", "الحالة")}
          ${sortTh("cash", "remaining", "num", "المتبقي")}
          ${sortTh("cash", "notes", "str", "ملاحظات")}
        </tr></thead>
        <tbody id="cashBody"></tbody></table></div>
    </div>`;
  const rowClassOf = (s) => (s === "مكتمل" ? "row-status-green" : s === "جزئي" ? "row-status-amber" : "row-status-red");
  const cashRow = (c, i) => `<tr class="${rowClassOf(c.pay_status)}">
      <td class="row-num">${i + 1}</td>
      <td><b>${esc(c.customer)}</b></td>
      <td class="tbl-amount">${money(c.balance)}</td>
      <td class="tbl-amount">${money(c.expected)}</td>
      <td class="tbl-amount ${c.collected ? "pos" : ""}">${money(c.collected)}</td>
      <td>${c.pay_ratio ? (Number(c.pay_ratio) * 100).toFixed(0) + "%" : "—"}</td>
      <td>${dueLabel(c.due)}</td>
      <td><span class="chip ${chipOf(c.pay_status)}">${statusOf(c.pay_status)}</span></td>
      <td class="tbl-amount ${c.remaining ? "neg" : ""}">${money(c.remaining)}</td>
      <td class="note-text">${esc(c.notes || "—")}</td></tr>`;
  const drawCash = () => {
    if (!$("cashBody")) return;
    const list = sortArray(cf, "cash");
    $("cashBody").innerHTML = list.map(cashRow).join("") || '<tr><td colspan="10" class="empty-state">لا توجد خطة سداد</td></tr>';
  };
  drawCash();
}

/* ---------- 6. CYCLE (عملاء بالدورة) ---------- */
function viewCycle() {
  const d = state.data;
  const cc = (d.cycle_clients || []).slice();
  const total = cc.reduce((s, c) => s + c.balance, 0);
  const overdue = cc.filter((c) => (c.days_left || 0) < 0);
  const active = cc.filter((c) => (c.days_left || 0) >= 0);
  const overdueBal = overdue.reduce((s, c) => s + c.balance, 0);
  const activeBal = active.reduce((s, c) => s + c.balance, 0);
  $("view-cycle").innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card c-accent"><div class="kpi-label">عدد عملاء بالدورة</div><div class="kpi-value">${cc.length}</div><div class="kpi-sub">${cc.length ? "من شيت عملاء الدورة" : ""}</div></div>
      <div class="kpi-card c-danger"><div class="kpi-label">إجمالي رصيد الدورة</div><div class="kpi-value">${money(total)}</div></div>
      <div class="kpi-card c-success"><div class="kpi-label">دورة كاملة (مستمرة)</div><div class="kpi-value">${active.length}</div><div class="kpi-sub">${money(activeBal)}</div></div>
      <div class="kpi-card c-danger"><div class="kpi-label">انتهت الدورة (استحق التحصيل)</div><div class="kpi-value">${overdue.length}</div><div class="kpi-sub">${money(overdueBal)}</div></div>
    </div>
    <div class="card">
      <div class="card-head">
        <span class="card-title">عملاء بالدورة — ${cc.length} عميل</span>
        <div class="filters">
          <input class="search-input" id="cycleSearch" placeholder="ابحث باسم عميل…" value="${esc(state.filters.cycleSearch || "")}">
          <select class="select" id="cycleState">
            <option value="">كل الحالات</option><option value="active" ${state.filters.cycleState === "active" ? "selected" : ""}>دورة كاملة (مستمرة)</option><option value="overdue" ${state.filters.cycleState === "overdue" ? "selected" : ""}>انتهت الدورة</option><option value="soon" ${state.filters.cycleState === "soon" ? "selected" : ""}>تستحق خلال أسبوع</option>
          </select>
        </div>
        ${clearSortBtn("cycle")}
      </div>
      <div class="table-wrap"><table class="cycle-table" id="cycleTable">
        <thead><tr>
          <th>م</th>
          ${sortTh("cycle", "customer", "str", "العميل", "c-name")}
          ${sortTh("cycle", "balance", "num", "الرصيد", "c-bal")}
          ${sortTh("cycle", "due_date", "date", "موعد التحصيل", "c-date")}
          ${sortTh("cycle", "cycle_start", "date", "بداية الدورة", "c-date")}
          ${sortTh("cycle", "cycle_end", "date", "نهاية الدورة", "c-date")}
          ${sortTh("cycle", "days_left", "num", "الأيام المتبقية")}
          <th>حالة الدورة</th>
        </tr></thead>
        <tbody id="cycleBody"></tbody></table></div>
    </div>`;
  const draw = () => {
    const q = $("cycleSearch").value.trim();
    const st = $("cycleState").value;
    state.filters.cycleSearch = q;
    state.filters.cycleState = st;
    let list = cc.filter((c) => {
      if (q && !c.customer.includes(q)) return false;
      const days = c.days_left || 0;
      if (st === "active" && days < 0) return false;
      if (st === "overdue" && days >= 0) return false;
      if (st === "soon" && (days < 0 || days > 7)) return false;
      return true;
    });
    list = sortArray(list, "cycle");
    $("cycleBody").innerHTML = list.map((c, i) => {
      const days = c.days_left || 0;
      const end = days >= 0 ? "chip-green" : "chip-red";
      const endTxt = days >= 0 ? "بالدورة" : "انتهت الدورة";
      const dChip = days < 0 ? "chip-red" : days <= 7 ? "chip-amber" : "chip-green";
      const dTxt = days < 0 ? `منذ ${Math.abs(days)} يوم` : days === 0 ? "اليوم" : `${days} يوم`;
      const cycleRowClass = days < 0 ? "row-status-red" : days <= 7 ? "row-status-amber" : "row-status-green";
      return `<tr class="${cycleRowClass}">
        <td class="row-num">${i + 1}</td>
        <td class="c-name"><b>${esc(c.customer)}</b></td>
        <td class="c-bal tbl-amount neg">${money(c.balance)}</td>
        <td class="c-date">${dueLabel(c.due_date)}</td>
        <td class="c-date">${dueLabel(c.cycle_start)}</td>
        <td class="c-date">${dueLabel(c.cycle_end)}</td>
        <td><span class="chip ${dChip}">${dTxt}</span></td>
        <td><span class="chip ${end}">${endTxt}</span></td></tr>`;
    }).join("") || '<tr><td colspan="8" class="empty-state">لا نتائج مطابقة</td></tr>';
  };
  $("cycleSearch").addEventListener("input", draw);
  $("cycleState").addEventListener("change", draw);
  draw();
}

/* ---------- 7. Modals: Response Editor, Quick Pay & WhatsApp Share ---------- */
function openResponseModal(customerName) {
  state.activeEditingCustomer = customerName;
  const item = (state.interactiveRoute || []).find((x) => x.customer === customerName);
  const master = (state.data && state.data.master) || [];
  const mm = master.find((x) => x.name === customerName);

  const currentResp = item ? item.response : (mm ? mm.notes : "");
  const currentComm = item ? item.comm : "تم التواصل";

  $("respModalCustomer").textContent = `العميل: ${customerName} ${item ? `— منطقة: ${item.area}` : ""}`;
  $("respModalInput").value = currentResp || "";
  $("respModalComm").value = currentComm || "تم التواصل";
  $("responseModal").hidden = false;
  $("respModalInput").focus();
}

function closeResponseModal() {
  $("responseModal").hidden = true;
  state.activeEditingCustomer = null;
}

function openQuickPayModal(customerName) {
  const item = (state.interactiveRoute || []).find((x) => x.customer === customerName);
  const reps = ["مصطفى", "محمد شعبان"];

  $("quickPayCustomerName").textContent = `تسجيل سداد للعميل: ${customerName}`;
  $("quickPayMeta").innerHTML = `
    <span>المديونية الحالية: <b>${money(item ? item.balance : 0)}</b></span>
    <span>المسدد اليوم: <b class="pos">${money(item ? item.paid : 0)}</b></span>
  `;
  $("quickPayAmountInput").value = "";
  $("quickPayCollectorSelect").innerHTML = reps.map((r) => `<option value="${esc(r)}" ${item && item.collector === r ? "selected" : ""}>${esc(r)}</option>`).join("");
  $("quickPayForm").dataset.customer = customerName;
  $("quickPayModal").hidden = false;
  $("quickPayAmountInput").focus();
}

function closeQuickPayModal() {
  $("quickPayModal").hidden = true;
}

function openWhatsAppShareModal(collector) {
  const all = state.interactiveRoute || [];
  const filtered = collector === "all" ? all : all.filter((x) => x.collector === collector);
  const dateStr = todayStr();

  let text = `📋 *خط سير التحصيل اليومي*\n📅 التاريخ: ${dateStr}\n👤 المحصل: ${collector === "all" ? "عام (كل المحصلين)" : collector}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  filtered.forEach((c, idx) => {
    text += `${idx + 1}. *${c.customer}*\n`;
    text += `   📍 المنطقة: ${c.area || "—"}\n`;
    text += `   💰 المطلوب: ${money(c.balance)}\n`;
    if (c.response) text += `   📝 ملاحظة/رد سابق: ${c.response}\n`;
    text += `   ───────────────\n`;
  });

  const totalDue = filtered.reduce((s, c) => s + (Number(c.balance) || 0), 0);
  text += `\n📊 *الإجمالي:* ${filtered.length} عميل | المطلوب: ${money(totalDue)}\n`;
  text += `⚠️ برجاء إرسال رد كل عميل فور مقابلته أو الاتصال به. بالتوفيق!`;

  $("waModalText").value = text;
  $("waModalTitle").textContent = `📋 خط سير الواتساب — ${collector === "all" ? "الكل" : collector}`;
  $("waCopyAlert").style.opacity = "0";
  $("whatsappModal").hidden = false;
}

function closeWhatsAppShareModal() {
  $("whatsappModal").hidden = true;
}

/* ---------- 8. Theme & Init ---------- */
function applyTheme(mode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.classList.toggle("light", mode === "light");
  try { localStorage.setItem("tahsil-theme", mode); } catch (e) {}
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("tahsil-theme"); } catch (e) {}
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

// تصدير الدوال التفاعلية عالمياً
window.openResponseModal = openResponseModal;
window.closeResponseModal = closeResponseModal;
window.openQuickPayModal = openQuickPayModal;
window.closeQuickPayModal = closeQuickPayModal;
window.openWhatsAppShareModal = openWhatsAppShareModal;
window.closeWhatsAppShareModal = closeWhatsAppShareModal;
window.setCollectorTab = setCollectorTab;
window.copyCollectorSummaryReport = copyCollectorSummaryReport;
window.switchView = switchView;

/* ---------- Global Bootstrap ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  document.addEventListener("click", onTableClick);

  $("themeBtn").addEventListener("click", () => {
    const isDark = document.documentElement.classList.contains("dark");
    applyTheme(isDark ? "light" : "dark");
    toast(isDark ? "الوضع النهاري" : "الوضع الليلي", isDark ? "تم تفعيل الوضع النهاري" : "تم تفعيل الوضع الليلي", "pay");
  });

  $("dateToday").textContent = todayStr();
  document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));

  window.addEventListener("hashchange", () => {
    const name = location.hash.replace("#", "");
    const views = ["dashboard", "route", "collectors", "cashflow", "cycle"];
    if (views.includes(name)) switchView(name, true);
  });

  $("menuBtn").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  $("refreshBtn").addEventListener("click", () => fetchData());
  $("modalClose").addEventListener("click", closeModal);
  $("modalSilence").addEventListener("click", () => { closeModal(); state.soundOn = false; $("soundBtn").classList.add("muted"); });
  $("paymentModal").addEventListener("click", (e) => { if (e.target === $("paymentModal")) closeModal(); });

  $("soundBtn").addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    $("soundBtn").classList.toggle("muted", !state.soundOn);
  });

  $("bellBtn").addEventListener("click", () => {
    if ("Notification" in window) {
      if (Notification.permission === "default") Notification.requestPermission();
      toast("إشعارات المتصفح", Notification.permission === "granted" ? "مفعّلة — سيصلك تنبيه عند أي سداد جديد" : "مسموح بها بعد الموافقة", "pay");
    } else toast("غير مدعوم", "المتصفح لا يدعم الإشعارات", "warn");
  });

  $("brandLogo").addEventListener("click", () => switchView("dashboard"));

  // ربط أزرار مودال الردود السريعة
  $("respModalCloseBtn").addEventListener("click", closeResponseModal);
  $("respModalCancel").addEventListener("click", closeResponseModal);
  $("responseModal").addEventListener("click", (e) => { if (e.target === $("responseModal")) closeResponseModal(); });

  document.querySelectorAll("#respPresetChips .chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      const input = $("respModalInput");
      input.value = preset;
      input.focus();
    });
  });

  $("respModalSave").addEventListener("click", () => {
    const cust = state.activeEditingCustomer;
    if (!cust) return closeResponseModal();
    const text = $("respModalInput").value.trim();
    const comm = $("respModalComm").value;

    const item = (state.interactiveRoute || []).find((x) => x.customer === cust);
    if (item) {
      item.response = text;
      item.comm = comm;
      if (comm === "لم يذهب إليه المحصل") item.notVisited = true;
      else if (item.notVisited && comm !== "لم يتم التواصل") item.notVisited = false;
      item.updatedAt = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
      saveInteractiveRoute();
    }

    // تحديث في route_line إن وجد
    if (state.data && state.data.route_line) {
      const rl = state.data.route_line.find((r) => r.customer === cust);
      if (rl) rl.last_response = text;
    }

    toast("تم الحفظ ✓", `تم تحديث رد العميل ${cust} بنجاح`, "pay");
    closeResponseModal();
    if (state.view === "route") viewRoute();
    else if (state.view === "collectors") viewCollectors();
  });

  // ربط مودال السداد السريع
  $("quickPayCloseBtn").addEventListener("click", closeQuickPayModal);
  $("quickPayCancel").addEventListener("click", closeQuickPayModal);
  $("quickPayModal").addEventListener("click", (e) => { if (e.target === $("quickPayModal")) closeQuickPayModal(); });

  $("quickPayForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const customer = $("quickPayForm").dataset.customer;
    const amount = Number($("quickPayAmountInput").value);
    const collector = $("quickPayCollectorSelect").value;
    if (!customer || !amount || amount <= 0) return toast("تنبيه", "أدخل مبلغاً صحيحاً", "warn");

    addManualPay(customer, amount, collector);
    toast("سداد جديد ✓", `تم تسجيل ${money(amount)} للعميل ${customer} تحت ${collector}`, "pay");
    closeQuickPayModal();
    if (state.view === "route") viewRoute();
    else if (state.view === "collectors") viewCollectors();
  });

  // ربط مودال الواتساب
  $("waModalCloseBtn").addEventListener("click", closeWhatsAppShareModal);
  $("waModalClose").addEventListener("click", closeWhatsAppShareModal);
  $("whatsappModal").addEventListener("click", (e) => { if (e.target === $("whatsappModal")) closeWhatsAppShareModal(); });

  $("waModalCopy").addEventListener("click", () => {
    const text = $("waModalText").value;
    navigator.clipboard.writeText(text).then(() => {
      $("waCopyAlert").style.opacity = "1";
      setTimeout(() => { $("waCopyAlert").style.opacity = "0"; }, 3000);
      toast("تم النسخ", "تم نسخ نص خط السير إلى الحافظة بنجاح", "pay");
    }).catch(() => {
      $("waModalText").select();
      document.execCommand("copy");
      toast("تم النسخ", "تم نسخ نص خط السير إلى الحافظة", "pay");
    });
  });

  const initHash = location.hash.replace("#", "");
  const views = ["dashboard", "route", "collectors", "cashflow", "cycle"];
  if (views.includes(initHash)) switchView(initHash, true);

  fetchData();
  setInterval(() => fetchData(true), POLL_MS);
});