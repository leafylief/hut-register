// Hut Register: the staff app for The Hut Warehouse.
// Sell (tickets, drinks, classes) with a Stripe card reader or cash, run the guest list,
// check people in, see the night's lineup and crew, and tick off flyering spots.
// Everything talks to the Hut system's /api/pos API, so it's the same people, tickets,
// tokens and reports as the website and the admin.
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { StripeTerminal, TerminalConnectTypes, TerminalEventsEnum } from '@capacitor-community/stripe-terminal';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';

const NATIVE = Capacitor.isNativePlatform();
const DEFAULT_SERVER = 'https://hut-test.lief-darling.workers.dev';
const $app = document.getElementById('app');

// ---------- state ----------
const S = {
  server: DEFAULT_SERVER, token: null, tab: 'sell', cat: 'tickets', catalog: null, eventId: null,
  cart: [], customer: null, reader: null, readerBusy: false, guests: [], guestQ: '', show: null, spots: [], flyerBy: '',
  cartOpen: false,
};
const money = (c) => '$' + (c / 100).toFixed(2);
const short = (c) => '$' + (c % 100 ? (c / 100).toFixed(2) : c / 100);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = (iso, o = { weekday: 'short', hour: 'numeric', minute: '2-digit' }) => (iso ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', ...o }).format(new Date(iso)) : '');
const tap = () => NATIVE && Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});

async function saveP(k, v) { await Preferences.set({ key: k, value: v == null ? '' : String(v) }); }
async function loadP(k) { return (await Preferences.get({ key: k })).value || null; }

function toast(msg, bad = false) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), bad ? 4500 : 2200);
}

