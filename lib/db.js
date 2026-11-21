'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'marthials.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('service','product')),
  slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, icon TEXT DEFAULT '', sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('service','product')),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT DEFAULT '',
  image TEXT DEFAULT '', badge TEXT DEFAULT '', availability TEXT DEFAULT 'Disponible',
  validity TEXT DEFAULT '', stock INTEGER, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS variants(
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>=0), old_price INTEGER,
  price_from INTEGER DEFAULT 0, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS customers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, email TEXT,
  pass_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS admins(
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, role TEXT NOT NULL, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, customer_id INTEGER REFERENCES customers(id),
  name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT DEFAULT '', note TEXT DEFAULT '',
  total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'en_attente_paiement',
  pay_status TEXT NOT NULL DEFAULT 'non_paye',
  pay_method TEXT DEFAULT '', pay_ref TEXT DEFAULT '', paid_at TEXT, receipt_no TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, pay_status);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id INTEGER, item_id INTEGER, name TEXT NOT NULL, label TEXT DEFAULT '',
  unit_price INTEGER NOT NULL, qty INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_log(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, at TEXT DEFAULT CURRENT_TIMESTAMP, text TEXT NOT NULL);
`);

/* ---------- helpers ---------- */
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16);
  return 's1$' + salt.toString('hex') + '$' + crypto.scryptSync(pw, salt, 64).toString('hex');
};
const verifyPassword = (pw, stored) => {
  try {
    const [v, s, h] = String(stored).split('$');
    if (v !== 's1') return false;
    const calc = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
    return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
  } catch { return false; }
};
const tx = (fn) => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};
const slugify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

/* ---------- settings ---------- */
const DEFAULTS = {
  site_name: "MARTHIAL'S SERVICES",
  tagline: 'Vos abonnements • Vos services • Votre satisfaction',
  hero_title: 'Tous vos abonnements premium, au même endroit.',
  hero_text: "Netflix, Spotify, Snapchat Plus, IPTV, iCloud+ et bien plus : commandez en quelques clics, payez par Mobile Money et recevez votre accès rapidement.",
  about_title: "MARTHIAL'S SERVICES",
  about_text: "MARTHIAL'S SERVICES vous donne accès à vos applications payantes : streaming, musique, applications, cloud et services numériques. Une équipe joignable directement sur WhatsApp, des prix clairs en F CFA et un reçu pour chaque paiement confirmé.",
  shop_text: "MARTHIAL SHOP, la boutique intégrée : retrouvez ici nos produits et ajoutez-les à votre panier.",
  whatsapp: '22606698857',
  phone: '+226 06 69 88 57',
  email: '',
  address: 'Burkina Faso',
  snap: 'drop_databse',
  promo_active: '0',
  promo_text: '',
  currency: 'F CFA',
  payment_methods: JSON.stringify([
    { id: 'orange_money', label: 'Orange Money', number: '', holder: "MARTHIAL'S SERVICES", active: false,
      instructions: "Envoyez le montant exact au numéro indiqué, puis saisissez la référence de la transaction reçue par SMS." },
    { id: 'moov_money', label: 'Moov Money', number: '', holder: "MARTHIAL'S SERVICES", active: false,
      instructions: "Envoyez le montant exact au numéro indiqué, puis saisissez la référence de la transaction reçue par SMS." }
  ]),
  advantages: JSON.stringify([
    ['⚡', 'Livraison rapide', 'Votre accès est traité dès la confirmation de votre paiement.'],
    ['📱', 'Paiement Mobile Money', 'Payez avec les moyens disponibles au Burkina Faso.'],
    ['🧾', 'Reçu pour chaque paiement', 'Un reçu officiel est émis pour toute commande payée.'],
    ['💬', 'Support WhatsApp', 'Une question ? Écrivez-nous directement, avec votre numéro de commande.'],
    ['🔒', 'Commande sécurisée', 'Aucune commande n’est marquée payée sans vérification réelle.'],
    ['💎', 'Prix clairs en F CFA', 'Pas de surprise : le total est affiché avant de valider.']
  ]),
  faq: JSON.stringify([
    ['Comment passer commande ?', 'Choisissez une prestation, ajoutez-la au panier, renseignez vos coordonnées, puis payez avec le moyen proposé.'],
    ['Dois-je créer un compte ?', 'Non. Le compte client est facultatif : il sert seulement à retrouver vos commandes et vos reçus.'],
    ['Quand ma commande est-elle validée ?', 'Après vérification de votre paiement par notre équipe (ou confirmation automatique du paiement). Le statut est visible via votre numéro de commande.'],
    ['Comment obtenir mon reçu ?', 'Dès que le paiement est confirmé, le reçu est disponible dans « Suivre ma commande » ou dans votre espace client.'],
    ['Comment contacter le support ?', 'Via le bouton WhatsApp, en indiquant votre numéro de commande.']
  ])
};
const getSettings = () => {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = r.value;
  return out;
};
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

/* ---------- seed (données issues de l'affiche officielle) ---------- */
const seed = () => {
  if (db.prepare('SELECT COUNT(*) c FROM categories').get().c) return;
  const cats = [['service', 'Streaming', '▶'], ['service', 'Jeux', '🎮'], ['service', 'Applis', '📱'],
    ['service', 'Sites web', '🌐'], ['service', 'Cloud', '☁'], ['service', 'Autres services', '🛡']];
  const cid = {};
  cats.forEach(([kind, name, icon], i) => {
    cid[name] = Number(db.prepare('INSERT INTO categories(kind,slug,name,icon,sort) VALUES(?,?,?,?,?)').run(kind, slugify(name), name, icon, i).lastInsertRowid);
  });
  const S = [
    ['Streaming', 'Netflix', 'Abonnement Netflix. Choisissez le nombre d’appareils ou la durée.', '', [['1 appareil (Mobile) – 1 mois', 3500], ['2 appareils (Mobile + TV) – 1 mois', 5000], ['3 mois', 12000], ['6 mois', 19500]]],
    ['Streaming', 'IPTV', 'Abonnement IPTV longue durée.', '', [['6 mois', 15000], ['12 mois', 25000]]],
    ['Streaming', 'Crunchyroll', 'Abonnement Crunchyroll.', '1 mois', [['1 mois', 4000]]],
    ['Streaming', 'Prime Video', 'Abonnement Prime Video.', '1 mois', [['1 mois', 4000]]],
    ['Streaming', 'Spotify', 'Abonnement Spotify.', '', [['2 mois', 5000], ['3 mois', 7000]]],
    ['Streaming', 'Apple Music', 'Abonnement Apple Music.', '1 mois', [['1 mois', 5000]]],
    ['Applis', 'Snapchat Plus', 'Abonnement Snapchat Plus pour 1 an, Android ou iPhone.', '1 an', [['Android – 1 an', 6500], ['iPhone – 1 an', 6500]]],
    ['Applis', 'CapCut', 'Abonnement CapCut.', '', [['1 mois', 4500], ['1 an', 19000]]],
    ['Applis', 'Activation Telegram', 'Activation de votre compte Telegram.', '', [['Activation', 3000]]],
    ['Cloud', 'iCloud+', 'Espace de stockage iCloud+.', '', [['50 Go', 3000], ['200 Go', 4000], ['2 To', 9000]]],
    ['Autres services', 'Boostage TikTok', 'Boostage de votre compte TikTok. Tarif à partir de 3 500 F CFA ; précisez votre besoin à la commande.', '', [['Boost – à partir de', 3500, 1]]]
  ];
  S.forEach(([cat, name, desc, validity, vs], i) => {
    const id = Number(db.prepare('INSERT INTO items(kind,category_id,slug,name,description,validity,sort) VALUES(?,?,?,?,?,?,?)')
      .run('service', cid[cat], slugify(name), name, desc, validity, i).lastInsertRowid);
    vs.forEach(([label, price, from], j) => db.prepare('INSERT INTO variants(item_id,label,price,price_from,sort) VALUES(?,?,?,?,?)').run(id, label, price, from ? 1 : 0, j));
  });
};
seed();

/* ---------- admin initial ---------- */
const ensureAdmin = () => {
  if (db.prepare('SELECT COUNT(*) c FROM admins').get().c) return;
  const username = process.env.ADMIN_USER || 'admin';
  let pw = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!pw || pw.length < 10) { pw = crypto.randomBytes(9).toString('base64url'); generated = true; }
  db.prepare('INSERT INTO admins(username,pass_hash) VALUES(?,?)').run(username, hashPassword(pw));
  console.log('\n=== COMPTE ADMINISTRATEUR CRÉÉ ===\n  identifiant : ' + username +
    (generated ? '\n  mot de passe : ' + pw + '\n  (généré automatiquement : notez-le et changez-le dans /admin > Compte)' : '\n  mot de passe : celui de ADMIN_PASSWORD') + '\n');
};
ensureAdmin();

module.exports = { db, tx, hashPassword, verifyPassword, slugify, getSettings, setSetting, DEFAULTS, DATA_DIR };
