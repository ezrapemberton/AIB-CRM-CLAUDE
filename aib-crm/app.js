/* AI in Business Club — recruiting workspace
   Plain JS, no build step. Data syncs through /api/data when it is set up,
   and always keeps a copy in this browser so it works offline. */
(() => {
'use strict';

/* ---------- constants & helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n) => `<svg><use href="#i-${n}"/></svg>`;
const STATUSES = ['To contact', 'Emailed', 'Followed up', 'Approved', 'Visited', 'Declined'];
const sClass = (s) => 's-' + s.toLowerCase().replace(/\s+/g, '-');
const DAY_ORDER = ['M', 'T', 'W', 'R', 'F'];
const DAY_SHORT = { M: 'M', T: 'T', W: 'W', R: 'Th', F: 'F' };
const DAY_LONG = { M: 'Monday', T: 'Tuesday', W: 'Wednesday', R: 'Thursday', F: 'Friday' };
const LEVELS = ['Freshman', 'Freshman / Sophomore', 'Sophomore'];
const BUILDINGS = ['CSOM', 'Hanson Hall', 'Willey Hall', 'Blegen Hall', 'Humphrey Center', 'Other'];
const LS = { state: 'aib.state.v1', pass: 'aib.pass', rev: 'aib.rev', dirty: 'aib.dirty', ui: 'aib.ui', theme: 'aib.theme' };

const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };

const DEFAULT_SETTINGS = {
  firstName: 'Ezra', lastName: '', year: '', major: '', title: 'Founder & President',
  email: 'pembe059@umn.edu', phone: '', clubName: 'AI in Business Club',
  meetingDate: '', meetingTime: '', meetingPlace: '', signupLink: '',
  deckLink: 'https://claude.ai/artifact/6d8oTQBuKgPLPwvuQ91wCy',
  askMinutes: '1–2', followUpDays: 5, pitchSeconds: 90, script: ''
};

// dates (local, ISO yyyy-mm-dd)
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => iso(new Date());
const parseISO = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysSince = (s) => { const d = parseISO(s); return d ? Math.round((parseISO(todayISO()) - d) / 864e5) : null; };
const fmtDate = (s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => { const d = parseISO(s); return d ? d.toLocaleDateString('en-US', opts) : ''; };
const fmtLong = (s) => fmtDate(s, { weekday: 'long', month: 'long', day: 'numeric' });
const fmtTime = (t) => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; };
const dayLetter = (d) => ['', 'M', 'T', 'W', 'R', 'F', ''][d.getDay()];
const daysShort = (c) => (c.days || []).map((d) => DAY_SHORT[d]).join('');
const whenText = (c) => [daysShort(c), c.start ? `${fmtTime(c.start)}–${fmtTime(c.end)}` : ''].filter(Boolean).join(' · ');
const where = (c) => [c.bldg, c.room].filter(Boolean).join(' ');
const lastName = (p) => (p || '').trim().split(/\s+/).pop() || '[Last name]';
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- state ---------- */
let S = null;               // { settings, classes, updatedAt }
let rev = 0;
let mode = 'loading';       // loading | sync | local | offline | locked
let syncState = '';         // ok | saving | err
let ui = Object.assign({ tab: 'today', status: 'All', level: 'All', q: '', sort: 'smart', unverified: false, weekOffset: 0, allTimes: true }, safeJSON(lsGet(LS.ui), {}));
let drawerId = null;
let lastSnapshot = null;

function safeJSON(s, d) { try { return s ? JSON.parse(s) : d; } catch { return d; } }

function normalize(st) {
  st = st && typeof st === 'object' ? st : {};
  const settings = Object.assign({}, DEFAULT_SETTINGS, st.settings || {});
  const classes = Array.isArray(st.classes) ? st.classes.map((c) => Object.assign({
    id: uid(), code: '', sec: '', title: '', days: [], start: '', end: '', bldg: '', room: '', prof: '', email: '',
    size: 0, level: 'Freshman', college: '', audience: '', status: 'To contact', verified: false,
    emailedAt: '', followedUpAt: '', visitDate: '', signups: 0, notes: ''
  }, c)) : [];
  return { settings, classes, updatedAt: st.updatedAt || Date.now() };
}

function loadLocal() {
  const saved = safeJSON(lsGet(LS.state), null);
  S = normalize(saved || { classes: JSON.parse(JSON.stringify(window.SEED_CLASSES || [])) });
  rev = Number(lsGet(LS.rev, 0)) || 0;
}
const saveLocal = () => lsSet(LS.state, JSON.stringify(S));
const saveUI = () => lsSet(LS.ui, JSON.stringify(ui));
const byId = (id) => S.classes.find((c) => c.id === id);

/* ---------- sync ---------- */
let pushTimer = null, pushing = false;

async function api(method, body) {
  return fetch('/api/data', {
    method, cache: 'no-store',
    headers: { 'x-passcode': lsGet(LS.pass, ''), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function connect() {
  if (location.protocol === 'file:') return setMode('local');
  let r;
  try { r = await api('GET'); } catch { return setMode('offline'); }
  if (r.status === 404 || r.status === 503) return setMode('local');
  if (r.status === 401) return setMode('locked');
  if (!r.ok) return setMode('offline');
  const d = await r.json();
  const dirty = lsGet(LS.dirty) === '1';
  if (!d.state || (dirty && d.rev === rev)) {
    // empty server, or we have unsynced edits made on top of the latest server copy
    rev = d.rev || 0;
    setMode('sync');
    return pushNow();
  }
  S = normalize(d.state); rev = d.rev; lsSet(LS.rev, rev); lsDel(LS.dirty); saveLocal();
  setMode('sync');
  if (dirty) toast('Loaded the newer copy from another device');
}

async function pull() {
  if (mode !== 'sync' || pushing || pushTimer) return;
  try {
    const r = await api('GET'); if (!r.ok) return;
    const d = await r.json();
    if (d.state && d.rev > rev) { S = normalize(d.state); rev = d.rev; lsSet(LS.rev, rev); saveLocal(); render(); if (drawerId) renderDrawer(); }
  } catch {}
}

function schedulePush() {
  lsSet(LS.dirty, '1');
  if (mode !== 'sync') return;
  setSync('saving');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; pushNow(); }, 600);
}

async function pushNow() {
  if (pushing) { schedulePush(); return; }
  pushing = true;
  try {
    const r = await api('PUT', { state: S, baseRev: rev });
    if (r.status === 409) {
      const d = await r.json(); S = normalize(d.state); rev = d.rev; saveLocal(); render(); if (drawerId) renderDrawer();
      toast('Another device saved first — showing its latest copy');
    } else if (r.status === 401) { pushing = false; return setMode('locked'); }
    else if (!r.ok) throw new Error();
    else { const d = await r.json(); rev = d.rev; }
    lsSet(LS.rev, rev); lsDel(LS.dirty); setSync('ok');
  } catch { setSync('err'); setTimeout(() => { if (syncState === 'err') schedulePush(); }, 5000); }
  pushing = false;
}

function setMode(m) { mode = m; setSync(m === 'sync' ? 'ok' : ''); render(); }
function setSync(s) {
  syncState = s;
  const el = $('#sync-pill'); if (!el) return;
  const map = {
    sync: { ok: ['Synced', 'ok'], saving: ['Saving…', ''], err: ['Not saved — retrying', 'err'] }[s] || ['Synced', 'ok'],
    local: ['Saved on this device', 'local'], offline: ['Offline — saved on this device', 'local'],
    locked: ['Locked', 'err'], loading: ['Connecting…', '']
  }[mode];
  el.textContent = map[0]; el.className = 'sync-pill ' + map[1];
}

/* commit = save a change everywhere */
function commit(msg, opts = {}) {
  S.updatedAt = Date.now();
  saveLocal(); schedulePush();
  if (!opts.quiet) render();
  if (msg) toast(msg, opts.action);
}

function snapshot() { lastSnapshot = JSON.stringify(S); }
function undo() { if (!lastSnapshot) return; S = normalize(JSON.parse(lastSnapshot)); lastSnapshot = null; commit('Undone'); if (drawerId && !byId(drawerId)) closeDrawer(); }

/* ---------- derived data ---------- */
function stats() {
  const C = S.classes, f = S.settings.followUpDays || 5, t = todayISO();
  const contacted = C.filter((c) => c.status !== 'To contact').length;
  const yes = C.filter((c) => c.status === 'Approved' || c.status === 'Visited').length;
  const no = C.filter((c) => c.status === 'Declined').length;
  const visited = C.filter((c) => c.status === 'Visited');
  return {
    total: C.length, contacted, yes, no,
    reached: visited.reduce((a, c) => a + (+c.size || 0), 0),
    signups: C.reduce((a, c) => a + (+c.signups || 0), 0),
    visitedCount: visited.length,
    unverified: C.filter((c) => !c.verified).length,
    followUps: C.filter((c) => (c.status === 'Emailed' && daysSince(c.emailedAt) >= f)).sort((a, b) => a.emailedAt.localeCompare(b.emailedAt)),
    upcoming: C.filter((c) => c.status === 'Approved' && c.visitDate && c.visitDate >= t).sort((a, b) => (a.visitDate + a.start).localeCompare(b.visitDate + b.start)),
    needDate: C.filter((c) => c.status === 'Approved' && !c.visitDate),
    toLog: C.filter((c) => c.status === 'Approved' && c.visitDate && c.visitDate < t),
    next: C.filter((c) => c.status === 'To contact').sort(smartSort).slice(0, 5)
  };
}
function smartSort(a, b) {
  const lv = (c) => (c.level === 'Freshman' ? 0 : c.level.includes('Freshman') ? 1 : 2);
  return (b.verified - a.verified) || (lv(a) - lv(b)) || ((+b.size || 0) - (+a.size || 0));
}

/* ---------- email templates ---------- */
function me() { const s = S.settings; return [s.firstName, s.lastName].filter(Boolean).join(' ') || 'Ezra'; }
function meetingText(fallback = '[first meeting date, time & place]') {
  const s = S.settings;
  if (!s.meetingDate && !s.meetingTime && !s.meetingPlace) return fallback;
  return [s.meetingDate ? fmtLong(s.meetingDate) : '', s.meetingTime ? `at ${fmtTime(s.meetingTime)}` : '', s.meetingPlace ? `in ${s.meetingPlace}` : ''].filter(Boolean).join(' ');
}
function missingFor(kind) {
  const s = S.settings, m = [];
  if (!s.lastName) m.push('last name');
  if (kind === 'ask' && !s.year) m.push('year');
  if (kind === 'thanks' && !s.signupLink) m.push('sign-up link');
  return m;
}
function emailFor(kind, c) {
  const s = S.settings, prof = `Professor ${lastName(c.prof)}`, club = s.clubName, ask = s.askMinutes;
  const yr = s.year ? `a ${s.year.toLowerCase()}` : 'a [year]';
  const sig = [me(), `${s.title}, ${club}`, 'Carlson School of Management, University of Minnesota', s.email, s.phone].filter(Boolean).join('\n');
  const when = [c.days.length ? c.days.map((d) => DAY_LONG[d]).join('/') : '', c.start ? fmtTime(c.start) : ''].filter(Boolean).join(' ');
  const vdate = c.visitDate ? fmtLong(c.visitDate) : '[date]';
  const T = {
    ask: {
      subject: `Quick ${ask} min announcement in ${c.code}? (${club})`,
      body:
`Hi ${prof},

I'm ${me()}, ${yr}${s.major ? ` studying ${s.major}` : ''} at Carlson, and I'm starting the ${club} this fall. We're trying to reach first-year students early, and ${c.code} has a lot of the students who'd get the most out of it.

Would you be open to me taking ${ask} minutes at the start or end of your ${c.code} class${when ? ` (${when})` : ''} sometime in the next couple of weeks? It's just a quick heads-up that the club exists, what we do, and when our first meeting is. I'm happy to work around whatever day suits you best. If class time doesn't work, I could send a short blurb or slide for you to post on Canvas instead.

Thank you for considering it,
${sig}`
    },
    followup: {
      subject: `Re: Quick ${ask} min announcement in ${c.code}? (${club})`,
      body:
`Hi ${prof},

I wanted to follow up on my email${c.emailedAt ? ` from ${fmtDate(c.emailedAt, { month: 'long', day: 'numeric' })}` : ''} about a quick ${ask} minute announcement for the ${club} in ${c.code}. I know class time is valuable, so if it's easier, I'm glad to send a short blurb or slide you could post on Canvas instead.

Thanks again for considering it,
${me()}
${s.email}`
    },
    confirm: {
      subject: `Thank you! ${club} visit to ${c.code}${c.visitDate ? ` on ${fmtDate(c.visitDate, { month: 'short', day: 'numeric' })}` : ''}`,
      body:
`Hi ${prof},

Thank you so much for making time for us! I'll plan to come by ${c.code} on ${vdate}${c.start ? ` and will be there by ${fmtTime(c.start)}` : ''}${where(c) ? ` in ${where(c)}` : ''}. Just let me know whether you'd prefer the start or the end of class. I'll keep it to ${ask} minutes.

Best,
${me()}
${s.email}`
    },
    thanks: {
      subject: `Thank you for having me in ${c.code}`,
      body:
`Hi ${prof},

Thank you again for letting me speak to your ${c.code} class${c.visitDate ? ` on ${fmtLong(c.visitDate)}` : ''}. I really appreciate you giving me the time.
${s.signupLink ? `\nIf it's helpful, here's our sign-up link in case you'd like to share it on Canvas: ${s.signupLink}\n` : ''}
Best,
${me()}
${s.email}`
    }
  };
  return T[kind];
}
const defaultKind = (c) => ({ 'To contact': 'ask', Emailed: 'followup', 'Followed up': 'followup', Approved: 'confirm', Visited: 'thanks' }[c.status] || 'ask');

function defaultScript() {
  const s = S.settings;
  return [
    ['0:00 · Hook', `Hi everyone! I'm ${s.firstName || 'Ezra'}, ${s.year ? `a ${s.year.toLowerCase()}` : 'a student'} here at Carlson. Thanks to your professor for letting me take a minute.`],
    ['0:15 · What it is', `I'm starting the ${s.clubName}. It's open to any major and you don't need to know how to code. We'll look at how companies are actually using AI, try the tools hands-on, and meet people who use them at work.`],
    ['0:45 · Why now', `AI is already changing internships and first jobs in finance, marketing, consulting — pretty much everywhere. Getting comfortable with it as a freshman puts you ahead.`],
    ['1:05 · Ask', `Our first meeting is ${meetingText('[date, time & place]')}. Scan the QR code to sign up — I'll leave it up for a few seconds. Thanks, everyone!`]
  ];
}

/* ---------- rendering ---------- */
const VIEWS = { today: viewToday, classes: viewClasses, week: viewWeek, pitch: viewPitch, settings: viewSettings };

function render() {
  if (!S) return;
  const v = $('#view');
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === ui.tab)));
  $('.add-btn').hidden = mode === 'locked';
  if (mode === 'locked') { v.innerHTML = viewLock(); setSync(''); return; }
  const fn = VIEWS[ui.tab] || viewToday;
  const keepFocus = document.activeElement && document.activeElement.id === 'q' ? document.activeElement.selectionStart : null;
  v.innerHTML = fn();
  if (keepFocus !== null) { const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(keepFocus, keepFocus); } }
  if (ui.tab === 'pitch') afterPitch();
  setSync(syncState);
}

function badge(c) { return `<span class="badge ${sClass(c.status)}">${esc(c.status)}</span>`; }
function unverifiedFlag(c) { return c.verified ? '' : `<span class="flag" title="Check this class & email before contacting">${icon('alert')}Unverified</span>`; }

function itemRow(c, sub, lead = '') {
  return `<div class="item" data-action="open" data-id="${esc(c.id)}">${lead}
    <div class="grow"><div class="t">${esc(c.code)}${c.sec ? '-' + esc(c.sec) : ''} · ${esc(c.prof || 'No professor yet')}</div><div class="s">${sub}</div></div>
    ${unverifiedFlag(c)}</div>`;
}
function dateChip(s) { const d = parseISO(s); return `<div class="datechip"><span>${d.toLocaleDateString('en-US', { month: 'short' })}</span><b>${d.getDate()}</b></div>`; }

function viewToday() {
  const st = stats(), s = S.settings;
  const h = new Date().getHours(), greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const pct = st.total ? Math.round((st.contacted / st.total) * 100) : 0;
  const summary = [
    st.followUps.length ? `${st.followUps.length} follow-up${st.followUps.length > 1 ? 's' : ''} due` : '',
    st.upcoming[0] ? `next visit ${fmtDate(st.upcoming[0].visitDate)}` : '',
    st.toLog.length ? `${st.toLog.length} visit${st.toLog.length > 1 ? 's' : ''} to log` : ''
  ].filter(Boolean).join(' · ').replace(/^./, (m) => m.toUpperCase()) || (st.contacted ? 'You\'re caught up. Email a few more classes below.' : 'Start by emailing the classes below.');

  const sec = (title, list, empty) => `<div class="section-label" style="margin-top:14px">${title}</div>${list.length ? `<div class="items">${list.join('')}</div>` : `<div class="empty">${empty}</div>`}`;

  return `
  <h1>${greet}, ${esc(s.firstName || 'Ezra')}</h1>
  <p class="lede">${esc(summary)}</p>
  ${!st.total ? `<div class="card"><h2>No classes yet</h2><p class="muted">Add the freshman classes you want to visit.</p><button class="btn primary" data-action="add-class">${icon('plus')}Add your first class</button></div>` : ''}
  <div class="kpis">
    <div class="kpi"><div class="label">Professors emailed</div><div class="value num">${st.contacted}<span class="faint" style="font-size:16px"> / ${st.total}</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="kpi"><div class="label">Said yes</div><div class="value num">${st.yes}</div><div class="sub">${st.no} declined${st.yes + st.no ? ` · ${Math.round((st.yes / (st.yes + st.no)) * 100)}% yes rate` : ''}</div></div>
    <div class="kpi"><div class="label">Students reached</div><div class="value num">${st.reached.toLocaleString()}</div><div class="sub">${st.visitedCount} class${st.visitedCount === 1 ? '' : 'es'} visited</div></div>
    <div class="kpi"><div class="label">Sign-ups</div><div class="value num">${st.signups}</div><div class="sub">${st.reached ? `${((st.signups / st.reached) * 100).toFixed(1)}% of students reached` : 'Log them after each visit'}</div></div>
  </div>
  <div class="grid two">
    <div class="card">
      <div class="card-head"><h2>Do next</h2></div>
      ${st.toLog.length ? sec('Did you visit? Log it', st.toLog.map((c) => itemRow(c, `Scheduled ${fmtDate(c.visitDate)} · mark visited & add sign-ups`)), '') : ''}
      ${sec(`Follow up (no reply in ${s.followUpDays}+ days)`, st.followUps.map((c) => itemRow(c, `Emailed ${daysSince(c.emailedAt)} days ago · ${esc(c.email)}`)), 'Nothing to follow up on.')}
      ${st.needDate.length ? sec('Said yes — pick a date', st.needDate.map((c) => itemRow(c, esc(whenText(c)))), '') : ''}
      ${sec('Email next', st.next.map((c) => itemRow(c, `${esc(c.level)} · ~${c.size || '?'} students · ${esc(whenText(c))}`)), 'Every class has been contacted.')}
    </div>
    <div class="grid" style="align-content:start">
      <div class="card">
        <div class="card-head"><h2>Upcoming visits</h2><button class="btn sm ghost" data-action="tab" data-tab="week">Schedule</button></div>
        ${st.upcoming.length ? `<div class="items">${st.upcoming.slice(0, 6).map((c) => itemRow(c, `${fmtDate(c.visitDate)} · ${esc(fmtTime(c.start))} · ${esc(where(c))}`, dateChip(c.visitDate))).join('')}</div>` : '<div class="empty">No visits booked yet. When a professor says yes, set the status to Approved and pick a date.</div>'}
      </div>
      ${st.unverified ? `<div class="note">${icon('alert')}<div><b>${st.unverified} class${st.unverified > 1 ? 'es are' : ' is'} unverified.</b> The starter list was AI-generated, so professor names, times and emails may be wrong. Check each one before emailing. <a href="#" data-action="show-unverified">Review them</a></div></div>` : ''}
      ${!s.lastName || !s.year || !s.meetingDate ? `<div class="note info">${icon('gear')}<div>Add your ${[!s.lastName && 'last name', !s.year && 'year', !s.meetingDate && 'first meeting details'].filter(Boolean).join(', ')} in <a href="#settings" data-action="tab" data-tab="settings">Settings</a> so your emails and pitch fill in automatically.</div></div>` : ''}
    </div>
  </div>`;
}

function filteredClasses() {
  const q = ui.q.trim().toLowerCase();
  let list = S.classes.filter((c) =>
    (ui.status === 'All' || c.status === ui.status) &&
    (ui.level === 'All' || c.level === ui.level) &&
    (!ui.unverified || !c.verified) &&
    (!q || [c.code, c.sec, c.title, c.prof, c.email, c.bldg, c.audience, c.notes].join(' ').toLowerCase().includes(q)));
  const sorts = {
    smart: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || smartSort(a, b),
    course: (a, b) => (a.code + a.sec).localeCompare(b.code + b.sec),
    size: (a, b) => (+b.size || 0) - (+a.size || 0),
    prof: (a, b) => lastName(a.prof).localeCompare(lastName(b.prof)),
    time: (a, b) => (a.start || '99').localeCompare(b.start || '99')
  };
  return list.sort(sorts[ui.sort] || sorts.smart);
}

function viewClasses() {
  const list = filteredClasses();
  const count = (s) => S.classes.filter((c) => s === 'All' || c.status === s).length;
  const unv = S.classes.filter((c) => !c.verified).length;
  return `
  <h1>Classes</h1>
  <p class="lede">Click a class to copy its email, update the status, or fix details.</p>
  <div class="toolbar">
    <div class="search">${icon('search')}<input id="q" type="text" placeholder="Search course, professor, building…  ( / )" value="${esc(ui.q)}" autocomplete="off" aria-label="Search classes"></div>
    <select class="inline" data-ui="level" aria-label="Year level">${['All', ...LEVELS].map((l) => `<option ${ui.level === l ? 'selected' : ''} value="${esc(l)}">${l === 'All' ? 'All levels' : esc(l)}</option>`).join('')}</select>
    <select class="inline" data-ui="sort" aria-label="Sort">${[['smart', 'Sort: next action'], ['course', 'Sort: course'], ['size', 'Sort: biggest'], ['time', 'Sort: time of day'], ['prof', 'Sort: professor']].map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </div>
  <div class="chips" style="margin-bottom:12px">
    ${['All', ...STATUSES].map((s) => `<button class="chip" data-action="filter-status" data-v="${esc(s)}" aria-pressed="${ui.status === s}">${esc(s)}<b>${count(s)}</b></button>`).join('')}
    ${unv ? `<button class="chip" data-action="toggle-unverified" aria-pressed="${ui.unverified}">Unverified<b>${unv}</b></button>` : ''}
  </div>
  <div class="table" role="list">
    <div class="row head"><div>Course</div><div>Professor</div><div>When & where</div><div>Size</div><div>Status</div></div>
    ${list.length ? list.map((c) => `
      <div class="row" role="listitem" data-action="open" data-id="${esc(c.id)}" tabindex="0">
        <div class="cell"><div class="t">${esc(c.code)}${c.sec ? '-' + esc(c.sec) : ''}</div><div class="s">${esc(c.title)}</div></div>
        <div class="cell c-prof"><div class="s" style="color:var(--text)">${esc(c.prof)}</div><div class="s mono">${esc(c.email)}</div></div>
        <div class="cell c-when"><div class="s" style="color:var(--text)">${esc(whenText(c))}</div><div class="s">${esc(where(c))}${c.visitDate && c.status === 'Approved' ? ` · visit ${fmtDate(c.visitDate)}` : ''}</div></div>
        <div class="cell c-size num s">${c.size || '–'}</div>
        <div class="cell c-status" style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">${badge(c)}${unverifiedFlag(c)}</div>
      </div>`).join('') : `<div class="empty" style="padding:24px">No classes match. <a href="#" data-action="clear-filters">Clear filters</a></div>`}
  </div>
  <p class="tiny faint" style="margin-top:10px">Showing ${list.length} of ${S.classes.length}</p>`;
}

function weekStart(offset) { const d = new Date(); d.setHours(0, 0, 0, 0); const dow = d.getDay(); d.setDate(d.getDate() - ((dow + 6) % 7) + offset * 7); return d; }
function viewWeek() {
  const start = weekStart(ui.weekOffset), t = todayISO();
  const days = DAY_ORDER.map((L, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return { L, d, iso: iso(d) }; });
  const end = days[4].d;
  const label = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  const col = ({ L, d, iso: di }) => {
    const visits = S.classes.filter((c) => (c.status === 'Approved' || c.status === 'Visited') && c.visitDate === di).sort((a, b) => a.start.localeCompare(b.start));
    const meets = ui.allTimes ? S.classes.filter((c) => c.days.includes(L) && !visits.includes(c)).sort((a, b) => a.start.localeCompare(b.start)) : [];
    return `<div class="day ${di === t ? 'today' : ''}">
      <h3><span>${DAY_LONG[L]}</span><span class="muted">${d.getDate()}</span></h3>
      ${visits.map((c) => `<div class="slot visit" data-action="open" data-id="${esc(c.id)}"><b>${esc(fmtTime(c.start))} · ${esc(c.code)} visit</b>${esc(where(c))} · ${esc(lastName(c.prof))}</div>`).join('')}
      ${meets.map((c) => `<div class="slot ${['Declined', 'Visited'].includes(c.status) ? 'dim' : ''}" data-action="open" data-id="${esc(c.id)}"><b>${esc(fmtTime(c.start))} · ${esc(c.code)}-${esc(c.sec)}</b>${esc(where(c))} · <span class="${sClass(c.status)}" style="background:none">${esc(c.status)}</span></div>`).join('')}
      ${!visits.length && !meets.length ? '<div class="tiny faint">Nothing scheduled</div>' : ''}
    </div>`;
  };
  return `
  <h1>Schedule</h1>
  <p class="lede">Booked visits are green. Turn on class times to plan back-to-back visits on the same day.</p>
  <div class="toolbar">
    <div class="btn-row"><button class="btn icon" data-action="week" data-v="-1" aria-label="Previous week">‹</button><button class="btn" data-action="week" data-v="0">This week</button><button class="btn icon" data-action="week" data-v="1" aria-label="Next week">›</button></div>
    <b>${label}</b>
    <label class="small muted" style="margin-left:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" data-action="toggle-times" ${ui.allTimes ? 'checked' : ''}> Show all class times</label>
  </div>
  <div class="days">${days.map(col).join('')}</div>`;
}

/* pitch */
let timer = { left: null, running: false, int: null };
function viewPitch() {
  const s = S.settings;
  if (timer.left === null) timer.left = +s.pitchSeconds || 90;
  const script = s.script ? s.script.split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join('') : defaultScript().map(([cue, t]) => `<p><span class="cue">${esc(cue)}</span>${esc(t)}</p>`).join('');
  return `
  <h1>Pitch</h1>
  <p class="lede">Your script, a timer, and a big QR code to put on the screen.</p>
  <div class="grid two">
    <div class="card">
      <div class="card-head"><h2>Script</h2><button class="btn sm" data-action="edit-script">${s.script ? 'Edit' : 'Customize'}</button></div>
      <div class="script">${script}</div>
      ${!s.meetingDate ? `<div class="note info" style="margin-top:6px">${icon('cal')}<div>Add your first meeting date in <a href="#settings" data-action="tab" data-tab="settings">Settings</a> and it fills in here.</div></div>` : ''}
    </div>
    <div class="grid" style="align-content:start">
      <div class="card" style="text-align:center">
        <div id="timer" class="timer">${fmtTimer(timer.left)}</div>
        <div class="btn-row" style="justify-content:center;margin-top:14px">
          <button class="btn primary" data-action="timer-toggle" id="timer-btn">${icon(timer.running ? 'pause' : 'play')}<span>${timer.running ? 'Pause' : 'Start'}</span></button>
          <button class="btn" data-action="timer-reset">${icon('reset')}Reset</button>
        </div>
        <div class="seg" style="margin-top:12px">${[60, 90, 120].map((n) => `<button data-action="timer-set" data-v="${n}" aria-pressed="${+s.pitchSeconds === n}">${n / 60 >= 1 && n % 60 === 0 ? n / 60 + ' min' : n + 's'}</button>`).join('')}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Sign-up QR</h2>${s.signupLink ? `<button class="btn sm" data-action="qr-full">${icon('qr')}Full screen</button>` : ''}</div>
        ${s.signupLink ? `<div id="qr" class="qr-box"><span class="tiny" style="color:#666">Loading…</span></div><p class="tiny muted mono" style="margin:8px 0 0;overflow-wrap:anywhere">${esc(s.signupLink)}</p>` : `<div class="empty">Add a sign-up link (Google Form, GopherLink page…) in <a href="#settings" data-action="tab" data-tab="settings">Settings</a> to get a QR code.</div>`}
      </div>
      <div class="card">
        <div class="card-head"><h2>Slide deck</h2></div>
        ${s.deckLink ? `<a class="btn gold" style="width:100%" href="${esc(s.deckLink)}" target="_blank" rel="noopener">${icon('ext')}Open deck in new tab</a>` : '<div class="empty">Add your deck link in Settings.</div>'}
      </div>
    </div>
  </div>`;
}
const fmtTimer = (n) => `${n < 0 ? '-' : ''}${Math.floor(Math.abs(n) / 60)}:${pad(Math.abs(n) % 60)}`;
function tickTimer() {
  timer.left--; const el = $('#timer');
  if (el) { el.textContent = fmtTimer(timer.left); el.classList.toggle('low', timer.left <= 10); }
  if (timer.left === 0) { beep(); toast('Time!'); }
}
function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = .1; o.start(); o.stop(a.currentTime + .4); } catch {} }