// ---------- api ----------
async function api(path, body, method) {
  const r = await fetch(S.server + '/api/pos/' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(S.token && S.token !== 'session' ? { authorization: 'Bearer ' + S.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({ error: 'The Hut system did not answer' }));
  if (r.status === 401 && path !== 'login') { S.token = null; await saveP('token', ''); render(); throw new Error('Signed out. Enter the PIN again.'); }
  if (!r.ok && j.error) throw Object.assign(new Error(j.error), { status: r.status, data: j });
  return j;
}

// ---------- icons ----------
const I = {
  sell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18l-2 12H5z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3"/><path d="M7 12h10"/></svg>',
  show: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>',
  flyer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
};
const TABS = [['sell', 'Sell'], ['list', 'Guest list'], ['scan', 'Check in'], ['show', 'Show'], ['flyer', 'Flyering'], ['gear', 'Settings']];
const CATS = [['tickets', 'Tickets'], ['drinks', 'Drinks'], ['classes', 'Classes'], ['snacks', 'Snacks'], ['merch', 'Merch']];

// ---------- render ----------
function render() {
  if (!S.token) return renderLogin();
  const evs = S.catalog?.events || [];
  const readerPill = S.reader ? `<span class="pill on"><span class="dot"></span>${esc(S.reader.label || 'Reader')}</span>` : `<span class="pill">No reader</span>`;
  $app.innerHTML = `
    <div class="top"><img src="img/logo-white.svg" alt="The Hut">
      <div class="ev"><select id="ev">${evs.length ? evs.map((e) => `<option value="${e.id}" ${e.id === S.eventId ? 'selected' : ''}>${esc(when(e.starts_at, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${esc(e.title)}</option>`).join('') : '<option>No events in the next two weeks</option>'}</select></div>
      <button id="readerPill">${readerPill}</button></div>
    <div class="main">${VIEWS[S.tab]()}</div>
    <nav class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${I[k]}<span>${l}</span></button>`).join('')}</nav>`;
  wire();
}

function renderLogin() {
  let pin = '';
  const draw = () => {
    $app.innerHTML = `<div class="login"><div class="sheet" style="text-align:center">
      <img src="img/logo-black.svg" alt="" style="height:54px"><h2 style="margin-top:8px">Hut Register</h2><p style="color:var(--muted);margin:0">Enter the door PIN</p>
      <div class="pin">${Array.from({ length: Math.max(6, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'f' : ''}"></span>`).join('')}</div>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '→'].map((k) => `<button data-k="${k}">${k}</button>`).join('')}</div>
      <p style="font-size:12px;color:var(--muted);margin-top:14px">${esc(S.server.replace('https://', ''))}</p></div></div>`;
    $app.querySelectorAll('[data-k]').forEach((b) => b.onclick = async () => {
      tap(); const k = b.dataset.k;
      if (k === '⌫') pin = pin.slice(0, -1);
      else if (k === '→') {
        try { const j = await api('login', { pin }); S.token = j.token; await saveP('token', j.token); await boot(); return; }
        catch (e) { toast(e.message, true); pin = ''; }
      } else if (pin.length < 10) pin += k;
      draw();
    });
  };
  draw();
}

// ---------- sell ----------
const lineKey = (it, price) => it.product_id + ':' + (price ?? '');
function cartTotals() {
  const bp = S.catalog?.rate_bp || 81875;
  const sub = S.cart.reduce((a, l) => a + l.unit * l.qty, 0);
  const tax = S.cart.reduce((a, l) => a + (l.taxable ? Math.round((l.unit * l.qty * bp) / 1e6) : 0), 0);
  return { sub, tax, total: sub + tax, count: S.cart.reduce((a, l) => a + l.qty, 0) };
}
function itemsFor(cat) {
  const items = (S.catalog?.items || []).filter((i) => i.category === cat);
  if (cat === 'tickets' && S.eventId) return items.sort((a, b) => (b.occurrence_id === S.eventId) - (a.occurrence_id === S.eventId));
  return items;
}
function tile(it) {
  const inCart = S.cart.filter((l) => l.product_id === it.product_id).reduce((a, l) => a + l.qty, 0);
  const ini = it.name.replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const price = it.max_cents ? `${short(it.price_cents)} to ${short(it.max_cents)}` : short(it.price_cents);
  const label = it.event && it.kind !== 'pack' ? it.name.replace(it.event + ' · ', '') : it.name;
  return `<button class="tile" data-add="${it.product_id}" style="${it.image ? '' : `background:${color(it.name)}`}">
    ${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : `<span class="ini">${esc(ini)}</span>`}
    ${it.starts_at ? `<span class="when">${esc(when(it.starts_at, { weekday: 'short', month: 'numeric', day: 'numeric' }))}</span>` : ''}
    ${inCart ? `<span class="qty">${inCart}</span>` : ''}
    <span class="shade"><div class="nm">${esc(it.event && it.kind === 'ticket' ? it.event : label)}</div><div class="pr">${it.event && it.kind === 'ticket' ? esc(label) + ' · ' : ''}${price}</div></span></button>`;
}
function color(s) { const c = ['#1f5f4f', '#8f5371', '#2d6f8f', '#7a5a2f', '#4a5d8f', '#6d3f5c', '#2f7d62', '#9a4a3a']; let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return c[h % c.length]; }

const VIEWS = {
  sell() {
    const t = cartTotals();
    const items = itemsFor(S.cat);
    return `<div class="reg"><div class="left">
      <div class="cats">${CATS.filter(([k]) => k === 'tickets' || k === 'drinks' || k === 'classes' || (S.catalog?.items || []).some((i) => i.category === k)).map(([k, l]) => `<button data-cat="${k}" class="${S.cat === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="grid">${items.map(tile).join('') || `<div class="empty">Nothing here yet. Add items in the admin, or ask Claude to.</div>`}</div></div>
      <aside class="cart ${S.cartOpen ? 'open' : ''}"><h3>Current sale ${S.cartOpen ? '<button id="closeCart" style="float:right;font-size:15px;color:var(--muted)">Close</button>' : ''}</h3>
        <div class="lines">${S.cart.map((l, i) => `<div class="line"><div class="n">${esc(l.name)}${l.event ? `<small>${esc(l.event)}</small>` : ''}</div>
          <div class="q"><button data-dec="${i}">−</button><b>${l.qty}</b><button data-inc="${i}">+</button></div><div class="a">${money(l.unit * l.qty)}</div></div>`).join('') || '<p style="color:var(--muted);padding:10px 6px">Tap something to add it.</p>'}</div>
        <div class="who">${S.customer ? `<span>👤 ${esc(S.customer.name || S.customer.phone || S.customer.email)}</span><button id="clearWho" style="color:var(--plum);font-weight:600">Remove</button>` : `<span style="color:var(--muted)">No customer</span><button id="addWho" style="color:var(--green);font-weight:700">Add customer</button>`}</div>
        <div class="tot"><div><span>Subtotal</span><span>${money(t.sub)}</span></div><div><span>GRT</span><span>${money(t.tax)}</span></div><div class="big"><span>Total</span><span>${money(t.total)}</span></div></div>
        <div class="pay"><button class="btn o" id="clear" ${S.cart.length ? '' : 'disabled'}>Clear</button><button class="btn o" id="cash" ${S.cart.length ? '' : 'disabled'}>Cash</button><button class="btn main" id="charge" ${S.cart.length ? '' : 'disabled'}>Charge ${money(t.total)}</button></div>
      </aside></div>
      ${S.cart.length && !S.cartOpen ? `<button class="btn main mini-cart" id="openCart">${t.count} item${t.count === 1 ? '' : 's'} · Review ${money(t.total)}</button>` : ''}`;
  },

  list() {
    const q = S.guestQ.toLowerCase();
    const rows = S.guests.filter((g) => !q || g.name.toLowerCase().includes(q));
    const heads = S.guests.reduce((n, g) => n + 1 + g.plus, 0), inn = S.guests.filter((g) => g.checked_in_at).reduce((n, g) => n + 1 + g.plus_in, 0);
    const groups = [['crew', 'Crew'], ['friends', 'Friends'], ['guests', 'Guests']];
    return `<div class="page"><h2>Guest list</h2>
      <div class="stat"><div class="card"><b>${S.guests.length}</b>names</div><div class="card"><b>${heads}</b>with pluses</div><div class="card"><b>${inn}</b>in the door</div></div>
      <div style="display:flex;gap:8px"><input class="search" id="gq" placeholder="Search the list" value="${esc(S.guestQ)}" style="margin:0"><button class="btn" id="addGuest">Add</button></div>
      <div class="card" style="margin-top:12px">${groups.map(([k, l]) => { const g = rows.filter((x) => x.grp === k); return g.length ? `<div class="grp">${l}</div>${g.map(guestRow).join('')}` : ''; }).join('') || '<p style="color:var(--muted)">No one on the list for this night.</p>'}</div></div>`;
  },

  scan() {
    return `<div class="page"><h2>Check in</h2>
      <p style="color:var(--muted);margin-top:0">Scan a ticket or wallet QR, or find someone by name or phone.</p>
      <button class="btn main" id="scanBtn" style="width:100%;padding:18px">${I.scan.replace('<svg', '<svg width="24" height="24"')} Scan a QR</button>
      <input class="search" id="who" placeholder="Name, phone or email" autocomplete="off">
      <div id="scanOut"></div><div class="card" id="whoList" style="display:none"></div></div>`;
  },

  show() {
    const sh = S.show;
    if (!sh) return `<div class="page"><h2>Show</h2><p style="color:var(--muted)">Loading…</p></div>`;
    const stages = [...new Set(sh.lineup.map((s) => s.stage))];
    return `<div class="page"><h2>Lineup</h2>${stages.length ? stages.map((st) => `<div class="card"><div class="grp">${esc(st)}</div>${sh.lineup.filter((s) => s.stage === st).map((s) => `<div class="set"><span class="t">${esc(s.time_label)}</span><span>${esc(s.dj)}</span></div>`).join('')}</div>`).join('') : '<div class="card" style="color:var(--muted)">No lineup for this night yet.</div>'}
      <h2 style="margin-top:14px">Crew</h2><div class="card">${sh.roles.length ? sh.roles.map((r) => `<div class="set"><span class="t" style="width:110px">${esc(r.role)}</span><span>${esc(r.people)}</span></div>`).join('') : '<span style="color:var(--muted)">No crew set for this night.</span>'}</div></div>`;
  },

  flyer() {
    const areas = [...new Set(S.spots.map((s) => s.area))];
    const done = S.spots.filter((s) => s.large || s.small).length;
    return `<div class="page"><h2>Flyering</h2><p style="color:var(--muted);margin-top:0">${done} of ${S.spots.length} spots done for this show.</p>
      <input class="search" id="flyBy" placeholder="Your name (so we know who did what)" value="${esc(S.flyerBy)}">
      ${areas.map((a) => `<div class="card"><div class="grp">${esc(a)}</div>${S.spots.filter((s) => s.area === a).map((s) => `<div class="row"><div class="n"><b>${esc(s.name)}</b>${s.by ? `<small>${esc(s.by)}</small>` : ''}</div>
        <button class="toggle ${s.large ? 'on' : ''}" data-fly="${s.id}" data-k="large">Large</button><button class="toggle ${s.small ? 'on' : ''}" data-fly="${s.id}" data-k="small">Small</button></div>`).join('')}</div>`).join('')}</div>`;
  },

  gear() {
    return `<div class="page"><h2>Settings</h2>
      <div class="card"><div class="grp">Card reader</div>
        <p>${S.reader ? `Connected: <b>${esc(S.reader.label)}</b>${S.reader.battery != null ? ` · battery ${Math.round(S.reader.battery * 100)}%` : ''}` : NATIVE ? 'No reader connected.' : 'Card readers connect from the installed app on the iPad or Android tablet.'}</p>
        ${NATIVE ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="findReader">Find a Bluetooth reader</button><button class="btn o" id="simReader">Use a test reader</button>${S.reader ? '<button class="btn bad" id="dropReader">Disconnect</button>' : ''}</div>` : ''}</div>
      <div class="card"><div class="grp">Tonight's register</div><div id="summary" style="color:var(--muted)">Loading…</div></div>
      <div class="card"><div class="grp">System</div><p style="word-break:break-all">${esc(S.server)}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn o" id="server">Change</button><button class="btn o" id="refresh">Refresh items</button><button class="btn bad" id="signout">Sign out</button></div></div></div>`;
  },
};

function guestRow(g) {
  return `<div class="row"><div class="n"><b>${esc(g.name)}${g.plus ? ` <span style="color:var(--muted);font-weight:500">+${g.plus}</span>` : ''}</b>
    <small>${g.link_owner ? 'via ' + esc(g.link_owner) : esc(g.added_by || '')}</small>${g.flagged ? `<div class="flag">Do not admit: ${esc(g.flagged.note)} (${esc(g.flagged.until)})</div>` : ''}</div>
    ${g.checked_in_at ? `<span class="tag">in${g.plus ? ' +' + g.plus_in : ''}</span><button class="toggle" data-gundo="${g.id}">Undo</button>`
      : `${g.plus ? `<div class="stepper"><button data-gm="${g.id}">−</button><b id="pi_${g.id}">${g.plus}</b><button data-gp="${g.id}">+</button></div>` : ''}<button class="btn" style="padding:10px 14px" data-gin="${g.id}">Check in</button>`}</div>`;
}

// ---------- wiring ----------
function wire() {
  const on = (sel, fn) => document.querySelectorAll(sel).forEach((el) => (el.onclick = (e) => { tap(); fn(el, e); }));
  on('[data-tab]', (b) => { S.tab = b.dataset.tab; S.cartOpen = false; render(); loadTab(); });
  const ev = document.getElementById('ev'); if (ev) ev.onchange = () => { S.eventId = ev.value; saveP('event', ev.value); render(); loadTab(); };
  on('#readerPill', () => { S.tab = 'gear'; render(); loadTab(); });
  on('[data-cat]', (b) => { S.cat = b.dataset.cat; render(); });
  on('[data-add]', (b) => addItem(b.dataset.add));
  on('[data-inc]', (b) => { S.cart[b.dataset.inc].qty++; render(); });
  on('[data-dec]', (b) => { const l = S.cart[b.dataset.dec]; if (--l.qty <= 0) S.cart.splice(b.dataset.dec, 1); render(); });
  on('#clear', () => { S.cart = []; S.customer = null; S.cartOpen = false; render(); });
  on('#openCart', () => { S.cartOpen = true; render(); });
  on('#closeCart', () => { S.cartOpen = false; render(); });
  on('#addWho', () => customerSheet());
  on('#clearWho', () => { S.customer = null; render(); });
  on('#cash', () => cashSheet());
  on('#charge', () => charge());
  // guest list
  const gq = document.getElementById('gq'); if (gq) gq.oninput = () => { S.guestQ = gq.value; const c = gq.selectionStart; render(); const n = document.getElementById('gq'); n.focus(); n.setSelectionRange(c, c); };
  on('#addGuest', () => addGuestSheet());
  on('[data-gp]', (b) => { const el = document.getElementById('pi_' + b.dataset.gp); const g = S.guests.find((x) => x.id === b.dataset.gp); el.textContent = Math.min(g.plus, +el.textContent + 1); });
  on('[data-gm]', (b) => { const el = document.getElementById('pi_' + b.dataset.gm); el.textContent = Math.max(0, +el.textContent - 1); });
  on('[data-gin]', async (b) => {
    const g = S.guests.find((x) => x.id === b.dataset.gin);
    if (g.flagged && !confirm(`${g.name} is on the do not admit list: ${g.flagged.note}. Check them in anyway?`)) return;
    const pi = document.getElementById('pi_' + g.id);
    try { await api('door/guestin', { guest_id: g.id, plus_in: pi ? +pi.textContent : 0 }); toast(`${g.name} is in`); await loadGuests(); } catch (e) { toast(e.message, true); }
  });
  on('[data-gundo]', async (b) => { try { await api('door/guestin', { guest_id: b.dataset.gundo, undo: true }); await loadGuests(); } catch (e) { toast(e.message, true); } });
  // check in
  on('#scanBtn', () => scanQR());
  const who = document.getElementById('who'); if (who) { let t; who.oninput = () => { clearTimeout(t); t = setTimeout(() => search(who.value), 250); }; }
  // flyering
  const fb = document.getElementById('flyBy'); if (fb) fb.onchange = () => { S.flyerBy = fb.value; saveP('flyerBy', fb.value); };
  on('[data-fly]', async (b) => {
    const s = S.spots.find((x) => x.id === b.dataset.fly); s[b.dataset.k] = s[b.dataset.k] ? 0 : 1; render();
    try { const j = await api('flyering/' + S.eventId, { spot_id: s.id, large: !!s.large, small: !!s.small, by: S.flyerBy }); S.spots = j.spots; render(); } catch (e) { toast(e.message, true); }
  });
  // settings
  on('#findReader', () => connectReader(false));
  on('#simReader', () => connectReader(true));
  on('#dropReader', async () => { await StripeTerminal.disconnectReader().catch(() => {}); S.reader = null; render(); });
  on('#refresh', async () => { await loadCatalog(); toast('Items refreshed'); });
  on('#signout', async () => { S.token = null; await saveP('token', ''); render(); });
  on('#server', () => serverSheet());
}

function sheet(html, bind) {
  const v = document.createElement('div'); v.className = 'veil'; v.innerHTML = `<div class="sheet">${html}</div>`;
  v.onclick = (e) => { if (e.target === v) v.remove(); };
  document.body.appendChild(v); bind?.(v, () => v.remove()); return v;
}

function addItem(pid) {
  const it = S.catalog.items.find((i) => i.product_id === pid);
  if (!it) return;
  const push = (unit) => {
    const k = lineKey(it, it.max_cents ? unit : null);
    const ex = S.cart.find((l) => l.key === k);
    if (ex) ex.qty++; else S.cart.push({ key: k, product_id: it.product_id, name: it.max_cents ? `${it.name.replace((it.event || '') + ' · ', '')} (${money(unit)})` : it.name.replace((it.event || '') + ' · ', ''), event: it.event, unit, qty: 1, taxable: it.taxable, price_cents: it.max_cents ? unit : null, needs_person: it.needs_person });
    render();
    if (it.needs_person && !S.customer) customerSheet('Token packs need a person, so the tokens land in their wallet.');
  };
  if (!it.max_cents) return push(it.price_cents);
  sheet(`<h2>${esc(it.event || it.name)}</h2><p style="color:var(--muted);margin:0">Sliding scale, ${money(it.price_cents)} to ${money(it.max_cents)} before tax</p>
    <label>Amount</label><input id="amt" inputmode="decimal" value="${(it.price_cents / 100).toFixed(2)}">
    <div class="keys" style="grid-template-columns:repeat(4,1fr)">${[it.price_cents, Math.round((it.price_cents + it.max_cents) / 200) * 100, it.max_cents].map((c) => `<button data-q="${c}">${money(c)}</button>`).join('')}</div>
    <div class="acts"><button class="btn o" data-x>Cancel</button><button class="btn main" data-ok>Add</button></div>`, (v, close) => {
    v.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => (v.querySelector('#amt').value = (b.dataset.q / 100).toFixed(2)));
    v.querySelector('[data-x]').onclick = close;
    v.querySelector('[data-ok]').onclick = () => {
      const c = Math.round(parseFloat(v.querySelector('#amt').value) * 100);
      if (!(c >= it.price_cents && c <= it.max_cents)) return toast(`Pick between ${money(it.price_cents)} and ${money(it.max_cents)}`, true);
      close(); push(c);
    };
  });
}

function customerSheet(note) {
  sheet(`<h2>Customer</h2>${note ? `<p style="color:var(--muted);margin:0">${esc(note)}</p>` : ''}
    <label>Search people</label><input id="cq" placeholder="Name, phone or email" autocomplete="off"><div id="cres"></div>
    <div class="grp" style="margin-top:14px">Or add someone new</div>
    <label>Name</label><input id="cn"><label>Phone</label><input id="cp" inputmode="tel"><label>Email</label><input id="ce" inputmode="email">
    <div class="acts"><button class="btn o" data-x>Cancel</button><button class="btn main" data-ok>Use</button></div>`, (v, close) => {
    let t; const q = v.querySelector('#cq');
    q.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      if (q.value.trim().length < 2) return (v.querySelector('#cres').innerHTML = '');
      const j = await api('door/search', { q: q.value }).catch(() => ({ results: [] }));
      v.querySelector('#cres').innerHTML = j.results.map((c) => `<div class="row"><div class="n"><b>${esc(c.name || '(no name)')}</b><small>${esc(c.phone || c.email || '')} · ${c.balance} tokens</small>${c.flagged ? '<span class="tag bad">do not admit</span>' : ''}</div><button class="btn" data-pick="${c.id}">Pick</button></div>`).join('');
      v.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { S.customer = j.results.find((c) => c.id === b.dataset.pick); close(); render(); });
    }, 250); };
    v.querySelector('[data-x]').onclick = close;
    v.querySelector('[data-ok]').onclick = () => {
      const c = { name: v.querySelector('#cn').value.trim(), phone: v.querySelector('#cp').value.trim(), email: v.querySelector('#ce').value.trim() };
      if (!c.name && !c.phone && !c.email) return toast('Add a name, phone or email', true);
      S.customer = c; close(); render();
    };
  });
}

function orderBody(method) {
  return { method, lines: S.cart.map((l) => ({ product_id: l.product_id, qty: l.qty, price_cents: l.price_cents })),
    ...(S.customer?.id ? { customer_id: S.customer.id } : S.customer ? { customer: S.customer } : {}) };
}

function done(total, method, change) {
  S.cart = []; S.customer = null; S.cartOpen = false; render();
  sheet(`<div class="ok-mark">✓</div><h2 style="text-align:center">${method === 'cash' ? 'Cash sale done' : 'Approved'}</h2><div class="big-total">${money(total)}</div>
    ${change ? `<p style="text-align:center;font-size:20px">Change due: <b>${money(change)}</b></p>` : ''}<div class="acts"><button class="btn main" data-x>New sale</button></div>`, (v, close) => (v.querySelector('[data-x]').onclick = close));
  NATIVE && Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
  loadCatalog();
}

function cashSheet() {
  const t = cartTotals();
  sheet(`<h2>Cash</h2><div class="big-total">${money(t.total)}</div><label>Cash given</label><input id="given" inputmode="decimal" placeholder="${(t.total / 100).toFixed(2)}">
    <div class="keys" style="grid-template-columns:repeat(4,1fr)">${[Math.ceil(t.total / 100) * 100, 2000, 4000, 10000].filter((c, i, a) => c >= t.total && a.indexOf(c) === i).map((c) => `<button data-q="${c}">${money(c)}</button>`).join('')}</div>
    <div class="acts"><button class="btn o" data-x>Cancel</button><button class="btn main" data-ok>Done</button></div>`, (v, close) => {
    v.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => (v.querySelector('#given').value = (b.dataset.q / 100).toFixed(2)));
    v.querySelector('[data-x]').onclick = close;
    v.querySelector('[data-ok]').onclick = async (e) => {
      const given = v.querySelector('#given').value ? Math.round(parseFloat(v.querySelector('#given').value) * 100) : t.total;
      if (given < t.total) return toast('That is less than the total', true);
      e.target.disabled = true;
      try { const j = await api('order', orderBody('cash')); close(); done(j.total_cents, 'cash', given - j.total_cents); }
      catch (err) { e.target.disabled = false; toast(err.message, true); }
    };
  });
}

