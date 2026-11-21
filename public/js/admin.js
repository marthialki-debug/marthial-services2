'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ') + ' F CFA';
  const fdate = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const ST = { en_attente_paiement: ['En attente de paiement', 'wait'], paiement_confirme: ['Paiement confirmé', 'ok'], en_cours: ['En cours de traitement', 'go'], terminee: ['Terminée', 'ok'], annulee: ['Annulée', 'no'] };
  const PS = { non_paye: ['Non payé', 'wait'], en_verification: ['À vérifier', 'go'], confirme: ['PAYÉ', 'ok'], refuse: ['Refusé', 'no'] };
  const badge = (m, k) => `<span class="st ${(m[k] || ['', ''])[1]}">${(m[k] || [k])[0]}</span>`;

  async function api(url, body, method) {
    const opt = { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(url, opt); const d = await r.json().catch(() => ({}));
    if (r.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('Session expirée'); }
    if (!r.ok) throw new Error(d.error || 'Erreur');
    return d;
  }
  const toast = (m, err) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = (err ? '⚠ ' : '✓ ') + m; $('#toasts').append(t); setTimeout(() => t.remove(), 3700); };
  const openModal = (h) => { $('#modalBox').innerHTML = `<button class="x" data-close aria-label="Fermer">✕</button>` + h; $('#modal').hidden = false; };
  const closeModal = () => { $('#modal').hidden = true; };

  let view = 'dashboard', admin = null, cat = null, settings = null;
  const filters = { q: '', status: '', pay_status: '', page: 1 };

  /* ---------- connexion ---------- */
  function showLogin() {
    admin = null;
    $('#app').innerHTML = `<div class="login"><div class="box"><img src="/assets/logo-emblem.png" alt="MARTHIAL'S SERVICES"><h2 style="font-size:22px">Espace administrateur</h2><p class="muted">Accès réservé</p>
      <form class="form" id="loginF"><label>Identifiant<input name="username" autocomplete="username" required></label><label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="err" id="lerr"></div><button class="btn btn-gold block" type="submit">Se connecter</button></form></div></div>`;
  }
  const NAV = [['dashboard', '📊', 'Tableau de bord'], ['orders', '📦', 'Commandes'], ['payments', '💳', 'Paiements'], ['catalog', '🛍', 'Prestations & produits'], ['site', '⚙', 'Gestion du site'], ['account', '🔐', 'Compte']];
  function shell() {
    $('#app').innerHTML = `<div class="shell"><aside class="side"><img src="/assets/logo-emblem.png" alt="">${NAV.map(([k, ic, l]) => `<button class="nv ${view === k ? 'on' : ''}" data-nav="${k}">${ic} ${l}</button>`).join('')}<div class="sp"></div>
      <a class="nv btn btn-ghost sm" href="/" target="_blank" rel="noopener">↗ Voir le site</a><button class="nv" data-act="logout">⎋ Déconnexion</button></aside><main class="main" id="main"></main></div>`;
    render();
  }
  async function render() {
    $$('.side .nv[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === view));
    const m = $('#main'); m.innerHTML = '<p class="muted">Chargement…</p>';
    try { await ({ dashboard, orders: () => orders(false), payments: () => orders(true), catalog, site, account }[view])(); } catch (e) { m.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  /* ---------- tableau de bord ---------- */
  async function dashboard() {
    const s = await api('/api/admin/stats');
    $('#main').innerHTML = `<h1>Tableau de bord</h1><div class="stats">
      <div class="stat"><small>Commandes (total)</small><b>${s.total_orders}</b></div><div class="stat w"><small>En attente de paiement</small><b>${s.pending}</b></div>
      <div class="stat w"><small>Paiements à vérifier</small><b>${s.to_verify}</b></div><div class="stat ok"><small>Commandes payées</small><b>${s.paid}</b></div>
      <div class="stat ok"><small>Terminées</small><b>${s.done}</b></div><div class="stat g"><small>Chiffre d’affaires (payé)</small><b>${money(s.revenue)}</b></div>
      <div class="stat"><small>Clients</small><b>${s.customers}</b></div></div>
      <h2 class="sec-t">Dernières commandes</h2>${table(s.latest)}`;
  }
  const table = (rows) => rows.length ? `<div class="tw"><table class="t"><thead><tr><th>Référence</th><th>Client</th><th>Montant</th><th>Paiement</th><th>Statut</th><th>Date</th></tr></thead><tbody>
    ${rows.map((o) => `<tr class="row" data-order="${o.id}"><td><b>${esc(o.ref)}</b></td><td>${esc(o.name)}</td><td>${money(o.total)}</td><td>${badge(PS, o.pay_status)}</td><td>${badge(ST, o.status)}</td><td>${fdate(o.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucune commande.</p>';

  /* ---------- commandes / paiements ---------- */
  async function orders(payMode) {
    const qs = new URLSearchParams({ q: filters.q, status: payMode ? '' : filters.status, pay_status: filters.pay_status, page: filters.page });
    const [d, s] = await Promise.all([api('/api/admin/orders?' + qs), payMode ? api('/api/admin/stats') : null]);
    const PAYTABS = [['', 'Toutes'], ['non_paye', 'Non payées'], ['en_verification', 'À vérifier'], ['confirme', 'Payées'], ['refuse', 'Refusées']];
    $('#main').innerHTML = `<h1>${payMode ? 'Gestion des paiements' : 'Gestion des commandes'}</h1>
      ${payMode ? `<div class="stats"><div class="stat w"><small>Non payées</small><b>${s.unpaid}</b></div><div class="stat w"><small>À vérifier</small><b>${s.to_verify}</b></div><div class="stat ok"><small>Payées</small><b>${s.paid}</b></div><div class="stat"><small>Refusées</small><b>${s.refused}</b></div></div>
      <div class="chips" style="margin-bottom:14px">${PAYTABS.map(([k, l]) => `<button class="chip ${filters.pay_status === k ? 'on' : ''}" data-ps="${k}">${l}</button>`).join('')}</div>` : ''}
      <div class="bar"><input id="fq" type="search" placeholder="Réf., nom, téléphone, réf. paiement…" value="${esc(filters.q)}">
      ${payMode ? '' : `<select id="fs"><option value="">Tous les statuts</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${filters.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
      <select id="fp"><option value="">Tous les paiements</option>${Object.entries(PS).map(([k, v]) => `<option value="${k}" ${filters.pay_status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>`}
      <span class="muted">${d.total} résultat(s)</span></div>${table(d.orders)}
      <div class="pg"><button class="btn btn-ghost mini" data-pg="-1" ${d.page <= 1 ? 'disabled' : ''}>←</button> Page ${d.page} / ${Math.max(1, Math.ceil(d.total / d.size))} <button class="btn btn-ghost mini" data-pg="1" ${d.page * d.size >= d.total ? 'disabled' : ''}>→</button></div>`;
  }
  async function openOrder(id) {
    const o = await api('/api/admin/orders/' + id); const paid = o.pay_status === 'confirme';
    openModal(`<h2>Commande ${esc(o.ref)}</h2><div class="meta">${badge(ST, o.status)} ${badge(PS, o.pay_status)}</div>
      <div class="kv"><div><small>Client</small><b>${esc(o.name)}</b></div><div><small>Téléphone</small><b>${esc(o.phone)}</b> <a href="https://wa.me/${esc(o.phone.replace(/\D/g, ''))}" target="_blank" rel="noopener">💬</a></div>
      <div><small>E-mail</small>${esc(o.email || '—')}</div><div><small>Date de commande</small>${fdate(o.created_at)}</div>
      <div><small>Moyen de paiement choisi</small>${esc(o.pay_method || '—')}</div><div><small>Référence de transaction (client)</small><b>${esc(o.pay_ref || '—')}</b></div>
      ${paid ? `<div><small>Payé le</small>${fdate(o.paid_at)}</div><div><small>N° de reçu</small><b>${esc(o.receipt_no)}</b></div>` : ''}${o.note ? `<div style="grid-column:1/-1"><small>Précisions du client</small>${esc(o.note)}</div>` : ''}</div>
      <div class="tw"><table class="t" style="min-width:0"><thead><tr><th>Article</th><th>Qté</th><th>PU</th><th>Total</th></tr></thead><tbody>${o.items.map((i) => `<tr><td>${esc(i.name)} <small class="muted">${esc(i.label)}</small></td><td>${i.qty}</td><td>${money(i.unit_price)}</td><td>${money(i.unit_price * i.qty)}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Total</b></td><td><b class="gold">${money(o.total)}</b></td></tr></tbody></table></div>
      <h3 class="sec-t">Paiement</h3>
      ${paid ? '<p class="note">✅ Paiement confirmé. Le reçu peut être imprimé.</p>' : `<div class="note">Vérifiez dans votre application Mobile Money que le montant <b>${money(o.total)}</b> est bien reçu avant de confirmer.</div>
      <div class="row2"><label>Moyen de paiement<input id="pMethod" value="${esc(o.pay_method)}"></label><label>Référence de transaction<input id="pRef" value="${esc(o.pay_ref)}"></label></div>
      <div class="qrow"><button class="btn btn-gold" data-pay="confirm" data-id="${o.id}">✔ Confirmer le paiement</button><button class="btn btn-ghost danger" data-pay="reject" data-id="${o.id}">✖ Refuser</button>
      ${o.pay_status === 'refuse' || o.pay_status === 'en_verification' ? `<button class="btn btn-ghost" data-pay="reset" data-id="${o.id}">↺ Remettre « non payé »</button>` : ''}</div>`}
      <div class="qrow"><button class="btn btn-vio" ${paid ? '' : 'disabled title="Disponible uniquement après confirmation du paiement"'} data-print="${o.id}">🖨 IMPRIMER LE REÇU</button>${paid ? '' : '<span class="muted" style="font-size:13px">Reçu disponible après confirmation du paiement.</span>'}</div>
      <h3 class="sec-t">Statut de la commande</h3><div class="qrow"><select id="stSel" style="width:auto">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select><button class="btn btn-ghost" data-setst="${o.id}">Enregistrer le statut</button></div>
      <h3 class="sec-t">Historique</h3><ul class="tl">${o.log.map((l) => `<li class="on">${fdate(l.at)} — ${esc(l.text)}</li>`).join('')}</ul>`);
  }

  /* ---------- catalogue ---------- */
  let catTab = 'service';
  async function catalog() {
    cat = await api('/api/admin/catalog');
    const items = cat.items.filter((i) => i.kind === catTab); const cats = cat.categories.filter((c) => c.kind === catTab);
    $('#main').innerHTML = `<h1>Prestations & produits</h1><div class="chips" style="margin-bottom:16px">
      <button class="chip ${catTab === 'service' ? 'on' : ''}" data-ctab="service">Prestations</button><button class="chip ${catTab === 'product' ? 'on' : ''}" data-ctab="product">Produits (MARTHIAL SHOP)</button></div>
      <div class="bar"><button class="btn btn-gold sm" data-item="new">＋ Ajouter ${catTab === 'service' ? 'une prestation' : 'un produit'}</button><button class="btn btn-ghost sm" data-cat="new">＋ Nouvelle catégorie</button></div>
      <h2 class="sec-t">Catégories</h2><div class="bar">${cats.map((c) => `<span class="pill">${esc(c.icon)} ${esc(c.name)} <a href="#" data-cat="${c.id}">✎</a> <a href="#" data-catdel="${c.id}">✕</a></span>`).join('') || '<span class="muted">Aucune catégorie</span>'}</div>
      <h2 class="sec-t">${catTab === 'service' ? 'Prestations' : 'Produits'} (${items.length})</h2>
      ${items.length ? `<div class="tw"><table class="t"><thead><tr><th>Nom</th><th>Catégorie</th><th>Options / prix</th><th>Stock</th><th>État</th><th></th></tr></thead><tbody>${items.map((i) => `<tr><td><b>${esc(i.name)}</b></td>
      <td>${esc((cat.categories.find((c) => c.id === i.category_id) || {}).name || '—')}</td><td>${i.variants.filter((v) => v.active).map((v) => `${esc(v.label)} : ${money(v.price)}`).join('<br>')}</td>
      <td>${i.stock === null ? '∞' : i.stock}</td><td>${i.active ? '<span class="st ok">Actif</span>' : '<span class="st no">Désactivé</span>'}</td>
      <td><div class="row-actions"><button class="btn btn-ghost mini" data-item="${i.id}">Modifier</button><button class="btn btn-ghost mini" data-toggle="${i.id}">${i.active ? 'Désactiver' : 'Activer'}</button><button class="btn btn-ghost mini danger" data-itemdel="${i.id}">Supprimer</button></div></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucun élément pour le moment.</p>'}`;
  }
  const vrow = (v = {}) => `<div class="vr"><input data-f="label" placeholder="Libellé (ex. 1 mois)" value="${esc(v.label || '')}"><input data-f="price" type="number" min="0" placeholder="Prix F CFA" value="${v.price ?? ''}">
    <input data-f="old_price" type="number" min="0" placeholder="Ancien prix" value="${v.old_price ?? ''}"><label><input data-f="price_from" type="checkbox" ${v.price_from ? 'checked' : ''}>à partir de</label><button class="btn btn-ghost mini danger" type="button" data-vdel>✕</button><input type="hidden" data-f="id" value="${v.id || ''}"></div>`;
  function itemEditor(id) {
    const i = id === 'new' ? { kind: catTab, active: 1, availability: 'Disponible', variants: [{}], stock: null, sort: 0 } : cat.items.find((x) => x.id === Number(id));
    const cats = cat.categories.filter((c) => c.kind === i.kind);
    openModal(`<h2>${id === 'new' ? 'Ajouter' : 'Modifier'} ${i.kind === 'service' ? 'une prestation' : 'un produit'}</h2>
      <form class="form" id="itemF" data-id="${id}" data-kind="${i.kind}"><div class="row2"><label>Nom *<input name="name" required value="${esc(i.name || '')}"></label>
      <label>Catégorie<select name="category_id"><option value="">—</option>${cats.map((c) => `<option value="${c.id}" ${c.id === i.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
      <label>Description<textarea name="description" rows="3">${esc(i.description || '')}</textarea></label>
      <label>Image (URL ou envoi)<input name="image" value="${esc(i.image || '')}" placeholder="https://… ou /uploads/…"></label><div class="qrow" style="margin:0"><input type="file" id="imgFile" accept="image/png,image/jpeg,image/webp" style="max-width:300px"><span class="muted" style="font-size:13px">PNG/JPEG/WebP, 3 Mo max</span></div>
      <div class="row2"><label>Disponibilité<input name="availability" value="${esc(i.availability || '')}"></label><label>Durée de validité<input name="validity" value="${esc(i.validity || '')}" placeholder="Ex. 1 mois"></label></div>
      <div class="row2"><label>Badge / promotion<input name="badge" value="${esc(i.badge || '')}" placeholder="Ex. -10 %"></label><label>Stock (vide = illimité)<input name="stock" type="number" min="0" value="${i.stock ?? ''}"></label></div>
      <div class="row2"><label>Ordre d’affichage<input name="sort" type="number" value="${i.sort || 0}"></label><label class="check" style="padding-top:26px"><input name="active" type="checkbox" ${i.active ? 'checked' : ''}> Actif (visible sur le site)</label></div>
      <h3 class="sec-t" style="margin:6px 0 0">Options et prix</h3><div id="vrows">${i.variants.filter((v) => v.active !== 0).map(vrow).join('')}</div>
      <button class="btn btn-ghost mini" type="button" id="addV">＋ Ajouter une option</button><div class="err" id="ierr"></div><button class="btn btn-gold block" type="submit">Enregistrer</button></form>`);
  }
  async function saveItem(f) {
    const fd = new FormData(f); const body = Object.fromEntries(fd); body.kind = f.dataset.kind; body.active = fd.has('active');
    body.variants = $$('.vr', f).map((r) => { const g = (k) => $(`[data-f=${k}]`, r); return { id: g('id').value || undefined, label: g('label').value, price: g('price').value, old_price: g('old_price').value, price_from: g('price_from').checked }; }).filter((v) => v.label);
    try { await api(f.dataset.id === 'new' ? '/api/admin/items' : '/api/admin/items/' + f.dataset.id, body, f.dataset.id === 'new' ? 'POST' : 'PUT'); closeModal(); toast('Enregistré'); render(); }
    catch (e) { $('#ierr').textContent = e.message; }
  }

  /* ---------- gestion du site ---------- */
  async function site() {
    settings = await api('/api/admin/settings'); const s = settings;
    const pm = JSON.parse(s.payment_methods), adv = JSON.parse(s.advantages), faq = JSON.parse(s.faq);
    $('#main').innerHTML = `<h1>Gestion du site</h1><form class="form" id="siteF">
      <h3 class="sec-t" style="margin:0">Textes</h3>
      <label>Titre d’accueil<input name="hero_title" value="${esc(s.hero_title)}"></label><label>Texte d’accueil<textarea name="hero_text" rows="3">${esc(s.hero_text)}</textarea></label>
      <label>Titre « À propos »<input name="about_title" value="${esc(s.about_title)}"></label><label>Texte « À propos »<textarea name="about_text" rows="3">${esc(s.about_text)}</textarea></label>
      <label>Texte MARTHIAL SHOP<textarea name="shop_text" rows="2">${esc(s.shop_text)}</textarea></label><label>Slogan<input name="tagline" value="${esc(s.tagline)}"></label>
      <h3 class="sec-t">Promotion (bandeau en haut du site)</h3><label class="check"><input type="checkbox" name="promo_active" ${s.promo_active === '1' ? 'checked' : ''}> Afficher le bandeau</label><label>Texte du bandeau<input name="promo_text" value="${esc(s.promo_text)}" placeholder="Ex. -10 % sur Netflix ce week-end"></label>
      <h3 class="sec-t">Contact</h3><div class="row2"><label>WhatsApp (format international, chiffres)<input name="whatsapp" value="${esc(s.whatsapp)}" placeholder="22601234567"></label><label>Téléphone affiché<input name="phone" value="${esc(s.phone)}"></label></div>
      <div class="row2"><label>E-mail<input name="email" value="${esc(s.email)}"></label><label>Snapchat<input name="snap" value="${esc(s.snap)}"></label></div><label>Adresse / zone<input name="address" value="${esc(s.address)}"></label>
      <h3 class="sec-t">Moyens de paiement (Mobile Money)</h3><p class="muted" style="font-size:13px">Un moyen n’apparaît sur le site que s’il est coché « actif ». Renseignez le numéro qui reçoit les paiements.</p>
      <div id="pms">${pm.map(pmRow).join('')}</div><button class="btn btn-ghost mini" type="button" id="addPm">＋ Ajouter un moyen de paiement</button>
      <h3 class="sec-t">Avantages (une ligne = icône | titre | texte)</h3><textarea id="advT" rows="6">${esc(adv.map((r) => r.join(' | ')).join('\n'))}</textarea>
      <h3 class="sec-t">FAQ (une ligne = question | réponse)</h3><textarea id="faqT" rows="6">${esc(faq.map((r) => r.join(' | ')).join('\n'))}</textarea>
      <button class="btn btn-gold" type="submit" style="justify-self:start">Enregistrer les modifications</button></form>`;
  }
  const pmRow = (m = {}) => `<div class="ordcard pmr"><div class="row2"><label>Nom<input data-p="label" value="${esc(m.label || '')}"></label><label>Numéro de réception<input data-p="number" value="${esc(m.number || '')}"></label></div>
    <div class="row2"><label>Titulaire<input data-p="holder" value="${esc(m.holder || '')}"></label><label>Instructions client<input data-p="instructions" value="${esc(m.instructions || '')}"></label></div>
    <div class="top"><label class="check"><input type="checkbox" data-p="active" ${m.active ? 'checked' : ''}> Actif</label><button type="button" class="btn btn-ghost mini danger" data-pmdel>Retirer</button></div></div>`;
  async function saveSite(f) {
    const b = Object.fromEntries(new FormData(f)); b.promo_active = f.promo_active.checked ? '1' : '0';
    b.payment_methods = $$('.pmr', f).map((r) => ({ label: $('[data-p=label]', r).value, number: $('[data-p=number]', r).value, holder: $('[data-p=holder]', r).value, instructions: $('[data-p=instructions]', r).value, active: $('[data-p=active]', r).checked })).filter((m) => m.label);
    const lines = (id) => $('#' + id).value.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((r) => r.length >= 2 && r[0]);
    b.advantages = lines('advT').filter((r) => r.length >= 3); b.faq = lines('faqT').map((r) => [r[0], r.slice(1).join(' | ')]);
    try { await api('/api/admin/settings', b, 'PUT'); toast('Site mis à jour'); } catch (e) { toast(e.message, true); }
  }

  /* ---------- compte ---------- */
  async function account() {
    $('#main').innerHTML = `<h1>Compte administrateur</h1><p class="muted">Connecté en tant que <b>${esc(admin.username)}</b></p>
      <form class="form" id="pwF" style="max-width:420px"><label>Mot de passe actuel<input type="password" name="current" autocomplete="current-password" required></label>
      <label>Nouveau mot de passe (10 caractères min.)<input type="password" name="next" autocomplete="new-password" minlength="10" required></label><div class="err" id="perr"></div><button class="btn btn-gold" type="submit">Changer le mot de passe</button></form>`;
  }

  /* ---------- événements ---------- */
  const reloadOrders = () => { filters.page = 1; render(); };
  document.addEventListener('click', async (e) => {
    const t = e.target; const g = (a) => t.closest(`[${a}]`);
    if (g('data-close')) return closeModal();
    let el;
    try {
      if ((el = g('data-nav'))) { view = el.dataset.nav; filters.page = 1; if (view === 'payments' && !filters.pay_status) filters.pay_status = 'en_verification'; if (view === 'orders') filters.pay_status = ''; return render(); }
      if ((el = g('data-act')) && el.dataset.act === 'logout') { await api('/api/admin/logout', {}); return showLogin(); }
      if ((el = g('data-order'))) return openOrder(el.dataset.order);
      if ((el = g('data-ps'))) { filters.pay_status = el.dataset.ps; filters.page = 1; return render(); }
      if ((el = g('data-pg'))) { filters.page += Number(el.dataset.pg); return render(); }
      if ((el = g('data-pay'))) {
        const id = el.dataset.id, a = el.dataset.pay;
        if (a === 'confirm' && !confirm('Confirmer que ce paiement a réellement été reçu ?')) return;
        await api(`/api/admin/orders/${id}/payment`, { action: a, method: $('#pMethod')?.value, pay_ref: $('#pRef')?.value }); toast('Paiement mis à jour'); await openOrder(id); return render();
      }
      if ((el = g('data-setst'))) { await api(`/api/admin/orders/${el.dataset.setst}/status`, { status: $('#stSel').value }); toast('Statut mis à jour'); await openOrder(el.dataset.setst); return render(); }
      if ((el = g('data-print'))) { window.open(`/receipt/admin/${el.dataset.print}?auto=1`, '_blank', 'noopener'); return; }
      if ((el = g('data-ctab'))) { catTab = el.dataset.ctab; return render(); }
      if ((el = g('data-item'))) return itemEditor(el.dataset.item);
      if ((el = g('data-toggle'))) { const i = cat.items.find((x) => x.id === Number(el.dataset.toggle)); await api('/api/admin/items/' + i.id, { ...i, active: !i.active, variants: i.variants.filter((v) => v.active) }, 'PUT'); toast('Mis à jour'); return render(); }
      if ((el = g('data-itemdel'))) { if (!confirm('Supprimer définitivement cet élément ? (Les commandes passées sont conservées.) Vous pouvez aussi le désactiver.')) return; await api('/api/admin/items/' + el.dataset.itemdel, null, 'DELETE'); toast('Supprimé'); return render(); }
      if ((el = g('data-catdel'))) { e.preventDefault(); if (!confirm('Supprimer cette catégorie ? Les éléments resteront sans catégorie.')) return; await api('/api/admin/categories/' + el.dataset.catdel, null, 'DELETE'); return render(); }
      if ((el = g('data-cat'))) {
        e.preventDefault(); const c = cat.categories.find((x) => x.id === Number(el.dataset.cat));
        const name = prompt('Nom de la catégorie', c ? c.name : ''); if (!name) return; const icon = prompt('Icône (emoji, facultatif)', c ? c.icon : '') || '';
        if (c) await api('/api/admin/categories/' + c.id, { name, icon, sort: c.sort }, 'PUT'); else await api('/api/admin/categories', { name, icon, kind: catTab });
        return render();
      }
      if (t.id === 'addV') { $('#vrows').insertAdjacentHTML('beforeend', vrow()); return; }
      if (g('data-vdel')) { t.closest('.vr').remove(); return; }
      if (t.id === 'addPm') { $('#pms').insertAdjacentHTML('beforeend', pmRow()); return; }
      if (g('data-pmdel')) { t.closest('.pmr').remove(); return; }
    } catch (er) { toast(er.message, true); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'fs') { filters.status = e.target.value; reloadOrders(); }
    if (e.target.id === 'fp') { filters.pay_status = e.target.value; reloadOrders(); }
    if (e.target.id === 'imgFile') {
      const file = e.target.files[0]; if (!file) return; if (file.size > 3e6) return toast('Image trop lourde (3 Mo max)', true);
      const r = new FileReader(); r.onload = async () => { try { const d = await api('/api/admin/upload', { data: r.result }); $('#itemF [name=image]').value = d.url; toast('Image envoyée'); } catch (er) { toast(er.message, true); } }; r.readAsDataURL(file);
    }
  });
  let tm; document.addEventListener('input', (e) => { if (e.target.id === 'fq') { clearTimeout(tm); tm = setTimeout(() => { filters.q = e.target.value; filters.page = 1; render().then(() => { const i = $('#fq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); } });
  document.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.id === 'loginF') { try { const d = await api('/api/admin/login', Object.fromEntries(new FormData(f))); admin = { username: d.username }; shell(); } catch (er) { $('#lerr').textContent = er.message; } }
    if (f.id === 'itemF') saveItem(f);
    if (f.id === 'siteF') saveSite(f);
    if (f.id === 'pwF') { try { await api('/api/admin/password', Object.fromEntries(new FormData(f))); toast('Mot de passe modifié'); f.reset(); } catch (er) { $('#perr').textContent = er.message; } }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  (async () => { try { const d = await api('/api/admin/me'); if (d.admin) { admin = d.admin; shell(); } else showLogin(); } catch { showLogin(); } })();
})();
