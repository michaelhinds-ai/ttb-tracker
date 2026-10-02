// Pull every active customer from a company's QuickBooks (Louisville Rickhouse or a linked company
// such as Nashville Barrel Co — chosen by ?ws=) so the app can import them for sales orders.
// GET /api/qb/customers?ws=<workspace>  ->  { ok, company, customers:[ {qbId,name,company,email,phone,address,state,zip,terms,shipAddress,notes,active} ] }
import { qbQuery, useWs, QBError } from "./lib/qb.mjs";
import { authOn, verify, tokenFromReq, isRetailRole } from "./lib/authtoken.mjs";

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
const addrLine = (a) => a ? [a.Line1, a.Line2, a.Line3, [a.City, [a.CountrySubDivisionCode, a.PostalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") : "";

export default async (req) => {
  const url = new URL(req.url);
  if (authOn()) { const tok = verify(tokenFromReq(req)); if (!tok || isRetailRole(tok.role)) return json({ ok: false, error: "not_allowed" }, 403); }
  useWs(url.searchParams.get("ws") || "");
  try {
    // Payment terms (Net 30 …) are stored by id on the customer — look the names up once.
    const terms = {};
    try { const t = await qbQuery("select Id, Name from Term"); for (const x of (t?.QueryResponse?.Term || [])) terms[x.Id] = x.Name; } catch {}
    let company = null;
    try { const ci = await qbQuery("select * from CompanyInfo"); company = ci?.QueryResponse?.CompanyInfo?.[0]?.CompanyName || null; } catch {}
    const out = [];
    for (let start = 1, page = 0; page < 20; page++, start += 1000) {
      const q = await qbQuery(`select * from Customer where Active = true STARTPOSITION ${start} MAXRESULTS 1000`);
      const rows = q?.QueryResponse?.Customer || [];
      for (const c of rows) {
        const bill = c.BillAddr || null, ship = c.ShipAddr || null, a = ship || bill;
        out.push({
          qbId: String(c.Id), name: c.DisplayName || c.CompanyName || "", company: c.CompanyName || "",
          contact: [c.GivenName, c.FamilyName].filter(Boolean).join(" "),
          email: c.PrimaryEmailAddr?.Address || "", phone: c.PrimaryPhone?.FreeFormNumber || c.Mobile?.FreeFormNumber || "",
          address: addrLine(bill || ship), shipAddress: addrLine(ship),
          state: (a && a.CountrySubDivisionCode) ? String(a.CountrySubDivisionCode).toUpperCase().slice(0, 2) : "",
          zip: (a && a.PostalCode) || "", terms: c.SalesTermRef ? (terms[c.SalesTermRef.value] || c.SalesTermRef.name || "") : "",
          notes: c.Notes || "",
        });
      }
      if (rows.length < 1000) break;
    }
    return json({ ok: true, company, count: out.length, customers: out });
  } catch (e) {
    if (e instanceof QBError && e.code === "not_connected") return json({ ok: false, error: "not_connected", detail: "QuickBooks isn’t connected for this company yet — connect it in Setup." });
    return json({ ok: false, error: (e && e.code) || "error", detail: (e && (typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail || ""))) || String(e) });
  }
};
export const config = { path: "/api/qb/customers" };
