/* ============ تحصيل: app.js — شيت إكسل تفاعلي مباشر، تقييم المحصلين، ومزامنة الواتساب ============ */
"use strict";

const DATA_URL = "data/data.json";
const POLL_MS = 30000;
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
  if (parts.length === 3) return `${Number(parts[2])}/${Number(parts[1])}/${parts[0]}`;
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
  alertSound("pay");
  return p;
}

/* ---------- إدارة خط السير التفاعلي كشيت إكسل مباشر ---------- */
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

  const d = state.data;
  const targets = d.daily_targets || [];
  const routeLines = d.route_line || [];
  const ratingMap = new Map(routeLines.map((r) => [r.customer, r]));
  const masterMap = new Map((d.master || []).map((m) => [m.name, m]));

  const routeList = [];
  const addedNames = new Set();

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
    });
  });

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
      });
    });
  });

  // مزامنة السدادات المسجلة اليوم
  const todayPays = manualToday();
  todayPays.forEach((p) => {
    const item = routeList.find((x) => x.customer === p.customer);
    if (item) {
      item.paid = (Number(item.paid) || 0) + p.amount;
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
  const responseRate = contactedCount > 0 ? (responsiveCount / contactedCount) * 100 : 0;

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
  return { dashboard: viewDashboard, route: viewRoute, collectors: viewCollectors, responses: viewResponses, cashflow: viewCashflow, cycle: viewCycle }[name];
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

/* ---------- Data Fetching ---------- */
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
  setTimeout(() => el.remove(), 6000);
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
  setTimeout(() => el.remove(), 4000);
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
  const titles = { dashboard: "لوحة التحكم", route: "خط سير اليوم", collectors: "تقييم المحصلين", responses: "ردود العملاء", cashflow: "التدفق النقدي", cycle: "عملاء بالدورة" };
  $("pageTitle").textContent = titles[name] || "لوحة التحكم";
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
  if (force || !state.data) return;
  const fns = { dashboard: viewDashboard, route: viewRoute, collectors: viewCollectors, responses: viewResponses, cashflow: viewCashflow, cycle: viewCycle };
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
      ${kp("أهداف اليوم (خط السير)", money(routeStats.totalDue), `${routeStats.totalCount} عميل — محصل ${money(routeStats.collected)}`, "c-accent")}
      ${kp("المتوقع اليوم — كاش فلو", money(expToday), "خطة السداد", "c-info")}
      ${kp("المُحصّل اليوم", money(colToday), `نسبة ${expToday ? Math.round(colToday / expToday * 100) : 0}% من المتوقع`, "c-success")}
      ${kp("سداد اليوم (قبض يدوي)", money(payToday), `${manualPays.length} عملية مسجلة`, "c-info")}
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-head">
          <span class="card-title">🎯 خط سير اليوم — إحصائيات سريعة</span>
          <button class="btn btn-ghost" onclick="switchView('route')" style="font-size:0.8rem;padding:4px 10px;">فتح شيت خط السير التفاعلي ➔</button>
        </div>
        ${(state.interactiveRoute || []).length ? `<div class="table-wrap"><table>
          <thead><tr>
            <th class="row-num">م</th>
            <th>العميل</th>
            <th>المحصل</th>
            <th>المبلغ المستحق</th>
            <th>المسدد</th>
            <th>الحالة</th>
          </tr></thead>
          <tbody>${(state.interactiveRoute || []).slice(0, 8).map((t, i) => `<tr>
            <td class="row-num">${i + 1}</td>
            <td><b>${esc(t.customer)}</b></td>
            <td>${esc(t.collector)}</td>
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

/* ---------- 2. ROUTE (شيت إكسل تفاعلي مباشر مع الإدخال الفوري) ---------- */
function viewRoute() {
  const d = state.data;
  if (!d) return;

  initInteractiveRouteIfNeeded();
  const allRoute = state.interactiveRoute || [];
  const master = d.master || [];
  const reps = ["مصطفى", "محمد شعبان"];

  const fRep = state.filters.routeRep || "all";
  const fStatus = state.filters.routeStatus || "all";
  const fSearch = (state.filters.routeSearch || "").trim().toLowerCase();

  let filtered = allRoute.filter((item) => {
    if (fRep !== "all" && item.collector !== fRep) return false;
    if (fStatus === "not_visited" && !item.notVisited && item.comm !== "لم يذهب إليه المحصل") return false;
    if (fStatus === "paid" && (!item.paid || item.paid <= 0)) return false;
    if (fStatus === "responsive" && item.comm !== "عميل مستجيب") return false;
    if (fStatus === "unresponsive" && item.comm !== "عميل غير مستجيب") return false;
    if (fSearch && !item.customer.toLowerCase().includes(fSearch) && !item.area.toLowerCase().includes(fSearch)) return false;
    return true;
  });

  filtered = sortArray(filtered, "route", (x, col) => {
    if (col === "response") return x.response || "";
    if (col === "paid") return x.paid || 0;
    if (col === "balance") return x.balance || 0;
    return x[col];
  });

  const repClients = fRep === "all" ? allRoute : allRoute.filter((x) => x.collector === fRep);
  const stats = calculateRouteStats(repClients);

  $("view-route").innerHTML = `
    <!-- شريط التحكم السريع لخط السير -->
    <div class="sheet-top-controls">
      <div class="quick-add-bar">
        <span style="font-weight:800; font-size:0.85rem; color:var(--primary);">➕ إضافة عميل للشيت:</span>
        <input id="quickAddInput" class="search-input" list="masterClientsDataList" placeholder="اكتب أو اختر اسم العميل من Master Data…" style="min-width:260px; padding:6px 12px; font-size:0.85rem;">
        <datalist id="masterClientsDataList">
          ${master.map((m) => `<option value="${esc(m.name)}">${esc(m.name)} — ${esc(m.area)} (${money(m.balance)})</option>`).join("")}
        </datalist>
        <select id="quickAddRep" class="select" style="padding:6px 10px; font-size:0.85rem;">
          ${reps.map((r) => `<option value="${esc(r)}" ${fRep === r ? "selected" : ""}>${esc(r)}</option>`).join("")}
        </select>
        <button type="button" id="quickAddBtn" class="btn btn-primary" style="padding:6px 14px; font-size:0.82rem;">إضافة ＋</button>
      </div>

      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <button type="button" id="waRouteCopyBtn" class="btn-wa" title="نسخ رسالة خط السير لإرسالها للمحصل عبر الواتساب">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c4.54 0 8.24 3.7 8.24 8.24 0 2.2-.86 4.27-2.42 5.82-1.55 1.56-3.62 2.42-5.82 2.42-1.45 0-2.88-.38-4.14-1.11l-.3-.17-3.08.81.82-3-.2-.31a8.18 8.18 0 0 1-1.26-4.46c0-4.54 3.7-8.24 8.24-8.24m4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.24-.74-.66-1.24-1.48-1.39-1.73-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.44.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.44-.06-.13-.56-1.34-.76-1.84-.2-.49-.4-.42-.56-.43h-.47c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.24.9 2.44 1.03 2.61.13.17 1.77 2.71 4.3 3.8 2.53 1.09 2.53.73 2.98.69.46-.04 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.23-.17-.48-.29"/></svg>
          نسخ للواتساب 📋
        </button>
        <button type="button" id="resetRouteSheetBtn" class="clear-sort" title="استعادة خط السير من الشيت الأصلي">↺ استعادة المقترح</button>
      </div>
    </div>

    <!-- فلاتر التبويب والبحث -->
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:var(--space-3);">
      <div class="seg" id="routeRepTabSeg">
        <button data-f="all" class="${fRep === "all" ? "active" : ""}">كل المحصلين (${allRoute.length})</button>
        ${reps.map((r) => `<button data-f="${esc(r)}" class="${fRep === r ? "active" : ""}">${esc(r)} (${allRoute.filter((x) => x.collector === r).length})</button>`).join("")}
      </div>

      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <input class="search-input" id="routeSheetSearchInput" placeholder="🔍 بحث في الجدول بالاسم أو المنطقة…" value="${esc(state.filters.routeSearch || "")}" style="padding:6px 12px; min-width:210px; font-size:0.85rem;">
        <select id="routeSheetStatusSelect" class="select" style="padding:6px 10px; font-size:0.85rem;">
          <option value="all" ${fStatus === "all" ? "selected" : ""}>كل الحالات</option>
          <option value="not_visited" ${fStatus === "not_visited" ? "selected" : ""}>❌ لم يذهب إليهم (${allRoute.filter((x) => x.notVisited || x.comm === "لم يذهب إليه المحصل").length})</option>
          <option value="paid" ${fStatus === "paid" ? "selected" : ""}>💰 تم السداد (${allRoute.filter((x) => x.paid > 0).length})</option>
          <option value="responsive" ${fStatus === "responsive" ? "selected" : ""}>✅ عميل مستجيب (${allRoute.filter((x) => x.comm === "عميل مستجيب").length})</option>
          <option value="unresponsive" ${fStatus === "unresponsive" ? "selected" : ""}>⚠️ عميل غير مستجيب (${allRoute.filter((x) => x.comm === "عميل غير مستجيب").length})</option>
        </select>
        ${clearSortBtn("route")}
      </div>
    </div>

    <!-- التخطيط العام: جدول إحصائيات الإكسل الجانبي + شيت الجدول التفاعلي المباشر -->
    <div class="route-interactive-layout">
      <!-- 1. لوحة إحصائيات الإكسل المطابقة للصورة الأصلية تماماً -->
      <div class="excel-stat-card">
        <div class="excel-stat-header">
          <span>📊 ملخص الإكسل</span>
          <span style="font-size:0.75rem; opacity:0.75;">${fRep === "all" ? "إجمالي الشيت" : fRep}</span>
        </div>

        <table class="excel-matrix">
          <tbody>
            <tr class="row-req">
              <td class="val" id="stat-totalDue">${fmt(stats.totalDue)}</td>
              <td class="lbl">اجمالي المطلوب</td>
            </tr>
            <tr class="row-col">
              <td class="val" id="stat-collected" style="color:#2E7D32;">${fmt(stats.collected)}</td>
              <td class="lbl">المحصل</td>
            </tr>
            <tr class="row-rem">
              <td class="val" id="stat-remaining" style="color:#C62828;">${fmt(stats.remaining)}</td>
              <td class="lbl">الباقي</td>
            </tr>
            <tr class="row-rate">
              <td class="val" id="stat-collectionRate" style="color:#1B5E20;">${stats.collectionRate.toFixed(2)}%</td>
              <td class="lbl">نسبة التحصيل</td>
            </tr>
            <tr class="row-comm">
              <td class="val" id="stat-contactedCount">${stats.contactedCount}</td>
              <td class="lbl">تم التواصل</td>
            </tr>
            <tr class="row-resp">
              <td class="val" id="stat-responsiveCount" style="color:#2E7D32;">${stats.responsiveCount}</td>
              <td class="lbl">عميل مستجيب</td>
            </tr>
            <tr class="row-unresp">
              <td class="val" id="stat-unresponsiveCount" style="color:#E65100;">${stats.unresponsiveCount}</td>
              <td class="lbl">عميل غير مستجيب</td>
            </tr>
            <tr class="row-resprate">
              <td class="val" id="stat-responseRate" style="color:#0D47A1;">${stats.responseRate.toFixed(2)}%</td>
              <td class="lbl">نسبة الاستجابة</td>
            </tr>
            <tr class="row-notcomm">
              <td class="val" id="stat-notContactedCount" style="color:#B71C1C;">${stats.notContactedCount}</td>
              <td class="lbl">لم يتم التواصل</td>
            </tr>
          </tbody>
        </table>

        <div style="margin-top:12px; font-size:0.72rem; opacity:0.75; line-height:1.4; text-align:center;">
          ✏️ يمكنك تعديل المسدد، الحالة، التواصل، والرد مباشرة في خلايا الجدول، ويتم الحفظ وإعادة الحساب فورياً.
        </div>
      </div>

      <!-- 2. جدول الإكسل التفاعلي المطابق لأعمدة شيت الإكسل بالصورة -->
      <div class="excel-sheet-card">
        <div class="table-wrap">
          <table class="excel-sheet-table" id="excelMainTable">
            <thead>
              <tr>
                <th style="width:36px;">م</th>
                ${sortTh("route", "customer", "str", "العميل")}
                ${sortTh("route", "balance", "num", "المبلغ المستحق")}
                ${sortTh("route", "paid", "num", "المسدد")}
                ${sortTh("route", "status", "str", "الحالة")}
                ${sortTh("route", "comm", "str", "التواصل")}
                ${sortTh("route", "response", "str", "الرد (رد العميل الوارد)")}
                <th style="width:50px; text-align:center;" title="تعليم العميل كـ 'لم يذهب إليه المحصل'">لم يذهب</th>
                <th style="width:36px; text-align:center;">حذف</th>
              </tr>
            </thead>
            <tbody id="excelSheetBody">
              ${filtered.length ? filtered.map((c, idx) => {
                const isNotVisited = c.notVisited || c.comm === "لم يذهب إليه المحصل";
                const isPaid = c.paid > 0;
                const rowClass = isNotVisited ? "row-flagged-not-visited" : isPaid ? "row-flagged-paid" : "";

                return `
                  <tr class="${rowClass}" data-customer="${esc(c.customer)}">
                    <!-- م -->
                    <td class="row-num" style="text-align:center; font-weight:700; color:var(--muted-text,#8a94a6);">${idx + 1}</td>

                    <!-- العميل -->
                    <td style="min-width:180px;">
                      <div style="font-weight:800; font-size:0.9rem;">${esc(c.customer)}</div>
                      <div style="display:flex; gap:6px; align-items:center; margin-top:2px;">
                        <span style="font-size:0.72rem; opacity:0.7;">📍 ${esc(c.area || "—")}</span>
                        <select class="cell-rep-badge" data-inline="change-rep" data-customer="${esc(c.customer)}" title="نقل العميل لمحصل آخر">
                          ${reps.map((r) => `<option value="${esc(r)}" ${c.collector === r ? "selected" : ""}>${esc(r)}</option>`).join("")}
                        </select>
                      </div>
                    </td>

                    <!-- المبلغ المستحق -->
                    <td class="tbl-amount neg" style="text-align:end; font-size:0.92rem; padding-inline-end:10px; font-weight:800; white-space:nowrap;">
                      ${fmt(c.balance)}
                    </td>

                    <!-- المسدد (إدخال مباشر في الخلية) -->
                    <td style="width:110px; text-align:end;">
                      <input type="number" class="cell-input-money" data-inline="edit-paid" data-customer="${esc(c.customer)}" value="${c.paid || ""}" placeholder="0" min="0" step="any" title="اكتب المبلغ المسدد مباشرة هنا">
                    </td>

                    <!-- الحالة (قائمة منسدلة مباشرة في الخلية) -->
                    <td style="width:110px;">
                      <select class="cell-select" data-inline="edit-status" data-customer="${esc(c.customer)}">
                        <option value="لم يسدد" ${c.status === "لم يسدد" ? "selected" : ""}>لم يسدد</option>
                        <option value="سداد جزئي" ${c.status === "سداد جزئي" ? "selected" : ""}>سداد جزئي</option>
                        <option value="خالص" ${c.status === "خالص" ? "selected" : ""}>خالص ✅</option>
                        <option value="مؤجل" ${c.status === "مؤجل" ? "selected" : ""}>مؤجل ⏱️</option>
                        <option value="تم الاتفاق" ${c.status === "تم الاتفاق" ? "selected" : ""}>تم الاتفاق</option>
                      </select>
                    </td>

                    <!-- التواصل (قائمة منسدلة مباشرة في الخلية) -->
                    <td style="min-width:145px;">
                      <select class="cell-select" data-inline="edit-comm" data-customer="${esc(c.customer)}">
                        <option value="لم يتم التواصل" ${c.comm === "لم يتم التواصل" ? "selected" : ""}>لم يتم التواصل</option>
                        <option value="تم التواصل" ${c.comm === "تم التواصل" ? "selected" : ""}>تم التواصل</option>
                        <option value="عميل مستجيب" class="comm-opt-responsive" ${c.comm === "عميل مستجيب" ? "selected" : ""}>عميل مستجيب ✅</option>
                        <option value="عميل غير مستجيب" class="comm-opt-unresponsive" ${c.comm === "عميل غير مستجيب" ? "selected" : ""}>عميل غير مستجيب ⚠️</option>
                        <option value="لم يذهب إليه المحصل" class="comm-opt-not-visited" ${c.comm === "لم يذهب إليه المحصل" ? "selected" : ""}>لم يذهب إليه المحصل ❌</option>
                      </select>
                    </td>

                    <!-- الرد (إدخال ولصق مباشر في الخلية) -->
                    <td style="min-width:240px;">
                      <input type="text" class="cell-input-text" data-inline="edit-response" data-customer="${esc(c.customer)}" value="${esc(c.response || "")}" placeholder="الصق رد العميل من الواتساب هنا..." title="انقر للصق رد الواتس أو كتابة ملاحظة">
                    </td>

                    <!-- لم يذهب (خانة اختيار سريعة) -->
                    <td style="text-align:center;">
                      <label class="cell-not-visited-chk" title="تعليم أن المحصل لم يذهب لهذا العميل اليوم">
                        <input type="checkbox" data-inline="chk-not-visited" data-customer="${esc(c.customer)}" ${isNotVisited ? "checked" : ""}>
                      </label>
                    </td>

                    <!-- حذف السطر -->
                    <td style="text-align:center;">
                      <button type="button" class="cell-del-btn" data-inline="delete-row" data-customer="${esc(c.customer)}" title="إزالة العميل من شيت اليوم">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                      </button>
                    </td>
                  </tr>`;
              }).join("") : `<tr><td colspan="9" class="empty-state">لا يوجد عملاء مطابقون لهذا الفلتر</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  bindExcelSheetEvents();
}

/* ---------- ربط أحداث الإدخال المباشر في خلايا الإكسل ---------- */
function bindExcelSheetEvents() {
  // تصفية المحصلين Tabs
  document.querySelectorAll("#routeRepTabSeg button").forEach((b) => {
    b.addEventListener("click", () => {
      state.filters.routeRep = b.dataset.f;
      viewRoute();
    });
  });

  // تصفية الحالة والبحث السريع
  const statusSel = $("routeSheetStatusSelect");
  if (statusSel) {
    statusSel.addEventListener("change", (e) => {
      state.filters.routeStatus = e.target.value;
      viewRoute();
    });
  }
  const searchInput = $("routeSheetSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.filters.routeSearch = e.target.value;
      viewRoute();
    });
  }

  // إضافة عميل سريع
  const addBtn = $("quickAddBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const custInput = $("quickAddInput");
      const repInput = $("quickAddRep");
      const name = (custInput.value || "").trim();
      const rep = repInput.value;
      if (!name) return toast("تنبيه", "اكتب أو اختر اسم العميل أولاً", "warn");

      const master = (state.data && state.data.master) || [];
      const match = master.find((m) => m.name === name || m.name.includes(name));
      const customerName = match ? match.name : name;
      const bal = match ? Number(match.balance) || 0 : 0;
      const area = match ? match.area : "—";

      const existing = (state.interactiveRoute || []).find((x) => x.customer === customerName);
      if (existing) {
        existing.collector = rep;
        toast("تم التحديث", `العميل موجود بالفعل وتم تعيينه للمحصل ${rep}`, "pay");
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
        });
        toast("تمت الإضافة ✓", `تمت إضافة ${customerName} لشيت ${rep}`, "pay");
      }

      saveInteractiveRoute();
      custInput.value = "";
      viewRoute();
    });
  }

  // نسخ خط السير للواتساب
  const waBtn = $("waRouteCopyBtn");
  if (waBtn) {
    waBtn.addEventListener("click", () => {
      openWhatsAppShareModal(state.filters.routeRep || "all");
    });
  }

  // استعادة المقترح
  const resetBtn = $("resetRouteSheetBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (confirm("هل تريد استعادة بيانات خط السير الأصلية من الشيت؟")) {
        localStorage.removeItem(getRouteStorageKey());
        state.interactiveRoute = null;
        initInteractiveRouteIfNeeded();
        toast("تمت الاستعادة", "تمت استعادة خط السير الأصلي من الشيت", "pay");
        viewRoute();
      }
    });
  }

  // تفويض أحداث الخلايا المباشرة (Inline Cell Inputs)
  const table = $("excelMainTable");
  if (table) {
    // 1. إعادة الحساب اللحظي عند الكتابة في خانة المسدد
    table.addEventListener("input", (e) => {
      const target = e.target;
      const inlineAction = target.dataset.inline;
      const customer = target.dataset.customer;
      if (!customer) return;

      const item = state.interactiveRoute.find((x) => x.customer === customer);
      if (!item) return;

      if (inlineAction === "edit-paid") {
        const val = Number(target.value) || 0;
        item.paid = val;
        if (item.paid >= item.balance && item.balance > 0) {
          item.status = "خالص";
        } else if (item.paid > 0) {
          item.status = "سداد جزئي";
        }
        // تحديث إحصائيات الإكسل في اللوحة الجانبية فورياً
        updateStatsBoxLive();
      } else if (inlineAction === "edit-response") {
        item.response = target.value;
        saveInteractiveRoute();
        // مزامنة مع route_line
        if (state.data && state.data.route_line) {
          const rl = state.data.route_line.find((r) => r.customer === customer);
          if (rl) rl.last_response = target.value;
        }
      }
    });

    // 2. الحفظ عند اكتمال التعديل (Change / Blur)
    table.addEventListener("change", (e) => {
      const target = e.target;
      const inlineAction = target.dataset.inline;
      const customer = target.dataset.customer;
      if (!customer) return;

      const item = state.interactiveRoute.find((x) => x.customer === customer);
      if (!item) return;

      if (inlineAction === "edit-paid") {
        const val = Number(target.value) || 0;
        item.paid = val;
        if (item.paid >= item.balance && item.balance > 0) item.status = "خالص";
        else if (item.paid > 0) item.status = "سداد جزئي";
        if (item.paid > 0 && (item.comm === "لم يتم التواصل" || item.comm === "لم يذهب إليه المحصل")) {
          item.comm = "عميل مستجيب";
          item.notVisited = false;
        }
        saveInteractiveRoute();
        addManualPay(customer, val, item.collector);
        viewRoute();
      } else if (inlineAction === "edit-status") {
        item.status = target.value;
        saveInteractiveRoute();
      } else if (inlineAction === "edit-comm") {
        item.comm = target.value;
        if (item.comm === "لم يذهب إليه المحصل") item.notVisited = true;
        else if (item.notVisited && item.comm !== "لم يتم التواصل") item.notVisited = false;
        saveInteractiveRoute();
        viewRoute();
      } else if (inlineAction === "chk-not-visited") {
        item.notVisited = target.checked;
        if (item.notVisited) item.comm = "لم يذهب إليه المحصل";
        else if (item.comm === "لم يذهب إليه المحصل") item.comm = "لم يتم التواصل";
        saveInteractiveRoute();
        viewRoute();
      } else if (inlineAction === "change-rep") {
        item.collector = target.value;
        saveInteractiveRoute();
        toast("نقل عميل", `تم نقل العميل ${customer} للمحصل ${item.collector}`, "pay");
        viewRoute();
      }
    });

    // 3. أزرار الحذف في السطر
    table.addEventListener("click", (e) => {
      const delBtn = e.target.closest("[data-inline='delete-row']");
      if (!delBtn) return;
      const customer = delBtn.dataset.customer;
      if (!customer) return;

      if (confirm(`هل تريد إزالة العميل "${customer}" من شيت اليوم؟`)) {
        state.interactiveRoute = state.interactiveRoute.filter((x) => x.customer !== customer);
        saveInteractiveRoute();
        toast("تم الحذف", `تمت إزالة ${customer} من الشيت`, "warn");
        viewRoute();
      }
    });
  }
}

