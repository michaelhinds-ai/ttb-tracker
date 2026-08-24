function tibBulkImport(){
  if(!requireCap('write'))return;
  const from=$('#tib_from').value.trim(), permit=$('#tib_permit').value.trim(), date=$('#tib_date').value||new Date().toISOString().slice(0,10);
  if(!from){ alert('Enter the source DSP (who you received these barrels from) before importing.'); $('#tib_from').focus(); return; }
  const txt=($('#tibBulk').value||'').trim(); if(!txt){ alert('Paste some rows first.'); return; }
  const lines=txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const recs=[]; let bbl=0,pg=0,skipped=0;
  for(const line of lines){
    const parts=line.split(/\t|,/).map(s=>s.trim());
    if(parts.length<4){ skipped++; continue; }
    const cls=parts[0]; const fill=normDate(parts[1]);
    const lotPG=parseFloat((parts[2]||'').replace(/[^0-9.]/g,''));
    const qty=parseInt((parts[3]||'').replace(/[^0-9]/g,''),10);
    const lot=parts[4]||'';
    const proof=parts[5]?round1(parseFloat((parts[5]||'').replace(/[^0-9.]/g,''))):0;
    if(!(lotPG>0)||!(qty>0)){ skipped++; continue; }
    const type=/agave|tequila/i.test(cls)?'Agave':/rum/i.test(cls)?'Rum':/brandy/i.test(cls)?'Brandy':'Whiskey';
    const fillWG=proof>0?round2(lotPG*100/proof):0;
    recs.push({id:uid(),barrelNo:'',spirit:cls,spiritType:type,fillDate:fill,distillDate:fill,entryProof:proof>0?proof:0,fillWG,pgTotal:round2(lotPG),qty:qty,size:'53 gal (standard)',char:'',cooperage:'',warehouse:'',location:'',origin:'Received in bond (TIB)',sourceDSP:from,sourcePermit:permit,tibInDate:date,notes:lot?('Lot '+lot):'',status:'Aging'});
    bbl+=qty; pg+=lotPG;
  }
  if(!recs.length){ alert('No valid rows found. Expected each line: Class, Fill Date, Proof Gallons, # Barrels, Lot Code, [Proof].'); return; }
  const replace=$('#tibReplace').checked;
  const willRemove=replace?state.barrels.filter(b=>b.status==='Aging'&&b.origin==='Received in bond (TIB)'&&(b.sourceDSP||'').trim().toLowerCase()===from.toLowerCase()).length:0;
  const rmMsg=replace?`\n\nThis will first REMOVE ${willRemove} existing aging received-in-bond barrel record(s) from ${from}, then import the pasted lots.`:'';
  if(!confirm(`Import ${recs.length} lots — ${bbl} barrels, ${numf(round1(pg))} PG — received in bond${from?(' from '+from):''}?`+rmMsg)) return;
  if(replace){ state.barrels=state.barrels.filter(b=>!(b.status==='Aging'&&b.origin==='Received in bond (TIB)'&&(b.sourceDSP||'').trim().toLowerCase()===from.toLowerCase())); }
  state.barrels.push(...recs);
  const recLines=recs.map(r=>({lot:(r.notes||'').replace(/^Lot\s*/i,'')||'—',dateCode:r.distillDate||'',spirit:(r.spiritType?r.spiritType+' / ':'')+(r.spirit||''),qty:r.qty,proof:+r.entryProof||0,pg:round1(+r.pgTotal||0),wg:round2((+r.fillWG||0)*r.qty)}));
  const rec=addTibinRecord({date,sourceDSP:from,sourcePermit:permit,lines:recLines,totalBarrels:bbl,totalPG:round1(recLines.reduce((s,l)=>s+l.pg,0))});
  save((replace?('Replaced & imported '):('Imported '))+bbl+' barrels in bond from '+from); refreshAll(); $('#tibBulk').value=''; $('#tib_from').value=''; $('#tib_permit').value=''; $('#tibReplace').checked=false;
  $('#tibBulkMsg').innerHTML=`Imported ${bbl} barrels (${recs.length} lots)`+(skipped?`, ${skipped} skipped`:'')+` · <button class="link" onclick="printTransfer('${rec.id}')">🖨 Print receipt ${esc(rec.num)}</button>`;
  flash(`Imported ${bbl} barrels in bond.`);
}

