/* ===================== Expenses / Overhead by location =====================
   Admin inputs recurring (and one-time) expenses per location — rent, utilities,
   insurance, etc. — and gets a true overhead report by location, normalized to a
   monthly and annual figure. Stored in state.expenses (synced). Pairs with the
   labor cost in Payroll for the full cost picture. */

const EXP_CATS = ["Rent","Utilities","Insurance","Loan / debt","Payroll taxes","Supplies","Marketing","Software / POS","Maintenance","Licenses & fees","Other"];
const EXP_FREQ = [
  { v:"monthly", label:"Monthly", pm:1 },
  { v:"weekly", label:"Weekly", pm:52/12 },
  { v:"biweekly", label:"Every 2 weeks", pm:26/12 },
  { v:"quarterly", label:"Quarterly", pm:1/3 },
  { v:"annual", label:"Annual", pm:1/12 },
  { v:"onetime", label:"One-time", pm:0 },
];
function expFreqLabel(v){ const f=EXP_FREQ.find(x=>x.v===v); return f?f.label:(v||''); }
function expPerMonth(e){ const f=EXP_FREQ.find(x=>x.v===(e.freq||'monthly')); return (f?f.pm:1)*(+e.amount||0); }
function expLocations(){ const set=new Set(Array.isArray(state.pnlLocs)?state.pnlLocs:[]); (state.expenses||[]).forEach(e=>{ if(e.location) set.add(e.location); }); if(!set.size){ ['Louisville Rickhouse Whiskey Co','Nashville Barrel Co'].forEach(x=>set.add(x)); } return [...set]; }

function renderExpenses(){
  // Admin-only page.
  if(typeof can==='function' && !can('setup')){ const b=document.getElementById('expBody'); if(b) b.innerHTML='<div class="empty" style="padding:34px"><div class="big">🔒</div>Overhead &amp; expenses are visible to admins only.</div>'; const fc=document.getElementById('expFormCard'); if(fc) fc.style.display='none'; return; }
  const fc=document.getElementById('expFormCard'); if(fc) fc.style.display='';
  const dl=document.getElementById('exLocList'); if(dl) dl.innerHTML=expLocations().map(l=>`<option value="${esc(l)}"></option>`).join('');
  const lw=document.getElementById('ex_location_wrap'); if(lw && !lw.querySelector('select') && typeof locSelectControl==='function'){ lw.innerHTML=locSelectControl('ex_location',''); }
  const cs=document.getElementById('ex_cat'); if(cs&&!cs._filled){ cs.innerHTML=EXP_CATS.map(c=>`<option>${esc(c)}</option>`).join(''); cs._filled=1; }
  const fs=document.getElementById('ex_freq'); if(fs&&!fs._filled){ fs.innerHTML=EXP_FREQ.map(f=>`<option value="${f.v}">${esc(f.label)}</option>`).join(''); fs._filled=1; }
  expRenderReport();
}
function expAdd(){
  if(!requireCap('setup'))return;
  const location=(typeof locSelectValue==='function')?locSelectValue('ex_location'):((document.getElementById('ex_location')||{}).value||'').trim();
  const category=(document.getElementById('ex_cat')||{}).value||'Other';
  const amount=Math.round((+((document.getElementById('ex_amount')||{}).value)||0)*100)/100;
  const freq=(document.getElementById('ex_freq')||{}).value||'monthly';
  const note=((document.getElementById('ex_note')||{}).value||'').trim();
  if(!location){ alert('Enter a location.'); return; }
  if(!(amount>0)){ alert('Enter an amount.'); return; }
  if(!state.expenses) state.expenses=[];
  state.expenses.push({ id:uid(), location, category, amount, freq, note, ts:Date.now(), _upd:Date.now(), by:(SESSION?SESSION.name:'') });
  ['ex_amount','ex_note'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  save('Added expense — '+category+' · '+location); refreshAll(); flash('Expense added.');
}
function expDel(id){
  if(!requireCap('setup'))return;
  if(!confirm('Delete this expense?'))return;
  state.expenses=(state.expenses||[]).filter(x=>x.id!==id);
  save('Deleted an expense'); refreshAll();
}

function expRenderReport(){
  const box=document.getElementById('expBody'); if(!box) return;
  const all=(state.expenses||[]).slice();
  if(!all.length){ box.innerHTML=`<div class="empty" style="padding:30px"><div class="big">🧾</div>No expenses yet — add rent, utilities, insurance and the rest above to see overhead by location.</div>`; return; }
  // Group by location.
  const byLoc={};
  all.forEach(e=>{ const k=e.location||'—'; (byLoc[k]||(byLoc[k]=[])).push(e); });
  const locs=Object.keys(byLoc).sort((a,b)=>a.localeCompare(b));
  let gMonthly=0, gOnce=0;
  const summaryRows=locs.map(loc=>{
    const items=byLoc[loc];
    const monthly=items.reduce((s,e)=>s+expPerMonth(e),0);
    const once=items.filter(e=>e.freq==='onetime').reduce((s,e)=>s+(+e.amount||0),0);
    gMonthly+=monthly; gOnce+=once;
    return { loc, monthly, annual:monthly*12, once };
  }).sort((a,b)=>b.monthly-a.monthly);
  const anyOnce=summaryRows.some(r=>r.once>0);

  let html=`<div class="kpis" style="margin:0 0 16px">`+
    kpi('copper','Monthly Overhead',money(gMonthly),'recurring, all locations')+
    kpi('barrel','Annual Overhead',money(gMonthly*12),'recurring × 12')+
    kpi('blue','Locations',String(locs.length),'with expenses')+`</div>`;

  html+=`<div class="card"><h3>Overhead by location</h3><div class="hint">Recurring expenses normalized to a monthly figure${anyOnce?' (one-time costs shown separately)':''}.</div>
    <div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>Location</th><th class="num">Monthly</th><th class="num">Annual</th>${anyOnce?'<th class="num">One-time</th>':''}</tr></thead><tbody>`+
    summaryRows.map(r=>`<tr><td>${esc(r.loc)}</td><td class="num" style="font-weight:700">${money(r.monthly)}</td><td class="num">${money(r.annual)}</td>${anyOnce?`<td class="num">${r.once?money(r.once):'—'}</td>`:''}</tr>`).join('')+
    `<tr class="total"><td>All locations</td><td class="num">${money(gMonthly)}</td><td class="num">${money(gMonthly*12)}</td>${anyOnce?`<td class="num">${gOnce?money(gOnce):'—'}</td>`:''}</tr>`+
    `</tbody></table></div></div>`;

  // Detail per location
  html+=locs.map(loc=>{
    const items=byLoc[loc].slice().sort((a,b)=>(a.category||'').localeCompare(b.category||''));
    const rows=items.map(e=>`<tr>
      <td>${esc(e.category||'')}</td>
      <td class="num">${money(e.amount)}</td>
      <td>${esc(expFreqLabel(e.freq))}</td>
      <td class="num">${e.freq==='onetime'?'—':money(expPerMonth(e))}</td>
      <td style="color:var(--muted)">${esc(e.note||'')}</td>
      <td class="noprint">${can('setup')?`<button class="del" onclick="expDel('${e.id}')">Del</button>`:''}</td></tr>`).join('');
    return `<div class="card"><h3>${esc(loc)}</h3>
      <div class="tablewrap"><table><thead><tr><th>Category</th><th class="num">Amount</th><th>Frequency</th><th class="num">Monthly</th><th>Note</th><th class="noprint"></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join('');

  box.innerHTML=html;
}
