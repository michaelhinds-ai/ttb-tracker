/* ================= Transaction model ================= */
const TX = [
  {id:'prod_distilled',account:'Production',label:'Spirits produced (distilled)',prod:+1,stor:0,proc:0,taxable:false,note:'Proof gallons gauged into the production account after distillation.'},
  {id:'prod_gain',account:'Production',label:'Production gain',prod:+1,stor:0,proc:0,taxable:false,note:'Recorded gain on production gauge.'},
  {id:'prod_to_stor',account:'Production',label:'Transferred to storage',prod:-1,stor:+1,proc:0,taxable:false,note:'Moves bulk from production into the storage account.'},
  {id:'prod_to_proc',account:'Production',label:'Transferred to processing',prod:-1,stor:0,proc:+1,taxable:false,note:'Moves spirits from production directly into processing.'},
  {id:'prod_loss',account:'Production',label:'Production loss',prod:-1,stor:0,proc:0,taxable:false,note:'Loss recorded in the production account.'},
  {id:'stor_deposit',account:'Storage',label:'Deposited in storage (received in bond)',prod:0,stor:+1,proc:0,taxable:false,note:'Bulk received into storage from outside the plant / in bond.'},
  {id:'stor_gain',account:'Storage',label:'Storage gain',prod:0,stor:+1,proc:0,taxable:false,note:'Inventory gain in storage.'},
  {id:'stor_to_proc',account:'Storage',label:'Transferred to processing',prod:0,stor:-1,proc:+1,taxable:false,note:'Moves bulk from storage into processing for bottling/blending.'},
  {id:'stor_taxpaid',account:'Storage',label:'Withdrawn — TAX DETERMINED',prod:0,stor:-1,proc:0,taxable:true,note:'⚑ Taxable removal from storage. Counts toward your federal excise return and Kentucky gallons.'},
  {id:'stor_taxfree',account:'Storage',label:'Withdrawn — tax-free (export / industrial)',prod:0,stor:-1,proc:0,taxable:false,note:'Non-taxable withdrawal (export or authorized tax-free use).'},
  {id:'stor_loss',account:'Storage',label:'Storage loss (evaporation / angels’ share)',prod:0,stor:-1,proc:0,taxable:false,note:'Aging / handling loss in storage.'},
  {id:'proc_deposit',account:'Processing',label:'Received / dumped into processing',prod:0,stor:0,proc:+1,taxable:false,note:'Bulk dumped or received into the processing account from outside.'},
  {id:'proc_gain',account:'Processing',label:'Processing gain',prod:0,stor:0,proc:+1,taxable:false,note:'Gain recorded in processing.'},
  {id:'proc_bottled',account:'Processing',label:'Bottled (informational)',prod:0,stor:0,proc:0,taxable:false,note:'Records bottling activity. Does not change bulk proof gallons on hand.'},
  {id:'proc_taxpaid',account:'Processing',label:'Removed — TAX DETERMINED',prod:0,stor:0,proc:-1,taxable:true,note:'⚑ Taxable removal of finished product. Counts toward your federal excise return and Kentucky gallons.'},
  {id:'proc_taxfree',account:'Processing',label:'Removed — for export / tax-free',prod:0,stor:0,proc:-1,taxable:false,note:'Non-taxable removal (export or authorized use).'},
  {id:'proc_loss',account:'Processing',label:'Processing loss',prod:0,stor:0,proc:-1,taxable:false,note:'Loss recorded in processing.'},
];
const TXBYID=Object.fromEntries(TX.map(t=>[t.id,t]));
const TIERS=[{upTo:100000,rate:2.70},{upTo:22130000,rate:13.34},{upTo:Infinity,rate:13.50}];
// Kentucky HB5 barrel-tax phase-out: percent of tax still owed by assessment year
const KY_PHASEOUT={2025:100,2026:96,2027:92,2028:88,2029:84,2030:80,2031:76,2032:72,2033:68,2034:61,2035:54,2036:44,2037:38,2038:32,2039:24,2040:20,2041:15,2042:8};
const kyPhasePct=y=> y>=2043?0:(y<=2025?100:(KY_PHASEOUT[y]??100));

/* ================= State ================= */
function freshState(){return{settings:{name:'',permit:'',freq:'quarterly',year:new Date().getFullYear(),kyExcise:1.92,kyWholesale:11,kyCase:0.05,bottlesPerCase:6},entries:[],ky:{monthly:{},barrel:{}},barrels:[],bottlings:[],finishedGoods:[],customers:[],orders:[],history:[],auth:{enabled:false,users:[]},dailyBackups:[],tibouts:[],tibins:[],tasks:[],skus:[{id:'seed-lrwc-11sib',company:'Louisville Rickhouse Whiskey Co',product:'11 Year Single Barrel Bourbon',size:'750ml',scc6:'',scc12:'10850033780311'}],brandLogos:{},docs:[],assets:[],barrelsProc:[],wages:{},expenses:[],pnlXolaMap:{},locAlias:{},pnlLocs:[],salaried:[],attention:[]};}
let state=freshState();
let WS=null;
const API='/api/data';

/* ================= Sync layer ================= */
function genKey(){ if(crypto&&crypto.randomUUID) return crypto.randomUUID().replace(/-/g,''); return 'k'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); }
function readWSfromHash(){ const h=new URLSearchParams(location.hash.slice(1)); return (h.get('ws')||'').trim(); }
function writeWStoHash(ws){ const h=new URLSearchParams(location.hash.slice(1)); h.set('ws',ws); location.hash=h.toString(); }
function cacheKey(){ return 'ttb_cache_'+WS; }
function normalize(d){ const s=freshState(); s.settings=Object.assign(s.settings,d.settings||{}); s.entries=Array.isArray(d.entries)?d.entries:[]; s.ky=Object.assign({monthly:{},barrel:{}},d.ky||{}); s.barrels=Array.isArray(d.barrels)?d.barrels:[]; s.bottlings=Array.isArray(d.bottlings)?d.bottlings:[]; s.finishedGoods=Array.isArray(d.finishedGoods)?d.finishedGoods:[]; s.customers=Array.isArray(d.customers)?d.customers:[]; s.orders=Array.isArray(d.orders)?d.orders:[]; s.history=Array.isArray(d.history)?d.history:[]; s.auth={enabled:!!(d.auth&&d.auth.enabled),users:Array.isArray(d.auth&&d.auth.users)?d.auth.users:[]}; s.dailyBackups=Array.isArray(d.dailyBackups)?d.dailyBackups:[]; s.tibouts=Array.isArray(d.tibouts)?d.tibouts:[]; s.tibins=Array.isArray(d.tibins)?d.tibins:[]; s.tasks=Array.isArray(d.tasks)?d.tasks:[]; s.skus=(Array.isArray(d.skus)?d.skus:s.skus).map(x=>({...x,scc12:x.scc12||x.scc||'',scc6:x.scc6||''})); s.brandLogos=(d.brandLogos&&typeof d.brandLogos==='object'&&!Array.isArray(d.brandLogos))?d.brandLogos:{}; s.docs=Array.isArray(d.docs)?d.docs:[]; s.assets=Array.isArray(d.assets)?d.assets:[]; s.barrelsProc=Array.isArray(d.barrelsProc)?d.barrelsProc:[]; s.wages=(d.wages&&typeof d.wages==='object'&&!Array.isArray(d.wages))?d.wages:{}; s.expenses=Array.isArray(d.expenses)?d.expenses:[]; s.pnlXolaMap=(d.pnlXolaMap&&typeof d.pnlXolaMap==='object'&&!Array.isArray(d.pnlXolaMap))?d.pnlXolaMap:{}; s.locAlias=(d.locAlias&&typeof d.locAlias==='object'&&!Array.isArray(d.locAlias))?d.locAlias:{}; s.pnlLocs=Array.isArray(d.pnlLocs)?d.pnlLocs:[]; s.salaried=Array.isArray(d.salaried)?d.salaried:[]; s.attention=Array.isArray(d.attention)?d.attention:[]; return s; }