async function charge() {
  if (!NATIVE) return toast('Card payments run in the installed app with a reader. Use Cash here, or the admin.', true);
  if (!S.reader) { toast('Connect a card reader first', true); S.tab = 'gear'; render(); loadTab(); return; }
  let order;
  const v = sheet(`<h2>Card</h2><div class="big-total">${money(cartTotals().total)}</div><div class="status" id="st">Getting ready…</div>
    <div class="acts"><button class="btn bad" data-x>Cancel</button></div>`, (vv) => {
    vv.querySelector('[data-x]').onclick = async () => {
      await StripeTerminal.cancelCollectPaymentMethod().catch(() => {});
      if (order) await api('cancel', { order_id: order.order_id }).catch(() => {});
      vv.remove();
    };
  });
  const st = (m) => { const el = v.querySelector('#st'); if (el) el.textContent = m; };
  try {
    order = await api('order', orderBody('card'));
    st('Tap, insert or swipe on the reader');
    await StripeTerminal.collectPaymentMethod({ paymentIntent: order.client_secret });
    st('Processing…');
    await StripeTerminal.confirmPaymentIntent();
    let r;
    for (let i = 0; i < 6; i++) { try { r = await api('complete', { order_id: order.order_id }); break; } catch (e) { if (e.status !== 409) throw e; await new Promise((ok) => setTimeout(ok, 800)); } }
    v.remove(); done(order.total_cents, 'card');
  } catch (e) {
    st(e.message || 'The payment did not go through');
    toast(e.message || 'Payment failed', true);
  }
}