/* ---- Transfer barrels OUT in bond (TIB out) ---- */
let tiboRows=[];
function tiboNewRow(){ return {barrelId:'',no:'',qty:''}; }
function initTibo(){ if(!tiboRows.length) tiboRows=[tiboNewRow()]; if($('#tibo_date')&&!$('#tibo_date').value)$('#tibo_date').value=new Date().toISOString().slice(0,10); renderTiboLines(); }
function tiboLabel(b){ return (b.barrelNo||(barrelCount(b)>1?'Lot ×'+barrelCount(b):'Barrel'))+' — '+(b.spirit||'')+(b.distillDate?(' · '+fmtDate(b.distillDate)):(b.fillDate?(' · '+fmtDate(b.fillDate)):'')); }
function renderTiboLines(){
  const body=$('#tiboLines'); if(!body) return;
  const recs=agingRecords();
  body.innerHTML=tiboRows.map((r,i)=>{
    const b=state.barrels.find(x=>x.id===r.barrelId);
    const avail=b?barrelCount(b):0;
    const perPG=b&&barrelCount(b)?barrelPG(b)/barrelCount(b):0; const outPG=round1(perPG*(+r.qty||0));
    // include the currently-selected lot even if it's no longer in agingRecords (shouldn't happen, but safe)
    const list=recs.slice(); if(b&&!list.some(x=>x.id===b.id)) list.unshift(b);
    const opts=`<option value="">— choose a lot —</option>`+list.map(x=>`<option value="${x.id}" ${x.id===r.barrelId?'selected':''}>${esc(tiboLabel(x))}</option>`).join('');
    return `<tr>
      <td><select data-i="${i}" data-k="barrelId">${opts}</select></td>
      <td><input type="text" data-i="${i}" data-k="no" value="${esc(r.no||'')}" placeholder="e.g. 14I12-A" style="width:130px"></td>
      <td>${b?esc((b.spiritType?b.spiritType+' / ':'')+(b.spirit||'')):''}</td>
      <td class="num">${b?avail:'—'}</td>
      <td class="num"><input type="number" min="1" max="${avail||1}" step="1" data-i="${i}" data-k="qty" value="${r.qty}" style="width:80px" inputmode="numeric"></td>
      <td class="num">${b?numf(outPG):'—'}</td>
      <td class="noprint">${tiboRows.length>1?`<button class="del" data-del="${i}">✕</button>`:''}</td></tr>`;
  }).join('');
  body.querySelectorAll('select,input').forEach(el=>{ el.onchange=el.oninput=e=>{
    const i=+e.target.dataset.i, k=e.target.dataset.k; tiboRows[i][k]=e.target.value;
    if(k==='barrelId'){ renderTiboLines(); }
    else if(k==='qty'){ const b=state.barrels.find(x=>x.id===tiboRows[i].barrelId); const per=b&&barrelCount(b)?barrelPG(b)/barrelCount(b):0; const cell=e.target.closest('tr').querySelector('td:nth-child(6)'); if(cell)cell.textContent=b?numf(round1(per*(+tiboRows[i].qty||0))):'—'; }
    updateTiboSummary();
  };});
  body.querySelectorAll('[data-del]').forEach(el=>{ el.onclick=e=>{ tiboRows.splice(+e.target.dataset.del,1); renderTiboLines(); }; });
  updateTiboSummary();
}
function updateTiboSummary(){ let nb=0,pg=0; tiboRows.forEach(r=>{ const b=state.barrels.find(x=>x.id===r.barrelId); const q=+r.qty||0; if(b&&q>0){ nb+=Math.min(q,barrelCount(b)); pg+=(barrelPG(b)/Math.max(1,barrelCount(b)))*Math.min(q,barrelCount(b)); } }); const el=$('#tiboSummary'); if(el) el.textContent=nb?`${nb} barrel(s) · ${numf(round1(pg))} PG to transfer out`:''; }
function tiboAddLine(){ tiboRows.push(tiboNewRow()); renderTiboLines(); }
function tiboSend(){
  if(!requireCap('write'))return;
  const to=$('#tibo_to').value.trim(), permit=$('#tibo_permit').value.trim(), date=$('#tibo_date').value||new Date().toISOString().slice(0,10);
  if(!to){ alert('Enter the destination DSP name.'); return; }
  const valid=tiboRows.map(r=>({b:state.barrels.find(x=>x.id===r.barrelId&&x.status==='Aging'),qty:+r.qty||0,no:(r.no||'').trim()})).filter(x=>x.b&&x.qty>0);
  if(!valid.length){ alert('Add at least one lot and a quantity to transfer.'); return; }
  for(const {b,qty} of valid){ if(qty>barrelCount(b)){ alert(`Only ${barrelCount(b)} barrel(s) available in ${b.barrelNo||'that lot'}.`); return; } }
  if(!confirm(`Transfer ${valid.reduce((s,x)=>s+x.qty,0)} barrel(s) OUT in bond to ${to}${permit?(' ('+permit+')'):''}? This removes them from aging inventory as a non-taxable transfer.`)) return;
  let totalB=0,totalPG=0; const lines=[];
  valid.forEach(({b,qty,no})=>{
    const perPG=barrelPG(b)/barrelCount(b); const outPG=round1(perPG*qty);
    lines.push({ lot:(no||b.barrelNo||(barrelCount(b)>1?'Lot':'—')), dateCode:(b.distillDate||b.fillDate||''), spirit:(b.spiritType?b.spiritType+' / ':'')+(b.spirit||''), qty, proof:+b.entryProof||0, pg:outPG, wg:round2((b.fillWG||0)*qty) });
    if(qty>=barrelCount(b)){
      b.status='Transferred out (TIB)'; b.destDSP=to; b.destPermit=permit; b.tibOutDate=date; if(no) b.tiboutNo=no;
    } else {
      b.qty=barrelCount(b)-qty; if(b.pgTotal!==undefined&&b.pgTotal!==null&&b.pgTotal!=='') b.pgTotal=round1(+b.pgTotal-outPG);
      state.barrels.push({id:uid(),barrelNo:no||b.barrelNo,tiboutNo:no||'',spirit:b.spirit,spiritType:b.spiritType,mashbill:b.mashbill,distillDate:b.distillDate,fillDate:b.fillDate,entryProof:b.entryProof,fillWG:b.fillWG,pgTotal:outPG,qty:qty,size:b.size,char:b.char,cooperage:b.cooperage,warehouse:b.warehouse,location:b.location,origin:b.origin,sourceDSP:b.sourceDSP,sourcePermit:b.sourcePermit,tibInDate:b.tibInDate,status:'Transferred out (TIB)',destDSP:to,destPermit:permit,tibOutDate:date,notes:b.notes});
    }
    totalB+=qty; totalPG+=outPG;
  });
  state.tibouts=state.tibouts||[];
  const num='TIB-'+String(date).slice(0,4)+'-'+String(state.tibouts.length+1).padStart(3,'0');
  const rec={id:uid(),num,dir:'out',date,destDSP:to,destPermit:permit,lines,totalBarrels:totalB,totalPG:round1(totalPG),by:(authOn()&&SESSION)?SESSION.name:null};
  state.tibouts.push(rec);
  save('Transferred '+totalB+' barrel(s) out in bond to '+to);
  tiboRows=[tiboNewRow()]; $('#tibo_to').value=''; $('#tibo_permit').value=''; renderTiboLines(); refreshAll();
  const res=$('#tiboResult'); if(res){ res.style.display=''; res.innerHTML=`✓ <b>${esc(num)}</b> recorded — ${totalB} barrel(s), ${numf(round1(totalPG))} PG to <b>${esc(to)}</b>. <button class="btn ky sm" style="margin-left:8px" onclick="printTransfer('${rec.id}')">🖨 Print transfer record</button>`; }
  flash(`${totalB} barrel(s) transferred out in bond (${numf(round1(totalPG))} PG) to ${to}.`);
}
function renderTibouts(){
  const card=$('#tiboHistoryCard'), body=$('#tiboHistory'); if(!body) return;
  const recs=[...(state.tibouts||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.num||'').localeCompare(a.num||''));
  if(card) card.style.display=recs.length?'':'none';
  body.innerHTML=recs.map(r=>`<tr><td><b>${esc(r.num||'—')}</b></td><td>${r.date?fmtDate(r.date):'—'}</td><td>${esc(r.destDSP||'')}${r.destPermit?`<div style="font-size:11px;color:var(--muted)">${esc(r.destPermit)}</div>`:''}</td><td class="num">${r.totalBarrels||0}</td><td class="num">${numf(r.totalPG||0)}</td><td class="noprint"><button class="link" onclick="printTransfer('${r.id}')">🖨 Print</button>${can('delete')?` · <button class="del" onclick="deleteTibout('${r.id}')">Del record</button>`:''}</td></tr>`).join('');
}
function deleteTibout(id){ if(!requireCap('delete'))return; if(!confirm('Delete this transfer RECORD? This only removes the printable record — it does NOT put the barrels back into inventory.'))return; state.tibouts=(state.tibouts||[]).filter(x=>x.id!==id); save('Deleted a transfer record'); renderTibouts(); }
function renderTibins(){
  const card=$('#tibinHistoryCard'), body=$('#tibinHistory'); if(!body) return;
  const recs=[...(state.tibins||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.num||'').localeCompare(a.num||''));
  if(card) card.style.display=recs.length?'':'none';
  body.innerHTML=recs.map(r=>`<tr><td><b>${esc(r.num||'—')}</b></td><td>${r.date?fmtDate(r.date):'—'}</td><td>${esc(r.sourceDSP||'')}${r.sourcePermit?`<div style="font-size:11px;color:var(--muted)">${esc(r.sourcePermit)}</div>`:''}</td><td class="num">${r.totalBarrels||0}</td><td class="num">${numf(r.totalPG||0)}</td><td class="noprint"><button class="link" onclick="printTransfer('${r.id}')">🖨 Print</button>${can('delete')?` · <button class="del" onclick="deleteTibin('${r.id}')">Del record</button>`:''}</td></tr>`).join('');
}
function deleteTibin(id){ if(!requireCap('delete'))return; if(!confirm('Delete this receipt RECORD? This only removes the printable record — it does NOT remove the received barrels from inventory.'))return; state.tibins=(state.tibins||[]).filter(x=>x.id!==id); save('Deleted a receipt record'); renderTibins(); }
function transferDocHtml(rec){
  const s=state.settings; const us={name:s.name||'—',permit:s.permit||'',addr:[s.addr1,s.addr2].filter(Boolean).join(', ')};
  const inbound=rec.dir==='in';
  const from = inbound ? {name:rec.sourceDSP||'—',permit:rec.sourcePermit||'',addr:''} : us;
  const to   = inbound ? us : {name:rec.destDSP||'—',permit:rec.destPermit||'',addr:''};
  const rows=(rec.lines||[]).map(l=>`<tr><td>${esc(l.lot||'—')}</td><td>${l.dateCode?esc(fmtDate(l.dateCode)):'—'}</td><td>${esc(l.spirit||'')}</td><td class="num">${l.qty}</td><td class="num">${numf(l.proof,1)}</td><td class="num">${l.wg?numf(l.wg,2):'—'}</td><td class="num">${numf(l.pg)}</td></tr>`).join('');
  const party=(label,d)=>`<div class="party"><b>${label}</b>${esc(d.name)}<br>${d.permit?('Permit '+esc(d.permit)+'<br>'):''}${esc(d.addr||'')}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Transfer in Bond — ${esc(rec.num||'')}</title><style>
    body{font-family:Georgia,'Times New Roman',serif;color:#231a12;margin:40px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #7a5a2b;padding-bottom:12px}
    h1{font-size:20px;margin:0} .sub{color:#6b543c;font-size:12px;font-family:Arial,sans-serif}
    .parties{display:flex;gap:24px;margin-top:16px} .party{flex:1;border:1px solid #d9c3a5;border-radius:6px;padding:10px 12px;font-size:13px} .party b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b543c;margin-bottom:4px}
    table{width:100%;border-collapse:collapse;margin-top:18px;font-size:13px} th,td{border:1px solid #cbb99e;padding:7px 9px;text-align:left} th{background:#f3ece0;font-family:Arial,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:.03em} td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
    tfoot td{font-weight:700;background:#faf5ec}
    .sig{margin-top:48px;display:flex;justify-content:space-between} .sig div{border-top:1px solid #333;width:44%;padding-top:6px;font-size:12px;color:#555;font-family:Arial,sans-serif}
    .foot{margin-top:26px;font-size:11px;color:#8a7a66;font-family:Arial,sans-serif}
    @media print{body{margin:14mm}} </style></head><body>
    <div class="head"><div><h1>Distilled Spirits — Transfer in Bond ${inbound?'(Received)':'(Shipped)'}</h1><div class="sub">Non-taxable transfer between distilled spirits plants</div></div>
      <div style="text-align:right"><div style="font-size:15px"><b>${esc(rec.num||'')}</b></div><div class="sub">${inbound?'Received':'Transfer'} date: ${rec.date?fmtDate(rec.date):'—'}</div></div></div>
    <div class="parties">
      ${party('Shipping DSP (From)',from)}
      ${party('Receiving DSP (To)',to)}
    </div>
    <table><thead><tr><th>Lot / Serial</th><th>Date Code (distilled)</th><th>Spirit Type / Class</th><th class="num"># Barrels</th><th class="num">Proof</th><th class="num">Wine Gal</th><th class="num">Proof Gallons</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3">Total</td><td class="num">${rec.totalBarrels||0}</td><td class="num"></td><td class="num"></td><td class="num">${numf(rec.totalPG||0)}</td></tr></tfoot></table>
    <div class="sig"><div>Shipped by — signature &amp; date</div><div>Received by — signature &amp; date</div></div>
    <div class="foot">Record generated by Mikey Systems${rec.by?(' · '+esc(rec.by)):''}. Retain a copy at both plants. Confirm transfer-in-bond documentation requirements under 27 CFR Part 19 with your compliance advisor.</div>
    <scr`+`ipt>window.onload=function(){setTimeout(function(){window.print();},150);};<\/scr`+`ipt></body></html>`;
}
function printTransfer(id){
  const rec=(state.tibouts||[]).find(x=>x.id===id)||(state.tibins||[]).find(x=>x.id===id); if(!rec){ flash('That transfer record is gone.'); return; }
  const w=window.open('','_blank'); if(!w){ alert('Allow pop-ups for this site to print the transfer record.'); return; }
  w.document.write(transferDocHtml(rec)); w.document.close();
}

