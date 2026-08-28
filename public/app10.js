/* ===================== Rough P&L by location (monthly) =====================
   Revenue (Square net sales + Xola tours) − COGS (assumed %) − overhead
   (from Expenses) − labor (hours × pay rate) = rough net, per location.
   Admin only. Everything is normalized to one calendar month. */

let _pnlY=null,_pnlM=null; const _pnlCache={};
function pnlPad(n){ return String(n).padStart(2,'0'); }
function pnlInit(){ if(_pnlY==null){ const d=new Date(); _pnlY=d.getFullYear(); _pnlM=d.getMonth()+1; } }
function pnlShift(delta){ pnlInit(); let m=_pnlM-1+delta, y=_pnlY; y+=Math.floor(m/12); m=((m%12)+12)%12; _pnlM=m+1; _pnlY=y; renderPnl(); }
function pnlMonthLabel(){ pnlInit(); return new Date(_pnlY,_pnlM-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'}); }
function pnlRange(){ pnlInit(); const start=`${_pnlY}-${pnlPad(_pnlM)}-01`; const nm=_pnlM===12?{y:_pnlY+1,m:1}:{y:_pnlY,m:_pnlM+1};
  const lastDay=new Date(_pnlY,_pnlM,0).getDate(); const end=`${_pnlY}-${pnlPad(_pnlM)}-${pnlPad(lastDay)}`; const nextStart=`${nm.y}-${pnlPad(nm.m)}-01`;
  return { start, end, nextStart }; }
const pnlNorm=s=>String(s||'').trim().toLowerCase();
function pnlCogsPct(){ const v=+(state.settings&&state.settings.cogsPct); return isFinite(v)&&v>=0?v:30; }

function renderPnl(){
  const box=document.getElementById('pnlBody'); if(!box) return;
  if(typeof can==='function' && !can('setup')){ box.innerHTML='<div class="empty" style="padding:34px"><div class="big">🔒</div>The P&amp;L is visible to admins only.</div>'; return; }
  pnlInit();
  const lbl=document.getElementById('pnlMonthLabel'); if(lbl) lbl.textContent=pnlMonthLabel();
  loadPnl();
}
async function loadPnl(force){
  const box=document.getElementById('pnlBody'); if(!box) return;
  const key=_pnlY+'-'+_pnlM;
  if(force) delete _pnlCache[key];
  if(_pnlCache[key]){ renderPnlBody(_pnlCache[key]); return; }
  box.innerHTML=`<div class="empty" style="padding:32px"><div class="big">⏳</div>Pulling Square, Xola &amp; payroll for ${esc(pnlMonthLabel())}…</div>`;
  const {start,end,nextStart}=pnlRange();
  const P=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json()).catch(()=>null);
  let sq=null,xo=null,pay=null;
  try{ [sq,xo,pay]=await Promise.all([
    P('/api/square/summary',{startDate:start,endDate:end}),
    P('/api/xola/summary',{startDate:start,endDate:end}),
    P('/api/square/payroll',{start,end:nextStart}),
  ]); }catch(e){}
  const bundle={sq,xo,pay};
  _pnlCache[key]=bundle;
  renderPnlBody(bundle);
}

function pnlComputeSquare(sq){
  // net sales by location (exclude empty back-office rows)
  const byLoc={}; const disp={};
  const blankBO=l=>/back\s*-?\s*office/i.test(l.name||'')&&!l.orderCount&&!(+l.netSales)&&!(+l.tax);
  if(sq&&!sq.error){ (sq.accounts||[]).filter(a=>a.ok).forEach(a=>{ (a.locations||[]).filter(l=>!blankBO(l)).forEach(l=>{ const k=pnlNorm(l.name); byLoc[k]=(byLoc[k]||0)+(+l.netSales||0); disp[k]=disp[k]||l.name; }); }); }
  return { byLoc, disp };
}
function pnlXolaAccounts(xo){ return (xo&&!xo.error&&Array.isArray(xo.accounts))?xo.accounts.filter(a=>a.ok!==false):[]; }
function pnlComputeXola(xo, locKeys, disp){
  // Map each Xola account to a location (saved map, else best name match, else its own row).
  const map=state.pnlXolaMap||{}; const byLoc={};
  pnlXolaAccounts(xo).forEach(a=>{ const akey=a.key||a.label; let target=map[akey];
    if(!target){ const n=pnlNorm(a.label); target=locKeys.find(k=>k===n)||locKeys.find(k=>k.includes(n)||n.includes(k))||''; }
    const k=target?pnlNorm(target):pnlNorm(a.label||'Xola');
    byLoc[k]=(byLoc[k]||0)+(+a.netSales||0); if(!disp[k]) disp[k]=(target||a.label||'Xola');
  });
  return byLoc;
}
function pnlComputeLabor(pay, disp){
  const byLoc={};
  if(pay&&pay.ok){ (pay.accounts||[]).forEach(a=>(a.locations||[]).forEach(l=>{ let c=0; (l.employees||[]).forEach(e=>{ c+=laborCost(e); }); const k=pnlNorm(l.name); byLoc[k]=(byLoc[k]||0)+c; if(!disp[k]) disp[k]=l.name; })); }
  return byLoc;
}
function pnlComputeOverhead(disp){
  const byLoc={};
  (state.expenses||[]).forEach(e=>{ if((e.freq||'')==='onetime') return; const k=pnlNorm(e.location); byLoc[k]=(byLoc[k]||0)+expPerMonth(e); if(!disp[k]) disp[k]=e.location; });
  return byLoc;
}

function renderPnlBody(bundle){
  const box=document.getElementById('pnlBody'); if(!box) return;
  const {sq,xo,pay}=bundle;
  const {byLoc:sqNet, disp}=pnlComputeSquare(sq);
  const locKeys=Object.keys(sqNet);
  const xoNet=pnlComputeXola(xo, locKeys, disp);
  const labor=pnlComputeLabor(pay, disp);
  const overhead=pnlComputeOverhead(disp);
  const cogsPct=pnlCogsPct();

  const allKeys=[...new Set([...Object.keys(sqNet),...Object.keys(xoNet),...Object.keys(labor),...Object.keys(overhead)])];
  const rows=allKeys.map(k=>{
    const rev=(sqNet[k]||0)+(xoNet[k]||0);
    const cogs=rev*cogsPct/100;
    const gross=rev-cogs;
    const oh=overhead[k]||0, lab=labor[k]||0;
    const net=gross-oh-lab;
    return { key:k, name:disp[k]||k, square:sqNet[k]||0, xola:xoNet[k]||0, rev, cogs, gross, oh, lab, net };
  }).sort((a,b)=>b.rev-a.rev);

  const T=rows.reduce((t,r)=>({rev:t.rev+r.rev,square:t.square+r.square,xola:t.xola+r.xola,cogs:t.cogs+r.cogs,gross:t.gross+r.gross,oh:t.oh+r.oh,lab:t.lab+r.lab,net:t.net+r.net}),{rev:0,square:0,xola:0,cogs:0,gross:0,oh:0,lab:0,net:0});

  // Diagnostics — say plainly why a column is $0.
  const sqSt=(!sq||sq.error)?{loaded:false,ok:0,failed:0}:(()=>{const a=sq.accounts||[];return {loaded:true,ok:a.filter(x=>x.ok).length,failed:a.filter(x=>x.ok===false).length};})();
  const notes=[];
  if(!sqSt.loaded) notes.push('Square sales didn’t load — revenue here is Xola-only. Hit Reload.');
  else if(sqSt.failed>0) notes.push('Square: '+sqSt.failed+' account'+(sqSt.failed===1?'':'s')+' failed to load this month (a whole month is a heavy pull) — Square revenue may be understated. Hit <b>Reload</b> to retry.');
  else if(sqSt.ok===0) notes.push('Square returned no sales for this month.');
  if(!xo||xo.error) notes.push('Xola didn’t load.');
  if(!pay||!pay.ok) notes.push('Payroll hours didn’t load — Labor reads $0.');
  else if(!(state.wages&&Object.keys(state.wages).length)) notes.push('No pay rates set — set hourly wages in <b>Payroll → Pay rates</b> and Labor fills in.');
  if(!((state.expenses||[]).length)) notes.push('No expenses entered — add rent/utilities/etc. in <b>Overhead &amp; Expenses</b> and Overhead fills in.');

  const netCol=v=>`<td class="num" style="font-weight:700;color:${v>=0?'var(--green)':'var(--red)'}">${money(v)}</td>`;
  let html=`<div class="kpis" style="margin:0 0 16px">`+
    kpi('copper','Revenue',money(T.rev),'Square + Xola')+
    kpi('barrel','COGS '+cogsPct+'%',money(T.cogs),'assumed')+
    kpi('blue','Overhead + Labor',money(T.oh+T.lab),money(T.oh)+' + '+money(T.lab))+
    kpi(T.net>=0?'green':'red','Rough Net',money(T.net),T.net>=0?'estimated profit':'estimated loss')+`</div>`;

  if(notes.length) html+=`<div class="note">`+notes.map(n=>`<div>&bull; ${n}</div>`).join('')+`</div>`;

  html+=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px"><div><h3 style="margin:0">P&amp;L by location — ${esc(pnlMonthLabel())}</h3><div class="hint">Rough estimate. COGS is an assumption, not actual cost of goods.</div></div>
    <div style="display:flex;align-items:center;gap:10px"><button class="btn ghost sm" onclick="loadPnl(true)">&#8635; Reload</button><label class="fld" style="margin:0">COGS %</label><input type="number" step="1" min="0" max="100" value="${cogsPct}" onchange="pnlSetCogs(this.value)" style="max-width:70px;text-align:right"></div></div>
    <div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Location</th><th class="num">Square</th><th class="num">Xola</th><th class="num">Revenue</th><th class="num">COGS</th><th class="num">Gross</th><th class="num">Overhead</th><th class="num">Labor</th><th class="num">Net</th></tr></thead><tbody>`+
    rows.map(r=>`<tr><td>${esc(r.name)}</td><td class="num">${money(r.square)}</td><td class="num">${money(r.xola)}</td><td class="num" style="font-weight:600">${money(r.rev)}</td><td class="num">(${money(r.cogs)})</td><td class="num">${money(r.gross)}</td><td class="num">(${money(r.oh)})</td><td class="num">(${money(r.lab)})</td>${netCol(r.net)}</tr>`).join('')+
    `<tr class="total"><td>All locations</td><td class="num">${money(T.square)}</td><td class="num">${money(T.xola)}</td><td class="num">${money(T.rev)}</td><td class="num">(${money(T.cogs)})</td><td class="num">${money(T.gross)}</td><td class="num">(${money(T.oh)})</td><td class="num">(${money(T.lab)})</td>${netCol(T.net)}</tr>`+
    `</tbody></table></div></div>`;

  // Xola → location mapping (so the 3 Xola accounts line up with the 3 locations)
  const xas=pnlXolaAccounts(xo);
  if(xas.length){
    const opts=locKeys.map(k=>({k, name:disp[k]}));
    html+=`<div class="card"><h3>Xola accounts → location</h3><div class="hint">Assign each Xola tour account to the location it belongs to, so its revenue lands in the right P&amp;L row.</div>
      <div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>Xola account</th><th class="num">Revenue</th><th>Counts toward</th></tr></thead><tbody>`+
      xas.map(a=>{ const akey=a.key||a.label; const cur=(state.pnlXolaMap||{})[akey]||'';
        return `<tr><td>${esc(a.label||akey)}</td><td class="num">${money(+a.netSales||0)}</td>
          <td><select onchange="pnlSetXolaMap('${esc(String(akey)).replace(/'/g,"\\'")}',this.value)">
            <option value="">— best match by name —</option>
            ${opts.map(o=>`<option value="${esc(o.name)}" ${pnlNorm(cur)===o.k?'selected':''}>${esc(o.name)}</option>`).join('')}
          </select></td></tr>`; }).join('')+
      `</tbody></table></div></div>`;
  }

  html+=`<div class="disclaimer">Rough operating P&amp;L for ${esc(pnlMonthLabel())}. Revenue = Square net sales + Xola tour revenue for the month. COGS is an assumed % of revenue (edit above) — not your real cost of goods. Overhead = recurring monthly expenses from the Overhead screen; Labor = timecard hours × pay rates. This is a planning snapshot, not accounting — reconcile in QuickBooks.</div>`;
  box.innerHTML=html;
}
function pnlSetCogs(v){ if(!requireCap('setup'))return; if(!state.settings)state.settings={}; state.settings.cogsPct=Math.max(0,Math.min(100,+v||0)); save('Set COGS %'); const key=_pnlY+'-'+_pnlM; if(_pnlCache[key]) renderPnlBody(_pnlCache[key]); }
function pnlSetXolaMap(akey,loc){ if(!requireCap('setup'))return; if(!state.pnlXolaMap)state.pnlXolaMap={}; if(loc) state.pnlXolaMap[akey]=loc; else delete state.pnlXolaMap[akey]; save('Mapped Xola account'); const key=_pnlY+'-'+_pnlM; if(_pnlCache[key]) renderPnlBody(_pnlCache[key]); }