function addGuestSheet() {
  if (!S.eventId) return toast('Pick an event at the top first', true);
  sheet(`<h2>Add to the list</h2><label>Name</label><input id="gn" autocomplete="off"><label>List</label><select id="gg"><option value="guests">Guests</option><option value="friends">Friends</option><option value="crew">Crew</option></select>
    <label>Plus ones</label><input id="gpl" type="number" min="0" max="20" value="0"><label>Phone (optional)</label><input id="gph" inputmode="tel">
    <div class="acts"><button class="btn o" data-x>Cancel</button><button class="btn main" data-ok>Add</button></div>`, (v, close) => {
    v.querySelector('[data-x]').onclick = close;
    v.querySelector('[data-ok]').onclick = async () => {
      try { const j = await api('door/guestadd', { occurrence_id: S.eventId, name: v.querySelector('#gn').value, grp: v.querySelector('#gg').value, plus: +v.querySelector('#gpl').value, phone: v.querySelector('#gph').value });
        if (j.error) throw new Error(j.error); S.guests = j.guests; close(); render(); toast('Added'); } catch (e) { toast(e.message, true); }
    };
  });
}

function serverSheet() {
  sheet(`<h2>System address</h2><p style="color:var(--muted);margin:0">The test site while we try things out, the live site once it's launched.</p>
    <label>Address</label><input id="srv" value="${esc(S.server)}">
    <div class="keys" style="grid-template-columns:1fr 1fr"><button data-s="https://hut-test.lief-darling.workers.dev">Test site</button><button data-s="https://thehutwarehouse.com">Live site</button></div>
    <div class="acts"><button class="btn o" data-x>Cancel</button><button class="btn main" data-ok>Save</button></div>`, (v, close) => {
    v.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => (v.querySelector('#srv').value = b.dataset.s));
    v.querySelector('[data-x]').onclick = close;
    v.querySelector('[data-ok]').onclick = async () => { S.server = v.querySelector('#srv').value.replace(/\/+$/, ''); await saveP('server', S.server); S.token = null; await saveP('token', ''); close(); render(); };
  });
}

