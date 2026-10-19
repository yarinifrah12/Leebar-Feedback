/* Tablet survey. It can only send responses — there is no way from here to the dashboard. */
(function () {
  'use strict';
  const { $, esc, lsGet, lsSet, lsDel, face, RATINGS, SCALE, EXPECT, uid } = window.LB;
  const S = window.LB_STORE;
  const stCode = n => String(n || '').replace(/[^\p{L}]/gu, '').slice(0, 2).toLowerCase();
  const T = {
    en: { welcome: "We'd love to hear about your experience!", welcomeSub: 'Your feedback is anonymous and helps us keep the highest standards of food and service.', start: 'Start',
      step: (i, n) => `Question ${i} of ${n}`, expectQ: 'Did the meal meet your expectations?', textQ: 'Anything you would like to tell us?', textSub: 'Optional. Skip if you are in a hurry.',
      enjoyed: 'What did you enjoy most about your meal today?', improve: 'What can we improve?', comments: 'Additional comments', submit: 'Submit', back: 'Back',
      thanks: 'Thank you!', thanksSub: 'Your feedback helps us improve our food, service and overall dining experience.', back: (n) => `Back to the start in ${n}… tap anywhere to start now`, anon: 'Anonymous', offline: 'Saved on this tablet, will sync',
      station: 'Station: ', login: 'Station login', loginSub: "Choose this tablet's station and enter the station code. Needed once per tablet.", stLabel: 'Station', code: 'Code', loginBtn: 'Log in', wrong: 'Wrong code', noNet: 'No connection. Check the internet and try again.',
      signin: 'Connect this tablet', signinSub: 'Sign in once with the Li-Bar tablet account. Diners never need to sign in.', signinBtn: 'Sign in with Microsoft' },
    he: { welcome: 'נשמח לשמוע איך היה!', welcomeSub: 'המשוב אנונימי לחלוטין ועוזר לנו לשמור על רמה גבוהה של אוכל ושירות.', start: 'התחלה',
      step: (i, n) => `שאלה ${i} מתוך ${n}`, expectQ: 'האם הארוחה עמדה בציפיות שלך?', textQ: 'רוצה להוסיף משהו?', textSub: 'לא חובה. אפשר לדלג.',
      enjoyed: 'מה הכי אהבת בארוחה היום?', improve: 'מה אפשר לשפר?', comments: 'הערות נוספות', submit: 'שליחה', back: 'חזרה',
      thanks: 'תודה רבה!', thanksSub: 'המשוב שלך עוזר לנו לשפר את האוכל, השירות וחוויית הארוחה.', back: (n) => `חוזרים למסך הפתיחה בעוד ${n}… אפשר לגעת במסך כדי להתחיל מיד`, anon: 'אנונימי', offline: 'נשמר בטאבלט, יסונכרן',
      station: 'תחנה: ', login: 'התחברות תחנה', loginSub: 'בחרי את התחנה של הטאבלט והזיני את קוד התחנה. פעם אחת בלבד לכל טאבלט.', stLabel: 'תחנה', code: 'קוד', loginBtn: 'התחברות', wrong: 'קוד שגוי', noNet: 'אין חיבור לאינטרנט. בדקי את החיבור ונסי שוב.',
      signin: 'חיבור הטאבלט', signinSub: 'התחברות חד-פעמית עם חשבון הטאבלט של לי-בר. הסועדים לא צריכים להתחבר.', signinBtn: 'התחברות עם Microsoft' }
  };
  const STEPS = ['r0', 'r1', 'r2', 'r3', 'expect', 'text'];
  let lang = lsGet('lb_lang', 'en');
  let session = lsGet('lb_kiosk', null);          // {station:{id,name,partnerLogo,partnerName}}
  let signedIn = null;
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
    $('kStatusTxt').textContent = demo ? (lang === 'he' ? 'מצב תצוגה – לא נשמר' : 'Preview – not saved') : off ? T[lang].offline : T[lang].anon;
  }
  async function loadStations() {
    try {
      stations = (await S.stations()).map(x => ({ id: x.id, name: x.name, partnerLogo: x.partnerLogo, partnerName: x.partnerName }));
      lsSet('lb_stations_cache', stations);
      // keep the bound station's details fresh (name, partner logo)
      if (session) { const fresh = stations.find(s => s.id === session.station.id); if (fresh) { session.station = fresh; lsSet('lb_kiosk', session); } }
    } catch (e) {}
    paintStation();
    if (step === 'start' || step === 'login') render();
  }
  async function flushOutbox() {
    if (!outbox.length || !session) return;
    const rest = [];
    for (const rec of outbox) {
      try {
        await S.submit(session.station, rec);
      } catch (e) { rest.push(rec); }
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
          <label for="tCom">${t.comments}<textarea id="tCom" maxlength="600">${esc(ans.comments || '')}</textarea></label>
        </div>
        <div class="k-actions"><button class="primary" id="sub">${t.submit}</button><button class="ghost" id="bk">${t.back}</button></div>`;
      const grab = () => { ans.enjoyed = $('tEnj').value.trim(); ans.improve = $('tImp').value.trim(); ans.comments = $('tCom').value.trim(); };
      m.querySelectorAll('textarea').forEach(x => x.oninput = armIdle);
      $('sub').onclick = () => { grab(); submit(); };
      $('bk').onclick = () => { grab(); go('expect'); };
    } else if (step === 'thanks') {
      let left = 4;
      m.innerHTML = `<div class="thanks-mark">${face(5)}</div><h1>${t.thanks}</h1><p class="k-sub">${t.thanksSub}</p><p class="k-sub" id="backIn" style="font-size:15px">${t.back(left)}</p>`;
      clearInterval(thanksT);
      thanksT = setInterval(() => {
        if (step !== 'thanks') { clearInterval(thanksT); return; }
        left--; if (left <= 0) { clearInterval(thanksT); reset(); return; }
        const el = $('backIn'); if (el) el.textContent = t.back(left);
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
      return;
    } catch (e) { console.error(e); }
    outbox.push(rec); lsSet('lb_outbox', outbox); setStatus();
  }

  /* Switching a tablet to another station: hold the station label for 3 seconds. */
  let holdT = null;
  $('kStation').addEventListener('pointerdown', () => { holdT = setTimeout(() => { lsDel('lb_kiosk'); session = null; paintStation(); reset(); }, 3000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('kStation').addEventListener(ev, () => clearTimeout(holdT)));

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
