function renderRetailOut(d){
  const tx=$('#rtlTxns'); if(tx){ tx.style.display='none'; tx.innerHTML=''; } $('#rtlOut').style.display='';
  const c=d.combined;
  const from=(d.range&&d.range.from)||d.startDate||d.date, to=(d.range&&d.range.to)||d.endDate||d.date;
  const dayName=rtlPeriodLabel(from,to);
  const ok=d.accounts.filter(a=>a.ok), bad=d.accounts.filter(a=>!a.ok);

  // Prior-year (same weekdays) comparison lookups.
  const py=d.priorYear&&!d.priorYear.error?d.priorYear:null;
  let lyLabel=py&&py.range?rtlPeriodLabel(py.range.from,py.range.to):'';
  if(lyLabel&&d.inProgress&&d.throughTime) lyLabel+=` · through ${d.throughTime}`;
  const pyCombined=py?py.combined:null;
  const pyAcct=key=>py?(py.accounts||[]).find(a=>a.key===key&&a.ok):null;

  // Xola experience revenue (recognized on the day the tour ran), folded into the grand total.
  const xr=d.xola, pyXr=py?py.xola:null;
  const withXola=(cc,xx)=>{ if(!xx) return cc; const oc=cc.orderCount+(xx.orderCount||0); return Object.assign({},cc,{
    netSales:round2(cc.netSales+(xx.netSales||0)), tax:round2(cc.tax+(xx.tax||0)), netTax:round2((cc.netTax!=null?cc.netTax:cc.tax)+(xx.tax||0)),
    units:round2((cc.units||0)+(xx.guests||0)), orderCount:oc, collected:round2((cc.collected||0)+(xx.collected||0)),
    avgTicket:oc?round2((cc.netSales+(xx.netSales||0))/oc):0 }); };
  const cAll=withXola(c,xr), pyCombinedAll=pyCombined?withXola(pyCombined,pyXr):null;

  const kpis=`<div class="kpis" style="margin:14px 0">`+[
    kpi('copper','Net Sales',money(cAll.netSales),`${cAll.orderCount} sale${cAll.orderCount===1?'':'s'} · ${c.locations} loc${c.locations===1?'':'s'}${xr?' + Xola':''}`),
    kpi('blue','Avg Ticket',money(cAll.avgTicket),'net sales per sale'),
    kpi('green','Tips',money(c.tips),c.tipPct?`${numf(c.tipPct,1)}% of net sales`:'none recorded'),
    kpi('barrel','Units Sold',numf(cAll.units,0),c.bottles!=null?`${numf(c.bottles,0)} bottles${xr?` + ${numf(xr.guests,0)} guests`:''}`:'line-item quantity'),
  ].join('')+`</div>`+(pyCombinedAll?rtlCmp(cAll,pyCombinedAll,lyLabel):'');

  const cols=(x)=>`<td class="num">${x.orderCount}</td><td class="num">${money(x.netSales)}</td><td class="num">${money(x.avgTicket)}</td><td class="num">${money(x.tax)}</td><td class="num">${money(x.tips)}</td><td class="num">${money(x.discounts)}</td><td class="num">${numf(x.units,0)}</td><td class="num">${x.bottles!=null?numf(x.bottles,0):'—'}</td><td class="num">${x.refundCount?`(${money(x.refunded)})`:'—'}</td>`;

  // A back-office location with no activity is noise — hide it, but keep it if it ever has data.
  const blankBO=l=>/back\s*-?\s*office/i.test(l.name||'')&&!l.orderCount&&!l.refundCount&&!(+l.netSales)&&!(+l.tax);
  const shownLocs=a=>a.locations.filter(l=>!blankBO(l));

  // One row per location, grouped under its account, with a subtotal per account.
  let rows='';
  ok.forEach(a=>{
    const an=rtlAcctName(a); const locs=shownLocs(a);
    if(ok.length>1) rows+=`<tr class="sub"><td colspan="10" style="font-weight:700;color:var(--copper)">${esc(an)}</td></tr>`;
    rows+=locs.map(l=>`<tr class="loclink" style="cursor:pointer" title="View this location’s transactions" onclick="openLocTxns('${a.key}','${esc(l.id)}','${esc((l.name||'').replace(/'/g,"\\'"))}')"><td style="padding-left:${ok.length>1?'18px':'0'}">${esc(l.name)} <span style="color:var(--copper);font-size:12px">›</span></td>${cols(l)}</tr>`).join('');
    if(locs.length>1) rows+=`<tr class="sub"><td style="padding-left:${ok.length>1?'18px':'0'}"><i>${esc(an)} total</i></td>${cols(a.totals)}</tr>`;
  });
  if(ok.length>1||ok.some(a=>shownLocs(a).length>1)) rows+=`<tr class="total" style="font-weight:700"><td>All locations</td>${cols(c)}</tr>`;

  // Full per-account summary block (same letterhead + KPI tiles as the combined one at top),
  // shown after the combined summary and broken out by account (Louisville Rickhouse, NBC, …).
  const acctBlock=a=>{ const t=a.totals, an=rtlAcctName(a), lc=shownLocs(a).length;
    const header=`<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;border-bottom:2px solid var(--copper);padding-bottom:12px;margin:30px 0 6px">`+
      `<div><div style="font-size:20px;font-weight:800">${esc(an)}</div><div style="color:var(--muted);font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">${lc} location${lc===1?'':'s'}</div></div>`+
      `<div style="text-align:right"><div style="font-weight:700">Retail Sales — Daily Summary</div><div style="color:var(--muted);font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">${esc(dayName)}</div></div></div>`;
    const pa=pyAcct(a.key);
    return header+`<div class="kpis" style="margin:14px 0">`+[
      kpi('copper','Net Sales',money(t.netSales),`${t.orderCount} order${t.orderCount===1?'':'s'} · ${lc} location${lc===1?'':'s'}`),
      kpi('blue','Avg Ticket',money(t.avgTicket),'net sales per order'),
      kpi('green','Tips',money(t.tips),t.tipPct?`${numf(t.tipPct,1)}% of net sales`:'none recorded'),
      kpi('barrel','Units Sold',numf(t.units,0),t.bottles!=null?`${numf(t.bottles,0)} tagged bottles`:'line-item quantity'),
    ].join('')+`</div>`+(pa?rtlCmp(t,pa.totals,lyLabel):''); };
  const acctBlocks=ok.length>1?ok.map(acctBlock).join(''):'';
  const xolaBlock=xr?renderXolaBlock(xr,pyXr,dayName,lyLabel):'';

  // Combined top header — the all-accounts roll-up (KY = Louisville Rickhouse, TN = NBC).
  const topSub=ok.length>1?ok.map(a=>esc(rtlAcctName(a))).join(' + '):(ok[0]?esc(rtlAcctName(ok[0])):'All accounts');
  const topHeader=`<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;border-bottom:2px solid var(--copper);padding-bottom:12px;margin-bottom:6px">`+
    `<div><div style="font-size:20px;font-weight:800">Total Summary — KY + TN</div><div style="color:var(--muted);font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">${topSub}</div></div>`+
    `<div style="text-align:right"><div style="font-weight:700">Retail Sales — Daily Summary</div><div style="color:var(--muted);font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">Every location, every Square account</div><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">${esc(dayName)}</div></div></div>`;

  // Per-location detail, each with its own top sellers.
  const detail=ok.map(a=>{
    const an=rtlAcctName(a);
    return shownLocs(a).map(l=>{
      const head=`<h4 style="margin-top:22px">${esc(l.name)} <span style="color:var(--muted);font-weight:400;font-size:13px">— ${esc(an)}</span></h4>`;
      // Quiet locations collapse to one line instead of a wall of zeros.
      if(!l.orderCount&&!l.refundCount) return head+`<div style="color:var(--muted);font-size:13px;margin-top:6px">No sales on this day.</div>`;
      const stats=[rtlStat('Net sales',money(l.netSales)),rtlStat('Orders',l.orderCount),rtlStat('Avg ticket',money(l.avgTicket)),
        rtlStat('Tips',money(l.tips)+(l.tipPct?` <span style="color:var(--muted);font-weight:400;font-size:12px">${numf(l.tipPct,1)}%</span>`:'')),
        rtlStat('Discounts',money(l.discounts)),rtlStat('Units',numf(l.units,0)),
        l.bottles!=null?rtlStat('Bottles',numf(l.bottles,0)):'',
        l.refundCount?rtlStat('Refunded',money(l.refunded)+` <span style="color:var(--muted);font-weight:400;font-size:12px">${l.refundCount}</span>`):''].join('');
      const items=l.topItems.length
        ? `<div class="tablewrap"><table><thead><tr><th>Top sellers</th><th class="num">Qty</th><th class="num">Net Sales</th></tr></thead><tbody>`
          +l.topItems.map(it=>`<tr><td>${esc(it.name)}</td><td class="num">${numf(it.qty,0)}</td><td class="num">${money(it.net)}</td></tr>`).join('')
          +`</tbody></table></div>`
        : `<div style="color:var(--muted);font-size:13px">Orders ran here, but no item lines came back.</div>`;
      return head+`<div style="margin:8px 0 12px">${stats}</div>${items}`;
    }).join('');
  }).join('');

  const failNote=bad.length?`<div class="note">⚠️ Couldn’t reach ${bad.map(a=>esc(rtlAcctName(a))).join(' and ')} — ${esc(bad[0].detail||bad[0].error)}. Everything below covers the remaining account${ok.length===1?'':'s'} only.</div>`:'';

  $('#rtlOut').innerHTML=topHeader+failNote+kpis+acctBlocks+xolaBlock+`
    <h4>All locations</h4>
    <div class="tablewrap"><table><thead><tr>
      <th>Location</th><th class="num">Orders</th><th class="num">Net Sales</th><th class="num">Avg Ticket</th>
      <th class="num">Tax</th><th class="num">Tips</th><th class="num">Discounts</th><th class="num">Units</th>
      <th class="num">Bottles</th><th class="num">Refunds</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    ${detail}
    <div class="taxbox"><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Total Collected — ${esc(dayName)}</div>
      <div class="due">${money(cAll.collected)}</div>
      <div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;margin-top:4px">${money(cAll.netSales)} in sales + ${money(cAll.tax)} tax + ${money(c.tips)} tips${c.serviceCharges?` + ${money(c.serviceCharges)} service charges`:''}${c.refundCount?`, before ${money(c.refunded)} refunded`:''}${xr?`. Includes Xola experiences redeemed this period.`:'.'}</div></div>
    <div class="disclaimer">Completed Square orders only, for the calendar day in each account’s own timezone. Net sales are merchandise after discounts, before tax and tips; avg ticket is net sales ÷ orders. “Bottles” counts line items tagged with <b>TTB Bottle Size (mL)</b> — accounts without those tags show a dash. Locations with no sales still appear, at zero — except an empty back-office location, which is hidden until it has activity. <b>Tip:</b> click any location to see its individual transactions. This is an operating snapshot, not a tax filing; use the Kentucky tab for the returns.</div>`;
}
// ---- Location drill-down: individual transactions for one location on the shown day ----
async function openLocTxns(acctKey, locId, name){
  if(!rtlLast){ return; }
  const from=(rtlLast.range&&rtlLast.range.from)||rtlLast.startDate||rtlLast.date;
  const to=(rtlLast.range&&rtlLast.range.to)||rtlLast.endDate||rtlLast.date;
  const out=$('#rtlTxns');
  out.innerHTML=`<div class="empty">Loading ${esc(name)} transactions…</div>`;
  $('#rtlOut').style.display='none'; out.style.display='';
  window.scrollTo({top:0,behavior:'smooth'});
  try{
    const r=await fetch('/api/square/transactions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({acct:acctKey,locationId:locId,name,startDate:from,endDate:to,endCapISO:new Date().toISOString()})});
    const d=await r.json();
    if(!r.ok||d.error){ out.innerHTML=backBar(name)+`<div class="note">Couldn’t load transactions${d&&d.detail?': '+esc(d.detail):''}.</div>`; wireTxnBack(); return; }
    renderLocTxns(d);
  }catch(e){ out.innerHTML=backBar(name)+`<div class="note">Couldn’t reach Square. ${esc(String(e&&e.message||e))}</div>`; wireTxnBack(); }
}
function backBar(name){ return `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px"><button class="btn ghost sm" id="txnBack">← Back to summary</button><div style="font-family:-apple-system,Segoe UI,sans-serif;color:var(--muted);font-size:13px">${esc(name||'')}</div></div>`; }
function wireTxnBack(){ const b=$('#txnBack'); if(b) b.onclick=()=>{ $('#rtlTxns').style.display='none'; $('#rtlTxns').innerHTML=''; $('#rtlOut').style.display=''; window.scrollTo({top:0,behavior:'smooth'}); }; }
function fmtTime(iso,tz){ if(!iso) return '—'; try{ return new Date(iso).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:tz||undefined}); }catch(e){ return '—'; } }
function fmtDateTime(iso,tz){ if(!iso) return '—'; try{ return new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:tz||undefined}); }catch(e){ return '—'; } }
function renderLocTxns(d){
  const out=$('#rtlTxns');
  const sD=d.startDate||d.date, eD=d.endDate||d.date, multi=sD!==eD;
  const when=iso=>multi?fmtDateTime(iso,d.tz):fmtTime(iso,d.tz);
  const dayName=rtlPeriodLabel(sD, eD);
  const acctLabel=d.account&&d.account.label?d.account.label:'';
  const t=d.totals||{};
  const header=`<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;border-bottom:2px solid var(--copper);padding-bottom:12px;margin-bottom:6px">`+
    `<div><div style="font-size:20px;font-weight:800">${esc(d.location&&d.location.name||'Location')}</div><div style="color:var(--muted);font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">${esc(acctLabel)}</div></div>`+
    `<div style="text-align:right"><div style="font-weight:700">Transactions</div><div style="color:var(--muted);font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">${esc(dayName)}</div></div></div>`;
  const kpis=`<div class="kpis" style="margin:14px 0">`+[
    kpi('copper','Transactions',numf(t.orderCount,0),`${money(t.total)} collected`),
    kpi('blue','Net Sales',money(t.net),'before tax & tips'),
    kpi('green','Tips',money(t.tips),t.refundCount?`${money(t.refunded)} refunded`:'none / included'),
  ].join('')+`</div>`;
  let body;
  if(!d.orders||!d.orders.length){
    body=`<div class="empty">No transactions at this location on ${esc(dayName)}.</div>`;
  } else {
    const rows=d.orders.map(o=>{
      const items=(o.items||[]).map(it=>`${esc(it.name)}${it.qty>1?` ×${numf(it.qty,0)}`:''}`).join(', ')||'—';
      return `<tr><td style="white-space:nowrap">${when(o.timeISO)}</td><td>${items}</td><td>${(o.tenders||[]).map(esc).join(', ')||'—'}</td><td class="num">${money(o.net)}</td><td class="num">${money(o.tax)}</td><td class="num">${money(o.tips)}</td><td class="num"><b>${money(o.total)}</b></td></tr>`;
    }).join('');
    body=`<div class="tablewrap"><table><thead><tr><th>Time</th><th>Items</th><th>Payment</th><th class="num">Net</th><th class="num">Tax</th><th class="num">Tips</th><th class="num">Total</th></tr></thead><tbody>${rows}</tbody>`+
      `<tfoot><tr class="total" style="font-weight:700"><td>Total</td><td>${d.orders.length} transaction${d.orders.length===1?'':'s'}</td><td></td><td class="num">${money(t.net)}</td><td class="num">${money(t.tax)}</td><td class="num">${money(t.tips)}</td><td class="num">${money(t.total)}</td></tr></tfoot></table></div>`;
  }
  const refunds=(d.refunds&&d.refunds.length)
    ? `<h4 style="margin-top:20px">Refunds</h4><div class="tablewrap"><table><thead><tr><th>Time</th><th>Reason</th><th class="num">Amount</th></tr></thead><tbody>`+
      d.refunds.map(r=>`<tr><td>${when(r.timeISO)}</td><td>${esc(r.reason||'—')}</td><td class="num">(${money(r.amount)})</td></tr>`).join('')+`</tbody></table></div>`
    : '';
  out.innerHTML=backBar(d.location&&d.location.name)+header+kpis+body+refunds+
    `<div class="disclaimer">Completed Square orders at this location for the calendar day, in the account’s timezone. Net is merchandise after discounts, before tax and tips. Times shown in the account’s local timezone.</div>`;
  wireTxnBack();
}
function rtlCsv(){
  if(!rtlLast)return; const d=rtlLast, ok=d.accounts.filter(a=>a.ok);
  const sD=(d.range&&d.range.from)||d.startDate||d.date, eD=(d.range&&d.range.to)||d.endDate||d.date;
  const L=[['Retail Sales — Summary',csv(rtlPeriodLabel(sD,eD))].join(',')];
  // No tax columns: the daily report does not show tax. The KY tab owns that.
  const head=['Account','Location','Orders','Net Sales','Avg Ticket','Tips','Discounts','Units','Bottles','Refunded'];
  const row=(an,name,x)=>[csv(an),csv(name),x.orderCount,x.netSales,x.avgTicket,x.tips,x.discounts,x.units,x.bottles==null?'':x.bottles,x.refunded].join(',');
  L.push(''); L.push(head.join(','));
  ok.forEach(a=>{ const an=rtlAcctName(a);
    a.locations.forEach(l=>L.push(row(an,l.name,l)));
    if(a.locations.length>1) L.push(row(an,'— account total —',a.totals));
  });
  L.push(row('ALL','— all locations —',d.combined));
  // Xola experience revenue, one line per seller then a combined line, so the
  // export reconciles against each seller's own Xola report.
  if(d.xola){
    const xa=Array.isArray(d.xola.accounts)?d.xola.accounts:[];
    L.push(''); L.push(['Xola — experiences redeemed'].join(','));
    // No tax column: Xola spans KY and TN, and only the KY slice is filable here.
    L.push(['Seller','Bookings','Guests','Net Sales','Avg Ticket','Status'].join(','));
    (xa.length?xa:[{label:'Xola',ok:true,orderCount:d.xola.orderCount,guests:d.xola.guests,netSales:d.xola.netSales,avgTicket:d.xola.avgTicket}])
      .forEach(a=>L.push([csv(a.label||a.key||'Xola'),a.orderCount||0,a.guests||0,a.netSales||0,a.avgTicket||0,
        csv(a.ok===false?('UNAVAILABLE — '+(a.detail||a.error||'error'))
          :a.unreadable?'UNREADABLE — no transactions visible for this seller; zeros are not real'
          :(a.truncated?'partial':'ok'))].join(',')));
    if(xa.length>1) L.push([csv('— all sellers —'),d.xola.orderCount||0,d.xola.guests||0,d.xola.netSales||0,d.xola.avgTicket||0,csv(d.xola.partial?'INCOMPLETE':'ok')].join(','));
  }
  const py=d.priorYear&&!d.priorYear.error?d.priorYear:null;
  if(py){ L.push(''); L.push(['Prior year (same weekdays)',csv(py.range?rtlPeriodLabel(py.range.from,py.range.to):'')].join(',')); L.push(head.join(','));
    (py.accounts||[]).filter(a=>a.ok).forEach(a=>{ const an=rtlAcctName(a); a.locations.forEach(l=>L.push(row(an,l.name,l))); if(a.locations.length>1)L.push(row(an,'— account total —',a.totals)); });
    L.push(row('ALL','— all locations (LY) —',py.combined)); }
  ok.forEach(a=>{ const an=rtlAcctName(a);
    a.locations.forEach(l=>{
      if(!l.topItems.length)return;
      L.push(''); L.push([csv(an+' / '+l.name+' — top sellers'),'Qty','Net Sales'].join(','));
      l.topItems.forEach(it=>L.push([csv(it.name),it.qty,it.net].join(',')));
    });
  });
  const blob=new Blob([L.join('\n')],{type:'text/csv'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`retail-sales_${sD}${eD!==sD?'_to_'+eD:''}.csv`; a.click();
}

/* ================= Setup / sync / data ================= */
function loadSettingsForm(){const s=state.settings;$('#s_name').value=s.name||'';$('#s_permit').value=s.permit||'';$('#s_addr1').value=s.addr1||'';$('#s_addr2').value=s.addr2||'';$('#s_ein').value=s.ein||'';$('#s_signer').value=s.signer||'';$('#s_title').value=s.title||'';$('#s_freq').value=s.freq||'quarterly';$('#s_year').value=s.year||new Date().getFullYear();$('#s_bpc').value=s.bottlesPerCase??6;$('#s_kyExcise').value=s.kyExcise??1.92;$('#s_kyWholesale').value=s.kyWholesale??11;$('#s_kyCase').value=s.kyCase??0.05;}
function saveSettings(){if(!requireCap('setup'))return;const s=state.settings;s.name=$('#s_name').value.trim();s.permit=$('#s_permit').value.trim();s.addr1=$('#s_addr1').value.trim();s.addr2=$('#s_addr2').value.trim();s.ein=$('#s_ein').value.trim();s.signer=$('#s_signer').value.trim();s.title=$('#s_title').value.trim();s.freq=$('#s_freq').value;s.year=+$('#s_year').value||new Date().getFullYear();s.bottlesPerCase=Math.max(1,+$('#s_bpc').value||6);s.kyExcise=+$('#s_kyExcise').value||0;s.kyWholesale=+$('#s_kyWholesale').value||0;s.kyCase=+$('#s_kyCase').value||0;save('Updated plant details / settings');refreshAll();flash('Details saved.');}
function syncUI(){ const link=location.origin+location.pathname+'#ws='+WS; $('#syncLink').value= location.protocol==='file:'?'(host online to get a shareable link)':link; $('#wsCode').textContent=WS; }
function copyLink(){ const v=$('#syncLink').value; navigator.clipboard?.writeText(v).then(()=>flash('Link copied.'),()=>flash('Copy failed — select and copy manually.')); }
function joinWorkspace(){ if(!requireCap('setup'))return; const code=$('#joinCode').value.trim(); if(code.length<8){alert('That code looks too short.');return;} WS=code; writeWStoHash(WS); localStorage.setItem('ttb_ws',WS); boot(true); flash('Switched workspace.'); switchView('dashboard'); }
function exportJson(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`ttb-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);}
function exportCsv(){const head=['Date','Account','Transaction','Spirit','WineGallons','Proof','ProofGallons','TaxDetermined','Reference','Notes'];const rows=state.entries.map(e=>{const t=TXBYID[e.type];return [e.date,t.account,t.label,e.spirit,e.wg,e.proof,e.pg,t.taxable?'YES':'',e.ref||'',e.notes||''].map(csv).join(',');});const blob=new Blob([head.join(',')+'\n'+rows.join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`ttb-ledger-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);}
const csv=v=>{v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
function importJson(file){if(!requireCap('setup'))return;const r=new FileReader();r.onload=()=>{try{const p=JSON.parse(r.result);if(!p.entries)throw 0;if(!confirm('Restore will replace the data in this workspace. Continue?'))return;state=normalize(p);save('Restored a backup file');loadSettingsForm();refreshAll();flash('Backup restored — '+state.entries.length+' entries.');}catch(e){alert('That file could not be read as a valid backup.');}};r.readAsText(file);}
function clearAll(){if(!requireCap('setup'))return;if(!confirm('Erase ALL data in this workspace? Export a backup first if unsure.'))return;state=freshState();save('Erased the entire workspace');loadSettingsForm();refreshAll();flash('Workspace erased.');}

/* ================= Sample ================= */
function loadSample(){
  if(!requireCap('setup'))return;
  if(state.entries.length&&!confirm('Add sample data on top of existing entries?'))return;
  const y=new Date().getFullYear();const S=(m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const add=(date,type,spirit,wg,proof,ref)=>state.entries.push({id:uid(),date,type,spirit,wg,proof,pg:pgCalc(wg,proof),ref,notes:''});
  add(S(1,8),'prod_distilled','Bourbon',420,140,'Run 24-01');add(S(1,9),'prod_to_stor','Bourbon',420,140,'To rickhouse A');
  add(S(2,3),'prod_distilled','Rye',300,145,'Run 24-02');add(S(2,4),'prod_to_stor','Rye',300,145,'To rickhouse A');
  add(S(2,20),'stor_loss','Bourbon',18,140,'Angels share');add(S(3,12),'stor_to_proc','Bourbon',260,140,'Dump');
  add(S(3,14),'proc_bottled','Bourbon',260,100,'Batch B-11');add(S(3,15),'proc_taxpaid','Bourbon',255,100,'Shipment #1001');
  add(S(4,2),'prod_distilled','Gin',180,120,'Run 24-05');add(S(4,3),'prod_to_proc','Gin',180,120,'To processing');
  add(S(4,18),'proc_taxpaid','Gin',175,90,'Shipment #1002');add(S(5,9),'stor_to_proc','Rye',150,145,'Dump');
  add(S(5,11),'proc_taxpaid','Rye',148,100,'Shipment #1003');add(S(7,7),'stor_to_proc','Bourbon',200,140,'Dump');
  add(S(7,9),'proc_taxpaid','Bourbon',198,100,'Shipment #1010');add(S(8,1),'proc_taxfree','Bourbon',60,100,'Export EU');
  state.ky.monthly[`${y}-03`]={gallons:255,cases:106,sales:19100};
  state.ky.monthly[`${y}-04`]={gallons:175,cases:73,sales:12250};
  state.ky.barrel[y]={value:2400000,rate:0.85};
  const ab=(no,spirit,fill,proof,wg,wh,loc,origin,extra)=>state.barrels.push(Object.assign({id:uid(),barrelNo:no,spirit,fillDate:fill,entryProof:proof,fillWG:wg,size:'53 gal (standard)',char:'#4',cooperage:'',warehouse:wh,location:loc,origin:origin||'Produced here',status:'Aging',notes:''},extra||{}));
  ab('24-0101','Bourbon',`${y-2}-01-15`,125,53,'Rickhouse A','R1-F1-T1');
  ab('24-0102','Bourbon',`${y-2}-01-15`,125,53,'Rickhouse A','R1-F1-T2');
  ab('24-0140','Rye',`${y-1}-06-03`,120,53,'Rickhouse A','R4-F2-T3');
  ab('23-0210','Bourbon',`${y-3}-09-20`,110,53,'Rickhouse B','R2-F3-T1');
  ab('TIB-9001','Bourbon',`${y-1}-03-11`,120,53,'Rickhouse B','R6-F1-T4','Received in bond (TIB)',{origin:'Received in bond (TIB)',sourceDSP:'Partner Distillery LLC',sourcePermit:'DSP-KY-20099',tibInDate:`${y-1}-03-11`});
  save('Loaded sample data');refreshAll();flash('Sample data loaded.');
}

/* ================= UI plumbing ================= */
let _navPop=false;
function syncCrumbTop(){ try{ const h=document.querySelector('header.app'); const c=document.getElementById('crumb'); if(h&&c) c.style.top=Math.round(h.getBoundingClientRect().height)+'px'; }catch(e){} }
window.addEventListener('resize',syncCrumbTop);
window.addEventListener('popstate',function(e){ _navPop=true; try{ switchView((e.state&&e.state.mv)||'home'); } finally { _navPop=false; } });
function renderCrumb(v){
  const c=document.getElementById('crumb'); if(!c) return;
  if(v==='home'){ c.style.display='none'; c.innerHTML=''; return; }
  const PARENT={lrs:'home',dashboard:'lrs',reports:'lrs',kentucky:'lrs',ledger:'lrs',entry:'lrs',barrels:'lrs',bottling:'lrs',finished:'lrs',orders:'lrs',customers:'lrs',labels:'lrs',retail:'home',salesrpt:'home',data:'home',compliance:'home',marketing:'home',payroll:'home',barrelsproc:'home',reviews:'home',expenses:'home',pnl:'home'};
  const LABEL={home:'Home',lrs:'Louisville Rickhouse Systems',dashboard:'Dashboard',reports:'Federal Reports',kentucky:'Kentucky',ledger:'Ledger',entry:'Add Entry',barrels:'Barrels',bottling:'Bottling',finished:'Finished Goods',orders:'Orders',customers:'Customers',labels:'Case Labels',retail:'Retail Sales',salesrpt:'Sales Report',data:'Setup & Sync',compliance:'Licenses and Forms',marketing:'Marketing',payroll:'Payroll',barrelsproc:'Barrels in Process',reviews:'Google Reviews',expenses:'Overhead & Expenses',pnl:'Rough P&L'};
  const trail=[]; let node=v, seen={}; while(node && !seen[node]){ seen[node]=1; trail.unshift(node); node=PARENT[node]; }
  if(trail[0]!=='home') trail.unshift('home');
  c.style.display=''; syncCrumbTop();
  c.innerHTML='<div class="wrap">'+trail.map((t,i)=>{
    const last=i===trail.length-1;
    if(last) return `<span class="cur">${esc(LABEL[t]||t)}</span>`;
    return `<button onclick="switchView('${t}')">${i===0?'\u2190 ':''}${esc(LABEL[t]||t)}</button><span class="sep">/</span>`;
  }).join('')+'</div>';
}
function switchView(v){renderCrumb(v);$$('.view').forEach(s=>s.classList.toggle('active',s.id==='view-'+v));window.scrollTo({top:0,behavior:'smooth'});if(v==='home')renderHome();if(v==='lrs')renderLrs();if(v==='labels')renderLabels();if(v==='compliance')renderCompliance();if(v==='marketing')renderMarketing();if(v==='ledger')renderLedger();if(v==='reports')renderReport();if(v==='dashboard')renderDashboard();if(v==='kentucky')renderKy();if(v==='retail')renderRetail();if(v==='salesrpt')renderSalesReport();if(v==='barrels')renderBarrels();if(v==='bottling')renderBottling();if(v==='finished')renderFinished();if(v==='orders')renderOrders();if(v==='customers')renderCustomers();if(v==='payroll')renderPayroll();if(v==='barrelsproc')renderBarrelsProc();if(v==='reviews')renderReviews();if(v==='expenses')renderExpenses();if(v==='pnl')renderPnl();if(v==='data')qbRefresh();if(!_navPop){try{history.pushState({mv:v},'');}catch(e){}}}
function fillYearSelects(){const yrs=new Set(state.entries.map(e=>yearOf(e.date)));yrs.add(state.settings.year);yrs.add(new Date().getFullYear());const arr=[...yrs].sort((a,b)=>b-a);$('#ledgerYear').innerHTML=`<option value="">All years</option>`+arr.map(y=>`<option>${y}</option>`).join('');}
function updateBadge(){$('#dspBadge').innerHTML=state.settings.name?`<b>${state.settings.name}</b>${state.settings.permit||''}`:`<b>Set up your DSP</b>Setup &amp; Sync tab`;}
function refreshAll(){try{runSyncRepair();}catch(e){}updateBadge();fillYearSelects();renderHome();renderTasks();renderLrs();renderLabels();renderCompliance();renderMarketing();renderBarrelsProc();try{renderExpenses();}catch(e){}renderDashboard();renderLedger();initReportControls();renderReport();initKyControls();renderKy();renderBarrels();renderBottling();renderFinished();renderOrders();renderCustomers();renderUsers();renderBackups();dataStatus();syncUI();applyPermissions();}
function dataStatus(){$('#dataStatus').innerHTML=`Tracking <b>${state.entries.length}</b> entries in workspace <span class="code">${WS.slice(0,8)}…</span>. Sync: <b>${cloudAvailable?'on (this link, all devices)':'offline — saved on this device'}</b>.`;}
let flashT;function flash(m){let el=$('#flash');if(!el){el=document.createElement('div');el.id='flash';el.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#241812;color:#fff;padding:12px 20px;border-radius:10px;font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;box-shadow:0 8px 30px rgba(0,0,0,.3);z-index:200;opacity:0;transition:opacity .2s';document.body.appendChild(el);}el.textContent=m;el.style.opacity='1';clearTimeout(flashT);flashT=setTimeout(()=>el.style.opacity='0',2200);}
function printReport(){const o=$('#view-reports');o.classList.add('printing');window.print();setTimeout(()=>o.classList.remove('printing'),500);}
async function fedPdf(){
  if(!requireCap('reports'))return;
  const k=$('#rptKind').value;
  if(k==='excise') return fillExcise();
  if(k==='storage') return fillStorage();
  if(k==='processing') return fillProcessing();
  alert('The official-form fill for the Production report is being built next.');
}
function stCol(b){ const s=((b.spiritType||'')+' '+(b.spirit||'')).toLowerCase();
  if(/vodka/.test(s))return 'h'; if(/agave|tequila/.test(s))return 'k'; if(/\brum\b/.test(s))return 'f';
  if(/brandy/.test(s))return 'd'; if(/\bgin\b/.test(s))return 'g'; return 'b'; }
function monthBounds(y,m){ const ms=`${y}-${String(m).padStart(2,'0')}-01`; const me=`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-01`; return [ms,me]; }
function storageForm(y,m){
  const [ms,me]=monthBounds(y,m);
  const cols=['b','c','d','e','f','g','h','i','j','k','l'];
  const C={}; cols.forEach(c=>C[c]={open:0,dep:0,proc:0,loss:0,close:0});
  // On-hand / deposits from the barrel register (entry proof gallons)
  (state.barrels||[]).forEach(bl=>{ if(bl.fromBottling)return; const pg=barrelPG(bl); if(!(pg>0))return; const col=stCol(bl); if(!C[col])return;
    const tib=bl.origin==='Received in bond (TIB)';
    const dep=tib?(bl.tibInDate||bl.fillDate||bl.distillDate):(bl.fillDate||bl.distillDate);
    const wd=bl.status==='Dumped'?bl.dumpDate:(bl.status==='Transferred out (TIB)'?bl.tibOutDate:null);
    if(dep&&dep<ms&&(!wd||wd>=ms))C[col].open+=pg;
    if(dep&&dep>=ms&&dep<me)C[col].dep+=pg;
    if(dep&&dep<me&&(!wd||wd>=me))C[col].close+=pg;
  });
  // Withdrawals from the month's dumps: bottled PG -> processing, (entry-bottled) -> storage loss
  (state.bottlings||[]).filter(bt=>bt.date>=ms&&bt.date<me).forEach(bt=>{
    let col=stCol({spirit:bt.spirit||''}); if(!C[col])col='b';
    const bottled=+bt.pg||0; const dumped=(bt.dumpPG!=null?+bt.dumpPG:bottled);
    C[col].proc+=bottled; C[col].loss+=Math.max(0,dumped-bottled);
  });
  const tot={open:0,dep:0,proc:0,loss:0,close:0}; cols.forEach(c=>['open','dep','proc','loss','close'].forEach(k=>tot[k]+=C[c][k]));
  ['open','dep','proc','loss','close'].forEach(k=>{cols.forEach(c=>C[c][k]=round1(C[c][k]));tot[k]=round1(tot[k]);});
  C['m']=tot; return C;
}
async function fillStorage(){
  const ym=$('#rptMonth').value; if(!ym){ alert('Choose a month.'); return; }
  const [y,m]=ym.split('-').map(Number);
  try{ await ensurePdfLib(); }catch(e){ alert('Could not load the PDF library (need internet).'); return; }
  let bytes; try{ bytes=await loadForm('/5110_11.pdf'); }catch(e){ alert('Add the (upright) blank form to your repo at public/5110_11.pdf and redeploy.'); return; }
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const doc=await PDFDocument.load(bytes); const pg=doc.getPages()[0]; const H=pg.getHeight();
  const font=await doc.embedFont(StandardFonts.Helvetica); const col=rgb(0,0,0.5);
  const put=(x,yTop,t,size=8)=>pg.drawText(String(t),{x,y:H-yTop,size,font,color:col});
  const s=state.settings; const f1=n=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
  const C=storageForm(y,m);
  const colx={b:178,c:245,d:312,e:378,f:449,g:515,h:582,i:654,j:721,k:787,l:858,m:921};
  const R={r1:172,r2:187,r6:247,r17:413,r22:488,r23:503,r24:518};
  Object.keys(colx).forEach(c=>{ const d=C[c]; if(!d)return; if(c!=='m'&&!(d.open||d.dep||d.proc||d.loss||d.close))return;
    put(colx[c],R.r1,f1(d.open)); put(colx[c],R.r2,f1(d.dep)); put(colx[c],R.r6,f1(round1(d.open+d.dep)));
    if(d.proc)put(colx[c],R.r17,f1(d.proc)); if(d.loss)put(colx[c],R.r22,f1(d.loss)); put(colx[c],R.r23,f1(d.close)); put(colx[c],R.r24,f1(round1(d.proc+d.loss+d.close)));
  });
  if(C['k']&&(C['k'].open||C['k'].close||C['k'].dep)) put(787,158,'Agave',7);
  put(820,52,String(m),9); put(858,52,String(y),9);
  put(550,82,s.name||'',8);
  if(s.addr1||s.addr2)put(550,124,[s.addr1,s.addr2].filter(Boolean).join(', '),8);
  put(830,124,s.permit||'',8); put(830,82,s.ein||'',8);
  put(650,560,new Date().toLocaleDateString('en-US'),8); put(650,585,(s.signer||'')+(s.title?(' — '+s.title):''),8); put(870,560,s.name||'',8);
  const out=await doc.save(); const blob=new Blob([out],{type:'application/pdf'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`5110-11_${y}-${String(m).padStart(2,'0')}.pdf`; a.click();
}
function processingForm(y,m){
  const [ms,me]=monthBounds(y,m);
  const tax=e=>TXBYID[e.type]&&TXBYID[e.type].taxable;
  const bottled=round1((state.bottlings||[]).filter(b=>b.date>=ms&&b.date<me).reduce((s,b)=>s+(+b.pg||0),0));
  const withdrawn=round1((state.entries||[]).filter(e=>tax(e)&&e.date>=ms&&e.date<me).reduce((s,e)=>s+(+e.pg||0),0));
  const fgAt=D=>round1((state.bottlings||[]).filter(b=>b.date<D).reduce((s,b)=>s+(+b.pg||0),0)-(state.entries||[]).filter(e=>tax(e)&&e.date<D).reduce((s,e)=>s+(+e.pg||0),0));
  const open=fgAt(ms); const close=round1(open+bottled-withdrawn);
  return {bottled,withdrawn,open,close};
}
async function fillProcessing(){
  const ym=$('#rptMonth').value; if(!ym){ alert('Choose a month.'); return; }
  const [y,m]=ym.split('-').map(Number);
  try{ await ensurePdfLib(); }catch(e){ alert('Could not load the PDF library (need internet).'); return; }
  let bytes; try{ bytes=await loadForm('/5110_28.pdf'); }catch(e){ alert('Add the blank form to your repo at public/5110_28.pdf and redeploy.'); return; }
  const { PDFDocument } = PDFLib; const doc=await PDFDocument.load(bytes); const form=doc.getForm();
  const set=(n,v)=>{ try{ form.getTextField(n).setText(String(v)); }catch(e){} };
  const s=state.settings; const f2=n=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const P=processingForm(y,m);
  set('1  PLANT NUMBER',s.permit||''); set('2  MONTH AND YEAR',`${String(m).padStart(2,'0')}/${y}`);
  set('3  NAME OF PROPRIETOR',s.name||''); set('5 Employer Identification Number EIN',s.ein||'');
  set('4 LOCATION OF PLANT',[s.addr1,s.addr2].filter(Boolean).join(', '));
  set('SPIRITS Proof gallons c1 ON HAND FIRST OF MONTH','0.00');
  set('SPIRITS Proof gallons c2 RECEIVED  Other than line 3',f2(P.bottled));
  set('SPIRITS Proof gallons c8 TOTAL  LINES 1 THROUGH 7',f2(P.bottled));
  set('SPIRITS Proof gallons c9 BOTTLED OR PACKAGED',f2(P.bottled));
  set('SPIRITS Proof gallons c25 ON HAND END OF MONTH','0.00');
  set('SPIRITS Proof gallons c26 TOTAL  LINES 9 THROUGH 25',f2(P.bottled));
  set('BOTTLED Proof gallons b27 ON HAND FIRST OF MONTH',f2(P.open));
  set('BOTTLED Proof gallons b28 BOTTLED OR PACKAGED',f2(P.bottled));
  set('BOTTLED Proof gallons b31 TOTAL  LINES 27 THROUGH 30',f2(round1(P.open+P.bottled)));
  set('BOTTLED Proof gallons b33 WITHDRAWN TAX DETERMINED',f2(P.withdrawn));
  set('BOTTLED Proof gallons b46 ON HAND END OF MONTH',f2(P.close));
  set('BOTTLED Proof gallons b47 TOTAL  LINES 32 THROUGH 46',f2(round1(P.withdrawn+P.close)));
  const out=await doc.save(); const blob=new Blob([out],{type:'application/pdf'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`5110-28_${y}-${String(m).padStart(2,'0')}.pdf`; a.click();
}
async function loadForm(path){ const r=await fetch(path); if(!r.ok) throw new Error('missing'); return r.arrayBuffer(); }
async function fillExcise(){
  const v=$('#rptQuarter').value; if(!v){ alert('Choose a quarter.'); return; }
  const [y,q]=v.split('-').map(Number);
  const inQ=e=>yearOf(e.date)===y&&quarterOf(e.date)===q;
  const qpg=taxablePG(inQ), prior=ytdTaxableBeforeQuarter(y,q); const {tax}=cbmaTax(prior,qpg);
  try{ await ensurePdfLib(); }catch(e){ alert('Could not load the PDF library (need internet).'); return; }
  let bytes; try{ bytes=await loadForm('/5000_24.pdf'); }catch(e){ alert('Add the blank form to your repo at public/5000_24.pdf and redeploy, then try again.'); return; }
  const { PDFDocument } = PDFLib; const doc=await PDFDocument.load(bytes); const form=doc.getForm();
  const set=(n,v)=>{ try{ form.getTextField(n).setText(String(v)); }catch(e){} };
  const s=state.settings; const fmt2=n=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const qm=q*3, begin=`${String((q-1)*3+1).padStart(2,'0')}/01/${y}`, endDay=new Date(y,qm,0).getDate(), end=`${String(qm).padStart(2,'0')}/${String(endDay).padStart(2,'0')}/${y}`;
  set('Serial_Number',`${y}-${q}`); set('Payment_Amount',fmt2(tax));
  set('Beginning',begin); set('Ending',end);
  set('Employer_ID',s.ein||''); set('Plant_No',s.permit||'');
  set('Taxpayer_Address',[s.name,s.addr1,s.addr2].filter(Boolean).join('\n'));
  set('Tax.9',fmt2(tax)); set('Tax.17',fmt2(tax)); set('Tax.18','0.00'); set('Tax.19',fmt2(tax)); set('Tax.20','0.00'); set('Tax.21',fmt2(tax));
  set('Title',s.title||''); set('Date_On_Form',new Date().toLocaleDateString('en-US'));
  try{ form.getCheckBox('Form_of_Payment').check(); }catch(e){}
  try{ const rg=form.getRadioGroup('Return_Covers'); const o=rg.getOptions(); rg.select(o[o.length-1]); }catch(e){}
  const out=await doc.save(); const blob=new Blob([out],{type:'application/pdf'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`5000-24_${y}-Q${q}.pdf`; a.click();
}
function printKy(){const o=$('#view-kentucky');o.classList.add('printing');window.print();setTimeout(()=>o.classList.remove('printing'),500);}

/* ================= Barrels ================= */
const BARREL_SIZES=['53 gal (standard)','59 gal (hogshead)','30 gal','15 gal','10 gal','5 gal','Other'];
const BARREL_CHARS=['—','#1','#2','#3','#4','Toasted','Other'];
const SPIRIT_TYPES=['Whiskey','Agave','Neutral / GNS','Rum','Brandy','Other'];
const SPIRIT_CLASSES=['Bourbon','Rye','Wheat','Malt','Corn','Tequila','GNS','Vodka','Rum','Brandy','Other'];
const ML_PER_GAL=3785.411784;
const bottlesToWG=(bottles,ml=750)=>round2((+bottles||0)*ml/ML_PER_GAL);
let editingBarrelId=null;
function barrelCount(b){ return Math.max(0,+b.qty||1); }
function barrelPG(b){ if(b.pgTotal!==undefined&&b.pgTotal!==null&&b.pgTotal!=='') return round1(+b.pgTotal); return round1((+b.fillWG||0)*(+b.entryProof||0)/100*barrelCount(b)); }
function barrelAge(b,endISO){ const base=b.distillDate||b.fillDate; if(!base) return 0; const f=new Date(base+'T00:00:00'), n=endISO?new Date(endISO+'T00:00:00'):new Date(); return Math.max(0,(n-f)/(365.25*24*3600*1000)); }
function fmtAge(y){ return y<1?Math.floor(y*12)+' mo':(Math.floor(y*10)/10).toFixed(1)+' yr'; }
function initBarrelForm(){
  $('#b_size').innerHTML=BARREL_SIZES.map(s=>`<option>${s}</option>`).join('');
  $('#b_char').innerHTML=BARREL_CHARS.map(c=>`<option>${c}</option>`).join('');
  $('#b_origin').onchange=toggleTibIn;
  ['b_wg','b_proof','b_qty'].forEach(id=>$('#'+id).addEventListener('input',updateBarrelPG));
  if(!$('#b_fill').value)$('#b_fill').value=new Date().toISOString().slice(0,10);
  toggleTibIn();
}
function toggleTibIn(){ $('#tibInFields').style.display=$('#b_origin').value==='Received in bond (TIB)'?'block':'none'; }
function updateBarrelPG(){ const q=Math.max(1,+$('#b_qty').value||1); $('#b_pg').textContent=numf(round1((+$('#b_wg').value||0)*(+$('#b_proof').value||0)/100*q))+' PG'+(q>1?` (${q} bbl)`:''); }
function readBarrel(){ return {barrelNo:$('#b_no').value.trim(),spirit:$('#b_spirit').value,fillDate:$('#b_fill').value,distillDate:$('#b_distill').value,mashbill:$('#b_mash').value.trim(),qty:Math.max(1,+$('#b_qty').value||1),entryProof:+$('#b_proof').value||0,fillWG:+$('#b_wg').value||0,size:$('#b_size').value,char:$('#b_char').value,cooperage:$('#b_coop').value.trim(),warehouse:$('#b_wh').value.trim(),location:$('#b_loc').value.trim(),origin:$('#b_origin').value,notes:$('#b_notes').value.trim(),sourceDSP:$('#b_srcDsp').value.trim(),sourcePermit:$('#b_srcPermit').value.trim(),tibInDate:$('#b_tibDate').value}; }
function validBarrel(d){ if(!d.fillDate){alert('Choose a fill date.');return false;} if(!(d.fillWG>0)){alert('Enter fill wine gallons greater than zero.');return false;} if(!(d.entryProof>0)){alert('Enter the entry proof.');return false;} return true; }
function saveBarrelForm(again){
  if(!requireCap('write'))return;
  const d=readBarrel(); if(!validBarrel(d))return;
  const wasB=!!editingBarrelId; const bl=(d.barrelNo?('barrel '+d.barrelNo):((d.qty>1?d.qty+' ':'')+(d.spirit||'barrel')));
  if(editingBarrelId){ const i=state.barrels.findIndex(b=>b.id===editingBarrelId); if(i>=0) state.barrels[i]=Object.assign(state.barrels[i],d); cancelBarrelEdit(true); }
  else { state.barrels.push(Object.assign({id:uid(),status:'Aging'},d)); }
  save((wasB?'Edited ':'Added ')+bl); refreshAll();
  if(again){['b_no','b_wg','b_notes','b_loc'].forEach(i=>$('#'+i).value='');updateBarrelPG();$('#b_no').focus();}
  flash('Barrel saved.');
}
function cancelBarrelEdit(silent){ editingBarrelId=null; $('#cancelBarrel').style.display='none'; $('#barrelFormTitle').textContent='Add a Barrel'; $('#saveBarrel').textContent='Save Barrel'; if(!silent){['b_no','b_wg','b_notes','b_loc','b_coop','b_srcDsp','b_srcPermit'].forEach(i=>$('#'+i).value='');updateBarrelPG();} }
function editBarrel(id){ if(!requireCap('write'))return;
  const b=state.barrels.find(x=>x.id===id); if(!b)return; editingBarrelId=id; switchView('barrels');
  $('#b_no').value=b.barrelNo||''; $('#b_spirit').value=b.spirit||'Bourbon'; $('#b_fill').value=b.fillDate||''; $('#b_distill').value=b.distillDate||''; $('#b_mash').value=b.mashbill||''; $('#b_qty').value=b.qty||1;
  $('#b_proof').value=b.entryProof||''; $('#b_wg').value=b.fillWG||''; $('#b_size').value=b.size||BARREL_SIZES[0];
  $('#b_char').value=b.char||'—'; $('#b_coop').value=b.cooperage||''; $('#b_wh').value=b.warehouse||'';
  $('#b_loc').value=b.location||''; $('#b_origin').value=b.origin||'Produced here'; $('#b_notes').value=b.notes||'';
  $('#b_srcDsp').value=b.sourceDSP||''; $('#b_srcPermit').value=b.sourcePermit||''; $('#b_tibDate').value=b.tibInDate||'';
  toggleTibIn(); updateBarrelPG(); $('#barrelFormTitle').textContent='Edit Barrel'; $('#saveBarrel').textContent='Update Barrel'; $('#cancelBarrel').style.display='inline-block';
  window.scrollTo({top:0,behavior:'smooth'});
}
function deleteBarrel(id){ if(!requireCap('delete'))return; const b=state.barrels.find(x=>x.id===id); if(!confirm('Delete this barrel record?'))return; state.barrels=state.barrels.filter(b=>b.id!==id); save('Deleted a barrel record'+(b&&b.spirit?(' — '+b.spirit):'')); refreshAll(); }
function dumpBarrel(id){ if(!requireCap('write'))return; const b=state.barrels.find(x=>x.id===id); if(!b)return; if(!confirm(`Mark barrel ${b.barrelNo||''} as dumped today?`))return; b.status='Dumped'; b.dumpDate=new Date().toISOString().slice(0,10); save('Marked a barrel dumped'); refreshAll(); flash('Barrel marked dumped.'); }
function tibOutBarrel(id){ if(!requireCap('write'))return; const b=state.barrels.find(x=>x.id===id); if(!b)return; const dest=prompt('Transfer in bond OUT — destination DSP name:',''); if(dest===null)return; b.status='Transferred out (TIB)'; b.destDSP=dest.trim(); b.tibOutDate=new Date().toISOString().slice(0,10); save('Transferred a barrel out in bond'+(dest.trim()?(' to '+dest.trim()):'')); refreshAll(); flash('Barrel transferred out (TIB).'); }
function reactivateBarrel(id){ if(!requireCap('write'))return; const b=state.barrels.find(x=>x.id===id); if(!b)return; b.status='Aging'; delete b.dumpDate; delete b.tibOutDate; delete b.destDSP; save('Reactivated a barrel'); refreshAll(); }
function barrelStatusPill(s){ const m={'Aging':'aging','Dumped':'dumped','Transferred out (TIB)':'tibout','Loss':'loss'}; return `<span class="pill ${m[s]||'aging'}">${s}</span>`; }
const SORTVAL={barrelNo:b=>(b.barrelNo||'').toLowerCase(),spirit:b=>(b.spirit||'').toLowerCase(),fillDate:b=>(b.distillDate||b.fillDate||''),age:b=>barrelAge(b),entryProof:b=>+b.entryProof||0,pg:b=>barrelPG(b),bottles:b=>bottlesForBarrel(b),warehouse:b=>((b.warehouse||'')+' '+(b.location||'')).toLowerCase(),origin:b=>(b.origin||''),status:b=>(b.status||'')};
function bottlesForBarrel(b){ if(!b||!b.dumpBottlingId) return 0; const bt=(state.bottlings||[]).find(x=>x.id===b.dumpBottlingId); return bt?(+bt.bottles||0):0; }
let barrelSort={key:'fillDate',dir:-1};
function sortBarrels(list){ const f=SORTVAL[barrelSort.key]||SORTVAL.fillDate; return list.slice().sort((a,b)=>{const va=f(a),vb=f(b); let c=(typeof va==='number'&&typeof vb==='number')?va-vb:String(va).localeCompare(String(vb)); return c*barrelSort.dir;}); }
function setBarrelSort(key){ if(barrelSort.key===key)barrelSort.dir*=-1; else{barrelSort.key=key; barrelSort.dir=(key==='fillDate'||key==='age'||key==='pg'||key==='entryProof')?-1:1;} renderBarrels(); }
function updateBarrelHeadArrows(){ document.querySelectorAll('#barrelHead th.bs').forEach(th=>{ const k=th.dataset.bsort; if(!th.dataset.label)th.dataset.label=th.textContent.replace(/[\s▲▼]+$/,''); th.textContent=th.dataset.label+(barrelSort.key===k?(barrelSort.dir>0?' ▲':' ▼'):''); }); }
function renderBarrels(){
  const bs=state.barrels||[];
  const spirits=[...new Set(bs.map(b=>b.spirit).filter(Boolean))].sort(); const cur=$('#barrelSpirit').value;
  $('#barrelSpirit').innerHTML=`<option value="">All</option>`+spirits.map(s=>`<option ${s===cur?'selected':''}>${s}</option>`).join('');
  const aging=bs.filter(b=>b.status==='Aging');
  const agingCount=aging.reduce((s,b)=>s+barrelCount(b),0);
  const agingPG=round1(aging.reduce((s,b)=>s+barrelPG(b),0));
  const tibIn=aging.filter(b=>b.origin==='Received in bond (TIB)').reduce((s,b)=>s+barrelCount(b),0);
  const avgAge=aging.length?aging.reduce((s,b)=>s+barrelAge(b)*barrelCount(b),0)/Math.max(1,agingCount):0;
  $('#barrelKpis').innerHTML=[
    kpi('barrel','Barrels Aging',agingCount.toLocaleString(),aging.length.toLocaleString()+' lots'),
    kpi('copper','Proof Gallons in Barrels',numf(agingPG),'entry (fill) basis'),
    kpi('blue','Avg Age',fmtAge(avgAge),'weighted across barrels'),
    kpi('ky','Received in Bond',tibIn.toLocaleString(),'aging TIB barrels'),
  ].join('');
  const q=($('#barrelSearch').value||'').toLowerCase(), sf=$('#barrelStatus').value, spf=$('#barrelSpirit').value;
  let rows=bs.filter(b=>{ if(sf&&b.status!==sf)return false; if(spf&&b.spirit!==spf)return false; if(q){const h=`${b.barrelNo} ${b.dumpNo||''} ${b.tiboutNo||''} ${b.spirit} ${b.warehouse} ${b.location} ${b.sourceDSP||''} ${b.destDSP||''} ${b.destPermit||''} ${b.dumpDate||''} ${b.notes||''}`.toLowerCase(); if(!h.includes(q))return false;} return true; });
  rows=sortBarrels(rows); updateBarrelHeadArrows();
  $('#barrelBody').innerHTML=rows.map(b=>{
    const origin=b.origin==='Received in bond (TIB)'?`<span class="pill tibin">TIB in</span>`:'—';
    const ap=[];
    if(b.status==='Aging'){ if(can('write')) ap.push(`<button class="link" onclick="editBarrel('${b.id}')">Edit</button>`,`<button class="link" onclick="dumpBarrel('${b.id}')">Dump</button>`,`<button class="link" onclick="tibOutBarrel('${b.id}')">TIB out</button>`); }
    else if(can('write')) ap.push(`<button class="link" onclick="reactivateBarrel('${b.id}')">Reactivate</button>`);
    if(can('delete')) ap.push(`<button class="del" onclick="deleteBarrel('${b.id}')">Del</button>`);
    const acts=ap.join(' · ');
    const cnt=barrelCount(b);
    const bt=b.dumpBottlingId?(state.bottlings||[]).find(x=>x.id===b.dumpBottlingId):null;
    const ageCell=b.status==='Aging'?fmtAge(barrelAge(b)):(b.status==='Dumped'&&b.dumpDate?`${fmtAge(barrelAge(b,b.dumpDate))}<div style="font-size:11px;color:var(--muted)">at dump</div>`:'—');
    const bottledLine=(b.status==='Dumped'&&b.dumpBottlingId)?`<div style="font-size:11px"><button class="link" onclick="openBottlingDetail('${b.dumpBottlingId}')">bottled${b.dumpNo?(' as #'+b.dumpNo):''}${bt?` · ${numf(bt.pg)} PG bottled`:''} ›</button></div>`:'';
    const bottlesCell=bt?(+bt.bottles||0).toLocaleString():'—';
    return `<tr><td><b>${b.barrelNo||b.dumpNo||(cnt>1?'Lot':'—')}</b>${cnt>1?` <span class="pill" style="background:#efe7d8;color:#7a5a2b">×${cnt}</span>`:''}${b.mashbill?`<div style="font-size:11px;color:var(--muted)">${b.mashbill}</div>`:''}${b.sourceDSP?`<div style="font-size:11px;color:var(--muted)">from ${b.sourceDSP}</div>`:''}${(b.status==='Transferred out (TIB)'&&b.destDSP)?`<div style="font-size:11px;color:#2f6f8f">→ to ${esc(b.destDSP)}${b.destPermit?(' · '+esc(b.destPermit)):''}${b.tiboutNo?(' · #'+esc(b.tiboutNo)):''}</div>`:''}${bottledLine}</td><td>${b.spirit||''}</td><td>${b.distillDate?fmtDate(b.distillDate):(b.fillDate?fmtDate(b.fillDate):'—')}${(b.origin==='Received in bond (TIB)'&&b.tibInDate)?`<div style="font-size:11px;color:var(--muted)">rec'd ${fmtDate(b.tibInDate)}</div>`:''}</td><td class="num">${ageCell}</td><td class="num">${b.entryProof>0?numf(b.entryProof,1):'—'}</td><td class="num">${numf(barrelPG(b))}</td><td class="num">${bottlesCell}</td><td>${origin}</td><td>${barrelStatusPill(b.status)}</td><td class="noprint">${acts}</td></tr>`;
  }).join('');
  $('#barrelEmpty').innerHTML=rows.length?'':`<div class="empty"><div class="big">🛢️</div>No barrels yet. Add your first barrel above, or load sample data from Setup &amp; Sync.</div>`;
  const bySpirit={}; aging.forEach(b=>{const k=b.spirit||'Other';bySpirit[k]=bySpirit[k]||{n:0,pg:0};bySpirit[k].n+=barrelCount(b);bySpirit[k].pg+=barrelPG(b);});
  const spArr=Object.keys(bySpirit).map(k=>({name:k,n:bySpirit[k].n,pg:round1(bySpirit[k].pg)}));
  const ssS=summSort.spirit; spArr.sort((a,b)=>{const d=ssS.key==='name'?String(a.name).localeCompare(String(b.name)):(a[ssS.key]-b[ssS.key]); return d*ssS.dir;});
  $('#barrelBySpirit').innerHTML=spArr.map(r=>`<tr><td>${r.name}</td><td class="num">${r.n}</td><td class="num">${numf(round1(r.pg))}</td></tr>`).join('')||`<tr><td colspan="3" style="color:var(--muted)">No aging barrels.</td></tr>`;
  const byYear={}; aging.forEach(b=>{const y=((b.distillDate||b.fillDate||'').slice(0,4))||'—';byYear[y]=byYear[y]||{n:0,pg:0};byYear[y].n+=barrelCount(b);byYear[y].pg+=barrelPG(b);});
  const yrArr=Object.keys(byYear).map(k=>({year:k,n:byYear[k].n,pg:round1(byYear[k].pg)}));
  const ssY=summSort.year; yrArr.sort((a,b)=>{const d=ssY.key==='year'?String(a.year).localeCompare(String(b.year)):(a[ssY.key]-b[ssY.key]); return d*ssY.dir;});
  $('#barrelByYear').innerHTML=yrArr.map(r=>`<tr><td>${r.year}</td><td class="num">${r.n}</td><td class="num">${numf(round1(r.pg))}</td></tr>`).join('')||`<tr><td colspan="3" style="color:var(--muted)">No aging barrels.</td></tr>`;
  renderTiboLines(); // keep the transfer-out lot picker in sync with current aging inventory
  renderTibouts(); renderTibins();
}
let summSort={spirit:{key:'n',dir:-1},year:{key:'n',dir:-1}};
function setSummSort(which,key){ const s=summSort[which]; if(s.key===key)s.dir*=-1; else{s.key=key; s.dir=(key==='name'||key==='year')?1:-1;} renderBarrels(); }
function exportBarrelsCsv(){
  const head=['BarrelNo','Spirit','Mashbill','DistillationDate','FillDate','EntryProof','FillWineGal','ProofGallons','Size','Char','Cooperage','Warehouse','Location','Origin','SourceDSP','SourcePermit','TIBInDate','Status','DumpDate','DestDSP','TIBOutDate','Notes'];
  const rows=(state.barrels||[]).map(b=>[b.barrelNo,b.spirit,b.mashbill||'',b.distillDate||'',b.fillDate,b.entryProof,b.fillWG,barrelPG(b),b.size,b.char,b.cooperage,b.warehouse,b.location,b.origin,b.sourceDSP||'',b.sourcePermit||'',b.tibInDate||'',b.status,b.dumpDate||'',b.destDSP||'',b.tibOutDate||'',b.notes||''].map(csv).join(','));
  const blob=new Blob([head.join(',')+'\n'+rows.join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`barrels-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);
}

/* ---- TIB In (multi-line receiving) ---- */
let tibRows=[];
function tibNewRow(){ return {type:'Whiskey',cls:'Bourbon',distill:'',proof:'',pg:'',qty:''}; }
function initTib(){ if(!tibRows.length) tibRows=[tibNewRow()]; if(!$('#tib_date').value)$('#tib_date').value=new Date().toISOString().slice(0,10); renderTibLines(); }
function renderTibLines(){
  const body=$('#tibLines'); if(!body) return;
  body.innerHTML=tibRows.map((r,i)=>`<tr>
    <td><select data-i="${i}" data-k="type">${SPIRIT_TYPES.map(t=>`<option ${t===r.type?'selected':''}>${t}</option>`).join('')}</select></td>
    <td><select data-i="${i}" data-k="cls">${SPIRIT_CLASSES.map(c=>`<option ${c===r.cls?'selected':''}>${c}</option>`).join('')}</select></td>
    <td><input type="date" data-i="${i}" data-k="distill" value="${r.distill||''}"></td>
    <td><input type="number" step="0.1" min="0" max="200" data-i="${i}" data-k="proof" value="${r.proof||''}" style="max-width:90px"></td>
    <td><input type="number" step="0.1" min="0" data-i="${i}" data-k="pg" value="${r.pg||''}" style="max-width:110px"></td>
    <td><input type="number" step="1" min="1" data-i="${i}" data-k="qty" value="${r.qty||''}" style="max-width:80px"></td>
    <td class="noprint">${tibRows.length>1?`<button class="del" data-del="${i}">✕</button>`:''}</td></tr>`).join('');
  body.querySelectorAll('select,input').forEach(el=>{el.onchange=el.oninput=e=>{tibRows[+e.target.dataset.i][e.target.dataset.k]=e.target.value;updateTibSummary();};});
  body.querySelectorAll('[data-del]').forEach(el=>{el.onclick=e=>{tibRows.splice(+e.target.dataset.del,1);renderTibLines();};});
  updateTibSummary();
}
function updateTibSummary(){ const nb=tibRows.reduce((s,r)=>s+(+r.qty||0),0); const pg=round1(tibRows.reduce((s,r)=>s+(+r.pg||0),0)); $('#tibSummary').textContent=nb?`${nb} barrels · ${numf(pg)} PG to receive`:''; }
function tibAddLine(){ tibRows.push(tibNewRow()); renderTibLines(); }
function tibReceive(){
  if(!requireCap('write'))return;
  const from=$('#tib_from').value.trim(), permit=$('#tib_permit').value.trim(), date=$('#tib_date').value;
  const valid=tibRows.filter(r=>(+r.qty>0)&&(+r.pg>0));
  if(!valid.length){ alert('Add at least one line with proof gallons and a barrel count.'); return; }
  if(!from){ alert('Enter the source DSP (who you received these barrels from) before receiving.'); $('#tib_from').focus(); return; }
  const lines=[];
  valid.forEach(r=>{ const q=Math.max(1,+r.qty||1); const pg=+r.pg||0;
    state.barrels.push({id:uid(),barrelNo:'',spirit:r.cls,spiritType:r.type,distillDate:r.distill,fillDate:(r.distill||date),entryProof:+r.proof||0,pgTotal:pg,qty:q,size:'53 gal (standard)',char:'',warehouse:'',location:'',origin:'Received in bond (TIB)',sourceDSP:from,sourcePermit:permit,tibInDate:date,notes:'',status:'Aging'});
    lines.push({lot:'—',dateCode:r.distill||'',spirit:(r.type?r.type+' / ':'')+(r.cls||''),qty:q,proof:+r.proof||0,pg:round1(pg),wg:0});
  });
  const nb=valid.reduce((s,r)=>s+(+r.qty||0),0);
  const rec=addTibinRecord({date:date||new Date().toISOString().slice(0,10),sourceDSP:from,sourcePermit:permit,lines,totalBarrels:nb,totalPG:round1(lines.reduce((s,l)=>s+l.pg,0))});
  save('Received '+nb+' barrel(s) in bond from '+from); tibRows=[tibNewRow()]; $('#tib_from').value=''; $('#tib_permit').value=''; renderTibLines(); refreshAll();
  const res=$('#tibResult'); if(res){ res.style.display=''; res.innerHTML=`✓ <b>${esc(rec.num)}</b> recorded — ${nb} barrel(s), ${numf(rec.totalPG)} PG from <b>${esc(from)}</b>. <button class="btn ky sm" style="margin-left:8px" onclick="printTransfer('${rec.id}')">🖨 Print receipt record</button>`; }
  flash('Received '+nb+' barrels in bond.');
}
function addTibinRecord(o){ state.tibins=state.tibins||[]; const num='TIBIN-'+String(o.date).slice(0,4)+'-'+String(state.tibins.length+1).padStart(3,'0'); const rec=Object.assign({id:uid(),num,dir:'in',by:(authOn()&&SESSION)?SESSION.name:null},o); state.tibins.push(rec); return rec; }
function normDate(s){ s=(s||'').trim(); if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s; const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if(m){let y=m[3];if(y.length===2)y='20'+y;return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;} return s; }
