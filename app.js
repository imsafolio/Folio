import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signInWithEmailAndPassword,createUserWithEmailAndPassword,updateProfile,sendEmailVerification,signOut} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {getFirestore,doc,getDoc,getDocs,setDoc,collection,query,where,onSnapshot,addDoc,deleteDoc} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import {FIREBASE_CONFIG,CONFIG,CLASSES} from './config.js';

const CAP = CONFIG.CAP;
/* Overlap alert settings. Defaults apply if config.js doesn't set them. */
const THRESH = CONFIG.OVERLAP_THRESHOLD ?? 0.66;   // warn when this share of a class is already busy that day
const BUSY_AT = CONFIG.BUSY_AT ?? 1;               // a student is "busy" with this many heavy items already that day
const MIN_ENROLLED = CONFIG.MIN_ENROLLED ?? 5;     // below this many students in a class, fall back to the grade-level estimate
const configured = !!FIREBASE_CONFIG.apiKey;
let auth, db;
if (configured){ const app = initializeApp(FIREBASE_CONFIG); auth = getAuth(app); db = getFirestore(app); }

const COL = {red:'var(--red)',orange:'var(--orange)',yellow:'var(--yellow)',green:'var(--green)'};
const TYPES = ['Test','Assignment','Homework'];
/* Estimated student time outside class, in minutes. Teachers pick one per task. */
const DEFAULT_MINS = {Test:120,Assignment:60,Homework:30};
const MINS = [10,15,20,30,45,60,90,120,150,180,240];
const ANN_KINDS = ['Assembly','Schedule change','Event','Deadline','Update'];
const tally = ts => ts.slice(0,8).map(t => `<i style="background:${COL[loadLevel(taskMins(t))]}"></i>`).join('');

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
/* Course directory. Admins manage it in Firestore (courses). Until they add courses, the list in config.js is used. */
const courses = () => S.courses.length ? S.courses : CLASSES;
const cname = id => courses().find(c => c.id === id) || {id,name:id,teacher:''};
/* A teacher doc may list several classes in `classes`; older docs just have `cls`. */
const myClasses = t => (t && Array.isArray(t.classes) && t.classes.length) ? t.classes : (t && t.cls ? [t.cls] : []);
const teachLabel = t => { const n = myClasses(t).map(id => cname(id).name); return n.length > 2 ? n.slice(0,2).join(', ')+' +'+(n.length-2) : n.join(', '); };
const pad = n => String(n).padStart(2,'0');
const iso = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const TODAY = iso(new Date());
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = (s,o) => parse(s).toLocaleDateString('en-US',o);
const $ = id => document.getElementById(id);
const KEEP = ['ttl','typ','mins','cvurl','cvtok','atl','adt','akd','ant','tid','tlb','cid','cnm','ctc','cgr'];
const initials = n => (n||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
const MSG = {'auth/invalid-credential':'Wrong email or password.','auth/email-already-in-use':'An account with that email already exists. Sign in instead.','auth/weak-password':'Use a password with at least 6 characters.','auth/popup-closed-by-user':'The sign-in window was closed. Try again.','auth/too-many-requests':'Too many attempts. Wait a minute and try again.','auth/unauthorized-domain':'Add this site’s address under Authorized domains in Firebase Authentication settings.','permission-denied':'You don’t have permission to do that.'};
const friendly = e => MSG[e.code] || ('Something went wrong: ' + (e.message || e));

const S = {verif:[],courses:[],term:null,editClasses:false,dirMsg:'',tcls:'',ann:[],annErr:false,annMsg:'',admin:false,enroll:[],enrollErr:false,authRole:'student',wantTeacher:false,needTeacher:false,request:null,canvas:{items:[],show:true,msg:''},ready:false,user:null,profile:null,teacher:null,tasks:[],view:'dash',authTab:'in',flash:'',signupName:'',msg:'',
  month:new Date(new Date().getFullYear(), new Date().getMonth(), 1), sel:TODAY};
const byDate = d => S.tasks.filter(t => t.date === d);
/* Heavy = estimated 2+ hours outside class (tests by default). Only these count toward the suggested cap. No subjective ratings: everything comes from minutes. */
const HEAVY_TASK = CONFIG.HEAVY_TASK_MINS ?? 120;
const isHeavy = t => taskMins(t) >= HEAVY_TASK;
/* Workload score. A student's day is the sum of the estimated minutes of every task in their classes.
   Steps are [yellow, orange, red] starting points in minutes. Change them with CONFIG.LOAD_STEPS in config.js. */
const STEPS = CONFIG.LOAD_STEPS ?? [90,150,210];
const HEAVY_DAY = STEPS[1];   // a day at or above this counts as busy for the overlap alert
const loadLevel = m => m >= STEPS[2] ? 'red' : m >= STEPS[1] ? 'orange' : m >= STEPS[0] ? 'yellow' : 'green';
const fmtMin = m => m < 60 ? m+' min' : Math.floor(m/60)+' hr'+(m%60 ? ' '+(m%60)+' min' : '');
const fmtShort = m => m < 60 ? m+'m' : Math.floor(m/60)+'h'+(m%60 ? ' '+(m%60)+'m' : '');
/* Older tasks have no minutes, so guess from their type. */
const taskMins = t => Number.isFinite(t.mins) ? t.mins : (DEFAULT_MINS[t.type] || 30);
let lcTasks = null, lcMap = {};
const loadFor = (d,classes) => {
  if (lcTasks !== S.tasks){ lcTasks = S.tasks; lcMap = {}; S.tasks.forEach(t => { const m = lcMap[t.date] = lcMap[t.date] || {}; m[t.cls] = (m[t.cls]||0) + taskMins(t); }); }
  const m = lcMap[d]; return m ? classes.reduce((a,c) => a + (m[c]||0), 0) : 0;
};
const gradesOf = id => (courses().find(c => c.id === id) || {}).grades || [];
const sharesGrade = (a,b) => { const x = gradesOf(a), y = gradesOf(b); return !x.length || !y.length || x.some(g => y.includes(g)); };
/* Enrollment: each student publishes the classes they take (enrollments/{uid}).
   With enough students in a class, overlap is real. Otherwise we estimate by grade level. */
/* Once a semester is set, only enrollments confirmed for it count. */
const termOn = () => !!S.term;
const enrolledIn = cls => S.enroll.filter(e => e.classes.includes(cls) && (!S.term || e.term === S.term.id));
/* A teacher's check on a student: 'verified' or 'rejected'. No record yet = pending. */
const vstatus = (uid,cls) => { const v = S.verif.find(x => x.uid === uid && x.cls === cls && (!S.term || x.term === S.term.id)); return v ? v.status : 'pending'; };
/* Students a teacher removed don't count toward overlap. Pending and verified do. */
const roster = cls => enrolledIn(cls).filter(e => vstatus(e.id,cls) !== 'rejected');
let peerKey = null, peerCache = {};
const peers = cls => {
  if (peerKey !== S.enroll){ peerKey = S.enroll; peerCache = {}; }
  if (!(cls in peerCache)){
    const r = roster(cls);
    peerCache[cls] = r.length < MIN_ENROLLED ? null : new Set(r.flatMap(e => e.classes));
  }
  return peerCache[cls];
};
const relevantOn = (d,cls) => { const p = peers(cls); return byDate(d).filter(t => p ? p.has(t.cls) : sharesGrade(t.cls,cls)); };
const heavyOn = (d,cls) => relevantOn(d,cls).filter(isHeavy);
let hcTasks = null, hcMap = {};
const heavyFor = (d,classes) => {
  if (hcTasks !== S.tasks){ hcTasks = S.tasks; hcMap = {}; S.tasks.forEach(t => { if (isHeavy(t)){ const m = hcMap[t.date] = hcMap[t.date] || {}; m[t.cls] = (m[t.cls]||0) + 1; } }); }
  const m = hcMap[d]; return m ? classes.reduce((s,c) => s + (m[c]||0), 0) : 0;
};
/* Share of this class's students who already have a heavy item on d. Null = not enough enrollment data. */
const busy = (d,cls,add=0) => {
  const r = roster(cls); if (r.length < MIN_ENROLLED) return null;
  const n = r.filter(e => loadFor(d,e.classes) + add >= HEAVY_DAY).length;
  return {n,total:r.length,share:n/r.length};
};
const crowded = (d,cls) => { const b = busy(d,cls); return b ? b.share >= THRESH : heavyOn(d,cls).length >= CAP; };
const pct = x => Math.round(x*100)+'%';
/* Warning text if adding this task would crowd students, else ''. */
const overBy = t => {
  const m = t.mins || 0, b = busy(t.date,t.cls,m);
  if (b) return (m >= 30 || isHeavy(t)) && b.share >= THRESH ? shareMsg(b,t.date,m) : '';
  if (!isHeavy(t)) return '';
  const hn = heavyOn(t.date,t.cls).length;
  return hn >= CAP ? overMsg(hn,t.date) : '';
};
/* Announcements posted by administrators (assemblies, schedule changes, updates). */
const annOn = d => S.ann.filter(a => a.date === d);
const disrupted = d => S.ann.some(a => a.date === d && (a.kind === 'Assembly' || a.kind === 'Schedule change'));
/* Best day to move to: lowest overlap in the next three weeks, skipping weekends and assembly/schedule-change days. */
function suggestDay(from,cls){
  let best = '', score = Infinity;
  for (let i=1;i<=21;i++){
    const d = addDays(parse(from),i), dow = d.getDay(); if (dow === 0 || dow === 6) continue;
    const k = iso(d), b = busy(k,cls), s = b ? b.share : heavyOn(k,cls).length / CAP;
    if (disrupted(k)) continue;
    if (!crowded(k,cls) && s < score){ best = k; score = s; }
  }
  return best;
}
const shareMsg = (b,d,m) => b.n+' of '+b.total+' students in your class ('+pct(b.share)+') would have '+fmtMin(HEAVY_DAY)+' or more of work on '+fmt(d,{weekday:'long',month:'short',day:'numeric'})+' if you add this ('+fmtMin(m)+'). The alert starts at '+pct(THRESH)+'.\n\nAre you sure you want to add it?';
const overMsg = (n,d) => n+' heavy item'+(n===1?'':'s')+' (estimated '+fmtMin(HEAVY_TASK)+' or more outside class) already '+(n===1?'falls':'fall')+' on '+fmt(d,{weekday:'long',month:'short',day:'numeric'})+' for these students. The suggested limit is '+CAP+'.\n\nAre you sure you want to go over it?';
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
    <span class="sev">${fmtMin(taskMins(t))}</span>
    ${o.del ? `<button class="x" data-del="${t.id}" aria-label="Delete ${esc(t.title)}">\u00d7</button>` : ''}</div>`;
}
const annRow = (a,o={}) => `<div class="task"><div class="grow"><div class="tt">${esc(a.title)}</div><div class="meta">${esc(a.kind)}${o.date?' · '+esc(relLabel(a.date)):''}</div>${a.note?`<div class="meta">${esc(a.note)}</div>`:''}</div>${o.del?`<button class="x" data-anndel="${esc(a.id)}" aria-label="Delete ${esc(a.title)}">\u00d7</button>`:''}</div>`;
function annView(){
  const list = [...S.ann].sort((a,b) => a.date.localeCompare(b.date));
  const posted = S.annErr ? '<div class="warn">Couldn’t load announcements. Check the Firestore rules for the announcements collection.</div>'
    : list.length ? list.map(a => annRow(a,{date:true,del:true})).join('') : '<div class="empty">Nothing posted yet. Add the first one on the right.</div>';
  return `<h1>Announcements</h1><p class="sub">Post assemblies, schedule changes and other updates. Teachers see them on their calendar and in a list of what’s coming up, so nobody finds out the day before.</p>
  <div class="layout" style="grid-template-columns:1fr 320px;gap:40px"><section><h2>Posted</h2>${posted}</section>
  <aside class="day"><h2>New announcement</h2>
    <label class="f" for="adt">Date</label><input type="date" id="adt" value="${TODAY}" min="${TODAY}">
    <label class="f" for="akd">Type</label><select id="akd">${ANN_KINDS.map(k => `<option>${k}</option>`).join('')}</select>
    <label class="f" for="atl">Title</label><input type="text" id="atl" maxlength="80" placeholder="e.g. Spring assembly, periods 3 to 5 shortened">
    <label class="f" for="ant">Details (optional)</label><input type="text" id="ant" maxlength="200" placeholder="Anything teachers should plan around">
    ${S.annMsg?`<div class="warn">${esc(S.annMsg)}</div>`:''}
    <button class="btn" id="annadd">Post announcement</button>
  </aside></div>`;
}
/* Students see only the classes they confirmed for the current semester. Everyone else sees the full directory. */
const myList = () => termOn() && !S.teacher && !S.admin ? courses().filter(c => (S.profile.classes || []).includes(c.id)) : courses();
/* Shown at the start of each semester, and whenever a student chooses to change classes. */
function termView(){
  const first = S.profile.confirmedTerm !== S.term.id, cur = first ? [] : (S.profile.classes || []);
  const list = courses().filter(c => c.active !== false);
  return `<div class="auth"><h1>Confirm your classes</h1>
    <p class="sub">${esc(S.term.label)}. Pick the classes you’re taking this semester. Folio connects you to those teachers and shows only their work. Your teachers can see your name and that you’re in the class, and they confirm it.</p>
    ${list.length ? list.map(c => `<label class="cls"><input type="checkbox" data-pick="${esc(c.id)}" ${cur.includes(c.id)?'checked':''}><span>${esc(c.name)}<small>${esc(c.teacher)}</small></span></label>`).join('') : '<div class="empty">No classes have been added for this semester yet. Ask an administrator.</div>'}
    <div class="warn" id="err" role="alert">${esc(S.dirMsg)}</div>
    ${list.length ? '<button class="btn" id="termok">Confirm my classes</button>' : ''}
    ${first ? '' : '<button class="btn alt" id="termcancel">Cancel</button>'}
    <button class="btn alt" id="termout">Sign out</button></div>`;
}
/* Admin screen: set the current semester and manage the approved course list. */
function dirView(){
  const list = [...courses()].sort((a,b) => a.name.localeCompare(b.name));
  const seeded = S.courses.length > 0;
  return `<h1>Directory</h1><p class="sub">The semester and the classes students can pick from. When you start a new semester, every student is asked to confirm their classes again.</p>
  <div class="layout" style="grid-template-columns:1fr 320px;gap:40px"><section>
    <h2>Current semester</h2>
    <div class="meta" style="margin-bottom:6px">${S.term ? esc(S.term.label)+' ('+esc(S.term.id)+')' : 'None set. Students can pick any class until you set one.'}</div>
    <div class="row"><div><label class="f" for="tid">Short id</label><input type="text" id="tid" maxlength="20" placeholder="2026-fall" value="${S.term?esc(S.term.id):''}"></div>
    <div><label class="f" for="tlb">Name</label><input type="text" id="tlb" maxlength="40" placeholder="Fall 2026" value="${S.term?esc(S.term.label):''}"></div></div>
    <button class="btn" id="termset" style="width:auto">Set semester</button>
    <h2 style="margin-top:36px">Classes${seeded ? '' : ' (from config.js)'}</h2>
    ${seeded ? '' : `<div class="banner">These come from <b>config.js</b>. Copy them into the directory so you can edit them here. <button class="link" id="dirseed">Copy into directory</button></div>`}
    ${list.map(c => `<div class="task"><div class="grow"><div class="tt">${esc(c.name)}</div><div class="meta">${esc(c.teacher)} · id: ${esc(c.id)}${(c.grades||[]).length ? ' · grade '+c.grades.join(', ') : ''}${c.active===false ? ' · hidden' : ''}</div></div>${seeded ? `<button class="x" data-coursedel="${esc(c.id)}" aria-label="Remove ${esc(c.name)}">\u00d7</button>` : ''}</div>`).join('')}
  </section><aside class="day"><h2>Add a class</h2>
    <label class="f" for="cid">Short id</label><input type="text" id="cid" maxlength="20" placeholder="chem">
    <label class="f" for="cnm">Class name</label><input type="text" id="cnm" maxlength="80" placeholder="Chemistry: Inquiry">
    <label class="f" for="ctc">Teacher</label><input type="text" id="ctc" maxlength="60" placeholder="Dr. Smith">
    <label class="f" for="cgr">Grades (optional)</label><input type="text" id="cgr" maxlength="20" placeholder="10, 11">
    <button class="btn" id="courseadd">Add class</button>
    ${S.dirMsg ? `<div class="warn">${esc(S.dirMsg)}</div>` : ''}
  </aside></div>`;
}
/* Teacher screen: who is in each of my classes, with a verify or remove button per student. */
function rosterView(){
  const mine = myClasses(S.teacher), c = cname(S.tcls);
  const classBar = mine.length > 1 ? `<div style="max-width:320px;margin:0 0 28px"><label class="f" for="tcls" style="margin-top:0">Class</label><select id="tcls">${mine.map(id => `<option value="${esc(id)}" ${id===S.tcls?'selected':''}>${esc(cname(id).name)}</option>`).join('')}</select></div>` : '';
  const list = enrolledIn(S.tcls).map(e => ({e, st:vstatus(e.id,S.tcls)})).sort((a,b) => (a.e.name || '~').localeCompare(b.e.name || '~'));
  const n = k => list.filter(x => x.st === k).length;
  const COLS = {verified:'var(--green)',pending:'var(--yellow)',rejected:'var(--muted)'}, LBL = {verified:'Verified',pending:'Pending',rejected:'Removed'};
  const rows = list.map(({e,st}) => `<div class="task"><div class="grow"><div class="tt">${esc(e.name || 'Name not shared yet')}</div></div>
    <span class="sev"><i class="dot" style="--c:${COLS[st]}"></i>${LBL[st]}</span>
    ${st !== 'verified' ? `<button class="link" data-vf="${esc(e.id)}|${esc(S.tcls)}|verified">${st === 'rejected' ? 'Restore' : 'Verify'}</button>` : ''}
    ${st !== 'rejected' ? `<button class="x" data-vf="${esc(e.id)}|${esc(S.tcls)}|rejected" aria-label="Remove ${esc(e.name || 'student')} from this class">\u00d7</button>` : ''}</div>`).join('');
  const basis = S.term ? esc(S.term.label)+'.' : 'No semester is set yet, so this shows everyone who ever picked this class. Ask an administrator to set the semester.';
  return `<h1>Roster</h1><p class="sub">Students who picked ${esc(c.name)}. Verify the ones who are really in your class and remove anyone who isn’t. Removed students stop counting toward your overlap alerts. ${basis}</p>
  ${classBar}
  <div class="meta" style="margin-bottom:6px">${list.length} student${list.length === 1 ? '' : 's'} · ${n('verified')} verified · ${n('pending')} pending${n('rejected') ? ' · '+n('rejected')+' removed' : ''}</div>
  ${n('pending') ? '<button class="btn" id="vfall" style="width:auto;margin:6px 0 12px">Verify all pending</button>' : ''}
  ${S.msg ? `<div class="warn">${esc(S.msg)}</div>` : ''}
  ${S.enrollErr ? '<div class="warn">Couldn’t load class rosters. Check the Firestore rules for the enrollments collection.</div>' : list.length ? rows : '<div class="empty">Nobody has picked this class yet.</div>'}`;
}
/* Teacher screen: each student on my roster, and how heavy their next two weeks are across ALL their classes. */
function loadView(){
  const mine = myClasses(S.teacher), c = cname(S.tcls);
  const classBar = mine.length > 1 ? `<div style="max-width:320px;margin:0 0 28px"><label class="f" for="tcls" style="margin-top:0">Class</label><select id="tcls">${mine.map(id => `<option value="${esc(id)}" ${id===S.tcls?'selected':''}>${esc(cname(id).name)}</option>`).join('')}</select></div>` : '';
  const days = [];
  for (let i = 0; days.length < 10 && i < 30; i++){ const d = addDays(new Date(),i); if (d.getDay() !== 0 && d.getDay() !== 6) days.push(iso(d)); }
  const studs = roster(S.tcls).map(e => {
    const cells = days.map(d => ({d, m:loadFor(d,e.classes), ts:S.tasks.filter(t => t.date === d && e.classes.includes(t.cls))}));
    return {e, cells, peak:Math.max(0,...cells.map(x => x.m))};
  }).sort((a,b) => b.peak - a.peak || (a.e.name || '~').localeCompare(b.e.name || '~'));
  const total = studs.length, heavy = studs.filter(x => x.peak >= HEAVY_DAY).length;
  const sums = days.map((d,i) => studs.filter(x => x.cells[i].m >= HEAVY_DAY).length);
  const worst = total ? sums.indexOf(Math.max(...sums)) : -1;
  const head = worst >= 0 && sums[worst] ? 'Heaviest day: '+fmt(days[worst],{weekday:'long',month:'short',day:'numeric'})+', with '+sums[worst]+' of '+total+' students at '+fmtMin(HEAVY_DAY)+' or more.' : 'No student on this roster has a heavy day coming up.';
  const hdr = `<div class="hr hh"><div class="hn"></div>${days.map(d => `<div class="hd">${fmt(d,{weekday:'short'})}<br>${fmt(d,{month:'numeric',day:'numeric'})}</div>`).join('')}</div>`;
  const sumRow = `<div class="hr hs"><div class="hn">At ${fmtShort(HEAVY_DAY)} or more</div>${sums.map(n => `<div class="hd${total && n/total >= THRESH ? ' full' : ''}">${n}/${total}</div>`).join('')}</div>`;
  const rows = studs.map(({e,cells}) => `<div class="hr"><div class="hn">${esc(e.name || 'Name not shared yet')}</div>${cells.map(x => x.m
    ? `<div class="hd" style="--c:${COL[loadLevel(x.m)]}" title="${esc(x.ts.map(t => cname(t.cls).name+' · '+t.type+(Number.isFinite(t.mins) ? ' · '+fmtMin(t.mins) : '')).join('\n'))}">${fmtShort(x.m)}</div>`
    : '<div class="hd dim">–</div>').join('')}</div>`).join('');
  const steps = [['green','Under '+fmtShort(STEPS[0])],['yellow',fmtShort(STEPS[0])+' to '+fmtShort(STEPS[1])],['orange',fmtShort(STEPS[1])+' to '+fmtShort(STEPS[2])],['red',fmtShort(STEPS[2])+' or more']];
  return `<h1>Workload</h1><p class="sub">Students on your ${esc(c.name)} roster, with their work from every class added up by day. Removed students are left out. Hover a day to see what’s due.</p>
  ${classBar}
  <div class="meta" style="margin-bottom:14px"><b>${esc(head)}</b> ${heavy} of ${total} student${total === 1 ? '' : 's'} hit ${fmtMin(HEAVY_DAY)} or more on at least one day.</div>
  ${S.enrollErr ? '<div class="warn">Couldn’t load class rosters. Check the Firestore rules for the enrollments collection.</div>'
    : total ? `<div class="heat" style="--n:${days.length}">${hdr}${sumRow}${rows}</div>
  <div class="legend">${steps.map(([k,l]) => `<span><i class="dot" style="--c:${COL[k]}"></i>${l}</span>`).join('')}</div>`
    : '<div class="empty">Nobody is on this roster yet. Students show up once they confirm their classes.</div>'}`;
}
function dashView(){
  const fl = S.profile.filter; const cv = S.canvas.show ? S.canvas.items.filter(x => !cvClass(x) || fl.includes(cvClass(x))) : [];
  const days = Array.from({length:7},(_,i)=>iso(addDays(new Date(),i)));
  const strip = days.map(d => { const ts = byDate(d).filter(t=>fl.includes(t.cls)), h = null;
    return `<div class="wd${d===TODAY?' today':''}"><b>${fmt(d,{weekday:'short'})}</b><span class="n2">${ts.length + cv.filter(x=>x.date===d).length}</span><span class="tally" aria-hidden="true">${tally(ts)}</span>${ts.length ? `<span class="meta" style="display:flex;align-items:center;gap:5px;margin-top:8px"><i class="dot" style="--c:${COL[loadLevel(ts.reduce((a,t) => a + taskMins(t),0))]}"></i>${fmtMin(ts.reduce((a,t) => a + taskMins(t),0))}</span>` : ''}</div>`; }).join('');
  const list = [...S.tasks.filter(t=>fl.includes(t.cls)), ...cv].sort((a,b)=>a.date.localeCompare(b.date));
  const g = {}; list.forEach(t => (g[t.date] = g[t.date] || []).push(t));
  const body = Object.keys(g).length ? Object.keys(g).map(d=>`<div class="dayhead">${relLabel(d)}</div>${g[d].map(t=>t.canvas?cvRow(t):taskRow(t)).join('')}`).join('')
    : `<div class="empty">Nothing due for the classes you picked. Select more classes on the left, or check back once your teachers post work.</div>`;
  const rej = S.term ? S.verif.filter(v => v.status === 'rejected' && v.term === S.term.id) : [];
  const rejNote = rej.length ? `<div class="banner"><b>A teacher removed you from ${rej.map(v => esc(cname(v.cls).name)).join(', ')}.</b> If that’s a mistake, ask the teacher to restore you.</div>` : '';
  const nudge = !S.teacher && !S.admin && !S.profile.classesSet ? `<div class="banner"><b>Pick the classes you take.</b> Folio hides everything else, and your teachers can see how many students have a test on the same day so they can spread them out. Your teachers see your name and your class list, nothing else.</div>` : '';
  return `<h1>What’s due</h1><p class="sub">Pick your classes once. The list shows what those teachers have posted.</p>${rejNote}${nudge}
  <div class="layout"><aside class="side"><h2>My classes</h2>
    ${myList().map(c=>`<label class="cls"><input type="checkbox" data-cls="${esc(c.id)}" ${fl.includes(c.id)?'checked':''}><span>${esc(c.name)}<small>${esc(c.teacher)}</small></span></label>`).join('')}
    ${termOn() && !S.teacher && !S.admin ? `<p class="meta" style="margin:10px 0 0">${esc(S.term.label)}. <button class="link" data-editcls>Change my classes</button></p>` : ''}
  ${canvasPanel()}</aside><section><h2>Next 7 days</h2><div class="week">${strip}</div>${body}</section></div>`;
}
function calView(){
  const y = S.month.getFullYear(), m = S.month.getMonth();
  const start = addDays(new Date(y,m,1), -new Date(y,m,1).getDay());
  let cells = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="dow">${d}</div>`).join('');
  for (let i=0;i<42;i++){
    const d = addDays(start,i), k = iso(d), ts = relevantOn(k,S.tcls), hv = ts.filter(isHeavy).length, b = busy(k,S.tcls), full = crowded(k,S.tcls);
    const cnt = b ? (b.n ? pct(b.share)+' busy' : '') : (hv ? hv+'/'+CAP+' heavy' : '');
    cells += `<button class="cell ${d.getMonth()!==m?'out':''} ${k===S.sel?'sel':''} ${k===TODAY?'today':''} ${full?'full':''}" data-day="${k}" ${k<TODAY?'disabled':''} aria-label="${fmt(k,{weekday:'long',month:'long',day:'numeric'})}, ${ts.length} tasks, ${b ? b.n+' of '+b.total+' students busy' : hv+' of '+CAP+' heavy'}${annOn(k).length ? ', '+esc(annOn(k).map(a => a.kind+': '+a.title).join(', ')) : ''}">
      <span class="n">${d.getDate()}${annOn(k).length ? '<i class="annmark" aria-hidden="true"></i>' : ''}</span><span class="foot"><span class="tally" aria-hidden="true">${tally(ts)}</span>${cnt?`<span class="cnt">${cnt}</span>`:''}</span></button>`;
  }
  const ts = relevantOn(S.sel,S.tcls), hv = ts.filter(isHeavy).length, bs = busy(S.sel,S.tcls), full = crowded(S.sel,S.tcls);
  const next = full ? suggestDay(S.sel,S.tcls) : '';
  const c = cname(S.tcls), nEnr = roster(S.tcls).length, mine = myClasses(S.teacher);
  const classBar = mine.length > 1 ? `<div style="max-width:320px;margin:0 0 28px"><label class="f" for="tcls" style="margin-top:0">Planning for</label><select id="tcls">${mine.map(id => `<option value="${esc(id)}" ${id===S.tcls?'selected':''}>${esc(cname(id).name)}</option>`).join('')}</select></div>` : '';
  const summary = bs ? bs.n+' of '+bs.total+' students ('+pct(bs.share)+') already have '+fmtMin(HEAVY_DAY)+' or more of work · '+ts.length+' total' : hv+' of '+CAP+' heavy items · '+ts.length+' total';
  const basis = S.enrollErr ? 'Couldn’t load class rosters, so this uses a grade-level estimate. Check the Firestore rules for the enrollments collection.'
    : bs ? 'Based on the '+bs.total+' students who picked '+esc(c.name)+' in Folio.'
    : 'Only '+nEnr+' student'+(nEnr===1?' has':'s have')+' picked '+esc(c.name)+' so far, so this uses a grade-level estimate until '+MIN_ENROLLED+' have.';
  const soon = S.ann.filter(a => a.date <= iso(addDays(new Date(),14))).sort((a,b) => a.date.localeCompare(b.date));
  const upcoming = `<div style="margin-bottom:28px"><h2>Coming up from administration</h2>${S.annErr ? '<div class="warn">Couldn’t load announcements. Check the Firestore rules for the announcements collection.</div>' : soon.length ? soon.map(a => annRow(a,{date:true})).join('') : '<div class="meta">Nothing posted for the next two weeks.</div>'}</div>`;
  return `<h1>Calendar</h1><p class="sub">Estimate how long each task takes a student outside class. Folio adds up each student’s work for the day across all their classes. You’ll get a warning if adding yours would put ${pct(THRESH)} of your class at ${fmtMin(HEAVY_DAY)} or more, and a nearby day with less overlap. It’s a suggestion, so you can go over when you need to.</p>
  ${classBar}
  <div class="layout" style="grid-template-columns:1fr 320px;gap:40px"><section>
    ${upcoming}
    <div class="cal-head"><button class="ib" data-nav="-1" aria-label="Previous month">\u2039</button><h2>${S.month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><button class="ib" data-nav="1" aria-label="Next month">\u203a</button></div>
    <div class="grid">${cells}</div>
    <div class="legend">${[['green','Under '+fmtMin(STEPS[0])],['yellow',fmtMin(STEPS[0])+'+'],['orange',fmtMin(STEPS[1])+'+'],['red',fmtMin(STEPS[2])+'+']].map(([k,l])=>`<span><i class="dot" style="--c:${COL[k]}"></i>${l}</span>`).join('')}<span>Shaded day = ${bs||peers(S.tcls) ? pct(THRESH)+'+ of your students busy' : CAP+'+ heavy items'}</span><span><i class="annmark"></i>Announcement</span></div>
    ${canvasTeacher()}
  </section><aside class="day">
    <h2>${fmt(S.sel,{weekday:'long',month:'long',day:'numeric'})}</h2><div class="meta">${summary}</div><div class="meta">${basis}</div>
    ${annOn(S.sel).map(a => `<div class="banner" style="margin:12px 0"><b>${esc(a.kind)}:</b> ${esc(a.title)}${a.note ? '. '+esc(a.note) : ''}</div>`).join('')}
    ${ts.length ? ts.map(t=>taskRow(t,{plain:true,del:t.owner===S.user.uid})).join('') : '<div class="empty" style="padding:16px 0">No work posted yet.</div>'}
    <label class="f" for="ttl">Add for ${esc(c.name)}</label><input type="text" id="ttl" maxlength="60" placeholder="Title (optional), e.g. Chapter 5 quiz">
    <div class="row"><div><label class="f" for="typ">Type</label><select id="typ">${TYPES.map(t=>`<option>${t}</option>`).join('')}</select></div>
    <div><label class="f" for="mins">Time outside class</label><select id="mins">${MINS.map(m=>`<option value="${m}" ${m===DEFAULT_MINS.Test?'selected':''}>${fmtMin(m)}</option>`).join('')}</select></div></div>
    ${full?`<div class="warn">${bs ? 'A lot of your students are already busy this day.' : 'This day already has '+hv+' heavy items.'} If you add more work, you’ll be asked to confirm. ${next?`<button class="link" data-jump="${next}">Try ${fmt(next,{weekday:'short',month:'short',day:'numeric'})}</button>, which has less overlap.`:''}</div>`:''}
    ${S.msg?`<div class="warn">${esc(S.msg)}</div>`:''}
    <button class="btn" id="add">Add to calendar</button>
  </aside></div>`;
}


