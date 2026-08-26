/* ===================== Payroll (Square hours + tips) =====================
   Reads /api/square/payroll for the selected biweekly pay period and shows,
   per location and combined, each employee's hours worked and tips collected
   across both Square accounts and all locations. Pay periods are 14 days,
   anchored to Aug 20, 2026 (current period: Aug 20 – Sep 2, pay date Sep 3). */

const PAY_ANCHOR = Date.UTC(2026, 7, 20); // Aug 20, 2026 — a period start
const PAY_LEN = 14 * 86400000;
let _payOffset = 0;            // 0 = current period, -1 = previous, +1 = next
const _payCache = {};          // offset -> payload
let _payLoading = false;

function payYmd(ms){ const d=new Date(ms); const p=n=>String(n).padStart(2,'0'); return d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate()); }
function payNice(ms){ return new Date(ms).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}); }
function payNiceShort(ms){ return new Date(ms).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'}); }
function payPeriod(offset){
  const now=new Date();
  const todayUTC=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  const k=Math.floor((todayUTC-PAY_ANCHOR)/PAY_LEN)+offset;
  const start=PAY_ANCHOR+k*PAY_LEN;
  const end=start+PAY_LEN;             // exclusive — also the pay date
  const lastDay=end-86400000;          // inclusive last worked day
  return {start,end,lastDay,startYmd:payYmd(start),endYmd:payYmd(end)};
}

function renderPayroll(){
  const host=document.getElementById('view-payroll'); if(!host) return;
  const p=payPeriod(_payOffset);
  const lbl=document.getElementById('payPeriodLabel');
  if(lbl) lbl.innerHTML=`${payNice(p.start)} &ndash; ${payNice(p.lastDay)} <span style="color:var(--muted);font-weight:600">&middot; pay date ${payNiceShort(p.end)}</span>${_payOffset===0?' <span class="pill tax" style="margin-left:6px">Current</span>':''}`;
  loadPayroll();
}
function payShiftPeriod(delta){ _payOffset+=delta; renderPayroll(); }
function payThisPeriod(){ _payOffset=0; renderPayroll(); }

async function loadPayroll(force){
  const box=document.getElementById('payrollBody'); if(!box) return;
  const off=_payOffset;
  if(force){ delete _payCache[off]; delete _payCache[off-1]; }
  let data=_payCache[off];
  if(!data){
    box.innerHTML=`<div class="empty" style="padding:34px"><div class="big">&#8987;</div>Loading hours &amp; tips from Square&hellip;</div>`;
    data=await fetchPeriod(off);
  }
  if(_payOffset!==off) return; // user moved to another period while loading
  if(!data||!data.ok){
    box.innerHTML=`<div class="note" style="border-left-color:var(--red);background:var(--red-bg)">Couldn't load payroll from Square${data&&data.detail?(' &mdash; '+esc(data.detail)):''}. Check the Square tokens in Setup and try again.</div>`;
    return;
  }
  // Show the numbers right away; fill in the vs-last-period arrows once the prior period loads.
  renderPayrollBody(data, _payCache[off-1]?buildPrior(_payCache[off-1]):null);
  if(!_payCache[off-1]){
    const prev=await fetchPeriod(off-1);
    if(_payOffset===off && prev && prev.ok) renderPayrollBody(data, buildPrior(prev));
  }
}
async function fetchPeriod(offset){
  if(_payCache[offset]) return _payCache[offset];
  const p=payPeriod(offset);
  let data=null;
  try{
    const r=await fetch('/api/square/payroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({start:p.startYmd,end:p.endYmd})});
    data=await r.json();
  }catch(e){ data={ok:false,error:'network',detail:String(e&&e.message||e)}; }
  if(data&&data.ok) _payCache[offset]=data;
  return data;
}
function buildPrior(data){
  const map={};
  (data.accounts||[]).forEach(a=>(a.locations||[]).forEach(l=>l.employees.forEach(e=>{
    const k=e.id||(e.name+'|'+e.title);
    if(!map[k]) map[k]={hours:0,cardTips:0,cashTips:0,tips:0};
    const o=map[k]; o.hours+=e.hours; o.cardTips+=e.cardTips; o.cashTips+=e.cashTips; o.tips+=e.tips;
  })));
  return map;
}
// Small ▲/▼ %-change chip vs the previous pay period. Amber ≥25%, red ≥50% so
// big swings (e.g. a missed clock-out) stand out.
function payDelta(cur,prev){
  if(prev==null) return '';
  cur=Number(cur)||0; prev=Number(prev)||0;
  if(prev===0 && cur===0) return '';
  if(prev===0) return `<span title="Nothing last period" style="font-size:11px;font-weight:700;color:var(--amber);margin-left:5px;white-space:nowrap">&#9650;new</span>`;
  const d=cur-prev, pct=Math.round(Math.abs(d)/prev*100);
  if(pct===0) return '';
  const arrow=d>0?'&#9650;':'&#9660;';
  const col= pct>=50?'var(--red)': pct>=25?'var(--amber)':'var(--muted)';
  const wt= pct>=25?'700':'600';
  return `<span title="vs last pay period" style="font-size:11px;font-weight:${wt};color:${col};margin-left:5px;white-space:nowrap">${arrow}${pct}%</span>`;
}

function payHrs(h){ return (Math.round((Number(h)||0)*100)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function payC(cents){ return money((Number(cents)||0)/100); }

function payEmpRows(emps,{cash,prior}){
  return emps.map(e=>{
    const pv=prior?prior[e.id||(e.name+'|'+e.title)]:null;
    return `<tr>
    <td>${esc(e.name)}${e.open?' <span title="Still clocked in — hours counted through now" style="color:var(--amber)">&bull;</span>':''}</td>
    <td style="color:var(--muted)">${esc(e.title||'')}</td>
    <td class="num">${payHrs(e.hours)}${payDelta(e.hours, pv?pv.hours:null)}</td>
    <td class="num">${payC(e.cardTips)}</td>
    ${cash?`<td class="num">${payC(e.cashTips)}</td>`:''}
    <td class="num" style="font-weight:700">${payC(e.tips)}${payDelta(e.tips, pv?pv.tips:null)}</td>
  </tr>`;}).join('');
}
function payTotRow(t,{cash,label,prevHours,prevTips}){
  return `<tr class="total"><td colspan="2">${esc(label||'Total')}</td>
    <td class="num">${payHrs(t.hours)}${prevHours!=null?payDelta(t.hours,prevHours):''}</td>
    <td class="num">${payC(t.cardTips)}</td>
    ${cash?`<td class="num">${payC(t.cashTips)}</td>`:''}
    <td class="num">${payC(t.tips)}${prevTips!=null?payDelta(t.tips,prevTips):''}</td></tr>`;
}
function payHead({cash}){
  return `<thead><tr><th>Employee</th><th>Title</th><th class="num">Hours</th><th class="num">Card tips</th>${cash?'<th class="num">Cash tips</th>':''}<th class="num">Total tips</th></tr></thead>`;
}

function renderPayrollBody(data, prior){
  const box=document.getElementById('payrollBody'); if(!box) return;
  const anyCashGrand=(data.grand&&data.grand.cashTips)>0;
  let html='';
  let anyOpen=false;
  (data.accounts||[]).forEach(a=>{ (a.locations||[]).forEach(l=>l.employees.forEach(e=>{ if(e.open)anyOpen=true; })); });

  // Combined by-employee (all locations)
  const be=data.byEmployee||[];

  // One combined table per Square account — all of that account's locations
  // (e.g. both Nashville Barrel spots) merged into a single employee list.
  (data.accounts||[]).forEach(a=>{
    if(a.error){ html+=`<div class="note" style="border-left-color:var(--red);background:var(--red-bg)">${esc(a.label||'Account')}: ${esc(a.error)}</div>`; return; }
    const locs=a.locations||[]; if(!locs.length) return;
    const m={};
    locs.forEach(l=>l.employees.forEach(e=>{
      const k=e.id||(e.name+'|'+e.title);
      if(!m[k]) m[k]={id:e.id,name:e.name,title:e.title,hours:0,cardTips:0,cashTips:0,tips:0,open:false};
      const o=m[k]; o.hours+=e.hours; o.cardTips+=e.cardTips; o.cashTips+=e.cashTips; o.tips+=e.tips; if(e.open)o.open=true;
    }));
    const emps=Object.values(m).map(e=>({...e,hours:Math.round(e.hours*100)/100}))
      .sort((x,y)=>y.hours-x.hours||x.name.localeCompare(y.name));
    const tot=emps.reduce((t,e)=>({hours:t.hours+e.hours,cardTips:t.cardTips+e.cardTips,cashTips:t.cashTips+e.cashTips,tips:t.tips+e.tips}),{hours:0,cardTips:0,cashTips:0,tips:0});
    tot.hours=Math.round(tot.hours*100)/100;
    const cash=tot.cashTips>0;
    const locNames=locs.map(l=>l.name).join(' · ');
    let prevTot=null;
    if(prior){ prevTot={hours:0,tips:0}; emps.forEach(e=>{ const pv=prior[e.id||(e.name+'|'+e.title)]; if(pv){ prevTot.hours+=pv.hours; prevTot.tips+=pv.tips; } }); }
    html+=`<div class="card"><h3>${esc(a.label||'Square account')}</h3>
      <div class="hint">${esc(locNames)}</div>
      <div class="tablewrap"><table>${payHead({cash})}<tbody>
      ${payEmpRows(emps,{cash,prior})}
      ${payTotRow(tot,{cash,label:'Total',prevHours:prevTot?prevTot.hours:null,prevTips:prevTot?prevTot.tips:null})}
      </tbody></table></div></div>`;
  });

  if(!be.length){
    html=`<div class="empty" style="padding:40px"><div class="big">&#128100;</div>No hours or tips recorded for this pay period yet.</div>`;
  } else {
    html+=`<div class="note">Arrows compare each person to the <b>previous pay period</b> &mdash; <span style="color:var(--amber);font-weight:700">amber &ge;25%</span>, <span style="color:var(--red);font-weight:700">red &ge;50%</span>. A big jump in hours often means someone forgot to clock out.</div>`;
    if(anyOpen) html+=`<div class="note">A <span style="color:var(--amber)">&bull;</span> next to a name means that person is still clocked in &mdash; their hours are counted through right now and will update when they clock out.</div>`;
  }
  box.innerHTML=html;
}

function printPayroll(){
  const o=document.getElementById('view-payroll'); if(!o) return;
  o.classList.add('printing'); window.print(); setTimeout(()=>o.classList.remove('printing'),600);
}
