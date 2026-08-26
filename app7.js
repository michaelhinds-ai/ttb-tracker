/* ===================== Barrels in Process =====================
   A standalone barrel-program tracker (single-barrel selections). NOT yet wired
   to the real barrel inventory — that hooks in once the Nashville Barrel
   inventory is uploaded. Each record: DSP (KY/TN), brand, barrel #, retailer /
   group, wholesaler, and either an uploaded logo or approved text. A summary
   task-list shows where each barrel sits, with checkboxes to advance the stages. */

// Stages a barrel moves through. Add more here anytime — the checkboxes,
// progress and "complete" logic all follow this list.
const BP_STAGES = [
  { key: 'art',     label: 'Logo / text approved?' },
  { key: 'bottled', label: 'Bottled?' },
];

function bpBrands(){ try{ return companyList(); }catch(e){ return ["Louisville Rickhouse Whiskey Co","Nashville Barrel Co","Nashtucky"]; } }

function renderBarrelsProc(){
  // Brand dropdown (DSP + art-type are static in the HTML).
  const bs=document.getElementById('bp_brand');
  if(bs){ const cur=bs.value; bs.innerHTML='<option value="">— select brand —</option>'+bpBrands().map(c=>`<option>${esc(c)}</option>`).join(''); bs.value=cur||''; }
  bpArtToggle();
  bpBrandToggle();
  bpRenderList();
}
function bpIsNashville(brand){ return /nashville\s*barrel/i.test(brand||''); }
function bpBrandToggle(){
  const brand=(document.getElementById('bp_brand')||{}).value||'';
  const w=document.getElementById('bp_labelchoice_wrap');
  if(w){ const show=bpIsNashville(brand); w.style.display=show?'':'none'; if(!show){ const s=document.getElementById('bp_labelchoice'); if(s) s.value=''; } }
}
function bpArtToggle(){
  const t=(document.getElementById('bp_arttype')||{}).value||'logo';
  const lw=document.getElementById('bp_logo_wrap'), tw=document.getElementById('bp_text_wrap');
  if(lw) lw.style.display = t==='logo' ? '' : 'none';
  if(tw) tw.style.display = t==='text' ? '' : 'none';
}
function bpStages(b){ return b&&b.stages&&typeof b.stages==='object'?b.stages:{}; }
function bpComplete(b){ return BP_STAGES.every(s=>bpStages(b)[s.key]); }
function bpStatus(b){
  if(bpComplete(b)) return {label:'Complete', complete:true};
  const open=BP_STAGES.find(s=>!bpStages(b)[s.key]); const idx=BP_STAGES.indexOf(open);
  return {label:'Step '+(idx+1)+' of '+BP_STAGES.length+' · '+open.label.replace(/\?$/,''), complete:false};
}