/* ---- Bottling / dump ---- */
function initBottling(){ if(!$('#bo_date').value)$('#bo_date').value=new Date().toISOString().slice(0,10); ['bo_proof','bo_bottles'].forEach(id=>$('#'+id).addEventListener('input',updateBottleCalc)); $('#bo_select').onchange=onBottleSelect; $('#bo_qty').addEventListener('input',updateBottleCalc); }
function agingRecords(){ return (state.barrels||[]).filter(b=>b.status==='Aging'&&barrelCount(b)>0); }
function bottleLabel(b){ const lbl=b.barrelNo||(barrelCount(b)>1?'Lot ×'+barrelCount(b):'Barrel'); const d=b.distillDate?(' · distilled '+b.distillDate):(b.fillDate?(' · filled '+b.fillDate):''); return `${lbl} — ${b.spirit||''}${d} · ${numf(b.entryProof||0,0)} pf`; }
function renderBottleSelect(){ const recs=agingRecords(); const cur=$('#bo_select').value; $('#bo_select').innerHTML=`<option value="">— choose a barrel / lot —</option>`+recs.map(b=>`<option value="${b.id}" ${b.id===cur?'selected':''}>${bottleLabel(b)}</option>`).join(''); onBottleSelect(); }
function onBottleSelect(){ const b=state.barrels.find(x=>x.id===$('#bo_select').value); if(b){ $('#bo_class').value=(b.spiritType?b.spiritType+' / ':'')+(b.spirit||''); $('#bo_distill').value=b.distillDate||''; if(!$('#bo_proof').value)$('#bo_proof').value=b.entryProof||''; $('#bo_qty').max=barrelCount(b); if(+$('#bo_qty').value>barrelCount(b))$('#bo_qty').value=barrelCount(b); } else { $('#bo_class').value=''; $('#bo_distill').value=''; } updateBottleCalc(); }
function updateBottleCalc(){ const wg=bottlesToWG($('#bo_bottles').value); const pg=round1(wg*(+$('#bo_proof').value||0)/100); $('#bo_wg').textContent=numf(wg,2)+' WG'; $('#bo_pg').textContent=numf(pg)+' PG'; }
function doBottle(){
  if(!requireCap('write'))return;
  const b=state.barrels.find(x=>x.id===$('#bo_select').value);
  if(!b){ alert('Choose a barrel or lot to bottle.'); return; }
  const dumpQty=Math.max(1,Math.min(barrelCount(b),+$('#bo_qty').value||1));
  const bottles=+$('#bo_bottles').value||0, proof=+$('#bo_proof').value||0;
  const gift=$('#bo_giftshop').checked; const cls=b.spirit||'';
  if(!(bottles>0)){ alert('Enter the number of 750 ml bottles.'); return; }
  const wg=bottlesToWG(bottles), pg=round1(wg*proof/100);
  const msg=gift
    ? `Gift Shop removal: bottle ${dumpQty} barrel(s) into ${bottles} bottles and remove from bond now — records ${numf(pg)} PG of federal excise and a $0 GiftShop invoice. Remove ${dumpQty} barrel(s) from inventory?`
    : `Bottle ${dumpQty} barrel(s) into ${bottles} bottles → held in Finished Goods IN BOND (no excise yet). Remove ${dumpQty} barrel(s) from inventory?`;
  if(!confirm(msg)) return;
  const perBarrelPG=barrelPG(b)/barrelCount(b);
  if(dumpQty>=barrelCount(b)){ b.status='Dumped'; b.dumpDate=$('#bo_date').value; }
  else { b.qty=barrelCount(b)-dumpQty; if(b.pgTotal!==undefined&&b.pgTotal!==null&&b.pgTotal!=='') b.pgTotal=round1(+b.pgTotal-perBarrelPG*dumpQty); }
  const date=$('#bo_date').value; let entryId=null, giftOrderId=null;
  const barrelNo=$('#bo_barrelno').value.trim();
  const btId=uid();
  if(b.status==='Dumped'){ b.dumpNo=barrelNo||b.dumpNo||''; b.dumpBottlingId=btId; }
  if(gift){
    entryId=addRemovalEntry(date,cls,wg,proof,'Gift shop removal','giftshop');
    // leave a trail in Orders: a $0 removal order to the GiftShop customer
    const num=(state.orders.reduce((m,o)=>Math.max(m,o.num||0),0))+1;
    const sku=skuFor(cls,b.distillDate); const cases=Math.floor(bottles/bpc());
    const gc=findOrCreateCustomer('GiftShop'); giftOrderId=uid();
    state.orders.push({id:giftOrderId,num,date,ref:'Gift shop'+(barrelNo?(' · '+barrelNo):''),customerId:gc?gc.id:null,customerName:'GiftShop',lines:[{sku,proof,cases,price:0,bottles,pg:round1(pg),lineTotal:0}],total:0,removedPG:round1(pg),cases,bottles,entryIds:[entryId],status:'Gift shop',giftShop:true,qbSynced:false,qbInvoiceId:null,qbInvoice:'pending'});
  }
  else { addToFinishedGoods(cls,b.distillDate,proof,bottles,date); }
  const dumpPG=round1(perBarrelPG*dumpQty); const lossPG=round1(Math.max(0,dumpPG-pg));
  addProcBulk(date,cls,proof,dumpPG,lossPG,btId);
  state.bottlings.push({id:btId,date,barrelNo,barrelId:b.id,spirit:(b.spiritType?b.spiritType+' / ':'')+cls,distillDate:b.distillDate||'',barrels:dumpQty,proof,bottles,wineGal:wg,pg,dumpPG,lossPG,dumpExact:true,giftShop:gift,entryId,orderId:giftOrderId,qbInvoice:gift?'pending':null});
  save('Bottled '+dumpQty+' barrel(s)'+(barrelNo?(' #'+barrelNo):'')+' → '+bottles+' bottles'+(gift?' (gift shop removal)':''),{type:'bottling',id:btId}); $('#bo_bottles').value=''; $('#bo_barrelno').value=''; $('#bo_giftshop').checked=false; refreshAll(); switchView('bottling');
  if(giftOrderId) autoSyncOrder(giftOrderId);
  flash(gift?`Gift shop: ${bottles} bottles removed from bond.`:`${bottles} bottles → finished goods (in bond).`);
}

