import { qbFetch, qbQuery, QBError, escapeQ, round2, MINOR_VERSION } from "./lib/qb.mjs";

// POST body:
// { customer:{name,email,phone}, lines:[{sku,description,qty,unitPrice}], docNumber, txnDate, privateNote, poNumber }
// docNumber becomes the QuickBooks invoice number (requires "Custom transaction numbers" ON in QBO,
// otherwise QBO auto-assigns). poNumber is written to the invoice's customer-facing memo.
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let p;
  try { p = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const custName = (p.customer && p.customer.name || "").trim();
  if (!custName) return json({ error: "no_customer" }, 400);
  if (!Array.isArray(p.lines) || !p.lines.length) return json({ error: "no_lines" }, 400);

  try {
    const custId = await findCustomer(custName) || await createCustomer(p.customer);
    // If QuickBooks already has an invoice with this DocNumber:
    //  • SAME customer  → it's this order already synced → link to it (idempotent, no duplicate).
    //  • DIFFERENT customer → the number is taken by an unrelated invoice (e.g. an old gift-shop
    //    invoice) → clear our forced number and let QuickBooks assign the next free one, so we
    //    never mis-link a real order onto someone else's invoice or crash on a duplicate number.
    if (p.docNumber) {
      const dq = await qbQuery(`select * from Invoice where DocNumber = '${escapeQ(String(p.docNumber))}'`);
      const existing = dq && dq.QueryResponse && dq.QueryResponse.Invoice && dq.QueryResponse.Invoice[0];
      if (existing) {
        if (existing.CustomerRef && String(existing.CustomerRef.value) === String(custId)) {
          return json({ ok: true, invoiceId: existing.Id, docNumber: existing.DocNumber, total: existing.TotalAmt, existing: true });
        }
        p.docNumber = null; // taken by a different customer's invoice — QB auto-numbers instead
      }
    }
    const incomeAcct = await defaultIncomeAccount();
    const Line = [];
    for (const ln of p.lines) {
      const itemId = await ensureItem(ln.sku || ln.description || "Distilled Spirits", incomeAcct);
      const qty = Number(ln.qty) || 0, rate = Number(ln.unitPrice) || 0;
      Line.push({
        DetailType: "SalesItemLineDetail",
        Amount: round2(qty * rate),
        Description: ln.description || ln.sku || "",
        SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: qty, UnitPrice: rate },
      });
    }
    const invoice = { CustomerRef: { value: custId }, Line };
    if (p.docNumber) invoice.DocNumber = String(p.docNumber).slice(0, 21);
    if (p.txnDate) invoice.TxnDate = p.txnDate;
    if (p.privateNote) invoice.PrivateNote = String(p.privateNote).slice(0, 4000);
    if (p.poNumber) invoice.CustomerMemo = { value: ("PO #: " + String(p.poNumber)).slice(0, 1000) };
    let created;
    try {
      created = await qbFetch(`/invoice?minorversion=${MINOR_VERSION}`, { method: "POST", body: JSON.stringify(invoice) });
    } catch (e1) {
      // Bulletproof fallback: if QuickBooks rejects the forced invoice number as a duplicate,
      // drop it and let QuickBooks assign the next free number, then retry once.
      const det = JSON.stringify((e1 && e1.detail) || "");
      if (e1 instanceof QBError && invoice.DocNumber && /Duplicate Document Number/i.test(det)) {
        delete invoice.DocNumber;
        created = await qbFetch(`/invoice?minorversion=${MINOR_VERSION}`, { method: "POST", body: JSON.stringify(invoice) });
      } else { throw e1; }
    }
    const inv = created.json && created.json.Invoice;
    return json({ ok: true, invoiceId: inv && inv.Id, docNumber: inv && inv.DocNumber, total: inv && inv.TotalAmt, customerId: custId, tid: created.tid });
  } catch (e) {
    if (e instanceof QBError && e.code === "not_connected") return json({ error: "not_connected" }, 409);
    console.error("QB invoice error", e && e.status, e && e.tid, e && e.detail);
    return json({ error: "qb_error", status: e && e.status, detail: safeDetail(e && e.detail), tid: e && e.tid }, 502);
  }
};

async function findCustomer(name) {
  const q = await qbQuery(`select Id from Customer where DisplayName = '${escapeQ(name)}'`);
  const c = q?.QueryResponse?.Customer?.[0];
  return c ? c.Id : null;
}
async function createCustomer(c) {
  const body = { DisplayName: c.name };
  if (c.email) body.PrimaryEmailAddr = { Address: c.email };
  if (c.phone) body.PrimaryPhone = { FreeFormNumber: c.phone };
  const r = await qbFetch(`/customer?minorversion=${MINOR_VERSION}`, { method: "POST", body: JSON.stringify(body) });
  return r.json.Customer.Id;
}
async function ensureItem(name, incomeAcct) {
  const nm = String(name || "Distilled Spirits").trim().slice(0, 100);
  const q = await qbQuery(`select Id from Item where Name = '${escapeQ(nm)}'`);
  const found = q?.QueryResponse?.Item?.[0];
  if (found) return found.Id;
  const body = { Name: nm, Type: "NonInventory", IncomeAccountRef: { value: incomeAcct } };
  const r = await qbFetch(`/item?minorversion=${MINOR_VERSION}`, { method: "POST", body: JSON.stringify(body) });
  return r.json.Item.Id;
}
async function defaultIncomeAccount() {
  const q = await qbQuery("select Id, Name from Account where AccountType = 'Income' and Active = true");
  const a = q?.QueryResponse?.Account?.[0];
  if (!a) throw new QBError("no_income_account", 400, "No income account found in QuickBooks to attach the product to.");
  return a.Id;
}
function safeDetail(d) { try { const o = JSON.parse(d); return o?.Fault?.Error || o; } catch { return String(d || "").slice(0, 500); } }
function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } }); }
export const config = { path: "/api/qb/invoice" };