function bpAdd(){
  if(!requireCap('write'))return;
  const dsp=(document.getElementById('bp_dsp')||{}).value||'';
  const brand=(document.getElementById('bp_brand')||{}).value||'';
  const barrelNo=((document.getElementById('bp_barrel')||{}).value||'').trim();
  const spirit=((document.getElementById('bp_spirit')||{}).value||'').trim();
  const age=((document.getElementById('bp_age')||{}).value||'').trim();
  const retailer=((document.getElementById('bp_retailer')||{}).value||'').trim();
  const wholesaler=((document.getElementById('bp_wholesaler')||{}).value||'').trim();
  const buyerName=((document.getElementById('bp_buyer_name')||{}).value||'').trim();
  const buyerPhone=((document.getElementById('bp_buyer_phone')||{}).value||'').trim();
  const buyerEmail=((document.getElementById('bp_buyer_email')||{}).value||'').trim();
  const artType=(document.getElementById('bp_arttype')||{}).value||'logo';
  const labelChoice=bpIsNashville(brand)?((document.getElementById('bp_labelchoice')||{}).value||''):'';
  if(!dsp){ alert('Pick a DSP.'); return; }
  if(!brand){ alert('Pick a brand.'); return; }
  if(!barrelNo){ alert('Enter a barrel #.'); return; }

  const base={ id:uid(), dsp, brand, barrelNo, spirit, age, retailer, wholesaler,
    buyerName, buyerPhone, buyerEmail, labelChoice, artType,
    artText:'', logoId:'', logoName:'', stages:{}, ts:Date.now(), by:(SESSION?SESSION.name:'') };

  if(artType==='text'){
    const txt=((document.getElementById('bp_text')||{}).value||'').trim();
    if(!txt){ alert('Enter the text for the barrel.'); return; }
    base.artText=txt;
    if(!state.barrelsProc) state.barrelsProc=[];
    state.barrelsProc.push(base);
    bpClearForm(); save('Added barrel in process — '+brand+' #'+barrelNo); refreshAll(); flash('Barrel added.');
    return;
  }
  // Logo path — upload the image to Blob storage, then save the record.
  if(!WS){ alert('Connect a workspace first (Setup & Sync).'); return; }
  const fi=document.getElementById('bp_logo_file'); const f=fi&&fi.files&&fi.files[0];
  if(!f){ alert('Choose a logo image to upload (or switch to Text).'); return; }
  if(f.size>4.5*1048576){ alert('That image is too large — keep it under about 4.5 MB.'); return; }
  const btn=document.getElementById('bp_addbtn'); if(btn){ btn.disabled=true; btn.textContent='Uploading…'; }
  const r=new FileReader();
  r.onload=async()=>{
    try{
      const b64=String(r.result).split(',')[1]||''; const id=uid();
      const res=await fetch('/api/docs?ws='+encodeURIComponent(WS),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,name:f.name,type:f.type||'application/octet-stream',dataB64:b64})});
      const d=await res.json(); if(!d||!d.ok) throw new Error((d&&(d.detail||d.error))||'upload failed');
      base.logoId=id; base.logoName=f.name;
      if(!state.barrelsProc) state.barrelsProc=[];
      state.barrelsProc.push(base);
      bpClearForm(); save('Added barrel in process — '+brand+' #'+barrelNo); refreshAll(); flash('Barrel added.');
    }catch(e){ alert('Logo upload failed: '+((e&&e.message)||e)); }
    finally{ const b=document.getElementById('bp_addbtn'); if(b){ b.disabled=false; b.textContent='Add barrel'; } }
  };
  r.readAsDataURL(f);
}
function bpClearForm(){
  ['bp_barrel','bp_spirit','bp_age','bp_retailer','bp_wholesaler','bp_buyer_name','bp_buyer_phone','bp_buyer_email','bp_labelchoice','bp_text'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const fi=document.getElementById('bp_logo_file'); if(fi) fi.value='';
}
function bpToggleStage(id,key){
  if(!requireCap('write'))return;
  const b=(state.barrelsProc||[]).find(x=>x.id===id); if(!b)return;
  if(!b.stages||typeof b.stages!=='object') b.stages={};
  b.stages[key]=!b.stages[key];
  save('Updated barrel stage'); refreshAll();
}
function bpDelete(id){
  if(!requireCap('write'))return;
  const b=(state.barrelsProc||[]).find(x=>x.id===id); if(!b)return;
  if(!confirm('Remove this barrel from the list?'))return;
  if(b.logoId){ try{ fetch('/api/docs?ws='+encodeURIComponent(WS)+'&id='+encodeURIComponent(b.logoId),{method:'DELETE'}); }catch(e){} }
  state.barrelsProc=(state.barrelsProc||[]).filter(x=>x.id!==id);
  save('Removed barrel in process'); refreshAll();
}

function bpDspPill(dsp){
  if(!dsp) return `<span class="pill" style="background:#efe7d8;color:var(--muted)">No DSP</span>`;
  const nash=/nashville/i.test(dsp);
  return `<span class="pill" style="background:${nash?'#e7eef4':'var(--ky-bg)'};color:${nash?'#2f6f8f':'var(--ky)'}">${esc(dsp)}${nash?' · TN':' · KY'}</span>`;
}
function bpArtPreview(b){
  if(b.artType==='logo' && b.logoId){
    const src='/api/docs?ws='+encodeURIComponent(WS||'')+'&id='+encodeURIComponent(b.logoId);
    return `<div title="Open logo" onclick="docView('${b.logoId}')" style="cursor:pointer;width:88px;height:66px;border:1px solid var(--line);border-radius:9px;background:#fff center/contain no-repeat;background-image:url('${src}')"></div>`;
  }
  if(b.artType==='text' && b.artText){
    return `<div style="min-width:120px;max-width:260px;border:1px dashed var(--amber);border-radius:9px;background:#fbf6ec;padding:8px 11px;font-weight:700;color:var(--copper-dk)">${esc(b.artText)}</div>`;
  }
  return `<div style="color:var(--muted);font-size:12.5px;font-family:-apple-system,Segoe UI,sans-serif">No ${b.artType==='text'?'text':'logo'} yet</div>`;
}
function bpCard(b){
  const st=bpStatus(b);
  const checks=BP_STAGES.map(s=>{
    const on=!!bpStages(b)[s.key];
    return `<label style="display:inline-flex;align-items:center;gap:8px;background:${on?'var(--green-bg)':'#faf5eb'};border:1px solid ${on?'#bfe0c9':'var(--line)'};border-radius:9px;padding:7px 12px;cursor:pointer;font-family:-apple-system,Segoe UI,sans-serif;font-size:13.5px;font-weight:600;color:${on?'var(--green)':'var(--ink)'}">
      <input type="checkbox" ${on?'checked':''} onchange="bpToggleStage('${b.id}','${s.key}')" style="width:17px;height:17px;accent-color:var(--green);cursor:pointer">${esc(s.label)}</label>`;
  }).join('');
  const meta=[];
  if(b.retailer) meta.push('<b>Retailer / group:</b> '+esc(b.retailer));
  if(b.wholesaler) meta.push('<b>Wholesaler:</b> '+esc(b.wholesaler));
  if(b.labelChoice) meta.push('<b>Label:</b> '+esc(b.labelChoice));
  if(b.buyerName||b.buyerPhone||b.buyerEmail){
    const parts=[];
    if(b.buyerName) parts.push(esc(b.buyerName));
    if(b.buyerPhone) parts.push('<a href="tel:'+esc(b.buyerPhone.replace(/[^0-9+]/g,''))+'" style="color:var(--copper);font-weight:600">'+esc(b.buyerPhone)+'</a>');
    if(b.buyerEmail) parts.push('<a href="mailto:'+esc(b.buyerEmail)+'" style="color:var(--copper);font-weight:600">'+esc(b.buyerEmail)+'</a>');
    meta.push('<b>Buyer:</b> '+parts.join(' &middot; '));
  }
  return `<div class="card" style="${st.complete?'opacity:.72;':''}margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:17px;font-weight:700">${esc(b.brand||'')} &middot; Barrel #${esc(b.barrelNo||'')}</div>
        ${(b.spirit||b.age)?`<div style="color:var(--muted);font-size:13.5px;font-family:-apple-system,Segoe UI,sans-serif;margin-top:2px">${[esc(b.spirit||''),esc(b.age||'')].filter(Boolean).join(' &middot; ')}</div>`:''}
        <div style="display:flex;gap:8px;align-items:center;margin-top:5px;flex-wrap:wrap">${bpDspPill(b.dsp)}
          <span class="pill ${st.complete?'tax':''}" style="${st.complete?'':'background:#f4ecdb;color:var(--copper-dk)'}">${st.complete?'✓ Complete':esc(st.label)}</span></div>
      </div>
      ${bpArtPreview(b)}
    </div>
    ${meta.length?`<div style="color:#5a4a38;font-size:13.5px;font-family:-apple-system,Segoe UI,sans-serif;margin-top:10px;display:flex;gap:18px;flex-wrap:wrap">${meta.join('')}</div>`:''}
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px">${checks}</div>
    <div class="noprint" style="margin-top:12px"><button class="del" onclick="bpDelete('${b.id}')">Remove</button></div>
  </div>`;
}
function bpRenderList(){
  const box=document.getElementById('bpList'); if(!box) return;
  const all=(state.barrelsProc||[]).slice();
  if(!all.length){ box.innerHTML='<div class="empty" style="padding:32px"><div class="big">🛢️</div>No barrels in process yet — add one above.</div>'; return; }
  const active=all.filter(b=>!bpComplete(b)).sort((a,b)=>(a.ts||0)-(b.ts||0));
  const done=all.filter(b=>bpComplete(b)).sort((a,b)=>(b.ts||0)-(a.ts||0));
  const sec=(t,arr)=> arr.length ? `<h2 class="section" style="margin:6px 0 12px">${t} <span style="color:var(--muted)">(${arr.length})</span></h2>`+arr.map(bpCard).join('') : '';
  box.innerHTML = sec('In process', active) + (done.length?`<div style="height:10px"></div>`+sec('Completed', done):'');
}
