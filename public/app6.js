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
  const p=payPeriod(_payOffset);
  if(_payCache[_payOffset] && !force){ renderPayrollBody(_payCache[_payOffset]); return; }
  _payLoading=true;
  box.innerHTML=`<div class="empty" style="padding:34px"><div class="big">&#8987;</div>Loading hours &amp; tips from Square&hellip;</div>`;
  let data=null;
  try{
    const r=await fetch('/api/square/payroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({start:p.startYmd,end:p.endYmd})});
    data=await r.json();
  }catch(e){ data={ok:false,error:'network',detail:String(e&&e.message||e)}; }
  _payLoading=false;
  if(!data||!data.ok){
    box.innerHTML=`<div class="note" style="border-left-color:var(--red);background:var(--red-bg)">Couldn't load payroll from Square${data&&data.detail?(' &mdash; '+esc(data.detail)):''}. Check the Square tokens in Setup and try again.</div>`;
    return;
  }
  _payCache[_payOffset]=data;
  renderPayrollBody(data);
}

function payHrs(h){ return (Math.round((Number(h)||0)*100)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function payC(cents){ return money((Number(cents)||0)/100); }

function payEmpRows(emps,{cash}){
  return emps.map(e=>`<tr>
    <td>${esc(e.name)}${e.open?' <span title="Still clocked in — hours counted through now" style="color:var(--amber)">&bull;</span>':''}</td>
    <td style="color:var(--muted)">${esc(e.title||'')}</td>
    <td class="num">${payHrs(e.hours)}</td>
    <td class="num">${payC(e.cardTips)}</td>
    ${cash?`<td class="num">${payC(e.cashTips)}</td>`:''}
    <td class="num" style="font-weight:700">${payC(e.tips)}</td>
  </tr>`).join('');
}
function payTotRow(t,{cash,label}){
  return `<tr class="total"><td colspan="2">${esc(label||'Total')}</td>
    <td class="num">${payHrs(t.hours)}</td>
    <td class="num">${payC(t.cardTips)}</td>
    ${cash?`<td class="num">${payC(t.cashTips)}</td>`:''}
    <td class="num">${payC(t.tips)}</td></tr>`;
}
function payHead({cash}){
  return `<thead><tr><th>Employee</th><th>Title</th><th class="num">Hours</th><th class="num">Card tips</th>${cash?'<th class="num">Cash tips</th>':''}<th class="num">Total tips</th></tr></thead>`;
}

function renderPayrollBody(data){
  const box=document.getElementById('payrollBody'); if(!box) return;
  const anyCashGrand=(data.grand&&data.grand.cashTips)>0;
  let html='';
  let anyOpen=false;
  (data.accounts||[]).forEach(a=>{ (a.locations||[]).forEach(l=>l.employees.forEach(e=>{ if(e.open)anyOpen=true; })); });

  // Combined by-employee (all locations)
  const be=data.byEmployee||[];
  if(be.length){
    html+=`<div class="card"><h3>All employees &middot; both accounts</h3>
      <div class="hint">Everyone who worked or earned tips this pay period, combined across locations.</div>
      <div class="tablewrap"><table>${payHead({cash:anyCashGrand})}<tbody>
      ${be.map(e=>`<tr>
        <td>${esc(e.name)}</td>
        <td style="color:var(--muted)">${esc(e.title||'')}${e.locations&&e.locations.length>1?` <span style="font-size:11px">(${esc(e.locations.join(', '))})</span>`:''}</td>
        <td class="num">${payHrs(e.hours)}</td>
        <td class="num">${payC(e.cardTips)}</td>
        ${anyCashGrand?`<td class="num">${payC(e.cashTips)}</td>`:''}
        <td class="num" style="font-weight:700">${payC(e.tips)}</td></tr>`).join('')}
      ${payTotRow(data.grand,{cash:anyCashGrand,label:'Grand total'})}
      </tbody></table></div></div>`;
  }

  // Per account / per location detail
  (data.accounts||[]).forEach(a=>{
    if(a.error){ html+=`<div class="note" style="border-left-color:var(--red);background:var(--red-bg)">${esc(a.label||'Account')}: ${esc(a.error)}</div>`; return; }
    (a.locations||[]).forEach(l=>{
      const cash=(l.totals&&l.totals.cashTips)>0;
      html+=`<div class="card"><h3>${esc(l.name)}</h3>
        <div class="hint">${esc(a.label||'Square account')}</div>
        <div class="tablewrap"><table>${payHead({cash})}<tbody>
        ${payEmpRows(l.employees,{cash})}
        ${payTotRow(l.totals,{cash,label:'Location total'})}
        </tbody></table></div></div>`;
    });
  });

  if(!be.length){
    html=`<div class="empty" style="padding:40px"><div class="big">&#128100;</div>No hours or tips recorded for this pay period yet.</div>`;
  } else if(anyOpen){
    html+=`<div class="note">A <span style="color:var(--amber)">&bull;</span> next to a name means that person is still clocked in — their hours are counted through right now and will update when they clock out.</div>`;
  }
  box.innerHTML=html;
}

function printPayroll(){
  const o=document.getElementById('view-payroll'); if(!o) return;
  o.classList.add('printing'); window.print(); setTimeout(()=>o.classList.remove('printing'),600);
}