let qrLib = null;
function loadQR() {
  if (qrLib) return qrLib;
  qrLib = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; sc.onload = () => res(window.qrcode); sc.onerror = rej; document.head.appendChild(sc); });
  return qrLib;
}
async function qrSVG(text) {
  try {
    const q = (await loadQR())(0, 'M'); q.addData(text); q.make();
    let svg = q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    if (!/viewBox/.test(svg)) { const w = (svg.match(/width="(\d+)/) || [])[1]; if (w) svg = svg.replace('<svg ', `<svg viewBox="0 0 ${w} ${w}" `); }
    return svg;
  } catch {
    qrLib = null; // fall back to an image QR service if the script CDN is blocked
    return `<img alt="QR code" style="width:100%;height:auto;image-rendering:pixelated" src="https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=10&data=${encodeURIComponent(text)}">`;
  }
}
function afterPitch() {
  const el = $('#qr'); if (!el) return;
  qrSVG(S.settings.signupLink).then((svg) => { el.innerHTML = svg; });
  const t = $('#timer'); if (t) t.classList.toggle('low', timer.left <= 10);
}

/* settings */
function viewSettings() {
  const s = S.settings;
  const f = (k, label, type = 'text', extra = '') => `<label class="f ${extra}">${label}<input type="${type}" data-setting="${k}" value="${esc(s[k])}"></label>`;
  const theme = lsGet(LS.theme, 'system');
  const syncText = {
    sync: `<span class="flag ok">${icon('check')}Syncing</span> Changes save to your Vercel database and show up on every device where you've entered the passcode.`,
    local: 'Sync isn\'t set up yet, so data is saved in this browser only. Export a backup now and then.',
    offline: 'Can\'t reach the server right now. Your edits are saved here and will sync when you\'re back online.',
  }[mode] || '';
  return `
  <h1>Settings</h1>
  <p class="lede">Everything here fills into your emails and pitch automatically.</p>
  <div class="grid two">
    <div class="grid" style="align-content:start">
      <div class="card"><div class="card-head"><h2>You</h2></div>
        <div class="fields">
          ${f('firstName', 'First name')}${f('lastName', 'Last name')}
          <label class="f">Year<select data-setting="year">${['', 'Freshman', 'Sophomore', 'Junior', 'Senior'].map((y) => `<option value="${y}" ${s.year === y ? 'selected' : ''}>${y || 'Choose…'}</option>`).join('')}</select></label>
          ${f('major', 'Major (optional)')}
          ${f('title', 'Club title')}${f('clubName', 'Club name')}
          ${f('email', 'Email', 'email')}${f('phone', 'Phone (optional)')}
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>First meeting & links</h2></div>
        <div class="fields">
          ${f('meetingDate', 'Date', 'date')}${f('meetingTime', 'Time', 'time')}
          ${f('meetingPlace', 'Place (e.g. CSOM 1-135)', 'text', 'full')}
          ${f('signupLink', 'Sign-up link (for the QR code)', 'url', 'full')}
          ${f('deckLink', 'Slide deck link', 'url', 'full')}
        </div>
      </div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><div class="card-head"><h2>Outreach</h2></div>
        <div class="fields">
          <label class="f">Time to ask for<select data-setting="askMinutes">${['1–2', '2–3', '5'].map((v) => `<option ${s.askMinutes === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="f">Follow up after (days)<input type="number" min="1" max="30" data-setting="followUpDays" value="${esc(s.followUpDays)}"></label>
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>Sync & backup</h2></div>
        <p class="small" style="margin-top:0">${syncText}</p>
        <div class="btn-row">
          <button class="btn sm" data-action="export-json">Download backup</button>
          <button class="btn sm" data-action="import-json">Restore backup</button>
          <button class="btn sm" data-action="export-csv">Export CSV</button>
          <button class="btn sm" data-action="import-csv">Import classes (CSV)</button>
          ${mode === 'sync' ? '<button class="btn sm ghost" data-action="lock">Lock this device</button>' : ''}
        </div>
        <p class="tiny faint" style="margin-bottom:0">CSV columns: code, sec, title, days (e.g. MWF or TTh), start, end (e.g. 9:05 AM), bldg, room, prof, email, size, level</p>
      </div>
      <div class="card"><div class="card-head"><h2>Appearance</h2></div>
        <div class="seg">${['system', 'light', 'dark'].map((t) => `<button data-action="theme" data-v="${t}" aria-pressed="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      </div>
      <div class="card"><div class="card-head"><h2>Reset</h2></div>
        <div class="btn-row">
          <button class="btn sm" data-action="reset-status">Set all to “To contact”</button>
          <button class="btn sm danger" data-action="remove-unverified">Delete unverified classes</button>
        </div>
      </div>
    </div>
  </div>`;
}

function viewLock() {
  const had = !!lsGet(LS.pass);
  return `<form class="lock" data-form="unlock">
    <div class="logo">AI</div>
    <h1>Enter passcode</h1>
    <p class="muted">${had ? 'That passcode didn\'t work. ' : ''}This keeps your outreach list private.</p>
    <input type="password" id="pass" autocomplete="current-password" placeholder="Passcode" required style="text-align:center;margin-bottom:10px">
    <button class="btn primary" style="width:100%">Unlock</button>
  </form>`;
}

/* ---------- drawer ---------- */
let emailKind = null;
function openDrawer(id) {
  drawerId = id; emailKind = defaultKind(byId(id));
  $('#drawer-wrap').hidden = false; renderDrawer(true);
  document.body.style.overflow = 'hidden';
}
function closeDrawer() { drawerId = null; $('#drawer-wrap').hidden = true; document.body.style.overflow = ''; }
function renderDrawer(fresh) {
  const c = byId(drawerId); if (!c) return closeDrawer();
  const d = $('#drawer'), top = fresh ? 0 : d.scrollTop;
  const fld = (k, label, type = 'text', extra = '') => `<label class="f ${extra}">${label}<input type="${type}" data-field="${k}" value="${esc(c[k])}"></label>`;
  const showVisit = c.status === 'Approved' || c.status === 'Visited';
  d.innerHTML = `
  <div class="drawer-head">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
      <div style="min-width:0">
        <h2 id="drawer-title">${esc(c.code)}${c.sec ? '-' + esc(c.sec) : ''} <span class="muted" style="font-weight:500">${esc(c.title)}</span></h2>
        <div class="small muted">${esc(c.prof)} · ${esc(whenText(c))} · ${esc(where(c))}</div>
      </div>
      <button class="btn icon sm ghost" data-action="close-drawer" aria-label="Close">${icon('x')}</button>
    </div>
  </div>
  <div class="drawer-body">
    <div>
      <div class="section-label">Status</div>
      <div class="status-picker">${STATUSES.map((s) => `<button class="${sClass(s)}" data-action="set-status" data-v="${esc(s)}" aria-pressed="${c.status === s}">${esc(s)}</button>`).join('')}</div>
      <div class="tiny muted" style="margin-top:6px">${[c.emailedAt && `Emailed ${fmtDate(c.emailedAt)}`, c.followedUpAt && `followed up ${fmtDate(c.followedUpAt)}`].filter(Boolean).join(', ')}</div>
    </div>
    ${showVisit ? `<div class="fields">
      <label class="f">Visit date<input type="date" data-field="visitDate" value="${esc(c.visitDate)}" ${c.status === 'Approved' && !c.visitDate ? 'autofocus' : ''}></label>
      <label class="f">Sign-ups from this class<input type="number" min="0" data-field="signups" value="${esc(c.signups)}"></label>
    </div>` : ''}
    ${!c.verified ? `<div class="note">${icon('alert')}<div><b>Check before emailing.</b> This class came from the AI-generated starter list. Confirm the professor, time and email.
      <div class="btn-row" style="margin-top:8px">
        <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(`"${c.prof}" University of Minnesota email`)}">${icon('search')}Look up professor</a>
        <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(`University of Minnesota ${c.code} class schedule fall 2026`)}">${icon('cal')}Find class times</a>
        <button class="btn sm primary" data-action="verify">${icon('check')}Looks right</button>
      </div></div></div>` : ''}
    <div>
      <div class="section-label">Email</div>
      <div class="seg" style="margin-bottom:10px">${[['ask', 'First ask'], ['followup', 'Follow-up'], ['confirm', 'Confirm'], ['thanks', 'Thank you']].map(([k, l]) => `<button data-action="email-kind" data-v="${k}" aria-pressed="${emailKind === k}">${l}</button>`).join('')}</div>
      <div id="email-area">${emailArea(c)}</div>
    </div>
    <div>
      <div class="section-label">Notes</div>
      <textarea data-field="notes" rows="3" placeholder="e.g. Prefers end of class. TA is Sam.">${esc(c.notes)}</textarea>
    </div>
    <details ${c.code ? '' : 'open'}>
      <summary class="section-label" style="cursor:pointer">Class details</summary>
      <div class="fields" style="margin-top:8px">
        ${fld('code', 'Course code')}${fld('sec', 'Section')}
        ${fld('title', 'Title', 'text', 'full')}
        ${fld('prof', 'Professor')}${fld('email', 'Professor email', 'email')}
        <div class="f full"><span>Days</span><div class="chips">${DAY_ORDER.map((L) => `<button class="chip" data-action="toggle-day" data-v="${L}" aria-pressed="${c.days.includes(L)}">${DAY_LONG[L].slice(0, 3)}</button>`).join('')}</div></div>
        ${fld('start', 'Starts', 'time')}${fld('end', 'Ends', 'time')}
        <label class="f">Building<select data-field="bldg">${BUILDINGS.concat(BUILDINGS.includes(c.bldg) || !c.bldg ? [] : [c.bldg]).map((b) => `<option ${c.bldg === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>
        ${fld('room', 'Room')}
        ${fld('size', 'Class size', 'number')}
        <label class="f">Level<select data-field="level">${LEVELS.map((l) => `<option ${c.level === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      </div>
    </details>
    <div class="btn-row" style="justify-content:space-between;border-top:1px solid var(--line);padding-top:14px">
      ${c.verified ? `<button class="btn sm ghost" data-action="unverify">Mark unverified</button>` : '<span></span>'}
      <button class="btn sm danger" data-action="delete">${icon('trash')}Delete class</button>
    </div>
  </div>`;
  d.scrollTop = top;
  const af = d.querySelector('[autofocus]'); if (af && fresh) af.focus();
}
function emailArea(c) {
  const e = emailFor(emailKind, c), miss = missingFor(emailKind);
  const mailto = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(e.body)}`;
  return `
    ${miss.length ? `<div class="note info" style="margin-bottom:10px">${icon('gear')}<div>Add your ${miss.join(' & ')} in <a href="#settings" data-action="tab" data-tab="settings">Settings</a> to fill the [brackets].</div></div>` : ''}
    <div class="email-box">
      <div class="email-line"><span class="k">To</span><span class="v mono">${esc(c.email) || '<span class="faint">No email yet</span>'}</span><button class="btn icon sm ghost" data-action="copy" data-what="to" aria-label="Copy email address">${icon('copy')}</button></div>
      <div class="email-line"><span class="k">Subject</span><span class="v">${esc(e.subject)}</span><button class="btn icon sm ghost" data-action="copy" data-what="subject" aria-label="Copy subject">${icon('copy')}</button></div>
      <textarea id="email-body" class="email-body" aria-label="Email body (you can edit before copying)">${esc(e.body)}</textarea>
    </div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn primary" data-action="copy" data-what="body">${icon('copy')}Copy email</button>
      <a class="btn" href="${esc(mailto)}">${icon('mail')}Open in mail app</a>
    </div>`;
}

function setStatus(c, s) {
  const t = todayISO(), prev = c.status;
  c.status = s;
  if (s === 'Emailed' && !c.emailedAt) c.emailedAt = t;
  if (s === 'Followed up') { if (!c.emailedAt) c.emailedAt = t; c.followedUpAt = t; }
  if (s === 'Visited' && !c.visitDate) c.visitDate = t;
  if (s === 'To contact') { c.emailedAt = ''; c.followedUpAt = ''; }
  emailKind = defaultKind(c);
  commit(`${c.code}${c.sec ? '-' + c.sec : ''}: ${prev} → ${s}`);
  if (drawerId === c.id) renderDrawer();
}

/* ---------- modal ---------- */
function openModal(html) { $('#modal').innerHTML = html; $('#modal-wrap').hidden = false; const i = $('#modal input, #modal textarea'); if (i) i.focus(); }
function closeModal() { $('#modal-wrap').hidden = true; $('#modal').innerHTML = ''; }
let confirmCb = null;
function confirmBox(title, text, ok, cb, danger) {
  confirmCb = cb;
  openModal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p><div class="btn-row" style="justify-content:flex-end"><button class="btn" data-action="close-modal">Cancel</button><button class="btn ${danger ? 'primary' : 'primary'}" data-action="confirm-ok">${esc(ok)}</button></div>`);
}
function addClassModal() {
  openModal(`<form data-form="add">
    <h2 style="margin-bottom:12px">Add a class</h2>
    <div class="fields">
      <label class="f">Course code *<input name="code" required placeholder="MGMT 1001"></label>
      <label class="f">Section<input name="sec" placeholder="001"></label>
      <label class="f full">Title<input name="title" placeholder="Contemporary Management"></label>
      <label class="f">Professor *<input name="prof" required placeholder="Jane Doe"></label>
      <label class="f">Professor email<input name="email" type="email" placeholder="doe00123@umn.edu"></label>
      <label class="f">Days<input name="days" placeholder="MWF or TTh"></label>
      <label class="f">Class size<input name="size" type="number" min="0" placeholder="120"></label>
      <label class="f">Starts<input name="start" type="time"></label>
      <label class="f">Ends<input name="end" type="time"></label>
      <label class="f">Building<select name="bldg">${BUILDINGS.map((b) => `<option>${b}</option>`).join('')}</select></label>
      <label class="f">Room<input name="room" placeholder="1-102"></label>
      <label class="f full">Level<select name="level">${LEVELS.map((l) => `<option>${l}</option>`).join('')}</select></label>
    </div>
    <div class="btn-row" style="justify-content:flex-end;margin-top:16px"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary">Add class</button></div>
  </form>`);
}
const parseDays = (s) => { s = String(s || '').toUpperCase().replace(/TH|THU|THUR|R/g, 'R').replace(/[^MTWRF]/g, ''); return DAY_ORDER.filter((d) => s.includes(d)); };
function parseTime(s) {
  s = String(s || '').trim(); if (!s) return '';
  const m = s.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i); if (!m) return '';
  let h = +m[1]; const mi = +(m[2] || 0), ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  return `${pad(h)}:${pad(mi)}`;
}

/* ---------- import / export ---------- */
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
const CSV_COLS = ['code', 'sec', 'title', 'days', 'start', 'end', 'bldg', 'room', 'prof', 'email', 'size', 'level', 'status', 'verified', 'emailedAt', 'visitDate', 'signups', 'notes'];
function toCSV() {
  const q = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return [CSV_COLS.join(','), ...S.classes.map((c) => CSV_COLS.map((k) => q(k === 'days' ? daysShort(c) : k === 'start' || k === 'end' ? fmtTime(c[k]) : c[k])).join(','))].join('\n');
}
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
function pickFile(accept, cb) { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => { const f = i.files[0]; if (f) f.text().then(cb); }; i.click(); }

/* ---------- toasts & clipboard ---------- */
let toastAction = null;
function toast(msg, action) {
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { action.fn(); t.remove(); };
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), action ? 6000 : 2600);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); return ok; }
}

