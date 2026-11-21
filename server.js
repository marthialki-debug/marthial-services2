'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, tx, hashPassword, verifyPassword, slugify, getSettings, setSetting, DATA_DIR } = require('./lib/db');
const { receiptHTML } = require('./lib/receipt');

const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const WEBHOOK_SECRET = process.env.PAY_WEBHOOK_SECRET || '';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

const STATUSES = ['en_attente_paiement', 'paiement_confirme', 'en_cours', 'terminee', 'annulee'];
const PAY_STATUSES = ['non_paye', 'en_verification', 'confirme', 'refuse'];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

/* ---------- utilitaires ---------- */
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (m) => new HttpError(400, m);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clientIp = (req) => (TRUST_PROXY && req.headers['x-forwarded-for']) ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const int = (v, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : d; };
const normPhone = (p) => String(p || '').replace(/[^\d+]/g, '');
const phoneKey = (p) => normPhone(p).replace(/^\+?226/, '').replace(/^\+/, '');
const validPhone = (p) => phoneKey(p).length >= 8 && phoneKey(p).length <= 15;
const validEmail = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

const hits = new Map();
const limit = (req, key, max, windowMs) => {
  const k = key + ':' + clientIp(req), now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Trop de tentatives. Réessayez plus tard.');
  arr.push(now); hits.set(k, arr);
};
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

const send = (res, code, body, headers = {}) => {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
};
const readBody = (req, max = 1e6) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, 'Requête trop volumineuse')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const readJson = async (req, max) => {
  const raw = await readBody(req, max);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch { throw bad('JSON invalide'); }
};

/* ---------- sessions ---------- */
const COOKIE = { admin: 'ms_admin', customer: 'ms_client' };
const parseCookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
const cookieStr = (name, val, maxAge) => `${name}=${val}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` + (PROD ? '; Secure' : '');
const startSession = (res, role, userId) => {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = role === 'admin' ? 8 * 3600 : 30 * 86400;
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash,role,user_id,expires) VALUES(?,?,?,?)').run(sha(token), role, userId, Date.now() + ttl * 1000);
  return cookieStr(COOKIE[role], token, ttl);
};
const getSession = (req, role) => {
  const t = parseCookies(req)[COOKIE[role]];
  if (!t) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash=? AND role=? AND expires>?').get(sha(t), role, Date.now());
  return s || null;
};
const endSession = (req, role) => {
  const t = parseCookies(req)[COOKIE[role]];
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(t));
  return cookieStr(COOKIE[role], '', 0);
};
const requireAdmin = (req) => {
  const s = getSession(req, 'admin');
  if (!s) throw new HttpError(401, 'Authentification requise');
  return db.prepare('SELECT id,username FROM admins WHERE id=?').get(s.user_id);
};
const csrfCheck = (req) => {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Requête refusée');
  const o = req.headers.origin;
  if (o && req.headers.host && new URL(o).host !== req.headers.host) throw new HttpError(403, 'Origine refusée');
};

/* ---------- catalogue ---------- */
const publicSettings = () => {
  const s = getSettings();
  const methods = JSON.parse(s.payment_methods || '[]').filter((m) => m.active).map(({ id, label, number, holder, instructions }) => ({ id, label, number, holder, instructions }));
  return { site_name: s.site_name, tagline: s.tagline, hero_title: s.hero_title, hero_text: s.hero_text, about_title: s.about_title, about_text: s.about_text,
    shop_text: s.shop_text, whatsapp: s.whatsapp, phone: s.phone, email: s.email, address: s.address, snap: s.snap, currency: s.currency,
    promo_text: s.promo_active === '1' ? s.promo_text : '', advantages: JSON.parse(s.advantages || '[]'), faq: JSON.parse(s.faq || '[]'), payment_methods: methods };
};
const loadCatalog = (all) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort,id').all();
  const items = db.prepare(`SELECT * FROM items ${all ? '' : 'WHERE active=1'} ORDER BY sort,id`).all();
  const vs = db.prepare(`SELECT * FROM variants ${all ? '' : 'WHERE active=1'} ORDER BY sort,id`).all();
  const by = {}; vs.forEach((v) => (by[v.item_id] ||= []).push(v));
  items.forEach((i) => { i.variants = by[i.id] || []; });
  return { categories: cats, items: all ? items : items.filter((i) => i.variants.length) };
};