/* ================= Access control (UI-gated roles) ================= */
const ROLE_CAPS={ admin:['write','delete','setup','users','reports'], editor:['write','reports'], manager:['write'], barrelmgr:['write'], production:[], reports:['reports'], viewer:[] };
const ROLE_LABEL={ admin:'Admin', editor:'Editor', manager:'Manager', barrelmgr:'Barrel Manager', production:'Production', reports:'Reports', viewer:'Viewer' };
// Roles an admin can tune section-visibility for (admin always sees everything).
const CONFIG_ROLES=['editor','manager','barrelmgr','production','reports','viewer'];
// The navigable sections that can be shown/hidden per role.
const SECTIONS=[
  {v:'lrs',label:'Live Retail Sales'},{v:'salesrpt',label:'Sales Report'},{v:'retail',label:'Retail Sales'},
  {v:'reports',label:'Federal Reports'},{v:'kentucky',label:'Kentucky Tax'},{v:'dashboard',label:'Compliance Dashboard'},
  {v:'payroll',label:'Payroll'},{v:'expenses',label:'Overhead & Expenses'},{v:'pnl',label:'Rough P&L'},
  {v:'marketing',label:'Marketing'},{v:'reviews',label:'Reviews'},{v:'barrels',label:'Barrels'},
  {v:'bottling',label:'Bottling'},{v:'finished',label:'Finished Goods'},{v:'orders',label:'Orders'},
  {v:'customers',label:'Customers'},{v:'compliance',label:'Compliance Center'},{v:'labels',label:'Case Labels'},
  {v:'barrelsproc',label:'Processing'},{v:'ledger',label:'Ledger'},{v:'data',label:'Setup & Sync'},
];
// Sensible default hides per role (used until an admin customizes in the Roles panel).
const DEFAULT_HIDDEN={
  barrelmgr:['payroll','expenses','pnl','lrs','salesrpt','retail','reports','kentucky','dashboard','marketing','reviews','data','customers'],
  production:['payroll','expenses','pnl','lrs','salesrpt','retail','reports','kentucky','dashboard','marketing','reviews','data','orders','customers','ledger'],
  reports:['payroll','expenses','pnl','data'],
  viewer:['payroll','expenses','pnl','data'],
};
function roleHiddenList(role){ const rv=(state.settings&&state.settings.roleViews)||{}; return Array.isArray(rv[role])?rv[role]:(DEFAULT_HIDDEN[role]||[]); }
function viewBlocked(v){ const role=currentRole(); if(role==='admin') return false; return roleHiddenList(role).indexOf(v)>=0; }
function setRoleView(role, v, visible){ if(!requireCap('setup'))return; if(!state.settings.roleViews)state.settings.roleViews={}; let list=Array.isArray(state.settings.roleViews[role])?state.settings.roleViews[role].slice():roleHiddenList(role).slice(); if(visible){ list=list.filter(x=>x!==v); } else if(list.indexOf(v)<0){ list.push(v); } state.settings.roleViews[role]=list; save('Updated '+ (ROLE_LABEL[role]||role) +' access'); applyPermissions(); renderRolePanel(); }
let _rolePanelRole='barrelmgr';
function renderRolePanel(){
  const box=document.getElementById('rolePanel'); if(!box) return;
  if(!(typeof can==='function' && can('setup'))){ box.innerHTML=''; return; }
  const role=_rolePanelRole;
  const caps=(ROLE_CAPS[role]||[]);
  const capLabels={write:'Add / edit data',reports:'Run reports',delete:'Delete & rewind',setup:'Setup & financials',users:'Manage users'};
  const chips=Object.keys(capLabels).map(c=>{const on=caps.indexOf(c)>=0;return `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 9px;border-radius:20px;font-size:12px;background:${on?'#e7f0e3':'#f3ece0'};color:${on?'#2f6b34':'#a2937b'}">${on?'✓':'✕'} ${capLabels[c]}</span>`;}).join('');
  const hidden=new Set(roleHiddenList(role));
  const secRows=SECTIONS.map(s=>`<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;cursor:pointer"><input type="checkbox" ${hidden.has(s.v)?'':'checked'} onchange="setRoleView('${role}','${s.v}',this.checked)"> ${esc(s.label)}</label>`).join('');
  box.innerHTML=`
    <div class="row-actions" style="margin-bottom:12px;align-items:center">
      <label class="fld" style="margin:0">Show settings for role</label>
      <select onchange="_rolePanelRole=this.value;renderRolePanel()">${CONFIG_ROLES.map(r=>`<option value="${r}" ${r===role?'selected':''}>${ROLE_LABEL[r]||r}</option>`).join('')}</select>
    </div>
    <div class="hint" style="margin:0 0 6px"><b>${esc(ROLE_LABEL[role]||role)}</b> can: ${chips}</div>
    <div class="hint" style="margin:0 0 10px">Tick a section to let this role open it; untick to hide it. <b>Admin always sees everything.</b></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px">${secRows}</div>`;
}
let SESSION=null; // {userId,name,role}
function authOn(){ return !!(state.auth&&state.auth.enabled&&(state.auth.users||[]).length); }
function currentRole(){ if(!authOn()) return 'admin'; return SESSION?SESSION.role:'viewer'; }
function isManager(){ return currentRole()==='manager'; }
function can(cap){ return (ROLE_CAPS[currentRole()]||[]).includes(cap); }
function requireCap(cap){ if(can(cap)) return true; flash('Your role ('+ROLE_LABEL[currentRole()]+') can’t do that.'); return false; }
async function hashPin(pin){ const enc=new TextEncoder().encode('ttbsalt:'+pin); const buf=await crypto.subtle.digest('SHA-256',enc); return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function sessKey(){ return 'ttb_sess_'+(WS||''); }
const SESS_MAX_MS=30*24*3600*1000; // stay signed in on this device for 30 days of inactivity
function loadSession(){
  try{
    // Prefer the persistent (this-device) login; fall back to any older tab-only session.
    const j=localStorage.getItem(sessKey())||sessionStorage.getItem(sessKey());
    if(!j) return;
    const s=JSON.parse(j);
    if(s && s.exp && s.exp<Date.now()){ clearSession(); return; }   // expired → require sign-in
    if(state.auth.users.some(u=>u.id===s.userId&&u.role===s.role)){ SESSION={userId:s.userId,name:s.name,role:s.role}; saveSession(); } // valid → slide the expiry forward
  }catch(e){}
}
function saveSession(){ try{ const rec=Object.assign({},SESSION,{exp:Date.now()+SESS_MAX_MS}); localStorage.setItem(sessKey(),JSON.stringify(rec)); sessionStorage.removeItem(sessKey()); }catch(e){} }
function clearSession(){ SESSION=null; try{ localStorage.removeItem(sessKey()); sessionStorage.removeItem(sessKey()); }catch(e){} }
// Loading screen shown while the app is locked and no login card is up yet.
function showBootLoading(){ if(document.getElementById('bootLoading')) return; const el=document.createElement('div'); el.id='bootLoading'; el.innerHTML='<div class="sp"></div><div class="t">Loading Mikey Systems…</div>'; document.body.appendChild(el); }
function hideBootLoading(){ const el=document.getElementById('bootLoading'); if(el) el.remove(); }
function lockApp(){ document.body.classList.add('locked'); }
function unlockApp(){ document.body.classList.remove('locked'); hideBootLoading(); }
function gateBoot(){
  loadSession();
  if(authOn() && !SESSION){ lockApp(); hideBootLoading(); showLogin(); return false; }
  unlockApp(); applyPermissions(); return true;
}
function showLogin(){
  let ov=$('#authWrap'); if(ov) ov.remove();
  const users=[...(state.auth.users||[])].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  ov=document.createElement('div'); ov.id='authWrap'; ov.className='authwrap';
  ov.innerHTML=`<div class="authcard"><div class="hd"><h2>Mikey Systems</h2><div style="opacity:.8;font-size:13px;margin-top:4px">${state.settings.name||'Sign in to continue'}</div></div>
  <div class="bd">
    <label>User</label><select id="authUser">${users.map(u=>`<option value="${u.id}">${u.name} — ${ROLE_LABEL[u.role]||u.role}</option>`).join('')}</select>
    <label>PIN</label><input type="password" id="authPin" inputmode="numeric" autocomplete="off" placeholder="Enter your PIN">
    <div class="err" id="authErr"></div>
    <button class="btn" id="authGo" style="width:100%;margin-top:6px">Sign in</button>
  </div></div>`;
  document.body.appendChild(ov);
  const go=async()=>{ const uid=$('#authUser').value, pin=$('#authPin').value||''; const u=state.auth.users.find(x=>x.id===uid);
    if(!u){ $('#authErr').textContent='Pick a user.'; return; }
    const h=await hashPin(pin);
    if(h!==u.pinHash){ $('#authErr').textContent='Incorrect PIN.'; $('#authPin').value=''; $('#authPin').focus(); return; }
    SESSION={userId:u.id,name:u.name,role:u.role}; saveSession(); ov.remove(); unlockApp(); applyPermissions(); refreshAll(); if(currentRole()==='production'){try{switchView('labels');}catch(e){}}
  };
  $('#authGo').onclick=go;
  $('#authPin').addEventListener('keydown',e=>{ if(e.key==='Enter') go(); });
  setTimeout(()=>$('#authPin').focus(),50);
}
function logout(){ clearSession(); if(authOn()){ lockApp(); showLogin(); } }
function applyPermissions(){
  const role=currentRole();
  const b=document.body;
  ['write','delete','setup','users','reports'].forEach(c=>b.classList.toggle('perm-'+c, can(c)));
  ['admin','editor','manager','barrelmgr','production','reports','viewer'].forEach(r=>b.classList.toggle('role-'+r, role===r));
  // Hide any tile / link / button whose target view this role isn't allowed to see.
  try{
    document.querySelectorAll('[onclick^="switchView("]').forEach(el=>{
      const m=/switchView\('([a-z0-9]+)'\)/i.exec(el.getAttribute('onclick')||''); if(!m) return;
      const v=m[1]; if(v==='home') return;
      el.style.display = viewBlocked(v) ? 'none' : '';
    });
  }catch(e){}
  const el=$('#whoami'); if(el){
    if(authOn()&&SESSION){ el.style.display=''; el.innerHTML=`<span>${SESSION.name}</span><span class="role">${ROLE_LABEL[role]||role}</span><button class="logout" id="logoutBtn">Sign out</button>`; const lb=$('#logoutBtn'); if(lb) lb.onclick=logout; }
    else { el.style.display='none'; el.innerHTML=''; }
  }
}
/* ================= Automatic daily backups ================= */
const BACKUP_MAX=30;
async function gzB64(str){
  try{ if(typeof CompressionStream==='undefined') throw 0;
    const cs=new CompressionStream('gzip'); const w=cs.writable.getWriter(); w.write(new TextEncoder().encode(str)); w.close();
    const buf=await new Response(cs.readable).arrayBuffer(); const u=new Uint8Array(buf); let bin=''; for(let i=0;i<u.length;i++) bin+=String.fromCharCode(u[i]); return 'gz:'+btoa(bin);
  }catch(e){ return 'raw:'+str; }
}
async function ungzB64(s){
  if(s.startsWith('raw:')) return s.slice(4);
  const bin=atob(s.slice(3)); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  const ds=new DecompressionStream('gzip'); const w=ds.writable.getWriter(); w.write(u); w.close();
  const buf=await new Response(ds.readable).arrayBuffer(); return new TextDecoder().decode(buf);
}
function dataForBackup(){ const c=Object.assign({},state); delete c.history; delete c.dailyBackups; return c; }
async function maybeDailyBackup(){
  if(!(can('write')||!authOn())) return false;   // don't let view-only sessions trigger a workspace write
  if(!state.dailyBackups) state.dailyBackups=[];
  const today=new Date().toISOString().slice(0,10);
  if(state.dailyBackups.some(b=>b.date===today)) return false;
  const gz=await gzB64(JSON.stringify(dataForBackup()));
  state.dailyBackups.push({date:today, ts:Date.now(), gz, by:(SESSION?SESSION.name:null)});
  state.dailyBackups.sort((a,b)=>a.date.localeCompare(b.date));
  while(state.dailyBackups.length>BACKUP_MAX) state.dailyBackups.shift();
  persist(); renderBackups();
  return true;
}
async function restoreDailyBackup(date){
  if(!requireCap('setup'))return;
  const bk=(state.dailyBackups||[]).find(b=>b.date===date); if(!bk)return;
  if(!confirm('Restore the backup from '+date+'?\n\nThis replaces the current data with that day’s snapshot. Your users/login settings are kept, and a new activity entry is recorded so you can rewind this.'))return;
  let data; try{ data=JSON.parse(await ungzB64(bk.gz)); }catch(e){ alert('That backup could not be read.'); return; }
  const keepBackups=state.dailyBackups, keepAuth=state.auth;
  state=normalize(Object.assign(data,{dailyBackups:keepBackups}));
  state.auth=keepAuth; // never lock anyone out via a restore
  save('Restored the daily backup from '+date); loadSettingsForm(); refreshAll(); flash('Restored backup from '+date+'.');
}
async function downloadDailyBackup(date){
  const bk=(state.dailyBackups||[]).find(b=>b.date===date); if(!bk)return;
  let json; try{ json=await ungzB64(bk.gz); }catch(e){ alert('That backup could not be read.'); return; }
  const blob=new Blob([json],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='mikey-backup-'+date+'.json'; a.click(); URL.revokeObjectURL(a.href);
}
function renderBackups(){
  const el=$('#backupList'); if(!el) return;
  const rows=[...(state.dailyBackups||[])].sort((a,b)=>b.date.localeCompare(a.date));
  if(!rows.length){ el.innerHTML='<div class="hint">No automatic backups yet — the first one is taken the next time an editor or admin opens the app.</div>'; return; }
  el.innerHTML=`<div class="tablewrap" style="border:0;box-shadow:none"><table><thead><tr><th>Date</th><th>Taken</th><th class="noprint"></th></tr></thead><tbody>`+
    rows.map(b=>`<tr><td><b>${fmtDate(b.date)}</b></td><td style="color:var(--muted)">${b.ts?new Date(b.ts).toLocaleString('en-US'):''}${b.by?(' · '+b.by):''}</td><td class="noprint"><button class="link" onclick="downloadDailyBackup('${b.date}')">Download</button>${can('setup')?` · <button class="link" onclick="restoreDailyBackup('${b.date}')">Restore</button>`:''}</td></tr>`).join('')+
    `</tbody></table></div>`;
}
let editingUserId=null;
function renderUsers(){
  const st=$('#authState'); const mg=$('#userMgmt'); if(!st) return;
  if(!authOn()){
    st.innerHTML=`<div class="note">Login is currently <b>off</b> — anyone with the sync link has full access. Turn it on to create accounts and assign roles.</div><div class="row-actions" style="margin-top:10px"><button class="btn" id="enableLogin">Enable login</button></div>`;
    if(mg) mg.style.display='none';
    const eb=$('#enableLogin'); if(eb) eb.onclick=enableLogin; return;
  }
  st.innerHTML=`<div class="note" style="background:#eaf4ee;border-color:#bcdcc7"><b>Login is on.</b> ${state.auth.users.length} user(s) — each signs in with their name and PIN.</div><div class="row-actions" style="margin-top:10px"><button class="btn gray" id="disableLogin">Turn login off</button></div>`;
  if(mg) mg.style.display='';
  const db=$('#disableLogin'); if(db) db.onclick=disableLogin;
  const rows=[...state.auth.users].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const ub=$('#userBody'); if(ub) ub.innerHTML=rows.map(u=>`<tr><td><b>${u.name||''}</b>${SESSION&&SESSION.userId===u.id?' <span class="pill tax">you</span>':''}</td><td>${ROLE_LABEL[u.role]||u.role}</td><td class="noprint"><button class="link" onclick="editUser('${u.id}')">Edit</button> · <button class="del" onclick="deleteUser('${u.id}')">Del</button></td></tr>`).join('');
}
async function enableLogin(){
  if(!requireCap('users'))return;
  const name=prompt('Create the first ADMIN account.\n\nAdmin name:',state.settings.signer||''); if(name===null)return; if(!name.trim()){ alert('Enter a name.'); return; }
  const pin=prompt('Set a PIN for '+name.trim()+' (4+ digits) — you’ll use it to sign in:'); if(pin===null)return; if((pin||'').length<4){ alert('PIN must be at least 4 digits.'); return; }
  const u={id:uid(),name:name.trim(),role:'admin',pinHash:await hashPin(pin)};
  state.auth.users=[u]; state.auth.enabled=true;
  SESSION={userId:u.id,name:u.name,role:'admin'}; saveSession();
  save('Enabled user login'); applyPermissions(); refreshAll();
  flash('Login enabled — you’re signed in as Admin.');
}
function disableLogin(){
  if(!requireCap('users'))return;
  if(!confirm('Turn login OFF? Everyone with the sync link gets full access again. Your user list is kept.'))return;
  state.auth.enabled=false; clearSession(); save('Disabled user login'); applyPermissions(); refreshAll(); flash('Login turned off.');
}
async function userSave(){
  if(!requireCap('users'))return;
  const name=$('#u_name').value.trim(), role=$('#u_role').value, pin=$('#u_pin').value||'';
  if(!name){ alert('Enter a name.'); return; }
  if(editingUserId){
    const u=state.auth.users.find(x=>x.id===editingUserId); if(!u)return;
    if(u.role==='admin' && role!=='admin' && state.auth.users.filter(x=>x.role==='admin').length<=1){ alert('You can’t change the last admin’s role — add another admin first.'); return; }
    u.name=name; u.role=role;
    if(pin){ if(pin.length<4){alert('PIN must be at least 4 digits.');return;} u.pinHash=await hashPin(pin); }
    if(SESSION&&SESSION.userId===u.id){ SESSION.name=u.name; SESSION.role=u.role; saveSession(); }
    cancelUser(); save('Updated a user'); applyPermissions(); refreshAll(); flash('User updated.');
  } else {
    if(pin.length<4){ alert('PIN must be at least 4 digits.'); return; }
    state.auth.users.push({id:uid(),name,role,pinHash:await hashPin(pin)});
    cancelUser(); save('Added a user'); refreshAll(); flash('User added.');
  }
}
function editUser(id){
  if(!requireCap('users'))return;
  const u=state.auth.users.find(x=>x.id===id); if(!u)return;
  editingUserId=id; $('#u_name').value=u.name||''; $('#u_role').value=u.role; $('#u_pin').value='';
  $('#u_pin').placeholder='Leave blank to keep current PIN';
  $('#userFormTitle').textContent='Edit '+(u.name||'user'); $('#userCancel').style.display='inline-block';
  switchView('data'); $('#u_name').scrollIntoView({behavior:'smooth',block:'center'});
}
function cancelUser(){ editingUserId=null; const n=$('#u_name'); if(!n)return; n.value=''; $('#u_pin').value=''; $('#u_pin').placeholder='4+ digits'; $('#u_role').value='admin'; $('#userFormTitle').textContent='Add a user'; $('#userCancel').style.display='none'; }
function deleteUser(id){
  if(!requireCap('users'))return;
  const u=state.auth.users.find(x=>x.id===id); if(!u)return;
  if(u.role==='admin' && state.auth.users.filter(x=>x.role==='admin').length<=1){ alert('You can’t delete the last admin.'); return; }
  if(!confirm('Delete user '+(u.name||'')+'?'))return;
  const wasSelf=SESSION&&SESSION.userId===id;
  state.auth.users=state.auth.users.filter(x=>x.id!==id);
  save('Deleted a user');
  if(wasSelf){ clearSession(); if(authOn()){ showLogin(); return; } }
  applyPermissions(); refreshAll(); flash('User deleted.');
}

function setSync(status){
  const dot=document.getElementById('syncDot'), txt=document.getElementById('syncTxt');
  if(!dot) return;
  dot.className='dot '+status;
  txt.textContent = status==='synced'?'Synced':status==='saving'?'Saving…':status==='offline'?'Offline (saved locally)':'Connecting…';
}
let cloudAvailable=true, cloudBaseSavedAt=null;
function baseKey(){ return 'ttb_base_'+WS; }
function adoptCloud(d){ state=normalize(d); cloudBaseSavedAt=d._savedAt||null; try{localStorage.setItem(cacheKey(),JSON.stringify(state));}catch(e){} try{ if(cloudBaseSavedAt) localStorage.setItem(baseKey(),cloudBaseSavedAt); }catch(e){} setSync('synced'); }
async function cloudLoad(){
  try{
    // Hard timeout so a hung request (cold serverless start, flaky iPad/Safari
    // connection) can't leave startup stuck on "Connecting…". On timeout the
    // fetch aborts, we fall back to the local cache, and boot proceeds.
    const ctl=(typeof AbortController!=='undefined')?new AbortController():null;
    const to=setTimeout(()=>{ if(ctl){ try{ctl.abort();}catch(e){} } }, 12000);
    let r; try{ r=await fetch(`${API}?ws=${encodeURIComponent(WS)}`,{cache:'no-store',signal:ctl?ctl.signal:undefined}); } finally { clearTimeout(to); }
    if(r.ok){
      cloudAvailable=true; // reached the server — (re-)enable saving after any offline spell
      const d=await r.json();
      const cache=localStorage.getItem(cacheKey());
      const storedBase=localStorage.getItem(baseKey());
      if(d && (d.entries||d.settings)){
        // If the cloud advanced since this device last synced, push our local copy so the
        // SERVER merges the two (union of records) — nothing gets lost, and we pick up
        // whatever another device added.
        if(cache && storedBase && String(storedBase)!==String(d._savedAt||'')){
          try{ state=normalize(JSON.parse(cache)); }catch(e){ adoptCloud(d); return; }
          cloudBaseSavedAt=storedBase; cloudAvailable=true; setSync('saving'); cloudSave(); return;
        }
        adoptCloud(d); return;
      }
      // no cloud record yet — seed from local cache if present
      if(cache){ try{ state=normalize(JSON.parse(cache)); }catch(e){ setSync('synced'); return; } cloudBaseSavedAt=storedBase||null; await cloudSave(true); } else { setSync('synced'); }
      return;
    }
    throw new Error('http '+r.status);
  }catch(e){
    cloudAvailable=false;
    const c=localStorage.getItem(cacheKey());
    if(c){ try{ state=normalize(JSON.parse(c)); }catch(e2){} }
    setSync('offline');
  }
}
let saveTimer=null, saving=false, pending=false, unsaved=false;
let lastSnap=null; const HIST_MAX=25;
// data-only snapshot (excludes the history log itself, so snapshots never nest)
function dataOnly(){ const c=Object.assign({},state); delete c.history; delete c.dailyBackups; delete c.brandLogos; return JSON.stringify(c); }
function resizeDataURL(dataURL,maxW,cb){ try{ const img=new Image(); img.onload=function(){ let w=img.naturalWidth||img.width, h=img.naturalHeight||img.height; if(w>maxW){ h=Math.round(h*maxW/w); w=maxW; } const cv=document.createElement('canvas'); cv.width=w; cv.height=h; cv.getContext('2d').drawImage(img,0,0,w,h); let out; try{ out=cv.toDataURL('image/png'); }catch(e){ out=dataURL; } cb(out||dataURL); }; img.onerror=function(){ cb(dataURL); }; img.src=dataURL; }catch(e){ cb(dataURL); } }
// One-time repair: strip logo images out of undo snapshots and shrink stored logos, then push the smaller state to the cloud so sync recovers.
function runSyncRepair(){ try{
  let changed=false;
  (state.history||[]).forEach(h=>{ if(h && typeof h.snap==='string' && h.snap.indexOf('\"brandLogos\"')>=0){ try{ const o=JSON.parse(h.snap); if(o.brandLogos!==undefined){ delete o.brandLogos; h.snap=JSON.stringify(o); changed=true; } }catch(e){} } });
  const bl=state.brandLogos||{}; const big=Object.keys(bl).filter(k=>typeof bl[k]==='string' && bl[k].indexOf('data:')===0 && bl[k].length>60000);
  const finish=()=>{ try{ localStorage.setItem(cacheKey(),JSON.stringify(state)); }catch(e){} lastSnap=dataOnly(); if(location.protocol!=='file:'){ cloudAvailable=true; setSync('saving'); cloudSave(); } };
  if(!big.length){ if(changed) finish(); return; }
  let pending=big.length; big.forEach(k=>{ resizeDataURL(bl[k],460,(out)=>{ if(out && out.length<bl[k].length){ state.brandLogos[k]=out; changed=true; } if(--pending===0) finish(); }); });
}catch(e){} }
function save(label,ref){
  if(!state.history) state.history=[];
  // record the just-completed action, storing the PRE-action state for rewind
  if(lastSnap!==null && label!==false){
    state.history.push({id:uid(), ts:Date.now(), label:label||'Change saved', snap:lastSnap, ref:ref||null, by:(authOn()&&SESSION)?SESSION.name:null});
    if(state.history.length>HIST_MAX) state.history.shift();
  }
  lastSnap=dataOnly();
  updateUndoBtn(); renderActivity();
  persist();
}
function persist(){
  try{ localStorage.setItem(cacheKey(),JSON.stringify(state)); }catch(e){}
  if(!cloudAvailable){ setSync('offline'); return; }
  unsaved=true;
  setSync('saving'); clearTimeout(saveTimer); saveTimer=setTimeout(()=>cloudSave(),650);
}
function rewindTo(id){
  const hist=state.history||[]; const i=hist.findIndex(h=>h.id===id);
  if(i<0) return;
  if(!requireCap('delete'))return;
  const ans=prompt('Rewind to before "'+hist[i].label+'"?\n\nThis undoes that change and everything done after it — it cannot itself be undone.\n\nType REWIND to confirm:');
  if(ans===null) return;
  if(ans.trim().toUpperCase()!=='REWIND'){ flash('Rewind cancelled — you must type REWIND to confirm.'); return; }
  const data=JSON.parse(hist[i].snap);
  const keep=hist.slice(0,i);            // keep actions that came before this one
  state=normalize(Object.assign(data,{history:keep, brandLogos:state.brandLogos}));
  lastSnap=dataOnly();
  updateUndoBtn(); persist(); refreshAll();
  flash('Rewound.');
}
function undo(){ const h=state.history||[]; if(!h.length) return; rewindTo(h[h.length-1].id); }
function updateUndoBtn(){
  const b=$('#undoBtn'); if(!b) return; const n=(state.history||[]).length;
  b.style.display=n?'':'none';
  b.textContent='↶ Undo ('+n+')';
}
function relTime(ts){
  const s=Math.max(0,(Date.now()-ts)/1000);
  if(s<60) return 'just now';
  if(s<3600) return Math.floor(s/60)+' min ago';
  if(s<86400) return Math.floor(s/3600)+' hr ago';
  const d=Math.floor(s/86400); if(d<30) return d+(d===1?' day ago':' days ago');
  return new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function renderActivity(){
  const el=$('#recentBody'); if(!el) return;
  const hist=(state.history||[]).slice().reverse();
  if(!hist.length){ el.innerHTML=`<tr><td colspan="3" class="empty">No activity yet. Anything you save shows up here — with a Rewind button to undo it.</td></tr>`; return; }
  el.innerHTML=hist.map(h=>{
    const isBt=h.ref&&h.ref.type==='bottling'&&(state.bottlings||[]).some(b=>b.id===h.ref.id);
    const lbl=isBt?`<button class="link" style="text-align:left" onclick="openBottlingDetail('${h.ref.id}')">${h.label}</button>`:h.label;
    const who=h.by?`<span style="color:var(--muted);font-size:11px"> · ${h.by}</span>`:'';
    return `<tr><td style="white-space:nowrap;color:var(--muted)">${relTime(h.ts)}</td><td>${lbl}${who}</td><td class="num noprint">${can('delete')?`<button class="rewind" onclick="rewindTo('${h.id}')">↶ Rewind</button>`:''}</td></tr>`;
  }).join('');
}
async function cloudSave(silent){
  if(!cloudAvailable) return;
  if(saving){ pending=true; return; }
  saving=true;
  try{
    const payload=Object.assign({},state,{_baseSavedAt:cloudBaseSavedAt||null});
    const r=await fetch(`${API}?ws=${encodeURIComponent(WS)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const d=await r.json().catch(()=>null);
    if(r.ok && d && d.ok){
      cloudBaseSavedAt=d.savedAt||cloudBaseSavedAt; try{ if(d.savedAt) localStorage.setItem(baseKey(),d.savedAt); }catch(e){}
      if(d.merged && d.state){ // server reconciled with another device's changes — adopt the merged result
        try{ state=normalize(d.state); localStorage.setItem(cacheKey(),JSON.stringify(state)); }catch(e){}
        lastSnap=dataOnly();
        try{ refreshAll(); }catch(e){}
        if(!silent) flash('Merged in changes from another device.');
      }
      unsaved=false;
      setSync('synced');
    } else { setSync(r.ok?'synced':'offline'); }
  }catch(e){ cloudAvailable=false; setSync('offline'); }
  saving=false;
  if(pending){ pending=false; cloudSave(silent); }
}

/* ===== Anti-data-loss safeguards ==========================================
   Four layers so a change (especially expenses/salaried) can't vanish:
   1) flushSave()  — fire a pending debounced save immediately.
   2) refresh-on-return — when a backgrounded tab becomes visible again, pull
      the latest so you never edit (and then save over) stale data.
   3) flush-on-leave — when the tab is hidden/closed, push any unsaved change
      right away (sendBeacon survives the page going away).
   4) background auto-sync — an idle, visible tab quietly re-syncs every ~25s
      so it can't drift out of date while it sits open. ======================= */
function flushSave(){ if(saveTimer){ clearTimeout(saveTimer); saveTimer=null; } if(unsaved && cloudAvailable && !saving){ cloudSave(true); } }
async function resync(){
  // Lightweight live-sync poll: fetch the cloud, and only re-render if it
  // actually changed since we last synced — so co-workers' edits show up fast
  // without the screen flickering every few seconds when nothing changed.
  if(!WS || saving) return;
  try{
    const r=await fetch(`${API}?ws=${encodeURIComponent(WS)}`,{cache:'no-store'});
    if(!r.ok) return;
    const d=await r.json().catch(()=>null);
    cloudAvailable=true;
    if(!d || !(d.entries||d.settings)) return;
    // Server unchanged since our last sync → nothing to do.
    if(cloudBaseSavedAt && String(d._savedAt||'')===String(cloudBaseSavedAt)) return;
    // We have local edits not yet saved → push (server merges) instead of clobbering them.
    if(unsaved){ cloudAvailable=true; setSync('saving'); cloudSave(); return; }
    // A teammate changed something → adopt it and re-render.
    adoptCloud(d);
    try{ if(typeof authOn==='function' && authOn() && !SESSION && !document.getElementById('authWrap') && typeof gateBoot==='function'){ gateBoot(); } else { refreshAll(); } }catch(e){ try{ refreshAll(); }catch(e2){} }
  }catch(e){}
}
// Best-effort flush that survives the page unloading: send the current state
// straight to the data endpoint so an in-flight expense isn't lost on close.
function beaconFlush(){
  try{
    if(!unsaved || !cloudAvailable || !WS) return;
    const payload=Object.assign({},state,{_baseSavedAt:cloudBaseSavedAt||null});
    const body=new Blob([JSON.stringify(payload)],{type:'application/json'});
    if(navigator.sendBeacon && navigator.sendBeacon(`${API}?ws=${encodeURIComponent(WS)}`, body)){ unsaved=false; return; }
    // Fallback: synchronous-ish keepalive fetch.
    fetch(`${API}?ws=${encodeURIComponent(WS)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),keepalive:true}).catch(()=>{});
    unsaved=false;
  }catch(e){}
}
(function wireSafeguards(){
  try{
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='hidden'){ flushSave(); beaconFlush(); }
      else if(document.visibilityState==='visible'){ resync(); }
    });
    window.addEventListener('pagehide',beaconFlush);
    window.addEventListener('beforeunload',()=>{ flushSave(); beaconFlush(); });
    // Idle background re-sync: only when the tab is visible, nothing is in
    // flight, and the user isn't actively typing in a field (so it can't wipe
    // a half-filled form).
    setInterval(()=>{
      if(document.visibilityState!=='visible' || saving) return;
      const ae=document.activeElement, tag=ae&&ae.tagName;
      if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA') return; // don't yank a half-typed form
      resync();
    }, 8000); // ~live: pick up teammates' changes within a few seconds
  }catch(e){}
})();