function updateStatsBoxLive() {
  const fRep = state.filters.routeRep || "all";
  const all = state.interactiveRoute || [];
  const list = fRep === "all" ? all : all.filter((x) => x.collector === fRep);
  const s = calculateRouteStats(list);

  if ($("stat-totalDue")) $("stat-totalDue").textContent = fmt(s.totalDue);
  if ($("stat-collected")) $("stat-collected").textContent = fmt(s.collected);
  if ($("stat-remaining")) $("stat-remaining").textContent = fmt(s.remaining);
  if ($("stat-collectionRate")) $("stat-collectionRate").textContent = s.collectionRate.toFixed(2) + "%";
  if ($("stat-contactedCount")) $("stat-contactedCount").textContent = s.contactedCount;
  if ($("stat-responsiveCount")) $("stat-responsiveCount").textContent = s.responsiveCount;
  if ($("stat-unresponsiveCount")) $("stat-unresponsiveCount").textContent = s.unresponsiveCount;
  if ($("stat-responseRate")) $("stat-responseRate").textContent = s.responseRate.toFixed(2) + "%";
  if ($("stat-notContactedCount")) $("stat-notContactedCount").textContent = s.notContactedCount;
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

  const cards = reps.map((rep) => {
    const repRouteClients = allRoute.filter((c) => c.collector === rep);
    const repStats = calculateRouteStats(repRouteClients);

    const cfRep = cf.filter((c) => repOf.get(c.customer) === rep);
    const expCol = cfRep.reduce((s, c) => s + c.expected, 0) || repStats.totalDue;
    const colCol = cfRep.reduce((s, c) => s + c.collected, 0);
    const repPays = manualToday(rep);
    const repManual = repPays.reduce((s, p) => s + p.amount, 0);
    const effCol = colCol + repManual + repStats.collected;
    const pct = expCol > 0 ? Math.round((effCol / expCol) * 100) : 0;
    const pctColor = pct >= 80 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--danger)";

    return `
      <div class="card collector-card">
        <div class="col-head">
          <div class="col-avatar">${esc(rep.substring(0, 1))}</div>
          <div style="flex:1;">
            <div class="col-name">${esc(rep)}</div>
            <div class="col-role">محصل ميداني — متابعة حية لليوم</div>
          </div>
          <button type="button" class="btn-wa" onclick="openWhatsAppShareModal('${esc(rep)}')" style="font-size:0.75rem; padding:5px 10px;">
            💬 إرسال خط السير
          </button>
        </div>

        <div class="collector-progress">
          <div class="prog-head">
            <span>الإنجاز والتحصيل الفعلي اليوم</span>
            <b>${pct}%</b>
          </div>
          <div class="prog-track"><div class="prog-fill" style="width:${Math.min(100, pct)}%;background:${pctColor}"></div></div>
          <div class="prog-sub">تم تحصيل ${money(effCol)} من أصل ${money(expCol)} مطلوب</div>
        </div>

        <div class="col-stats">
          <div class="col-stat">
            <b>${repStats.totalCount} عميل</b>
            <span>مكلف بهم اليوم</span>
          </div>
          <div class="col-stat">
            <b class="pos">${money(repStats.collected)}</b>
            <span>مُحصّل اليوم (${repStats.collectionRate.toFixed(1)}%)</span>
          </div>
          <div class="col-stat">
            <b style="color:var(--info)">${repStats.contactedCount}</b>
            <span>تم التواصل / الزيارة</span>
          </div>
          <div class="col-stat">
            <b style="color:var(--danger)">${repStats.notVisitedCount}</b>
            <span>لم يذهب إليهم ❌</span>
          </div>
          <div class="col-stat">
            <b style="color:var(--success)">${repStats.responsiveCount}</b>
            <span>عميل مستجيب (${repStats.responseRate.toFixed(1)}%)</span>
          </div>
          <div class="col-stat">
            <b style="color:var(--warning)">${repStats.unresponsiveCount}</b>
            <span>غير مستجيب</span>
          </div>
        </div>

        <div style="margin-top:16px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:800; font-size:0.88rem;">📋 تفاصيل عملاء خط السير والتفاعل:</span>
          <span style="font-size:0.75rem; opacity:0.7;">${repRouteClients.length} عميل</span>
        </div>

        <div class="mini-feed" style="margin-top:10px; max-height:220px; overflow-y:auto;">
          ${repRouteClients.length ? repRouteClients.map((c) => {
            const isDone = c.paid > 0;
            const isNotVisited = c.notVisited || c.comm === "لم يذهب إليه المحصل";
            return `
              <div class="mini-item" style="border-right: 3px solid ${isDone ? "var(--success)" : isNotVisited ? "var(--danger)" : "var(--border)"}">
                <div style="flex:1; min-width:0;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:700;">${esc(c.customer)}</span>
                    <b class="${isDone ? "pos" : "neg"}">${isDone ? "+" + money(c.paid) : money(c.balance)}</b>
                  </div>
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px; font-size:0.72rem;">
                    <span style="opacity:0.8;">${c.response ? "💬 " + esc(c.response) : `<i style="opacity:0.5;">${esc(c.comm)}</i>`}</span>
                    <span class="chip ${isDone ? "chip-green" : isNotVisited ? "chip-red" : "chip-gray"}" style="padding:1px 6px; font-size:0.65rem;">${esc(c.comm)}</span>
                  </div>
                </div>
              </div>`;
          }).join("") : `<div class="mini-item muted">لا يوجد عملاء مخصصون للمحصل في خط السير اليوم</div>`}
        </div>

        <div style="margin-top:14px; font-weight:800; font-size:0.85rem;">سداد اليوم المسجل:</div>
        <div class="mini-feed" style="margin-top:6px;">
          ${repPays.slice().reverse().slice(0, 4).map((p) => `
            <div class="mini-item">
              <span>${esc(p.customer)}</span>
              <b class="pos">+${money(p.amount)}</b>
              <em>${esc(p.time)}</em>
            </div>`).join("") || '<div class="mini-item muted">لا توجد سدادات جديدة مسجلة</div>'}
        </div>
      </div>
    `;
  }).join("");

  const allRates = (d.route_line || []).filter((r) => r.rating);
  const rows = allRates.map((r) => {
    const m = master.find((x) => x.name === r.customer);
    return { r, rep: m ? m.collector : "" };
  }).sort((a, b) => (RATE_ORDER[a.r.rating] ?? 0) - (RATE_ORDER[b.r.rating] ?? 0));

  $("view-collectors").innerHTML = `
    <div class="collector-grid">${cards}</div>

    <div class="card">
      <div class="card-head">
        <span class="card-title">تقييم العملاء التاريخي — من الأخطر للأفضل (خط سير)</span>
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

/* ---------- 4. RESPONSES (ردود العملاء) ---------- */
function viewResponses() {
  const d = state.data;
  const rows = (d.route_line || []).filter((r) => r.last_response).slice();

  if (state.interactiveRoute) {
    state.interactiveRoute.forEach((ir) => {
      if (ir.response) {
        const found = rows.find((r) => r.customer === ir.customer);
        if (found) {
          found.last_response = ir.response;
        } else {
          rows.unshift({
            customer: ir.customer,
            area: ir.area,
            target_debt: ir.balance,
            last_payment: ir.last_payment,
            last_invoice: "",
            last_response: ir.response,
          });
        }
      }
    });
  }

  const byArea = [...new Set(rows.map((r) => r.area).filter(Boolean))];
  $("view-responses").innerHTML = `
    <div class="card">
      <div class="card-head"><span class="card-title">آخر ردود العملاء — ${rows.length} رد</span>
        <div class="filters">
          <input class="search-input" id="respSearch" placeholder="ابحث باسم عميل…" value="${esc(state.filters.respSearch || "")}">
          <select class="select" id="respArea"><option value="">كل المناطق</option>${byArea.map((a) => `<option ${state.filters.respArea === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
        </div>
        ${clearSortBtn("resp")}
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th class="row-num">م</th>
          ${sortTh("resp", "customer", "str", "العميل")}
          ${sortTh("resp", "area", "str", "المنطقة")}
          ${sortTh("resp", "target_debt", "num", "المديونية المستهدفة")}
          ${sortTh("resp", "last_payment", "date", "آخر سداد")}
          ${sortTh("resp", "last_invoice", "date", "آخر فاتورة")}
          ${sortTh("resp", "last_response", "str", "آخر رد من العميل")}
        </tr></thead>
        <tbody id="respBody"></tbody></table></div>
    </div>`;

  const draw = () => {
    const q = $("respSearch").value.trim();
    const area = $("respArea").value;
    state.filters.respSearch = q;
    state.filters.respArea = area;
    let list = rows.filter((r) => (!q || r.customer.includes(q)) && (!area || r.area === area));
    list = sortArray(list, "resp");
    $("respBody").innerHTML = list.map((r, i) => `<tr>
      <td class="row-num">${i + 1}</td>
      <td><b>${esc(r.customer)}</b></td>
      <td>${esc(r.area || "—")}</td>
      <td class="tbl-amount neg">${money(r.target_debt)}</td>
      <td>${dueLabel(r.last_payment)}</td>
      <td>${dueLabel(r.last_invoice)}</td>
      <td class="note-text"><span class="chip chip-amber">رد العميل</span> ${esc(r.last_response)}</td>
    </tr>`).join("") || '<tr><td colspan="7" class="empty-state">لا نتائج مطابقة</td></tr>';
  };
  $("respSearch").addEventListener("input", draw);
  $("respArea").addEventListener("change", draw);
  draw();
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
  const cashRow = (c, i) => `<tr>
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
      return `<tr>
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

/* ---------- 7. WhatsApp Share Modal ---------- */
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
    if (c.response) text += `   📝 رد سابق: ${c.response}\n`;
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
    const views = ["dashboard", "route", "collectors", "responses", "cashflow", "cycle"];
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
  const views = ["dashboard", "route", "collectors", "responses", "cashflow", "cycle"];
  if (views.includes(initHash)) switchView(initHash, true);

  fetchData();
  setInterval(() => fetchData(true), POLL_MS);
});