/* ---- Finished goods ---- */
function bpc(){ return Math.max(1,+state.settings.bottlesPerCase||6); }
function fgCases(f){ return Math.floor((+f.bottles||0)/bpc()); }
function fgSingles(f){ return (+f.bottles||0)%bpc(); }
function fgPG(f){ return round1(bottlesToWG(+f.bottles||0,f.bottleSize)*(+f.proof||0)/100); }
function skuFor(cls,distillDate){ const yr=(distillDate||'').slice(0,4); return ((cls||'Spirit')+(yr?' '+yr:'')).trim(); }
function addToFinishedGoods(cls,distillDate,proof,bottles,created){
  const sku=skuFor(cls,distillDate);
  let f=state.finishedGoods.find(x=>x.sku===sku&&Math.round(+x.proof)===Math.round(+proof));
  if(f){ f.bottles=(+f.bottles||0)+bottles; }
  else state.finishedGoods.push({id:uid(),sku,spirit:cls,distillDate:distillDate||'',proof:+proof||0,bottleSize:750,bottles,created:created||''});
}
function addRemovalEntry(date,spirit,wg,proof,ref,src){ const e={id:uid(),date:date||new Date().toISOString().slice(0,10),type:'proc_taxpaid',spirit:spirit||'Other',wg:round2(wg),proof:+proof||0,pg:round1(wg*(+proof||0)/100),ref:ref||'',notes:'',src:src||''}; state.entries.push(e); return e.id; }
// Route bottled bulk through the Processing account (TTB): the dumped proof gallons
// transfer IN, the angel's-share posts as a processing loss, and the taxpaid removal
// (gift shop now, or a later order) draws it back down. Net effect: Processing reflects
// finished-goods-in-bond and can never go negative. Tagged by bottling id, so it's idempotent.
function addProcBulk(date,spirit,proof,dumpPG,lossPG,tag){
  const pr=+proof||0, mk=pg=>({wg:pr>0?round2(pg*100/pr):0,proof:pr,pg:round1(pg)});
  if(dumpPG>0) state.entries.push({id:uid(),date,type:'proc_deposit',spirit:spirit||'Other',...mk(dumpPG),ref:'Bottling — bulk into processing',notes:'',src:'dump:'+tag});
  if(lossPG>0) state.entries.push({id:uid(),date,type:'proc_loss',spirit:spirit||'Other',...mk(lossPG),ref:"Bottling — angel's share",notes:'',src:'dumploss:'+tag});
}
// One-time backfill: give every PAST bottling the same processing transfer + loss, using the
// dumpPG / lossPG already stored on the bottling record. Safe to re-run.
function reconcileProcessing(){
  if(!requireCap('write'))return;
  const have=new Set(state.entries.map(e=>e.src).filter(Boolean));
  let added=0;
  (state.bottlings||[]).forEach(b=>{
    const pr=+b.proof||0, spirit=b.spirit||'Other', date=b.date||new Date().toISOString().slice(0,10);
    const dumpPG=(b.dumpPG!=null&&b.dumpPG!=='')?round1(+b.dumpPG):round1((+b.pg||0)+(+b.lossPG||0));
    const lossPG=round1(+b.lossPG||0);
    const mk=pg=>({wg:pr>0?round2(pg*100/pr):0,proof:pr,pg:round1(pg)});
    if(dumpPG>0&&!have.has('dump:'+b.id)){ state.entries.push({id:uid(),date,type:'proc_deposit',spirit,...mk(dumpPG),ref:'Bottling — bulk into processing',notes:'',src:'dump:'+b.id}); added++; }
    if(lossPG>0&&!have.has('dumploss:'+b.id)){ state.entries.push({id:uid(),date,type:'proc_loss',spirit,...mk(lossPG),ref:"Bottling — angel's share",notes:'',src:'dumploss:'+b.id}); added++; }
  });
  if(added){ save('Routed '+added+' bottling bulk entr'+(added===1?'y':'ies')+' through Processing'); refreshAll(); flash('Added '+added+' processing entr'+(added===1?'y':'ies')+' — Bulk on Hand is now correct.'); }
  else flash('Already reconciled — every bottling is routed through Processing.');
}
function renderFinished(){
  const all=(state.finishedGoods||[]).filter(f=>(+f.bottles||0)>0);
  const totalBottles=all.reduce((s,f)=>s+(+f.bottles||0),0), totalCases=all.reduce((s,f)=>s+fgCases(f),0), totalPG=round1(all.reduce((s,f)=>s+fgPG(f),0));
  $('#fgKpis').innerHTML=[
    kpi('barrel','Cases in Bond',totalCases.toLocaleString(),all.length+' SKUs'),
    kpi('copper','Bottles in Bond',totalBottles.toLocaleString(),'held for sale'),
    kpi('green','Proof Gallons',numf(totalPG),'in bond (untaxed)'),
    kpi('blue','SKUs Ready',all.length.toLocaleString(),'with stock on hand'),
  ].join('');
  const q=($('#fgSearch').value||'').toLowerCase();
  const rows=all.filter(f=>!q||`${f.sku} ${f.spirit}`.toLowerCase().includes(q)).sort((a,b)=>a.sku.localeCompare(b.sku));
  $('#fgBody').innerHTML=rows.map(f=>{const a=[];if(can('write'))a.push(`<button class="link" onclick="editFgSku('${f.id}')">Rename</button>`);if(can('delete'))a.push(`<button class="del" onclick="deleteFg('${f.id}')">Del</button>`);return `<tr><td><b>${f.sku}</b></td><td>${f.spirit||''}</td><td>${f.distillDate?fmtDate(f.distillDate):'—'}</td><td class="num">${numf(f.proof,1)}</td><td class="num">${fgCases(f)}</td><td class="num">${fgSingles(f)}</td><td class="num">${(+f.bottles||0).toLocaleString()}</td><td class="num">${numf(fgPG(f))}</td><td class="noprint">${a.join(' · ')}</td></tr>`;}).join('');
  $('#fgEmpty').innerHTML=rows.length?'':`<div class="empty"><div class="big">🍾</div>No finished goods in bond yet. Bottle a barrel with Gift Shop unchecked to create some.</div>`;
}
function editFgSku(id){ if(!requireCap('write'))return; const f=state.finishedGoods.find(x=>x.id===id); if(!f)return; const v=prompt('SKU name:',f.sku); if(v===null)return; f.sku=(v.trim()||f.sku); save('Renamed a finished-goods SKU'); renderFinished(); }
function deleteFg(id){ if(!requireCap('delete'))return; if(!confirm('Delete this finished-goods line? Use only to fix an error — it does not record a removal.'))return; state.finishedGoods=state.finishedGoods.filter(x=>x.id!==id); save('Deleted a finished-goods line'); refreshAll(); }
function exportFgCsv(){ const head=['SKU','Spirit','DistillationDate','Proof','Cases','Singles','Bottles','ProofGallons']; const rows=(state.finishedGoods||[]).filter(f=>+f.bottles>0).map(f=>[f.sku,f.spirit,f.distillDate,f.proof,fgCases(f),fgSingles(f),f.bottles,fgPG(f)].map(csv).join(',')); const blob=new Blob([head.join(',')+'\n'+rows.join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='finished-goods.csv';a.click();URL.revokeObjectURL(a.href); }

/* ---- Customers ---- */
let editingCustId=null;
function readCust(){ return {name:$('#c_name').value.trim(),contact:$('#c_contact').value.trim(),email:$('#c_email').value.trim(),phone:$('#c_phone').value.trim(),terms:$('#c_terms').value.trim(),notes:$('#c_notes').value.trim()}; }
function saveCust(){ if(!requireCap('write'))return; const d=readCust(); if(!d.name){alert('Enter a customer name.');return;} if(editingCustId){const i=state.customers.findIndex(c=>c.id===editingCustId);if(i>=0)state.customers[i]=Object.assign(state.customers[i],d);cancelCust();} else state.customers.push(Object.assign({id:uid(),qbId:null},d)); const cl=(d.name?(' — '+d.name):''); clearCust(); save('Saved a customer'+cl); refreshAll(); flash('Customer saved.'); }
function clearCust(){ ['c_name','c_contact','c_email','c_phone','c_terms','c_notes'].forEach(i=>$('#'+i).value=''); }
function editCust(id){ if(!requireCap('write'))return; const c=state.customers.find(x=>x.id===id); if(!c)return; editingCustId=id; $('#c_name').value=c.name||'';$('#c_contact').value=c.contact||'';$('#c_email').value=c.email||'';$('#c_phone').value=c.phone||'';$('#c_terms').value=c.terms||'';$('#c_notes').value=c.notes||''; $('#custFormTitle').textContent='Edit Customer'; $('#custCancel').style.display='inline-block'; switchView('customers'); window.scrollTo({top:0,behavior:'smooth'}); }
function cancelCust(){ editingCustId=null; clearCust(); $('#custCancel').style.display='none'; $('#custFormTitle').textContent='Add Customer'; }
function deleteCust(id){ if(!requireCap('delete'))return; if(!confirm('Delete this customer?'))return; state.customers=state.customers.filter(x=>x.id!==id); save('Deleted a customer'); refreshAll(); }
function renderCustomers(){
  const q=($('#custSearch').value||'').toLowerCase();
  const rows=[...state.customers].filter(c=>!q||`${c.name} ${c.contact} ${c.email}`.toLowerCase().includes(q)).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  $('#custBody').innerHTML=rows.map(c=>{const a=[];if(can('write'))a.push(`<button class="link" onclick="editCust('${c.id}')">Edit</button>`);if(can('delete'))a.push(`<button class="del" onclick="deleteCust('${c.id}')">Del</button>`);return `<tr><td><b>${c.name||''}</b></td><td>${c.contact||''}</td><td>${c.email||''}</td><td>${c.phone||''}</td><td>${c.terms||''}</td><td>${c.qbId?`<span class="pill tax">linked</span>`:'—'}</td><td class="noprint">${a.join(' · ')}</td></tr>`;}).join('');
  $('#custEmpty').innerHTML=rows.length?'':`<div class="empty"><div class="big">👤</div>No customers yet. Add one above.</div>`;
}

/* ---- Orders ---- */
let orderLines=[];
function orderNewLine(){ return {fgId:'',cases:'',price:''}; }
function initOrders(){ if(!orderLines.length) orderLines=[orderNewLine()]; if(!$('#o_date').value)$('#o_date').value=new Date().toISOString().slice(0,10); }
function fgOnHand(){ return (state.finishedGoods||[]).filter(f=>fgCases(f)>0); }
function renderOrderLines(){
  const body=$('#orderLines'); if(!body)return; const avail=fgOnHand();
  body.innerHTML=orderLines.map((ln,i)=>{ const f=state.finishedGoods.find(x=>x.id===ln.fgId); const onHand=f?fgCases(f):'—'; const lt=(+ln.cases||0)*(+ln.price||0);
    return `<tr>
      <td><select data-i="${i}" data-k="fgId"><option value="">— choose —</option>${avail.map(x=>`<option value="${x.id}" ${x.id===ln.fgId?'selected':''}>${x.sku} — ${numf(x.proof,0)} pf (${fgCases(x)} cs)</option>`).join('')}</select></td>
      <td class="num">${onHand}</td>
      <td><input type="number" step="1" min="1" data-i="${i}" data-k="cases" value="${ln.cases||''}" style="max-width:80px"></td>
      <td><input type="number" step="0.01" min="0" data-i="${i}" data-k="price" value="${ln.price||''}" style="max-width:110px"></td>
      <td class="num">${money(lt)}</td>
      <td class="noprint">${orderLines.length>1?`<button class="del" data-del="${i}">✕</button>`:''}</td></tr>`;
  }).join('');
  body.querySelectorAll('select[data-k="fgId"]').forEach(el=>el.onchange=e=>{orderLines[+e.target.dataset.i].fgId=e.target.value;renderOrderLines();});
  body.querySelectorAll('input[data-k]').forEach(el=>el.oninput=e=>{const i=+e.target.dataset.i;orderLines[i][e.target.dataset.k]=e.target.value;const lt=(+orderLines[i].cases||0)*(+orderLines[i].price||0);const cell=e.target.closest('tr').querySelector('td:nth-child(5)');if(cell)cell.textContent=money(lt);updateOrderTotal();});
  body.querySelectorAll('[data-del]').forEach(el=>el.onclick=e=>{orderLines.splice(+e.target.dataset.del,1);renderOrderLines();});
  updateOrderTotal();
}
function updateOrderTotal(){ const t=orderLines.reduce((s,l)=>s+(+l.cases||0)*(+l.price||0),0); const cs=orderLines.reduce((s,l)=>s+(+l.cases||0),0); $('#orderTotal').textContent=cs?`${cs} cases · ${money(t)}`:''; }
function orderAddLine(){ orderLines.push(orderNewLine()); renderOrderLines(); }
function findOrCreateCustomer(name){
  name=(name||'').trim(); if(!name) return null;
  let c=state.customers.find(x=>(x.name||'').trim().toLowerCase()===name.toLowerCase());
  if(!c){ c={id:uid(),qbId:null,name}; state.customers.push(c); }
  return c;
}
function orderCreate(){
  if(!requireCap('write'))return;
  const cust=findOrCreateCustomer($('#o_customer').value);
  if(!cust){ alert('Enter a customer name.'); return; }
  const valid=orderLines.map(l=>({cases:+l.cases||0,price:+l.price||0,fg:state.finishedGoods.find(f=>f.id===l.fgId)})).filter(l=>l.fg&&l.cases>0);
  if(!valid.length){ alert('Add at least one line with a product and case count.'); return; }
  for(const l of valid){ if(l.cases>fgCases(l.fg)){ alert(`Only ${fgCases(l.fg)} cases of ${l.fg.sku} on hand.`); return; } }
  const date=$('#o_date').value; const num=(state.orders.reduce((m,o)=>Math.max(m,o.num||0),0))+1;
  const lines=[],entryIds=[]; let total=0,pgTotal=0,casesTotal=0;
  valid.forEach(l=>{ const bottles=l.cases*bpc(); const wg=bottlesToWG(bottles); const pg=round1(wg*(l.fg.proof||0)/100);
    l.fg.bottles=(+l.fg.bottles||0)-bottles;
    entryIds.push(addRemovalEntry(date,l.fg.spirit,wg,l.fg.proof,`Order #${num} · ${cust.name}`,'order:'+num));
    lines.push({fgId:l.fg.id,sku:l.fg.sku,proof:l.fg.proof,cases:l.cases,price:l.price,bottles,pg,lineTotal:round2(l.cases*l.price)});
    total+=l.cases*l.price; pgTotal+=pg; casesTotal+=l.cases; });
  const oid=uid();
  state.orders.push({id:oid,num,date,ref:$('#o_ref').value.trim(),customerId:cust.id,customerName:cust.name,lines,total:round2(total),removedPG:round1(pgTotal),cases:casesTotal,entryIds,status:'Removed',qbSynced:false,qbInvoiceId:null});
  orderLines=[orderNewLine()]; $('#o_ref').value=''; $('#o_customer').value='';
  save('Created order #'+num+' — '+casesTotal+' cases · '+cust.name); refreshAll(); switchView('orders');
  autoSyncOrder(oid);
  flash(`Order #${num} created — ${casesTotal} cases removed from bond (${numf(round1(pgTotal))} PG).`);
}
function deleteOrder(id){ if(!requireCap('delete'))return; const o=state.orders.find(x=>x.id===id); if(!o)return; if(!confirm(`Reverse order #${o.num}? Restores the cases to finished goods and removes its excise removal entries.`))return;
  (o.lines||[]).forEach(l=>{ const f=state.finishedGoods.find(x=>x.id===l.fgId); if(f)f.bottles=(+f.bottles||0)+(+l.bottles||0); });
  (o.entryIds||[]).forEach(eid=>{ state.entries=state.entries.filter(e=>e.id!==eid); });
  state.orders=state.orders.filter(x=>x.id!==id); save('Reversed order #'+o.num); refreshAll(); flash('Order #'+o.num+' reversed.'); }
function renderOrders(){
  const cs=[...state.customers].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const dl=$('#custList'); if(dl) dl.innerHTML=cs.map(c=>`<option value="${(c.name||'').replace(/"/g,'&quot;')}"></option>`).join('');
  renderOrderLines();
  const rows=[...state.orders].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.num||0)-(a.num||0));
  $('#orderBody').innerHTML=rows.map(o=>`<tr><td>#${o.num}</td><td>${o.date?fmtDate(o.date):''}</td><td>${o.customerName||''}${o.giftShop?' <span class="pill" style="background:#efe7d8;color:#7a5a2b">gift shop</span>':''}</td><td class="num">${o.cases||0}</td><td class="num">${numf(o.removedPG||0)}</td><td class="num">${money(o.total||0)}</td><td>${o.qbSynced?`<span class="pill tax">QB #${o.qbDoc||o.qbInvoiceId||'✓'}</span>`:`<span class="pill" style="background:#f2ebdc;color:#7a5a2b">not synced</span>`}</td><td class="noprint">${(!o.qbSynced&&can('write'))?`<button class="link" onclick="sendOrderToQB('${o.id}')">Send to QB</button> · `:''}${can('delete')?`<button class="del" onclick="deleteOrder('${o.id}')">Reverse</button>`:''}</td></tr>`).join('');
  $('#orderEmpty').innerHTML=rows.length?'':`<div class="empty"><div class="big">📦</div>No orders yet. Add a customer and some finished goods, then create one above.</div>`;
}

function backfillGiftOrders(){
  let n=0;
  const gc=findOrCreateCustomer('GiftShop');
  (state.bottlings||[]).forEach(bt=>{
    if(!bt.giftShop) return;
    if(bt.orderId && state.orders.some(o=>o.id===bt.orderId)) return; // already has a trail
    const num=(state.orders.reduce((m,o)=>Math.max(m,o.num||0),0))+1;
    const cls=(bt.spirit||'').split(' / ').pop()||bt.spirit;
    const sku=skuFor(cls,bt.distillDate); const bottles=+bt.bottles||0; const cases=Math.floor(bottles/bpc());
    const oid=uid();
    state.orders.push({id:oid,num,date:bt.date,ref:'Gift shop'+(bt.barrelNo?(' · '+bt.barrelNo):''),customerId:gc?gc.id:null,customerName:'GiftShop',lines:[{sku,proof:bt.proof,cases,price:0,bottles,pg:round1(+bt.pg||0),lineTotal:0}],total:0,removedPG:round1(+bt.pg||0),cases,bottles,entryIds:bt.entryId?[bt.entryId]:[],status:'Gift shop',giftShop:true,qbSynced:false,qbInvoiceId:null,qbInvoice:'pending'});
    bt.orderId=oid; n++;
  });
  return n;
}
function runBackfillGift(){ if(!requireCap('write'))return;
  const n=backfillGiftOrders();
  if(!n){ flash('All gift-shop bottlings already have an order.'); return; }
  save('Backfilled '+n+' gift-shop order(s)'); refreshAll();
  flash('Created '+n+' gift-shop order(s) in the history.');
}
function renderBottling(){ renderBottleSelect(); updateBottleCalc();
  const rows=[...(state.bottlings||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  $('#bottlingBody').innerHTML=rows.map(r=>`<tr><td>${r.date?fmtDate(r.date):'—'}</td><td><button class="link" onclick="openBottlingDetail('${r.id}')">${r.barrelNo||'view ›'}</button></td><td>${r.spirit}</td><td>${r.distillDate?fmtDate(r.distillDate):'—'}</td><td class="num">${r.barrels}</td><td class="num">${numf(r.proof,1)}</td><td class="num">${r.bottles}</td><td class="num">${numf(r.wineGal,2)}</td><td class="num">${numf(r.pg)}</td><td class="num">${r.lossPG!=null?numf(r.lossPG):'—'}</td><td class="noprint">${can('delete')?`<button class="del" onclick="deleteBottling('${r.id}')">Del</button>`:''}</td></tr>`).join('');
  $('#bottlingEmpty').innerHTML=rows.length?'':`<div class="empty"><div class="big">🍾</div>No bottlings recorded yet.</div>`;
}
function deleteBottling(id){ if(!requireCap('delete'))return; if(!confirm('Delete this bottling record? (This does not restore barrels to inventory.)'))return; state.bottlings=state.bottlings.filter(x=>x.id!==id); save('Deleted a bottling record'); renderBottling(); }
function openBottlingDetail(id){
  const b=(state.bottlings||[]).find(x=>x.id===id);
  if(!b){ flash('That bottling record was removed.'); return; }
  const src=(state.barrels||[]).find(x=>x.id===b.barrelId);
  const cases=Math.floor((+b.bottles||0)/bpc()), singles=(+b.bottles||0)%bpc();
  const row=(k,v)=>`<div style="display:flex;justify-content:space-between;gap:18px;padding:7px 0;border-bottom:1px solid #eee2d0"><span style="color:var(--muted)">${k}</span><b style="text-align:right">${v}</b></div>`;
  const body=[
    row('Bottled on', b.date?fmtDate(b.date):'—'),
    row('Barrel # assigned', b.barrelNo||'—'),
    row('Spirit', b.spirit||'—'),
    row('Distilled', b.distillDate?fmtDate(b.distillDate):'—'),
    row('Barrels dumped', b.barrels||0),
    row('Proof', numf(b.proof,1)+'°'),
    row('Bottles', (+b.bottles||0).toLocaleString()+`  (${cases} case${cases===1?'':'s'}${singles?' + '+singles+' singles':''})`),
    row('Wine gallons', numf(b.wineGal,2)),
    row('Bottled proof gallons', numf(b.pg)),
    row('Dumped proof gallons', b.dumpPG!=null?numf(b.dumpPG):'—'),
    row('Loss (angel\'s share on dump)', b.lossPG!=null?numf(b.lossPG)+' PG':'—'),
    row('Channel', b.giftShop?'Gift shop removal (tax-paid)':'Finished goods (in bond)'),
    src?row('Source lot', (src.barrelNo||src.dumpNo||'Lot')+' · '+(src.spirit||'')):'',
  ].join('');
  let ov=$('#btDetail'); if(ov) ov.remove();
  ov=document.createElement('div'); ov.id='btDetail';
  ov.style.cssText='position:fixed;inset:0;background:rgba(20,12,6,.55);z-index:300;display:flex;align-items:center;justify-content:center;padding:18px';
  ov.innerHTML=`<div style="background:#fbf6ec;max-width:440px;width:100%;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.4);overflow:hidden;font-family:-apple-system,Segoe UI,sans-serif">
    <div style="background:#241812;color:#f4e9d6;padding:14px 18px;display:flex;justify-content:space-between;align-items:center"><b>Bottling detail${b.barrelNo?(' · #'+b.barrelNo):''}</b><button class="link" style="color:#f4e9d6" onclick="document.getElementById('btDetail').remove()">Close ✕</button></div>
    <div style="padding:14px 18px 18px">${body}</div></div>`;
  ov.onclick=e=>{ if(e.target===ov) ov.remove(); };
  document.body.appendChild(ov);
}
function backfillBottlingLoss(){
  let fixed=0;
  const sp=b=>((b.spiritType?b.spiritType+' / ':'')+(b.spirit||''));
  // Best per-barrel entry PG: prefer a lot whose per-barrel PG is >= the bottled-per-barrel (can't bottle more than dumped)
  const bestPer=(list,target)=>{ const v=list.map(b=>{const c=barrelCount(b);return c>0?barrelPG(b)/c:0;}).filter(x=>x>0);
    if(!v.length) return null; const above=v.filter(x=>x>=target).sort((a,b)=>a-b); return above.length?above[0]:Math.max.apply(null,v); };
  (state.bottlings||[]).forEach(bt=>{
    if(bt.dumpExact) return; // created with an exact dump PG — never overwrite
    const nB=Math.max(1,+bt.barrels||1); const target=(+bt.pg||0)/nB;
    let pb=bestPer((state.barrels||[]).filter(b=>sp(b)===bt.spirit&&(b.distillDate||'')===(bt.distillDate||'')),target);
    if(pb==null) pb=bestPer((state.barrels||[]).filter(b=>sp(b)===bt.spirit),target);
    if(pb==null) pb=bestPer((state.barrels||[]),target);
    const dumpPG = pb!=null ? round1(pb*nB) : (+bt.pg||0);
    bt.dumpPG=dumpPG; bt.lossPG=round1(Math.max(0,dumpPG-(+bt.pg||0))); fixed++;
  });
  return fixed;
}
function recalcLosses(){
  if(!requireCap('write'))return;
  const n=backfillBottlingLoss();
  if(!n){ flash('All bottlings already have dump losses recorded.'); return; }
  save('Recalculated dump losses on '+n+' bottling(s)'); renderBottling();
  flash('Updated '+n+' bottling record(s) with dump loss.');
}
// Give every past bottling a matching "dumped" barrel record so each true barrel shows on the
// Barrels page (searchable by the code you assigned) and links to its bottling detail.
// These records are tracking-only (flagged fromBottling) and DO NOT change any report math —
// storage/processing totals still come from the bottling log, so validated filings are untouched.
function planReconcileDumps(){
  const bottled=(state.bottlings||[]);
  const plan=[];
  bottled.forEach(bt=>{
    // already represented by a dumped barrel tied to this bottling?
    const linked=(state.barrels||[]).some(b=>b.dumpBottlingId===bt.id);
    if(linked) return;
    // if this bottling fully dumped a still-present single barrel, adopt it in place (no new record)
    let src=null;
    if(bt.barrelId) src=(state.barrels||[]).find(b=>b.id===bt.barrelId&&b.status==='Dumped');
    plan.push({bt, adopt:src||null});
  });
  return plan;
}
function reconcilePastDumps(){
  if(!requireCap('write'))return;
  const plan=planReconcileDumps();
  if(!plan.length){ flash('Every past dump already has a barrel record.'); return; }
  if(!confirm(`Create a dumped-barrel record for ${plan.length} past bottling(s)?\n\nEach becomes a searchable barrel on the Barrels page (found by the code you assigned) and links to its bottling detail. This is a tracking trail only — it does NOT change any TTB report totals. Undo anytime from Recent Activity.`)) return;
  let n=0;
  plan.forEach(({bt})=>{
    const spiritFull=bt.spirit||'';
    const parts=spiritFull.split(' / ');
    const spiritType=parts.length>1?parts[0]:'';
    const cls=parts.length>1?parts.slice(1).join(' / '):spiritFull;
    const perBarrel=Math.max(1,+bt.barrels||1);
    const pgEach=round1((bt.dumpPG!=null?+bt.dumpPG:+bt.pg||0));
    // pull entry proof/wine-gal from the source lot if we can find one, else from the bottling
    const match=(state.barrels||[]).find(b=>((b.spiritType?b.spiritType+' / ':'')+(b.spirit||''))===spiritFull&&(b.distillDate||'')===(bt.distillDate||''))
      || (state.barrels||[]).find(b=>(b.spirit||'')===cls);
    const entryProof=match?(+match.entryProof||+bt.proof||0):(+bt.proof||0);
    const nb={
      id:uid(), fromBottling:true, barrelNo:bt.barrelNo||'', dumpNo:bt.barrelNo||'',
      spirit:cls, spiritType, mashbill:match?match.mashbill:'',
      distillDate:bt.distillDate||'', fillDate:match?match.fillDate:(bt.distillDate||''),
      entryProof, fillWG:0, pgTotal:pgEach, qty:1,
      warehouse:match?match.warehouse:'', location:match?match.location:'',
      origin:match?match.origin:'', sourceDSP:match?match.sourceDSP:'', sourcePermit:match?match.sourcePermit:'',
      tibInDate:match?match.tibInDate:'',
      status:'Dumped', dumpDate:bt.date||'', dumpBottlingId:bt.id,
      notes:'Reconciled from bottling record'+(perBarrel>1?(' (1 of '+perBarrel+' barrels dumped together)'):'')
    };
    state.barrels.push(nb);
    bt.barrelId=nb.id;
    n++;
  });
  save('Reconciled '+n+' past dump(s) into barrel records'); refreshAll();
  flash('Added '+n+' dumped-barrel record(s). Filter Barrels by "Dumped" to see them.');
}

/* ---- QuickBooks (front-end) ---- */
async function qbRefresh(){
  const el=$('#qbStatus'); if(!el) return;
  if(location.protocol==='file:'){ el.textContent='QuickBooks connects only on the hosted site.'; if($('#qbConnect'))$('#qbConnect').style.display='none'; return; }
  try{
    const r=await fetch('/api/qb/status',{cache:'no-store'}); const d=await r.json();
    if(!d.configured){ el.innerHTML='⚠️ Not configured — add QB_CLIENT_ID, QB_CLIENT_SECRET, QB_ENVIRONMENT in Netlify env vars.'; $('#qbConnect').style.display='none'; $('#qbDisconnect').style.display='none'; return; }
    $('#qbConnect').style.display='inline-block';
    if(d.connected){ el.innerHTML=`✅ Connected to <b>${d.company||'QuickBooks'}</b> <span style="color:var(--muted)">(${d.environment})</span>.`; $('#qbConnect').textContent='Reconnect'; $('#qbDisconnect').style.display='inline-block'; }
    else { el.innerHTML='Not connected yet.'+(d.error?` <span style="color:var(--red)">(${d.error})</span>`:''); $('#qbConnect').textContent='Connect QuickBooks'; $('#qbDisconnect').style.display='none'; }
  }catch(e){ el.textContent='Could not check QuickBooks status.'; }
}
function qbConnect(){ if(!requireCap('setup'))return; location.href='/api/qb/connect?ws='+encodeURIComponent(WS); }
async function qbDisconnect(){ if(!requireCap('setup'))return; if(!confirm('Disconnect QuickBooks?'))return; try{ await fetch('/api/qb/disconnect?app=1'); }catch(e){} flash('QuickBooks disconnected.'); qbRefresh(); }
async function sendOrderToQB(id,silent){
  if(!can('write')){ if(!silent) flash('Your role can’t sync to QuickBooks.'); return; }
  const o=state.orders.find(x=>x.id===id); if(!o)return;
  if(location.protocol==='file:'){ if(!silent)alert('QuickBooks works only on the hosted site.'); return; }
  const cust=state.customers.find(c=>c.id===o.customerId)||{name:o.customerName};
  const lines=(o.lines||[]).map(l=>({sku:l.sku,description:l.sku,qty:l.cases,unitPrice:l.price}));
  if(!silent) flash('Sending order #'+o.num+' to QuickBooks…');
  try{
    const r=await fetch('/api/qb/invoice',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customer:{name:cust.name,email:cust.email,phone:cust.phone},lines,docNumber:o.num,txnDate:o.date,privateNote:'TTB Tracker order #'+o.num})});
    const d=await r.json();
    if(d.ok){ o.qbSynced=true; o.qbInvoiceId=d.invoiceId; o.qbDoc=d.docNumber; save(false); renderOrders(); flash((o.giftShop?'Gift shop order #':'Order #')+o.num+' invoiced in QuickBooks (#'+(d.docNumber||d.invoiceId)+').'); }
    else if(d.error==='not_connected'){ if(!silent)alert('QuickBooks is not connected. Connect it on the Setup & Sync tab first.'); }
    else { if(!silent)alert('QuickBooks error: '+(d.detail?JSON.stringify(d.detail).slice(0,300):d.error)+(d.tid?(' (ref '+d.tid+')'):'')); }
  }catch(e){ if(!silent)alert('Could not reach QuickBooks: '+e.message); }
}
// auto-post an order to QB right after creation (silent — leaves it pending if QB is down)
function autoSyncOrder(id){ if(location.protocol==='file:')return; setTimeout(()=>sendOrderToQB(id,true),100); }
async function syncAllPendingQB(){
  if(!requireCap('write'))return;
  const pend=state.orders.filter(o=>!o.qbSynced); if(!pend.length){ flash('All orders already synced to QuickBooks.'); return; }
  if(!confirm('Send '+pend.length+' unsynced order(s) to QuickBooks now?')) return;
  for(const o of pend){ await sendOrderToQB(o.id,true); }
  renderOrders();
}

