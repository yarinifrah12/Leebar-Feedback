/* Shared helpers for the tablet and dashboard pages. */
(function () {
  'use strict';
  const L = window.LB = {};
  L.$ = id => document.getElementById(id);
  L.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  L.pad = n => String(n).padStart(2, '0');
  L.dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + L.pad(d.getMonth() + 1) + '-' + L.pad(d.getDate()); };
  L.fmt = (v, d = 1) => v == null || isNaN(v) ? '–' : v.toFixed(d);
  L.lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  L.lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  L.lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };
  L.configured = () => !!(window.LB_STORE && window.LB_STORE.configured());
  L.toast = msg => { const t = L.$('toast'); if (!t) return; t.textContent = msg; t.hidden = false; clearTimeout(L.toast._t); L.toast._t = setTimeout(() => t.hidden = true, 2800); };
  L.uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  L.brandHTML = () => '<img class="lg-l" src="assets/leebar.png" alt="LEE BAR"><img class="lg-d" src="assets/leebar-dark.png" alt="LEE BAR">';
  L.face = s => {
    const c = (s - 3) * 7, y = 43 - (s - 3) * 1.2;
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="var(--r${s})"/>
  <circle cx="22" cy="26" r="3.6" fill="var(--face-ink)"/><circle cx="42" cy="26" r="3.6" fill="var(--face-ink)"/>
  <path d="M19 ${y} Q32 ${y + c} 45 ${y}" fill="none" stroke="var(--face-ink)" stroke-width="3.6" stroke-linecap="round"/></svg>`;
  };
  L.RATINGS = [
    { k: 'food', en: 'How would you rate the quality of the food?', he: 'איך היית מדרג/ת את איכות האוכל?', short: 'איכות האוכל' },
    { k: 'service', en: 'How would you rate the service you received?', he: 'איך היית מדרג/ת את השירות שקיבלת?', short: 'שירות' },
    { k: 'variety', en: 'How satisfied were you with the menu variety?', he: 'כמה היית מרוצה מהמגוון בתפריט?', short: 'מגוון התפריט' },
    { k: 'clean', en: 'How would you rate the cleanliness of the dining area?', he: 'איך היית מדרג/ת את הניקיון בחדר האוכל?', short: 'ניקיון' }
  ];
  L.SCALE = { en: ['Very poor', 'Poor', 'OK', 'Good', 'Excellent'], he: ['גרוע', 'לא טוב', 'סביר', 'טוב', 'מצוין'] };
  L.EXPECT = [
    { k: 'exceeded', en: 'Exceeded expectations', he: 'עלתה על הציפיות', c: 'var(--r5)' },
    { k: 'met', en: 'Met expectations', he: 'עמדה בציפיות', c: 'var(--r4)' },
    { k: 'partial', en: 'Partially met expectations', he: 'עמדה בציפיות חלקית', c: 'var(--r3)' },
    { k: 'not', en: 'Did not meet expectations', he: 'לא עמדה בציפיות', c: 'var(--r1)' }
  ];
})();
