/* ============ تحصيل: app.js — لوحة التحكم، خط السير، التنبيهات، المزامنة اللايف ============ */
"use strict";

const DATA_URL = "data/data.json";
const POLL_MS = 30000;
const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const fmt = (n) => (n ?? 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 });
const money = (n) => fmt(n) + " ج.م";

const state = { data: null, view: "dashboard", paySeen: new Set(), invSeen: new Set(), soundOn: true, bellBusy: false };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function todayStr() {
  const d = new Date();
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function dueLabel(due) {
  if (!due) return "—";
  const [y, m, day] = due.split("-").map(Number);
  const dt = new Date(y, m - 1, day);
  return `${dt.getDate()} ${AR_MONTHS[dt.getMonth()]}`;
}
function daysTo(due) {
  if (!due) return null;
  const [y, m, d] = due.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

/* ---------- Syncing ---------- */
async function fetchData(quiet) {
  try {
    const r = await fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const json = await r.json();
    const changed = state.data ? detectChanges(json) : false;
    state.data = json;
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

/* ---------- Change detection & ALERTS (سداد جديد) ---------- */
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
  // أول تشغيل: لا تنبيهات — فقط خزن
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
        n.onclick = () => { window.focus(); switchView("ledger"); };
      } catch (e) { /* ignore */ }
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
  } catch (e) { /* sound blocked */ }
}

/* ---------- Toast & Modal ---------- */
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
  if (a.type === "pay") {
    el.addEventListener("click", (e) => { if (e.target.classList.contains("toast-close")) return; switchView("ledger"); });
  }
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
  setTimeout(() => el.remove(), 6000);
}

/* ---------- Views ---------- */
function render() {
  if (!state.data) return;
  const d = state.data;
  $("dateToday").textContent = todayStr();
  const targets = d.daily_targets || [];
  $("navRouteCount").hidden = targets.length === 0;
  $("navRouteCount").textContent = targets.length;
  switchView(state.view, true);
}

function switchView(name, force) {
  state.view = name;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const titles = { dashboard: "لوحة التحكم", route: "خط سير اليوم", collectors: "تقييم المحصلين", responses: "ردود العملاء", cashflow: "التدفق النقدي", ledger: "سجل السداد والفواتير" };
  $("pageTitle").textContent = titles[name];
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
  if (force || !state.data) return;
  const fns = { dashboard: viewDashboard, route: viewRoute, collectors: viewCollectors, responses: viewResponses, cashflow: viewCashflow, ledger: viewLedger };
  fns[name]();
}

