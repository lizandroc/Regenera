// Regenera inquiry dashboard. Data comes from /api/admin/*, which only answers signed-in staff.
(() => {
  const $ = id => document.getElementById(id);
  const STATUS = { new: 'New', contacted: 'Contacted', conversation: 'In conversation', qualified: 'Qualified', archived: 'Archived' };
  const ENGAGE = {
    'I have a property': 'Property',
    'I am interested in investing': 'Investor',
    'I am an operator': 'Operator',
    'I represent an institution': 'Institution',
    'I am a specialist or collaborator': 'Specialist',
    'Other': 'Other',
  };
  const VIA = { email: 'by email', call: 'by phone call', meeting: 'in a meeting', other: '' };
  const state = { items: [], q: '', engage: 'all', status: 'open', resp: 'all', sort: 'newest', selected: new Set(), open: null };
  const who = e => (e || '').split('@')[0];

  const toast = msg => {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2400);
  };
  const short = v => ENGAGE[v] || v;
  const when = iso => {
    const d = new Date(iso), s = (Date.now() - d) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' d ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const full = iso => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const el = (tag, props = {}, kids = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k in e && k !== 'list') e[k] = v;
      else e.setAttribute(k, v);
    }
    kids.forEach(k => k && e.appendChild(k));
    return e;
  };

  async function api(path, opts = {}) {
    const res = await fetch('/api/admin/' + path, {
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 403 || res.status === 401) { location.reload(); throw new Error('signed out'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function load(quiet) {
    try {
      const data = await api('inquiries');
      state.items = data.items;
      $('who').textContent = data.user;
      $('sub').textContent = `Updated ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
      render();
    } catch (e) {
      if (!quiet) { $('sub').textContent = 'Could not load inquiries.'; toast(e.message); }
    }
  }

  const engageOrder = Object.keys(ENGAGE);
  const SORTS = {
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
    oldest: (a, b) => a.created_at.localeCompare(b.created_at),
    engage: (a, b) => (engageOrder.indexOf(a.engage) - engageOrder.indexOf(b.engage)) || SORTS.newest(a, b),
    waiting: (a, b) => (!!a.responded_at - !!b.responded_at) || SORTS.oldest(a, b),
    responder: (a, b) => ((a.responded_by || '~').localeCompare(b.responded_by || '~')) || SORTS.newest(a, b),
  };
  // Section headings when the list is grouped.
  const groupOf = it => state.sort === 'engage' ? it.engage
    : state.sort === 'responder' ? (it.responded_by ? 'Responded by ' + it.responded_by : 'Not responded yet')
    : state.sort === 'waiting' ? (it.responded_at ? 'Responded' : 'Not responded yet') : null;

  function shown() {
    const q = state.q.toLowerCase();
    return state.items.filter(it =>
      (state.engage === 'all' || it.engage === state.engage) &&
      (state.status === 'all' || (state.status === 'open' ? it.status !== 'archived' : it.status === state.status)) &&
      (state.resp === 'all' || (state.resp === 'done') === !!it.responded_at) &&
      (!q || [it.name, it.org, it.email, it.location, it.description, it.notes, it.responded_by].join(' ').toLowerCase().includes(q)))
      .sort(SORTS[state.sort]);
  }

  function statusSelect(value, label) {
    const s = el('select', { class: 'st', 'aria-label': label });
    for (const [v, t] of Object.entries(STATUS)) s.appendChild(el('option', { value: v, text: t, selected: v === value }));
    s.dataset.v = value;
    return s;
  }

  function render() {
    const items = state.items, weekAgo = Date.now() - 7 * 86400000;
    $('sTotal').textContent = items.length;
    $('sWait').textContent = items.filter(i => !i.responded_at && i.status !== 'archived').length;
    $('sWeek').textContent = items.filter(i => new Date(i.created_at) > weekAgo).length;
    $('sQual').textContent = items.filter(i => i.status === 'qualified').length;

    const chips = $('chips'); chips.textContent = '';
    [['all', 'All'], ...Object.keys(ENGAGE).map(k => [k, k])].forEach(([v, label]) => {
      const n = v === 'all' ? items.length : items.filter(i => i.engage === v).length;
      const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.engage === v), text: label });
      b.appendChild(el('em', { text: String(n) }));
      b.addEventListener('click', () => { state.engage = v; render(); });
      chips.appendChild(b);
    });

    const list = shown(), tbody = $('rows');
    tbody.textContent = '';
    if (!list.length) {
      const msg = items.length ? ['Nothing matches', 'Try another filter or search.'] : ['No inquiries yet', 'New submissions from the website form will appear here.'];
      tbody.appendChild(el('tr', {}, [el('td', { colSpan: 7, class: 'empty' }, [el('b', { text: msg[0] }), el('span', { text: msg[1] })])]));
    }
    let lastGroup = null;
    list.forEach(it => {
      const g = groupOf(it);
      if (g !== null && g !== lastGroup) {
        const n = list.filter(x => groupOf(x) === g).length;
        tbody.appendChild(el('tr', { class: 'group-row' }, [el('td', { colSpan: 7, text: `${g} · ${n}` })]));
        lastGroup = g;
      }
      const resp = el('input', { type: 'checkbox', checked: !!it.responded_at, 'aria-label': 'Responded to ' + it.name });
      resp.addEventListener('change', () => setResponded(it.id, resp.checked));
      const respCell = el('td', { class: 'resp-cell' }, [el('label', { class: 'resp' }, [resp, el('span', { text: it.responded_at ? 'Yes' : 'No' })])]);
      if (it.responded_at) respCell.appendChild(el('small', { text: `${who(it.responded_by)} · ${when(it.responded_at)}${it.responded_via ? ' · ' + VIA[it.responded_via] : ''}` }));
      const check = el('input', { type: 'checkbox', checked: state.selected.has(it.id), 'aria-label': 'Select ' + it.name });
      check.addEventListener('change', () => { check.checked ? state.selected.add(it.id) : state.selected.delete(it.id); syncBulk(); });
      const open = el('button', { type: 'button', text: it.name });
      open.addEventListener('click', () => openDetail(it.id));
      const st = statusSelect(it.status, 'Status for ' + it.name);
      st.addEventListener('change', () => setStatus(it.id, st.value));
      tbody.appendChild(el('tr', { class: it.status === 'new' ? 'is-new' : '' }, [
        el('td', { class: 'c-check' }, [check]),
        el('td', { title: full(it.created_at) }, [el('span', { text: when(it.created_at) }), el('small', { class: 'muted', text: full(it.created_at) })]),
        el('td', { class: 'who-cell' }, [open, el('small', { text: [it.org, it.email].filter(Boolean).join(' · ') }),
          it.email_sent ? null : el('small', { class: 'warn', text: 'Email alert not delivered' })]),
        el('td', {}, [el('span', { class: 'tag', text: short(it.engage) })]),
        el('td', { class: 'c-msg' }, [el('span', { class: 'msg', text: it.description || '—' })]),
        respCell,
        el('td', {}, [st]),
      ]));
    });
    $('all').checked = list.length > 0 && list.every(i => state.selected.has(i.id));
    syncBulk();
  }

  function syncBulk() {
    const ids = [...state.selected].filter(id => state.items.some(i => i.id === id));
    state.selected = new Set(ids);
    $('bulk').hidden = !ids.length;
    $('bulkN').textContent = ids.length + ' selected';
  }

  async function setStatus(id, status) {
    try {
      const { item } = await api('inquiries/' + id, { method: 'PATCH', body: { status } });
      Object.assign(state.items.find(i => i.id === id), item);
      render(); if (state.open === id) fillDetail(item);
      toast('Marked ' + STATUS[status].toLowerCase());
    } catch (e) { toast(e.message); render(); }
  }

  async function patch(id, body, msg) {
    try {
      const { item } = await api('inquiries/' + id, { method: 'PATCH', body });
      Object.assign(state.items.find(i => i.id === id), item);
      render(); if (state.open === id) fillDetail(item);
      if (msg) toast(msg);
    } catch (e) { toast(e.message); render(); }
  }
  const setResponded = (id, on) => patch(id, { responded: on }, on ? 'Marked as responded' : 'Marked as not responded');

  /* ---------- Detail panel ---------- */
  const dlg = $('detail');
  function fillDetail(it) {
    $('dWhen').textContent = 'Received ' + full(it.created_at);
    $('dName').textContent = it.name;
    $('dOrg').textContent = it.org || 'No organization given';
    $('dEngage').textContent = it.engage;
    const mail = $('dEmail'); mail.textContent = it.email; mail.href = 'mailto:' + it.email;
    $('dReply').href = `mailto:${it.email}?subject=${encodeURIComponent('Re: your Regenera inquiry')}`;
    $('dLoc').textContent = it.location || '—';
    const link = $('dLink'); link.textContent = '';
    if (/^https?:\/\//i.test(it.link)) link.appendChild(el('a', { href: it.link, target: '_blank', rel: 'noopener noreferrer nofollow', text: it.link }));
    else link.textContent = '—';
    $('dCountry').textContent = it.country || '—';
    $('dSent').textContent = it.email_sent ? 'Delivered to the inbox' : 'Not delivered. Saved here only.';
    $('dMsg').textContent = it.description || 'No message.';
    $('dNotes').value = it.notes || '';
    $('dResp').checked = !!it.responded_at;
    $('dVia').value = it.responded_via || '';
    $('dRespBy').textContent = it.responded_at ? `by ${it.responded_by}, ${full(it.responded_at)}` : 'Not responded yet';
    const sel = $('dStatus'); sel.textContent = '';
    for (const [v, t] of Object.entries(STATUS)) sel.appendChild(el('option', { value: v, text: t, selected: v === it.status }));
    sel.dataset.v = it.status;
  }
  function openDetail(id) {
    const it = state.items.find(i => i.id === id); if (!it) return;
    state.open = id; fillDetail(it); dlg.showModal();
  }
  $('dClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { state.open = null; });
  $('dStatus').addEventListener('change', e => setStatus(state.open, e.target.value));
  $('dResp').addEventListener('change', e => setResponded(state.open, e.target.checked));
  $('dVia').addEventListener('change', e => {
    const it = state.items.find(i => i.id === state.open);
    patch(state.open, it.responded_at ? { via: e.target.value } : { via: e.target.value, responded: true }, 'Saved');
  });
  $('dReply').addEventListener('click', () => {
    const it = state.items.find(i => i.id === state.open);
    if (it && it.status === 'new') setStatus(it.id, 'contacted');
  });
  $('dCopy').addEventListener('click', () => {
    const it = state.items.find(i => i.id === state.open);
    navigator.clipboard.writeText(it.email).then(() => toast('Email copied'), () => toast('Copy failed'));
  });
  $('dSave').addEventListener('click', async () => {
    try {
      const { item } = await api('inquiries/' + state.open, { method: 'PATCH', body: { notes: $('dNotes').value } });
      Object.assign(state.items.find(i => i.id === item.id), item); render(); toast('Notes saved');
    } catch (e) { toast(e.message); }
  });
  $('dDelete').addEventListener('click', async () => {
    const it = state.items.find(i => i.id === state.open);
    if (!confirm(`Delete the inquiry from ${it.name}? This cannot be undone.`)) return;
    await bulk('delete', [it.id]); dlg.close();
  });

  /* ---------- Bulk actions ---------- */
  async function bulk(action, ids, status) {
    try {
      await api('inquiries/bulk', { method: 'POST', body: { action, ids, status } });
      if (action === 'delete') { state.items = state.items.filter(i => !ids.includes(i.id)); toast(ids.length + ' deleted'); }
      else if (action === 'responded') { ids.forEach(id => state.selected.delete(id)); await load(true); toast(ids.length + ' marked as responded'); return; }
      else { state.items.forEach(i => { if (ids.includes(i.id)) i.status = status; }); toast(ids.length + ' updated'); }
      ids.forEach(id => state.selected.delete(id)); render();
    } catch (e) { toast(e.message); }
  }
  $('bulkApply').addEventListener('click', () => bulk('status', [...state.selected], $('bulkStatus').value));
  $('bulkResp').addEventListener('click', () => bulk('responded', [...state.selected]));
  $('bulkDelete').addEventListener('click', () => {
    const n = state.selected.size;
    if (confirm(`Delete ${n} inquir${n === 1 ? 'y' : 'ies'}? This cannot be undone.`)) bulk('delete', [...state.selected]);
  });
  $('bulkClear').addEventListener('click', () => { state.selected.clear(); render(); });
  $('all').addEventListener('change', e => { shown().forEach(i => e.target.checked ? state.selected.add(i.id) : state.selected.delete(i.id)); render(); });

  /* ---------- Filters and refresh ---------- */
  $('q').addEventListener('input', e => { state.q = e.target.value; render(); });
  $('fStatus').addEventListener('change', e => { state.status = e.target.value; render(); });
  $('fResp').addEventListener('change', e => { state.resp = e.target.value; render(); });
  $('sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
  $('refresh').addEventListener('click', () => load());
  setInterval(() => { if (!document.hidden && !dlg.open) load(true); }, 60000);
  load();
})();