/* ---------- commandes ---------- */
const newRef = () => {
  const d = new Date(); const ymd = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let r = ''; for (const b of crypto.randomBytes(5)) r += A[b % A.length];
    const ref = `MS-${ymd}-${r}`;
    if (!db.prepare('SELECT 1 FROM orders WHERE ref=?').get(ref)) return ref;
  }
};
const log = (orderId, text) => db.prepare('INSERT INTO order_log(order_id,text) VALUES(?,?)').run(orderId, text);
const orderFull = (o) => o && { ...o, items: db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id), log: db.prepare('SELECT at,text FROM order_log WHERE order_id=? ORDER BY id').all(o.id) };
const orderPublic = (o) => { const f = orderFull(o); return f && { ref: f.ref, name: f.name, total: f.total, status: f.status, pay_status: f.pay_status, pay_method: f.pay_method,
  created_at: f.created_at, paid_at: f.paid_at, receipt_available: f.pay_status === 'confirme', items: f.items.map(({ name, label, unit_price, qty }) => ({ name, label, unit_price, qty })) }; };

const createOrder = (b, customerId) => {
  const name = str(b.name, 80), phone = normPhone(b.phone), email = str(b.email, 120), note = str(b.note, 500);
  if (name.length < 2) throw bad('Veuillez renseigner votre nom.');
  if (!validPhone(phone)) throw bad('Numéro de téléphone invalide.');
  if (!validEmail(email)) throw bad('Adresse e-mail invalide.');
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 30) throw bad('Panier vide ou invalide.');
  const methods = JSON.parse(getSettings().payment_methods || '[]').filter((m) => m.active);
  const method = methods.find((m) => m.id === b.method);
  if (!method) throw bad('Choisissez un moyen de paiement disponible.');
  return tx(() => {
    let total = 0; const rows = [];
    const merged = new Map();
    for (const l of b.lines) { const id = int(l.variant_id), q = int(l.qty); if (q < 1 || q > 50) throw bad('Quantité invalide.'); merged.set(id, (merged.get(id) || 0) + q); }
    for (const [vid, qty] of merged) {
      const v = db.prepare(`SELECT v.*, i.name iname, i.stock, i.active iact, i.kind, i.id iid FROM variants v JOIN items i ON i.id=v.item_id WHERE v.id=?`).get(vid);
      if (!v || !v.active || !v.iact) throw bad('Un article de votre panier n’est plus disponible.');
      if (v.stock !== null) {
        if (v.stock < qty) throw bad(`Stock insuffisant pour « ${v.iname} ».`);
        db.prepare('UPDATE items SET stock=stock-? WHERE id=?').run(qty, v.iid);
      }
      total += v.price * qty; rows.push({ v, qty });
    }
    const ref = newRef();
    const id = Number(db.prepare('INSERT INTO orders(ref,customer_id,name,phone,email,note,total,pay_method) VALUES(?,?,?,?,?,?,?,?)')
      .run(ref, customerId || null, name, phone, email, note, total, method.label).lastInsertRowid);
    for (const { v, qty } of rows) db.prepare('INSERT INTO order_items(order_id,variant_id,item_id,name,label,unit_price,qty) VALUES(?,?,?,?,?,?,?)').run(id, v.id, v.iid, v.iname, v.label, v.price, qty);
    log(id, 'Commande créée — en attente de paiement');
    return { ref, total, method: { id: method.id, label: method.label, number: method.number, holder: method.holder, instructions: method.instructions } };
  });
};