/* ===== Canvas ===== */
const ck = s => String(s).replace(/[^a-z0-9]/gi,'').toLowerCase();
const cvClass = x => {
  const m = S.profile.cvmap || {}, k = ck(x.course);
  if (k in m) return m[k];
  const l = String(x.course).toLowerCase(), g = courses().find(c => l.includes(c.name.toLowerCase()) || (c.id.length > 3 && l.includes(c.id)));
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
          return `<label class="f" style="margin-top:10px">${esc(co)}</label><select data-cvmap="${esc(co)}"><option value="">Not one of my Folio classes</option>${myList().map(k=>`<option value="${k.id}" ${k.id===sel?'selected':''}>${esc(k.name)}</option>`).join('')}</select>`; }).join('')
      + `<button class="link" id="cvoff" style="margin-top:12px">Clear Canvas data</button>`;
  }
  return `<h2 style="margin-top:32px">Canvas</h2>${body}${c.msg?`<div class="warn">${esc(c.msg)}</div>`:''}`;
}
function canvasTeacher(){
  const c = S.canvas, mine = S.tcls; let body;
  if (!c.items.length) body = canvasConnectForm();
  else {
    const todo = c.items.filter(x => !S.tasks.some(t => t.cls === mine && t.title === x.title && t.date === x.date));
    body = (todo.length
      ? `<div class="row" style="align-items:end">
        <button class="btn" id="cvall" style="margin-top:0">Add all (${todo.length})</button></div>`
        + todo.map(x => `<div class="task"><div class="grow"><div class="tt">${esc(x.title)}</div><div class="meta">${fmt(x.date,{weekday:'short',month:'short',day:'numeric'})} · ${esc(x.course)}</div></div><button class="link" data-imp="${esc(x.id)}">Add</button></div>`).join('')
      : `<div class="empty" style="padding:12px 0">Everything from Canvas is already on the calendar.</div>`)
      + `<button class="link" id="cvoff" style="margin-top:10px">Clear Canvas data</button>`;
  }
  return `<div style="margin-top:36px"><h2>Import from Canvas into ${esc(cname(S.tcls).name)}</h2>${body}${c.msg?`<div class="warn">${esc(c.msg)}</div>`:''}</div>`;
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
async function importItems(list){
  const used = {}, usedH = {}; let added = 0;
  const flags = list.map(x => {
    const m = DEFAULT_MINS[x.type] || 60, t = {date:x.date,cls:S.tcls,type:x.type,mins:m};
    const add = (used[x.date] || 0) + m; used[x.date] = add;
    const k = usedH[x.date] || 0; if (isHeavy(t)) usedH[x.date] = k + 1;
    if (overBy(t)) return true;
    const b = busy(t.date,t.cls,add);
    if (b) return b.share >= THRESH;
    return isHeavy(t) && heavyOn(t.date,t.cls).length + k >= CAP;
  });
  const over = flags.filter(Boolean).length;
  if (over && !confirm(over+' of these '+list.length+' items would crowd students who already have heavy work that day.\n\nAdd them all anyway?')) return;
  for (let i = 0; i < list.length; i++){
    const x = list[i], t = {date:x.date,cls:S.tcls,title:x.title,type:x.type,mins:DEFAULT_MINS[x.type] || 60,owner:S.user.uid};
    if (flags[i]) t.overridden = true;
    try{ await addDoc(collection(db,'tasks'),t); added++; }
    catch(e){ S.canvas.msg = friendly(e); return render(); }
  }
  S.canvas.msg = 'Added '+added+(over?'. '+over+' landed on days when many of your students are already busy.':'.'); render();
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
    ${r ? `<p class="sub">Your request for <b>${esc(myClasses(r).map(id => cname(id).name).join(', '))}</b> was sent. Once it’s approved, sign out and sign back in to see the teacher calendar.</p>`
        : `<p class="sub">${esc(S.user.email)} isn’t set up as a teacher yet. Pick the classes you teach and request access. An admin will approve it.</p>
        <label class="f">My classes</label>${courses().map(c=>`<label class="cls"><input type="checkbox" data-req="${esc(c.id)}"><span>${esc(c.name)}<small>${esc(c.teacher)}</small></span></label>`).join('')}
        <button class="btn" id="reqsend">Request teacher access</button>`}
    <div class="warn" id="err" role="alert"></div>
    <button class="btn alt" id="reqskip">Continue as a student</button><button class="btn alt" id="reqout">Sign out</button></div>`;
    if ($('reqsend')) $('reqsend').onclick = async () => {
      const picked = [...document.querySelectorAll('[data-req]')].filter(x => x.checked).map(x => x.dataset.req);
      if (!picked.length) return setErr('Pick at least one class.');
      const d = {name:S.profile.name,email:S.user.email.toLowerCase(),cls:picked[0],classes:picked,uid:S.user.uid};
      try{ await setDoc(doc(db,'teacherRequests',d.email),d); S.request = d; render(); }catch(e){ setErr(friendly(e)); }
    };
    $('reqskip').onclick = () => { S.needTeacher = false; render(); };
    $('reqout').onclick = () => signOut(auth);
    return;
  }
  if (S.term && !S.teacher && !S.admin && (S.profile.confirmedTerm !== S.term.id || S.editClasses)){
    root.innerHTML = termView();
    $('termout').onclick = () => signOut(auth);
    if ($('termcancel')) $('termcancel').onclick = () => { S.editClasses = false; S.dirMsg = ''; render(); };
    if ($('termok')) $('termok').onclick = async () => {
      const picked = [...document.querySelectorAll('[data-pick]')].filter(x => x.checked).map(x => x.dataset.pick);
      if (!picked.length){ S.dirMsg = 'Pick at least one class.'; return setErr(S.dirMsg); }
      try{
        await setDoc(doc(db,'users',S.user.uid),{classes:picked,filter:picked,confirmedTerm:S.term.id,classesSet:true},{merge:true});
        await setDoc(doc(db,'enrollments',S.user.uid),{classes:picked,term:S.term.id,name:S.profile.name || ''});
        Object.assign(S.profile,{classes:picked,filter:picked,confirmedTerm:S.term.id,classesSet:true});
        S.editClasses = false; S.dirMsg = ''; S.view = 'dash'; render();
      }catch(err){ S.dirMsg = friendly(err); setErr(S.dirMsg); }
    };
    return;
  }
  const keep = KEEP.map(id => $(id) ? $(id).value : null);
  const teacher = !!S.teacher, admin = !!S.admin;
  if (!teacher && (S.view === 'cal' || S.view === 'roster' || S.view === 'load')) S.view = admin ? 'ann' : 'dash';
  if (!admin && (S.view === 'ann' || S.view === 'dir')) S.view = 'dash';
  const p = S.profile;
  root.innerHTML = `<header><div class="bar"><div class="logo">${logoMark()}Folio</div>
    <nav>${teacher?`<button data-view="cal" aria-current="${S.view==='cal'?'page':'false'}">Calendar</button><button data-view="roster" aria-current="${S.view==='roster'?'page':'false'}">Roster</button><button data-view="load" aria-current="${S.view==='load'?'page':'false'}">Workload</button>`:''}${admin?`<button data-view="ann" aria-current="${S.view==='ann'?'page':'false'}">Announcements</button><button data-view="dir" aria-current="${S.view==='dir'?'page':'false'}">Directory</button>`:''}<button data-view="dash" aria-current="${S.view==='dash'?'page':'false'}">${teacher?'Student view':'What’s due'}</button></nav>
    <div class="who"><div><b>${esc(p.name)}</b><small>${teacher?'Teacher · '+esc(teachLabel(S.teacher))+(admin?' · Admin':''):admin?'Administrator':'Student'}</small></div>
    <div class="av">${p.photo?`<img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer">`:esc(initials(p.name))}</div>
    ${themeBtn()}<button class="link" id="out">Sign out</button></div></div></header>
    <main>${S.view==='load' && teacher ? loadView() : S.view==='roster' && teacher ? rosterView() : S.view==='dir' && admin ? dirView() : S.view==='ann' && admin ? annView() : S.view==='cal' && teacher ? calView() : dashView()}</main>`;
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
let unsub = null, unsubEn = null, unsubAnn = null, unsubVf = null;
async function loadDirectory(){
  try{ const t = await getDoc(doc(db,'settings','term')); S.term = t.exists() && t.data().id ? t.data() : null; }catch(_){ S.term = null; }
  try{ S.courses = (await getDocs(collection(db,'courses'))).docs.map(d => ({id:d.id,...d.data()})); }catch(_){ S.courses = []; }
}
async function startSession(user){
  try{
    const email = user.email.toLowerCase();
    if (CONFIG.ALLOWED_DOMAIN && !email.endsWith('@'+CONFIG.ALLOWED_DOMAIN)){ S.flash = 'Use your school account (@'+CONFIG.ALLOWED_DOMAIN+').'; return signOut(auth); }
    await loadDirectory();
    S.editClasses = false; S.dirMsg = '';
    const uref = doc(db,'users',user.uid); let snap = await getDoc(uref);
    if (!snap.exists()){
      await setDoc(uref,{name:S.signupName||user.displayName||email.split('@')[0],email,photo:user.photoURL||'',filter:[],classesSet:false,done:{}});
      snap = await getDoc(uref);
    }
    const p = snap.data(); p.filter = p.filter || courses().map(c=>c.id); p.done = p.done || {}; p.cvmap = p.cvmap || {};
    S.profile = p; S.canvas.items = (p.canvasItems || []).filter(x => x.date >= TODAY);
    const t = await getDoc(doc(db,'teachers',email));
    S.teacher = t.exists() ? t.data() : null;
    S.tcls = myClasses(S.teacher)[0] || '';
    try{ S.admin = (await getDoc(doc(db,'admins',email))).exists(); }catch(_){ S.admin = false; }
    if ((S.teacher || S.admin) && !p.classesSet && !p.filter.length) p.filter = courses().map(c => c.id);
    if (!S.teacher && !S.admin){
      if (!S.term && p.classesSet) setDoc(doc(db,'enrollments',user.uid),{classes:p.filter}).catch(() => {});
      else if (S.term && p.confirmedTerm === S.term.id) setDoc(doc(db,'enrollments',user.uid),{classes:p.classes || p.filter,term:S.term.id,name:p.name || ''}).catch(() => {});
    }
    S.needTeacher = false; S.request = null;
    if (!S.teacher && !S.admin && S.wantTeacher){ const r = await getDoc(doc(db,'teacherRequests',email)); S.request = r.exists() ? r.data() : null; S.needTeacher = true; }
    S.view = S.teacher ? 'cal' : S.admin ? 'ann' : 'dash';
    if (unsubAnn){ unsubAnn(); unsubAnn = null; }
    S.ann = []; S.annErr = false; S.annMsg = '';
    if (S.teacher || S.admin) unsubAnn = onSnapshot(query(collection(db,'announcements'),where('date','>=',TODAY)),
      s => { S.ann = s.docs.map(d => ({id:d.id,...d.data()})); S.annErr = false; render(); },
      () => { S.ann = []; S.annErr = true; render(); });
    if (unsubEn){ unsubEn(); unsubEn = null; }
    S.enroll = []; S.enrollErr = false;
    if (S.teacher) unsubEn = onSnapshot(collection(db,'enrollments'),
      s => { S.enroll = s.docs.map(d => ({id:d.id,term:d.data().term || '',name:d.data().name || '',classes:Array.isArray(d.data().classes) ? d.data().classes : []})); S.enrollErr = false; render(); },
      () => { S.enroll = []; S.enrollErr = true; render(); });
    if (unsubVf){ unsubVf(); unsubVf = null; }
    S.verif = [];
    const vfOk = s => { S.verif = s.docs.map(d => d.data()); render(); }, vfErr = () => { S.verif = []; render(); };
    if (S.teacher) unsubVf = onSnapshot(collection(db,'verifications'), vfOk, vfErr);
    else if (!S.admin) unsubVf = onSnapshot(query(collection(db,'verifications'),where('uid','==',user.uid)), vfOk, vfErr);
    if (unsub) unsub();
    unsub = onSnapshot(query(collection(db,'tasks'),where('date','>=',TODAY)),
      s => { S.tasks = s.docs.map(d => ({id:d.id,...d.data()})); render(); },
      e => { S.msg = friendly(e); render(); });
    render();
  }catch(err){ S.flash = friendly(err); signOut(auth); }
}
if (configured) onAuthStateChanged(auth, user => {
  S.ready = true; S.user = user; S.profile = null; S.teacher = null; S.admin = false;
  if (!user){ if (unsub){ unsub(); unsub = null; } if (unsubEn){ unsubEn(); unsubEn = null; } if (unsubAnn){ unsubAnn(); unsubAnn = null; } if (unsubVf){ unsubVf(); unsubVf = null; } S.verif = []; S.enroll = []; S.enrollErr = false; S.ann = []; S.annErr = false; S.admin = false; S.term = null; S.courses = []; S.editClasses = false; S.tasks = []; S.canvas.items = []; S.canvas.msg = ''; S.wantTeacher = false; S.needTeacher = false; return render(); }
  render(); if (user.emailVerified) startSession(user);
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-view],[data-day],[data-nav],[data-del],[data-anndel],[data-jump],[data-imp],[data-editcls],[data-coursedel],[data-vf],#vfall,#courseadd,#termset,#dirseed,#cvsync,#cvoff,#cvall,#add,#annadd');
  if (!b || !S.profile) return;
  if (b.dataset.view) S.view = b.dataset.view;
  else if (b.dataset.day){ S.sel = b.dataset.day; S.msg=''; }
  else if (b.dataset.nav) S.month = new Date(S.month.getFullYear(), S.month.getMonth()+Number(b.dataset.nav), 1);
  else if (b.dataset.jump){ S.sel = b.dataset.jump; const d = parse(S.sel); S.month = new Date(d.getFullYear(), d.getMonth(), 1); S.msg=''; }
  else if (b.dataset.del){ deleteDoc(doc(db,'tasks',b.dataset.del)).catch(err => { S.msg = friendly(err); render(); }); return; }
  else if (b.dataset.anndel){ deleteDoc(doc(db,'announcements',b.dataset.anndel)).catch(err => { S.annMsg = friendly(err); render(); }); return; }
  else if (b.id === 'annadd'){
    const title = $('atl').value.trim(), date = $('adt').value;
    if (!S.admin) return;
    if (!title || !date){ S.annMsg = 'Add a date and a title.'; return render(); }
    if (date < TODAY){ S.annMsg = 'Pick today or a later date.'; return render(); }
    const a = {date,title,kind:$('akd').value,note:$('ant').value.trim(),owner:S.user.uid,ownerName:S.profile.name};
    $('atl').value = ''; $('ant').value = ''; S.annMsg = '';
    addDoc(collection(db,'announcements'),a).catch(err => { S.annMsg = friendly(err); render(); });
    return;
  }
  else if (b.dataset.vf){
    const [uid,cls,status] = b.dataset.vf.split('|');
    if (!S.teacher || !myClasses(S.teacher).includes(cls)) return;
    S.msg = '';
    setDoc(doc(db,'verifications',uid+'_'+cls),{uid,cls,term:S.term ? S.term.id : '',status,by:S.user.uid}).catch(err => { S.msg = friendly(err); render(); });
    return;
  }
  else if (b.id === 'vfall'){
    if (!S.teacher || !myClasses(S.teacher).includes(S.tcls)) return;
    const cls = S.tcls, term = S.term ? S.term.id : '';
    S.msg = '';
    Promise.all(enrolledIn(cls).filter(e => vstatus(e.id,cls) === 'pending').map(e => setDoc(doc(db,'verifications',e.id+'_'+cls),{uid:e.id,cls,term,status:'verified',by:S.user.uid}))).catch(err => { S.msg = friendly(err); render(); });
    return;
  }
  else if ('editcls' in b.dataset){ S.editClasses = true; S.dirMsg = ''; }
  else if (b.dataset.coursedel){
    if (!S.admin || !confirm('Remove this class from the directory? Students who already picked it keep it until they next confirm.')) return;
    deleteDoc(doc(db,'courses',b.dataset.coursedel)).then(async () => { S.dirMsg = ''; await loadDirectory(); render(); }).catch(err => { S.dirMsg = friendly(err); render(); });
    return;
  }
  else if (b.id === 'dirseed'){
    if (!S.admin) return;
    Promise.all(CLASSES.map(c => setDoc(doc(db,'courses',c.id),{name:c.name,teacher:c.teacher||'',grades:c.grades||[],active:true}))).then(async () => { S.dirMsg = ''; await loadDirectory(); render(); }).catch(err => { S.dirMsg = friendly(err); render(); });
    return;
  }
  else if (b.id === 'courseadd'){
    if (!S.admin) return;
    const id = $('cid').value.trim().toLowerCase().replace(/[^a-z0-9]/g,''), name = $('cnm').value.trim(), teacher = $('ctc').value.trim();
    const grades = $('cgr').value.split(',').map(x => parseInt(x,10)).filter(n => n >= 9 && n <= 12);
    if (!S.courses.length){ S.dirMsg = 'Copy the config.js classes into the directory first, then add new ones.'; return render(); }
    if (!id || !name){ S.dirMsg = 'Add a short id and a class name.'; return render(); }
    if (S.courses.some(c => c.id === id)){ S.dirMsg = 'That id is already used.'; return render(); }
    setDoc(doc(db,'courses',id),{name,teacher,grades,active:true}).then(async () => {
      ['cid','cnm','ctc','cgr'].forEach(k => { if ($(k)) $(k).value = ''; });
      S.dirMsg = ''; await loadDirectory(); render();
    }).catch(err => { S.dirMsg = friendly(err); render(); });
    return;
  }
  else if (b.id === 'termset'){
    if (!S.admin) return;
    const id = $('tid').value.trim().toLowerCase().replace(/[^a-z0-9-]/g,''), label = $('tlb').value.trim();
    if (!id || !label){ S.dirMsg = 'Add a short id and a name for the semester.'; return render(); }
    if ((!S.term || S.term.id !== id) && !confirm('Start “'+label+'”? Every student will be asked to confirm their classes again, and class overlap counts start fresh.')) return;
    setDoc(doc(db,'settings','term'),{id,label}).then(async () => { S.dirMsg = ''; await loadDirectory(); render(); }).catch(err => { S.dirMsg = friendly(err); render(); });
    return;
  }
  else if (b.id === 'cvsync'){ syncCanvas(); return; }
  else if (b.id === 'cvall'){ const mine = S.tcls; importItems(S.canvas.items.filter(x => !S.tasks.some(t => t.cls === mine && t.title === x.title && t.date === x.date))); return; }
  else if (b.id === 'cvoff'){ S.canvas.items = []; S.canvas.msg = ''; saveCv(); }
  else if (b.dataset.imp){
    const it = S.canvas.items.find(x => x.id === b.dataset.imp); if (!it) return;
    const nt = {date:it.date,cls:S.tcls,title:it.title,type:it.type,mins:DEFAULT_MINS[it.type] || 60,owner:S.user.uid};
    const warn = overBy(nt);
    if (warn){ if (!confirm(warn)) return; nt.overridden = true; }
    addDoc(collection(db,'tasks'),nt).catch(err => { S.msg = friendly(err); render(); });
    return;
  }
  else if (b.id === 'add'){
    const type = $('typ').value, title = $('ttl').value.trim() || type;
    const task = {date:S.sel,cls:S.tcls,title,type,mins:Number($('mins').value) || 0,owner:S.user.uid};
    const warn = overBy(task);
    if (warn){ if (!confirm(warn)) return; task.overridden = true; }
    $('ttl').value = ''; S.msg = '';
    addDoc(collection(db,'tasks'),task).catch(err => { S.msg = friendly(err); render(); });
    return;
  }
  render();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'ttl' && $('add')) $('add').click();
  else if ((e.target.id === 'atl' || e.target.id === 'ant') && $('annadd')) $('annadd').click();
});
document.addEventListener('change', e => {
  const t = e.target; if (!S.profile) return;
  const uref = doc(db,'users',S.user.uid);
  if (t.dataset.done){ S.profile.done[t.dataset.done] = t.checked; setDoc(uref,{done:{[t.dataset.done]:t.checked}},{merge:true}); render(); }
  else if (t.dataset.cvmap !== undefined){ const k = ck(t.dataset.cvmap); S.profile.cvmap[k] = t.value; setDoc(uref,{cvmap:{[k]:t.value}},{merge:true}); render(); }
  else if (t.id === 'cvfile'){ if (t.files[0]) loadICS(t.files[0]); }
  else if (t.id === 'cvshow'){ S.canvas.show = t.checked; render(); }
  else if (t.id === 'tcls'){ if (S.teacher && myClasses(S.teacher).includes(t.value)){ S.tcls = t.value; S.msg = ''; render(); } }
  else if (t.id === 'typ'){ const m = $('mins'); if (m) m.value = DEFAULT_MINS[t.value] || m.value; }
  else if (t.dataset.cls){
    const f = S.profile.filter, i = f.indexOf(t.dataset.cls); i>-1 ? f.splice(i,1) : f.push(t.dataset.cls);
    S.profile.classesSet = true;
    setDoc(uref,{filter:f,classesSet:true},{merge:true});
    /* With a semester set, ticking a class only changes what the student sees. Enrollment changes go through "Change my classes". */
    if (!S.teacher && !S.admin && !termOn()) setDoc(doc(db,'enrollments',S.user.uid),{classes:f}).catch(() => {});
    render();
  }
});
render();
