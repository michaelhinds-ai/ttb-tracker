function gs1128Svg(scc,opt){
  opt=opt||{}; const d=('01'+String(scc)).replace(/\D/g,''); const dd=d.length%2?('0'+d):d;
  const codes=[105,102]; for(let i=0;i<dd.length;i+=2) codes.push(parseInt(dd.substr(i,2),10));
  let sum=105; for(let k=1;k<codes.length;k++) sum+=codes[k]*k; codes.push(sum%103); codes.push(106);
  let widths=''; codes.forEach(c=>widths+=C128[c]);
  const mod=opt.mod||1.8, H=opt.h||60; let x=0,bar=true,rects='';
  for(const ch of widths){ const w=(+ch)*mod; if(bar) rects+=`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${H}"/>`; x+=w; bar=!bar; }
  return `<svg viewBox="0 0 ${x.toFixed(2)} ${H}" width="${x.toFixed(2)}" height="${H}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet"><rect width="${x.toFixed(2)}" height="${H}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
const LABEL_LOGOS={"Louisville Rickhouse Whiskey Co":"data:image/png;base64,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"};
const LABEL_BRANDS=["Louisville Rickhouse Whiskey Co","Nashville Barrel Co","Nashtucky"];
function companyLogo(co){ return (state.brandLogos&&state.brandLogos[co])||LABEL_LOGOS[co]||''; }
function companyList(){ const set=new Set(LABEL_BRANDS); (state.skus||[]).forEach(s=>{ if(s.company) set.add(s.company); }); Object.keys(state.brandLogos||{}).forEach(c=>set.add(c)); return [...set]; }
function pack12scc(s){ return s.scc12||s.scc||''; }
function labelProof(proof){ const p=parseFloat(proof); if(!(p>0)) return {p:'',abv:''}; return {p:(''+proof).trim(), abv:(Math.round(p*100/2)/100).toFixed(2)}; }
function lblUpdAbv(){ const pe=document.getElementById('lbl_proof'); const out=document.getElementById('lbl_abv'); if(!out) return; const {abv}=labelProof(pe?pe.value:''); out.textContent=abv?('= '+abv+'% ABV'):''; }
function renderLabels(){
  const cos=companyList();
  const csel=document.getElementById('lbl_company');
  if(csel){ const cur=csel.value; csel.innerHTML='<option value="">— select company —</option>'+cos.map(c=>`<option>${esc(c)}</option>`).join(''); if(cur&&cos.includes(cur)) csel.value=cur; }
  labelsSkuOptions(); lblUpdAbv();
  const tb=document.getElementById('skuBody');
  if(tb){ const rows=(state.skus||[]); tb.innerHTML=rows.length?rows.map(s=>`<tr><td>${esc(s.company||'')}</td><td><b>${esc(s.product||'')}</b></td><td class="num">${esc(s.size||'')}</td><td style="font-family:monospace">${esc(s.scc6||'—')}</td><td style="font-family:monospace">${esc(pack12scc(s)||'—')}</td><td class="noprint">${can('write')?`<button class="link" onclick="skuEdit('${s.id}')">Edit</button> · <button class="del" onclick="skuDel('${s.id}')">Del</button>`:''}</td></tr>`).join(''):'<tr><td colspan="6" class="empty" style="padding:24px">No products yet — add one below.</td></tr>'; }
  const lb=document.getElementById('brandLogoBody');
  if(lb){ lb.innerHTML=cos.map(c=>{ const lg=companyLogo(c); return `<tr><td>${esc(c)}</td><td>${lg?`<img src="${lg}" style="height:34px">`:'<span style="color:var(--muted)">— none —</span>'}</td>${can('write')?`<td class="noprint"><label class="link" style="cursor:pointer">Upload<input type="file" accept="image/*" style="display:none" onchange="brandLogoUpload('${encodeURIComponent(c)}',this)"></label></td>`:'<td></td>'}</tr>`; }).join(''); }
}
function labelsSkuOptions(){
  const co=document.getElementById('lbl_company'); const ss=document.getElementById('lbl_product'); if(!ss) return;
  const cur=ss.value; const hasco=!!(co&&co.value); const list=hasco?(state.skus||[]).filter(s=>s.company===co.value):[];
  ss.innerHTML=!hasco?'<option value="">— select a company first —</option>':(list.length?list.map(s=>`<option value="${s.id}">${esc(s.product||'')}</option>`).join(''):'<option value="">— no products for this company —</option>');
  if(cur) ss.value=cur;
  const lg=document.getElementById('lbl_logo'); if(lg){ const src=hasco?companyLogo(co.value):''; lg.innerHTML=src?`<img src="${src}" style="height:44px">`:(hasco?'<span style="color:var(--muted);font-size:13px">No logo for this company — upload one in the Company logos section below.</span>':''); }
}
let editingSku=null;
function skuBlank(){ return {id:uid(),company:(document.getElementById('lbl_company')||{}).value||LABEL_BRANDS[0],product:'',size:'750ml',scc6:'',scc12:''}; }
function skuAddNew(){ if(!requireCap('write'))return; editingSku=null; skuFormFill(skuBlank()); document.getElementById('skuForm').style.display=''; document.getElementById('sk_product').focus(); }
function skuEdit(id){ if(!requireCap('write'))return; const s=(state.skus||[]).find(x=>x.id===id); if(!s)return; editingSku=id; skuFormFill(s); document.getElementById('skuForm').style.display=''; window.scrollTo({top:0,behavior:'smooth'}); }
function skuFormFill(s){
  const co=document.getElementById('sk_company'); if(co){ co.innerHTML=companyList().map(c=>`<option>${esc(c)}</option>`).join(''); co.value=s.company||LABEL_BRANDS[0]; }
  document.getElementById('sk_product').value=s.product||''; document.getElementById('sk_size').value=s.size||'750ml';
  document.getElementById('sk_scc6').value=s.scc6||''; document.getElementById('sk_scc12').value=s.scc12||s.scc||'';
}
function skuCancel(){ editingSku=null; document.getElementById('skuForm').style.display='none'; }
function skuSave(){
  if(!requireCap('write'))return;
  const s={ company:document.getElementById('sk_company').value, product:document.getElementById('sk_product').value.trim(), size:document.getElementById('sk_size').value.trim(),
    scc6:document.getElementById('sk_scc6').value.replace(/\D/g,''), scc12:document.getElementById('sk_scc12').value.replace(/\D/g,'') };
  if(!s.product){ alert('Enter a product name.'); return; }
  for(const pr of [['6-pack',s.scc6],['12-pack',s.scc12]]){ if(pr[1] && pr[1].length!==14){ if(!confirm('The '+pr[0]+' SCC / GTIN-14 is usually 14 digits (you entered '+pr[1].length+'). Save anyway?')) return; } }
  if(!state.skus) state.skus=[];
  if(editingSku){ const i=state.skus.findIndex(x=>x.id===editingSku); if(i>=0) state.skus[i]={...state.skus[i],...s}; editingSku=null; }
  else state.skus.push({id:uid(),...s});
  document.getElementById('skuForm').style.display='none';
  save('Saved case-label product — '+(s.product||'')); refreshAll(); flash('Product saved.');
}
function skuDel(id){ if(!requireCap('write'))return; if(!confirm('Delete this product?'))return; state.skus=(state.skus||[]).filter(x=>x.id!==id); save('Deleted a case-label product'); refreshAll(); }
function brandLogoUpload(coEnc,input){
  if(!requireCap('write'))return; const co=decodeURIComponent(coEnc); const f=input.files&&input.files[0]; if(!f)return;
  const r=new FileReader(); r.onload=()=>{ resizeDataURL(String(r.result),460,(out)=>{ if(!state.brandLogos) state.brandLogos={}; state.brandLogos[co]=out; save('Set logo for '+co); refreshAll(); flash('Logo updated for '+co+'.'); }); }; r.readAsDataURL(f);
}
function labelHTML(s,ctx){
  const logo=companyLogo(s.company); const scc=ctx.scc||''; const {p,abv}=labelProof(ctx.proof);
  const details=[ctx.barrel?('Barrel #'+ctx.barrel):'', ctx.pack+' x '+(s.size||''), (p?('Proof '+p+' / '+abv+'% ALC/Vol'):'')].filter(Boolean).join('  \u00b7  ');
  return `<div class="clabel">
    <div class="clogo">${logo?`<img src="${logo}" alt="">`:`<div class="cbrand">${esc(s.company||'')}</div>`}</div>
    <div class="cprod">${esc(s.product||'')}</div>
    <div class="cmeta">${esc([ctx.barrel?('Barrel #'+ctx.barrel):'', ctx.pack+' x '+(s.size||'')].filter(Boolean).join('  ·  '))}</div>
    ${p?`<div class="cproof">${esc('Proof '+p+'  ·  '+abv+'% ALC/Vol')}</div>`:''}
    <div class="cbar">${scc?gs1128Svg(scc):`<div style="color:#b00;font-size:11pt">No ${ctx.pack}-pack SCC set for this product</div>`}${scc?`<div class="chr">(01)${esc(scc)}</div>`:''}</div>
  </div>`;
}
function printCaseLabels(){
  const co=(document.getElementById('lbl_company')||{}).value; if(!co){ alert('Choose a company.'); return; }
  const ps=document.getElementById('lbl_product'); const id=ps?ps.value:''; const s=(state.skus||[]).find(x=>x.id===id);
  if(!s){ alert('Choose a product to print.'); return; }
  const pack=(document.getElementById('lbl_pack')||{}).value; if(!pack){ alert('Choose the case pack — 6-pack or 12-pack.'); return; }
  const scc = pack==='6' ? (s.scc6||'') : pack12scc(s);
  const ctx={pack, scc, barrel:(document.getElementById('lbl_barrel')||{}).value.trim(), proof:(document.getElementById('lbl_proof')||{}).value.trim()};
  const one=labelHTML(s,ctx);
  let page='<div class="lsheet-page">'; for(let i=0;i<6;i++) page+=one; page+='</div>';
  const sheet=document.getElementById('labelSheet'); sheet.innerHTML=page; sheet.style.display='';
  document.getElementById('lbl_printbtn').style.display='inline-flex';
  sheet.scrollIntoView({behavior:'smooth',block:'start'});
}
function doPrintLabels(){
  const st=document.createElement('style'); st.id='labelPageStyle'; st.textContent='@page{size:letter;margin:0}'; document.head.appendChild(st);
  document.body.classList.add('printing-labels');
  const done=()=>{ document.body.classList.remove('printing-labels'); const e=document.getElementById('labelPageStyle'); if(e)e.remove(); window.removeEventListener('afterprint',done); };
  window.addEventListener('afterprint',done); window.print(); setTimeout(done,1500);
}
/* ===================== Compliance document vault ===================== */
const DOC_CATS=["License / Permit","Federal DSP Permit (TTB)","Sales & Use Tax","EIN Letter","TIB (Transfer in Bond)","COLA","Insurance","Bond","Other"];
function docFmtBytes(n){ n=+n||0; return n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(Math.round(n/1024)+' KB'):(n+' B'); }
function docTypeIcon(type){ const pdf=/pdf/i.test(type||''); const img=/image/i.test(type||''); return `<div style="width:34px;height:34px;border-radius:8px;background:${pdf?'#f7e7e4':img?'#eef3ea':'#eee7d7'};display:grid;place-items:center;color:${pdf?'#b23a2e':img?'#3f7d54':'#7a6a56'};font-weight:700;font-size:10.5px;font-family:-apple-system,Segoe UI,sans-serif">${pdf?'PDF':img?'IMG':'DOC'}</div>`; }
function renderCompliance(){
  const sel=document.getElementById('doc_cat'); if(sel && !sel.dataset.filled){ sel.innerHTML=DOC_CATS.map(c=>`<option>${esc(c)}</option>`).join(''); sel.dataset.filled='1'; }
  const cco=document.getElementById('doc_company'); if(cco){ const cur=cco.value; cco.innerHTML='<option value="">— company —</option>'+companyList().map(c=>`<option>${esc(c)}</option>`).join(''); if(cur) cco.value=cur; }
  const box=document.getElementById('docList'); if(!box) return;
  const q=((document.getElementById('doc_search')||{}).value||'').toLowerCase().trim();
  let docs=(state.docs||[]).slice().sort((a,b)=>(b.ts||0)-(a.ts||0));
  if(q) docs=docs.filter(d=>(((d.name||'')+' '+(d.note||'')+' '+(d.category||'')+' '+(d.company||'')).toLowerCase().indexOf(q)>=0));
  if(!docs.length){ box.innerHTML='<div class="empty" style="padding:24px">'+(q?('No documents match \u201c'+esc(q)+'\u201d.'):'No documents yet — upload your license, DSP permit, EIN letter or tax certificate above.')+'</div>'; return; }
  const groups={}; docs.forEach(d=>{ const c=d.category||'Other'; (groups[c]=groups[c]||[]).push(d); });
  const order=DOC_CATS.filter(c=>groups[c]).concat(Object.keys(groups).filter(c=>!DOC_CATS.includes(c)));
  box.innerHTML=order.map(cat=>`<div style="margin-bottom:16px"><div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:700;font-family:-apple-system,Segoe UI,sans-serif;margin:0 0 6px">${esc(cat)}</div>`+
    groups[cat].map(d=>`<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)">
      ${docTypeIcon(d.type)}
      <div style="flex:1;min-width:0"><div style="font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name)}</div>${d.note?`<div style="font-size:13px;color:#5a4a38;margin-top:1px">${esc(d.note)}</div>`:''}<div style="color:var(--muted);font-size:12px;font-family:-apple-system,Segoe UI,sans-serif">${d.company?(esc(d.company)+' · '):''}${d.size?docFmtBytes(d.size):''}${d.by?(' · '+esc(d.by)):''}${d.ts?(' · '+new Date(d.ts).toLocaleDateString('en-US')):''}</div></div>
      <div class="noprint" style="display:flex;gap:12px;flex:none"><button class="link" onclick="docView('${d.id}')">View / Print</button><button class="link" onclick="docView('${d.id}',1)">Download</button>${can('write')?`<button class="link" onclick="docEditNote('${d.id}')">Note</button><button class="del" onclick="docDel('${d.id}')">Delete</button>`:''}</div>
    </div>`).join('')+`</div>`).join('');
}
function docUpload(){
  if(!requireCap('write'))return;
  if(!WS){ alert('Connect a workspace first (Setup & Sync).'); return; }
  const fi=document.getElementById('doc_file'); const f=fi&&fi.files&&fi.files[0]; if(!f){ alert('Choose a file to upload.'); return; }
  if(f.size>4.5*1048576){ alert('That file is '+docFmtBytes(f.size)+'. Please keep documents under about 4.5 MB (compress the PDF or scan at a lower DPI).'); return; }
  const cat=(document.getElementById('doc_cat')||{}).value||'Other'; const note=(document.getElementById('doc_note')||{}).value.trim(); const company=(document.getElementById('doc_company')||{}).value||'';
  const btn=document.getElementById('doc_upbtn'); if(btn){ btn.disabled=true; btn.textContent='Uploading…'; }
  const r=new FileReader();
  r.onload=async()=>{
    try{
      const b64=String(r.result).split(',')[1]||''; const id=uid();
      const res=await fetch('/api/docs?ws='+encodeURIComponent(WS),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,name:f.name,type:f.type||'application/octet-stream',dataB64:b64})});
      const d=await res.json(); if(!d||!d.ok) throw new Error((d&&(d.detail||d.error))||'upload failed');
      if(!state.docs) state.docs=[];
      state.docs.push({id,name:f.name,company,category:cat,note,type:f.type||'',size:d.size||f.size,ts:Date.now(),by:(SESSION?SESSION.name:'')});
      if(fi) fi.value=''; const ne=document.getElementById('doc_note'); if(ne) ne.value=''; save('Uploaded compliance document — '+f.name); refreshAll(); flash('Uploaded '+f.name+'.');
    }catch(e){ alert('Upload failed: '+((e&&e.message)||e)); }
    finally{ const b=document.getElementById('doc_upbtn'); if(b){ b.disabled=false; b.textContent='Upload'; } }
  };
  r.readAsDataURL(f);
}
function docEditNote(id){ if(!requireCap('write'))return; const d=(state.docs||[]).find(x=>x.id===id); if(!d)return; const v=prompt('Note / description for this document:', d.note||''); if(v===null)return; d.note=v.trim(); save('Updated document note'); refreshAll(); }
function docView(id,dl){ if(!WS){ alert('No workspace connected.'); return; } window.open('/api/docs?ws='+encodeURIComponent(WS)+'&id='+encodeURIComponent(id)+(dl?'&dl=1':''),'_blank'); }
function docDel(id){ if(!requireCap('write'))return; if(!confirm('Delete this document? The file is removed permanently.'))return;
  try{ fetch('/api/docs?ws='+encodeURIComponent(WS)+'&id='+encodeURIComponent(id),{method:'DELETE'}); }catch(e){}
  state.docs=(state.docs||[]).filter(d=>d.id!==id); save('Deleted a compliance document'); refreshAll(); }
