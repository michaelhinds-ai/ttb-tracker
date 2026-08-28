// Nightly Square sales digest — per location, total sales, and each employee's
// transaction count + average ticket, pulled from Square Payments (each payment
// carries team_member_id, location_id, and the amount collected).
import { accounts, sqFor, env as sqEnv, dayRange, todayInTz } from "./square.mjs";

const money = (cents) => "$" + ((Number(cents) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Location id -> name for one account.
async function locationNames(acct) {
  const map = {};
  try {
    const r = await sqFor(acct, "/v2/locations");
    for (const l of (r && r.locations) || []) map[l.id] = l.name || l.id;
  } catch (e) { /* names fall back to id */ }
  return map;
}
// Team member id -> "First Last" for one account (paginated a couple pages).
async function teamNames(acct) {
  const map = {};
  let cursor = null;
  for (let i = 0; i < 5; i++) {
    let r;
    try { r = await sqFor(acct, "/v2/team-members/search", { method: "POST", body: cursor ? { cursor } : {} }); }
    catch (e) { break; }
    for (const t of (r && r.team_members) || []) {
      const nm = [t.given_name, t.family_name].filter(Boolean).join(" ").trim();
      map[t.id] = nm || (t.email_address || t.id);
    }
    cursor = r && r.cursor;
    if (!cursor) break;
  }
  return map;
}

// All COMPLETED payments for one account in [startISO,endISO). Bounded by a page cap.
async function dayPayments(acct, startISO, endISO) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 40; page++) {
    const qs = new URLSearchParams({ begin_time: startISO, end_time: endISO, sort_order: "ASC", limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    let r;
    try { r = await sqFor(acct, "/v2/payments?" + qs.toString()); }
    catch (e) { break; }
    for (const p of (r && r.payments) || []) out.push(p);
    cursor = r && r.cursor;
    if (!cursor) break;
  }
  return out;
}

// Build the digest for one account: [{ location, sales(cents), txns, employees:[{name,txns,salesCents,avgCents}] }]
export async function accountDigest(acct, ymd) {
  const tz = acct.tz || sqEnv().tz;
  const { startISO, endISO } = dayRange(ymd, tz);
  const [locNames, tmNames, payments] = await Promise.all([
    locationNames(acct), teamNames(acct), dayPayments(acct, startISO, endISO),
  ]);
  const OK = new Set(["COMPLETED", "APPROVED", "CAPTURED"]);
  const byLoc = {};
  for (const p of payments) {
    if (p.status && !OK.has(p.status)) continue;
    const amt = (p.amount_money && p.amount_money.amount) || 0;
    const tip = (p.tip_money && p.tip_money.amount) || 0;
    const net = Math.max(0, amt - tip); // sales collected, excluding tips
    const locId = p.location_id || "—";
    const loc = (byLoc[locId] || (byLoc[locId] = { locId, name: locNames[locId] || locId, sales: 0, txns: 0, emp: {} }));
    loc.sales += net; loc.txns += 1;
    const tmId = p.team_member_id || "__unattributed";
    const e = (loc.emp[tmId] || (loc.emp[tmId] = { name: tmId === "__unattributed" ? "Unattributed" : (tmNames[tmId] || tmId), txns: 0, sales: 0 }));
    e.txns += 1; e.sales += net;
  }
  const seller = acct.label || "";
  return Object.values(byLoc).map((l) => ({
    account: seller,
    location: l.name,
    sales: l.sales,
    txns: l.txns,
    employees: Object.values(l.emp)
      .map((e) => ({ name: e.name, txns: e.txns, salesCents: e.sales, avgCents: e.txns ? Math.round(e.sales / e.txns) : 0 }))
      .sort((a, b) => b.salesCents - a.salesCents),
  })).sort((a, b) => b.sales - a.sales);
}

// Digest across every configured Square account for a given day.
export async function fullDigest(ymd) {
  const accts = accounts();
  const parts = await Promise.all(accts.map((a) => accountDigest(a, ymd).catch(() => [])));
  return parts.flat().sort((a, b) => b.sales - a.sales);
}

export function renderDigestHTML(rows, ymd, tz) {
  const totalSales = rows.reduce((s, r) => s + r.sales, 0);
  const totalTxns = rows.reduce((s, r) => s + r.txns, 0);
  const dateLabel = new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const locBlocks = rows.length ? rows.map((r) => `
    <div style="margin:0 0 18px;border:1px solid #e7ded0;border-radius:12px;overflow:hidden">
      <div style="background:#3a2a1c;color:#f4e9d6;padding:12px 16px;display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-weight:700;font-size:16px">${esc(r.location)}${r.account ? ` <span style="opacity:.7;font-weight:400;font-size:12px">· ${esc(r.account)}</span>` : ""}</div>
        <div style="text-align:right"><div style="font-weight:700;font-size:16px">${money(r.sales)}</div><div style="opacity:.7;font-size:11px">${r.txns} transaction${r.txns === 1 ? "" : "s"}</div></div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#faf5ec;color:#7a6a55;text-align:left">
          <th style="padding:8px 16px">Employee</th>
          <th style="padding:8px 16px;text-align:right">Transactions</th>
          <th style="padding:8px 16px;text-align:right">Sales</th>
          <th style="padding:8px 16px;text-align:right">Avg ticket</th>
        </tr></thead>
        <tbody>${r.employees.map((e) => `
          <tr style="border-top:1px solid #efe7d9">
            <td style="padding:8px 16px">${esc(e.name)}</td>
            <td style="padding:8px 16px;text-align:right">${e.txns}</td>
            <td style="padding:8px 16px;text-align:right">${money(e.salesCents)}</td>
            <td style="padding:8px 16px;text-align:right;font-weight:600">${money(e.avgCents)}</td>
          </tr>`).join("")}</tbody>
      </table>
    </div>`).join("") : `<p style="color:#7a6a55">No sales recorded for ${esc(dateLabel)} yet.</p>`;
  return `<!doctype html><html><body style="margin:0;background:#f3ede1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2a2118">
    <div style="max-width:640px;margin:0 auto;padding:20px">
      <h1 style="font-size:20px;margin:0 0 2px">Daily Sales — Mikey Systems</h1>
      <div style="color:#7a6a55;font-size:13px;margin:0 0 16px">${esc(dateLabel)}</div>
      <div style="display:flex;gap:12px;margin:0 0 20px">
        <div style="flex:1;background:#fff;border:1px solid #e7ded0;border-radius:12px;padding:14px 16px">
          <div style="color:#7a6a55;font-size:11px;text-transform:uppercase;letter-spacing:.04em">Total sales</div>
          <div style="font-size:22px;font-weight:700">${money(totalSales)}</div>
        </div>
        <div style="flex:1;background:#fff;border:1px solid #e7ded0;border-radius:12px;padding:14px 16px">
          <div style="color:#7a6a55;font-size:11px;text-transform:uppercase;letter-spacing:.04em">Transactions</div>
          <div style="font-size:22px;font-weight:700">${totalTxns}</div>
        </div>
      </div>
      ${locBlocks}
      <p style="color:#9a8b73;font-size:11px;margin-top:18px;line-height:1.5">Sales are amounts collected via Square (excluding tips), before refunds. Average ticket = an employee's sales ÷ their transaction count. "Unattributed" covers payments Square didn't tie to a team member (e.g. a shared device login). Times are ${esc(tz)}.</p>
    </div></body></html>`;
}

export async function sendDigestEmail({ to, from, apiKey, subject, html }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("resend " + r.status + ": " + t.slice(0, 300));
  return true;
}