const restoreStock = (orderId) => {
  for (const r of db.prepare('SELECT item_id,qty FROM order_items WHERE order_id=?').all(orderId))
    db.prepare('UPDATE items SET stock=stock+? WHERE id=? AND stock IS NOT NULL').run(r.qty, r.item_id);
};
const confirmPayment = (o, { method, ref, by }) => {
  const year = new Date().getUTCFullYear();
  const n = db.prepare("SELECT COUNT(*) c FROM orders WHERE receipt_no LIKE ?").get(`RC-${year}-%`).c + 1;
  const receipt = o.receipt_no || `RC-${year}-${String(n).padStart(5, '0')}`;
  db.prepare(`UPDATE orders SET pay_status='confirme', status=CASE WHEN status IN('en_attente_paiement') THEN 'paiement_confirme' ELSE status END,
    paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP), receipt_no=?, pay_method=COALESCE(NULLIF(?,''),pay_method), pay_ref=COALESCE(NULLIF(?,''),pay_ref), updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(receipt, method || '', ref || '', o.id);
  log(o.id, `Paiement confirmé (${by}) — reçu ${receipt}`);
};

/* ---------- routes ---------- */
const routes = [];
const route = (method, pattern, handler) => {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler });
};

/* public */
route('GET', '/api/catalog', () => ({ settings: publicSettings(), ...loadCatalog(false) }));

route('POST', '/api/orders', async (req, res, p, b) => {
  limit(req, 'order', 15, 3600e3);
  const cs = getSession(req, 'customer');
  const r = createOrder(b, cs && cs.user_id);
  return r;
});
route('POST', '/api/orders/:ref/payment', (req, res, p, b) => {
  limit(req, 'pay', 20, 3600e3);
  const o = db.prepare('SELECT * FROM orders WHERE ref=?').get(p.ref);
  if (!o || phoneKey(o.phone) !== phoneKey(b.phone)) throw new HttpError(404, 'Commande introuvable');
  if (o.status === 'annulee') throw bad('Cette commande est annulée.');
  if (o.pay_status === 'confirme') throw bad('Cette commande est déjà payée.');
  const payRef = str(b.pay_ref, 60);
  if (payRef.length < 4) throw bad('Saisissez la référence de la transaction (reçue par SMS).');
  db.prepare("UPDATE orders SET pay_status='en_verification', pay_ref=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(payRef, o.id);
  log(o.id, `Le client déclare avoir payé — référence ${payRef} (à vérifier)`);
  return { ok: true, pay_status: 'en_verification' };
});
route('POST', '/api/track', (req, res, p, b) => {
  limit(req, 'track', 30, 600e3);
  const o = db.prepare('SELECT * FROM orders WHERE ref=?').get(str(b.ref, 40).toUpperCase());
  if (!o || phoneKey(o.phone) !== phoneKey(b.phone)) throw new HttpError(404, 'Aucune commande ne correspond à ces informations.');
  return orderPublic(o);
});

/* webhook agrégateur (à adapter au prestataire choisi : CinetPay, PayDunya, etc.) */
route('POST', '/api/webhooks/payment', async (req, res) => {
  if (!WEBHOOK_SECRET) throw new HttpError(503, 'Webhook non configuré');
  const raw = await readBody(req, 1e5);
  const sig = String(req.headers['x-signature'] || '');
  const calc = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  if (sig.length !== calc.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(calc))) throw new HttpError(401, 'Signature invalide');
  const e = JSON.parse(raw.toString('utf8'));
  const o = db.prepare('SELECT * FROM orders WHERE ref=?').get(str(e.order_ref, 40));
  if (!o) throw new HttpError(404, 'Commande inconnue');
  if (e.status === 'success' && int(e.amount) === o.total && o.status !== 'annulee') { confirmPayment(o, { method: str(e.method, 40), ref: str(e.transaction_id, 60), by: 'webhook signé' }); }
  else if (e.status === 'failed') { db.prepare("UPDATE orders SET pay_status='refuse' WHERE id=? AND pay_status!='confirme'").run(o.id); log(o.id, 'Paiement refusé (webhook)'); }
  else log(o.id, `Webhook ignoré (statut=${str(e.status, 20)}, montant=${int(e.amount)})`);
  return { ok: true };
});
route.raw = new Set(['/api/webhooks/payment']);

/* espace client */
route('POST', '/api/customer/register', (req, res, p, b) => {
  limit(req, 'reg', 10, 3600e3);
  const name = str(b.name, 80), phone = normPhone(b.phone), email = str(b.email, 120), pw = String(b.password || '');
  if (name.length < 2 || !validPhone(phone) || !validEmail(email)) throw bad('Informations invalides.');
  if (pw.length < 8) throw bad('Mot de passe : 8 caractères minimum.');
  const exists = db.prepare('SELECT 1 FROM customers WHERE phone=?').get(phone);
  if (exists) throw bad('Un compte existe déjà avec ce numéro.');
  const id = Number(db.prepare('INSERT INTO customers(name,phone,email,pass_hash) VALUES(?,?,?,?)').run(name, phone, email, hashPassword(pw)).lastInsertRowid);
  db.prepare('UPDATE orders SET customer_id=? WHERE customer_id IS NULL AND phone=?').run(id, phone);
  return [{ ok: true, name }, { 'Set-Cookie': startSession(res, 'customer', id) }];
});
route('POST', '/api/customer/login', (req, res, p, b) => {
  limit(req, 'login', 8, 600e3);
  const c = db.prepare('SELECT * FROM customers WHERE phone=? OR (email!=\'\' AND email=?)').get(normPhone(b.login), str(b.login, 120).toLowerCase());
  if (!c || !verifyPassword(String(b.password || ''), c.pass_hash)) throw new HttpError(401, 'Identifiants incorrects.');
  return [{ ok: true, name: c.name }, { 'Set-Cookie': startSession(res, 'customer', c.id) }];
});
route('POST', '/api/customer/logout', (req) => [{ ok: true }, { 'Set-Cookie': endSession(req, 'customer') }]);
route('GET', '/api/customer/me', (req) => {
  const s = getSession(req, 'customer'); if (!s) return { customer: null };
  const c = db.prepare('SELECT id,name,phone,email FROM customers WHERE id=?').get(s.user_id);
  const orders = db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 100').all(c.id).map(orderPublic);
  return { customer: c, orders };
});

/* reçus */
const sendReceipt = (res, o, auto) => {
  if (!o || o.pay_status !== 'confirme') throw new HttpError(403, 'Le reçu n’est disponible que pour une commande dont le paiement est confirmé.');
  send(res, 200, receiptHTML(orderFull(o), getSettings(), { auto }), { 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'" });
};
route('GET', '/receipt/track/:ref', (req, res, p, b, q) => {
  limit(req, 'rcpt', 30, 600e3);
  const o = db.prepare('SELECT * FROM orders WHERE ref=?').get(p.ref);
  if (!o || phoneKey(o.phone) !== phoneKey(q.get('phone'))) throw new HttpError(404, 'Reçu introuvable');
  sendReceipt(res, o, q.get('auto') === '1'); return null;
});
route('GET', '/receipt/my/:ref', (req, res, p, b, q) => {
  const s = getSession(req, 'customer'); if (!s) throw new HttpError(401, 'Connexion requise');
  const o = db.prepare('SELECT * FROM orders WHERE ref=? AND customer_id=?').get(p.ref, s.user_id);
  if (!o) throw new HttpError(404, 'Reçu introuvable');
  sendReceipt(res, o, q.get('auto') === '1'); return null;
});
route('GET', '/receipt/admin/:id', (req, res, p, b, q) => {
  requireAdmin(req);
  sendReceipt(res, db.prepare('SELECT * FROM orders WHERE id=?').get(int(p.id)), q.get('auto') === '1'); return null;
});

/* admin */
route('POST', '/api/admin/login', (req, res, p, b) => {
  limit(req, 'alogin', 6, 900e3);
  const a = db.prepare('SELECT * FROM admins WHERE username=?').get(str(b.username, 60));
  if (!a || !verifyPassword(String(b.password || ''), a.pass_hash)) throw new HttpError(401, 'Identifiants incorrects.');
  return [{ ok: true, username: a.username }, { 'Set-Cookie': startSession(res, 'admin', a.id) }];
});
route('POST', '/api/admin/logout', (req) => [{ ok: true }, { 'Set-Cookie': endSession(req, 'admin') }]);
route('GET', '/api/admin/me', (req) => { const s = getSession(req, 'admin'); return s ? { admin: db.prepare('SELECT username FROM admins WHERE id=?').get(s.user_id) } : { admin: null }; });
route('POST', '/api/admin/password', (req, res, p, b) => {
  const a = requireAdmin(req); const row = db.prepare('SELECT * FROM admins WHERE id=?').get(a.id);
  if (!verifyPassword(String(b.current || ''), row.pass_hash)) throw new HttpError(401, 'Mot de passe actuel incorrect.');
  if (String(b.next || '').length < 10) throw bad('Nouveau mot de passe : 10 caractères minimum.');
  db.prepare('UPDATE admins SET pass_hash=? WHERE id=?').run(hashPassword(String(b.next)), a.id);
  db.prepare("DELETE FROM sessions WHERE role='admin' AND user_id=?").run(a.id);
  return [{ ok: true }, { 'Set-Cookie': startSession(res, 'admin', a.id) }];
});
route('GET', '/api/admin/stats', (req) => {
  requireAdmin(req);
  const c = (w) => db.prepare(`SELECT COUNT(*) c FROM orders ${w}`).get().c;
  return { total_orders: c(''), pending: c("WHERE status='en_attente_paiement' AND status!='annulee'"), to_verify: c("WHERE pay_status='en_verification'"),
    paid: c("WHERE pay_status='confirme'"), done: c("WHERE status='terminee'"), unpaid: c("WHERE pay_status='non_paye' AND status!='annulee'"), refused: c("WHERE pay_status='refuse'"),
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE pay_status='confirme' AND status!='annulee'").get().s,
    customers: db.prepare('SELECT COUNT(DISTINCT phone) c FROM orders').get().c,
    accounts: db.prepare('SELECT COUNT(*) c FROM customers').get().c,
    latest: db.prepare('SELECT id,ref,name,total,status,pay_status,created_at FROM orders ORDER BY id DESC LIMIT 8').all() };
});
route('GET', '/api/admin/orders', (req, res, p, b, q) => {
  requireAdmin(req);
  const w = [], a = [];
  const s = q.get('status'), ps = q.get('pay_status'), t = str(q.get('q'), 60);
  if (STATUSES.includes(s)) { w.push('status=?'); a.push(s); }
  if (PAY_STATUSES.includes(ps)) { w.push('pay_status=?'); a.push(ps); }
  if (t) { w.push('(ref LIKE ? OR name LIKE ? OR phone LIKE ? OR pay_ref LIKE ?)'); a.push(...Array(4).fill('%' + t.replace(/[%_]/g, '') + '%')); }
  const page = Math.max(1, int(q.get('page'), 1)), size = 25;
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM orders ${where}`).get(...a).c;
  const rows = db.prepare(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...a, size, (page - 1) * size);
  return { total, page, size, orders: rows };
});
route('GET', '/api/admin/orders/:id', (req, res, p) => {
  requireAdmin(req);
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(int(p.id)); if (!o) throw new HttpError(404, 'Commande introuvable');
  return orderFull(o);
});
route('POST', '/api/admin/orders/:id/status', (req, res, p, b) => {
  const a = requireAdmin(req);
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(int(p.id)); if (!o) throw new HttpError(404, 'Commande introuvable');
  if (!STATUSES.includes(b.status)) throw bad('Statut invalide');
  if (['paiement_confirme', 'en_cours', 'terminee'].includes(b.status) && o.pay_status !== 'confirme')
    throw bad('Confirmez d’abord le paiement avant de passer la commande à ce statut.');
  tx(() => {
    if (b.status === 'annulee' && o.status !== 'annulee') restoreStock(o.id);
    db.prepare('UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(b.status, o.id);
    log(o.id, `Statut → ${b.status} (par ${a.username})`);
  });
  return { ok: true };
});
route('POST', '/api/admin/orders/:id/payment', (req, res, p, b) => {
  const a = requireAdmin(req);
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(int(p.id)); if (!o) throw new HttpError(404, 'Commande introuvable');
  tx(() => {
    if (b.action === 'confirm') {
      if (o.status === 'annulee') throw bad('Commande annulée : réactivez-la d’abord.');
      confirmPayment(o, { method: str(b.method, 40), ref: str(b.pay_ref, 60), by: 'admin ' + a.username });
    } else if (b.action === 'reject') {
      if (o.pay_status === 'confirme') throw bad('Paiement déjà confirmé.');
      db.prepare("UPDATE orders SET pay_status='refuse', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(o.id); log(o.id, `Paiement refusé (par ${a.username})`);
    } else if (b.action === 'reset') {
      if (o.pay_status === 'confirme') throw bad('Un paiement confirmé ne peut pas être remis à zéro.');
      db.prepare("UPDATE orders SET pay_status='non_paye', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(o.id); log(o.id, `Paiement remis à « non payé » (par ${a.username})`);
    } else throw bad('Action invalide');
  });
  return { ok: true };
});

/* admin : catalogue */
const saveItem = (b, id) => tx(() => {
  const kind = b.kind === 'product' ? 'product' : 'service';
  const name = str(b.name, 120); if (name.length < 2) throw bad('Nom requis');
  const cat = b.category_id ? int(b.category_id) : null;
  const stock = (b.stock === '' || b.stock === null || b.stock === undefined) ? null : Math.max(0, int(b.stock));
  const vars = Array.isArray(b.variants) ? b.variants.slice(0, 40) : [];
  if (!vars.length) throw bad('Ajoutez au moins une option avec un prix.');
  const fields = [kind, cat, name, str(b.description, 2000), str(b.image, 300), str(b.badge, 30), str(b.availability, 60) || 'Disponible', str(b.validity, 60), stock, b.active ? 1 : 0, int(b.sort)];
  if (id) db.prepare('UPDATE items SET kind=?,category_id=?,name=?,description=?,image=?,badge=?,availability=?,validity=?,stock=?,active=?,sort=? WHERE id=?').run(...fields, id);
  else {
    let slug = slugify(name), n = 1; while (db.prepare('SELECT 1 FROM items WHERE slug=?').get(slug)) slug = slugify(name) + '-' + (++n);
    id = Number(db.prepare('INSERT INTO items(kind,category_id,name,description,image,badge,availability,validity,stock,active,sort,slug) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(...fields, slug).lastInsertRowid);
  }
  const keep = [];
  vars.forEach((v, i) => {
    const label = str(v.label, 80), price = int(v.price, -1); if (!label || price < 0) throw bad('Option invalide (libellé et prix requis).');
    const old = v.old_price === '' || v.old_price == null ? null : int(v.old_price);
    if (v.id && db.prepare('SELECT 1 FROM variants WHERE id=? AND item_id=?').get(int(v.id), id)) {
      db.prepare('UPDATE variants SET label=?,price=?,old_price=?,price_from=?,active=?,sort=? WHERE id=?').run(label, price, old, v.price_from ? 1 : 0, v.active === false ? 0 : 1, i, int(v.id)); keep.push(int(v.id));
    } else keep.push(Number(db.prepare('INSERT INTO variants(item_id,label,price,old_price,price_from,active,sort) VALUES(?,?,?,?,?,?,?)').run(id, label, price, old, v.price_from ? 1 : 0, v.active === false ? 0 : 1, i).lastInsertRowid));
  });
  for (const r of db.prepare('SELECT id FROM variants WHERE item_id=?').all(id)) if (!keep.includes(r.id)) db.prepare('UPDATE variants SET active=0 WHERE id=?').run(r.id);
  return id;
});
route('GET', '/api/admin/catalog', (req) => { requireAdmin(req); return loadCatalog(true); });
route('POST', '/api/admin/items', (req, res, p, b) => { requireAdmin(req); return { id: saveItem(b) }; });
route('PUT', '/api/admin/items/:id', (req, res, p, b) => { requireAdmin(req); return { id: saveItem(b, int(p.id)) }; });
route('DELETE', '/api/admin/items/:id', (req, res, p) => { requireAdmin(req); db.prepare('DELETE FROM items WHERE id=?').run(int(p.id)); return { ok: true }; });
route('POST', '/api/admin/categories', (req, res, p, b) => {
  requireAdmin(req);
  const name = str(b.name, 60); if (!name) throw bad('Nom requis');
  let slug = slugify(name), n = 1; while (db.prepare('SELECT 1 FROM categories WHERE slug=?').get(slug)) slug = slugify(name) + '-' + (++n);
  const id = Number(db.prepare('INSERT INTO categories(kind,slug,name,icon,sort) VALUES(?,?,?,?,?)').run(b.kind === 'product' ? 'product' : 'service', slug, name, str(b.icon, 8), int(b.sort, 50)).lastInsertRowid);
  return { id };
});
route('PUT', '/api/admin/categories/:id', (req, res, p, b) => {
  requireAdmin(req); const name = str(b.name, 60); if (!name) throw bad('Nom requis');
  db.prepare('UPDATE categories SET name=?, icon=?, sort=? WHERE id=?').run(name, str(b.icon, 8), int(b.sort), int(p.id)); return { ok: true };
});
route('DELETE', '/api/admin/categories/:id', (req, res, p) => { requireAdmin(req); db.prepare('DELETE FROM categories WHERE id=?').run(int(p.id)); return { ok: true }; });
route('POST', '/api/admin/upload', async (req, res, p, b) => {
  requireAdmin(req);
  const m = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(String(b.data || ''));
  if (!m) throw bad('Image PNG, JPEG ou WebP requise');
  const buf = Buffer.from(m[3], 'base64');
  const magic = { png: buf.slice(0, 4).toString('hex') === '89504e47', jpeg: buf.slice(0, 3).toString('hex') === 'ffd8ff', webp: buf.slice(8, 12).toString() === 'WEBP' };
  if (!magic[m[2]]) throw bad('Fichier image invalide');
  const file = crypto.randomBytes(12).toString('hex') + '.' + (m[2] === 'jpeg' ? 'jpg' : m[2]);
  fs.writeFileSync(path.join(UPLOADS, file), buf);
  return { url: '/uploads/' + file };
});
route('GET', '/api/admin/settings', (req) => { requireAdmin(req); return getSettings(); });
route('PUT', '/api/admin/settings', (req, res, p, b) => {
  requireAdmin(req);
  const allowed = ['site_name', 'tagline', 'hero_title', 'hero_text', 'about_title', 'about_text', 'shop_text', 'whatsapp', 'phone', 'email', 'address', 'snap', 'promo_active', 'promo_text', 'currency'];
  for (const k of allowed) if (k in b) setSetting(k, str(b[k], 2000));
  if ('whatsapp' in b) setSetting('whatsapp', String(b.whatsapp).replace(/\D/g, '').slice(0, 15));
  for (const k of ['payment_methods', 'advantages', 'faq']) if (k in b) {
    if (!Array.isArray(b[k])) throw bad(k + ' invalide');
    if (k === 'payment_methods') b[k] = b[k].slice(0, 8).map((m) => ({ id: slugify(m.id || m.label).replace(/-/g, '_'), label: str(m.label, 40), number: str(m.number, 30), holder: str(m.holder, 60), instructions: str(m.instructions, 400), active: !!m.active }));
    else b[k] = b[k].slice(0, 20).map((r) => r.map((x) => str(x, 400)));
    setSetting(k, JSON.stringify(b[k]));
  }
  return { ok: true };
});

/* ---------- fichiers statiques / SEO ---------- */
const baseUrl = (req) => SITE_URL || `${PROD ? 'https' : 'http'}://${req.headers.host}`;
const serveStatic = (req, res, pathname) => {
  if (pathname === '/robots.txt') return send(res, 200, `User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /receipt/\nSitemap: ${baseUrl(req)}/sitemap.xml\n`, { 'Content-Type': MIME['.txt'] });
  if (pathname === '/sitemap.xml') return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${baseUrl(req)}/</loc></url></urlset>`, { 'Content-Type': MIME['.xml'] });
  let rel = pathname === '/' ? '/index.html' : pathname === '/admin' || pathname === '/admin/' ? '/admin/index.html' : pathname;
  let root = PUBLIC;
  if (rel.startsWith('/uploads/')) { root = UPLOADS; rel = rel.slice(8); }
  let file; try { file = path.join(root, decodeURIComponent(rel)); } catch { return send(res, 400, 'Bad request'); }
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (pathname.includes('.') || pathname.startsWith('/api')) return send(res, 404, { error: 'Introuvable' });
    file = path.join(PUBLIC, 'index.html');
  }
  const ext = path.extname(file).toLowerCase();
  const isAdmin = file.endsWith(path.join('admin', 'index.html'));
  const h = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  h['Cache-Control'] = (ext === '.html') ? 'no-cache' : 'public, max-age=3600';
  if (isAdmin) h['X-Robots-Tag'] = 'noindex, nofollow';
  if (file.endsWith(path.join('public', 'index.html'))) {
    const s = publicSettings();
    const html = fs.readFileSync(file, 'utf8').replace(/\{\{(TITLE|DESC|URL)\}\}/g, (_, k) => ({ TITLE: `${s.site_name} & MARTHIAL SHOP – ${s.tagline}`, DESC: s.hero_text, URL: baseUrl(req) }[k]).replace(/"/g, '&quot;'));
    res.writeHead(200, h); return res.end(html);
  }
  res.writeHead(200, h); fs.createReadStream(file).pipe(res);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  try {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/receipt/')) {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'Introuvable');
      const m = r.re.exec(url.pathname); const params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      let body = {};
      if (req.method !== 'GET' && !route.raw.has(url.pathname)) {
        if (url.pathname !== '/api/webhooks/payment') csrfCheck(req);
        body = await readJson(req, url.pathname === '/api/admin/upload' ? 5e6 : 1e6);
      }
      let out = await r.handler(req, res, params, body, url.searchParams);
      if (out === null) return;
      let headers = {};
      if (Array.isArray(out)) [out, headers] = out;
      return send(res, 200, out, headers);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    const code = e instanceof HttpError ? e.code : 500;
    send(res, code, { error: e instanceof HttpError ? e.message : 'Erreur interne du serveur' });
  }
});
server.listen(PORT, () => console.log(`MARTHIAL'S SERVICES en ligne : http://localhost:${PORT}  (admin : /admin)`));
