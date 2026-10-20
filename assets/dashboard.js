/* Management dashboard: Microsoft sign-in, per-station scoping, CEO overview, settings (SharePoint). */
(function () {
  'use strict';
  const { $, esc, pad, dayKey, fmt, face, toast, RATINGS, SCALE, EXPECT } = window.LB;
  const S = window.LB_STORE;
  const MEALS = [{ he: 'בוקר', f: h => h < 11 }, { he: 'צהריים', f: h => h >= 11 && h < 16 }, { he: 'ערב', f: h => h >= 16 }];
  const RANGES = [['1', 'היום'], ['7', '7 ימים'], ['30', '30 יום'], ['all', 'הכל'], ['custom', 'טווח תאריכים']];
  const stCode = n => String(n || '').replace(/[^\p{L}]/gu, '').slice(0, 2).toLowerCase();
  const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  // role: 'all' (admin / CEO), an array of station ids (station manager), or null
  let role = null, data = { responses: [], stations: [], recipients: [], settings: {} }, viewStation = 'all', range = '7', loading = false, pollT = null, rpConfirm = null;

  $('pBrand').innerHTML = $('dBrand').innerHTML = window.LB.brandHTML();
  const stName = id => data.stations.find(x => x.id === id)?.name || 'ללא תחנה';
  const hour = r => +String(r.time || '0').slice(0, 2);
  const avgOf = (l, k) => { const v = l.map(r => r[k]).filter(x => x >= 1); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const overall = r => { const v = RATINGS.map(q => r[q.k]).filter(x => x >= 1); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const scoreColor = v => v == null ? 'var(--muted)' : `var(--r${Math.max(1, Math.min(5, Math.round(v)))})`;

  /* ---------------- sign-in / gate ---------------- */
  function gate(html) { $('dash').hidden = true; $('pinGate').hidden = false; $('gateBody').innerHTML = html; }
  function gateSignIn(msg) {
    gate(`<div class="d-meta">${msg || 'כניסה עם חשבון ה-Microsoft של לי-בר (@leebar.co.il). מנכ"ל ומנהלים ראשיים רואים את כל התחנות, מנהל תחנה רואה את התחנות שלו.'}</div>
      <button class="primary" id="msIn">התחברות עם Microsoft</button>`);
    $('msIn').onclick = () => S.login();
  }
  function gateMsg(title, msg, btns = '') {
    gate(`<h3 style="margin:0;font-size:19px">${title}</h3><div class="d-meta">${msg}</div>${btns}<button class="ghost" id="msOut">התחברות עם משתמש אחר</button>`);
    $('msOut').onclick = () => S.logout();
  }
  $('logout').onclick = () => S.logout();

  async function boot() {
    if (!window.LB.configured()) { gateMsg('הדף עוד לא מחובר', 'חסרים פרטי החיבור ל-Microsoft 365 בקובץ config.js.'); return; }
    let acc = null;
    try { acc = await S.init(); } catch (e) { console.error(e); }
    if (!acc) { gateSignIn(); return; }
    gate('<div class="loading">בודק הרשאות…</div>');
    let missing;
    try { missing = await S.needsSetup(); }
    catch (e) { console.error(e); gateMsg('אין גישה לאתר SharePoint', 'החשבון ' + esc(S.email()) + ' לא מצליח לגשת לאתר leebar ב-SharePoint. בקשי ממנהל המערכת הרשאה לאתר.'); return; }
    if (missing.length) {
      gateMsg('הקמה ראשונה', 'הרשימות של מערכת המשוב עוד לא קיימות באתר SharePoint של לי-בר. לחיצה אחת יוצרת אותן, מוסיפה את תחנת נתב"ג ואת 10 הנמענים, ומגדירה אותך (' + esc(S.email()) + ') כמנהלת ראשית.',
        '<button class="primary" id="doSetup">הקמת הרשימות ב-SharePoint</button><div class="pin-err" id="setupErr" role="alert"></div>');
      $('doSetup').onclick = async () => {
        $('doSetup').disabled = true; $('setupErr').textContent = 'יוצר רשימות…';
        try { await S.setup(); location.reload(); }
        catch (e) { console.error(e); $('doSetup').disabled = false; $('setupErr').textContent = e.status === 403 ? 'אין הרשאה ליצור רשימות. צריך הרשאת Sites.Manage.All עם admin consent, והרשאת עריכה באתר.' : 'ההקמה נכשלה: ' + esc(e.message); }
      };
      return;
    }
    try { await load(false, true); }
    catch (e) { console.error(e); gateMsg('אין הרשאה', 'לחשבון ' + esc(S.email()) + ' אין הרשאה לרשימות המשוב. בקשי ממנהל המערכת.'); return; }
    if (!role) { gateMsg('אין הרשאה לדשבורד', 'החשבון ' + esc(S.email()) + ' לא מוגדר כמנהל ראשי או כמנהל תחנה. המנהלת הראשית יכולה להוסיף אותך בהגדרות.'); return; }
    openDash();
  }

  function openDash() {
    $('pinGate').hidden = true; $('dash').hidden = false;
    $('whoami').textContent = S.email();
    const want = new URLSearchParams(location.search).get('station');
    const allowed = id => role === 'all' ? data.stations.some(x => x.id === id) : role.includes(id);
    viewStation = want && allowed(want) ? want : role === 'all' ? 'all' : (role.length === 1 ? role[0] : 'all');
    $('setupPanel').hidden = $('rpPanel').hidden = role !== 'all';
    draw();
    clearInterval(pollT); pollT = setInterval(() => { if (document.visibilityState === 'visible') load(true).catch(() => {}); }, 60000);
  }

  /* ---------------- data ---------------- */
  function periodBounds(offset = 0) {
    if (range === 'all') return offset ? null : [0, Infinity];
    let lo, hi;
    if (range === 'custom') {
      const f = $('dFrom').value, t = $('dTo').value; if (!f || !t) return offset ? null : [0, Infinity];
      lo = new Date(f + 'T00:00').getTime(); hi = new Date(t + 'T00:00').getTime() + 864e5;
    } else {
      const end = new Date(); end.setHours(24, 0, 0, 0); hi = end.getTime(); lo = hi - (+range) * 864e5;
    }
    const len = hi - lo; return [lo - offset * len, hi - offset * len];
  }
  async function load(quiet, initial) {
    if (loading) return; loading = true;
    try {
      const cur = periodBounds(0), prev = periodBounds(1);
      const from = prev ? prev[0] : cur[0], to = cur[1];
      if (!quiet && !initial) $('dMeta').textContent = 'טוען נתונים…';
      const [stations, settings] = await Promise.all([S.stations(), S.settings()]);
      const me = S.email();
      const admins = S.splitList(settings.admins && settings.admins.value);
      const mine = stations.filter(x => x.managers.includes(me)).map(x => x.id);
      role = admins.includes(me) ? 'all' : (mine.length ? mine : null);
      if (!role) { loading = false; return; }
      let responses = await S.responses(from || 0, isFinite(to) ? to : 0);
      let visibleStations = stations;
      if (role !== 'all') { responses = responses.filter(r => role.includes(r.station)); visibleStations = stations.filter(x => role.includes(x.id)); }
      data = { responses, stations: visibleStations, settings, admins, prevDay: !settings.prevDay || settings.prevDay.value !== 'false', recipients: role === 'all' ? await S.recipients() : [] };
      if (!initial) draw();
    } catch (e) {
      if (initial) { loading = false; throw e; }
      console.error(e); $('dMeta').textContent = 'אין חיבור ל-SharePoint. הנתונים יתעדכנו כשהחיבור יחזור.';
    }
    loading = false;
  }

  /* ---------------- toolbar ---------------- */
  $('ranges').innerHTML = RANGES.map(([k, l]) => `<button class="chip-btn" data-r="${k}" aria-pressed="${k === range}">${l}</button>`).join('');
  $('ranges').querySelectorAll('button').forEach(b => b.onclick = () => {
    range = b.dataset.r; $('customBox').hidden = range !== 'custom';
    if (range === 'custom' && !$('dFrom').value) { $('dTo').value = dayKey(Date.now()); $('dFrom').value = dayKey(Date.now() - 6 * 864e5); }
    $('ranges').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); load();
  });
  $('dFrom').onchange = $('dTo').onchange = () => load();
  $('stSel').onchange = e => { viewStation = e.target.value; draw(); };
  /* ---------------- render ---------------- */
  function draw() {
    const inP = (l, b) => b ? l.filter(r => r.ts >= b[0] && r.ts < b[1]) : [];
    const scoped = viewStation === 'all' ? data.responses : data.responses.filter(r => r.station === viewStation);
    const L = inP(scoped, periodBounds(0)).sort((a, b) => b.ts - a.ts), P = inP(scoped, periodBounds(1));
    const sel = $('stSel'); sel.hidden = data.stations.length < 2;
    if (!sel.hidden) { sel.innerHTML = `<option value="all">כל התחנות</option>` + data.stations.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join(''); sel.value = viewStation; }
    $('dTitle').textContent = viewStation === 'all' ? (data.stations.length > 1 ? 'משוב חדרי האוכל · כל התחנות' : 'משוב חדר האוכל' + (data.stations[0] ? ' · ' + data.stations[0].name : '')) : stName(viewStation);
    const now = new Date();
    $('dMeta').textContent = `${L.length} משובים בטווח · עודכן ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (role === 'all') { drawStAdmin(); drawReports(); }
    const body = $('dBody');
    if (!L.length) {
      body.innerHTML = `<section class="panel"><div class="empty">${face(4)}<h2>אין משובים בטווח הזה</h2>
        <p style="max-width:48ch;margin:0">ברגע שימלאו את הסקר בטאבלט, התוצאות יופיעו כאן (הדף מתעדכן כל דקה). אפשר גם לבחור טווח תאריכים אחר למעלה.</p></div></section>`;
      return;
    }
    const ov = L.map(overall).filter(x => x != null), ovP = P.map(overall).filter(x => x != null);
    const oAvg = mean(ov), oPrev = mean(ovP);
    const sat = ov.length ? ov.filter(x => x >= 4).length / ov.length : null;
    const ex = L.filter(r => r.expect), exOk = ex.length ? ex.filter(r => r.expect === 'exceeded' || r.expect === 'met').length / ex.length : null;
    const hasPrev = range !== 'all' && P.length > 0;
    const dTxt = (a, b) => !hasPrev || a == null || b == null ? '' : (() => { const d = a - b; return `<span class="${d >= 0 ? 'delta-up' : 'delta-down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(2)}</span> מול התקופה הקודמת`; })();
    const rangeLbl = range === 'custom' ? `${$('dFrom').value.split('-').reverse().join('.')}–${$('dTo').value.split('-').reverse().join('.')}` : RANGES.find(r => r[0] === range)[1];

    let h = `<section class="kpis">
      <div class="kpi"><span class="k">משובים · ${rangeLbl}</span><span class="v num">${L.length}</span><span class="s">${range !== 'all' ? `${P.length} בתקופה הקודמת` : 'כל הזמנים'}</span></div>
      <div class="kpi"><span class="k">ציון ממוצע (מתוך 5)</span><span class="v num">${fmt(oAvg, 2)}</span><span class="s">${dTxt(oAvg, oPrev) || '&nbsp;'}</span></div>
      <div class="kpi"><span class="k">מרוצים (ציון 4 ומעלה)</span><span class="v num">${sat == null ? '–' : Math.round(sat * 100) + '%'}</span><span class="s">ממוצע 4 השאלות</span></div>
      <div class="kpi"><span class="k">עמד או עלה על הציפיות</span><span class="v num">${exOk == null ? '–' : Math.round(exOk * 100) + '%'}</span><span class="s">${ex.length} ענו</span></div>
    </section>`;

    const met = RATINGS.map(q => { const v = L.map(r => r[q.k]).filter(x => x >= 1); return { q, avg: avgOf(L, q.k), prev: hasPrev ? avgOf(P, q.k) : null, n: v.length, dist: [1, 2, 3, 4, 5].map(s => v.filter(x => x === s).length) }; });
    h += `<div class="grid2"><section class="panel"><h2>ציון לפי נושא</h2>
      ${met.map(m => `<div class="metric"><span class="name">${m.q.short}</span><span class="avg num" style="color:${scoreColor(m.avg)}">${fmt(m.avg)}</span>
        <div class="stack" role="img" aria-label="התפלגות ${m.q.short}">${m.dist.map((c, i) => c ? `<span style="width:${c / m.n * 100}%;background:var(--r${i + 1})" title="${i + 1}: ${c}"></span>` : '').join('')}</div></div>`).join('')}
      <div class="legend">${SCALE.he.map((l, i) => `<span><i style="background:var(--r${i + 1})"></i>${i + 1} ${l}</span>`).join('')}</div>
    </section>
    <section class="panel"><h2>מסקנות</h2><ul class="insights">${insights(L, met).map(x => `<li class="${x.c}"><span>${x.t}</span></li>`).join('')}</ul></section></div>`;

    h += `<div class="grid2"><section class="panel"><h2>מגמה יומית</h2><div class="chart-wrap">${trend(range === '1' ? scoped.filter(r => r.ts >= Date.now() - 7 * 864e5) : L)}</div>
      <div class="legend"><span><i style="background:var(--accent)"></i>ציון ממוצע יומי</span><span><i style="background:var(--line)"></i>מספר משובים</span></div></section>
      <section class="panel"><h2>לפי ארוחה</h2><div class="meals">${MEALS.map(me => { const l = L.filter(r => me.f(hour(r))); const a = mean(l.map(overall).filter(x => x != null));
        return `<div class="meal"><span class="k">${me.he}</span><span class="v num" style="color:${scoreColor(a)}">${fmt(a)}</span><span class="k">${l.length} משובים</span></div>`; }).join('')}</div>
        <h2>ציפיות</h2>${expBar(ex)}
        <div class="legend">${EXPECT.map(o => `<span><i style="background:${o.c}"></i>${o.he}</span>`).join('')}</div>
      </section></div>`;

    if (viewStation === 'all' && role === 'all' && data.stations.length > 1) {
      const rowsC = data.stations.map(x => { const l = L.filter(r => r.station === x.id); const a = mean(l.map(overall).filter(v => v != null));
        const cell = v => v == null ? '–' : `<span style="color:${scoreColor(v)}">${v.toFixed(1)}</span>`;
        return `<tr class="click" data-st="${esc(x.id)}"><td><b>${esc(x.name)}</b></td><td class="n">${l.length}</td><td class="n">${cell(a)}</td>${RATINGS.map(q => `<td class="n">${cell(avgOf(l, q.k))}</td>`).join('')}</tr>`; }).join('');
      h += `<section class="panel"><h2>השוואה בין תחנות</h2><div class="tbl-wrap"><table class="cmp"><thead><tr><th>תחנה</th><th>משובים</th><th>ממוצע</th>${RATINGS.map(q => `<th>${q.short}</th>`).join('')}</tr></thead><tbody>${rowsC}</tbody></table></div><div class="d-meta">לחיצה על תחנה פותחת את הדשבורד שלה.</div></section>`;
    }

    const showSt = viewStation === 'all' && data.stations.length > 1;
    let lastDay = '';
    const rows = L.slice(0, 500).map(r => {
      const d = new Date(r.ts); let pre = '';
      if (r.date !== lastDay) { lastDay = r.date; const cnt = L.filter(x => x.date === r.date).length;
        pre = `<tr class="day-row"><td colspan="${showSt ? 8 : 7}">${d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })} · ${cnt} משובים</td></tr>`; }
      const sc = k => r[k] ? `<i style="background:var(--r${r[k]})">${r[k]}</i>` : '–';
      const tx = [r.enjoyed, r.improve, r.comments].filter(Boolean).map(esc).join(' · ');
      return pre + `<tr>${showSt ? `<td class="st-cell">${esc(stName(r.station))}</td>` : ''}<td class="dt">${String(r.date).split('-').reverse().join('.')} ${esc(r.time)}</td><td class="sc">${sc('food')}</td><td class="sc">${sc('service')}</td><td class="sc">${sc('variety')}</td><td class="sc">${sc('clean')}</td><td>${r.expect ? (EXPECT.find(e => e.k === r.expect)?.he || '') : '–'}</td><td class="tx">${tx}</td></tr>`;
    }).join('');
    h += `<section class="panel"><h2>כל המשובים לפי תאריך (${L.length})</h2>
      <div class="tbl-wrap"><table class="resp"><thead><tr>${showSt ? '<th>תחנה</th>' : ''}<th>תאריך ושעה</th><th>אוכל</th><th>שירות</th><th>מגוון</th><th>ניקיון</th><th>ציפיות</th><th>תגובה</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${L.length > 500 ? '<div class="d-meta">מוצגים 500 האחרונים. לרשימה המלאה ייצאי ל-CSV.</div>' : ''}</section>`;
    body.innerHTML = h;
    body.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => { viewStation = tr.dataset.st; draw(); scrollTo(0, 0); });
  }

  function insights(L, met) {
    const out = [], has = met.filter(m => m.avg != null);
    if (L.length < 20) out.push({ c: '', t: `יש רק ${L.length} משובים בטווח הזה, כך שהמסקנות עדיין ראשוניות.` });
    if (has.length) {
      const s = [...has].sort((a, b) => b.avg - a.avg), best = s[0], w = s[s.length - 1];
      if (best.avg - w.avg < 0.3) {
        out.push({ c: w.avg >= 4 ? 'good' : w.avg < 3.5 ? 'warn' : '', t: `כל הנושאים קיבלו ציון דומה, סביב ${fmt(best.avg)}${w.avg >= 4 ? '. אין נקודה חלשה בולטת.' : w.avg < 3.5 ? ', מתחת ליעד 3.5.' : '.'}` });
      } else {
        out.push({ c: 'good', t: `החוזקה הבולטת: <b>${best.q.short}</b> עם ממוצע ${fmt(best.avg)}.` });
        out.push({ c: w.avg < 3.5 ? 'warn' : '', t: `${w.avg >= 4 ? 'הנמוך מבין הנושאים (ועדיין טוב)' : 'הנקודה החלשה ביותר'}: <b>${w.q.short}</b> עם ממוצע ${fmt(w.avg)}${w.avg < 3.5 ? ' — מתחת ליעד 3.5, כדאי לטפל.' : '.'}` });
      }
      has.forEach(m => { if (m.prev != null && Math.abs(m.avg - m.prev) >= 0.3) out.push({ c: m.avg < m.prev ? 'warn' : 'good', t: `<b>${m.q.short}</b> ${m.avg < m.prev ? 'ירד' : 'עלה'} מ-${fmt(m.prev)} ל-${fmt(m.avg)} לעומת התקופה הקודמת.` }); });
      has.forEach(m => { const low = (m.dist[0] + m.dist[1]) / m.n; if (low >= 0.2) out.push({ c: 'warn', t: `${Math.round(low * 100)}% נתנו ל<b>${m.q.short}</b> ציון 1–2.` }); });
    }
    const mm = MEALS.map(me => { const l = L.filter(r => me.f(hour(r))).map(overall).filter(x => x != null); return { me, n: l.length, a: mean(l) }; }).filter(x => x.n >= 5);
    if (mm.length >= 2) { mm.sort((a, b) => a.a - b.a); if (mm[mm.length - 1].a - mm[0].a >= 0.3) out.push({ c: 'warn', t: `ארוחת ה<b>${mm[0].me.he}</b> מקבלת את הציון הנמוך ביותר (${fmt(mm[0].a)}) לעומת ${mm[mm.length - 1].me.he} (${fmt(mm[mm.length - 1].a)}).` }); }
    const ex = L.filter(r => r.expect); if (ex.length >= 5) { const bad = ex.filter(r => r.expect === 'not').length / ex.length; if (bad >= 0.15) out.push({ c: 'warn', t: `${Math.round(bad * 100)}% ציינו שהארוחה לא עמדה בציפיות.` }); }
    if (role === 'all' && viewStation === 'all' && data.stations.length > 1) {
      const per = data.stations.map(x => { const o = L.filter(r => r.station === x.id).map(overall).filter(v => v != null); return { x, n: o.length, a: mean(o) }; }).filter(p => p.n >= 5).sort((a, b) => a.a - b.a);
      if (per.length >= 2) out.push({ c: per[0].a < 3.5 ? 'warn' : '', t: `התחנה עם הציון הנמוך ביותר: <b>${esc(per[0].x.name)}</b> (${fmt(per[0].a)}). הגבוהה ביותר: <b>${esc(per[per.length - 1].x.name)}</b> (${fmt(per[per.length - 1].a)}).` });
    }
    return out;
  }

  function trend(list) {
    const days = [...new Set(list.map(r => r.date))].sort().slice(-30);
    if (days.length < 2) return '<div class="d-meta">צריך משובים מלפחות שני ימים כדי להציג מגמה.</div>';
    const W = 720, H = 240, l = 34, r = 14, t = 14, b = 34, iw = W - l - r, ih = H - t - b;
    const pts = days.map(d => { const g = list.filter(x => x.date === d); const o = g.map(overall).filter(x => x != null); return { d, n: g.length, a: mean(o) }; });
    const maxN = Math.max(...pts.map(p => p.n)), step = iw / days.length;
    const X = i => l + step * i + step / 2, Y = v => t + ih - (v - 1) / 4 * ih;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ציון ממוצע יומי">`;
    [1, 2, 3, 4, 5].forEach(v => { s += `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`; });
    pts.forEach((p, i) => { const bh = p.n / maxN * ih * .45; s += `<rect x="${X(i) - step * .3}" y="${t + ih - bh}" width="${step * .6}" height="${bh}" rx="2" fill="var(--line)"><title>${p.d}: ${p.n} משובים</title></rect>`; });
    const lp = pts.map((p, i) => p.a != null ? [X(i), Y(p.a)] : null).filter(Boolean);
    if (lp.length) {
      s += `<path d="M${lp.map(q => q.join(',')).join(' L')} L${lp[lp.length - 1][0]},${t + ih} L${lp[0][0]},${t + ih}Z" fill="var(--accent)" opacity=".1"/>`;
      s += `<polyline points="${lp.map(q => q.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>`;
      const last = lp[lp.length - 1]; s += `<circle cx="${last[0]}" cy="${last[1]}" r="5" fill="var(--accent)"/>`;
    }
    const every = Math.ceil(days.length / 8);
    pts.forEach((p, i) => { if (i % every === 0 || i === days.length - 1) { const [, mo, dd] = p.d.split('-'); s += `<text x="${X(i)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="var(--muted)">${+dd}.${+mo}</text>`; } });
    return s + '</svg>';
  }
  function expBar(ex) {
    if (!ex.length) return '<div class="d-meta">אין עדיין תשובות.</div>';
    return `<div class="exp-bar">${EXPECT.map(o => { const c = ex.filter(r => r.expect === o.k).length, p = c / ex.length * 100; return c ? `<span style="width:${p}%;background:${o.c}" title="${o.he}: ${c}">${p >= 9 ? Math.round(p) + '%' : ''}</span>` : ''; }).join('')}</div>`;
  }

  /* ---------------- CSV ---------------- */
  $('csvBtn').onclick = () => {
    const b = periodBounds(0);
    const L = (viewStation === 'all' ? data.responses : data.responses.filter(r => r.station === viewStation)).filter(r => r.ts >= b[0] && r.ts < b[1]);
    if (!L.length) { toast('אין נתונים לייצוא'); return; }
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['תחנה', 'תאריך', 'שעה', 'אוכל', 'שירות', 'מגוון', 'ניקיון', 'ציפיות', 'מה אהבו', 'מה לשפר', 'הערות', 'שפה'];
    const rows = L.map(r => [stName(r.station), r.date, r.time, r.food, r.service, r.variety, r.clean, EXPECT.find(e => e.k === r.expect)?.he || '', r.enjoyed, r.improve, r.comments, r.lang].map(q).join(','));
    const blob = new Blob(['﻿' + head.map(q).join(',') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `leebar-feedback-${dayKey(Date.now())}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };


  /* ---------------- admin: stations, managers, admins ---------------- */
  async function adminDo(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); await load(true); return true; }
    catch (e) { console.error(e); toast(e.status === 403 ? 'אין לך הרשאת עריכה ברשימה ב-SharePoint' : 'לא הצלחתי לשמור. נסי שוב.'); return false; }
  }
  const tabletLink = id => location.origin + location.pathname.replace(/dashboard\.html$/, 'indexF.html') + '?station=' + encodeURIComponent(id);
  const dashLink = () => location.origin + location.pathname;
  function busy(box) { return document.activeElement && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'checkbox'; }
  const parseEmails = v => { const l = S.splitList(v); const bad = l.filter(x => !isEmail(x)); return bad.length ? null : l; };

  function drawStAdmin() {
    const box = $('stAdmin'); if (busy(box)) return;
    box.innerHTML = `<h3 style="font-size:17px;margin:0">תחנות ומנהלי תחנות</h3>
      <div class="st-list">${data.stations.map(x => `<div class="st-row"><span class="grow">${esc(x.name)}</span>
        <span class="tag">קוד טאבלט: ${esc(stCode(x.name))}</span>
        <input class="inp wide" type="text" dir="ltr" placeholder="מיילים של מנהלי התחנה, מופרדים בפסיק" value="${esc(x.managers.join(', '))}" data-mgr="${esc(x._id)}" aria-label="מנהלי ${esc(x.name)}">
        <button class="btn" data-savemgr="${esc(x._id)}">שמירה</button>
        <button class="btn" data-copy="${esc(tabletLink(x.id))}">קישור לטאבלט</button>
        <button class="btn" data-copy="${esc(dashLink() + '?station=' + encodeURIComponent(x.id))}">קישור דשבורד לתחנה</button></div>`).join('')}</div>
      <div class="row"><input class="inp wide" id="newStName" placeholder="שם תחנה חדשה"><input class="inp wide" id="newStMgr" dir="ltr" placeholder="מייל מנהל התחנה (לא חובה)">
        <button class="btn acc" id="addSt">הוספת תחנה</button></div>
      <h3 style="font-size:17px;margin:8px 0 0">מנהלים ראשיים (רואים את כל התחנות)</h3>
      <div class="row"><input class="inp wide" id="admins" dir="ltr" style="min-width:min(520px,100%)" value="${esc((data.admins || []).join(', '))}"><button class="btn acc" id="saveAdmins">שמירה</button></div>
      <div class="row"><span>קישור דשבורד אדמין (כל התחנות):</span><button class="btn" data-copy="${esc(dashLink())}">העתקת קישור אדמין</button></div>
      <div class="d-meta">כל מנהל נכנס עם חשבון ה-Microsoft שלו. מנהל תחנה רואה רק את התחנות שבהן המייל שלו מופיע. קוד הטאבלט (2 האותיות הראשונות של שם התחנה) רק מחבר טאבלט לתחנה.</div>`;
    box.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { const t = b.dataset.copy; try { await navigator.clipboard.writeText(t); toast('הקישור הועתק'); } catch (e) { prompt('העתיקי את הקישור:', t); } });
    box.querySelectorAll('[data-savemgr]').forEach(b => b.onclick = () => {
      const id = b.dataset.savemgr, l = parseEmails(box.querySelector(`[data-mgr="${id}"]`).value);
      if (!l) { toast('אחת הכתובות לא תקינה'); return; }
      adminDo(() => S.updateStation(id, { Managers: l.join(', ') }), 'מנהלי התחנה נשמרו');
    });
    $('addSt').onclick = () => {
      const n = $('newStName').value.trim(), l = parseEmails($('newStMgr').value);
      if (!n) { toast('צריך שם לתחנה'); return; }
      if (!l) { toast('כתובת המייל לא תקינה'); return; }
      adminDo(() => S.addStation(n, l, data.stations.length + 1), 'התחנה נוספה').then(ok => { if (ok) { $('newStName').value = ''; $('newStMgr').value = ''; } });
    };
    $('saveAdmins').onclick = () => {
      const l = parseEmails($('admins').value);
      if (!l || !l.length) { toast('צריך לפחות כתובת תקינה אחת'); return; }
      if (!l.includes(S.email())) { toast('השאירי את המייל שלך ברשימה, אחרת תאבדי גישה להגדרות'); return; }
      adminDo(() => S.setSetting('admins', l.join(', ')), 'המנהלים הראשיים נשמרו');
    };
  }

  /* ---------------- admin: email recipients ---------------- */
  function drawReports() {
    const box = $('rpAdmin'); if (busy(box)) return;
    const recips = data.recipients || [];
    const chips = r => { const sel = r.stations === 'all' ? 'all' : r.stations;
      return `<div class="chips"><button class="chip" data-rid="${esc(r.id)}" data-st="all" aria-pressed="${sel === 'all'}">כל התחנות</button>${data.stations.map(x => `<button class="chip" data-rid="${esc(r.id)}" data-st="${esc(x.id)}" aria-pressed="${sel !== 'all' && sel.includes(x.id)}">${esc(x.name)}</button>`).join('')}</div>`; };
    box.innerHTML = `<div class="rp-head"><h2>הגדרות שליחת מיילים</h2><button class="btn acc" id="rpAdd">הוספת נמען</button></div>
      <label class="switch"><input type="checkbox" id="rpPrev" ${data.prevDay !== false ? 'checked' : ''}> שלח דוח של יום קודם</label>
      <div class="tbl-wrap" style="max-height:none"><table class="rp-tbl"><thead><tr><th>פעיל</th><th>שעת קבלת הדוח</th><th>כתובת מייל</th><th>תחנות בדוח</th><th></th></tr></thead><tbody>
      ${recips.map(r => `<tr class="${r.active === false ? 'off' : ''}">
        <td><input type="checkbox" data-act="${esc(r.id)}" ${r.active !== false ? 'checked' : ''} aria-label="פעיל"></td>
        <td><input class="inp" type="time" data-time="${esc(r.id)}" value="${esc(r.time || '09:00')}" step="3600"></td>
        <td><input class="inp" type="email" data-mail="${esc(r.id)}" value="${esc(r.email || '')}" placeholder="name@leebar.co.il"></td>
        <td>${chips(r)}</td>
        <td style="white-space:nowrap"><button class="icon-btn danger" data-del="${esc(r.id)}">${rpConfirm === r.id ? 'למחוק? לחצי שוב' : 'מחיקה'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="d-meta">אין נמענים עדיין.</td></tr>'}
      </tbody></table></div>
      <div class="d-meta">ההגדרות נשמרות ברשימה "LBFeedbackRecipients" ב-SharePoint. השליחה עצמה נעשית בתהליך Power Automate שקורא את הרשימה הזו.</div>`;
    const save = (r, p) => adminDo(() => S.saveRecipient(Object.assign({}, r, p), recips.length + 1), 'נשמר');
    const byId = id => recips.find(x => x.id === id);
    $('rpPrev').onchange = e => adminDo(() => S.setSetting('prevDay', e.target.checked ? 'true' : 'false'), 'נשמר');
    box.querySelectorAll('[data-act]').forEach(x => x.onchange = () => save(byId(x.dataset.act), { active: x.checked }));
    box.querySelectorAll('[data-time]').forEach(x => x.onchange = () => { if (x.value) save(byId(x.dataset.time), { time: x.value.slice(0, 2) + ':00' }); });
    box.querySelectorAll('[data-mail]').forEach(x => x.onchange = () => { const v = x.value.trim(); if (v && !isEmail(v)) { toast('כתובת המייל לא תקינה'); return; } save(byId(x.dataset.mail), { email: v }); });
    box.querySelectorAll('.chip').forEach(c => c.onclick = () => {
      const r = byId(c.dataset.rid); if (!r) return;
      if (c.dataset.st === 'all') return save(r, { stations: 'all' });
      let cur = r.stations === 'all' ? [] : [...r.stations];
      cur = cur.includes(c.dataset.st) ? cur.filter(x => x !== c.dataset.st) : cur.concat(c.dataset.st);
      save(r, { stations: cur.length ? cur : 'all' });
    });
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const id = b.dataset.del;
      if (rpConfirm !== id) { rpConfirm = id; drawReports(); setTimeout(() => { if (rpConfirm === id) { rpConfirm = null; drawReports(); } }, 4000); return; }
      rpConfirm = null; adminDo(() => S.deleteRecipient(id), 'הנמען נמחק');
    });
    $('rpAdd').onclick = () => adminDo(() => S.saveRecipient({ email: '', time: '09:00', stations: 'all', active: true }, recips.length + 1), 'נוספה שורה חדשה');
  }

  boot();
})();