/* ================= Helpers ================= */
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
const round1=n=>Math.round((Number(n)||0)*10)/10;
const round2=n=>Math.round((Number(n)||0)*100)/100;
const money=n=>'$'+(Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
const numf=(n,d=1)=>(Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const pgCalc=(wg,proof)=>round1((Number(wg)||0)*(Number(proof)||0)/100);
function uid(){ return 'e'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function fmtDate(d){ return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function quarterOf(d){ return Math.floor((+d.slice(5,7)-1)/3)+1; }
function yearOf(d){ return +d.slice(0,4); }
function addDays(d,n){ const dt=new Date(d+'T00:00:00'); dt.setDate(dt.getDate()+n); return dt.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}); }

/* ================= Calculations ================= */
function balances(){ let b={Production:0,Storage:0,Processing:0}; for(const e of state.entries){const t=TXBYID[e.type];if(!t)continue;b.Production+=t.prod*e.pg;b.Storage+=t.stor*e.pg;b.Processing+=t.proc*e.pg;} b.Production=round1(b.Production);b.Storage=round1(b.Storage);b.Processing=round1(b.Processing); return b; }
function agingBarrelPG(){ return round1((state.barrels||[]).filter(b=>b.status==='Aging').reduce((s,b)=>s+barrelPG(b),0)); }
function barrelMoves(){
  const dep=[], wd=[];
  (state.barrels||[]).forEach(b=>{
    if(b.fromBottling)return; // tracking-only reconciled dumps: reporting comes from the bottling log
    const pg=barrelPG(b); const tib=b.origin==='Received in bond (TIB)';
    const rd = tib ? (b.tibInDate||b.fillDate||b.distillDate) : (b.fillDate||b.distillDate);
    if(rd && pg>0) dep.push({date:rd, pg, tib});
    if(b.status==='Dumped' && b.dumpDate && pg>0) wd.push({date:b.dumpDate, pg, kind:'dump'});
    else if(b.status==='Transferred out (TIB)' && b.tibOutDate && pg>0) wd.push({date:b.tibOutDate, pg, kind:'tibout'});
  });
  return {dep,wd};
}
function taxablePG(fn){ return round1(state.entries.filter(e=>TXBYID[e.type]&&TXBYID[e.type].taxable&&fn(e)).reduce((s,e)=>s+e.pg,0)); }
function taxableWG(fn){ return round2(state.entries.filter(e=>TXBYID[e.type]&&TXBYID[e.type].taxable&&fn(e)).reduce((s,e)=>s+(+e.wg||0),0)); }
function cbmaTax(prior,qty){ let rem=qty,base=prior,tax=0,lines=[]; for(const t of TIERS){ if(rem<=0)break; const capLeft=t.upTo-base; if(capLeft<=0)continue; const take=Math.min(rem,capLeft); if(take>0){tax+=take*t.rate;lines.push({pg:round1(take),rate:t.rate,amt:take*t.rate});} rem-=take;base+=take; } return {tax,lines}; }
function ytdTaxableBeforeQuarter(y,q){ return taxablePG(e=>yearOf(e.date)===y&&quarterOf(e.date)<q); }

/* ================= Dashboard ================= */
function renderHome(){
  try{ const h=new Date().getHours(); const g=h<12?'Good morning':h<18?'Good afternoon':'Good evening'; const el=document.getElementById('homeHello'); if(el)el.textContent=g+', Mike'; }catch(e){}
  try{ renderAttnForm(); }catch(e){}
  try{
    const me=SESSION?SESSION.userId:null; const admin=(typeof can==='function'&&can('setup'));
    const items=(state.attention||[]).filter(a=> admin || !a.forId || a.forId===me )
      .sort((x,y)=>(y.ts||0)-(x.ts||0));
    const dot=(t)=>`<span style="margin-top:5px;width:9px;height:9px;border-radius:50%;background:var(--${t||'amber'});flex:none"></span>`;
    const canClear=(a)=> admin || (me && a.forId===me);
    const posted=items.map(a=>`<div style="display:flex;gap:11px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)">${dot(a.tone)}<div style="flex:1"><div style="font-weight:700;font-size:14px">${esc(a.text||'')}</div><div style="color:var(--muted);font-size:12px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">${a.forId?('For '+esc(a.forName||'someone')):'Everyone'}${a.byName?(' · from '+esc(a.byName)):''}</div></div>${canClear(a)?`<button class="del noprint" onclick="delAttention('${a.id}')">Clear</button>`:''}</div>`).join('');
    const stat=[
      ['green','Email sync active','Square · Xola · Shopify → Mailchimp, every Monday.'],
      ['amber','Filing deadlines','Review TTB &amp; Kentucky returns before each due date.'],
    ].map(a=>`<div style="display:flex;gap:11px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)">${dot(a[0])}<div><div style="font-weight:700;font-size:14px">${a[1]}</div><div style="color:var(--muted);font-size:13px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">${a[2]}</div></div></div>`).join('');
    const box=document.getElementById('homeAlerts');
    if(box) box.innerHTML=posted+stat;
  }catch(e){}
  loadHomeSales();
}
function renderAttnForm(){
  const wrap=document.getElementById('attnForm'); const sel=document.getElementById('attn_for'); if(!wrap) return;
  const admin=(typeof can==='function'&&can('setup')); wrap.style.display=admin?'':'none';
  if(sel){ const cur=sel.value; const users=[...((state.auth&&state.auth.users)||[])].sort((a,b)=>(a.name||'').localeCompare(b.name||'')); sel.innerHTML=`<option value="">Everyone</option>`+users.map(u=>`<option value="${u.id}">${esc(u.name||'')}</option>`).join(''); sel.value=cur||''; }
}
function addAttention(){
  if(!requireCap('setup'))return;
  const ti=document.getElementById('attn_text'); const text=(ti&&ti.value||'').trim(); if(!text){ if(ti)ti.focus(); return; }
  const sel=document.getElementById('attn_for'); const forId=sel?sel.value:''; const forU=((state.auth&&state.auth.users)||[]).find(u=>u.id===forId);
  if(!state.attention)state.attention=[];
  state.attention.push({id:uid(),text,tone:'amber',forId:forId||'',forName:forU?forU.name:'',byId:SESSION?SESSION.userId:'',byName:(authOn()&&SESSION)?SESSION.name:'',ts:Date.now(),_upd:Date.now()});
  if(ti)ti.value='';
  save('Posted an alert'+(forU?(' for '+forU.name):'')); refreshAll(); flash('Alert posted'+(forU?(' for '+forU.name):'')+'.');
}
function delAttention(id){
  const a=(state.attention||[]).find(x=>x.id===id); if(!a)return;
  const me=SESSION?SESSION.userId:null; if(!((typeof can==='function'&&can('setup'))||(me&&a.forId===me))){ flash('You can’t clear that.'); return; }
  state.attention=(state.attention||[]).filter(x=>x.id!==id); save('Cleared an alert'); refreshAll();
}
let _homeSalesAt=0,_homeSalesHTML='';
function homeSalesLoading(){ return [0,1,2,3].map(()=>`<div class="kpi"><div class="label">Today's sales</div><div class="val" style="color:var(--muted);font-size:19px">Loading…</div><div class="foot">&nbsp;</div></div>`).join(''); }
function homeChip(label,cur,prev){
  if(prev==null||!isFinite(prev)||(prev===0&&cur===0)) return `<span style="color:var(--muted)">${label} —</span>`;
  const up=cur>=prev,col=up?'var(--green)':'var(--red)',arrow=up?'▲':'▼';
  const pct=prev>0?Math.round(Math.abs(cur-prev)/prev*100):(cur>0?100:0);
  return `<span style="color:${col};font-weight:700;white-space:nowrap">${label} ${arrow}${pct}%</span>`;
}
function homeSalesCard(color,name,net,orders,prevW,prevY,clickable){
  const chips=isManager()?'':`<div style="margin-top:5px;display:flex;gap:12px;flex-wrap:wrap;font-size:12px;font-family:-apple-system,Segoe UI,sans-serif">${homeChip('wk',net,prevW)}${homeChip('yr',net,prevY)}</div>`;
  const click=clickable?` style="cursor:pointer" onclick="homeShowLocation('${String(name).replace(/'/g,"\\'")}')" title="Tap for the employee breakdown"`:'';
  const hint=clickable?`<div class="foot" style="opacity:.7">${orders} order${orders===1?'':'s'} today · tap for staff ▸</div>`:`<div class="foot">${orders} order${orders===1?'':'s'} today</div>`;
  return `<div class="kpi ${color}"${click}><div class="label">${esc(name)}</div><div class="val">${money(net)}</div>${chips}${hint}</div>`;
}
// Drill-down: per-employee transactions / sales / avg ticket for one location today.
let _salesDayCache=null,_salesDayAt=0,_salesDayOpen='';
async function homeShowLocation(name){
  const box=document.getElementById('homeSalesDetail'); if(!box) return;
  if(_salesDayOpen===name){ _salesDayOpen=''; box.innerHTML=''; return; } // tap again to close
  _salesDayOpen=name;
  box.innerHTML=`<div class="card"><div class="hint">Loading ${esc(name)} employee breakdown…</div></div>`;
  try{
    if(!_salesDayCache || (Date.now()-_salesDayAt)>60000){
      const r=await fetch('/api/sales/day',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})});
      _salesDayCache=await r.json().catch(()=>null); _salesDayAt=Date.now();
    }
    if(_salesDayOpen!==name) return; // user tapped elsewhere while loading
    const rows=(_salesDayCache&&_salesDayCache.ok&&_salesDayCache.rows)||[];
    const norm=s=>String(s||'').trim().toLowerCase();
    const row=rows.find(x=>norm(x.location)===norm(name)) || rows.find(x=>x.location===name);
    if(!row){ box.innerHTML=`<div class="card"><div class="hint">No Square employee data for <b>${esc(name)}</b> today${(_salesDayCache&&!_salesDayCache.ok)?' — '+esc(_salesDayCache.detail||'Square unavailable'):''}.</div></div>`; return; }
    const emps=(row.employees||[]);
    const rowsHtml=emps.length?emps.map(e=>`<tr><td>${esc(e.name)}</td><td class="num">${e.txns}</td><td class="num">${money((e.salesCents||0)/100)}</td><td class="num" style="font-weight:700">${money((e.avgCents||0)/100)}</td></tr>`).join(''):`<tr><td colspan="4" style="color:var(--muted)">No attributed transactions yet.</td></tr>`;
    box.innerHTML=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><h3 style="margin:0">${esc(name)} — today</h3><button class="link noprint" onclick="homeShowLocation('${String(name).replace(/'/g,"\\'")}')">Close</button></div>
      <div class="hint" style="margin:4px 0 8px">${money(row.sales/100)} collected · ${row.txns} transaction${row.txns===1?'':'s'}. Average ticket excludes tips.</div>
      <div class="tablewrap"><table><thead><tr><th>Employee</th><th class="num">Transactions</th><th class="num">Sales</th><th class="num">Avg ticket</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></div>`;
  }catch(e){ if(_salesDayOpen===name) box.innerHTML=`<div class="card"><div class="hint">Could not load the breakdown: ${esc(e&&e.message||e)}</div></div>`; }
}
function homeErrCard(color,label,msg){ return `<div class="kpi ${color}"><div class="label">${label}</div><div class="val">—</div><div class="foot">${msg}</div></div>`; }
async function loadHomeSales(force){
  const box=document.getElementById('homeKpis'); if(!box) return;
  const fresh=(Date.now()-_homeSalesAt)<60000;
  if(_homeSalesHTML && fresh && !force){ box.innerHTML=_homeSalesHTML; return; }
  if(!_homeSalesHTML) box.innerHTML=homeSalesLoading();
  const _d=new Date(), pad=n=>String(n).padStart(2,'0'), dstr=x=>x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate());
  const today=dstr(_d), nowISO=_d.toISOString();
  const wk=new Date(_d); wk.setDate(_d.getDate()-7); const wkday=dstr(wk), wkISO=wk.toISOString();
  const ly=new Date(_d); ly.setDate(_d.getDate()-364); const lyday=dstr(ly), lyISO=ly.toISOString();
  const P=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json()).catch(()=>null);
  let sq=null,sqW=null,sqY=null,sh=null,shW=null,shY=null;
  try{ [sq,sqW,sqY,sh,shW,shY]=await Promise.all([
    P('/api/square/summary',{startDate:today,endDate:today,endCapISO:nowISO}),
    P('/api/square/summary',{startDate:wkday,endDate:wkday,endCapISO:wkISO}),
    P('/api/square/summary',{startDate:lyday,endDate:lyday,endCapISO:lyISO}),
    P('/api/shopify/summary',{startDate:today,endDate:today,endCapISO:nowISO}),
    P('/api/shopify/summary',{startDate:wkday,endDate:wkday,endCapISO:wkISO}),
    P('/api/shopify/summary',{startDate:lyday,endDate:lyday,endCapISO:lyISO}),
  ]); }catch(e){}
  const blankBO=l=>/back\s*-?\s*office/i.test(l.name||'')&&!l.orderCount&&!(+l.netSales)&&!(+l.tax);
  const mapOf=d=>{ const m={}; if(d&&!d.error){ (d.accounts||[]).filter(a=>a.ok).forEach(a=>{ (a.locations||[]).filter(l=>!blankBO(l)).forEach(l=>{ m[l.name]=(m[l.name]||0)+(+l.netSales||0); }); }); } return m; };
  const wMap=mapOf(sqW), yMap=mapOf(sqY);
  const cards=[], colors=['copper','green','blue','ky'];
  if(sq&&!sq.error){
    const rows=[]; (sq.accounts||[]).filter(a=>a.ok).forEach(a=>{ (a.locations||[]).filter(l=>!blankBO(l)).forEach(l=>{ rows.push({name:l.name,net:+l.netSales||0,orders:+l.orderCount||0}); }); });
    rows.sort((x,y)=>y.net-x.net);
    if(rows.length) rows.forEach((r,i)=>cards.push(homeSalesCard(colors[i%colors.length],r.name,r.net,r.orders,(r.name in wMap)?wMap[r.name]:null,(r.name in yMap)?yMap[r.name]:null,true)));
    else cards.push(homeSalesCard('copper','Store sales',0,0,null,null));
  } else cards.push(homeErrCard('copper','Store sales',(sq&&(sq.detail||sq.error))?'Square unavailable':'Connect Square in Setup'));
  if(sh&&sh.ok) cards.push(homeSalesCard('amber','Shopify (online)',+sh.net||0,sh.orders||0,(shW&&shW.ok)?(+shW.net||0):null,(shY&&shY.ok)?(+shY.net||0):null));
  else cards.push(homeErrCard('amber','Shopify (online)',(sh&&sh.detail)?'Shopify unavailable':'Connect Shopify'));
  _homeSalesHTML=cards.join(''); _homeSalesAt=Date.now(); box.innerHTML=_homeSalesHTML;
}
/* ---- Team tasks (assign to a teammate; they see it on Home and check it off) ---- */
function renderTasks(){
  const sel=document.getElementById('task_for'); const list=document.getElementById('taskList'); if(!list) return;
  const users=[...((state.auth&&state.auth.users)||[])].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const me=SESSION?SESSION.userId:null;
  if(sel){
    const cur=sel.value;
    sel.innerHTML = authOn()
      ? `<option value="">— Assign to…</option>`+users.map(u=>`<option value="${u.id}">${esc(u.name||'')}${me&&u.id===me?' (me)':''}</option>`).join('')
      : `<option value="">Anyone</option>`;
    sel.value=cur||''; // start blank; keep any in-progress choice across re-renders
  }
  const tasks=(state.tasks||[]).filter(t=>!t.done);
  const mine = (authOn()&&me) ? tasks.filter(t=>t.forId===me) : tasks.slice();
  const out  = (authOn()&&me) ? tasks.filter(t=>t.byId===me && t.forId!==me) : [];
  const spri=arr=>arr.sort((a,b)=>((b.priority?1:0)-(a.priority?1:0))||((a.ts||0)-(b.ts||0))); spri(mine); spri(out);
  const lbl=t=>`<div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:700;font-family:-apple-system,Segoe UI,sans-serif;margin:0 0 6px">${t}</div>`;
  let html='';
  if(!mine.length && !out.length){ html='<div class="empty" style="padding:20px">No open tasks — assign one above.</div>'; }
  else {
    if(mine.length){ html+=lbl(authOn()?'For you':'Open tasks')+mine.map(t=>taskRow(t,true)).join(''); }
    if(out.length){ html+=`<div style="height:8px"></div>`+lbl('Waiting on others')+out.map(t=>taskRow(t,false)).join(''); }
  }
  list.innerHTML=html;
}
function taskRow(t,canDone){
  const meta = canDone ? (t.byName?('from '+esc(t.byName)):'') : ('for '+esc(t.forName||'—'));
  const box = canDone
    ? `<button title="Mark done" onclick="completeTask('${t.id}')" style="flex:none;width:22px;height:22px;border-radius:6px;border:2px solid var(--copper);background:#fff;cursor:pointer"></button>`
    : `<span style="flex:none;width:22px;height:22px;border-radius:6px;border:2px dashed var(--line)"></span>`;
  const pri = t.priority ? `<span title="High priority" style="flex:none;color:var(--red);font-weight:800;font-size:14px">⚑</span>` : '';
  const rs = t.priority ? 'display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid var(--line);background:#fbecea;border-left:3px solid var(--red);border-radius:0 6px 6px 0;margin-bottom:3px' : 'display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)';
  return `<div style="${rs}">${box}${pri}<div style="flex:1"><div style="font-size:14.5px">${esc(t.text||'')}</div><div style="color:var(--muted);font-size:12px;font-family:-apple-system,Segoe UI,sans-serif">${meta}</div></div></div>`;
}
function addTask(){
  const ti=document.getElementById('task_text'); const text=(ti&&ti.value||'').trim();
  if(!text){ if(ti) ti.focus(); return; }
  const sel=document.getElementById('task_for'); const forId=sel?sel.value:'';
  if(authOn() && !forId){ flash('Choose who this task is for.'); if(sel) sel.focus(); return; }
  const forU=((state.auth&&state.auth.users)||[]).find(u=>u.id===forId);
  const pel=document.getElementById('task_pri'); const pri=!!(pel&&pel.checked);
  if(!state.tasks) state.tasks=[];
  state.tasks.push({id:uid(),text,forId:forId||'',forName:forU?forU.name:'Anyone',byId:SESSION?SESSION.userId:'',byName:SESSION?SESSION.name:'',priority:pri,ts:Date.now()});
  if(ti) ti.value=''; if(pel) pel.checked=false;
  save('Added task'+(forU?(' for '+forU.name):'')+' — '+text.slice(0,40)); refreshAll(); flash('Task added'+(forU?(' for '+forU.name):'')+'.');
}
function completeTask(id){
  const t=(state.tasks||[]).find(t=>t.id===id); if(!t)return;
  // Mark done (don't delete) and stamp it so "done" wins the cross-device merge —
  // otherwise another open device that still has the task adds it back.
  t.done=true; t.doneTs=Date.now(); t._upd=Date.now();
  save('Completed task — '+((t.text||'').slice(0,40))); refreshAll(); flash('Task completed.');
}
function uncompleteTask(id){
  const t=(state.tasks||[]).find(t=>t.id===id); if(!t)return;
  t.done=false; t.doneTs=null; t._upd=Date.now();
  save('Reopened task'); refreshAll();
}
/* ===================== Case Labels (master carton GS1-128) ===================== */
const C128=["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];

/* Build stamp set by JS — lets us confirm the NEW app code is actually running
   (not a stale cached copy). If the header shows "·js" the new JS is live. */
try{ const _bt=document.getElementById('buildTag'); if(_bt) _bt.textContent='v20260828d·js'; }catch(e){}