/* ---------- theme ---------- */
function applyTheme() { const t = lsGet(LS.theme, 'system'); if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t; }

/* ---------- events ---------- */
function go(tab) { ui.tab = tab; saveUI(); if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab); render(); $('#view').focus({ preventScroll: true }); window.scrollTo(0, 0); }

const ACTIONS = {
  tab: (el) => { closeDrawer(); closeModal(); go(el.dataset.tab); },
  open: (el) => openDrawer(el.dataset.id),
  'close-drawer': closeDrawer,
  'close-modal': closeModal,
  'add-class': addClassModal,
  'filter-status': (el) => { ui.status = el.dataset.v; saveUI(); render(); },
  'toggle-unverified': () => { ui.unverified = !ui.unverified; saveUI(); render(); },
  'clear-filters': () => { Object.assign(ui, { status: 'All', level: 'All', q: '', unverified: false }); saveUI(); render(); },
  'show-unverified': () => { Object.assign(ui, { status: 'All', level: 'All', q: '', unverified: true }); go('classes'); },
  week: (el) => { ui.weekOffset = el.dataset.v === '0' ? 0 : ui.weekOffset + +el.dataset.v; saveUI(); render(); },
  'set-status': (el) => setStatus(byId(drawerId), el.dataset.v),
  'email-kind': (el) => { emailKind = el.dataset.v; renderDrawer(); },
  verify: () => { const c = byId(drawerId); c.verified = true; commit('Marked as verified'); renderDrawer(); },
  unverify: () => { const c = byId(drawerId); c.verified = false; commit('Marked as unverified'); renderDrawer(); },
  'toggle-day': (el) => { const c = byId(drawerId), L = el.dataset.v; c.days = c.days.includes(L) ? c.days.filter((d) => d !== L) : DAY_ORDER.filter((d) => d === L || c.days.includes(d)); commit(); renderDrawer(); },
  delete: () => { const c = byId(drawerId); snapshot(); S.classes = S.classes.filter((x) => x !== c); closeDrawer(); commit(`Deleted ${c.code}`, { action: { label: 'Undo', fn: undo } }); },
  copy: async (el) => {
    const c = byId(drawerId), e = emailFor(emailKind, c), w = el.dataset.what;
    const text = w === 'to' ? c.email : w === 'subject' ? e.subject : $('#email-body').value;
    if (!(await copyText(text))) return toast('Couldn\'t copy — select the text and copy manually');
    const next = { ask: ['To contact', 'Emailed'], followup: ['Emailed', 'Followed up'] }[emailKind];
    if (w === 'body' && next && c.status === next[0]) toast('Email copied', { label: `Mark as ${next[1].toLowerCase()}`, fn: () => setStatus(c, next[1]) });
    else toast(w === 'to' ? 'Address copied' : w === 'subject' ? 'Subject copied' : 'Email copied');
  },
  'timer-toggle': () => {
    timer.running = !timer.running;
    clearInterval(timer.int);
    if (timer.running) timer.int = setInterval(tickTimer, 1000);
    const b = $('#timer-btn'); if (b) b.innerHTML = `${icon(timer.running ? 'pause' : 'play')}<span>${timer.running ? 'Pause' : 'Start'}</span>`;
  },
  'timer-reset': () => { clearInterval(timer.int); timer.running = false; timer.left = +S.settings.pitchSeconds || 90; render(); },
  'timer-set': (el) => { S.settings.pitchSeconds = +el.dataset.v; clearInterval(timer.int); timer.running = false; timer.left = +el.dataset.v; commit(); },
  'qr-full': async () => {
    const box = $('#qr-full'); box.hidden = false;
    box.innerHTML = `<div class="inner">${await qrSVG(S.settings.signupLink)}<div style="margin-top:2vmin">Scan to join the ${esc(S.settings.clubName)}</div><div style="font-weight:500;font-size:2.2vmin;color:#555">${esc(meetingText(''))}</div></div>`;
  },
  'close-qr': () => { $('#qr-full').hidden = true; },
  'edit-script': () => {
    const cur = S.settings.script || defaultScript().map(([, t]) => t).join('\n\n');
    openModal(`<form data-form="script"><h2>Pitch script</h2><p class="small muted">Leave a blank line between parts. Clear it to go back to the automatic script.</p><textarea name="script" rows="14">${esc(cur)}</textarea>
      <div class="btn-row" style="justify-content:space-between;margin-top:12px"><button type="button" class="btn ghost" data-action="script-default">Use automatic script</button><span class="btn-row"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary">Save</button></span></div></form>`);
  },
  'script-default': () => { S.settings.script = ''; closeModal(); commit('Using the automatic script'); },
  theme: (el) => { lsSet(LS.theme, el.dataset.v); applyTheme(); render(); },
  'export-json': () => download(`aib-recruiting-backup-${todayISO()}.json`, JSON.stringify(S, null, 2), 'application/json'),
  'export-csv': () => download(`aib-classes-${todayISO()}.csv`, toCSV(), 'text/csv'),
  'import-json': () => pickFile('.json,application/json', (t) => {
    const d = safeJSON(t, null); if (!d || !Array.isArray(d.classes)) return toast('That file isn\'t a backup from this site');
    confirmBox('Restore backup?', `This replaces everything with the ${d.classes.length} classes in the backup.`, 'Restore', () => { snapshot(); S = normalize(d); commit('Backup restored', { action: { label: 'Undo', fn: undo } }); });
  }),
  'import-csv': () => pickFile('.csv,text/csv', (t) => {
    let rows; try { rows = parseCSV(t); } catch { rows = []; }
    const add = rows.filter((r) => r.code).map((r) => normalize({ classes: [{
      id: uid(), code: r.code.toUpperCase(), sec: r.sec || r.section || '', title: r.title || '', days: parseDays(r.days), start: parseTime(r.start), end: parseTime(r.end),
      bldg: r.bldg || r.building || '', room: r.room || '', prof: (r.prof || r.professor || '').replace(/^Prof\.?\s*/i, ''), email: r.email || '', size: +r.size || 0,
      level: LEVELS.includes(r.level) ? r.level : 'Freshman', status: STATUSES.includes(r.status) ? r.status : 'To contact', verified: /^(true|yes|1)$/i.test(r.verified || 'yes'),
      emailedAt: r.emailedat || '', visitDate: r.visitdate || '', signups: +r.signups || 0, notes: r.notes || ''
    }] }).classes[0]);
    if (!add.length) return toast('No classes found — check the column names');
    snapshot(); S.classes.push(...add); commit(`Imported ${add.length} classes`, { action: { label: 'Undo', fn: undo } });
  }),
  lock: () => { lsDel(LS.pass); setMode('locked'); },
  'reset-status': () => confirmBox('Set every class to “To contact”?', 'Clears all statuses, email dates and visit dates. Notes and sign-ups are kept.', 'Reset statuses', () => {
    snapshot(); S.classes.forEach((c) => Object.assign(c, { status: 'To contact', emailedAt: '', followedUpAt: '', visitDate: '' })); commit('All set to To contact', { action: { label: 'Undo', fn: undo } });
  }),
  'remove-unverified': () => { const n = S.classes.filter((c) => !c.verified).length; if (!n) return toast('No unverified classes'); confirmBox(`Delete ${n} unverified classes?`, 'Removes every class you haven\'t marked as checked. You can undo right after.', 'Delete', () => { snapshot(); S.classes = S.classes.filter((c) => c.verified); commit(`Deleted ${n} classes`, { action: { label: 'Undo', fn: undo } }); }, true); },
  'confirm-ok': () => { const cb = confirmCb; confirmCb = null; closeModal(); if (cb) cb(); }
};

