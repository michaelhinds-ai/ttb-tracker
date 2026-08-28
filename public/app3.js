function kyMonthlyReport(){
  const ym=kyMonthKey();if(!ym)return '<div class="empty">Choose a month.</div>';
  const [y,m]=ym.split('-').map(Number);
  const rec=state.ky.monthly[ym]||{gallons:'',cases:'',sales:''};
  const suggest=kySuggestGallons(ym);
  const c=kyMonthlyCalc(rec);const s=state.settings;
  const monthName=new Date(y,m-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const due=addDays(`${ym}-`+new Date(y,m,0).getDate(),20);
  return reportHeader('Kentucky Monthly Distilled Spirits Return','Form 73A525 & wholesale sales / excise tax',monthName)+`
    <div class="note ky">Enter this month's Kentucky wholesale activity. Taxable gallons default from your federal tax-determined removals for the month; override if your in-state taxable gallons differ. Values auto-save to your synced workspace.</div>
    <div class="grid g3">
      <div><label class="fld">Taxable gallons (KY)</label><input type="number" id="ky_gallons" step="0.01" min="0" value="${rec.gallons!==''?rec.gallons:''}" placeholder="0.00">
        <button class="link" style="margin-top:6px" onclick="kyUseSuggest()">Use federal taxable gallons (${numf(suggest,2)})</button></div>
      <div><label class="fld">Cases sold</label><input type="number" id="ky_cases" step="1" min="0" value="${rec.cases!==''?rec.cases:''}" placeholder="0"></div>
      <div><label class="fld">Gross wholesale receipts ($)</label><input type="number" id="ky_sales" step="0.01" min="0" value="${rec.sales!==''?rec.sales:''}" placeholder="0.00"></div>
    </div>
    <div class="row-actions cap-write" style="margin:12px 0"><button class="btn ky sm" onclick="kySaveMonthly()">Save &amp; Calculate</button></div>
    <h4>Tax computation</h4>
    <table><tbody>
      <tr><td>Excise tax — ${numf(rec.gallons||0,2)} gal × ${money(s.kyExcise)}/gal</td><td class="num">${money(c.excise)}</td></tr>
      <tr><td>Wholesale sales tax — ${money(rec.sales||0)} × ${numf(s.kyWholesale,2)}%</td><td class="num">${money(c.wholesale)}</td></tr>
      <tr><td>Case sales tax — ${numf(rec.cases||0,0)} cases × ${money(s.kyCase)}/case</td><td class="num">${money(c.caseTax)}</td></tr>
      <tr class="total"><td>Total Kentucky tax for ${monthName}</td><td class="num">${money(c.total)}</td></tr>
    </tbody></table>
    <div class="taxbox ky"><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Kentucky Tax Due</div><div class="due">${money(c.total)}</div><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;margin-top:4px">Monthly returns are generally due by the 20th of the following month (by <b>${due}</b>). File with the Kentucky DOR.</div></div>
    <div class="disclaimer">Kentucky distilled-spirits taxes: excise ${money(s.kyExcise)}/gallon, wholesale sales tax ${numf(s.kyWholesale,2)}%, and case sales tax ${money(s.kyCase)}/case (rates editable in Setup). The wholesale sales tax base is your gross receipts from wholesale sales. Confirm the exact base, rate, and due date with the Kentucky Department of Revenue for your license type before filing.</div>`;
}
function kyUseSuggest(){ const ym=kyMonthKey(); $('#ky_gallons').value=kySuggestGallons(ym); }
function kySaveMonthly(){
  if(!requireCap('write'))return;
  const ym=kyMonthKey();
  state.ky.monthly[ym]={gallons:$('#ky_gallons').value===''?'':+$('#ky_gallons').value,cases:$('#ky_cases').value===''?'':+$('#ky_cases').value,sales:$('#ky_sales').value===''?'':+$('#ky_sales').value};
  save('Saved a Kentucky monthly return'); renderKy(); renderDashboard(); flash('Kentucky return saved.');
}
function kyBarrelReport(){
  const y=+$('#kyYear').value;const rec=state.ky.barrel[y]||{value:'',rate:''};
  const pct=kyPhasePct(y);
  const value=+rec.value||0, rate=+rec.rate||0;
  const base=round2(value*rate/100); // rate per $100 of assessed value
  const net=round2(base*pct/100);
  const scheduleRows=[2025,2026,2027,2028,2029,2030,2031,2032,2033,2034,2035,2036,2037,2038,2039,2040,2041,2042,2043].map(yy=>{const p=kyPhasePct(yy);return `<tr${yy===y?' class="sub" style="background:#f2edfa"':''}><td>${yy}${yy===2043?' +':''}</td><td class="num">${p}%</td></tr>`;}).join('');
  return reportHeader('Kentucky Barrel (Ad Valorem) Tax — Worksheet','Distilled spirits in bonded warehouse · HB 5 phase-out',`Assessment year ${y} (as of Jan 1)`)+`
    <div class="note ky">The barrel tax is a <b>local property tax</b> on distilled spirits aging in bonded warehouses, assessed on the January 1 inventory value. Under 2023 HB 5 the tax is phasing out: you owe <b>${pct}%</b> of the full tax for assessment year ${y}, declining to 0% in 2043. Enter your assessed value and combined local rate below.</div>
    <div class="grid g2">
      <div><label class="fld">Assessed taxable value on Jan 1 ($)</label><input type="number" id="kb_value" step="0.01" min="0" value="${rec.value!==''?rec.value:''}" placeholder="0.00"></div>
      <div><label class="fld">Combined tax rate ($ per $100 of value)</label><input type="number" id="kb_rate" step="0.0001" min="0" value="${rec.rate!==''?rec.rate:''}" placeholder="e.g. 0.85"></div>
    </div>
    <div class="row-actions cap-write" style="margin:12px 0"><button class="btn ky sm" onclick="kySaveBarrel()">Save &amp; Calculate</button></div>
    <h4>Tax computation</h4>
    <table><tbody>
      <tr><td>Full barrel tax — ${money(value)} × ${numf(rate,4)} / $100</td><td class="num">${money(base)}</td></tr>
      <tr><td>HB 5 phase-out factor for ${y}</td><td class="num">${pct}%</td></tr>
      <tr class="total"><td>Net barrel tax owed for ${y}</td><td class="num">${money(net)}</td></tr>
    </tbody></table>
    <div class="taxbox ky"><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Net Barrel Tax (${y})</div><div class="due">${money(net)}</div><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;margin-top:4px">Kentucky distillers may also qualify for an income-tax credit tied to barrel taxes paid — check current KY DOR guidance.</div></div>
    <details style="margin-top:14px"><summary style="cursor:pointer;font-family:-apple-system,Segoe UI,sans-serif;font-weight:600;color:var(--ky)">HB 5 phase-out schedule (% of tax owed)</summary>
    <div class="tablewrap" style="margin-top:10px;max-width:320px"><table><thead><tr><th>Assessment year</th><th class="num">% owed</th></tr></thead><tbody>${scheduleRows}</tbody></table></div></details>
    <div class="disclaimer">Barrel-tax rates are set locally and vary by county, city, school, and fire district — enter your combined rate per $100 of assessed value. This worksheet applies the statewide HB 5 phase-out percentage to your full computed tax. Assessment, valuation, and filing are handled through your county PVA and the Kentucky DOR; confirm your value, rate, and any available credits with them.</div>`;
}
function kySaveBarrel(){ if(!requireCap('write'))return; const y=+$('#kyYear').value; state.ky.barrel[y]={value:$('#kb_value').value===''?'':+$('#kb_value').value,rate:$('#kb_rate').value===''?'':+$('#kb_rate').value}; save('Saved KY barrel-tax worksheet'); renderKy(); flash('Barrel-tax worksheet saved.'); }

/* ---- Form 73A525 from Square ---- */
let sqLast=null;
async function sqStatus(){
  const el=$('#sqStatus'); if(!el)return;
  if(location.protocol==='file:'){ el.innerHTML='The Square report runs only on the hosted site.'; $('#sqRun').disabled=true; $('#sqSetup').disabled=true; return; }
  el.textContent='Checking Square connection…';
  try{
    const r=await fetch('/api/square/status',{cache:'no-store'}); const d=await r.json();
    if(!d.configured){ el.innerHTML='⚠️ Square isn’t connected yet. Add your <b>SQUARE_ACCESS_TOKEN</b> (Items read+write, Orders read) in Netlify, then reload.'; $('#sqRun').disabled=true; return; }
    if(!d.connected){ el.innerHTML='⚠️ Square token set but the connection failed'+(d.error?(' ('+d.error+')'):'')+'. Check the token and its scopes.'; $('#sqRun').disabled=true; return; }
    $('#sqRun').disabled=false; $('#sqSetup').disabled=false;
    const who=(d.merchant||'')+(d.locationName?(' · '+d.locationName):'');
    const tag=d.attribute?(`<b>${d.taggedBottles}</b> bottle(s) tagged`):'no bottle tags yet — click <b>Set up bottle tags</b>';
    el.innerHTML=`✅ Connected: ${who} <span style="color:var(--muted)">(${d.environment})</span><br>Bottle size attribute: ${d.attribute?'set up':'not set up'} — ${tag}.`;
  }catch(e){ el.textContent='Could not reach the Square status endpoint.'; }
}
const RTL_BOTTLE_HINT=/\b(bourbon|rye|whisk|spirit|bottle|gin|vodka|rum|tequila|agave|liqueur|moonshine|single ?barrel|small ?batch|blend|750|375)\b/i;
async function sqSetup(){
  if(!requireCap('setup'))return;
  const el=$('#sqStatus'), out=$('#sqOut'), btn=$('#sqSetup');
  el.textContent='Reading your Square categories…'; btn.disabled=true;
  let pre;
  try{ const r=await fetch('/api/square/setup-tags',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})}); pre=await r.json(); }
  catch(e){ el.textContent='Could not reach Square.'; btn.disabled=false; return; }
  btn.disabled=false;
  if(pre.error){ el.innerHTML='⚠️ '+esc(pre.detail||pre.error); return; }
  const accts=pre.accounts||[];
  const acctName=a=>a.label||('Account '+(a.key==='a2'?2:1));
  const saved=(state.settings&&state.settings.bottleCats)||{};
  el.textContent='Check the categories that are actual distilled-spirits bottles, then tag them.';
  out.innerHTML=accts.map(a=>{
    if(!a.ok) return `<div class="note" style="border-color:#a33"><b>${esc(acctName(a))}</b> — couldn’t read catalog: ${esc(a.detail||a.error)}</div>`;
    const savedSet=new Set(saved[a.key]||[]); const useSaved=savedSet.size>0;
    const cats=a.categories||[];
    const head=`<div class="note ky"><b>${esc(acctName(a))}</b> — ${cats.length} categor${cats.length===1?'y':'ies'}, ${a.itemCount} item(s)${a.uncategorized?`, ${a.uncategorized} uncategorized`:''}. Check the bottle categories:</div>`;
    const rows=cats.map(c=>{
      const on=useSaved?savedSet.has(c.id):RTL_BOTTLE_HINT.test(c.name);
      return `<label style="display:flex;gap:9px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #eee2d0;font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;cursor:pointer">`+
        `<input type="checkbox" data-acct="${a.key}" value="${esc(c.id)}" ${on?'checked':''} style="margin-top:3px;width:16px;height:16px;flex:none">`+
        `<span><b>${esc(c.name)}</b> <span style="color:var(--muted)">· ${c.count} item${c.count===1?'':'s'}</span>`+
        (c.samples&&c.samples.length?`<div style="color:var(--muted);font-size:12px;margin-top:2px">${c.samples.map(esc).join(' · ')}</div>`:'')+`</span></label>`;
    }).join('');
    return head+`<div style="margin:4px 0 16px">${rows||'<div class="hint">No categories found.</div>'}</div>`;
  }).join('')+
    `<div class="row-actions"><button class="btn ky" id="sqTagGo">Tag checked categories as bottles</button><span class="hint" style="margin:0">Adds a 750/375 size tag only — no price or name changes. Feeds the Kentucky 73A525 counts.</span></div>`;
  const go=$('#sqTagGo'); if(go) go.onclick=sqCommitTags;
}
async function sqCommitTags(){
  if(!requireCap('setup'))return;
  const sel={};
  document.querySelectorAll('#sqOut input[type=checkbox][data-acct]:checked').forEach(cb=>{ (sel[cb.dataset.acct]=sel[cb.dataset.acct]||[]).push(cb.value); });
  const total=Object.values(sel).reduce((s,a)=>s+a.length,0);
  if(!total){ alert('Check at least one bottle category first.'); return; }
  if(!confirm(`Tag every item in the ${total} checked categor${total===1?'y':'ies'} with its size (750, or 375 when the name says 375)? This only adds a size tag — no price or name changes.`)) return;
  const el=$('#sqStatus'); el.textContent='Tagging bottle items in Square…';
  try{
    const r=await fetch('/api/square/setup-tags',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commit:true,selections:sel})}); const d=await r.json();
    if(d.error){ el.innerHTML='⚠️ '+esc(d.detail||d.error); return; }
    if(can('write')){ state.settings.bottleCats=sel; save('Saved Square bottle categories'); }
    const acctName=a=>a.label||('Account '+(a.key==='a2'?2:1));
    $('#sqOut').innerHTML=(d.accounts||[]).map(a=>{
      if(!a.ok) return `<div class="note" style="border-color:#a33"><b>${esc(acctName(a))}</b> — ${esc(a.detail||a.error)}</div>`;
      const failed=a.failed||[];
      const list=(a.tagged||[]).concat(a.skipped||[]).sort((x,y)=>x.name.localeCompare(y.name));
      return `<div class="note ky"><b>${esc(acctName(a))}</b>: tagged ${(a.tagged||[]).length}, already set ${(a.skipped||[]).length}${a.definitionCreated?', created the size attribute':''}${failed.length?`, <b style="color:#a33">${failed.length} failed</b>`:''}.</div>`+
        (failed.length?`<div class="note" style="border-color:#a33">Failed: ${failed.map(x=>esc(x.name)+' — '+esc(x.error)).join('; ')}</div>`:'')+
        (list.length?`<div class="tablewrap"><table><thead><tr><th>Bottle</th><th class="num">mL</th></tr></thead><tbody>`+list.map(x=>`<tr><td>${esc(x.name)}</td><td class="num">${x.size}</td></tr>`).join('')+`</tbody></table></div>`:'');
    }).join('');
    el.textContent='Done. Re-pull a day on the Retail tab to see the bottle counts.'; sqStatus();
  }catch(e){ el.textContent='Tagging failed to reach Square.'; }
}
async function sqRun(){
  if(!requireCap('reports'))return;
  const ym=$('#sqMonth').value; if(!ym){ alert('Choose a reporting month.'); return; }
  const [y,m]=ym.split('-').map(Number);
  $('#sqOut').innerHTML='<div class="empty">Pulling Square sales for '+ym+'…</div>'; $('#sqCsv').style.display='none'; $('#sqPrint').style.display='none';
  try{
    const r=await fetch('/api/square/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({year:y,month:m})});
    const d=await r.json();
    if(d.error){ $('#sqOut').innerHTML='<div class="note">⚠️ '+(d.detail||d.error)+'</div>'; return; }
    sqLast=d; renderSqReport(d);
    $('#sqPdf').style.display='inline-flex'; $('#sqCsv').style.display='inline-flex'; $('#sqPrint').style.display='inline-flex';
  }catch(e){ $('#sqOut').innerHTML='<div class="note">Could not reach the Square report endpoint.</div>'; }
}
function renderSqReport(d){
  const f=d.form; const mName=new Date(d.year,d.month-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const due=new Date(d.year,d.month,20).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const rows=d.products.map(p=>`<tr><td>${p.name}</td><td class="num">${p.ml}</td><td class="num">${money(p.retail)}</td><td class="num">${p.sold}</td><td class="num">${p.samp}</td><td class="num">${p.total}</td><td class="num">${money(p.fobPerBottle)}</td><td class="num">${money(p.wholesaleBase)}</td><td class="num">${numf(p.sold9L,2)}</td><td class="num">${numf(p.samp9L,2)}</td></tr>`).join('');
  $('#sqOut').innerHTML=reportHeader('Kentucky Form 73A525 — Retail / Gift Shop','Distilled spirits excise (Part I) + 11% wholesale sales tax (Part II)',mName)+`
    <div class="note ky">Pulled from Square (${d.orderCount} completed orders, main location). <b>${d.bottlesSold}</b> bottles sold + <b>${d.bottlesSampled}</b> samples. Reconcile against your gauge/records before filing.</div>
    <div class="tablewrap"><table><thead><tr><th>Product</th><th class="num">mL</th><th class="num">Retail</th><th class="num">Sold</th><th class="num">Samp</th><th class="num">Total</th><th class="num">FOB/btl</th><th class="num">Wholesale base</th><th class="num">Sold 9L</th><th class="num">Samp 9L</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h4>Part I — Distilled Spirits Excise (9-liter cases)</h4>
    <table><tbody>
      <tr><td>Line 1 — Gift-shop retail (9L cases)</td><td class="num">${numf(f.line1,2)}</td></tr>
      <tr><td>Line 2 — Samples / bar (9L cases)</td><td class="num">${numf(f.line2,2)}</td></tr>
      <tr><td>Line 4 / 6 — Total taxable cases</td><td class="num">${numf(f.line6,2)}</td></tr>
      <tr><td>Line 7 — Rate per 9L case</td><td class="num">${money(f.line7rate)}</td></tr>
      <tr class="total"><td>Line 11 — Excise tax due</td><td class="num">${money(f.line11)}</td></tr>
    </tbody></table>
    <h4>Part II — Wholesale Sales Tax</h4>
    <table><tbody>
      <tr><td>Line 12 — Gross wholesale receipts (FOB = 40% of retail)</td><td class="num">${money(f.line12)}</td></tr>
      <tr class="total"><td>Line 15 — Wholesale sales tax due (11%)</td><td class="num">${money(f.line15)}</td></tr>
    </tbody></table>
    <div class="taxbox ky"><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Total 73A525 Due (Line 16)</div><div class="due">${money(f.line16)}</div><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;margin-top:4px">Due by the 20th of next month (by <b>${due}</b>). Check payable to Kentucky State Treasurer, Excise Tax Section, Frankfort, KY 40619.</div></div>
    <div class="disclaimer">Excludes Back Office / distributor invoices (those belong on a separate self-distribution filing). Assumes zero returns. "Fill Your Own Bottle" is treated as a 750 ml bottle. Reconcile with your records and confirm rates with the Kentucky DOR before filing.</div>`;
}
function ensurePdfLib(){ return new Promise((res,rej)=>{ if(window.PDFLib)return res(); const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'; s.onload=()=>res(); s.onerror=()=>rej(new Error('pdf-lib failed to load')); document.head.appendChild(s); }); }
async function sqPdf(){
  if(!sqLast){ return; }
  const fmt2=n=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  try{ await ensurePdfLib(); }catch(e){ alert('Could not load the PDF library (need internet).'); return; }
  let bytes;
  try{ const r=await fetch('/73A525.pdf'); if(!r.ok) throw 0; bytes=await r.arrayBuffer(); }
  catch(e){ alert('Put the blank form in your repo at public/73A525.pdf and redeploy, then try again.'); return; }
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const doc=await PDFDocument.load(bytes);
  const pg=doc.getPages()[0]; const H=pg.getHeight();
  const font=await doc.embedFont(StandardFonts.Helvetica);
  const col=rgb(0,0,0.5);
  const put=(x,yTop,t,size=9)=>pg.drawText(String(t),{x,y:H-yTop,size,font,color:col});
  const s=state.settings, f=sqLast.form;
  const mName=new Date(sqLast.year,sqLast.month-1,1).toLocaleDateString('en-US',{month:'long'});
  put(30,124,s.name||''); if(s.addr1)put(30,136,s.addr1); if(s.addr2)put(30,148,s.addr2);
  put(400,168,mName,10); put(556,181,String(sqLast.year).slice(2),10);
  put(420,236,fmt2(f.line1)); put(420,267,fmt2(f.line2));
  put(420,314,fmt2(f.line4)); put(420,369,fmt2(f.line6));
  put(421,428,fmt2(f.line8));
  put(486,448,fmt2(f.line9)); put(486,479,fmt2(f.line11));
  put(486,532,fmt2(f.line12)); put(486,548,fmt2(f.line13));
  put(486,579,fmt2(f.line15)); put(486,631,fmt2(f.line16));
  const outBytes=await doc.save();
  const blob=new Blob([outBytes],{type:'application/pdf'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`73A525_${sqLast.year}-${String(sqLast.month).padStart(2,'0')}.pdf`; a.click();
}
function sqCsv(){
  if(!sqLast)return; const p=sqLast.products;
  const head=['Product','mL','Retail','Sold','Samples','Total','FOB per bottle','Wholesale base','Sold 9L','Sample 9L'];
  const lines=[head.join(',')].concat(p.map(x=>[x.name,x.ml,x.retail,x.sold,x.samp,x.total,x.fobPerBottle,x.wholesaleBase,round2(x.sold9L),round2(x.samp9L)].map(csv).join(',')));
  const f=sqLast.form;
  lines.push(''); lines.push(['','','','','','','','','','' ].join(','));
  lines.push(['73A525 Line','Value'].join(','));
  [['Line 1 gift-shop 9L cases',f.line1],['Line 2 sample 9L cases',f.line2],['Line 6 total cases',f.line6],['Line 7 rate',f.line7rate],['Line 11 excise due',f.line11],['Line 12 wholesale base',f.line12],['Line 15 wholesale tax due',f.line15],['Line 16 TOTAL DUE',f.line16]].forEach(r=>lines.push(r.map(csv).join(',')));
  const blob=new Blob([lines.join('\n')],{type:'text/csv'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`73A525_${sqLast.year}-${String(sqLast.month).padStart(2,'0')}.csv`; a.click();
}
/* ---- Retail sales & use tax collected (Square) ---- */
let stxLast=null;
async function stxStatus(){
  const el=$('#stxStatus'); if(!el)return;
  if(location.protocol==='file:'){ el.innerHTML='The Square sales-tax report runs only on the hosted site.'; $('#stxRun').disabled=true; return; }
  el.textContent='Checking Square connection…';
  try{
    const r=await fetch('/api/square/status',{cache:'no-store'}); const d=await r.json();
    if(!d.configured){ el.innerHTML='⚠️ Square isn’t connected yet. Add your <b>SQUARE_ACCESS_TOKEN</b> in Netlify, then reload.'; $('#stxRun').disabled=true; return; }
    if(!d.connected){ el.innerHTML='⚠️ Square token set but the connection failed'+(d.error?(' ('+d.error+')'):'')+'.'; $('#stxRun').disabled=true; return; }
    $('#stxRun').disabled=false;
    el.innerHTML=`✅ Connected: ${d.merchant||''} <span style="color:var(--muted)">(${d.environment})</span>`;
  }catch(e){ el.textContent='Could not reach the Square status endpoint.'; }
}
async function stxRun(){
  if(!requireCap('reports'))return;
  const ym=$('#stxMonth').value; if(!ym){ alert('Choose a reporting month.'); return; }
  const [y,m]=ym.split('-').map(Number);
  $('#stxOut').innerHTML='<div class="empty">Pulling sales tax for '+ym+'…</div>'; $('#stxCsv').style.display='none'; $('#stxPrint').style.display='none';
  try{
    const [d,xd]=await Promise.all([
      fetch('/api/square/salestax',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({year:y,month:m})}).then(r=>r.json()),
      fetch('/api/xola/salestax',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({year:y,month:m,basis:'collected'})}).then(r=>r.json()).catch(()=>null),
    ]);
    if(d.error){ $('#stxOut').innerHTML='<div class="note">⚠️ '+(d.detail||d.error)+'</div>'; return; }
    d.xola=(xd&&xd.configured&&!xd.error)?xd:null;
    stxLast=d; renderStx(d); $('#stxCsv').style.display='inline-flex'; $('#stxPrint').style.display='inline-flex';
  }catch(e){ $('#stxOut').innerHTML='<div class="note">Could not reach the Square sales-tax endpoint.</div>'; }
}
// ---- Xola multi-seller helpers -------------------------------------------
// The endpoints return an `accounts` array (one entry per configured seller)
// alongside the combined totals. These normalize that into display rows and
// fall back to the old single-seller shape so an older response still renders.
function xolaSources(x){
  if(!x) return [];
  const all=Array.isArray(x.accounts)?x.accounts:[];
  const live=all.filter(a=>a.ok!==false);
  if(!live.length) return [{name:'Xola (experiences)',gross:x.grossSales||0,tax:x.taxCollected||0,ref:x.taxRefunded||0,net:(x.taxNet!=null?x.taxNet:x.taxCollected)||0}];
  const many=live.length>1;
  return live.map(a=>({
    name: many?`Xola — ${esc(a.label||a.seller)}`:'Xola (experiences)',
    gross:a.grossSales||0, tax:a.taxCollected||0, ref:a.taxRefunded||0,
    net:(a.taxNet!=null?a.taxNet:a.taxCollected)||0,
  }));
}
// Missing seller data means the remit figure is too LOW, which is the dangerous
// direction to be wrong in. Never let that pass silently.
// mode 'ky' talks about sales tax and filing; mode 'retail' must not — the daily
// report shows no tax at all, so warning about missing tax there is nonsense.
function xolaWarning(x,mode){
  if(!x) return '';
  const ky=mode!=='retail';
  const missing=ky?'Their sales tax is <b>not</b> in the total below.':'Their bookings and revenue are <b>not</b> in the totals below.';
  const closer=ky?' Re-run before filing.':' Re-run for a complete day.';
  const bad=(x.failed||[]).map(f=>esc(f.label||f.key));
  const blind=(x.unreadable||[]).map(f=>esc(f.label||f.key));
  const parts=[];
  if(bad.length) parts.push(`${bad.length} Xola seller${bad.length===1?'':'s'} could not be reached (${bad.join(', ')}). ${missing}`);
  // The dangerous case: the pull SUCCEEDED and returned nothing. No error, no
  // retry prompt, just a clean zero that reads as a slow month.
  if(blind.length) parts.push(`${blind.length} Xola seller${blind.length===1?'':'s'} returned <b>no transactions at any date</b> (${blind.join(', ')}) — almost always an API key that cannot read that seller. They are counted as <b>zero</b> here, so the ${ky?'total is too LOW':'day is understated'}. Set <code>XOLA_API_KEY_n</code> for them and re-run.`);
  // A seller with no state set sits on no return at all. Neither including nor
  // excluding it silently is safe, so it gets named.
  const unset=(x.unclassified||[]).map(f=>esc(f.label||f.key));
  if(ky&&unset.length) parts.push(`${unset.length} Xola seller${unset.length===1?'':'s'} (${unset.join(', ')}) ${unset.length===1?'has':'have'} no state assigned, so ${unset.length===1?'its':'their'} sales tax is on <b>no</b> return. Set <code>XOLA_STATE_n</code> to <code>KY</code> or <code>TN</code>.`);
  if(x.truncated) parts.push('One or more sellers returned more pages than could be read in time, so their figures are incomplete.');
  if(!parts.length) return '';
  return `<div class="note" style="border-left:3px solid #c0392b">⚠️ ${parts.join(' ')}${closer}</div>`;
}
function renderStx(d){
  const mName=new Date(d.year,d.month-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const due=new Date(d.year,d.month,20).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const locRows=d.byLocation.map(l=>`<tr><td>${l.name}</td><td class="num">${l.orders}</td><td class="num">${money(l.gross)}</td><td class="num">${money(l.tax)}</td></tr>`).join('');
  const taxRows=d.byTax.length?d.byTax.map(t=>`<tr><td>${t.name}</td><td class="num">${money(t.tax)}</td></tr>`).join(''):`<tr><td colspan="2" style="color:var(--muted)">No tax lines.</td></tr>`;
  const sqNet=d.taxNet!=null?d.taxNet:d.taxCollected;
  const x=d.xola; const xNet=x?(x.taxNet!=null?x.taxNet:x.taxCollected):0;
  const combinedNet=round2(sqNet+xNet);
  const sub=x?'Sales tax collected through Square + Xola, net of refunds (for Form 51A102)':'Sales tax collected through Square, net of refunds (for Form 51A102)';
  // Each Xola seller is its own source row, so a three-seller month shows where the tax came from.
  const xSrc=xolaSources(x);
  const xRows=xSrc.map(s=>`<tr><td>${s.name}</td><td class="num">${money(s.gross)}</td><td class="num">${money(s.tax)}</td><td class="num">${s.ref?`(${money(s.ref)})`:'—'}</td><td class="num">${money(s.net)}</td></tr>`).join('');
  // A seller that failed or was cut short UNDERSTATES tax owed — say so loudly rather than
  // letting a quiet zero look like a slow month.
  const xWarn=xolaWarning(x);
  // Per-source breakdown when Xola is connected; otherwise the original single-source table.
  const breakdown=x?`
    <h4>By source</h4>
    <div class="tablewrap"><table><thead><tr><th>Source</th><th class="num">Gross sales</th><th class="num">Tax collected</th><th class="num">Refunded</th><th class="num">Net tax</th></tr></thead><tbody>
      <tr><td>Square (retail / gift shop)</td><td class="num">${money(d.grossSales)}</td><td class="num">${money(d.taxCollected)}</td><td class="num">${d.taxRefunded?`(${money(d.taxRefunded)})`:'—'}</td><td class="num">${money(sqNet)}</td></tr>
      ${xRows}
      <tr class="total"><td>Combined</td><td class="num">${money(round2(d.grossSales+ x.grossSales))}</td><td class="num">${money(round2(d.taxCollected+x.taxCollected))}</td><td class="num">${(d.taxRefunded||x.taxRefunded)?`(${money(round2((d.taxRefunded||0)+(x.taxRefunded||0)))})`:'—'}</td><td class="num">${money(combinedNet)}</td></tr>
    </tbody></table></div>`
   :`
    <table><tbody>
      <tr><td>Gross retail sales (before tax &amp; tips)</td><td class="num">${money(d.grossSales)}</td></tr>
      <tr><td>Sales tax collected</td><td class="num">${money(d.taxCollected)}</td></tr>
      <tr><td>Less: sales tax refunded${d.refundCount?` (${d.refundCount})`:''}</td><td class="num">(${money(d.taxRefunded||0)})</td></tr>
      <tr class="total"><td>Net sales tax to remit</td><td class="num">${money(sqNet)}</td></tr>
    </tbody></table>`;
  $('#stxOut').innerHTML=reportHeader('Kentucky Retail Sales &amp; Use Tax — Collected',sub,mName)+`
    <div class="note ky">Square: ${d.orderCount} order${d.orderCount===1?'':'s'}${d.refundCount?`, ${d.refundCount} refund(s)`:''}, all locations.${x?` Xola: ${x.purchaseCount} booking${x.purchaseCount===1?'':'s'}${x.refundCount?`, ${x.refundCount} refund(s)`:''} across ${xSrc.length} Kentucky seller${xSrc.length===1?'':'s'} (tax counted when booked, net of refunds).${(x.otherStates&&x.otherStates.length)?` ${x.otherStates.length} out-of-state Xola seller${x.otherStates.length===1?'':'s'} (${x.otherStates.map(s=>esc(s.label)+' — '+esc(s.state)).join(', ')}) ${x.otherStates.length===1?'is':'are'} correctly excluded.`:''}`:''} Refunds are netted out so this ties to what you remit.</div>
    ${xWarn}
    ${breakdown}
    <h4>Square — by tax</h4><div class="tablewrap"><table><thead><tr><th>Tax</th><th class="num">Collected</th></tr></thead><tbody>${taxRows}</tbody></table></div>
    <h4>Square — by location</h4><div class="tablewrap"><table><thead><tr><th>Location</th><th class="num">Orders</th><th class="num">Gross</th><th class="num">Tax</th></tr></thead><tbody>${locRows}</tbody></table></div>
    <div class="taxbox ky"><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Net Sales Tax to Remit${x?' — Square + Xola':''}</div><div class="due">${money(combinedNet)}</div><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;margin-top:4px">KY Sales &amp; Use Tax (Form 51A102) is generally due by the 20th of the following month (by <b>${due}</b>).</div></div>
    <div class="disclaimer">Square tax is from completed orders (net of tips), minus tax refunded during the month.${x?' Xola tax is the “Kentucky Sales Tax” collected on experience bookings, counted in the month booked and net of refunds.':''} Excludes exempt sales and use tax on your own purchases — reconcile against your Square/Xola tax reports and confirm figures with the Kentucky DOR before filing.</div>`;
}
function stxCsv(){
  if(!stxLast)return; const d=stxLast;
  const lines=[['Kentucky Retail Sales Tax Collected',`${d.year}-${String(d.month).padStart(2,'0')}`].join(',')];
  const sqNet=d.taxNet!=null?d.taxNet:d.taxCollected; const x=d.xola; const xNet=x?(x.taxNet!=null?x.taxNet:x.taxCollected):0;
  if(x){
    lines.push(['Source','Gross','Tax collected','Refunded','Net'].join(','));
    lines.push(['Square',d.grossSales,d.taxCollected,d.taxRefunded||0,sqNet].join(','));
    // One line per Xola seller so the CSV reconciles against each seller's own report.
    xolaSources(x).forEach(s=>lines.push([csv(s.name.replace(/&amp;/g,'&')),s.gross,s.tax,s.ref,s.net].join(',')));
    lines.push(['Combined',round2(d.grossSales+x.grossSales),round2(d.taxCollected+x.taxCollected),round2((d.taxRefunded||0)+(x.taxRefunded||0)),round2(sqNet+xNet)].join(','));
  } else {
    lines.push(['Gross retail sales',d.grossSales].join(','));
    lines.push(['Sales tax collected',d.taxCollected].join(','));
    lines.push(['Sales tax refunded',d.taxRefunded||0].join(','));
    lines.push(['Net sales tax to remit',sqNet].join(','));
  }
  lines.push(''); lines.push(['By tax','Collected'].join(','));
  d.byTax.forEach(t=>lines.push([csv(t.name),t.tax].join(',')));
  lines.push(''); lines.push(['By location','Orders','Gross','Tax'].join(','));
  d.byLocation.forEach(l=>lines.push([csv(l.name),l.orders,l.gross,l.tax].join(',')));
  const blob=new Blob([lines.join('\n')],{type:'text/csv'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`KY-salestax_${d.year}-${String(d.month).padStart(2,'0')}.csv`; a.click();
}

/* ---- Retail Sales — one day, every location, every Square account ---- */
let rtlLast=null, rtlAccts=null;
const rtlTodayStr=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
// The name you set in SQUARE_LABEL_n wins; then Square's business name; then a plain fallback.
const rtlAcctName=a=>a.label||a.merchant||('Account '+(a.key==='a2'?2:1));
let rtlAutoRan=false;
function renderRetail(){
  if(!$('#rtlFrom').value) $('#rtlFrom').value=rtlTodayStr();
  if(!$('#rtlTo').value) $('#rtlTo').value=rtlTodayStr();
  rtlStatus();
  // Auto-pull TODAY the first time the tab is opened (don't clobber a range the user already pulled).
  if(!rtlAutoRan && !rtlLast && location.protocol!=='file:' && can('reports')){
    rtlAutoRan=true; $('#rtlFrom').value=rtlTodayStr(); $('#rtlTo').value=rtlTodayStr(); rtlRun();
  }
}
async function rtlStatus(){
  const el=$('#rtlStatus'); if(!el)return;
  if(location.protocol==='file:'){ el.innerHTML='Retail Sales runs only on the hosted site.'; $('#rtlRun').disabled=true; return; }
  el.textContent='Checking Square connections…';
  try{
    const r=await fetch('/api/square/accounts',{cache:'no-store'}); const d=await r.json();
    rtlAccts=d;
    if(!d.configured||!d.accounts.length){ el.innerHTML='⚠️ No Square account is connected yet. Add <b>SQUARE_ACCESS_TOKEN</b> (and <b>SQUARE_ACCESS_TOKEN_2</b> for your second account) in Netlify, then redeploy.'; $('#rtlRun').disabled=true; return; }
    $('#rtlRun').disabled=false;
    const bits=d.accounts.map(a=>{
      const n=a.locations?a.locations.length:0;
      return a.connected
        ? `✅ <b>${esc(rtlAcctName(a))}</b> <span style="color:var(--muted)">(${n} location${n===1?'':'s'})</span>`
        : `⚠️ <b>${esc(rtlAcctName(a))}</b> — connection failed${a.error?` (${esc(a.error)})`:''}`;
    });
    if(d.accounts.length===1) bits.push('<span style="color:var(--muted)">Only one account connected — add <b>SQUARE_ACCESS_TOKEN_2</b> in Netlify to see both here.</span>');
    el.innerHTML=bits.join(' &nbsp;·&nbsp; ');
  }catch(e){ el.textContent='Could not reach the Square accounts endpoint.'; }
}
/* ===== Sales by Location report ===== */
let srLast=null;
const SR_COLORS=['var(--copper)','var(--blue)','var(--green)','var(--ky)','var(--amber)','var(--red)'];
let srInit=false;
function renderSalesReport(){
  if(!$('#sr_from').value||!$('#sr_to').value) srPreset('this');
  if(!srInit){
    srInit=true;
    const yr=new Date().getFullYear(); const sel=$('#sr_year');
    if(sel&&!sel.options.length){ for(let y=yr;y>=yr-5;y--){ const o=document.createElement('option'); o.value=String(y); o.textContent=String(y); sel.appendChild(o);} sel.value=String(yr); }
    $('#sr_type').onchange=srTypeToggle;
  }
  srTypeToggle();
  srStatus();
}
function srTypeToggle(){
  const t=$('#sr_type').value;
  $('#sr_locCtl').style.display=(t==='monthly')?'none':'flex';
  $('#sr_monCtl').style.display=(t==='monthly')?'flex':'none';
}
async function srStatus(){
  const el=$('#srStatus'); if(!el) return;
  if(location.protocol==='file:'){ el.innerHTML='Sales Report runs only on the hosted site.'; $('#sr_run').disabled=true; return; }
  el.textContent='Checking Square connections…';
  try{
    const r=await fetch('/api/square/accounts',{cache:'no-store'}); const d=await r.json();
    if(!d.configured||!(d.accounts&&d.accounts.length)){ el.innerHTML='⚠️ No Square account connected yet. Add your Square tokens in Netlify, then redeploy.'; $('#sr_run').disabled=true; return; }
    $('#sr_run').disabled=false;
    el.innerHTML='Ready — '+d.accounts.length+' Square account'+(d.accounts.length===1?'':'s')+' connected. Net sales are after discounts, before tax and tips.';
  }catch(e){ el.textContent='Could not reach the Square accounts endpoint.'; }
}
function srPreset(kind){
  const now=new Date(), y=now.getFullYear(), m=now.getMonth();
  const fmt=dt=>`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  let from,to=fmt(now);
  if(kind==='last'){ from=fmt(new Date(y,m-1,1)); to=fmt(new Date(y,m,0)); }
  else if(kind==='qtr'){ from=fmt(new Date(y,Math.floor(m/3)*3,1)); }
  else if(kind==='ytd'){ from=fmt(new Date(y,0,1)); }
  else { from=fmt(new Date(y,m,1)); } // this month
  $('#sr_from').value=from; $('#sr_to').value=to;
}
async function srRun(){
  if(!requireCap('reports'))return;
  if($('#sr_type').value==='monthly'){ return srRunMonthly(); }
  let from=$('#sr_from').value, to=$('#sr_to').value;
  if(!from&&!to){ alert('Pick a date range.'); return; }
  if(!from) from=to; if(!to) to=from; if(from>to){ const t=from; from=to; to=t; $('#sr_from').value=from; $('#sr_to').value=to; }
  $('#sr_out').innerHTML='<div class="empty">Pulling Square sales…</div>'; $('#sr_print').style.display='none';
  try{
    const r=await fetch('/api/square/summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({startDate:from,endDate:to})});
    const d=await r.json();
    if(!d||d.error){ $('#sr_out').innerHTML='<div class="note">⚠️ '+esc((d&&(d.detail||d.error))||'Could not load.')+'</div>'; return; }
    d.range={from,to}; srLast=d; renderSalesReportOut(d); $('#sr_print').style.display='inline-flex';
  }catch(e){ $('#sr_out').innerHTML='<div class="note">Could not reach the Square summary endpoint.</div>'; }
}
function renderSalesReportOut(d){
  const ok=(d.accounts||[]).filter(a=>a.ok);
  const blankBO=l=>/back\s*-?\s*office/i.test(l.name||'')&&!l.orderCount&&!(+l.netSales)&&!(+l.tax);
  const colorOf={}; ok.forEach((a,i)=>colorOf[a.key||a.label||i]=SR_COLORS[i%SR_COLORS.length]);
  // Flatten to location rows across accounts.
  let rows=[];
  ok.forEach(a=>{ (a.locations||[]).filter(l=>!blankBO(l)).forEach(l=>{
    rows.push({acct:rtlAcctName(a),acctKey:a.key||a.label,color:colorOf[a.key||a.label],name:l.name,net:+l.netSales||0,orders:+l.orderCount||0,avg:+l.avgTicket||0,tax:+l.tax||0,tips:+l.tips||0,units:+l.units||0,bottles:l.bottles});
  }); });
  rows.sort((x,y)=>y.net-x.net);
  const from=(d.range&&d.range.from)||d.startDate, to=(d.range&&d.range.to)||d.endDate;
  const period=rtlPeriodLabel(from,to);
  if(!rows.length){ $('#sr_out').innerHTML=reportHeader('Sales by Location','Square retail & gift shop — net sales',period)+'<div class="empty">No sales in this period.</div>'; return; }
  const totNet=rows.reduce((s,r)=>s+r.net,0), totOrders=rows.reduce((s,r)=>s+r.orders,0), totTax=rows.reduce((s,r)=>s+r.tax,0), totTips=rows.reduce((s,r)=>s+r.tips,0), totUnits=rows.reduce((s,r)=>s+r.units,0), totBottles=rows.reduce((s,r)=>s+(+r.bottles||0),0);
  const top=rows[0];
  const kpis=`<div class="kpis" style="margin:14px 0">`+[
    kpi('copper','Net Sales',money(totNet),`${totOrders} order${totOrders===1?'':'s'} · ${rows.length} location${rows.length===1?'':'s'}`),
    kpi('blue','Avg Ticket',money(totOrders?totNet/totOrders:0),'net sales per order'),
    kpi('ky','Sales Tax',money(totTax),'collected'),
    kpi('green','Top Location',money(top.net),esc(top.name)),
    kpi('barrel','Bottles Sold',numf(totBottles,0),'tagged bottles'),
  ].join('')+`</div>`;
  // Legend (one entry per account)
  const legend=ok.length>1?`<div style="display:flex;flex-wrap:wrap;gap:14px;margin:2px 0 10px;font-family:-apple-system,Segoe UI,sans-serif;font-size:12.5px">`+
    ok.map(a=>`<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:${colorOf[a.key||a.label]};display:inline-block"></span>${esc(rtlAcctName(a))}</span>`).join('')+`</div>`:'';
  // Horizontal bar chart (net sales by location)
  const max=Math.max(...rows.map(r=>r.net),1);
  const chart=`<div style="margin:6px 0 4px">`+rows.map(r=>{
    const pct=Math.max(r.net>0?2:0,r.net/max*100);
    return `<div style="display:flex;align-items:center;gap:10px;padding:4px 0">
      <div style="flex:0 0 210px;font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.name)}">${esc(r.name)}${ok.length>1?` <span style="color:var(--muted);font-size:11px">${esc(r.acct)}</span>`:''}</div>
      <div style="flex:1;background:#efe7d8;border-radius:5px;height:20px;position:relative;min-width:60px"><div style="width:${pct}%;background:${r.color};height:100%;border-radius:5px"></div></div>
      <div style="flex:0 0 96px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700">${money(r.net)}</div>
    </div>`;
  }).join('')+`</div>`;
  const table=`<div class="tablewrap"><table><thead><tr>
      <th>Location</th>${ok.length>1?'<th>Account</th>':''}<th class="num">Orders</th><th class="num">Net Sales</th><th class="num">Avg Ticket</th><th class="num">Tax</th><th class="num">Tips</th><th class="num">Bottles</th>
    </tr></thead><tbody>`+
    rows.map(r=>`<tr><td>${esc(r.name)}</td>${ok.length>1?`<td>${esc(r.acct)}</td>`:''}<td class="num">${r.orders}</td><td class="num">${money(r.net)}</td><td class="num">${money(r.avg)}</td><td class="num">${money(r.tax)}</td><td class="num">${money(r.tips)}</td><td class="num">${r.bottles!=null?numf(r.bottles,0):'—'}</td></tr>`).join('')+
    `<tr class="total" style="font-weight:700"><td>All locations</td>${ok.length>1?'<td></td>':''}<td class="num">${totOrders}</td><td class="num">${money(totNet)}</td><td class="num">${money(totOrders?totNet/totOrders:0)}</td><td class="num">${money(totTax)}</td><td class="num">${money(totTips)}</td><td class="num">${numf(totBottles,0)}</td></tr>`+
    `</tbody></table></div>`;
  $('#sr_out').innerHTML=reportHeader('Sales by Location','Square retail & gift shop — net sales (after discounts, before tax & tips)',period)+kpis+
    `<h4>Net sales by location</h4>${legend}${chart}<h4 style="margin-top:20px">Detail</h4>${table}`+
    `<div class="disclaimer">Completed Square orders for the selected period, across all connected accounts and locations. Net sales exclude tax and tips; empty back-office locations are hidden. <b>Bottles</b> counts line items tagged with <b>TTB Bottle Size (mL)</b> in Square — accounts without those tags show a dash. This is an operating snapshot — reconcile against Square before relying on it for filings.</div>`;
}
async function srRunMonthly(){
  if(!requireCap('reports'))return;
  const year=+$('#sr_year').value||new Date().getFullYear();
  const now=new Date(); const lastMonth=(year===now.getFullYear())?now.getMonth()+1:12;
  $('#sr_out').innerHTML='<div class="empty">Pulling Square sales by month for '+year+'… (this can take a few seconds)</div>'; $('#sr_print').style.display='none';
  try{
    const months=[]; for(let m=1;m<=lastMonth;m++){ const from=`${year}-${String(m).padStart(2,'0')}-01`; const to=`${year}-${String(m).padStart(2,'0')}-${String(new Date(year,m,0).getDate()).padStart(2,'0')}`; months.push({m,from,to}); }
    const results=await Promise.all(months.map(mm=>fetch('/api/square/summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({startDate:mm.from,endDate:mm.to})}).then(r=>r.json()).catch(()=>null)));
    const meta=months.map(mm=>({m:mm.m,label:new Date(year,mm.m-1,1).toLocaleDateString('en-US',{month:'short'})}));
    srLast={monthly:true,year,meta,results}; renderMonthlyOut(year,meta,results); $('#sr_print').style.display='inline-flex';
  }catch(e){ $('#sr_out').innerHTML='<div class="note">Could not reach the Square summary endpoint.</div>'; }
}
function renderMonthlyOut(year,meta,results){
  const blankBO=l=>/back\s*-?\s*office/i.test(l.name||'')&&!l.orderCount&&!(+l.netSales)&&!(+l.tax);
  const zero=()=>({net:0,orders:0,tax:0,tips:0,units:0});
  const add=(s,z)=>({net:s.net+(+z.net||0),orders:s.orders+(+z.orders||0),tax:s.tax+(+z.tax||0),tips:s.tips+(+z.tips||0),units:s.units+(+z.units||0)});
  // Combined per month (for the headline KPIs and overview chart).
  const comb=meta.map((x,i)=>{ const d=results[i]; const c=(d&&!d.error&&d.combined)||{}; return {label:x.label,m:x.m,net:+c.netSales||0,orders:+c.orderCount||0,tax:+c.tax||0,tips:+c.tips||0,units:+c.units||0,err:!(d&&!d.error)}; });
  // Per-location: each location's numbers for each month.
  const locMap={};
  meta.forEach((x,i)=>{ const d=results[i]; if(!d||d.error)return; (d.accounts||[]).filter(a=>a.ok).forEach(a=>{ (a.locations||[]).filter(l=>!blankBO(l)).forEach(l=>{ const key=(a.key||a.label||'')+'|'+(l.id||l.name); const rec=locMap[key]||(locMap[key]={name:l.name,acct:rtlAcctName(a),byM:{}}); rec.byM[x.m]={net:+l.netSales||0,orders:+l.orderCount||0,tax:+l.tax||0,tips:+l.tips||0,units:+l.units||0}; }); }); });
  const locs=Object.values(locMap).map(r=>{ const rows=meta.map(x=>Object.assign({label:x.label},zero(),r.byM[x.m]||{})); const tot=rows.reduce(add,zero()); return {name:r.name,acct:r.acct,rows,tot}; }).sort((a,b)=>b.tot.net-a.tot.net);
  const T=comb.reduce(add,zero());
  const best=comb.slice().sort((a,b)=>b.net-a.net)[0]||{label:'—',net:0};
  const active=comb.filter(z=>z.net>0||z.orders>0).length;
  const multiAcct=new Set(locs.map(L=>L.acct)).size>1;
  const kpis=`<div class="kpis" style="margin:14px 0">`+[
    kpi('copper','Net Sales',money(T.net),`${T.orders} transaction${T.orders===1?'':'s'} · ${locs.length} location${locs.length===1?'':'s'}`),
    kpi('blue','Avg Ticket',money(T.orders?T.net/T.orders:0),'net sales per transaction'),
    kpi('ky','Sales Tax',money(T.tax),'collected'),
    kpi('green','Best Month',money(best.net),best.label),
    kpi('barrel','Avg / Month',money(active?T.net/active:0),`${active} active month${active===1?'':'s'}`),
  ].join('')+`</div>`;
  const monthTable=(rows,tot,totLabel)=>`<div class="tablewrap"><table><thead><tr><th>Month</th><th class="num">Transactions</th><th class="num">Net Sales</th><th class="num">Avg Ticket</th><th class="num">Tax</th><th class="num">Tips</th><th class="num">Units</th></tr></thead><tbody>`+
    rows.map(r=>`<tr><td>${r.label}${r.err?' <span class="pill" style="background:#f7e7e4;color:#b23a2e">no data</span>':''}</td><td class="num">${r.orders}</td><td class="num">${money(r.net)}</td><td class="num">${money(r.orders?r.net/r.orders:0)}</td><td class="num">${money(r.tax)}</td><td class="num">${money(r.tips)}</td><td class="num">${numf(r.units,0)}</td></tr>`).join('')+
    `<tr class="total" style="font-weight:700"><td>${totLabel}</td><td class="num">${tot.orders}</td><td class="num">${money(tot.net)}</td><td class="num">${money(tot.orders?tot.net/tot.orders:0)}</td><td class="num">${money(tot.tax)}</td><td class="num">${money(tot.tips)}</td><td class="num">${numf(tot.units,0)}</td></tr>`+
    `</tbody></table></div>`;
  const locSections=locs.length?locs.map(L=>`<h3 style="margin-top:24px">${esc(L.name)} <span style="color:var(--muted);font-weight:400;font-size:13px">${multiAcct?esc(L.acct)+' · ':''}${money(L.tot.net)} net · ${L.tot.orders} transactions</span></h3>${monthTable(L.rows,L.tot,'Total '+year)}`).join(''):'<div class="empty">No location sales in '+year+'.</div>';
  $('#sr_out').innerHTML=reportHeader('Monthly Sales by Location','Square retail & gift shop — net sales by month, per location',String(year))+kpis+
    `<h4>By location</h4>${locSections}`+
    `<h4 style="margin-top:28px">All locations combined</h4>${monthTable(comb,T,'Total '+year)}`+
    `<div class="disclaimer">Completed Square orders, one row per month of ${year}, broken out by location across all connected accounts. Net sales exclude tax and tips; empty back-office locations are hidden. Operating snapshot — reconcile against Square before filing.</div>`;
}
function ymdShift(ymd,days){ const [y,m,d]=ymd.split('-').map(Number); const dt=new Date(Date.UTC(y,m-1,d+days)); return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`; }
function ymdSpan(a,b){ return Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/86400000)+1; }
function rtlRange(){ let from=$('#rtlFrom').value, to=$('#rtlTo').value; if(!from&&to)from=to; if(!to&&from)to=from; if(from&&to&&from>to){ const t=from; from=to; to=t; } return {from,to}; }
function rtlShift(dir){
  let {from,to}=rtlRange(); if(!from){ from=to=rtlTodayStr(); }
  const span=ymdSpan(from,to);
  $('#rtlFrom').value=ymdShift(from,dir*span); $('#rtlTo').value=ymdShift(to,dir*span);
  rtlRun();
}
function rtlPeriodLabel(from,to){
  const f=new Date(from+'T00:00:00'), t=new Date(to+'T00:00:00');
  if(from===to) return f.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const sameYear=f.getFullYear()===t.getFullYear();
  const fFmt=f.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',...(sameYear?{}:{year:'numeric'})});
  const tFmt=t.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  return `${fFmt} – ${tFmt}`;
}
function rtlDelta(cur,prev){
  cur=+cur||0; prev=+prev||0;
  if(!prev) return cur>0?{txt:'new',cls:'up'}:{txt:'—',cls:'flat'};
  const pct=(cur-prev)/Math.abs(prev)*100;
  if(pct>0.05) return {txt:'▲'+numf(pct,1)+'%',cls:'up'};
  if(pct<-0.05) return {txt:'▼'+numf(Math.abs(pct),1)+'%',cls:'down'};
  return {txt:'0%',cls:'flat'};
}
function rtlCmp(cur,prev,lyLabel){
  if(!prev) return '';
  const row=(label,curV,prevV,fmt)=>{const d=rtlDelta(curV,prevV);return `<tr><td>${label}</td><td class="num">${fmt(curV)}</td><td class="num" style="color:var(--muted)">${fmt(prevV)}</td><td class="num cmp-${d.cls}">${d.txt}</td></tr>`;};
  const m=v=>money(v), n=v=>numf(v,0);
  return `<div class="tablewrap" style="margin:6px 0 4px"><table><thead><tr><th>vs. last year <span style="font-weight:400;color:var(--muted)">(${esc(lyLabel)})</span></th><th class="num">This period</th><th class="num">Last year</th><th class="num">Change</th></tr></thead><tbody>`+
    row('Net Sales',cur.netSales,prev.netSales,m)+
    row('Orders',cur.orderCount,prev.orderCount,n)+
    row('Avg Ticket',cur.avgTicket,prev.avgTicket,m)+
    row('Tips',cur.tips,prev.tips,m)+
    row('Units',cur.units,prev.units,n)+
    `</tbody></table></div>`;
}
async function rtlRun(){
  if(!requireCap('reports'))return;
  let {from,to}=rtlRange();
  if(!from){ alert('Pick a date range.'); return; }
  $('#rtlFrom').value=from; $('#rtlTo').value=to;
  const py={from:ymdShift(from,-364),to:ymdShift(to,-364)};   // 52 weeks back = same weekdays a year ago
  // "Through this hour" comparison: cap the current window at now, and the prior-year window at the
  // same clock time a year ago (now − 364 days). Only bites when the range is still in progress (today).
  const nowISO=new Date().toISOString();
  const priorNowISO=new Date(Date.now()-364*86400000).toISOString();
  const inProgress=(to===rtlTodayStr());
  $('#rtlOut').innerHTML='<div class="empty">Pulling Square sales…</div>';
  $('#rtlCsv').style.display='none'; $('#rtlPrint').style.display='none';
  try{
    const jx=body=>fetch('/api/xola/summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).catch(()=>null);
    const [cur,prior,xr,xrP]=await Promise.all([
      fetch('/api/square/summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({startDate:from,endDate:to,endCapISO:nowISO})}).then(r=>r.json()),
      fetch('/api/square/summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({startDate:py.from,endDate:py.to,endCapISO:priorNowISO})}).then(r=>r.json()).catch(()=>null),
      jx({startDate:from,endDate:to,endCapISO:nowISO}),
      jx({startDate:py.from,endDate:py.to,endCapISO:priorNowISO}),
    ]);
    if(!cur||cur.error){ $('#rtlOut').innerHTML='<div class="note">⚠️ '+esc((cur&&(cur.detail||cur.error))||'Could not load.')+'</div>'; return; }
    cur.range={from,to}; cur.inProgress=inProgress; cur.throughTime=inProgress?new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):null;
    cur.xola=(xr&&xr.configured&&!xr.error)?xr:null;
    cur.priorYear=(prior&&!prior.error)?Object.assign(prior,{range:py,xola:(xrP&&xrP.configured&&!xrP.error)?xrP:null}):null;
    rtlLast=cur; renderRetailOut(cur);
    $('#rtlCsv').style.display='inline-flex'; $('#rtlPrint').style.display='inline-flex';
  }catch(e){ $('#rtlOut').innerHTML='<div class="note">Could not reach the Square summary endpoint.</div>'; }
}
function rtlStat(l,v){return `<span style="display:inline-block;margin:0 20px 8px 0"><span style="font-family:-apple-system,Segoe UI,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);display:block">${l}</span><b style="font-variant-numeric:tabular-nums;font-size:15px">${v}</b></span>`;}
function xolaCmp(cur,prev,lyLabel){
  if(!prev) return '';
  const row=(l,c,p,fmt)=>{const dd=rtlDelta(c,p);return `<tr><td>${l}</td><td class="num">${fmt(c)}</td><td class="num" style="color:var(--muted)">${fmt(p)}</td><td class="num cmp-${dd.cls}">${dd.txt}</td></tr>`;};
  const m=v=>money(v), n=v=>numf(v,0);
  return `<div class="tablewrap" style="margin:6px 0 4px"><table><thead><tr><th>vs. last year <span style="font-weight:400;color:var(--muted)">(${esc(lyLabel)})</span></th><th class="num">This period</th><th class="num">Last year</th><th class="num">Change</th></tr></thead><tbody>`+
    row('Net Sales',cur.netSales,prev.netSales,m)+row('Bookings',cur.orderCount,prev.orderCount,n)+row('Avg Ticket',cur.avgTicket,prev.avgTicket,m)+row('Guests',cur.guests,prev.guests,n)+`</tbody></table></div>`;
}
function renderXolaBlock(xr,pyXr,dayName,lyLabel){
  const header=`<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;border-bottom:2px solid var(--copper);padding-bottom:12px;margin:30px 0 6px">`+
    `<div><div style="font-size:20px;font-weight:800">Xola — Experiences Redeemed</div><div style="color:var(--muted);font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">Revenue recognized on the day the experience ran (not the day booked)</div></div>`+
    `<div style="text-align:right"><div style="font-weight:700">Retail Sales — Daily Summary</div><div style="color:var(--muted);font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">${esc(dayName)}</div></div></div>`;
  const tiles=`<div class="kpis" style="margin:14px 0">`+[
    kpi('copper','Net Sales',money(xr.netSales),`${xr.orderCount} booking${xr.orderCount===1?'':'s'}${xr.guests?` · ${numf(xr.guests,0)} guests`:''}`),
    kpi('blue','Avg Ticket',money(xr.avgTicket),'net per booking'),
    // Tax deliberately absent from the daily view. Xola tax spans two states and
    // only the Kentucky slice belongs on a KY return — the KY tab does that job.
    kpi('ky','Bookings',numf(xr.orderCount,0),'experiences redeemed'),
    kpi('barrel','Guests',numf(xr.guests,0),'redeemed this period'),
  ].join('')+`</div>`;
  const exp=(xr.experiences&&xr.experiences.length)
    ? `<h4 style="margin-top:18px">Top experiences — all sellers</h4><div class="tablewrap"><table><thead><tr><th>Experience</th><th class="num">Guests</th><th class="num">Net Sales</th></tr></thead><tbody>`+
      xr.experiences.map(e=>`<tr><td>${esc(e.name)}</td><td class="num">${numf(e.guests,0)}</td><td class="num">${money(e.net)}</td></tr>`).join('')+`</tbody></table></div>`
    : `<div style="color:var(--muted);font-size:13px">No experiences redeemed in this period.</div>`;
  return header+xolaWarning(xr,'retail')+tiles+(pyXr?xolaCmp(xr,pyXr,lyLabel):'')+xolaBySeller(xr,pyXr,lyLabel)+exp;
}
// Per-seller breakout for the Retail Sales tab. Only rendered with more than one
// seller configured — with a single seller it would just restate the KPI tiles.
function xolaBySeller(xr,pyXr,lyLabel){
  const all=Array.isArray(xr.accounts)?xr.accounts:[];
  if(all.length<2) return '';
  const prevBy={}; for(const a of ((pyXr&&pyXr.accounts)||[])) prevBy[a.key]=a;
  const rows=all.map(a=>{
    if(a.ok===false){
      return `<tr><td>${esc(a.label||a.key)}</td><td colspan="3" style="color:#c0392b;font-size:13px">Unavailable — ${esc(a.detail||a.error||'error')}</td><td class="num">—</td></tr>`;
    }
    const p=prevBy[a.key];
    const dd=p?rtlDelta(a.netSales,p.netSales):null;
    return `<tr><td>${esc(a.label||a.key)}${a.truncated?' <span style="color:#c0392b" title="More pages than could be read in time">(partial)</span>':''}`+
      `${a.unreadable?' <span style="color:#c0392b" title="This key returns no transactions for this seller at any date — the zeros below are not real">(no data visible)</span>':''}</td>`+
      `<td class="num">${numf(a.orderCount,0)}</td><td class="num">${numf(a.guests,0)}</td>`+
      `<td class="num">${money(a.netSales)}</td>`+
      `<td class="num${dd?' cmp-'+dd.cls:''}" style="${dd?'':'color:var(--muted)'}">${dd?dd.txt:'—'}</td></tr>`;
  }).join('');
  const live=all.filter(a=>a.ok!==false);
  const t=(f)=>live.reduce((n,a)=>n+(a[f]||0),0);
  return `<h4 style="margin-top:18px">By seller</h4><div class="tablewrap"><table><thead><tr><th>Xola seller</th><th class="num">Bookings</th><th class="num">Guests</th><th class="num">Net Sales</th><th class="num">vs. ${esc(lyLabel||'last year')}</th></tr></thead><tbody>`+
    rows+
    `<tr class="total"><td>All sellers</td><td class="num">${numf(t('orderCount'),0)}</td><td class="num">${numf(t('guests'),0)}</td><td class="num">${money(round2(t('netSales')))}</td><td class="num">—</td></tr>`+
    `</tbody></table></div>`;
}