/* ================= Boot ================= */
function wireOnce(){
  $$('#tabs button').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
  $('#saveEntry').onclick=()=>saveEntryForm(false);$('#saveAddAnother').onclick=()=>saveEntryForm(true);
  $('#cancelEdit').onclick=()=>{editingId=null;$('#cancelEdit').style.display='none';$('#entryTitle').textContent='New Entry';switchView('ledger');};
  $('#ledgerSearch').oninput=renderLedger;$('#ledgerAccount').onchange=renderLedger;$('#ledgerYear').onchange=renderLedger;$('#exportCsv').onclick=exportCsv;
  $('#saveSettings').onclick=saveSettings;$('#exportJson').onclick=exportJson;$('#importBtn').onclick=()=>$('#importFile').click();
  $('#fillFed').onclick=fedPdf;
  $('#importFile').onchange=e=>{if(e.target.files[0])importJson(e.target.files[0]);e.target.value='';};
  $('#loadSample').onclick=loadSample;$('#clearAll').onclick=clearAll;$('#printRpt').onclick=printReport;$('#printKy').onclick=printKy;
  $('#copyLink').onclick=copyLink;$('#showJoin').onclick=()=>{const w=$('#joinWrap');w.style.display=w.style.display==='none'?'block':'none';};$('#joinBtn').onclick=joinWorkspace;
  $('#saveBarrel').onclick=()=>saveBarrelForm(false);$('#saveBarrelAnother').onclick=()=>saveBarrelForm(true);
  $('#cancelBarrel').onclick=cancelBarrelEdit;
  $('#barrelSearch').oninput=renderBarrels;$('#barrelStatus').onchange=renderBarrels;$('#barrelSpirit').onchange=renderBarrels;$('#exportBarrelsCsv').onclick=exportBarrelsCsv;
  $('#tibAddLine').onclick=tibAddLine; $('#tibReceive').onclick=tibReceive; $('#tibBulkImport').onclick=tibBulkImport;
  $('#tiboAddLine').onclick=tiboAddLine; $('#tiboSend').onclick=tiboSend;
  document.querySelectorAll('#barrelHead th.bs').forEach(th=>th.onclick=()=>setBarrelSort(th.dataset.bsort));
  $('#bo_do').onclick=doBottle;
  $('#fgSearch').oninput=renderFinished; $('#fgExport').onclick=exportFgCsv;
  $('#recalcLoss').onclick=recalcLosses; $('#reconcileDumps').onclick=reconcilePastDumps; $('#backfillGift').onclick=runBackfillGift; $('#routeProc').onclick=reconcileProcessing; $('#syncAllQB').onclick=syncAllPendingQB;
  $('#custSave').onclick=saveCust; $('#custCancel').onclick=cancelCust; $('#custSearch').oninput=renderCustomers;
  $('#orderAddLine').onclick=orderAddLine; $('#orderCreate').onclick=orderCreate;
  $('#qbConnect').onclick=qbConnect; $('#qbDisconnect').onclick=qbDisconnect;
  $('#sqRun').onclick=sqRun; $('#sqSetup').onclick=sqSetup; $('#sqCsv').onclick=sqCsv; $('#sqPdf').onclick=sqPdf;
  $('#stxRun').onclick=stxRun; $('#stxCsv').onclick=stxCsv;
  $('#stxPrint').onclick=()=>{const o=$('#view-kentucky');o.classList.add('printing');window.print();setTimeout(()=>o.classList.remove('printing'),500);};
  $('#sqPrint').onclick=()=>{const o=$('#view-kentucky');o.classList.add('printing');window.print();setTimeout(()=>o.classList.remove('printing'),500);};
  $('#rtlRun').onclick=rtlRun; $('#rtlCsv').onclick=rtlCsv;
  $('#rtlToday').onclick=()=>{const t=rtlTodayStr();$('#rtlFrom').value=t;$('#rtlTo').value=t;rtlRun();};
  $('#rtlPrev').onclick=()=>rtlShift(-1); $('#rtlNext').onclick=()=>rtlShift(1);
  $('#rtlFrom').onchange=()=>{ if($('#rtlTo').value&&$('#rtlFrom').value>$('#rtlTo').value)$('#rtlTo').value=$('#rtlFrom').value; };
  $('#rtlTo').onchange=()=>{ if($('#rtlFrom').value&&$('#rtlTo').value<$('#rtlFrom').value)$('#rtlFrom').value=$('#rtlTo').value; };
  $('#rtlPrint').onclick=()=>{const o=$('#view-retail');o.classList.add('printing');window.print();setTimeout(()=>o.classList.remove('printing'),500);};
  $('#sr_run').onclick=srRun; $('#sr_from').onchange=()=>{}; $('#sr_to').onchange=()=>{};
  $('#sr_pThis').onclick=()=>{srPreset('this');srRun();}; $('#sr_pLast').onclick=()=>{srPreset('last');srRun();};
  $('#sr_pQtr').onclick=()=>{srPreset('qtr');srRun();}; $('#sr_pYtd').onclick=()=>{srPreset('ytd');srRun();};
  $('#sr_print').onclick=()=>{const o=$('#view-salesrpt');o.classList.add('printing');window.print();setTimeout(()=>o.classList.remove('printing'),500);};
  $('#undoBtn').onclick=undo;
  const us=$('#userSave'); if(us) us.onclick=userSave; const uc=$('#userCancel'); if(uc) uc.onclick=cancelUser;
  initEntryForm(); initBarrelForm(); initTib(); initTibo(); initBottling(); initOrders();
}
let wired=false;
async function boot(rejoin){
  if(!WS){ WS=readWSfromHash()||localStorage.getItem('ttb_ws')||genKey(); }
  writeWStoHash(WS); localStorage.setItem('ttb_ws',WS);
  cloudAvailable=(location.protocol!=='file:');
  setSync('connecting');
  await cloudLoad();
  if(!state.history) state.history=[]; lastSnap=dataOnly();
  if(!wired){ wireOnce(); wired=true; }
  updateUndoBtn();
  const proceed=gateBoot();
  loadSettingsForm(); if(proceed){ refreshAll(); qbRefresh(); maybeDailyBackup(); }
  // show sync banner if brand-new empty workspace
  $('#syncBanner').style.display = (cloudAvailable && state.entries.length===0)?'flex':'none';
}
boot();