// ---------- check in ----------
function showPerson(j) {
  const out = document.getElementById('scanOut'); if (!out) return;
  if (j.error) { out.innerHTML = `<div class="flag">${esc(j.error)}</div>`; return; }
  const c = j.customer || {};
  out.innerHTML = `<div class="card">${c.flagged ? `<div class="flag">Do not admit: ${esc(c.flagged.note)} (${esc(c.flagged.until)})</div>` : ''}
    <h2>${esc(c.name || '(no name)')}</h2><p style="margin:4px 0;color:var(--muted)">${j.type === 'booking' ? 'Ticket for this event' : `${j.balance ?? 0} tokens`}${j.booking_here ? ' · booked tonight' : ''}</p>
    <button class="btn main" id="ciGo" style="width:100%;margin-top:8px">Check in</button></div>`;
  document.getElementById('ciGo').onclick = async () => {
    if (c.flagged && !confirm(`${c.name} is on the do not admit list. Check in anyway?`)) return;
    try {
      const r = await api('door/checkin', j.type === 'booking' ? { booking_id: j.booking.id } : { customer_id: c.id, occurrence_id: S.eventId, idem: 'app:' + Date.now() });
      if (r.error) throw new Error(r.error);
      out.innerHTML = `<div class="card" style="text-align:center"><div class="ok-mark">✓</div><h2>${esc(c.name || '')} is in${r.already ? ' (already was)' : ''}</h2>${r.balance != null ? `<p>${r.balance} tokens left</p>` : ''}</div>`;
    } catch (e) { toast(e.message, true); }
  };
}
async function scanQR() {
  if (!NATIVE) { const code = prompt('Type or paste the code from the QR'); if (code) showPerson(await api('door/scan', { code, occurrence_id: S.eventId })); return; }
  try {
    const perm = await BarcodeScanner.requestPermissions(); if (perm.camera !== 'granted' && perm.camera !== 'limited') return toast('Allow the camera in Settings to scan', true);
    const { barcodes } = await BarcodeScanner.scan({ formats: ['QR_CODE'] });
    const code = barcodes?.[0]?.rawValue; if (!code) return;
    showPerson(await api('door/scan', { code, occurrence_id: S.eventId }));
  } catch (e) { toast(e.message || 'Scan cancelled', true); }
}
async function search(q) {
  const box = document.getElementById('whoList'); if (!box) return;
  if (q.trim().length < 2) { box.style.display = 'none'; return; }
  const j = await api('door/search', { q }).catch(() => ({ results: [] }));
  box.style.display = 'block';
  box.innerHTML = j.results.map((c) => `<div class="row"><div class="n"><b>${esc(c.name || '(no name)')}</b><small>${esc(c.phone || c.email || '')} · ${c.balance} tokens</small>${c.flagged ? '<span class="tag bad">do not admit</span>' : ''}</div><button class="btn" data-pick="${c.id}">Open</button></div>`).join('') || '<p style="color:var(--muted)">No one found.</p>';
  box.querySelectorAll('[data-pick]').forEach((b) => b.onclick = async () => { box.style.display = 'none'; showPerson(await api('door/scan', { customer_id: b.dataset.pick, occurrence_id: S.eventId })); });
}

