const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const xmlrpc = require('xmlrpc');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = 3000;

// ── Odoo Config ───────────────────────────────────────────────────────────────
const ODOO_HOST = 'prowindows-ltda.odoo.com';
const ODOO_DB = 'prowindows-ltda';
const GENERIC_PRODUCT_ID = 19253; // Ventana 2 hojas correderas PVC (Genérico)

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret: 'pw-cotizador-pvc-2025-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
}));

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Solo se aceptan archivos PDF'));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.odooUid) return next();
  res.status(401).json({ error: 'Sesión expirada. Por favor vuelve a iniciar sesión.' });
}

// ── Odoo XML-RPC helpers ──────────────────────────────────────────────────────
function createClient(resource) {
  return xmlrpc.createSecureClient({
    host: ODOO_HOST,
    port: 443,
    path: `/xmlrpc/2/${resource}`,
  });
}

function call(client, method, args) {
  return new Promise((resolve, reject) => {
    client.methodCall(method, args, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// Odoo call using per-request session credentials
function odoo(req, model, method, args, kwargs = {}) {
  const { odooUid, odooPassword } = req.session;
  const models = createClient('object');
  return call(models, 'execute_kw', [
    ODOO_DB, odooUid, odooPassword,
    model, method, args, kwargs,
  ]);
}

// ── PDF Parsing ───────────────────────────────────────────────────────────────
function parsePdfText(text) {
  const lines = text.split('\n');
  const items = [];
  let currentBlock = [];

  for (const line of lines) {
    currentBlock.push(line);

    if (/Pos:\s*V\d+/.test(line)) {
      const block = currentBlock.join('\n');
      currentBlock = [];

      const posMatch = block.match(/Pos:\s*(V\d+)/);
      const medMatch = block.match(/(\d[\d.,]*)\s*mm\s*[xX]\s*(\d[\d.,]*)\s*mm/);

      if (!posMatch || !medMatch) continue;

      const pos = posMatch[1];
      const ancho = Math.round(parseFloat(medMatch[1].replace(/\./g, '').replace(',', '.')));
      const alto  = Math.round(parseFloat(medMatch[2].replace(/\./g, '').replace(',', '.')));

      let color = 'Roble dorado';
      const colorMatch = block.match(/Color:\s*([^\n\t]+?)(?:\s{2,}|\t|Unidades:|$)/im);
      if (colorMatch) {
        color = colorMatch[1].trim();
        if (color === 'Golden Oak') color = 'Roble dorado';
      }

      let vidrio = '4/9/4 INC';
      const acrMatch = block.match(/Acristalamiento[:\s]+([^\n\r\t]{3,50}?)(?:\s{2,}|\t|Sin|$)/im);
      if (acrMatch) vidrio = acrMatch[1].trim().replace(/\s+/g, ' ');

      let qty = 1;
      const qtyMatch = block.match(/Unidades:\s*(\d+)/i);
      if (qtyMatch) qty = parseInt(qtyMatch[1]);

      let price = 0;
      const priceMatches = [...block.matchAll(/\$\s*([\d.,]+)/g)];
      if (priceMatches.length) {
        const raw = priceMatches[priceMatches.length - 1][1].replace(/\./g, '').replace(',', '.');
        price = Math.round(parseFloat(raw));
      }

      const blockLower = block.toLowerCase();
      let tipo = 'Fijo';
      if (blockLower.includes('corrediz') || blockLower.includes('corredera')) tipo = 'Corredera';
      else if (blockLower.includes('practicable') || blockLower.includes('batiente')) tipo = 'Practicable';

      let desc = `Ventana ${tipo} ${ancho}x${alto}mm`;
      const descLine = block.split('\n').find(l => l.match(/(LINEA|Ventana|ECOLIFE|Efficient|Advance)/i));
      if (descLine) desc = descLine.trim();

      items.push({ pos, ancho, alto, color, vidrio, qty, price, tipo, desc });
    }
  }

  return items;
}

// ══════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /api/login ───────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });

    const common = createClient('common');
    const uid = await call(common, 'authenticate', [ODOO_DB, email, password, {}]);

    if (!uid || uid === false) {
      return res.status(401).json({ error: 'Credenciales incorrectas. Verifica tu email y contraseña de Odoo.' });
    }

    // Read user info
    const models = createClient('object');
    const users = await call(models, 'execute_kw', [
      ODOO_DB, uid, password,
      'res.users', 'read', [[uid]],
      { fields: ['name', 'email', 'image_128'] },
    ]);

    req.session.odooUid = uid;
    req.session.odooPassword = password;
    req.session.odooEmail = email;
    req.session.odooName = users[0]?.name || email;
    req.session.odooAvatar = users[0]?.image_128 || null;

    console.log(`✅ Login: ${req.session.odooName} (uid=${uid})`);
    res.json({
      uid,
      name: req.session.odooName,
      email,
      avatar: req.session.odooAvatar,
    });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: `Error al conectar con Odoo: ${err.message}` });
  }
});

