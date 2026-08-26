/* ===================== Google Reviews (auto-reply) =====================
   Reads Google reviews via the app's serverless endpoints, auto-posts replies to
   4-5 star reviews weekly, and holds 3-star-and-below for approval. This screen
   lets you connect Google, run the weekly job on demand, and approve/post the
   held replies. Server does the posting — no browser automation. */

function starStr(n){ n=+n||0; return '<span style="color:#e0a866;letter-spacing:1px">'+'★'.repeat(n)+'<span style="color:var(--line)">'+'★'.repeat(5-n)+'</span></span>'; }
function revStatusPill(s){
  const map={ posted:['Replied','var(--green-bg)','var(--green)'], held:['Needs approval','#fff2df','#a06a1f'],
    replied:['Replied on Google','var(--green-bg)','var(--green)'], new:['New','#e7eef4','#2f6f8f'], skipped:['Skipped','#efe7d8','var(--muted)'] };
  const m=map[s]||map.new; return `<span class="pill" style="background:${m[1]};color:${m[2]}">${m[0]}</span>`;
}

let _rev=null; // last /api/reviews/list payload, so a reply knows its review's location
function renderReviews(){ const box=document.getElementById('reviewsBody'); if(box) loadReviews(); }

async function loadReviews(){
  const box=document.getElementById('reviewsBody'); if(!box) return;
  box.innerHTML=`<div class="empty" style="padding:32px"><div class="big">⏳</div>Checking your Google connection…</div>`;
  let st=null;
  try{ st=await fetch('/api/reviews/list',{cache:'no-store'}).then(r=>r.json()); }catch(e){ st={connected:false,error:'network'}; }
  if(!st || !st.connected){ box.innerHTML=reviewsConnectPanel(st||{}); return; }
  renderReviewsUI(st);
}

function reviewsConnectPanel(st){
  const cfg = st.configured!==false;
  return `<div class="card">
    <h3>Connect Google Business Profile</h3>
    <p class="hint">Mikey Systems replies to your Google reviews automatically each week — a warm thank-you to 4- and 5-star reviews (posted for you), and a draft reply held here for your approval on anything 3 stars or below. No browser needed; it runs on the server even when your computer is off.</p>
    ${cfg?'':`<div class="note" style="border-left-color:var(--red);background:var(--red-bg)">Google isn’t configured yet. Add <b>GOOGLE_CLIENT_ID</b> and <b>GOOGLE_CLIENT_SECRET</b> in Netlify (see the setup steps), then reload.</div>`}
    <div class="row-actions" style="margin-top:12px">
      <button class="btn" onclick="gbpConnect()" ${cfg?'':'disabled style="opacity:.5"'}>Connect Google</button>
    </div>
    <div class="note" style="margin-top:14px">First time only: your Google Cloud project needs access to the Business Profile API (a one-time approval from Google). Once that’s granted and you connect here, weekly replies start automatically.</div>
  </div>`;
}