// ---------- reader ----------
let terminalReady = false;
async function setupTerminal() {
  if (!NATIVE || terminalReady) return;
  await StripeTerminal.addListener(TerminalEventsEnum.RequestedConnectionToken, async () => {
    try { const j = await api('connection_token', {}); await StripeTerminal.setConnectionToken({ token: j.secret }); }
    catch (e) { toast('Reader sign in failed: ' + e.message, true); }
  });
  await StripeTerminal.addListener(TerminalEventsEnum.UnexpectedReaderDisconnect, () => { S.reader = null; render(); toast('Card reader disconnected', true); });
  await StripeTerminal.addListener(TerminalEventsEnum.BatteryLevel, (b) => { if (S.reader) { S.reader.battery = b.level; } });
  await StripeTerminal.addListener(TerminalEventsEnum.RequestDisplayMessage, (m) => { const el = document.getElementById('st'); if (el && m?.messageType) el.textContent = String(m.messageType).replace(/([A-Z])/g, ' $1').toLowerCase(); });
  // Test mode follows the server: a test key means simulated readers are available.
  await StripeTerminal.initialize({ isTest: S.server.includes('hut-test') });
  terminalReady = true;
}
async function connectReader(simulated) {
  try {
    await setupTerminal();
    const loc = (await api('location')).location;
    toast(simulated ? 'Starting the test reader…' : 'Looking for readers. Turn the reader on.');
    const { readers } = await StripeTerminal.discoverReaders({ type: TerminalConnectTypes.Bluetooth, locationId: loc, bluetoothScanWaitTime: simulated ? 0 : 6000 });
    if (!readers?.length) return toast('No reader found. Is it on and charged?', true);
    const r = readers[0];
    await StripeTerminal.connectReader({ reader: r, autoReconnectOnUnexpectedDisconnect: true });
    S.reader = { label: r.label || r.deviceType || r.serialNumber || 'Reader', serial: r.serialNumber, battery: r.batteryLevel };
    await saveP('lastReader', r.serialNumber || '');
    render(); toast('Reader connected');
  } catch (e) { toast(e.message || 'Could not connect the reader', true); }
}