// ── POST /api/logout ──────────────────────────────────────────────────────────
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── GET /api/me ───────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (!req.session?.odooUid) return res.status(401).json({ error: 'not_authenticated' });
  res.json({
    uid: req.session.odooUid,
    name: req.session.odooName,
    email: req.session.odooEmail,
    avatar: req.session.odooAvatar,
  });
});

// ── POST /api/parse-pdf ───────────────────────────────────────────────────────
app.post('/api/parse-pdf', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo PDF.' });
    const data = await pdfParse(req.file.buffer);
    const items = parsePdfText(data.text);
    if (!items.length) {
      return res.status(422).json({ error: 'No se encontraron ítems de ventana en el PDF.' });
    }
    const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    res.json({ items, total, pageCount: data.numpages });
  } catch (err) {
    console.error('parse-pdf error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/search-client ────────────────────────────────────────────────────
app.get('/api/search-client', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 1) return res.json([]);

    // Search both customers and any partner matching the name
    const partners = await odoo(req,
      'res.partner', 'search_read',
      [[['name', 'ilike', q], ['active', '=', true], ['is_company', 'in', [true, false]]]],
      { fields: ['id', 'name', 'email', 'phone', 'is_company', 'customer_rank'], limit: 10 }
    );
    res.json(partners);
  } catch (err) {
    console.error('search-client error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/create-client ───────────────────────────────────────────────────
app.post('/api/create-client', requireAuth, async (req, res) => {
  try {
    const { name, email, phone, isCompany, rut } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es obligatorio.' });

    const data = {
      name: name.trim(),
      customer_rank: 1,
      is_company: Boolean(isCompany),
    };
    if (email) data.email = email.trim();
    if (phone) data.phone = phone.trim();
    if (rut) data.vat = rut.trim();

    const partnerId = await odoo(req, 'res.partner', 'create', [data]);

    const [partner] = await odoo(req,
      'res.partner', 'read',
      [[partnerId]],
      { fields: ['id', 'name', 'email', 'phone', 'is_company'] }
    );

    console.log(`Created partner: ${name} (ID ${partnerId})`);
    res.json(partner);
  } catch (err) {
    console.error('create-client error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/save-to-odoo ────────────────────────────────────────────────────
app.post('/api/save-to-odoo', requireAuth, async (req, res) => {
  try {
    const { clientName, partnerId: existingPartnerId, obra, items } = req.body;

    if (!clientName || !items || !items.length) {
      return res.status(400).json({ error: 'Nombre de cliente e ítems son obligatorios.' });
    }

    // 1. Resolve partner
    let partnerId = existingPartnerId;
    if (!partnerId) {
      const found = await odoo(req, 'res.partner', 'search_read',
        [[['name', '=', clientName]]],
        { fields: ['id'], limit: 1 }
      );
      if (found.length) {
        partnerId = found[0].id;
      } else {
        partnerId = await odoo(req, 'res.partner', 'create', [{
          name: clientName, customer_rank: 1,
        }]);
        console.log(`Auto-created partner: ${clientName} (ID ${partnerId})`);
      }
    }

    // 2. Resolve matching product variants starting with "Ventana 2 hojas correderas PVC"
    let resolvedProducts = [];
    try {
      console.log(`Resolving Odoo variants starting with 'Ventana 2 hojas correderas PVC' to match items...`);
      const variants = await odoo(req, 'product.product', 'search_read',
        [[['name', 'ilike', 'Ventana 2 hojas correderas PVC']]],
        { fields: ['id', 'product_template_attribute_value_ids', 'default_code'] }
      );
      
      const ptavIds = [...new Set(variants.flatMap(v => v.product_template_attribute_value_ids || []))];
      
      let ptavMap = {};
      if (ptavIds.length) {
        const ptavDetails = await odoo(req, 'product.template.attribute.value', 'read',
          [ptavIds],
          { fields: ['id', 'name', 'attribute_id'] }
        );
        for (const ptav of ptavDetails) {
          const attrName = ptav.attribute_id[1];
          const valName = ptav.name;
          ptavMap[ptav.id] = { attrName, valName };
        }
      }
      
      for (const item of items) {
        let matchedId = null;
        for (const variant of variants) {
          const attrs = {};
          for (const ptavId of (variant.product_template_attribute_value_ids || [])) {
            const detail = ptavMap[ptavId];
            if (detail) {
              attrs[detail.attrName.toLowerCase()] = detail.valName;
            }
          }
          
          const varAncho = parseInt(attrs.ancho || 0, 10);
          const varAlto = parseInt(attrs.alto || 0, 10);
          const varColor = attrs.color || '';
          const varVidrio = attrs.vidrio || '';
          
          if (
            varAncho === item.ancho &&
            varAlto === item.alto &&
            varColor.toLowerCase() === item.color.toLowerCase() &&
            varVidrio.toLowerCase() === item.vidrio.toLowerCase()
          ) {
            matchedId = variant.id;
            break;
          }
        }
        resolvedProducts.push({
          item,
          productId: matchedId || GENERIC_PRODUCT_ID,
          matched: !!matchedId
        });
      }
    } catch (err) {
      console.warn('Failed to resolve custom product variants from Odoo. Falling back to generic product:', err.message);
      resolvedProducts = items.map(item => ({
        item,
        productId: GENERIC_PRODUCT_ID,
        matched: false
      }));
    }

    // 3. Create order lines
    const orderLines = resolvedProducts.map(resolved => [0, 0, {
      product_id: resolved.productId,
      name: `[${resolved.item.pos}] ${resolved.item.desc} | ${resolved.item.vidrio} | ${resolved.item.color}`,
      product_uom_qty: resolved.item.qty,
      price_unit: resolved.item.price,
    }]);

    // 4. Note
    const noteLines = [];
    if (obra) noteLines.push(`📍 Obra: ${obra}`);
    noteLines.push('\nDetalle de ítems:');
    items.forEach(i => noteLines.push(`• ${i.pos} – ${i.ancho}×${i.alto}mm | ${i.tipo} | ${i.vidrio} | ${i.color}`));
    const note = noteLines.join('\n');

    // 5. Create sale.order
    const orderId = await odoo(req, 'sale.order', 'create', [{
      partner_id: partnerId,
      note,
      order_line: orderLines,
      client_order_ref: obra || false,
    }]);
    console.log(`Created sale.order ID ${orderId}`);

    const [orderRec] = await odoo(req, 'sale.order', 'read', [[orderId]], { fields: ['name', 'amount_total'] });

    // 6. Confirm
    await odoo(req, 'sale.order', 'action_confirm', [[orderId]]);
    console.log(`Confirmed order ${orderRec.name}`);

    // 7. Find work center
    let workcenterName = 'Taller Armado PVC';
    try {
      const wcs = await odoo(req, 'mrp.workcenter', 'search_read', [[['name', 'ilike', 'PVC']]], { fields: ['id', 'name'], limit: 1 });
      if (wcs.length) workcenterName = wcs[0].name;
    } catch { /* mrp may not be installed */ }

    // 8. Create MOs
    const moIds = [];
    try {
      const srcLocs = await odoo(req, 'stock.location', 'search_read', [[['usage', '=', 'internal']]], { fields: ['id'], limit: 1 });
      const prodLocs = await odoo(req, 'stock.location', 'search_read', [[['usage', '=', 'production']]], { fields: ['id'], limit: 1 });

      for (const resolved of resolvedProducts) {
        const item = resolved.item;
        const moData = {
          product_id: resolved.productId,
          product_qty: item.qty,
          origin: orderRec.name,
          product_description_variants: `[${item.pos}] ${item.ancho}×${item.alto}mm | ${item.tipo} | ${item.vidrio} | ${item.color}`,
        };
        if (srcLocs.length) moData.location_src_id = srcLocs[0].id;
        if (prodLocs.length) moData.location_dest_id = prodLocs[0].id;
        const moId = await odoo(req, 'mrp.production', 'create', [moData]);
        moIds.push(moId);
        console.log(`Created MO ${moId} for ${item.pos}`);
      }
    } catch (e) {
      console.warn('MO creation skipped:', e.message);
    }

    res.json({
      success: true, orderId,
      orderName: orderRec.name,
      orderTotal: orderRec.amount_total,
      moCount: moIds.length,
      workcenterName,
      orderUrl: `https://${ODOO_HOST}/odoo/sales/${orderId}`,
    });
  } catch (err) {
    console.error('save-to-odoo error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🪟 Cotizador Ventanas PVC → http://localhost:${PORT}\n`);
});
