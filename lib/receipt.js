'use strict';
const fs = require('fs');
const path = require('path');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ') + ' F CFA';
const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return d.toLocaleString('fr-FR', { timeZone: 'Africa/Ouagadougou', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
let logoData = '';
try { logoData = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'logo.png')).toString('base64'); } catch { /* logo absent */ }

const receiptHTML = (o, s, { auto } = {}) => {
  const rows = o.items.map((i) => `<tr><td>${esc(i.name)}${i.label ? `<small>${esc(i.label)}</small>` : ''}</td><td class="c">${i.qty}</td><td class="r">${money(i.unit_price)}</td><td class="r">${money(i.unit_price * i.qty)}</td></tr>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>Reçu ${esc(o.receipt_no)} – ${esc(s.site_name)}</title>
<style>
@page{size:A4;margin:0}
*{box-sizing:border-box}
body{margin:0;background:#e8e6ef;font:14px/1.45 "Segoe UI",Arial,sans-serif;color:#15121f;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{max-width:210mm;margin:14px auto 0;display:flex;gap:10px;justify-content:flex-end;padding:0 4px}
.bar button{font:600 14px inherit;padding:10px 18px;border:0;border-radius:8px;background:#6d28d9;color:#fff;cursor:pointer}
.bar button.alt{background:#fff;color:#111}
.page{width:210mm;min-height:297mm;margin:12px auto;background:#fff;position:relative;overflow:hidden;box-shadow:0 10px 40px #0003}
.head{background:#000;padding:16px 14mm 12px;display:flex;align-items:center;gap:20px;border-bottom:4px solid #d4a017}
.head img{height:92px;width:auto}
.head .t{margin-left:auto;text-align:right;color:#f5c542}
.head .t h1{margin:0;font-size:24px;letter-spacing:.14em}
.head .t p{margin:4px 0 0;color:#c9b6ff;font-size:12px}
.body{padding:10mm 14mm}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:6mm}
.box{border:1px solid #e3def0;border-radius:10px;padding:10px 14px}
.box h3{margin:0 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6d28d9}
.box div{display:flex;justify-content:space-between;gap:10px;padding:2px 0}
.box span:first-child{color:#6b6680}
.box b{text-align:right}
table{width:100%;border-collapse:collapse;margin-top:8mm}
th{background:#120a24;color:#f5c542;text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:9px 10px}
td{padding:10px;border-bottom:1px solid #ece8f6;vertical-align:top}
td small{display:block;color:#6b6680}
.c{text-align:center}.r{text-align:right}
.total{margin-top:6mm;margin-left:auto;width:90mm;background:#120a24;color:#fff;border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;font-size:16px}
.total b{color:#f5c542;font-size:19px}
.sum{display:flex;align-items:center;justify-content:space-between;gap:10mm;margin-top:6mm}.sum .total{margin:0}
.paid{transform:rotate(-8deg);border:4px solid #16a34a;color:#16a34a;font-weight:800;font-size:34px;letter-spacing:.2em;padding:2px 18px;border-radius:10px;opacity:.85}
.thanks{margin-top:12mm;text-align:center;color:#3b3552}
.thanks b{display:block;font-size:17px;color:#6d28d9;margin-bottom:4px}
.foot{position:absolute;left:0;right:0;bottom:0;background:#000;color:#cfc6ea;text-align:center;font-size:11px;padding:10px;border-top:3px solid #d4a017}
@media print{body{background:#fff}.bar{display:none}.page{margin:0;box-shadow:none}}
</style></head><body>
<div class="bar"><button class="alt" id="back">Fermer</button><button id="print">Imprimer / Enregistrer en PDF</button></div>
<div class="page">
 <div class="head">${logoData ? `<img src="${logoData}" alt="${esc(s.site_name)}">` : ''}
  <div class="t"><h1>REÇU DE PAIEMENT</h1><p>${esc(s.site_name)}</p></div></div>
 <div class="body">
  <div class="meta">
   <div class="box"><h3>Reçu</h3><div><span>Reçu n°</span><b>${esc(o.receipt_no)}</b></div><div><span>Commande n°</span><b>${esc(o.ref)}</b></div><div><span>Date du paiement</span><b>${fmtDate(o.paid_at)}</b></div></div>
   <div class="box"><h3>Client</h3><div><span>Nom</span><b>${esc(o.name)}</b></div><div><span>Téléphone</span><b>${esc(o.phone)}</b></div>${o.email ? `<div><span>E-mail</span><b>${esc(o.email)}</b></div>` : ''}</div>
  </div>
  <table><thead><tr><th>Prestation / produit</th><th class="c">Qté</th><th class="r">Prix unitaire</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="sum"><div class="paid">PAYÉ</div><div class="total"><span>Montant total payé</span><b>${money(o.total)}</b></div></div>
  <div class="meta" style="margin-top:8mm">
   <div class="box"><h3>Paiement</h3><div><span>Moyen de paiement</span><b>${esc(o.pay_method || '—')}</b></div><div><span>Réf. de transaction</span><b>${esc(o.pay_ref || '—')}</b></div><div><span>Statut</span><b style="color:#16a34a">PAYÉ</b></div></div>
   <div class="box"><h3>Contact</h3>${s.phone ? `<div><span>Téléphone</span><b>${esc(s.phone)}</b></div>` : ''}${s.email ? `<div><span>E-mail</span><b>${esc(s.email)}</b></div>` : ''}${s.snap ? `<div><span>Snap</span><b>${esc(s.snap)}</b></div>` : ''}</div>
  </div>
  <div class="thanks"><b>Merci pour votre confiance !</b>Votre paiement a bien été reçu. Pour toute question, contactez-nous en indiquant votre numéro de commande.</div>
 </div>
 <div class="foot">${esc(s.site_name)} — ${esc(s.tagline)}</div>
</div>
<script>
document.getElementById('print').onclick=function(){window.print()};
document.getElementById('back').onclick=function(){window.close();history.back()};
${auto ? 'window.addEventListener("load",function(){setTimeout(function(){window.print()},400)});' : ''}
</script></body></html>`;
};
module.exports = { receiptHTML };
