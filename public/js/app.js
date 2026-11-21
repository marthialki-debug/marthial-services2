'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ') + ' F CFA';
  const fdate = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const ST = { en_attente_paiement: ['En attente de paiement', 'wait'], paiement_confirme: ['Paiement confirmé', 'ok'], en_cours: ['En cours de traitement', 'go'], terminee: ['Terminée', 'ok'], annulee: ['Annulée', 'no'] };
  const PS = { non_paye: ['Non payé', 'wait'], en_verification: ['Paiement en cours de vérification', 'go'], confirme: ['Payé', 'ok'], refuse: ['Paiement refusé', 'no'] };
  const badge = (m, k) => `<span class="st ${m[k][1]}">${m[k][0]}</span>`;

  async function api(url, body, method) {
    const opt = { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(url, opt);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Une erreur est survenue.');
    return d;
  }
  function toast(msg, err) {
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = (err ? '⚠ ' : '✓ ') + msg;
    $('#toasts').append(t); setTimeout(() => t.remove(), 3700);
  }

  /* ---------- état ---------- */
  let C = { settings: {}, categories: [], items: [] };
  let cart = []; try { cart = JSON.parse(localStorage.getItem('ms_cart') || '[]'); } catch { cart = []; }
  const saveCart = () => { try { localStorage.setItem('ms_cart', JSON.stringify(cart)); } catch { /* ignore */ } };
  const variantInfo = (vid) => { for (const i of C.items) { const v = i.variants.find((x) => x.id === vid); if (v) return { item: i, v }; } return null; };
  const cartLines = () => cart.map((l) => ({ ...l, info: variantInfo(l.vid) })).filter((l) => l.info);
  const cartTotal = () => cartLines().reduce((s, l) => s + l.info.v.price * l.qty, 0);
  const waLink = (msg) => `https://wa.me/${C.settings.whatsapp || ''}?text=${encodeURIComponent(msg)}`;
  const state = { svcCat: 'all', shopCat: 'all', me: null };

  /* ---------- rendu des cartes ---------- */
  const minPrice = (i) => i.variants.reduce((m, v) => Math.min(m, v.price), Infinity);
  function thumb(i) {
    const cat = C.categories.find((c) => c.id === i.category_id);
    const inner = i.image ? `<img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy" decoding="async">` : (i.kind === 'service' ? `<span class="ini">${esc(i.name.slice(0, 2).toUpperCase())}</span>` : `<span>${esc((cat && cat.icon) || '🛍')}</span>`);
    return `<div class="thumb">${inner}${i.badge ? `<em class="tag">${esc(i.badge)}</em>` : ''}</div>`;
  }
  function availPill(i) {
    if (i.stock !== null && i.stock <= 0) return '<span class="pill no">Rupture de stock</span>';
    return `<span class="pill ok">${esc(i.availability || 'Disponible')}</span>`;
  }
  function card(i, idx) {
    const multi = i.variants.length > 1 || i.variants.some((v) => v.price_from);
    const v0 = i.variants.reduce((a, b) => (b.price < a.price ? b : a));
    const out = i.stock !== null && i.stock <= 0;
    return `<article class="card reveal" style="--dl:${Math.min(idx, 8) * 0.05}s" data-act="open" data-slug="${esc(i.slug)}" tabindex="0" role="button" aria-label="${esc(i.name)}">
      ${thumb(i)}<h3>${esc(i.name)}</h3><p>${esc(i.description)}</p>
      <div class="meta">${availPill(i)}${i.validity ? `<span class="pill">⏱ ${esc(i.validity)}</span>` : ''}${i.kind === 'product' && i.stock !== null && i.stock > 0 && i.stock <= 5 ? `<span class="pill">Plus que ${i.stock}</span>` : ''}</div>
      <div class="price"><span>${multi ? '<small>à partir de</small> ' : ''}<b>${money(v0.price)}</b>${v0.old_price ? `<s>${money(v0.old_price)}</s>` : ''}</span></div>
      <button class="btn btn-gold" data-act="${out ? 'open' : 'quick'}" data-slug="${esc(i.slug)}" ${out ? 'disabled' : ''}>${multi ? 'Voir les options' : 'Commander'}</button></article>`;
  }
  const chips = (cats, cur, key) => `<button class="chip ${cur === 'all' ? 'on' : ''}" data-act="cat" data-key="${key}" data-id="all">Tous</button>` +
    cats.map((c) => `<button class="chip ${String(cur) === String(c.id) ? 'on' : ''}" data-act="cat" data-key="${key}" data-id="${c.id}">${esc(c.icon)} ${esc(c.name)}</button>`).join('');

  function renderServices() {
    const items = C.items.filter((i) => i.kind === 'service');
    const cats = C.categories.filter((c) => c.kind === 'service' && items.some((i) => i.category_id === c.id));
    $('#svcTabs').innerHTML = chips(cats, state.svcCat, 'svcCat');
    const q = $('#svcSearch').value.trim().toLowerCase();
    const list = items.filter((i) => (state.svcCat === 'all' || String(i.category_id) === String(state.svcCat)) && (!q || (i.name + ' ' + i.description).toLowerCase().includes(q)));
    $('#svcGrid').innerHTML = list.length ? list.map(card).join('') : '<div class="empty">Aucun service ne correspond à votre recherche.</div>';
    observe();
  }
  function renderShop() {
    const items = C.items.filter((i) => i.kind === 'product');
    const cats = C.categories.filter((c) => c.kind === 'product');
    $('#shopTabs').innerHTML = chips(cats, state.shopCat, 'shopCat');
    const q = $('#shopSearch').value.trim().toLowerCase(), sort = $('#shopSort').value, stock = $('#shopStock').checked;
    let list = items.filter((i) => (state.shopCat === 'all' || String(i.category_id) === String(state.shopCat)) && (!q || (i.name + ' ' + i.description).toLowerCase().includes(q)) && (!stock || i.stock === null || i.stock > 0));
    if (sort === 'asc') list.sort((a, b) => minPrice(a) - minPrice(b));
    if (sort === 'desc') list.sort((a, b) => minPrice(b) - minPrice(a));
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    $('#shopGrid').innerHTML = list.length ? list.map(card).join('') : `<div class="empty">${items.length ? 'Aucun produit ne correspond à vos critères.' : '🛍 La boutique est en cours de préparation. Revenez très bientôt !'}</div>`;
    observe();
  }
  function renderStatic() {
    const s = C.settings;
    $('#heroTitle').textContent = s.hero_title; $('#heroText').textContent = s.hero_text;
    $('#aboutTitle').textContent = s.about_title; $('#aboutText').textContent = s.about_text; $('#shopText').textContent = s.shop_text;
    $('#footTag').textContent = s.tagline;
    const p = $('#promo'); p.hidden = !s.promo_text; p.textContent = s.promo_text || '';
    $('#advGrid').innerHTML = s.advantages.map(([ic, t, d], i) => `<div class="reveal" style="--dl:${i * 0.06}s"><div class="ic">${esc(ic)}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('');
    $('#faqList').innerHTML = s.faq.map(([q, a]) => `<details class="reveal"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
    $('#footContact').innerHTML = [s.phone && `<a href="tel:${esc(s.phone.replace(/\s/g, ''))}">📞 ${esc(s.phone)}</a>`, s.email && `<a href="mailto:${esc(s.email)}">✉ ${esc(s.email)}</a>`,
      s.snap && `<a>👻 Snap : ${esc(s.snap)}</a>`, s.address && `<a>📍 ${esc(s.address)}</a>`].filter(Boolean).join('');
    $('#wa').href = waLink("Bonjour MARTHIAL'S SERVICES, j'ai une question.");
    $('#year').textContent = new Date().getFullYear();
  }

  /* ---------- modales ---------- */
  function openModal(html) {
    const m = $('#modal'); $('#modalBox').innerHTML = `<button class="x" data-close aria-label="Fermer">✕</button>` + html; m.hidden = false; document.body.style.overflow = 'hidden';
    const f = $('#modalBox input,#modalBox select,#modalBox textarea'); if (f && !matchMedia('(pointer:coarse)').matches) f.focus();
  }
  function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; if (location.hash.startsWith('#service/') || location.hash.startsWith('#produit/')) history.replaceState(null, '', location.pathname + location.search); }

  function openItem(slug) {
    const i = C.items.find((x) => x.slug === slug); if (!i) return;
    const out = i.stock !== null && i.stock <= 0;
    const cat = C.categories.find((c) => c.id === i.category_id);
    history.replaceState(null, '', '#' + (i.kind === 'service' ? 'service' : 'produit') + '/' + i.slug);
    openModal(`<div class="dtl">${thumb(i)}<div><p class="eyebrow">${esc(cat ? cat.name : i.kind === 'service' ? 'Service' : 'Produit')}</p><h2>${esc(i.name)}</h2>
      <div class="meta">${availPill(i)}${i.validity ? `<span class="pill">⏱ Validité : ${esc(i.validity)}</span>` : ''}</div></div></div>
      <p class="muted" style="margin-top:14px;white-space:pre-line">${esc(i.description)}</p>
      <div class="opts" id="opts">${i.variants.map((v, k) => `<div class="opt ${k === 0 ? 'on' : ''}" data-act="pick" data-vid="${v.id}" role="radio" tabindex="0" aria-checked="${k === 0}"><span>${esc(v.label)}</span><span>${v.old_price ? `<s>${money(v.old_price)}</s>` : ''}${v.price_from ? '<small class="muted">dès </small>' : ''}<b>${money(v.price)}</b></span></div>`).join('')}</div>
      <div class="qrow"><div class="qty"><button data-act="mq" data-d="-1" aria-label="Moins">−</button><span id="mq">1</span><button data-act="mq" data-d="1" aria-label="Plus">+</button></div>
      <button class="btn btn-ghost" data-act="add-modal" data-slug="${esc(i.slug)}" ${out ? 'disabled' : ''}>🛒 Ajouter au panier</button>
      <button class="btn btn-gold" data-act="buy-modal" data-slug="${esc(i.slug)}" ${out ? 'disabled' : ''}>Commander</button></div>`);
  }
  const pickedVid = () => Number(($('#opts .opt.on') || {}).dataset?.vid);
  const modalQty = () => Number($('#mq')?.textContent) || 1;

  /* ---------- panier ---------- */
  function addToCart(vid, qty, silent) {
    const l = cart.find((x) => x.vid === vid); if (l) l.qty = Math.min(50, l.qty + qty); else cart.push({ vid, qty });
    saveCart(); renderCart(); const b = $('#btnCart'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    if (!silent) toast('Ajouté au panier');
  }
  function renderCart() {
    const lines = cartLines(); const n = lines.reduce((s, l) => s + l.qty, 0);
    const c = $('#cartCount'); c.hidden = !n; c.textContent = n;
    $('#drawerPanel').innerHTML = `<div class="dh"><h3>🛒 Mon panier</h3><button class="x" data-close aria-label="Fermer le panier">✕</button></div>
      <div class="dbody">${lines.length ? lines.map((l) => `<div class="line"><div><b>${esc(l.info.item.name)}</b><small>${esc(l.info.v.label)} · ${money(l.info.v.price)}</small></div><div class="lp">${money(l.info.v.price * l.qty)}</div>
        <div class="qty"><button data-act="cq" data-vid="${l.vid}" data-d="-1" aria-label="Moins">−</button><span>${l.qty}</span><button data-act="cq" data-vid="${l.vid}" data-d="1" aria-label="Plus">+</button></div>
        <button class="rm" data-act="rm" data-vid="${l.vid}">Supprimer</button></div>`).join('') : '<p class="muted" style="text-align:center;padding:50px 0">Votre panier est vide.<br>Découvrez nos services !</p>'}</div>
      <div class="dfoot"><div class="total"><span>Total</span><b>${money(cartTotal())}</b></div><button class="btn btn-gold block" data-act="checkout" ${lines.length ? '' : 'disabled'}>Passer la commande</button></div>`;
  }
  const openDrawer = () => { const d = $('#drawer'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; };
  const closeDrawer = () => { const d = $('#drawer'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; };

  /* ---------- commande ---------- */
  async function loadMe() { try { state.me = await api('/api/customer/me'); } catch { state.me = { customer: null }; } }
  async function checkout() {
    closeDrawer(); const lines = cartLines(); if (!lines.length) return toast('Votre panier est vide.', true);
    const pm = C.settings.payment_methods;
    await loadMe(); const cu = state.me.customer || {};
    const recap = `<div class="recap">${lines.map((l) => `<div><span>${l.qty} × ${esc(l.info.item.name)} <small class="muted">${esc(l.info.v.label)}</small></span><span>${money(l.info.v.price * l.qty)}</span></div>`).join('')}<div><span>Total</span><b class="gold">${money(cartTotal())}</b></div></div>`;
    if (!pm.length) return openModal(`<h2>Commande</h2>${recap}<div class="note">Le paiement en ligne est en cours de configuration. Pour commander dès maintenant, contactez-nous directement sur WhatsApp.</div>
      <a class="btn btn-gold block" target="_blank" rel="noopener" href="${esc(waLink("Bonjour, je souhaite commander :\n" + lines.map((l) => `- ${l.qty} × ${l.info.item.name} (${l.info.v.label})`).join('\n') + `\nTotal : ${money(cartTotal())}`))}">Commander via WhatsApp</a>`);
    openModal(`<h2>Finaliser ma commande</h2><p class="muted">Aucun compte n’est nécessaire.</p>
      <form class="form" id="coForm" novalidate><div class="row2"><label>Nom complet *<input name="name" required maxlength="80" autocomplete="name" value="${esc(cu.name || '')}"></label>
      <label>Téléphone *<input name="phone" type="tel" required inputmode="tel" autocomplete="tel" placeholder="+226 …" value="${esc(cu.phone || '')}"></label></div>
      <label>E-mail (facultatif)<input name="email" type="email" autocomplete="email" value="${esc(cu.email || '')}"></label>
      <label>Précisions (facultatif)<textarea name="note" rows="2" maxlength="500" placeholder="Ex. : pseudo TikTok, e-mail du compte…"></textarea></label>
      ${recap}<strong>Moyen de paiement</strong><div class="opts" id="pm">${pm.map((m, k) => `<div class="opt ${k === 0 ? 'on' : ''}" data-act="pm" data-id="${esc(m.id)}" role="radio" tabindex="0"><span>📱 ${esc(m.label)}</span></div>`).join('')}</div>
      <div class="err" id="coErr"></div><button class="btn btn-gold block" type="submit">Valider ma commande</button></form>`);
  }
  async function submitOrder(form) {
    const f = Object.fromEntries(new FormData(form)); const btn = $('button[type=submit]', form); const err = $('#coErr');
    btn.disabled = true; err.textContent = '';
    try {
      const sel = $('#pm .opt.on');
      const r = await api('/api/orders', { name: f.name, phone: f.phone, email: f.email, note: f.note, method: sel && sel.dataset.id, lines: cartLines().map((l) => ({ variant_id: l.vid, qty: l.qty })) });
      cart = []; saveCart(); renderCart();
      payStep({ ref: r.ref, phone: f.phone, total: r.total, method: r.method });
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  }
  function payStep(o) {
    const m = o.method;
    openModal(`<h2>Commande ${esc(o.ref)}</h2><p class="muted">Étape finale : effectuez le paiement.</p><div style="text-align:center"><span class="ref">${esc(o.ref)}</span></div>
      <div class="note"><b>${esc(m.label)}</b><br>Montant exact à envoyer : <b class="gold">${money(o.total)}</b>${m.number ? `<br>Numéro : <b>${esc(m.number)}</b>${m.holder ? ` (${esc(m.holder)})` : ''}` : '<br>Numéro : contactez-nous sur WhatsApp pour l’obtenir.'}<br><span class="muted">${esc(m.instructions)}</span></div>
      <form class="form" id="payForm" data-ref="${esc(o.ref)}" data-phone="${esc(o.phone)}" novalidate><label>Référence de la transaction (reçue par SMS) *<input name="pay_ref" required maxlength="60" autocomplete="off" placeholder="Ex. : MP240101.1234.A12345"></label>
      <div class="err" id="payErr"></div><button class="btn btn-gold block" type="submit">J’ai effectué le paiement</button>
      <button class="btn btn-ghost block" type="button" data-act="later" data-ref="${esc(o.ref)}" data-phone="${esc(o.phone)}" data-total="${o.total}">Je paierai plus tard</button></form>
      <p class="muted" style="font-size:13px;margin-top:12px">Votre commande ne sera validée qu’après vérification réelle du paiement par notre équipe.</p>`);
  }
  async function submitPayment(form) {
    const err = $('#payErr'); const btn = $('button[type=submit]', form); btn.disabled = true; err.textContent = '';
    try {
      await api(`/api/orders/${encodeURIComponent(form.dataset.ref)}/payment`, { phone: form.dataset.phone, pay_ref: new FormData(form).get('pay_ref') });
      doneStep(form.dataset.ref, form.dataset.phone, 'Paiement déclaré — en cours de vérification');
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  }
  function doneStep(ref, phone, title) {
    openModal(`<div class="ok-box"><div class="big">✅</div><h2 style="padding:0">${esc(title)}</h2><span class="ref">${esc(ref)}</span>
      <p class="muted">Conservez ce numéro de commande. Vous pouvez suivre l’état de votre commande et télécharger votre reçu dès que le paiement est confirmé.</p></div>
      <div class="qrow" style="justify-content:center"><a class="btn btn-gold" target="_blank" rel="noopener" href="${esc(waLink(`Bonjour, voici ma commande ${ref}.`))}">💬 Écrire sur WhatsApp</a>
      <button class="btn btn-ghost" data-act="track-open" data-ref="${esc(ref)}" data-phone="${esc(phone)}">Suivre ma commande</button></div>`);
  }

  /* ---------- suivi ---------- */
  function trackForm(ref = '', phone = '') {
    openModal(`<h2>Suivre ma commande</h2><p class="muted">Saisissez votre numéro de commande et le téléphone utilisé.</p>
      <form class="form" id="trForm" novalidate><label>Numéro de commande<input name="ref" required placeholder="MS-241120-ABCDE" value="${esc(ref)}" autocapitalize="characters"></label>
      <label>Téléphone<input name="phone" type="tel" required value="${esc(phone)}"></label><div class="err" id="trErr"></div><button class="btn btn-gold block" type="submit">Rechercher</button></form><div id="trOut"></div>`);
    if (ref && phone) submitTrack($('#trForm'));
  }
  const orderCard = (o, mine, phone) => `<div class="ordcard"><div class="top"><b>${esc(o.ref)}</b>${badge(ST, o.status)}</div>
    <div class="top"><span class="muted">${fdate(o.created_at)}</span>${badge(PS, o.pay_status)}</div>
    <div class="muted" style="font-size:14px">${o.items.map((i) => `${i.qty} × ${esc(i.name)}${i.label ? ' (' + esc(i.label) + ')' : ''}`).join('<br>')}</div>
    <div class="top"><b class="gold">${money(o.total)}</b>${o.receipt_available ? `<a class="btn btn-gold sm" target="_blank" rel="noopener" href="${mine ? '/receipt/my/' + encodeURIComponent(o.ref) : '/receipt/track/' + encodeURIComponent(o.ref) + '?phone=' + encodeURIComponent(phone || '')}">🧾 Reçu</a>` : ''}</div></div>`;
  async function submitTrack(form) {
    const f = Object.fromEntries(new FormData(form)); const err = $('#trErr'); err.textContent = '';
    try {
      const o = await api('/api/track', { ref: f.ref.trim(), phone: f.phone.trim() });
      const steps = [['Commande reçue', true], ['Paiement confirmé', o.pay_status === 'confirme'], ['En cours de traitement', ['en_cours', 'terminee'].includes(o.status)], ['Terminée', o.status === 'terminee']];
      $('#trOut').innerHTML = orderCard(o, false, f.phone) + (o.status === 'annulee' ? '' : `<ul class="tl">${steps.map(([t, on]) => `<li class="${on ? 'on' : ''}">${t}</li>`).join('')}</ul>`) +
        (['non_paye', 'refuse'].includes(o.pay_status) && o.status !== 'annulee' ? `<form class="form" id="tpForm" data-ref="${esc(o.ref)}" data-phone="${esc(f.phone)}"><label>Référence de la transaction (déjà payé ?)<input name="pay_ref" maxlength="60"></label><div class="err" id="tpErr"></div><button class="btn btn-vio block" type="submit">Envoyer ma référence de paiement</button></form>` : '') +
        `<div class="qrow"><a class="btn btn-ghost sm" target="_blank" rel="noopener" href="${esc(waLink(`Bonjour, ma commande ${o.ref}…`))}">💬 Contacter le support</a></div>`;
    } catch (e) { err.textContent = e.message; $('#trOut').innerHTML = ''; }
  }

  /* ---------- espace client ---------- */
  async function accountModal(tab = 'login') {
    await loadMe(); const cu = state.me.customer;
    if (cu) return openModal(`<h2>Bonjour ${esc(cu.name)}</h2><p class="muted">${esc(cu.phone)}</p><div class="qrow"><button class="btn btn-ghost sm" data-act="logout">Se déconnecter</button></div>
      <h3 style="margin-top:20px">Mes commandes</h3>${state.me.orders.length ? state.me.orders.map((o) => orderCard(o, true)).join('') : '<p class="muted">Aucune commande pour le moment.</p>'}`);
    openModal(`<h2>Espace client</h2><p class="muted">Facultatif : retrouvez vos commandes, statuts et reçus.</p>
      <div class="tabs"><button class="chip ${tab === 'login' ? 'on' : ''}" data-act="acc-tab" data-tab="login">Connexion</button><button class="chip ${tab === 'register' ? 'on' : ''}" data-act="acc-tab" data-tab="register">Créer un compte</button></div>
      <form class="form" id="${tab === 'login' ? 'loginForm' : 'regForm'}" novalidate>
      ${tab === 'login' ? `<label>Téléphone ou e-mail<input name="login" required autocomplete="username"></label>` :
        `<label>Nom complet<input name="name" required autocomplete="name"></label><label>Téléphone<input name="phone" type="tel" required autocomplete="tel"></label><label>E-mail (facultatif)<input name="email" type="email" autocomplete="email"></label>`}
      <label>Mot de passe${tab === 'register' ? ' (8 caractères min.)' : ''}<input name="password" type="password" required autocomplete="${tab === 'login' ? 'current-password' : 'new-password'}"></label>
      <div class="err" id="acErr"></div><button class="btn btn-gold block" type="submit">${tab === 'login' ? 'Se connecter' : 'Créer mon compte'}</button></form>
      <p class="muted" style="font-size:13px;margin-top:12px">Vous pouvez aussi commander sans compte et suivre votre commande avec son numéro.</p>`);
  }

  /* ---------- événements ---------- */
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { closeModal(); closeDrawer(); return; }
    const t = e.target.closest('[data-act]'); if (!t) return; const d = t.dataset;
    switch (d.act) {
      case 'open': openItem(d.slug); break;
      case 'quick': { e.stopPropagation(); const i = C.items.find((x) => x.slug === d.slug); if (i.variants.length > 1 || i.variants[0].price_from) openItem(d.slug); else { addToCart(i.variants[0].id, 1, true); openDrawer(); toast('Ajouté au panier'); } break; }
      case 'cat': state[d.key] = d.id; d.key === 'svcCat' ? renderServices() : renderShop(); break;
      case 'pick': $$('#opts .opt').forEach((o) => { o.classList.remove('on'); o.setAttribute('aria-checked', 'false'); }); t.classList.add('on'); t.setAttribute('aria-checked', 'true'); break;
      case 'mq': { const q = $('#mq'); q.textContent = Math.max(1, Math.min(50, Number(q.textContent) + Number(d.d))); break; }
      case 'add-modal': addToCart(pickedVid(), modalQty()); closeModal(); break;
      case 'buy-modal': addToCart(pickedVid(), modalQty(), true); closeModal(); checkout(); break;
      case 'cq': { const l = cart.find((x) => x.vid === Number(d.vid)); if (l) { l.qty += Number(d.d); if (l.qty < 1) cart = cart.filter((x) => x !== l); l && (l.qty = Math.min(l.qty, 50)); } saveCart(); renderCart(); break; }
      case 'rm': cart = cart.filter((x) => x.vid !== Number(d.vid)); saveCart(); renderCart(); break;
      case 'checkout': checkout(); break;
      case 'pm': $$('#pm .opt').forEach((o) => o.classList.remove('on')); t.classList.add('on'); break;
      case 'later': doneStep(d.ref, d.phone, 'Commande enregistrée — paiement en attente'); break;
      case 'track-open': trackForm(d.ref, d.phone); break;
      case 'acc-tab': accountModal(d.tab); break;
      case 'logout': await api('/api/customer/logout', {}); state.me = null; closeModal(); toast('Déconnexion réussie'); break;
    }
  });
  document.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.id === 'coForm') return submitOrder(f);
    if (f.id === 'payForm') return submitPayment(f);
    if (f.id === 'trForm') return submitTrack(f);
    if (f.id === 'tpForm') { try { await api(`/api/orders/${encodeURIComponent(f.dataset.ref)}/payment`, { phone: f.dataset.phone, pay_ref: new FormData(f).get('pay_ref') }); toast('Référence envoyée — vérification en cours'); trackForm(f.dataset.ref, f.dataset.phone); } catch (er) { $('#tpErr').textContent = er.message; } return; }
    if (f.id === 'loginForm' || f.id === 'regForm') {
      try { await api(f.id === 'loginForm' ? '/api/customer/login' : '/api/customer/register', Object.fromEntries(new FormData(f))); toast('Bienvenue !'); accountModal(); }
      catch (er) { $('#acErr').textContent = er.message; }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); closeDrawer(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card,.opt')) { e.preventDefault(); e.target.click(); }
  });
  $('#btnCart').onclick = () => { renderCart(); openDrawer(); };
  $('#btnTrack').onclick = $('#fTrack').onclick = (e) => { e.preventDefault(); trackForm(); };
  $('#btnAccount').onclick = $('#fAccount').onclick = (e) => { e.preventDefault(); accountModal(); };
  $('#burger').onclick = () => { const o = $('#nav').classList.toggle('open'); $('#burger').setAttribute('aria-expanded', o); };
  $('#nav').onclick = (e) => { if (e.target.tagName === 'A') { $('#nav').classList.remove('open'); $('#burger').setAttribute('aria-expanded', 'false'); } };
  ['svcSearch', 'shopSearch'].forEach((id) => $('#' + id).addEventListener('input', () => (id === 'svcSearch' ? renderServices() : renderShop())));
  $('#shopSort').onchange = $('#shopStock').onchange = renderShop;

  /* effets de survol (halo + légère inclinaison) */
  if (!REDUCED && matchMedia('(hover:hover)').matches) {
    document.addEventListener('pointermove', (e) => {
      const c = e.target.closest && e.target.closest('.card'); if (!c) return;
      const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      c.style.setProperty('--mx', x * 100 + '%'); c.style.setProperty('--my', y * 100 + '%');
      c.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 5}deg) rotateY(${(x - 0.5) * 6}deg) translateY(-4px)`;
    });
    document.addEventListener('pointerout', (e) => { const c = e.target.closest && e.target.closest('.card'); if (c && !c.contains(e.relatedTarget)) c.style.transform = ''; });
  }

  /* apparition au défilement */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.12, rootMargin: '0px 0px -30px' }) : null;
  function observe() { $$('.reveal:not(.in)').forEach((el) => (io ? io.observe(el) : el.classList.add('in'))); }

  /* particules lumineuses + logos flottants (légers, désactivés si mouvement réduit) */
  function fx() {
    if (REDUCED) return;
    const fl = $('#floaters'); const small = innerWidth < 700;
    for (let i = 0; i < (small ? 4 : 8); i++) {
      const im = document.createElement('img'); im.src = '/assets/logo-emblem.png'; im.alt = ''; im.width = im.height = 100; im.loading = 'lazy';
      const s = 50 + Math.random() * 90;
      im.style.cssText = `width:${s}px;height:${s}px;left:${Math.random() * 100}%;top:${Math.random() * 100}%;--d:${14 + Math.random() * 14}s;--dx:${(Math.random() - 0.5) * 120}px;--r0:${(Math.random() - 0.5) * 30}deg;--r1:${(Math.random() - 0.5) * 40}deg`;
      fl.append(im);
    }
    const cv = $('#fx'), ctx = cv.getContext('2d'); let W, H, run = true;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const size = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size(); addEventListener('resize', size);
    const P = Array.from({ length: small ? 18 : 42 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 0.6 + Math.random() * 1.8, v: 0.15 + Math.random() * 0.4, c: Math.random() < 0.55 ? '245,197,66' : '139,61,255', a: 0.2 + Math.random() * 0.6 }));
    const loop = () => {
      if (!run) return; ctx.clearRect(0, 0, W, H);
      for (const p of P) { p.y -= p.v; p.x += Math.sin(p.y / 60) * 0.2; if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; }
        ctx.beginPath(); ctx.fillStyle = `rgba(${p.c},${p.a})`; ctx.shadowBlur = 10; ctx.shadowColor = `rgba(${p.c},.9)`; ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); }
      requestAnimationFrame(loop);
    };
    document.addEventListener('visibilitychange', () => { run = !document.hidden; if (run) loop(); });
    loop();
  }

  /* ---------- démarrage ---------- */
  async function init() {
    const sp = $('#splash');
    if (REDUCED || sessionStorage.getItem('ms_splash')) sp.classList.add('done'); else setTimeout(() => { sp.classList.add('done'); try { sessionStorage.setItem('ms_splash', '1'); } catch { /* ignore */ } }, 1600);
    try { C = await api('/api/catalog'); } catch { toast('Chargement impossible. Réessayez.', true); }
    renderStatic(); renderServices(); renderShop(); renderCart(); observe(); fx();
    const m = location.hash.match(/^#(service|produit)\/(.+)$/); if (m) openItem(decodeURIComponent(m[2]));
    if (cart.length && !cartLines().length) { cart = []; saveCart(); }
  }
  init();
})();