function renderReviewsUI(st){
  _rev=st;
  const box=document.getElementById('reviewsBody');
  const reviews=st.reviews||[];
  const held=reviews.filter(r=>r.status==='held');
  const minStars=(st.settings&&st.settings.autopostMinStars)||4;
  const locNames=(st.locations||[]).map(l=>l.title).filter(Boolean);
  let html='';

  // Top bar
  html+=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
    <div><div style="font-weight:700;font-size:16px">${locNames.length?esc(locNames.join(' · ')):'Your Google listings'}</div>
      <div class="hint" style="margin:2px 0 0">${locNames.length} listing${locNames.length===1?'':'s'} connected · auto-posting replies to <b>${minStars}★ and up</b>, holding <b>${minStars-1}★ and below</b> for you.</div></div>
    <div class="row-actions" style="margin:0">
      <label class="fld" style="margin:0 8px 0 0;align-self:center">Auto-post</label>
      <select id="rev_autopost" onchange="revSetAutopost(this.value)" style="max-width:150px">
        <option value="4" ${minStars===4?'selected':''}>4★ &amp; up</option>
        <option value="5" ${minStars===5?'selected':''}>5★ only</option>
        <option value="3" ${minStars===3?'selected':''}>3★ &amp; up</option>
      </select>
      <button class="btn sm" onclick="reviewsRun(this)">Run weekly now</button>
      <button class="btn ghost sm" onclick="gbpDisconnect()">Disconnect</button>
    </div></div>`;
  if(st.error) html+=`<div class="note" style="border-left-color:var(--red);background:var(--red-bg)">Couldn’t reach Google: ${esc(st.detail||st.error)}. If you just connected, give the API approval a moment.</div>`;
  html+=`</div>`;

  // Needs-approval queue
  if(held.length){
    html+=`<h2 class="section">Needs your approval (${held.length})</h2>`;
    html+=held.map(r=>`<div class="card" style="border-left:3px solid var(--amber)">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>${starStr(r.stars)} <b style="margin-left:6px">${esc(r.reviewer)}</b> ${r.location?`<span class="pill" style="background:#f4ecdb;color:var(--copper-dk);margin-left:4px">${esc(r.location)}</span>`:''} <span class="hint">${r.createTime?fmtDate(r.createTime.slice(0,10)):''}</span></div>
        ${revStatusPill('held')}</div>
      ${r.comment?`<div style="margin:8px 0;color:#4a3a2a;font-size:14px">${esc(r.comment)}</div>`:'<div class="hint" style="margin:8px 0">(no review text)</div>'}
      <label class="fld">Suggested reply — edit before posting</label>
      <textarea id="rev_ta_${r.id}" rows="3">${esc(r.draft||'')}</textarea>
      <div class="row-actions" style="margin-top:10px"><button class="btn sm" onclick="reviewPost('${r.id}',this)">Post reply to Google</button></div>
    </div>`).join('');
  }

  // All recent reviews
  html+=`<h2 class="section" style="margin-top:8px">Recent reviews</h2>`;
  if(!reviews.length){ html+=`<div class="empty" style="padding:28px"><div class="big">💬</div>No reviews yet.</div>`; }
  else {
    html+=`<div class="tablewrap"><table><thead><tr><th>Stars</th><th>Reviewer</th><th>Listing</th><th>Review</th><th>Status</th></tr></thead><tbody>`+
      reviews.map(r=>`<tr><td style="white-space:nowrap">${starStr(r.stars)}</td><td>${esc(r.reviewer)}</td><td style="white-space:nowrap">${esc(r.location||'')}</td>
        <td style="max-width:380px">${esc((r.comment||'').slice(0,160))}${(r.comment||'').length>160?'…':''}${r.reply?`<div style="font-size:12px;color:var(--green);margin-top:3px">↳ ${esc(r.reply.slice(0,140))}${r.reply.length>140?'…':''}</div>`:''}</td>
        <td>${revStatusPill(r.status)}</td></tr>`).join('')+`</tbody></table></div>`;
  }
  box.innerHTML=html;
}

function gbpConnect(){ location.href='/api/google/connect?ws='+encodeURIComponent(WS||''); }
async function gbpDisconnect(){ if(!confirm('Disconnect Google? Weekly auto-replies will stop until you reconnect.'))return; try{ await fetch('/api/google/disconnect'); }catch(e){} flash('Google disconnected.'); loadReviews(); }
async function reviewsRun(btn){
  if(btn){ btn.disabled=true; btn.textContent='Running…'; }
  try{
    const d=await fetch('/api/reviews/run',{method:'POST'}).then(r=>r.json());
    if(d.ok){ flash(`Done — ${d.posted} posted, ${d.held} held for approval.`); }
    else if(d.error==='not_connected'){ alert('Google isn’t connected.'); }
    else { alert('Review run error: '+(d.detail||d.error||'unknown')); }
  }catch(e){ alert('Could not run: '+e.message); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='Run weekly now'; } loadReviews(); }
}
async function reviewPost(id,btn){
  const ta=document.getElementById('rev_ta_'+id); const comment=(ta&&ta.value||'').trim();
  if(!comment){ alert('Write a reply first.'); return; }
  const rv=(_rev&&_rev.reviews||[]).find(x=>x.id===id)||{};
  if(btn){ btn.disabled=true; btn.textContent='Posting…'; }
  try{
    const d=await fetch('/api/reviews/reply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reviewId:id,comment,accountId:rv.accountId,locationId:rv.locationId})}).then(r=>r.json());
    if(d.ok){ flash('Reply posted to Google.'); }
    else { alert('Could not post: '+(d.detail||d.error||'unknown')); }
  }catch(e){ alert('Could not post: '+e.message); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='Post reply to Google'; } loadReviews(); }
}
async function revSetAutopost(v){
  try{ await fetch('/api/reviews/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({autopostMinStars:+v})}); flash('Auto-post threshold saved.'); loadReviews(); }
  catch(e){ alert('Could not save setting: '+e.message); }
}

// After the Google OAuth redirect lands back on the app with ?gbp=connected.
(function(){ try{ const p=new URLSearchParams(location.search);
  if(p.get('gbp')==='connected'){ setTimeout(()=>{ try{ switchView('reviews'); flash('Google connected — you’re all set.'); }catch(e){} }, 400); }
  else if(p.get('gbp')==='error'){ setTimeout(()=>{ try{ switchView('reviews'); }catch(e){} }, 400); }
}catch(e){} })();
