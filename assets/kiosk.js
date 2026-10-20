/* Tablet survey. It can only send responses — there is no way from here to the dashboard. */
(function () {
  'use strict';
  const { $, esc, lsGet, lsSet, lsDel, face, RATINGS, SCALE, EXPECT, uid } = window.LB;
  const S = window.LB_STORE;
  const stCode = n => String(n || '').replace(/[^\p{L}]/gu, '').slice(0, 2).toLowerCase();
  const T = {
    en: { welcome: "We'd love to hear about your experience!", welcomeSub: 'Your feedback is anonymous and helps us keep the highest standards of food and service.', start: 'Start',
      step: (i, n) => `Question ${i} of ${n}`, expectQ: 'Did the meal meet your expectations?', textQ: 'Anything you would like to tell us?', textSub: 'Optional. Skip if you are in a hurry.', next: 'Next', skipNext: 'Skip', moreQ: 'Any additional comments?', skipSend: 'Skip and submit',
      enjoyed: 'What did you enjoy most about your meal today?', improve: 'What can we improve?', comments: 'Additional comments', submit: 'Submit', back: 'Back',
      thanks: 'Thank you!', thanksSub: 'Your feedback helps us improve our food, service and overall dining experience.', backIn: (n) => `Back to the start in ${n}… tap anywhere to start now`, anon: 'Anonymous', offline: 'Saved on this tablet, will sync',
      station: 'Station: ', login: 'Station login', loginSub: "Choose this tablet's station and enter the station code. Needed once per tablet.", stLabel: 'Station', code: 'Code', loginBtn: 'Log in', wrong: 'Wrong code', noNet: 'No connection. Check the internet and try again.',
      signin: 'Connect this tablet', signinSub: 'Sign in once with the Li-Bar tablet account. Diners never need to sign in.', signinBtn: 'Sign in with Microsoft' },
    he: { welcome: 'נשמח לשמוע איך היה!', welcomeSub: 'המשוב אנונימי לחלוטין ועוזר לנו לשמור על רמה גבוהה של אוכל ושירות.', start: 'התחלה',
      step: (i, n) => `שאלה ${i} מתוך ${n}`, expectQ: 'האם הארוחה עמדה בציפיות שלך?', textQ: 'רוצה להוסיף משהו?', textSub: 'לא חובה. אפשר לדלג.', next: 'המשך', skipNext: 'דלג', moreQ: 'הערות נוספות?', skipSend: 'דלג ושלח',
      enjoyed: 'מה הכי אהבת בארוחה היום?', improve: 'מה אפשר לשפר?', comments: 'הערות נוספות', submit: 'שליחה', back: 'חזרה',
      thanks: 'תודה רבה!', thanksSub: 'המשוב שלך עוזר לנו לשפר את האוכל, השירות וחוויית הארוחה.', backIn: (n) => `חוזרים למסך הפתיחה בעוד ${n}… אפשר לגעת במסך כדי להתחיל מיד`, anon: 'אנונימי', offline: 'נשמר בטאבלט, יסונכרן',
      station: 'תחנה: ', login: 'התחברות תחנה', loginSub: 'בחרי את התחנה של הטאבלט והזיני את קוד התחנה. פעם אחת בלבד לכל טאבלט.', stLabel: 'תחנה', code: 'קוד', loginBtn: 'התחברות', wrong: 'קוד שגוי', noNet: 'אין חיבור לאינטרנט. בדקי את החיבור ונסי שוב.',
      signin: 'חיבור הטאבלט', signinSub: 'התחברות חד-פעמית עם חשבון הטאבלט של לי-בר. הסועדים לא צריכים להתחבר.', signinBtn: 'התחברות עם Microsoft' }
  };
  const STEPS = ['r0', 'r1', 'r2', 'r3', 'expect', 'text', 'more'];
  let lang = lsGet('lb_lang', 'en');
  let session = lsGet('lb_kiosk', null);          // {station:{id,name,partnerLogo,partnerName}}
  let signedIn = null, loadErr = null, saveErr = null;
  let stations = lsGet('lb_stations_cache', []);
  let outbox = lsGet('lb_outbox', []);
  let step = 'start', ans = {}, idleT = null, thanksT = null;
  // ?demo — preview the survey without signing in; nothing is saved
  const demo = new URLSearchParams(location.search).has('demo');
  const linkStation = new URLSearchParams(location.search).get('station') || (() => { try { return sessionStorage.getItem('lb_link_station'); } catch (e) { return null; } })();

  $('kBrand').innerHTML = window.LB.brandHTML();

  /* ---------- station & status ---------- */
  function paintStation() {
    const st = session && session.station;
    $('kStation').textContent = st ? T[lang].station + st.name : '';
    const p = $('kPartner');
    p.hidden = !(st && st.partnerLogo);
    p.innerHTML = st && st.partnerLogo ? `<img src="${esc(st.partnerLogo)}" alt="${esc(st.partnerName || '')}">` : '';
  }
  function setStatus() {
    const off = outbox.length > 0;
    $('kStatus').classList.toggle('off', off);
    $('kStatusTxt').textContent = demo ? (lang === 'he' ? 'מצב תצוגה – לא נשמר' : 'Preview – not saved') : off ? `${outbox.length} ${lang === 'he' ? 'משובים ממתינים – לחצי לפרטים' : 'waiting – tap for details'}` : T[lang].anon;
  }
  // tap the status when responses are waiting: shows why saving failed and tries again now
  $('kStatus').addEventListener('click', async () => {
    if (!outbox.length || demo) return;
    const who = S.email ? S.email() : '';
    const e = saveErr || {};
    const why = e.status === 403 || e.status === 401 || /denied|forbidden|access/i.test(e.message || '')
      ? `לחשבון ${who} אין הרשאת כתיבה לרשימה LBFeedbackResponses. צריך לתת לו הרשאת "תרומה" (Contribute) ברשימה הזו.`
      : e.status === 404 ? 'רשימת המשובים לא נמצאה ב-SharePoint.'
      : !navigator.onLine ? 'אין חיבור לאינטרנט.'
      : `שגיאה בשמירה: ${e.message || 'לא ידועה'}${e.status ? ' (' + e.status + ')' : ''}`;
    $('kMain').innerHTML = `<h1>${outbox.length} משובים ממתינים בטאבלט</h1><p class="k-sub">${esc(why)}</p><p class="k-sub" dir="ltr" style="font-size:13px">${esc(who)}</p>
      <div class="k-actions"><button class="primary" id="syncNow">נסה לשלוח עכשיו</button><button class="ghost" id="syncBack">חזרה לסקר</button></div>`;
    $('syncNow').onclick = async () => { $('syncNow').disabled = true; await flushOutbox(); if (!outbox.length) { toastOk(); reset(); } else { $('kStatus').click(); } };
    $('syncBack').onclick = () => reset();
  });
  function toastOk() { const t = $('toast'); if (t) { t.textContent = 'כל המשובים נשלחו'; t.hidden = false; setTimeout(() => t.hidden = true, 2500); } }
  async function loadStations() {
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => { const e = new Error('timeout'); e.code = 'timeout'; rej(e); }, 20000));
      const list = await Promise.race([S.stations(), timeout]);
      if (!list.length) { const e = new Error('empty'); e.code = 'empty'; throw e; }
      stations = list.map(x => ({ id: x.id, name: x.name, partnerLogo: x.partnerLogo, partnerName: x.partnerName }));
      lsSet('lb_stations_cache', stations);
      // keep the bound station's details fresh (name, partner logo)
      if (session) { const fresh = stations.find(s => s.id === session.station.id); if (fresh) { session.station = fresh; lsSet('lb_kiosk', session); } }
      loadErr = null;
    } catch (e) { console.error(e); loadErr = e; }
    paintStation();
    if (step === 'start' || step === 'login') render();
  }
  async function flushOutbox() {
    if (!outbox.length || !session) return;
    const rest = [];
    for (const rec of outbox) {
      try {
        await S.submit(session.station, rec);
      } catch (e) { rest.push(rec); saveErr = e; }
    }
    outbox = rest; lsSet('lb_outbox', outbox); setStatus();
  }

  /* ---------- language ---------- */
  function setLang(l) {
    lang = l; lsSet('lb_lang', l);
    const k = $('kiosk'); k.dir = l === 'he' ? 'rtl' : 'ltr'; k.lang = l;
    $('lEn').setAttribute('aria-pressed', l === 'en'); $('lHe').setAttribute('aria-pressed', l === 'he');
    setStatus(); paintStation(); render();
  }
  $('lEn').onclick = () => setLang('en'); $('lHe').onclick = () => setLang('he');

  /* ---------- flow ---------- */
  const needsLogin = () => !session || (linkStation && linkStation !== session.station.id);
  function go(s) { step = s; $('kMain').onclick = null; render(); armIdle(); }
  function armIdle() { clearTimeout(idleT); if (step !== 'start' && step !== 'thanks' && step !== 'login') idleT = setTimeout(reset, 60000); }
  function reset() { ans = {}; go(needsLogin() ? 'login' : 'start'); }
  document.addEventListener('pointerdown', armIdle, { passive: true });

  function render() {
    const t = T[lang], m = $('kMain');
    if (!window.LB.configured()) {
      m.innerHTML = `<div class="setup-msg" dir="rtl"><h2 style="font-size:22px;margin-bottom:6px">הדף עוד לא מחובר</h2>
        <p style="margin:0">חסרים פרטי החיבור ל-Microsoft 365 בקובץ <code>config.js</code>.</p></div>`;
      $('kProg').style.visibility = 'hidden';
      return;
    }
    if (signedIn === null) { m.innerHTML = ''; $('kProg').style.visibility = 'hidden'; return; }
    if (!signedIn) {
      $('kProg').style.visibility = 'hidden';
      m.innerHTML = `<h1>${t.signin}</h1><p class="k-sub">${t.signinSub}</p><button class="primary" id="msIn">${t.signinBtn}</button>`;
      $('msIn').onclick = () => { try { if (linkStation) sessionStorage.setItem('lb_link_station', linkStation); } catch (e) {} S.login(); };
      return;
    }
    if ((step === 'start' || step === 'login') && needsLogin()) step = 'login';
    const idx = STEPS.indexOf(step);
    $('kProg').innerHTML = STEPS.map((_, i) => `<i class="${idx >= 0 && i <= idx || step === 'thanks' ? 'on' : ''}"></i>`).join('');
    $('kProg').style.visibility = step === 'start' || step === 'login' ? 'hidden' : 'visible';

    if (step === 'login' && !stations.length) {
      const who = esc(S.email ? S.email() : '');
      const why = !loadErr ? 'טוען תחנות…'
        : loadErr.code === 'empty' ? `החשבון <b dir="ltr">${who}</b> מחובר, אבל לא רואה אף תחנה ברשימה. צריך לתת לחשבון הזה הרשאת קריאה (Read) לרשימה LBFeedbackStations ב-SharePoint, או להתחבר עם חשבון אחר.`
        : loadErr.code === 'timeout' ? 'הטעינה לוקחת יותר מדי זמן. בדקי את החיבור לאינטרנט ונסי שוב.'
        : loadErr.code === 'missing_list' ? 'רשימות המשוב עוד לא הוקמו ב-SharePoint. יש להיכנס לדשבורד וללחוץ "הקמת הרשימות".'
        : (loadErr.status === 401 || loadErr.status === 403 || /access|denied|forbidden/i.test(loadErr.message || '')) ? `לחשבון <b dir="ltr">${who}</b> אין הרשאה לאתר SharePoint של לי-בר. צריך לבקש מ-IT לתת לחשבון הזה הרשאת קריאה לאתר leebar.`
        : (loadErr.status === 404) ? 'האתר leebar לא נמצא ב-SharePoint. בדקי את config.js.'
        : `לא הצלחתי לטעון את התחנות (${esc(loadErr.message || 'שגיאה')}).`;
      m.innerHTML = `<h1>${t.login}</h1><p class="k-sub">${why}</p>${loadErr ? `<div class="k-actions"><button class="primary" id="rtry">נסה שוב</button><button class="ghost" id="swUser">התחברות עם משתמש אחר</button></div><p class="k-sub" style="font-size:13px" dir="ltr">${who}</p>` : ''}`;
      if (loadErr) { $('rtry').onclick = () => { loadErr = null; render(); loadStations(); }; $('swUser').onclick = () => S.logout(); }
      return;
    }
    if (step === 'login') {
      const pre = linkStation || (session && session.station.id);
      m.innerHTML = `<h1>${t.login}</h1><p class="k-sub">${t.loginSub}</p>
        <form class="login" id="lgForm"><label for="lgSt">${t.stLabel}<select id="lgSt">${stations.map(x => `<option value="${esc(x.id)}"${x.id === pre ? ' selected' : ''}>${esc(x.name)}</option>`).join('') || '<option value="">…</option>'}</select></label>
        <label for="lgPin">${t.code}<input id="lgPin" type="password" maxlength="6" autocomplete="off" autocapitalize="off"></label>
        <div class="err" id="lgErr" role="alert"></div>
        <button class="primary" type="submit" id="lgBtn">${t.loginBtn}</button></form>`;
      $('lgForm').onsubmit = async e => {
        e.preventDefault();
        const st = stations.find(x => x.id === $('lgSt').value);
        const code = $('lgPin').value.replace(/\s/g, '').toLowerCase();
        if (!st || !code || code !== stCode(st.name)) { $('lgErr').textContent = t.wrong; $('lgPin').value = ''; return; }
        session = { station: st }; lsSet('lb_kiosk', session);
        try { sessionStorage.removeItem('lb_link_station'); } catch (e) {}
        if (location.search) history.replaceState(null, '', location.pathname);
        paintStation(); flushOutbox(); go('start');
      };
      return;
    }
    if (step === 'start') {
      m.innerHTML = `<div class="hero-faces">${[1, 2, 3, 4, 5].map(face).join('')}</div>
        <h1>${t.welcome}</h1><p class="k-sub">${t.welcomeSub}</p>
        <button class="primary" id="go">${t.start}</button>`;
      $('go').onclick = () => go('r0');
    } else if (step[0] === 'r') {
      const i = +step[1], q = RATINGS[i];
      m.innerHTML = `<div class="k-step">${t.step(i + 1, STEPS.length)}</div><h1>${q[lang]}</h1>
        <div class="faces" role="group" aria-label="${esc(q[lang])}">${[1, 2, 3, 4, 5].map(s => `
          <button class="face${ans[q.k] === s ? ' sel' : ''}" data-s="${s}" aria-label="${s} – ${SCALE[lang][s - 1]}">${face(s)}<span class="n num">${s}</span><span class="l">${SCALE[lang][s - 1]}</span></button>`).join('')}</div>
        ${i > 0 ? `<div class="k-actions"><button class="ghost" id="bk">${t.back}</button></div>` : ''}`;
      m.querySelectorAll('.face').forEach(b => b.onclick = () => {
        ans[q.k] = +b.dataset.s; b.classList.add('sel');
        setTimeout(() => go(i < 3 ? 'r' + (i + 1) : 'expect'), 220);
      });
      if (i > 0) $('bk').onclick = () => go('r' + (i - 1));
    } else if (step === 'expect') {
      m.innerHTML = `<div class="k-step">${t.step(5, STEPS.length)}</div><h1>${t.expectQ}</h1>
        <div class="opts">${EXPECT.map(o => `<button class="opt${ans.expect === o.k ? ' sel' : ''}" data-k="${o.k}"><span class="dot" style="background:${o.c}"></span>${o[lang]}</button>`).join('')}</div>
        <div class="k-actions"><button class="ghost" id="bk">${t.back}</button></div>`;
      m.querySelectorAll('.opt').forEach(b => b.onclick = () => { ans.expect = b.dataset.k; b.classList.add('sel'); setTimeout(() => go('text'), 220); });
      $('bk').onclick = () => go('r3');
    } else if (step === 'text') {
      m.innerHTML = `<div class="k-step">${t.step(6, STEPS.length)}</div><h1>${t.textQ}</h1><p class="k-sub">${t.textSub}</p>
        <div class="texts">
          <label for="tEnj">${t.enjoyed}<textarea id="tEnj" maxlength="600">${esc(ans.enjoyed || '')}</textarea></label>
          <label for="tImp">${t.improve}<textarea id="tImp" maxlength="600">${esc(ans.improve || '')}</textarea></label>
        </div>
        <div class="k-actions"><button class="primary" id="nx">${t.next}</button><button class="ghost" id="sk">${t.skipNext}</button><button class="ghost" id="bk">${t.back}</button></div>`;
      const grab = () => { ans.enjoyed = $('tEnj').value.trim(); ans.improve = $('tImp').value.trim(); };
      m.querySelectorAll('textarea').forEach(x => x.oninput = armIdle);
      $('nx').onclick = () => { grab(); go('more'); };
      $('sk').onclick = () => { grab(); go('more'); };
      $('bk').onclick = () => { grab(); go('expect'); };
    } else if (step === 'more') {
      m.innerHTML = `<div class="k-step">${t.step(7, STEPS.length)}</div><h1>${t.moreQ}</h1><p class="k-sub">${t.textSub}</p>
        <div class="texts"><label for="tCom" class="sr-only" style="position:absolute;left:-9999px">${t.comments}</label><textarea id="tCom" maxlength="600" style="min-height:140px">${esc(ans.comments || '')}</textarea></div>
        <div class="k-actions"><button class="primary" id="sub">${t.submit}</button><button class="ghost" id="sk">${t.skipSend}</button><button class="ghost" id="bk">${t.back}</button></div>`;
      const grab = () => { ans.comments = $('tCom').value.trim(); };
      $('tCom').oninput = armIdle;
      $('sub').onclick = () => { grab(); submit(); };
      $('sk').onclick = () => { ans.comments = ''; submit(); };
      $('bk').onclick = () => { grab(); go('text'); };
    } else if (step === 'thanks') {
      let left = 4;
      m.innerHTML = `<div class="thanks-mark">${face(5)}</div><h1>${t.thanks}</h1><p class="k-sub">${t.thanksSub}</p><p class="k-sub" id="backIn" style="font-size:15px">${t.backIn(left)}</p>`;
      clearInterval(thanksT);
      thanksT = setInterval(() => {
        if (step !== 'thanks') { clearInterval(thanksT); return; }
        left--; if (left <= 0) { clearInterval(thanksT); reset(); return; }
        const el = $('backIn'); if (el) el.textContent = t.backIn(left);
      }, 1000);
      // attach after the submit tap has finished bubbling, so it does not skip the thank-you screen
      setTimeout(() => { if (step === 'thanks') m.onclick = () => { clearInterval(thanksT); m.onclick = null; reset(); }; }, 400);
    }
  }

  async function submit() {
    if (demo) { go('thanks'); return; }
    const rec = { id: uid(), ts: Date.now(), lang, food: ans.food || null, service: ans.service || null, variety: ans.variety || null, clean: ans.clean || null,
      expect: ans.expect || null, enjoyed: ans.enjoyed || '', improve: ans.improve || '', comments: ans.comments || '' };
    go('thanks');
    try {
      await S.submit(session.station, rec);
      saveErr = null;
      return;
    } catch (e) { console.error(e); saveErr = e; }
    outbox.push(rec); lsSet('lb_outbox', outbox); setStatus();
  }

  /* Switching a tablet to another station: hold the station label for 3 seconds. */
  let holdT = null;
  $('kStation').addEventListener('pointerdown', () => { holdT = setTimeout(() => { lsDel('lb_kiosk'); session = null; paintStation(); reset(); }, 3000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('kStation').addEventListener(ev, () => clearTimeout(holdT)));

  /* full screen: the browser only allows it from a tap, so every tap re-enters it if it was left */
  const standalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
  function goFull() {
    if (standalone() || document.fullscreenElement || document.webkitFullscreenElement) return;
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) try { const p = req.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  document.addEventListener('pointerup', e => { if (!e.target.closest('textarea,input,select')) goFull(); }, { passive: true });

  /* keep the screen on */
  async function wake() { try { if (navigator.wakeLock && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch (e) {} }
  document.addEventListener('visibilitychange', wake); wake();

  setLang(lang);
  (async () => {
    if (demo) {
      signedIn = true;
      session = { station: { id: 'natbag', name: 'כוחות זרים - נתב"ג', partnerLogo: 'assets/noamer.png', partnerName: 'NOAMER' } };
      paintStation(); render();
      $('kStatusTxt').textContent = lang === 'he' ? 'מצב תצוגה – לא נשמר' : 'Preview – not saved';
      return;
    }
    if (!window.LB.configured()) return;
    try { signedIn = !!(await S.init()); } catch (e) { console.error(e); }
    render();
    if (!signedIn) return;
    loadStations(); flushOutbox(); setInterval(flushOutbox, 60000); setInterval(loadStations, 30 * 60000);
  })();
})();
