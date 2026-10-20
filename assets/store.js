/* Data layer: Microsoft sign-in (MSAL) + SharePoint lists through Microsoft Graph. */
(function () {
  'use strict';
  const C = window.LEEBAR_CONFIG || {};
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const SCOPES = ['User.Read', 'Sites.ReadWrite.All'];
  const SETUP_SCOPES = ['User.Read', 'Sites.ReadWrite.All', 'Sites.Manage.All'];
  const LISTS = {
    responses: { name: 'LBFeedbackResponses', title: 'משובי חדר אוכל', columns: [
      ['StationId', 'text', true], ['StationName', 'text'], ['Ts', 'number', true], ['Day', 'text', true], ['Clock', 'text'],
      ['Food', 'number'], ['Service', 'number'], ['Variety', 'number'], ['Clean', 'number'], ['Expect', 'text'],
      ['Enjoyed', 'note'], ['Improve', 'note'], ['Comments', 'note'], ['Lang', 'text'], ['Rid', 'text', true], ['Name', 'text']] },
    stations: { name: 'LBFeedbackStations', title: 'תחנות משוב', columns: [
      ['StationId', 'text', true], ['SortOrder', 'number'], ['Managers', 'note'], ['PartnerLogo', 'text'], ['PartnerName', 'text']] },
    recipients: { name: 'LBFeedbackRecipients', title: 'נמעני דוח משוב', columns: [
      ['ReportTime', 'text'], ['Stations', 'note'], ['Active', 'boolean'], ['SortOrder', 'number']] },
    settings: { name: 'LBFeedbackSettings', title: 'הגדרות משוב', columns: [['Value', 'note']] }
  };
  const S = window.LB_STORE = {};
  let msalApp = null, account = null, siteId = null, listIds = null;

  S.configured = () => !!(C.clientId && C.tenantId && C.siteHost && window.msal);

  /* ---------- sign-in ---------- */
  S.init = async () => {
    if (!S.configured()) return null;
    msalApp = new msal.PublicClientApplication({
      auth: { clientId: C.clientId, authority: 'https://login.microsoftonline.com/' + C.tenantId, redirectUri: location.origin + location.pathname },
      cache: { cacheLocation: 'localStorage' }
    });
    if (msalApp.initialize) await msalApp.initialize();
    const res = await msalApp.handleRedirectPromise().catch(e => { console.error(e); return null; });
    account = (res && res.account) || msalApp.getAllAccounts()[0] || null;
    return account;
  };
  S.account = () => account;
  S.email = () => String(account && (account.username || '') || '').toLowerCase();
  S.login = (setup) => msalApp.loginRedirect({ scopes: setup ? SETUP_SCOPES : SCOPES, prompt: 'select_account' });
  S.logout = () => msalApp.logoutRedirect({ account, postLogoutRedirectUri: location.origin + location.pathname });
  async function token(scopes = SCOPES) {
    try { return (await msalApp.acquireTokenSilent({ scopes, account })).accessToken; }
    catch (e) { await msalApp.acquireTokenRedirect({ scopes, account }); throw new Error('redirecting'); }
  }

  /* ---------- graph ---------- */
  async function g(path, { method = 'GET', body, scopes } = {}) {
    const t = await token(scopes);
    const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
      method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 204) return null;
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error((j.error && j.error.message) || 'graph_' + res.status); e.status = res.status; e.code = j.error && j.error.code; throw e; }
    return j;
  }
  async function site() {
    if (!siteId) siteId = (await g(`/sites/${C.siteHost}:${C.sitePath}?$select=id`)).id;
    return siteId;
  }
  async function lists() {
    if (listIds) return listIds;
    const sid = await site();
    const r = await g(`/sites/${sid}/lists?$select=id,name,displayName&$top=999`);
    const map = {};
    (r.value || []).forEach(l => { Object.keys(LISTS).forEach(k => { if (l.name === LISTS[k].name || l.displayName === LISTS[k].name) map[k] = l.id; }); });
    listIds = map; return map;
  }
  async function items(k, filter) {
    const ids = await lists(); if (!ids[k]) { const e = new Error('missing_list'); e.code = 'missing_list'; throw e; }
    let url = `/sites/${await site()}/lists/${ids[k]}/items?$expand=fields&$top=999` + (filter ? '&$filter=' + encodeURIComponent(filter) : '');
    const out = [];
    while (url) { const r = await g(url); out.push(...(r.value || [])); url = r['@odata.nextLink'] || null; }
    return out.map(i => Object.assign({ _id: i.id, _created: i.createdDateTime, _author: i.createdBy && i.createdBy.user && i.createdBy.user.email }, i.fields));
  }
  const create = async (k, fields) => g(`/sites/${await site()}/lists/${(await lists())[k]}/items`, { method: 'POST', body: { fields } });
  const patch = async (k, id, fields) => g(`/sites/${await site()}/lists/${(await lists())[k]}/items/${id}/fields`, { method: 'PATCH', body: fields });
  const remove = async (k, id) => g(`/sites/${await site()}/lists/${(await lists())[k]}/items/${id}`, { method: 'DELETE' });

  /* ---------- setup: create lists + seed ---------- */
  S.needsSetup = async () => { const ids = await lists(); return Object.keys(LISTS).filter(k => !ids[k]); };
  S.setup = async () => {
    const sid = await site(), ids = await lists();
    for (const k of Object.keys(LISTS)) {
      if (ids[k]) continue;
      const def = LISTS[k];
      const columns = def.columns.map(([name, type, indexed]) => {
        const c = { name, indexed: !!indexed };
        if (type === 'number') c.number = {}; else if (type === 'boolean') c.boolean = {}; else if (type === 'note') c.text = { allowMultipleLines: true, linesForEditing: 3 }; else c.text = {};
        return c;
      });
      const r = await g(`/sites/${sid}/lists`, { method: 'POST', scopes: SETUP_SCOPES, body: { displayName: def.name, description: def.title, columns, list: { template: 'genericList' } } });
      ids[k] = r.id;
    }
    // seed only empty lists
    if (!(await items('stations')).length) await create('stations', { Title: 'כוחות זרים - נתב"ג', StationId: 'natbag', SortOrder: 1, Managers: '', PartnerLogo: 'assets/noamer.png', PartnerName: 'NOAMER' });
    if (!(await items('recipients')).length) {
      const seed = [['chef', '09:00'], ['Yonatan', '09:00'], ['eden', '09:00'], ['asaf', '09:00'], ['simo', '09:00'], ['zion', '09:00'], ['refael', '09:00'], ['Avivm', '09:00'], ['natan', '10:00'], ['Eyal', '08:00']];
      for (let i = 0; i < seed.length; i++) await create('recipients', { Title: seed[i][0] + '@leebar.co.il', ReportTime: seed[i][1], Stations: 'all', Active: true, SortOrder: i + 1 });
    }
    const st = await items('settings');
    if (!st.find(x => x.Title === 'admins')) await create('settings', { Title: 'admins', Value: S.email() });
    if (!st.find(x => x.Title === 'prevDay')) await create('settings', { Title: 'prevDay', Value: 'true' });
  };

  /* ---------- reads ---------- */
  const mapStation = x => ({ _id: x._id, id: x.StationId, name: x.Title, order: x.SortOrder || 0, managers: splitList(x.Managers), partnerLogo: x.PartnerLogo || '', partnerName: x.PartnerName || '' });
  const splitList = v => String(v || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  S.stations = async () => (await items('stations')).map(mapStation).sort((a, b) => a.order - b.order);
  S.settings = async () => { const o = {}; (await items('settings')).forEach(x => { o[x.Title] = { _id: x._id, value: x.Value || '' }; }); return o; };
  S.recipients = async () => (await items('recipients')).map(x => ({ _id: x._id, id: x._id, email: x.Title || '', time: String(x.ReportTime || '09:00').slice(0, 5), stations: !x.Stations || x.Stations === 'all' ? 'all' : String(x.Stations).split(',').filter(Boolean), active: x.Active !== false, order: x.SortOrder || 0 })).sort((a, b) => a.order - b.order);
  S.responses = async (from, to) => {
    // filtered here, not in the Graph query: a column filter can silently return nothing on some lists
    const p = n => String(n).padStart(2, '0');
    S.lastTotal = 0;
    return (await items('responses')).map(x => {
      let ts = Number(x.Ts);
      if (!ts) ts = Date.parse(x._created) || 0;
      const d = new Date(ts);
      return { ts, date: x.Day || (d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())), time: x.Clock || (p(d.getHours()) + ':' + p(d.getMinutes())), station: x.StationId, food: Number(x.Food) || null, service: Number(x.Service) || null, variety: Number(x.Variety) || null, clean: Number(x.Clean) || null,
      expect: x.Expect || '', enjoyed: x.Enjoyed || '', improve: x.Improve || '', comments: x.Comments || '', name: x.Name || '', lang: x.Lang || '' };
    }).filter(r => { S.lastTotal = (S.lastTotal || 0); return true; }).filter((r, i, all) => { if (i === 0) S.lastTotal = all.length; return (!from || r.ts >= from) && (!to || r.ts < to); });
  };

  /* ---------- writes ---------- */
  S.submit = async (station, r) => {
    const d = new Date(r.ts), p = n => String(n).padStart(2, '0');
    const score = v => v >= 1 && v <= 5 ? Math.round(v) : null;
    const clip = v => String(v || '').slice(0, 600);
    const fields = { Title: station.name, StationId: station.id, StationName: station.name, Ts: r.ts, Day: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), Clock: p(d.getHours()) + ':' + p(d.getMinutes()),
      Expect: r.expect || '', Enjoyed: clip(r.enjoyed), Improve: clip(r.improve), Comments: clip(r.comments), Lang: r.lang, Rid: r.id };
    ['food', 'service', 'variety', 'clean'].forEach(k => { const v = score(r[k]); if (v != null) fields[k[0].toUpperCase() + k.slice(1)] = v; });
    const name = String(r.name || '').trim().slice(0, 60);
    if (!name) return create('responses', fields);
    try { return await create('responses', Object.assign({ Name: name }, fields)); }
    catch (e) {
      // the Name column is added the first time an admin opens the dashboard; until then keep the name in the comments
      if (e.status !== 400) throw e;
      fields.Comments = clip(('שם: ' + name + (fields.Comments ? ' · ' + fields.Comments : '')));
      return create('responses', fields);
    }
  };
  /* adds columns introduced after the lists were created (admin only, needs list-manage rights) */
  S.ensureColumns = async () => {
    const ids = await lists(); if (!ids.responses) return;
    const sid = await site();
    const cols = await g(`/sites/${sid}/lists/${ids.responses}/columns?$select=name&$top=500`);
    const have = new Set((cols.value || []).map(c => c.name));
    if (!have.has('Name')) await g(`/sites/${sid}/lists/${ids.responses}/columns`, { method: 'POST', scopes: SETUP_SCOPES, body: { name: 'Name', text: {} } });
  };
  S.addStation = (name, managers, order) => create('stations', { Title: name, StationId: 'st' + Date.now().toString(36), SortOrder: order, Managers: managers.join(', '), PartnerLogo: '', PartnerName: '' });
  S.updateStation = (id, f) => patch('stations', id, f);
  S.saveRecipient = (r, order) => {
    const f = { Title: r.email || '', ReportTime: r.time || '09:00', Stations: r.stations === 'all' || !r.stations || !r.stations.length ? 'all' : r.stations.join(','), Active: r.active !== false };
    return r._id ? patch('recipients', r._id, f) : create('recipients', Object.assign(f, { SortOrder: order }));
  };
  S.deleteRecipient = id => remove('recipients', id);
  S.setSetting = async (key, value) => { const s = await S.settings(); return s[key] ? patch('settings', s[key]._id, { Value: value }) : create('settings', { Title: key, Value: value }); };
  S.splitList = splitList;
})();