/* ---------- DASHBOARD ---------- */
function viewDashboard() {
  const d = state.data;
  const master = d.master || [];
  const cf = d.cash_flow || [];
  const pays = d.payments || [];
  const invs = d.invoices || [];
  const totalBal = master.reduce((s, m) => s + m.balance, 0);
  const active = master.filter((m) => m.status === "نشط");
  const activeBal = active.reduce((s, m) => s + m.balance, 0);
  const targets = d.daily_targets || [];
  const targetsMoney = targets.reduce((s, t) => s + t.balance, 0);
  const expToday = cf.reduce((s, c) => s + c.expected, 0);
  const colToday = cf.reduce((s, c) => s + c.collected, 0);
  const invToday = invs.reduce((s, i) => s + i.amount, 0);
  const payToday = pays.reduce((s, p) => s + p.amount, 0);
  const repBal = {};
  master.forEach((m) => { if (m.collector) repBal[m.collector] = (repBal[m.collector] || 0) + m.balance; });
  const repCount = {};
  active.forEach((m) => { if (m.collector) repCount[m.collector] = (repCount[m.collector] || 0) + 1; });
  const reps = d.route_line && d.route_line.length ? [...new Set((d.collector_follow || []).map((c) => c.area).filter(Boolean))] : [];
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
      ${kp("أهداف اليوم (خط سير)", money(targetsMoney), `${targets.length} عميل مستحق`, "c-accent")}
      ${kp("المتوقع اليوم — كاش فلو", money(expToday), "خطة السداد", "c-info")}
      ${kp("المُحصّل اليوم", money(colToday), `نسبة ${expToday ? Math.round(colToday / expToday * 100) : 0}% من المتوقع`, "c-success")}
      ${kp("سداد اليوم (قبض)", money(payToday), `فواتير اليوم: ${money(invToday)}`, "c-info")}
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-head"><span class="card-title">🎯 أهداف اليوم — خط السير</span>
          <div class="legend"><span><i style="background:var(--danger)"></i> مستحق اليوم</span></div>
        </div>
        ${targets.length ? `<div class="table-wrap"><table>
          <thead><tr><th>العميل</th><th>المحصل</th><th>المنطقة</th><th>الرصيد</th><th>آخر سداد</th><th>حالة</th></tr></thead>
          <tbody>${targets.slice(0, 14).map((t) => `<tr>
            <td>${esc(t.customer)}</td><td>${esc(t.collector)}</td><td>${esc(t.area)}</td>
            <td class="tbl-amount neg">${money(t.balance)}</td><td>${dueLabel(t.last_payment)}</td>
            <td><span class="chip chip-red">مستحق</span></td></tr>`).join("")}
          </tbody></table></div>` : `<div class="empty-state">✅ لا توجد أهداف اليوم</div>`}
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
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-head"><span class="card-title">💸 آخر السدادات (قبض)</span></div>
        <div class="feed">
          ${pays.slice().reverse().slice(-8).map((p) => `<div class="feed-item">
            <div class="feed-icon pay"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/></svg></div>
            <div class="feed-info"><div class="f-name">${esc(p.customer)}</div><div class="f-sub">${dueLabel(p.date)}</div></div>
            <div class="feed-amt pos">+${money(p.amount)}</div></div>`).join("") || '<div class="empty-state">لا توجد سدادات مسجلة</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">🧾 آخر الفواتير</span></div>
        <div class="feed">
          ${invs.slice().reverse().slice(-8).map((i) => `<div class="feed-item">
            <div class="feed-icon inv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg></div>
            <div class="feed-info"><div class="f-name">${esc(i.customer)}</div><div class="f-sub">فاتورة ${esc(i.num)} • ${dueLabel(i.date)}</div></div>
            <div class="feed-amt neg">${money(i.amount)}</div></div>`).join("") || '<div class="empty-state">لا توجد فواتير</div>'}
        </div>
      </div>
    </div>`;
}

/* ---------- ROUTE (خط سير اليوم) ---------- */
function viewRoute() {
  const d = state.data;
  const targets = (d.daily_targets || []).slice();
  const routeLines = d.route_line || [];
  const ratingOf = new Map(routeLines.map((r) => [r.customer, r]));
  const seg = document.createElement("div");
  seg.innerHTML = `<div class="card">
    <div class="card-head">
      <span class="card-title">برنامج النزول اليومي — ${targets.length} عميل مستحق</span>
      <div class="seg" id="routeSeg">
        <button data-f="all" class="active">الكل</button>
        <button data-f="مصطفى">مصطفى</button>
        <button data-f="عبد الرحمن">عبد الرحمن</button>
      </div>
    </div>
    <div id="routeList"></div>
  </div>`;
  $("view-route").innerHTML = seg.innerHTML;
  const applyFilter = (f) => {
    const items = targets.filter((t) => f === "all" || t.collector === f);
    const groups = new Map();
    items.forEach((t) => {
      const area = t.area || "بدون منطقة";
      if (!groups.has(area)) groups.set(area, []);
      groups.get(area).push(t);
    });
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    $("routeList").innerHTML = sorted.map(([area, list]) => `
      <div class="route-group">
        <div class="route-group-title"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.4-7-11a7 7 0 0 1 14 0c0 5.6-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>
          ${esc(area)} <span class="route-count">${list.length} عميل</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>العميل</th><th>الرصيد</th><th>آخر سداد</th><th>آخر زيارة</th><th>التصنيف</th><th>التقييم</th><th>آخر رد / ملاحظة</th></tr></thead>
          <tbody>${list.map((t) => {
            const rl = ratingOf.get(t.customer);
            const rating = rl ? rl.rating : "";
            const rChip = rating.includes("ممتاز") ? "chip-green" : rating.includes("جيد") ? "chip-blue" : rating.includes("سيء") ? "chip-amber" : "chip-red";
            return `<tr>
              <td><b>${esc(t.customer)}</b></td>
              <td class="tbl-amount neg">${money(t.balance)}</td>
              <td>${dueLabel(t.last_payment)}</td><td>${dueLabel(t.last_visit)}</td>
              <td><span class="chip chip-gray">${esc(t.classification || "—")}</span></td>
              <td>${rating ? `<span class="chip ${rChip}">${esc(rating)}</span>` : "—"}</td>
              <td class="note-text">${esc(rl ? rl.last_response : (t.notes || "—"))}</td></tr>`;}).join("")}
          </tbody></table></div>
      </div>`).join("") || '<div class="empty-state">لا توجد عملاء مستحقون في هذا الفلتر</div>';
    document.querySelectorAll("#routeSeg button").forEach((b) => b.classList.toggle("active", b.dataset.f === f));
  };
  document.querySelectorAll("#routeSeg button").forEach((b) => b.addEventListener("click", () => applyFilter(b.dataset.f)));
  applyFilter("all");
}

/* ---------- COLLECTORS (تقييم المحصلين) ---------- */
function viewCollectors() {
  const d = state.data;
  const master = d.master || [];
  const cf = d.cash_flow || [];
  const reps = ["مصطفى", "عبد الرحمن"];
  const cards = reps.map((rep) => {
    const clients = master.filter((m) => m.collector === rep);
    const active = clients.filter((m) => m.status === "نشط");
    const bal = clients.reduce((s, m) => s + m.balance, 0);
    const actBal = active.reduce((s, m) => s + m.balance, 0);
    const due = d.daily_targets.filter((t) => t.collector === rep);
    const dueBal = due.reduce((s, t) => s + t.balance, 0);
    const paid = master.filter((m) => m.collector === rep && m.status === "عميل خالص");
    const rates = (d.route_line || []).filter((r) => r.rating);
    const rateOf = new Map(rates.map((r) => [r.customer, r.rating]));
    const dist = { "ممتاز 🟢 (سريع الدوران)": 0, "جيد 🟡 (منتظم)": 0, "سيء ⚫ (بطيء جداً)": 0, "خطر 🔴 (متوقف/راكد)": 0 };
    clients.forEach((m) => { const r = rateOf.get(m.name); if (r && dist[r] !== undefined) dist[r]++; });
    const cfAll = cf.reduce((s, c) => s + c.expected, 0);
    const cfCol = cf.reduce((s, c) => s + c.collected, 0);
    return `<div class="card collector-card">
      <div class="col-head"><div class="col-avatar">${esc(rep.substring(0, 1))}</div>
        <div><div class="col-name">${esc(rep)}</div><div class="col-role">محصل ميداني</div></div>
      </div>
      <div class="col-stats">
        <div class="col-stat"><b>${money(bal)}</b><span>إجمالي المديونية</span></div>
        <div class="col-stat"><b>${money(actBal)}</b><span>مديونية نشطاء فقط</span></div>
        <div class="col-stat"><b>${clients.length}</b><span>إجمالي العملاء</span></div>
        <div class="col-stat"><b>${active.length}</b><span>عملاء نشطاء</span></div>
        <div class="col-stat"><b>${dueBal > 0 ? money(dueBal) : 0}</b><span>مستحق اليوم</span></div>
        <div class="col-stat"><b>${due.length}</b><span>عملاء اليوم</span></div>
      </div>
      <div style="margin-top:16px;font-weight:800;font-size:.9rem">تصنيف العملاء (خط سير)</div>
      <div class="rating-strip" style="margin-top:10px">
        <div class="rating-tile"><b style="color:var(--success)">${dist["ممتاز 🟢 (سريع الدوران)"]}</b>ممتاز سريع</div>
        <div class="rating-tile"><b style="color:var(--info)">${dist["جيد 🟡 (منتظم)"]}</b>جيد منتظم</div>
        <div class="rating-tile"><b style="color:var(--warning)">${dist["سيء ⚫ (بطيء جداً)"]}</b>سيء بطيء</div>
        <div class="rating-tile"><b style="color:var(--danger)">${dist["خطر 🔴 (متوقف/راكد)"]}</b>خطر راكد</div>
      </div>
    </div>`;
  }).join("");
  const allRates = (d.route_line || []).filter((r) => r.rating);
  const rateOrder = { "خطر 🔴 (متوقف/راكد)": 0, "سيء ⚫ (بطيء جداً)": 1, "جيد 🟡 (منتظم)": 2, "ممتاز 🟢 (سريع الدوران)": 3 };
  const rows = allRates.map((r) => {
    const m = master.find((x) => x.name === r.customer);
    return { r, rep: m ? m.collector : "" };
  }).sort((a, b) => (rateOrder[a.r.rating] ?? 0) - (rateOrder[b.r.rating] ?? 0));
  $("view-collectors").innerHTML = `
    <div class="collector-grid">${cards}</div>
    <div class="card">
      <div class="card-head"><span class="card-title">تقييم العملاء — مرتب من الأخطر للأفضل (خط سير)</span>
        <div class="legend"><span><i style="background:var(--danger)"></i>خطر</span><span><i style="background:var(--warning)"></i>سيء</span><span><i style="background:var(--info)"></i>جيد</span><span><i style="background:var(--success)"></i>ممتاز</span></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>العميل</th><th>المحصل</th><th>المنطقة</th><th>المديونية</th><th>معدل الدوران</th><th>التقييم</th><th>آخر رد</th></tr></thead>
        <tbody>${rows.map(({ r, rep }) => {
          const c = r.rating.includes("ممتاز") ? "chip-green" : r.rating.includes("جيد") ? "chip-blue" : r.rating.includes("سيء") ? "chip-amber" : "chip-red";
          const t = r.turnover && r.turnover !== "0" ? Number(r.turnover).toFixed(1) : "—";
          return `<tr><td><b>${esc(r.customer)}</b></td><td>${esc(rep || "—")}</td><td>${esc(r.area)}</td>
            <td class="tbl-amount neg">${money(r.target_debt)}</td><td>${t}</td>
            <td><span class="chip ${c}">${esc(r.rating)}</span></td>
            <td class="note-text">${esc(r.last_response || "—")}</td></tr>`;}).join("") || '<tr><td colspan="7" class="empty-state">لا توجد تقييمات</td></tr>'}
        </tbody></table></div>
    </div>`;
}

/* ---------- RESPONSES (ردود العملاء) ---------- */
function viewResponses() {
  const d = state.data;
  const rows = (d.route_line || []).filter((r) => r.last_response);
  const byArea = [...new Set(rows.map((r) => r.area).filter(Boolean))];
  $("view-responses").innerHTML = `
    <div class="card">
      <div class="card-head"><span class="card-title">آخر ردود العملاء — ${rows.length} رد</span>
        <div class="filters">
          <input class="search-input" id="respSearch" placeholder="ابحث باسم عميل…">
          <select class="select" id="respArea"><option value="">كل المناطق</option>${byArea.map((a) => `<option>${esc(a)}</option>`).join("")}</select>
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>العميل</th><th>المنطقة</th><th>المديونية المستهدفة</th><th>آخر سداد</th><th>آخر فاتورة</th><th>آخر رد من العميل</th></tr></thead>
        <tbody id="respBody"></tbody></table></div>
    </div>`;
  const draw = () => {
    const q = $("respSearch").value.trim();
    const area = $("respArea").value;
    const list = rows.filter((r) => (!q || r.customer.includes(q)) && (!area || r.area === area));
    $("respBody").innerHTML = list.map((r) => `<tr>
      <td><b>${esc(r.customer)}</b></td><td>${esc(r.area || "—")}</td>
      <td class="tbl-amount neg">${money(r.target_debt)}</td>
      <td>${dueLabel(r.last_payment)}</td><td>${dueLabel(r.last_invoice)}</td>
      <td class="note-text"><span class="chip chip-amber">رد العميل</span> ${esc(r.last_response)}</td></tr>`).join("") ||
      '<tr><td colspan="6" class="empty-state">لا نتائج مطابقة</td></tr>';
  };
  $("respSearch").addEventListener("input", draw);
  $("respArea").addEventListener("change", draw);
  draw();
}

/* ---------- CASHFLOW ---------- */
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
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>العميل</th><th>الرصيد</th><th>المتوقع</th><th>المحصّل</th><th>النسبة</th><th>موعد السداد</th><th>الحالة</th><th>المتبقي</th><th>ملاحظات</th></tr></thead>
        <tbody>${cf.map((c) => `<tr>
          <td><b>${esc(c.customer)}</b></td>
          <td class="tbl-amount">${money(c.balance)}</td>
          <td class="tbl-amount">${money(c.expected)}</td>
          <td class="tbl-amount ${c.collected ? "pos" : ""}">${money(c.collected)}</td>
          <td>${c.pay_ratio ? (Number(c.pay_ratio) * 100).toFixed(0) + "%" : "—"}</td>
          <td>${dueLabel(c.due)}</td>
          <td><span class="chip ${chipOf(c.pay_status)}">${statusOf(c.pay_status)}</span></td>
          <td class="tbl-amount ${c.remaining ? "neg" : ""}">${money(c.remaining)}</td>
          <td class="note-text">${esc(c.notes || "—")}</td></tr>`).join("") || '<tr><td colspan="9" class="empty-state">لا توجد خطة سداد</td></tr>'}
        </tbody></table></div>
    </div>`;
}

/* ---------- LEDGER (سجل السداد والفواتير) ---------- */
function viewLedger() {
  const d = state.data;
  const pays = (d.payments || []).slice().reverse();
  const invs = (d.invoices || []).slice().reverse();
  const payTotal = pays.reduce((s, p) => s + p.amount, 0);
  const invTotal = invs.reduce((s, i) => s + i.amount, 0);
  $("view-ledger").innerHTML = `
    <div class="card">
      <div class="card-head"><span class="card-title">💰 السدادات (قبض) — ${pays.length} حركة • ${money(payTotal)}</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>العميل</th><th>التاريخ</th><th>المبلغ</th></tr></thead>
        <tbody>${pays.map((p) => `<tr><td><b>${esc(p.customer)}</b></td><td>${dueLabel(p.date)}</td><td class="tbl-amount pos">+${money(p.amount)}</td></tr>`).join("") || '<tr><td colspan="3" class="empty-state">لا توجد سدادات</td></tr>'}
        </tbody></table></div>
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">🧾 الفواتير — ${invs.length} فاتورة • ${money(invTotal)}</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th></tr></thead>
        <tbody>${invs.map((i) => `<tr><td>${esc(i.num)}</td><td><b>${esc(i.customer)}</b></td><td>${dueLabel(i.date)}</td><td class="tbl-amount neg">${money(i.amount)}</td></tr>`).join("") || '<tr><td colspan="4" class="empty-state">لا توجد فواتير</td></tr>'}
        </tbody></table></div>
    </div>`;
}

/* ---------- Bootstrap ---------- */
document.addEventListener("DOMContentLoaded", () => {
  $("dateToday").textContent = todayStr();
  document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
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
  fetchData();
  setInterval(() => fetchData(true), POLL_MS);
});