function bind() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]'); if (!el) return;
    if (el.tagName === 'INPUT') return;          // checkboxes handled on change
    const fn = ACTIONS[el.dataset.action]; if (!fn) return;
    if (el.tagName === 'A' && !el.target) e.preventDefault();
    if (el.tagName === 'A' && el.target) return;
    fn(el, e);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('#qr-full').hidden) return ACTIONS['close-qr'](); if (!$('#modal-wrap').hidden) return closeModal(); if (drawerId) return closeDrawer(); }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (typing) return;
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement.dataset.action === 'open') { e.preventDefault(); openDrawer(document.activeElement.dataset.id); }
    if (e.key === '/' && ui.tab === 'classes') { e.preventDefault(); $('#q')?.focus(); }
    if (e.key === 'n' && !drawerId && $('#modal-wrap').hidden) { e.preventDefault(); addClassModal(); }
  });
  let qT;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'q') { ui.q = t.value; clearTimeout(qT); qT = setTimeout(() => { saveUI(); render(); }, 120); return; }
    if (t.dataset.field && drawerId && t.type !== 'date' && t.tagName !== 'SELECT') { setField(t); }
    if (t.dataset.setting && t.tagName !== 'SELECT' && t.type !== 'date' && t.type !== 'time') { setSetting(t); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.ui) { ui[t.dataset.ui] = t.value; saveUI(); render(); }
    if (t.dataset.action === 'toggle-times') { ui.allTimes = t.checked; saveUI(); render(); }
    if (t.dataset.field && drawerId && (t.type === 'date' || t.tagName === 'SELECT')) { setField(t); }
    if (t.dataset.setting && (t.tagName === 'SELECT' || t.type === 'date' || t.type === 'time')) { setSetting(t); }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
    if (f.dataset.form === 'unlock') { lsSet(LS.pass, $('#pass').value); setMode('loading'); await connect(); }
    if (f.dataset.form === 'add') {
      const d = Object.fromEntries(new FormData(f));
      const c = normalize({ classes: [{ id: uid(), code: d.code.trim().toUpperCase(), sec: d.sec.trim(), title: d.title.trim(), prof: d.prof.trim().replace(/^Prof\.?\s*/i, ''), email: d.email.trim(), days: parseDays(d.days), start: d.start, end: d.end, bldg: d.bldg, room: d.room.trim(), size: +d.size || 0, level: d.level, verified: true }] }).classes[0];
      S.classes.push(c); closeModal(); commit(`Added ${c.code}`); openDrawer(c.id);
    }
    if (f.dataset.form === 'script') { S.settings.script = f.script.value.trim(); closeModal(); commit('Script saved'); }
  });
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (VIEWS[t] && t !== ui.tab) go(t); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  window.addEventListener('online', () => { if (mode === 'offline') connect(); else if (lsGet(LS.dirty) === '1') schedulePush(); });
}

let fieldT, setT;
function setField(t) {
  const c = byId(drawerId); if (!c) return;
  const k = t.dataset.field;
  c[k] = t.type === 'number' ? Math.max(0, +t.value || 0) : t.value;
  if (k === 'code') c[k] = c[k].toUpperCase();
  clearTimeout(fieldT);
  const area = $('#email-area');
  if (area && ['prof', 'email', 'code', 'start', 'bldg', 'room', 'visitDate'].includes(k)) {
    area.innerHTML = emailArea(c);
  }
  fieldT = setTimeout(() => commit(null), t.tagName === 'TEXTAREA' || t.type === 'text' || t.type === 'email' ? 400 : 0);
}
function setSetting(t) {
  const k = t.dataset.setting;
  S.settings[k] = t.type === 'number' ? Math.max(1, +t.value || 1) : t.value;
  clearTimeout(setT);
  setT = setTimeout(() => commit(null, { quiet: true }), 400);
}

/* ---------- boot ---------- */
function boot() {
  applyTheme();
  loadLocal();
  const h = location.hash.slice(1); if (VIEWS[h]) ui.tab = h;
  bind();
  render();
  connect();
}
boot();
})();