/* ===================== Marketing assets (photos & logos) ===================== */
function renderMarketing(){
  const bs=document.getElementById('asset_brand'); if(bs){ const cur=bs.value; bs.innerHTML='<option value="">— brand / general —</option>'+companyList().map(c=>`<option>${esc(c)}</option>`).join(''); if(cur) bs.value=cur; }
  const box=document.getElementById('assetGrid'); if(!box) return;
  const q=((document.getElementById('asset_search')||{}).value||'').toLowerCase().trim();
  let a=(state.assets||[]).slice().sort((x,y)=>(y.ts||0)-(x.ts||0));
  if(q) a=a.filter(x=>(((x.brand||'')+' '+(x.note||'')+' '+(x.name||'')).toLowerCase().indexOf(q)>=0));
  if(!a.length){ box.innerHTML='<div class="empty" style="padding:24px">'+(q?'No assets match “'+esc(q)+'”.':'No assets yet — upload a photo or logo above.')+'</div>'; return; }
  const src=id=>'/api/docs?ws='+encodeURIComponent(WS||'')+'&id='+encodeURIComponent(id);
  box.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px">'+a.map(x=>`
    <div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel)">
      <div title="Open" onclick="docView('${x.id}')" style="height:150px;cursor:pointer;background:#f4ecdb center/contain no-repeat;background-image:url('${src(x.id)}')"></div>
      <div style="padding:10px 11px">
        <div style="font-size:13px;font-weight:700">${x.brand?esc(x.brand):'General'}</div>
        <div style="color:var(--muted);font-size:12.5px;line-height:1.3;margin-top:1px">${esc(x.note||x.name||'')}</div>
        <div class="noprint" style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;font-size:13px">
          <button class="link" onclick="docView('${x.id}',1)">Download</button>${can('write')?`<button class="link" onclick="assetEditNote('${x.id}')">Note</button><button class="del" onclick="assetDel('${x.id}')">Delete</button>`:''}
        </div>
      </div>
    </div>`).join('')+'</div>';
}
function assetUpload(){
  if(!requireCap('write'))return;
  if(!WS){ alert('Connect a workspace first (Setup & Sync).'); return; }
  const fi=document.getElementById('asset_file'); const f=fi&&fi.files&&fi.files[0]; if(!f){ alert('Choose an image to upload.'); return; }
  if(f.size>4.5*1048576){ alert('That file is '+docFmtBytes(f.size)+'. Please keep assets under about 4.5 MB.'); return; }
  const brand=(document.getElementById('asset_brand')||{}).value||''; const note=(document.getElementById('asset_note')||{}).value.trim();
  const btn=document.getElementById('asset_upbtn'); if(btn){ btn.disabled=true; btn.textContent='Uploading…'; }
  const r=new FileReader();
  r.onload=async()=>{
    try{
      const b64=String(r.result).split(',')[1]||''; const id=uid();
      const res=await fetch('/api/docs?ws='+encodeURIComponent(WS),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,name:f.name,type:f.type||'application/octet-stream',dataB64:b64})});
      const d=await res.json(); if(!d||!d.ok) throw new Error((d&&(d.detail||d.error))||'upload failed');
      if(!state.assets) state.assets=[];
      state.assets.push({id,name:f.name,brand,note,type:f.type||'',size:d.size||f.size,ts:Date.now(),by:(SESSION?SESSION.name:'')});
      if(fi) fi.value=''; const ne=document.getElementById('asset_note'); if(ne) ne.value=''; save('Uploaded marketing asset — '+f.name); refreshAll(); flash('Uploaded '+f.name+'.');
    }catch(e){ alert('Upload failed: '+((e&&e.message)||e)); }
    finally{ const b=document.getElementById('asset_upbtn'); if(b){ b.disabled=false; b.textContent='Upload'; } }
  };
  r.readAsDataURL(f);
}
function assetEditNote(id){ if(!requireCap('write'))return; const a=(state.assets||[]).find(x=>x.id===id); if(!a)return; const v=prompt('Description for this asset:', a.note||''); if(v===null)return; a.note=v.trim(); save('Updated asset note'); refreshAll(); }
function assetDel(id){ if(!requireCap('write'))return; if(!confirm('Delete this asset? The file is removed permanently.'))return; try{ fetch('/api/docs?ws='+encodeURIComponent(WS)+'&id='+encodeURIComponent(id),{method:'DELETE'}); }catch(e){} state.assets=(state.assets||[]).filter(x=>x.id!==id); save('Deleted a marketing asset'); refreshAll(); }
function renderLrs(){
  try{
    const yr=state.settings.year;
    const ytd=taxablePG(e=>yearOf(e.date)===yr); const {tax:ytdTax}=cbmaTax(0,ytd);
    const bal=balances(); bal.Storage=round1(bal.Storage+agingBarrelPG()); const onHand=round1(bal.Production+bal.Storage+bal.Processing);
    const kyYtd=kyYearTotal(yr);
    const aging=(state.barrels||[]).filter(b=>b.status==='Aging'); const agingCount=aging.reduce((s,b)=>s+barrelCount(b),0);
    const cards=[kpi('copper','Bulk on Hand',numf(onHand)+' PG','across all accounts'),kpi('barrel','Barrels Aging',agingCount.toLocaleString(),'in inventory')];
    if(!isManager()){ cards.push(kpi('green','Federal Excise '+yr,money(ytdTax),'tax-determined YTD')); cards.push(kpi('ky','Kentucky Tax '+yr,money(kyYtd),'year-to-date')); }
    const box=document.getElementById('lrsKpis'); if(box) box.innerHTML=cards.join('');
  }catch(e){}
}
function renderDashboard(){
  const yr=state.settings.year;
  $('#tierYear').textContent=yr; $('#qtrYear').textContent=yr;
  const ytd=taxablePG(e=>yearOf(e.date)===yr); const {tax:ytdTax}=cbmaTax(0,ytd);
  const bal=balances(); bal.Storage=round1(bal.Storage+agingBarrelPG()); const onHand=round1(bal.Production+bal.Storage+bal.Processing);
  const kyYtd=kyYearTotal(yr);
  const aging=(state.barrels||[]).filter(b=>b.status==='Aging');
  const agingCount=aging.reduce((s,b)=>s+barrelCount(b),0);
  const agingPG=round1(aging.reduce((s,b)=>s+barrelPG(b),0));
  $('#kpis').innerHTML=[
    kpi('copper','Bulk on Hand',numf(onHand)+' PG','across all accounts'),
    kpi('barrel','Barrels Aging',agingCount.toLocaleString(),numf(agingPG)+' PG in barrels'),
    kpi('green','Federal Excise '+yr,money(ytdTax),numf(ytd)+' PG tax-determined'),
    kpi('ky','Kentucky Tax '+yr,money(kyYtd),'monthly returns, year-to-date'),
  ].join('');
  const pct=Math.min(100,ytd/100000*100); $('#tierBar').style.width=pct+'%';
  $('#tierUsed').textContent=numf(Math.min(ytd,100000))+' PG used at $2.70';
  $('#tierLeft').textContent=ytd>=100000?'Reduced tier exhausted — now $13.34/PG':numf(100000-ytd)+' PG of reduced rate remaining';
  $('#balBody').innerHTML=['Production','Storage','Processing'].map(a=>`<tr><td>${a}</td><td class="num">${numf(bal[a])}</td></tr>`).join('')+`<tr class="total" style="font-weight:700"><td>Total</td><td class="num">${numf(onHand)}</td></tr>`;
  let maxq=1; const qs=[1,2,3,4].map(q=>{const pg=taxablePG(e=>yearOf(e.date)===yr&&quarterOf(e.date)===q);const {tax}=cbmaTax(ytdTaxableBeforeQuarter(yr,q),pg);maxq=Math.max(maxq,pg);return{q,pg,tax};});
  $('#qtrBars').innerHTML=qs.map(o=>`<div style="margin:10px 0"><div style="display:flex;justify-content:space-between;font-size:13px;font-family:-apple-system,Segoe UI,sans-serif;margin-bottom:3px"><b>Q${o.q}</b><span style="color:var(--muted)">${numf(o.pg)} PG · ${money(o.tax)}</span></div><div class="meter" style="height:12px"><span style="width:${o.pg/maxq*100}%"></span></div></div>`).join('');
  renderActivity();
}
function kpi(c,l,v,f){return `<div class="kpi ${c}"><div class="label">${l}</div><div class="val">${v}</div><div class="foot">${f}</div></div>`;}
function accPill(a){const c=a==='Production'?'prod':a==='Storage'?'stor':'proc';return `<span class="pill ${c}">${a}</span>`;}

/* ================= Entry form ================= */
let editingId=null;
function initEntryForm(){
  $('#f_account').innerHTML=['Production','Storage','Processing'].map(a=>`<option>${a}</option>`).join('');
  populateTypes(); $('#f_account').onchange=populateTypes;
  ['f_wg','f_proof'].forEach(id=>$('#'+id).addEventListener('input',updatePG));
  $('#f_type').addEventListener('change',showTypeNote);
  if(!$('#f_date').value) $('#f_date').value=new Date().toISOString().slice(0,10);
}
function populateTypes(){ const a=$('#f_account').value; $('#f_type').innerHTML=TX.filter(t=>t.account===a).map(t=>`<option value="${t.id}">${t.label}</option>`).join(''); showTypeNote(); }
function updatePG(){ $('#f_pg').textContent=numf(pgCalc($('#f_wg').value,$('#f_proof').value))+' PG'; }
function showTypeNote(){ const t=TXBYID[$('#f_type').value]; $('#typeNote').textContent=t?t.note:''; $('#typeNote').style.display=t&&t.note?'block':'none'; }
function readForm(){ const wg=+$('#f_wg').value,proof=+$('#f_proof').value; return {date:$('#f_date').value,type:$('#f_type').value,spirit:$('#f_spirit').value,wg,proof,pg:pgCalc(wg,proof),ref:$('#f_ref').value.trim(),notes:$('#f_notes').value.trim()}; }
function validEntry(d){ if(!d.date){alert('Please choose a date.');return false;} if(!(d.wg>0)){alert('Enter wine gallons greater than zero.');return false;} if(!(d.proof>0)){alert('Enter a proof greater than zero.');return false;} return true; }
function saveEntryForm(again){
  if(!requireCap('write'))return;
  const d=readForm(); if(!validEntry(d))return;
  const was=!!editingId; const tl=(TXBYID[d.type]&&TXBYID[d.type].label)||'entry';
  if(editingId){const i=state.entries.findIndex(e=>e.id===editingId);if(i>=0)state.entries[i]={...state.entries[i],...d};editingId=null;$('#cancelEdit').style.display='none';$('#entryTitle').textContent='New Entry';}
  else state.entries.push({id:uid(),...d});
  save((was?'Edited entry — ':'Added entry — ')+tl+' · '+numf(d.pg)+' PG'); refreshAll();
  if(again){['f_wg','f_proof','f_ref','f_notes'].forEach(i=>$('#'+i).value='');updatePG();$('#f_wg').focus();}
  else switchView('ledger');
  flash('Entry saved.');
}
function editEntry(id){if(!requireCap('write'))return;const e=state.entries.find(x=>x.id===id);if(!e)return;editingId=id;switchView('entry');$('#f_date').value=e.date;$('#f_account').value=TXBYID[e.type].account;populateTypes();$('#f_type').value=e.type;$('#f_spirit').value=e.spirit;$('#f_wg').value=e.wg;$('#f_proof').value=e.proof;$('#f_ref').value=e.ref||'';$('#f_notes').value=e.notes||'';updatePG();showTypeNote();$('#entryTitle').textContent='Edit Entry';$('#cancelEdit').style.display='inline-block';}
function deleteEntry(id){if(!requireCap('delete'))return;if(!confirm('Delete this entry?'))return;state.entries=state.entries.filter(e=>e.id!==id);save('Deleted a ledger entry');refreshAll();}

/* ================= Ledger ================= */
function renderLedger(){
  const q=($('#ledgerSearch').value||'').toLowerCase(),acc=$('#ledgerAccount').value,yr=$('#ledgerYear').value;
  let rows=[...state.entries].sort((a,b)=>b.date.localeCompare(a.date)).filter(e=>{const t=TXBYID[e.type];if(!t)return false;if(acc&&t.account!==acc)return false;if(yr&&String(yearOf(e.date))!==yr)return false;if(q){const h=(e.spirit+' '+t.label+' '+(e.ref||'')+' '+(e.notes||'')).toLowerCase();if(!h.includes(q))return false;}return true;});
  $('#ledgerBody').innerHTML=rows.map(e=>{const t=TXBYID[e.type];return `<tr><td>${fmtDate(e.date)}</td><td>${accPill(t.account)}</td><td>${t.label}${t.taxable?' <span class="pill tax">tax</span>':''}</td><td>${e.spirit}</td><td class="num">${numf(e.wg,2)}</td><td class="num">${numf(e.proof,1)}</td><td class="num"><b>${numf(e.pg)}</b></td><td>${e.ref||''}</td><td class="noprint">${[can('write')?`<button class="link" onclick="editEntry('${e.id}')">Edit</button>`:'',can('delete')?`<button class="del" onclick="deleteEntry('${e.id}')">Del</button>`:''].filter(Boolean).join(' · ')}</td></tr>`;}).join('');
  $('#ledgerEmpty').innerHTML=rows.length?'':`<div class="empty"><div class="big">📒</div>No matching entries.</div>`;
}

/* ================= Federal reports ================= */
function initReportControls(){
  const sel=$('#rptQuarter'),yr=state.settings.year;let o='';
  for(let y=yr;y>=yr-3;y--)for(let q=4;q>=1;q--)o+=`<option value="${y}-${q}">Q${q} ${y}</option>`;
  sel.innerHTML=o; sel.value=`${yr}-${quarterOf(new Date().toISOString().slice(0,10))}`;
  $('#rptMonth').value=new Date().toISOString().slice(0,7);
  $('#rptKind').onchange=()=>{const k=$('#rptKind').value;$('#periodQuarterWrap').style.display=k==='excise'?'block':'none';$('#periodMonthWrap').style.display=k==='excise'?'none':'block';renderReport();};
  $('#rptQuarter').onchange=renderReport;$('#rptMonth').onchange=renderReport;
}
function reportHeader(title,form,period){const s=state.settings;return `<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;border-bottom:2px solid var(--copper);padding-bottom:12px;margin-bottom:6px"><div><div style="font-size:20px;font-weight:800">${s.name||'Your Distilled Spirits Plant'}</div><div style="color:var(--muted);font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">Permit: ${s.permit||'—'}</div></div><div style="text-align:right"><div style="font-weight:700">${title}</div><div style="color:var(--muted);font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">${form}</div><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px">${period}</div></div></div>`;}
function renderReport(){const k=$('#rptKind').value;$('#rptOut').innerHTML=k==='excise'?exciseReport():opsReport(k);}
function opsReport(kind){
  const ym=$('#rptMonth').value;if(!ym)return '<div class="empty">Choose a month.</div>';
  const [y,m]=ym.split('-').map(Number);
  const acctName=kind==='production'?'Production':kind==='storage'?'Storage':'Processing';
  const form=kind==='production'?'TTB F 5110.40 — Report of Production Operations':kind==='storage'?'TTB F 5110.11 — Report of Storage Operations':'TTB F 5110.28 — Report of Processing Operations';
  const inMonth=e=>yearOf(e.date)===y&&(+e.date.slice(5,7))===m, before=e=>e.date<`${ym}-01`;
  const dOf=e=>{const t=TXBYID[e.type];return kind==='production'?t.prod:kind==='storage'?t.stor:t.proc;};
  let opening=0;state.entries.filter(before).forEach(e=>opening+=dOf(e)*e.pg);opening=round1(opening);
  const rel=state.entries.filter(e=>inMonth(e)&&dOf(e)!==0);
  const types=TX.filter(t=>(kind==='production'?t.prod:kind==='storage'?t.stor:t.proc)!==0);
  let inc=[],dec=[],net=0;
  types.forEach(t=>{const sum=round1(rel.filter(e=>e.type===t.id).reduce((s,e)=>s+e.pg,0));if(sum<=0)return;const d=kind==='production'?t.prod:kind==='storage'?t.stor:t.proc;net+=d*sum;(d>0?inc:dec).push({label:t.label,pg:sum});});
  if(kind==='storage'){
    const {dep,wd}=barrelMoves();
    const befd=d=>d && d<`${ym}-01`, inMod=d=>d && +d.slice(0,4)===y && (+d.slice(5,7))===m;
    const sumA=(arr,dp)=>round1(arr.filter(x=>dp(x.date)).reduce((s,x)=>s+x.pg,0));
    const bt=(state.bottlings||[]);
    const dumpSum=dp=>round1(bt.filter(b=>dp(b.date)).reduce((s,b)=>s+((b.dumpPG!=null?+b.dumpPG:+b.pg)||0),0));   // entry PG removed (full + partial dumps)
    const bottledSum=dp=>round1(bt.filter(b=>dp(b.date)).reduce((s,b)=>s+(+b.pg||0),0));
    const tibArr=wd.filter(x=>x.kind==='tibout');
    // opening = ledger opening + barrel deposits before month − dumps before month − TIB-outs before month
    opening=round1(opening + sumA(dep,befd) - dumpSum(befd) - sumA(tibArr,befd));
    const depTib=sumA(dep.filter(x=>x.tib),inMod), depMake=sumA(dep.filter(x=>!x.tib),inMod);
    if(depTib>0){ inc.push({label:'Received in bond — barrel register',pg:depTib}); net+=depTib; }
    if(depMake>0){ inc.push({label:'Deposited in storage — barrel fills',pg:depMake}); net+=depMake; }
    const dumpM=dumpSum(inMod), procM=bottledSum(inMod), lossM=round1(Math.max(0,dumpM-procM));
    if(procM>0){ dec.push({label:'Transferred to processing account (bottled)',pg:procM}); net-=procM; }
    if(lossM>0){ dec.push({label:'Storage losses (angels’ share)',pg:lossM}); net-=lossM; }
    const wdTib=sumA(tibArr,inMod);
    if(wdTib>0){ dec.push({label:'Transferred out in bond — barrel register',pg:wdTib}); net-=wdTib; }
  }
  if(kind==='processing'){
    const bef=d=>d && d<`${ym}-01`;
    const inMo=d=>d && +d.slice(0,4)===y && (+d.slice(5,7))===m;
    const bt=(state.bottlings||[]);
    const sumB=pred=>round1(bt.filter(b=>pred(b.date)).reduce((s,b)=>s+(+b.pg||0),0));
    // bottled spirits dumped into the processing account (deposits) come from the bottling log, not the ledger
    opening=round1(opening + sumB(bef));
    const depM=sumB(inMo);
    if(depM>0){ inc.push({label:'Dumped & bottled into processing account',pg:depM}); net+=depM; }
  }
  net=round1(net);const closing=round1(opening+net);
  const monthName=new Date(y,m-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const rInc=inc.length?inc.map(r=>`<tr><td>${r.label}</td><td class="num">${numf(r.pg)}</td></tr>`).join(''):`<tr><td colspan="2" style="color:var(--muted)">None</td></tr>`;
  const rDec=dec.length?dec.map(r=>`<tr><td>${r.label}</td><td class="num">${numf(r.pg)}</td></tr>`).join(''):`<tr><td colspan="2" style="color:var(--muted)">None</td></tr>`;
  const tI=round1(inc.reduce((s,r)=>s+r.pg,0)),tD=round1(dec.reduce((s,r)=>s+r.pg,0));
  return reportHeader(`Monthly Report of ${acctName} Operations`,form,monthName)+`
    <div class="note">Figures in proof gallons, summarized from your ledger. Reconcile against gauge records before transcribing to the official form.</div>
    <table><tbody><tr class="sub"><td>On hand first of month</td><td class="num">${numf(opening)}</td></tr></tbody></table>
    <h4>Deposits &amp; increases</h4><table><tbody>${rInc}<tr class="sub"><td>Total increases</td><td class="num">${numf(tI)}</td></tr></tbody></table>
    <h4>Withdrawals &amp; decreases</h4><table><tbody>${rDec}<tr class="sub"><td>Total decreases</td><td class="num">${numf(tD)}</td></tr></tbody></table>
    <table><tbody><tr class="total"><td>On hand end of month</td><td class="num">${numf(closing)}</td></tr></tbody></table>
    <div class="disclaimer">Report due 15 days after month end (by ${addDays(`${ym}-`+new Date(y,m,0).getDate(),15)}). File via MyTTB / Pay.gov.</div>`;
}
function exciseReport(){
  const v=$('#rptQuarter').value;if(!v)return '<div class="empty">Choose a quarter.</div>';
  const [y,q]=v.split('-').map(Number);const inQ=e=>yearOf(e.date)===y&&quarterOf(e.date)===q;
  const qpg=taxablePG(inQ),prior=ytdTaxableBeforeQuarter(y,q);const {tax,lines}=cbmaTax(prior,qpg);
  const bySrc=['Storage','Processing'].map(a=>({a,pg:round1(state.entries.filter(e=>inQ(e)&&TXBYID[e.type].taxable&&TXBYID[e.type].account===a).reduce((s,e)=>s+e.pg,0))})).filter(o=>o.pg>0);
  const qEnd=`${y}-${String(q*3).padStart(2,'0')}-${new Date(y,q*3,0).getDate()}`;const due=addDays(qEnd,14);
  const period=`Q${q} ${y} (${new Date(y,(q-1)*3,1).toLocaleDateString('en-US',{month:'short'})}–${new Date(y,q*3-1,1).toLocaleDateString('en-US',{month:'short'})})`;
  const tR=lines.length?lines.map(l=>`<tr><td>${numf(l.pg)} PG @ ${money(l.rate)}/PG</td><td class="num">${money(l.amt)}</td></tr>`).join(''):`<tr><td colspan="2" style="color:var(--muted)">No tax-determined removals this quarter.</td></tr>`;
  const sR=bySrc.length?bySrc.map(o=>`<tr><td>Removed from ${o.a}</td><td class="num">${numf(o.pg)}</td></tr>`).join(''):`<tr><td colspan="2" style="color:var(--muted)">None</td></tr>`;
  return reportHeader('Excise Tax Return — Worksheet','TTB F 5000.24 · Quarterly',period)+`
    <div class="note">CBMA reduced rates applied cumulatively across the calendar year: first 100,000 PG at $2.70, next tier at $13.34, then $13.50. Prior quarters this year already used <b>${numf(prior)} PG</b> of the reduced tier.</div>
    <h4>Tax-determined removals this quarter</h4><table><tbody>${sR}<tr class="sub"><td>Total taxable proof gallons</td><td class="num">${numf(qpg)}</td></tr></tbody></table>
    <h4>Tax computation (CBMA tiers)</h4><table><tbody>${tR}<tr class="total"><td>Excise tax due for ${period}</td><td class="num">${money(tax)}</td></tr></tbody></table>
    <div class="taxbox"><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Federal Excise Tax Due</div><div class="due">${money(tax)}</div><div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;margin-top:4px">Return &amp; payment due by <b>${due}</b> · file on Pay.gov (TTB F 5000.24)</div></div>
    <div class="disclaimer">Reduced rates require that the DSP performed qualifying processing (beyond bottling) on the spirits, per CBMA. Verify eligibility and current rates at ttb.gov before filing. This worksheet totals removals you flagged as tax-determined; it does not include adjustments, credits, or transfers in bond without tax determination.</div>`;
}

/* ================= Kentucky ================= */
function kyMonthKey(){ return $('#kyMonth').value; }
function kySuggestGallons(ym){ const [y,m]=ym.split('-').map(Number); return taxableWG(e=>yearOf(e.date)===y&&(+e.date.slice(5,7))===m); }
function kyYearTotal(year){
  let total=0;
  Object.entries(state.ky.monthly||{}).forEach(([k,v])=>{ if(k.slice(0,4)==String(year)){ total+=kyMonthlyCalc(v).total; } });
  return round2(total);
}
function kyMonthlyCalc(rec){
  const s=state.settings; const gal=+rec.gallons||0, cases=+rec.cases||0, sales=+rec.sales||0;
  const excise=round2(gal*(+s.kyExcise||0));
  const caseTax=round2(cases*(+s.kyCase||0));
  const wholesale=round2(sales*((+s.kyWholesale||0)/100));
  return {excise,caseTax,wholesale,total:round2(excise+caseTax+wholesale)};
}
function initKyControls(){
  $('#kyMonth').value=new Date().toISOString().slice(0,7);
  const sel=$('#kyYear');const yr=state.settings.year;let o='';for(let y=yr+1;y>=2025;y--)o+=`<option ${y===yr?'selected':''}>${y}</option>`;sel.innerHTML=o;
  const lastMonth=()=>{ const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7); };
  if(!$('#sqMonth').value) $('#sqMonth').value=lastMonth();
  if(!$('#stxMonth').value) $('#stxMonth').value=lastMonth();
  $('#kyKind').onchange=()=>{const k=$('#kyKind').value;const sq=k==='73a525',stx=k==='salestax',anySq=sq||stx;
    $('#kyMonthWrap').style.display=(k==='monthly')?'block':'none';$('#kyYearWrap').style.display=k==='barrel'?'block':'none';
    $('#kySqCard').style.display=sq?'block':'none';$('#kyTaxCard').style.display=stx?'block':'none';
    $('#kyOut').style.display=anySq?'none':'block';$('#printKy').style.display=anySq?'none':'inline-flex';
    if(sq)sqStatus();else if(stx)stxStatus();else renderKy();};
  $('#kyMonth').onchange=renderKy; $('#kyYear').onchange=renderKy;
}
function renderKy(){ $('#kyOut').innerHTML=$('#kyKind').value==='monthly'?kyMonthlyReport():kyBarrelReport(); }
