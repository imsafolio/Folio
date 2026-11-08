import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signInWithEmailAndPassword,createUserWithEmailAndPassword,updateProfile,sendEmailVerification,signOut} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,collection,query,where,onSnapshot,addDoc,deleteDoc} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import {FIREBASE_CONFIG,CONFIG,CLASSES} from './config.js';

const CAP = CONFIG.CAP;
const configured = !!FIREBASE_CONFIG.apiKey;
let auth, db;
if (configured){ const app = initializeApp(FIREBASE_CONFIG); auth = getAuth(app); db = getFirestore(app); }

const SEV = {red:'Heavy',orange:'High',yellow:'Moderate',green:'Light'};
const COL = {red:'var(--red)',orange:'var(--orange)',yellow:'var(--yellow)',green:'var(--green)'};
const TYPES = ['Test','Assignment','Homework'];
const LV = {red:4,orange:3,yellow:2,green:1};
const meter = s => `<span class="meter" aria-hidden="true">${[1,2,3,4].map(n => `<i${n <= LV[s] ? ` style="background:${COL[s]}"` : ''}></i>`).join('')}</span>`;
const tally = ts => ts.slice(0,8).map(t => `<i style="background:${COL[t.sev] || 'var(--muted)'}"></i>`).join('');

// Theme: follows the system until someone picks one, then remembers it.
const html = document.documentElement, dark = matchMedia('(prefers-color-scheme: dark)');
const theme = () => html.dataset.theme || (dark.matches ? 'dark' : 'light');
const themeBtn = () => `<button class="link" data-theme-toggle>${theme() === 'dark' ? 'Light mode' : 'Dark mode'}</button>`;
dark.addEventListener('change', () => { if (!html.dataset.theme) render(); });
document.addEventListener('click', e => {
  if (!e.target.closest('[data-theme-toggle]')) return;
  html.dataset.theme = theme() === 'dark' ? 'light' : 'dark';
  try{ localStorage.setItem('folio-theme', html.dataset.theme); }catch(_){}
  render();
});
const cname = id => CLASSES.find(c => c.id === id) || {id,name:id,teacher:''};
const pad = n => String(n).padStart(2,'0');
const iso = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const TODAY = iso(new Date());
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = (s,o) => parse(s).toLocaleDateString('en-US',o);
const $ = id => document.getElementById(id);
const KEEP = ['ttl','typ','sev','cvurl','cvtok'];
const initials = n => (n||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
const MSG = {'auth/invalid-credential':'Wrong email or password.','auth/email-already-in-use':'An account with that email already exists. Sign in instead.','auth/weak-password':'Use a password with at least 6 characters.','auth/popup-closed-by-user':'The sign-in window was closed. Try again.','auth/too-many-requests':'Too many attempts. Wait a minute and try again.','auth/unauthorized-domain':'Add this site’s address under Authorized domains in Firebase Authentication settings.','permission-denied':'You don’t have permission to do that.'};
const friendly = e => MSG[e.code] || ('Something went wrong: ' + (e.message || e));

const S = {authRole:'student',wantTeacher:false,needTeacher:false,request:null,canvas:{items:[],show:true,msg:''},ready:false,user:null,profile:null,teacher:null,tasks:[],view:'dash',authTab:'in',flash:'',signupName:'',msg:'',
  month:new Date(new Date().getFullYear(), new Date().getMonth(), 1), sel:TODAY};
const byDate = d => S.tasks.filter(t => t.date === d);
/* Heavy = tests/quizzes or Heavy (red) severity. Only these count toward the suggested cap. */
const isHeavy = t => t.sev === 'red' || t.type === 'Test';
const gradesOf = id => (CLASSES.find(c => c.id === id) || {}).grades || [];
const sharesGrade = (a,b) => { const x = gradesOf(a), y = gradesOf(b); return !x.length || !y.length || x.some(g => y.includes(g)); };
const relevantOn = (d,cls) => byDate(d).filter(t => sharesGrade(t.cls,cls));
const heavyOn = (d,cls) => relevantOn(d,cls).filter(isHeavy);
const overMsg = (n,d) => n+' heavy item'+(n===1?'':'s')+' (tests, quizzes or Heavy severity) already '+(n===1?'falls':'fall')+' on '+fmt(d,{weekday:'long',month:'short',day:'numeric'})+' for these students. The suggested limit is '+CAP+'.\n\nAre you sure you want to go over it?';
const heaviest = ts => ['red','orange','yellow','green'].find(s => ts.some(t => t.sev === s));
const setErr = (m,ok) => { const e = $('err'); if (e){ e.textContent = m; e.style.color = ok ? 'var(--green)' : ''; } };
const logoMark = () => `<span class="mark" aria-hidden="true"><i style="height:9px;background:var(--green)"></i><i style="height:14px;background:var(--yellow)"></i><i style="height:20px;background:var(--orange)"></i><i style="height:12px;background:var(--red)"></i></span>`;
function relLabel(d){
  if (d === TODAY) return 'Today';
  if (d === iso(addDays(new Date(),1))) return 'Tomorrow';
  return fmt(d,{weekday:'long',month:'short',day:'numeric'});
}

/* ===== Views ===== */
const setupView = () => `<div class="auth"><h1>Connect Firebase</h1><p class="sub" style="margin:0">Paste your Firebase config into <b>FIREBASE_CONFIG</b> at the top of the script to turn on accounts and the shared calendar.</p></div>`;
function authView(){
  const t = S.authRole === 'teacher', email = !!CONFIG.EMAIL_LOGIN, up = S.authTab === 'up', f = S.flash; S.flash = '';
  const form = email ? `<div class="or">or use email</div>
  <form id="authForm">
    ${up?`<label class="f" for="nm">Full name</label><input type="text" id="nm" autocomplete="name" required>`:''}
    <label class="f" for="em">School email</label><input type="email" id="em" autocomplete="email" required>
    <label class="f" for="pw">Password</label><input type="password" id="pw" autocomplete="${up?'new-password':'current-password'}" minlength="6" required>
    <button class="btn" type="submit">${up?'Create account':'Sign in'}</button>
  </form>
  <div class="swap">${up?'Already have an account?':'New here?'} <button class="link" id="swap">${up?'Sign in':'Create an account'}</button></div>` : '';
  const hot = '<i style="background:var(--red)"></i>', ok = '<i style="background:var(--green)"></i>', mid = '<i style="background:var(--yellow)"></i>';
  return `<div class="auth wide"><div class="pitch"><h2>Three tests on one Thursday is a scheduling problem.</h2>
    <p>Teachers see how many heavy items a day already has for their students before adding another. Students see every class’s work in one list.</p>
    <div class="sample" role="img" aria-label="Example week: Thursday has three heavy items"><div><b>Mon</b><span class="tally">${ok}${mid}</span></div><div><b>Tue</b><span class="tally">${mid}</span></div><div><b>Wed</b><span class="tally">${ok}</span></div><div class="hot"><b>Thu</b><span class="tally">${hot}${hot}${hot}</span></div><div><b>Fri</b><span class="tally">${ok}${ok}</span></div></div>
    <div class="meta">Example week. Each block is one task.</div></div>
  <div class="signin"><div class="logo">${logoMark()}Folio</div>
  <div class="tabs"><button data-role="student" aria-pressed="${!t}">Student</button><button data-role="teacher" aria-pressed="${t}">Teacher</button></div>
  <h1>${t?'Teacher sign in':'Sign in'}</h1>
  <p class="sub" style="margin-bottom:22px">${t?'Post tests, assignments and homework for your class. Use your school Google account.':'Tests and assignments from every class, in date order.'}</p>
  <button class="btn alt" id="gbtn" type="button" style="margin:0">Continue with Google</button>
  ${form}<div class="warn" id="err" role="alert">${esc(f)}</div><div class="swap">${themeBtn()}</div></div></div>`;
}
const verifyView = () => `<div class="auth"><h1>Verify your email</h1><p class="sub">We sent a link to <b>${esc(S.user.email)}</b>. Open it, then come back and continue. Check your spam or junk folder too, since school filters sometimes hold it back.</p>
  <div class="warn" id="err" role="alert"></div><button class="btn" id="vdone">I’ve verified</button><button class="btn alt" id="vresend">Resend email</button><button class="btn alt" id="vout">Sign out</button></div>`;

function taskRow(t, o={}){
  const c = cname(t.cls), isDone = !!S.profile.done[t.id];
  return `<div class="task ${isDone&&!o.plain?'done':''}">
    ${o.plain ? '' : `<input type="checkbox" data-done="${t.id}" ${isDone?'checked':''} aria-label="Mark ${esc(t.title)} done">`}
    <div class="grow"><div class="tt">${esc(t.title)}</div><div class="meta">${esc(c.name)} · ${esc(t.type)}${o.plain&&c.teacher?' · '+esc(c.teacher):''}</div></div>
    <span class="sev">${LV[t.sev] ? meter(t.sev) : ''}${SEV[t.sev]||''}</span>
    ${o.del ? `<button class="x" data-del="${t.id}" aria-label="Delete ${esc(t.title)}">\u00d7</button>` : ''}</div>`;
}
function dashView(){
  const fl = S.profile.filter; const cv = S.canvas.show ? S.canvas.items.filter(x => !cvClass(x) || fl.includes(cvClass(x))) : [];
  const days = Array.from({length:7},(_,i)=>iso(addDays(new Date(),i)));
  const strip = days.map(d => { const ts = byDate(d).filter(t=>fl.includes(t.cls)), h = heaviest(ts);
    return `<div class="wd${d===TODAY?' today':''}"><b>${fmt(d,{weekday:'short'})}</b><span class="n2">${ts.length + cv.filter(x=>x.date===d).length}</span><span class="tally" aria-hidden="true">${tally(ts)}</span></div>`; }).join('');
  const list = [...S.tasks.filter(t=>fl.includes(t.cls)), ...cv].sort((a,b)=>a.date.localeCompare(b.date));
  const g = {}; list.forEach(t => (g[t.date] = g[t.date] || []).push(t));
  const body = Object.keys(g).length ? Object.keys(g).map(d=>`<div class="dayhead">${relLabel(d)}</div>${g[d].map(t=>t.canvas?cvRow(t):taskRow(t)).join('')}`).join('')
    : `<div class="empty">Nothing due for the classes you picked. Select more classes on the left, or check back once your teachers post work.</div>`;
  return `<h1>What’s due</h1><p class="sub">Pick your classes once. The list shows what those teachers have posted.</p>
  <div class="layout"><aside class="side"><h2>My classes</h2>
    ${CLASSES.map(c=>`<label class="cls"><input type="checkbox" data-cls="${c.id}" ${fl.includes(c.id)?'checked':''}><span>${c.name}<small>${c.teacher}</small></span></label>`).join('')}
  ${canvasPanel()}</aside><section><h2>Next 7 days</h2><div class="week">${strip}</div>${body}</section></div>`;
}
function calView(){
  const y = S.month.getFullYear(), m = S.month.getMonth();
  const start = addDays(new Date(y,m,1), -new Date(y,m,1).getDay());
  let cells = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="dow">${d}</div>`).join('');
  for (let i=0;i<42;i++){
    const d = addDays(start,i), k = iso(d), ts = relevantOn(k,S.teacher.cls), hv = ts.filter(isHeavy).length;
    cells += `<button class="cell ${d.getMonth()!==m?'out':''} ${k===S.sel?'sel':''} ${k===TODAY?'today':''} ${hv>=CAP?'full':''}" data-day="${k}" ${k<TODAY?'disabled':''} aria-label="${fmt(k,{weekday:'long',month:'long',day:'numeric'})}, ${ts.length} tasks, ${hv} of ${CAP} heavy">
      <span class="n">${d.getDate()}</span><span class="foot"><span class="tally" aria-hidden="true">${tally(ts)}</span>${hv?`<span class="cnt">${hv}/${CAP} heavy</span>`:''}</span></button>`;
  }
  const ts = relevantOn(S.sel,S.teacher.cls), hv = ts.filter(isHeavy).length, full = hv >= CAP; let next = '';
  if (full) for (let i=1;i<60;i++){ const k = iso(addDays(parse(S.sel),i)); if (heavyOn(k,S.teacher.cls).length < CAP){ next = k; break; } }
  const c = cname(S.teacher.cls);
  return `<h1>Calendar</h1><p class="sub">Aim for no more than ${CAP} heavy items a day (tests, quizzes, or Heavy severity) for the same students. Homework and lighter work don’t count toward it. It’s a suggestion, so you can go over when you need to.</p>
  <div class="layout" style="grid-template-columns:1fr 320px;gap:40px"><section>
    <div class="cal-head"><button class="ib" data-nav="-1" aria-label="Previous month">\u2039</button><h2>${S.month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><button class="ib" data-nav="1" aria-label="Next month">\u203a</button></div>
    <div class="grid">${cells}</div>
    <div class="legend">${Object.keys(SEV).map(s=>`<span>${meter(s)}${SEV[s]}</span>`).join('')}<span>Shaded day = ${CAP}+ heavy items</span></div>
    ${canvasTeacher()}
  </section><aside class="day">
    <h2>${fmt(S.sel,{weekday:'long',month:'long',day:'numeric'})}</h2><div class="meta">${hv} of ${CAP} heavy items · ${ts.length} total</div>
    ${ts.length ? ts.map(t=>taskRow(t,{plain:true,del:t.owner===S.user.uid})).join('') : '<div class="empty" style="padding:16px 0">No work posted yet.</div>'}
    <label class="f" for="ttl">Add for ${esc(c.name)}</label><input type="text" id="ttl" maxlength="60" placeholder="e.g. Chapter 5 quiz">
    <div class="row"><div><label class="f" for="typ">Type</label><select id="typ">${TYPES.map(t=>`<option>${t}</option>`).join('')}</select></div>
    <div><label class="f" for="sev">Severity</label><select id="sev">${Object.keys(SEV).map(s=>`<option value="${s}">${SEV[s]}</option>`).join('')}</select></div></div>
    ${full?`<div class="warn">This day already has ${hv} heavy items. If you add another test, quiz or Heavy item, you’ll be asked to confirm. ${next?`<button class="link" data-jump="${next}">Try ${fmt(next,{weekday:'short',month:'short',day:'numeric'})}</button>, which has room.`:''}</div>`:''}
    ${S.msg?`<div class="warn">${esc(S.msg)}</div>`:''}
    <button class="btn" id="add">Add to calendar</button>
  </aside></div>`;
}


/* ===== Canvas ===== */
const ck = s => String(s).replace(/[^a-z0-9]/gi,'').toLowerCase();
const cvClass = x => {
  const m = S.profile.cvmap || {}, k = ck(x.course);
  if (k in m) return m[k];
  const l = String(x.course).toLowerCase(), g = CLASSES.find(c => l.includes(c.name.toLowerCase()) || (c.id.length > 3 && l.includes(c.id)));
  return g ? g.id : '';
};
const cvDone = t => (t.id in S.profile.done) ? S.profile.done[t.id] : !!t.done;
const saveCv = () => setDoc(doc(db,'users',S.user.uid),{canvasItems:S.canvas.items},{merge:true}).catch(() => {});
const cvRow = t => { const d = cvDone(t), c = cvClass(t);
  return `<div class="task ${d?'done':''}"><input type="checkbox" data-done="${esc(t.id)}" ${d?'checked':''} aria-label="Mark ${esc(t.title)} done"><div class="grow"><div class="tt">${esc(t.title)}</div><div class="meta">${esc(c?cname(c).name:t.course)} · ${t.type} · From Canvas</div></div><span class="sev"><i class="dot" style="--c:var(--muted)"></i>Canvas</span></div>`; };
function canvasConnectForm(){
  return `<label class="f" for="cvfile" style="margin-top:0">Upload your Canvas calendar file</label>
    <input type="file" id="cvfile" accept=".ics,text/calendar">
    <p class="meta" style="margin-top:8px">In Canvas, open Calendar and click “Calendar Feed” to copy its link. Paste the link into a new browser tab to download the file, then upload it here. The file is read in your browser only.</p>
    <details><summary>Advanced: sync with an access token</summary>
      <label class="f" for="cvurl">Canvas address</label><input type="text" id="cvurl" placeholder="https://yourschool.instructure.com" value="${esc(S.profile.canvasUrl||'')}">
      <label class="f" for="cvtok">Access token</label><input type="password" id="cvtok" autocomplete="off">
      <button class="btn" id="cvsync" style="margin-top:12px">Sync from Canvas</button>
      <p class="meta" style="margin-top:10px">The token stays in this tab and is never saved. Some schools block this.</p></details>`;
}
function canvasPanel(){
  const c = S.canvas, n = c.items.length; let body;
  if (!n) body = canvasConnectForm();
  else {
    const courses = [...new Set(c.items.map(x => x.course))];
    body = `<label class="cls"><input type="checkbox" id="cvshow" ${c.show?'checked':''}><span>Show Canvas items<small>${n} loaded</small></span></label>
      <p class="meta" style="margin:10px 0 0">Match each Canvas course to a Folio class so your class filter works:</p>`
      + courses.map(co => { const sel = cvClass({course:co});
          return `<label class="f" style="margin-top:10px">${esc(co)}</label><select data-cvmap="${esc(co)}"><option value="">Not one of my Folio classes</option>${CLASSES.map(k=>`<option value="${k.id}" ${k.id===sel?'selected':''}>${esc(k.name)}</option>`).join('')}</select>`; }).join('')
      + `<button class="link" id="cvoff" style="margin-top:12px">Clear Canvas data</button>`;
  }
  return `<h2 style="margin-top:32px">Canvas</h2>${body}${c.msg?`<div class="warn">${esc(c.msg)}</div>`:''}`;
}
function canvasTeacher(){
  const c = S.canvas, mine = S.teacher.cls; let body;
  if (!c.items.length) body = canvasConnectForm();
  else {
    const todo = c.items.filter(x => !S.tasks.some(t => t.cls === mine && t.title === x.title && t.date === x.date));
    body = (todo.length
      ? `<div class="row" style="align-items:end"><div><label class="f" for="cvsev" style="margin-top:0">Severity for imports</label><select id="cvsev">${Object.keys(SEV).map(s=>`<option value="${s}" ${s==='yellow'?'selected':''}>${SEV[s]}</option>`).join('')}</select></div>
        <button class="btn" id="cvall" style="margin-top:0">Add all (${todo.length})</button></div>`
        + todo.map(x => `<div class="task"><div class="grow"><div class="tt">${esc(x.title)}</div><div class="meta">${fmt(x.date,{weekday:'short',month:'short',day:'numeric'})} · ${esc(x.course)}</div></div><button class="link" data-imp="${esc(x.id)}">Add</button></div>`).join('')
      : `<div class="empty" style="padding:12px 0">Everything from Canvas is already on the calendar.</div>`)
      + `<button class="link" id="cvoff" style="margin-top:10px">Clear Canvas data</button>`;
  }
  return `<div style="margin-top:36px"><h2>Import from Canvas</h2>${body}${c.msg?`<div class="warn">${esc(c.msg)}</div>`:''}</div>`;
}
function parseICS(text){
  const lines = text.replace(/\r?\n[ \t]/g,'').split(/\r?\n/), out = [], end = iso(addDays(new Date(),60)); let ev = null;
  for (const ln of lines){
    if (ln === 'BEGIN:VEVENT'){ ev = {}; continue; }
    if (ln === 'END:VEVENT'){
      if (ev && ev.date && ev.title && ev.date >= TODAY && ev.date <= end){
        const m = ev.title.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
        out.push({canvas:true, id:'cv'+(ev.uid||ev.title+ev.date).replace(/[^a-z0-9]/gi,''), date:ev.date, title:m?m[1]:ev.title, course:m?m[2]:'Canvas',
          type:/quiz|test|exam/i.test(ev.title)?'Test':'Assignment', done:false});
      }
      ev = null; continue;
    }
    if (!ev) continue;
    const i = ln.indexOf(':'); if (i < 0) continue;
    const key = ln.slice(0,i).split(';')[0], val = ln.slice(i+1);
    if (key === 'SUMMARY') ev.title = val.replace(/\\[nN]/g,' ').replace(/\\([,;\\])/g,'$1').trim();
    else if (key === 'UID') ev.uid = val;
    else if (key === 'DTSTART'){
      const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
      if (m) ev.date = m[7] ? iso(new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]))) : m[1]+'-'+m[2]+'-'+m[3];
    }
  }
  const seen = {}; return out.filter(x => !seen[x.id] && (seen[x.id] = 1)).sort((a,b) => a.date.localeCompare(b.date));
}
function loadICS(file){
  const rd = new FileReader();
  rd.onload = () => {
    try{ S.canvas.items = parseICS(String(rd.result)); saveCv(); S.canvas.msg = S.canvas.items.length ? '' : 'No upcoming items found in that file.'; }
    catch(e){ S.canvas.msg = 'That file couldn’t be read. Make sure it is the Canvas calendar (.ics) file.'; }
    render();
  };
  rd.readAsText(file);
}
async function importItems(list, sev){
  const base = {}, used = {}; let added = 0;
  const flags = list.map(x => {
    if (!isHeavy({sev,type:x.type})) return false;
    if (!(x.date in base)) base[x.date] = heavyOn(x.date,S.teacher.cls).length;
    const n = base[x.date] + (used[x.date]||0); used[x.date] = (used[x.date]||0) + 1;
    return n >= CAP;
  });
  const over = flags.filter(Boolean).length;
  if (over && !confirm(over+' of these '+list.length+' items would go past the suggested limit of '+CAP+' heavy items for their day.\n\nAdd them all anyway?')) return;
  for (let i = 0; i < list.length; i++){
    const x = list[i], t = {date:x.date,cls:S.teacher.cls,title:x.title,type:x.type,sev,owner:S.user.uid};
    if (flags[i]) t.overridden = true;
    try{ await addDoc(collection(db,'tasks'),t); added++; }
    catch(e){ S.canvas.msg = friendly(e); return render(); }
  }
  S.canvas.msg = 'Added '+added+(over?'. '+over+' went past the suggested '+CAP+' heavy items for their day.':'.'); render();
}

async function canvasFetch(url, token){
  const base = url.trim().replace(/\/+$/,'');
  if (!/^https:\/\//.test(base)) throw new Error('Enter your Canvas address starting with https://');
  let next = `${base}/api/v1/planner/items?start_date=${TODAY}&end_date=${iso(addDays(new Date(),60))}&per_page=100`, out = [];
  for (let i=0; i<5 && next; i++){
    const r = await fetch(next,{headers:{Authorization:'Bearer '+token}});
    if (!r.ok) throw new Error(r.status === 401 ? 'Canvas rejected the token. Generate a new one.' : 'Canvas returned an error ('+r.status+').');
    out.push(...await r.json());
    const m = (r.headers.get('Link')||'').match(/<([^>]+)>;\s*rel="next"/); next = m ? m[1] : null;
  }
  return out.filter(x => x.plannable_date && x.plannable && ['assignment','quiz','discussion_topic'].includes(x.plannable_type)).map(x => ({
    canvas:true, id:'cv'+x.plannable_id, date:iso(new Date(x.plannable_date)), title:x.plannable.title||'Untitled', course:x.context_name||'Canvas',
    type:x.plannable_type==='quiz'?'Test':'Assignment',
    done:!!((x.planner_override && x.planner_override.marked_complete) || (x.submissions && x.submissions.submitted))}));
}
async function syncCanvas(){
  const url = $('cvurl').value, tok = $('cvtok').value.trim();
  if (!url.trim() || !tok){ S.canvas.msg = 'Enter your Canvas address and token.'; return render(); }
  S.canvas.msg = 'Syncing…'; render();
  try{
    S.canvas.items = await canvasFetch(url,tok); S.canvas.msg = ''; saveCv();
    S.profile.canvasUrl = url.trim(); setDoc(doc(db,'users',S.user.uid),{canvasUrl:url.trim()},{merge:true});
    if (!S.canvas.items.length) S.canvas.msg = 'Connected, but nothing is due in the next 60 days.';
  }catch(e){ S.canvas.msg = e instanceof TypeError ? 'Couldn’t reach Canvas. Your school may block access from other websites.' : e.message; }
  render();
}

function render(){
  const root = $('root');
  if (!configured){ root.innerHTML = setupView(); return; }
  if (!S.ready || (S.user && S.user.emailVerified && !S.profile)){ root.innerHTML = '<div class="auth"><p class="sub" style="margin:0">Loading…</p></div>'; return; }
  if (!S.user){
    root.innerHTML = authView();
    if ($('authForm')) $('authForm').onsubmit = onAuthSubmit; $('gbtn').onclick = googleSignIn;
    document.querySelectorAll('[data-role]').forEach(b => b.onclick = () => { S.authRole = b.dataset.role; render(); });
    if ($('swap')) $('swap').onclick = () => { S.authTab = S.authTab==='in'?'up':'in'; render(); };
    return;
  }
  if (!S.user.emailVerified){
    root.innerHTML = verifyView();
    $('vout').onclick = () => signOut(auth);
    $('vresend').onclick = () => sendEmailVerification(S.user).then(()=>setErr('Sent. Check your inbox.',true)).catch(e=>setErr(friendly(e)));
    $('vdone').onclick = async () => {
      await auth.currentUser.reload(); await auth.currentUser.getIdToken(true);
      if (!auth.currentUser.emailVerified) return setErr('Not verified yet. Open the link in the email first.');
      S.user = auth.currentUser; S.profile = null; render(); startSession(S.user);
    };
    return;
  }
  if (S.needTeacher){
    const r = S.request;
    root.innerHTML = `<div class="auth"><h1>Teacher access</h1>
    ${r ? `<p class="sub">Your request for <b>${esc(cname(r.cls).name)}</b> was sent. Once it’s approved, sign out and sign back in to see the teacher calendar.</p>`
        : `<p class="sub">${esc(S.user.email)} isn’t set up as a teacher yet. Pick your class and request access. An admin will approve it.</p>
        <label class="f" for="reqcls">My class</label><select id="reqcls">${CLASSES.map(c=>`<option value="${c.id}">${esc(c.name)} (${esc(c.teacher)})</option>`).join('')}</select>
        <button class="btn" id="reqsend">Request teacher access</button>`}
    <div class="warn" id="err" role="alert"></div>
    <button class="btn alt" id="reqskip">Continue as a student</button><button class="btn alt" id="reqout">Sign out</button></div>`;
    if ($('reqsend')) $('reqsend').onclick = async () => {
      const d = {name:S.profile.name,email:S.user.email.toLowerCase(),cls:$('reqcls').value,uid:S.user.uid};
      try{ await setDoc(doc(db,'teacherRequests',d.email),d); S.request = d; render(); }catch(e){ setErr(friendly(e)); }
    };
    $('reqskip').onclick = () => { S.needTeacher = false; render(); };
    $('reqout').onclick = () => signOut(auth);
    return;
  }
  const keep = KEEP.map(id => $(id) ? $(id).value : null);
  const teacher = !!S.teacher; if (!teacher) S.view = 'dash';
  const p = S.profile;
  root.innerHTML = `<header><div class="bar"><div class="logo">${logoMark()}Folio</div>
    <nav>${teacher?`<button data-view="cal" aria-current="${S.view==='cal'?'page':'false'}">Calendar</button>`:''}<button data-view="dash" aria-current="${S.view==='dash'?'page':'false'}">${teacher?'Student view':'What’s due'}</button></nav>
    <div class="who"><div><b>${esc(p.name)}</b><small>${teacher?'Teacher · '+esc(cname(S.teacher.cls).name):'Student'}</small></div>
    <div class="av">${p.photo?`<img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer">`:esc(initials(p.name))}</div>
    ${themeBtn()}<button class="link" id="out">Sign out</button></div></div></header>
    <main>${S.view==='cal' && teacher ? calView() : dashView()}</main>`;
  $('out').onclick = () => signOut(auth);
  KEEP.forEach((id,i) => { if ($(id) && keep[i] !== null) $(id).value = keep[i]; });
}

/* ===== Auth + data ===== */
async function onAuthSubmit(e){ S.wantTeacher = S.authRole === 'teacher';
  e.preventDefault();
  const email = $('em').value.trim(), pw = $('pw').value;
  if (CONFIG.ALLOWED_DOMAIN && !email.toLowerCase().endsWith('@'+CONFIG.ALLOWED_DOMAIN)) return setErr('Use your school email (@'+CONFIG.ALLOWED_DOMAIN+').');
  try{
    if (S.authTab === 'up'){
      S.signupName = $('nm').value.trim();
      const c = await createUserWithEmailAndPassword(auth,email,pw);
      await updateProfile(c.user,{displayName:S.signupName}); await sendEmailVerification(c.user);
    } else await signInWithEmailAndPassword(auth,email,pw);
  }catch(err){ setErr(friendly(err)); }
}
async function googleSignIn(){ S.wantTeacher = S.authRole === 'teacher';
  const p = new GoogleAuthProvider();
  if (CONFIG.ALLOWED_DOMAIN) p.setCustomParameters({hd:CONFIG.ALLOWED_DOMAIN});
  try{ await signInWithPopup(auth,p); }catch(err){ setErr(friendly(err)); }
}
let unsub = null;
async function startSession(user){
  try{
    const email = user.email.toLowerCase();
    if (CONFIG.ALLOWED_DOMAIN && !email.endsWith('@'+CONFIG.ALLOWED_DOMAIN)){ S.flash = 'Use your school account (@'+CONFIG.ALLOWED_DOMAIN+').'; return signOut(auth); }
    const uref = doc(db,'users',user.uid); let snap = await getDoc(uref);
    if (!snap.exists()){
      await setDoc(uref,{name:S.signupName||user.displayName||email.split('@')[0],email,photo:user.photoURL||'',filter:CLASSES.map(c=>c.id),done:{}});
      snap = await getDoc(uref);
    }
    const p = snap.data(); p.filter = p.filter || CLASSES.map(c=>c.id); p.done = p.done || {}; p.cvmap = p.cvmap || {};
    S.profile = p; S.canvas.items = (p.canvasItems || []).filter(x => x.date >= TODAY);
    const t = await getDoc(doc(db,'teachers',email));
    S.teacher = t.exists() ? t.data() : null;
    S.needTeacher = false; S.request = null;
    if (!S.teacher && S.wantTeacher){ const r = await getDoc(doc(db,'teacherRequests',email)); S.request = r.exists() ? r.data() : null; S.needTeacher = true; }
    S.view = S.teacher ? 'cal' : 'dash';
    if (unsub) unsub();
    unsub = onSnapshot(query(collection(db,'tasks'),where('date','>=',TODAY)),
      s => { S.tasks = s.docs.map(d => ({id:d.id,...d.data()})); render(); },
      e => { S.msg = friendly(e); render(); });
    render();
  }catch(err){ S.flash = friendly(err); signOut(auth); }
}
if (configured) onAuthStateChanged(auth, user => {
  S.ready = true; S.user = user; S.profile = null; S.teacher = null;
  if (!user){ if (unsub){ unsub(); unsub = null; } S.tasks = []; S.canvas.items = []; S.canvas.msg = ''; S.wantTeacher = false; S.needTeacher = false; return render(); }
  render(); if (user.emailVerified) startSession(user);
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-view],[data-day],[data-nav],[data-del],[data-jump],[data-imp],#cvsync,#cvoff,#cvall,#add');
  if (!b || !S.profile) return;
  if (b.dataset.view) S.view = b.dataset.view;
  else if (b.dataset.day){ S.sel = b.dataset.day; S.msg=''; }
  else if (b.dataset.nav) S.month = new Date(S.month.getFullYear(), S.month.getMonth()+Number(b.dataset.nav), 1);
  else if (b.dataset.jump){ S.sel = b.dataset.jump; const d = parse(S.sel); S.month = new Date(d.getFullYear(), d.getMonth(), 1); S.msg=''; }
  else if (b.dataset.del){ deleteDoc(doc(db,'tasks',b.dataset.del)).catch(err => { S.msg = friendly(err); render(); }); return; }
  else if (b.id === 'cvsync'){ syncCanvas(); return; }
  else if (b.id === 'cvall'){ const mine = S.teacher.cls; importItems(S.canvas.items.filter(x => !S.tasks.some(t => t.cls === mine && t.title === x.title && t.date === x.date)), $('cvsev').value); return; }
  else if (b.id === 'cvoff'){ S.canvas.items = []; S.canvas.msg = ''; saveCv(); }
  else if (b.dataset.imp){
    const it = S.canvas.items.find(x => x.id === b.dataset.imp); if (!it) return;
    const nt = {date:it.date,cls:S.teacher.cls,title:it.title,type:it.type,sev:$('cvsev').value,owner:S.user.uid};
    const hn = heavyOn(nt.date,nt.cls).length;
    if (isHeavy(nt) && hn >= CAP){ if (!confirm(overMsg(hn,nt.date))) return; nt.overridden = true; }
    addDoc(collection(db,'tasks'),nt).catch(err => { S.msg = friendly(err); render(); });
    return;
  }
  else if (b.id === 'add'){
    const title = $('ttl').value.trim();
    if (!title){ S.msg = 'Add a title before saving.'; return render(); }
    const task = {date:S.sel,cls:S.teacher.cls,title,type:$('typ').value,sev:$('sev').value,owner:S.user.uid};
    const hn = heavyOn(S.sel,S.teacher.cls).length;
    if (isHeavy(task) && hn >= CAP){ if (!confirm(overMsg(hn,S.sel))) return; task.overridden = true; }
    $('ttl').value = ''; S.msg = '';
    addDoc(collection(db,'tasks'),task).catch(err => { S.msg = friendly(err); render(); });
    return;
  }
  render();
});
document.addEventListener('change', e => {
  const t = e.target; if (!S.profile) return;
  const uref = doc(db,'users',S.user.uid);
  if (t.dataset.done){ S.profile.done[t.dataset.done] = t.checked; setDoc(uref,{done:{[t.dataset.done]:t.checked}},{merge:true}); render(); }
  else if (t.dataset.cvmap !== undefined){ const k = ck(t.dataset.cvmap); S.profile.cvmap[k] = t.value; setDoc(uref,{cvmap:{[k]:t.value}},{merge:true}); render(); }
  else if (t.id === 'cvfile'){ if (t.files[0]) loadICS(t.files[0]); }
  else if (t.id === 'cvshow'){ S.canvas.show = t.checked; render(); }
  else if (t.dataset.cls){ const f = S.profile.filter, i = f.indexOf(t.dataset.cls); i>-1 ? f.splice(i,1) : f.push(t.dataset.cls); setDoc(uref,{filter:f},{merge:true}); render(); }
});
render();