// ---------- loading ----------
async function loadCatalog() {
  S.catalog = await api('catalog');
  if (!S.eventId || !S.catalog.events.some((e) => e.id === S.eventId)) {
    const evs = S.catalog.events, soon = evs.find((e) => e.kind === 'event') || evs[0];
    S.eventId = soon?.id || null;
  }
  render();
}
async function loadGuests() { if (!S.eventId) return; const j = await api('door/guests', { occurrence_id: S.eventId }); S.guests = j.guests || []; if (S.tab === 'list') render(); }
async function loadTab() {
  try {
    if (S.tab === 'list') await loadGuests();
    if (S.tab === 'show' && S.eventId) { S.show = null; render(); S.show = await api('show/' + S.eventId); render(); }
    if (S.tab === 'flyer' && S.eventId) { S.spots = (await api('flyering/' + S.eventId)).spots; render(); }
    if (S.tab === 'gear') {
      const j = await api('summary'); const el = document.getElementById('summary');
      if (el) el.innerHTML = j.by_method.length ? j.by_method.map((m) => `<div class="set"><span class="t">${m.method === 'cash' ? 'Cash' : 'Card'}</span><span>${m.n} sales · ${money(m.total)} (GRT ${money(m.tax)})</span></div>`).join('') : 'No sales yet today.';
    }
  } catch (e) { toast(e.message, true); }
}

async function boot() {
  S.server = (await loadP('server')) || DEFAULT_SERVER;
  S.token = (await loadP('token')) || null;
  S.eventId = (await loadP('event')) || null;
  S.flyerBy = (await loadP('flyerBy')) || '';
  // In a browser on the Hut site itself, a signed in admin session works without the PIN.
  if (!S.token && !NATIVE && location.origin === S.server) {
    try { const r = await fetch(S.server + '/api/pos/catalog'); if (r.ok) S.token = 'session'; } catch { /* PIN it is */ }
  }
  if (!S.token) return render();
  try { await loadCatalog(); } catch (e) { render(); toast(e.message, true); }
  if (NATIVE) setupTerminal().catch((e) => toast('Card reader setup: ' + e.message, true));
}
boot();
