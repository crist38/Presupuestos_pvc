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
function cleanColor(c) {
  if (!c) return 'Nogal';
  c = c.trim();
  const cLower = c.toLowerCase();
  if (cLower.includes('nogal')) return 'Nogal';
  if (cLower.includes('roble') || cLower.includes('golden')) return 'Roble dorado';
  if (cLower.includes('blanco')) return 'Blanco';
  if (cLower.includes('negro') || cLower.includes('grafito')) return 'Negro';
  return c;
}

function detectFormat(text) {
  if (text.includes("COMPONENTE") && text.includes("DIMENSIONES")) {
    return "format3";
  }
  if (text.includes("Item:V") && text.includes("Unitario:")) {
    return "sodival_cotizacion";
  }
  if (text.includes("Pos.TipoCódigoDimensionesCantidadUnitTotal")) {
    return "format2_roberto_multi";
  }
  if (text.includes("Pos. ") && text.includes("Ancho:") && text.includes("Alto:")) {
    return "format2_gustavo";
  }
  if (text.includes("Medida:") && text.includes("Série:")) {
    return "format2_roberto";
  }
  return "format1";
}

function parseFormat1(text) {
  const lines = text.split('\n');
  const items = [];
  let currentBlock = [];

  for (const line of lines) {
    currentBlock.push(line);

    if (/Pos:\s*(V|PV|P)\d+/i.test(line)) {
      const block = currentBlock.join('\n');
      currentBlock = [];

      const posMatch = block.match(/Pos:\s*((?:V|PV|P)\d+)/i);
      const medMatch = block.match(/(\d[\d.,]*)\s*mm\s*[xX]\s*(\d[\d.,]*)\s*mm/);

      if (!posMatch || !medMatch) continue;

      const pos = posMatch[1];
      const ancho = Math.round(parseFloat(medMatch[1].replace(/\./g, '').replace(',', '.')));
      const alto  = Math.round(parseFloat(medMatch[2].replace(/\./g, '').replace(',', '.')));

      let color = 'Roble dorado';
      const colorMatch = block.match(/Color:\s*([^\n\t]+?)(?:\s{2,}|\t|Unidades:|$)/im);
      if (colorMatch) {
        color = cleanColor(colorMatch[1]);
      }

      let vidrio = '4/9/4 INC';
      const acrMatch = block.match(/Acristalamiento[:\s]+([^\n\r\t]{3,50}?)(?:\s{2,}|\t|Sin|$)/im);
      if (acrMatch) vidrio = acrMatch[1].trim().replace(/\s+/g, ' ');

      let qty = 1;
      const qtyMatch = block.match(/Unidades:\s*(\d+)/i);
      if (qtyMatch) qty = parseInt(qtyMatch[1], 10);

      let price = 0;
      const priceMatches = [...block.matchAll(/\$\s*([\d.,]+)/g)];
      if (priceMatches.length) {
        const raw = priceMatches[priceMatches.length - 1][1].replace(/\./g, '').replace(',', '.');
        price = Math.round(parseFloat(raw));
      }

      const blockLower = block.toLowerCase();
      let tipo = 'Fijo';
      if (blockLower.includes('corrediz') || blockLower.includes('corredera')) tipo = 'Corredera';
      else if (blockLower.includes('practicable') || blockLower.includes('batiente') || blockLower.includes('proyectante')) tipo = 'Practicable';

      let desc = `Ventana ${tipo} ${ancho}x${alto}mm`;
      const descLine = block.split('\n').find(l => l.match(/(LINEA|Ventana|ECOLIFE|Efficient|Advance|Puerta)/i));
      if (descLine) desc = descLine.trim();

      items.push({ pos, ancho, alto, color, vidrio, qty, price, tipo, desc });
    }
  }

  return items;
}

function parseFormat2Gustavo(text) {
  const items = [];
  const matches = [...text.matchAll(/Pos\.\s*(\d+)(?:\s*-\s*([A-Za-z0-9_,-]+?)(?:Importe|Total|\s|$))?/ig)];
  const blocks = [];
  
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = (i + 1 < matches.length) ? matches[i+1].index : text.length;
    blocks.push({
      posNum: matches[i][1],
      posCode: matches[i][2] || `V${matches[i][1]}`,
      block: text.slice(start, end)
    });
  }

  for (const itemBlock of blocks) {
    const block = itemBlock.block;
    const medMatch = block.match(/Ancho:\s*([\d.,]+)[\s\r\n-]*Alto:\s*([\d.,]+)/i);
    if (!medMatch) continue;

    const ancho = parseInt(medMatch[1].replace(/\./g, ''), 10);
    const alto = parseInt(medMatch[2].replace(/\./g, ''), 10);

    let color = 'Nogal';
    const colorMatch = block.match(/Color:\s*([A-Za-z\s-]+?)(?:Ancho:|$)/i);
    if (colorMatch) {
      color = cleanColor(colorMatch[1]);
    } else {
      const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const colorIdx = lines.findIndex(l => l.includes('Color:'));
      if (colorIdx !== -1 && colorIdx + 1 < lines.length) {
        color = cleanColor(lines[colorIdx + 1]);
      }
    }

    let vidrio = '4/9/4 INC';
    const glassMatch = block.match(/Vidrios\s*\n([^\n]+)/);
    if (glassMatch) {
      vidrio = glassMatch[1].trim();
      if (vidrio.includes(' -')) {
        vidrio = vidrio.split(' -')[0].trim();
      }
    } else {
      const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      for (const line of lines) {
        if (line.toLowerCase().includes('dvh') || line.toLowerCase().includes('vidrio') || line.match(/\d\+\d\+\d/)) {
          vidrio = line;
          break;
        }
      }
    }

    let qty = 1;
    const qtyMatch = block.match(/UDS:\s*(\d+)/i);
    if (qtyMatch) qty = parseInt(qtyMatch[1], 10);

    let price = 0;
    const priceLines = block.split('\n');
    for (let idx = 0; idx < priceLines.length; idx++) {
      if (priceLines[idx].includes('UDS:')) {
        for (let k = idx + 1; k < priceLines.length; k++) {
          const candidate = priceLines[k].replace(/\./g, '').trim();
          if (/^\d+$/.test(candidate)) {
            price = parseInt(candidate, 10);
            break;
          }
        }
        break;
      }
    }

    let tipo = 'Fijo';
    const blockLower = block.toLowerCase();
    if (blockLower.includes('corrediz') || blockLower.includes('corredera')) tipo = 'Corredera';
    else if (blockLower.includes('practicable') || blockLower.includes('batiente') || blockLower.includes('proyectante')) tipo = 'Practicable';

    const desc = `Ventana ${tipo} ${ancho}x${alto}mm`;

    items.push({
      pos: itemBlock.posCode,
      ancho,
      alto,
      color,
      vidrio,
      qty,
      price,
      tipo,
      desc
    });
  }

  return items;
}

function parseFormat2Roberto(text) {
  const items = [];
  const colorMatch = text.match(/Color:\s*([A-Za-z0-9\s-]+?)(?:\s*Medida:|$)/i);
  let color = 'Nogal';
  if (colorMatch) {
    color = cleanColor(colorMatch[1]);
  }

  const medMatch = text.match(/Medida:\s*([\d.,]+)\s*[xX]\s*([\d.,]+)/);
  if (!medMatch) return [];

  const ancho = parseInt(medMatch[1].replace(/\./g, ''), 10);
  const alto = parseInt(medMatch[2].replace(/\./g, ''), 10);

  let vidrio = '4/9/4 INC';
  const glassMatch = text.match(/Superficies:\s*([^\n]+)/);
  if (glassMatch) {
    vidrio = glassMatch[1].trim();
    if (vidrio.includes(' -')) {
      vidrio = vidrio.split(' -')[0].trim();
    }
  }

  let qty = 1;
  let price = 0;
  const priceMatch = text.match(/V1(\d+)\$\s*([\d.]+)/);
  if (priceMatch) {
    qty = parseInt(priceMatch[1], 10);
    price = parseInt(priceMatch[2].replace(/\./g, ''), 10);
  }

  let tipo = 'Fijo';
  if (text.toLowerCase().includes('corredera') || text.toLowerCase().includes('corrediza')) tipo = 'Corredera';
  
  items.push({
    pos: 'V1',
    ancho,
    alto,
    color,
    vidrio,
    qty,
    price,
    tipo,
    desc: `Ventana ${tipo} ${ancho}x${alto}mm`
  });

  return items;
}

function parseFormat2RobertoMulti(text) {
  const items = [];
  const matches = [...text.matchAll(/^\s*(\d+)(V\d+|PV\d+|P\d+)/gm)];
  const blocks = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = (i + 1 < matches.length) ? matches[i+1].index : text.length;
    blocks.push({
      pos: matches[i][2],
      block: text.slice(start, end)
    });
  }

  for (const itemBlock of blocks) {
    const block = itemBlock.block;
    const lMatch = block.match(/L\s*=\s*([\d.]+)/i);
    const aMatch = block.match(/A\s*=\s*([\d.]+)/i);
    if (!lMatch || !aMatch) continue;

    const ancho = parseInt(lMatch[1].replace(/\./g, ''), 10);
    const alto  = parseInt(aMatch[1].replace(/\./g, ''), 10);

    let color = 'Nogal';
    const colorMatch = block.match(/Color:\s*([^\n\r]+)/i);
    if (colorMatch) {
      color = cleanColor(colorMatch[1]);
    }

    let vidrio = '4/9/4 INC';
    const glassMatch = block.match(/Vidrio\(s\):\s*([^\n\r]+)/i);
    if (glassMatch) {
      vidrio = glassMatch[1].trim();
      if (vidrio.includes(' -')) {
        vidrio = vidrio.split(' -')[0].trim();
      }
    }

    const firstLine = block.split('\n')[0];
    let qty = 1;
    const qtyMatch = firstLine.match(/(\d+)\s*Ch\$/i);
    if (qtyMatch) {
      qty = parseInt(qtyMatch[1], 10);
    }

    let price = 0;
    const priceMatch = block.match(/Total\s+Item:\s*\n\s*Ch\$\s*([\d.]+)/i);
    if (priceMatch) {
      price = parseInt(priceMatch[1].replace(/\./g, ''), 10);
    } else {
      const firstLinePrices = [...firstLine.matchAll(/Ch\$\s*([\d.,]+)/gi)];
      if (firstLinePrices.length) {
        price = parseInt(firstLinePrices[0][1].replace(/\./g, '').replace(/,/g, ''), 10);
      }
    }

    let tipo = 'Fijo';
    const descMatch = block.match(/Descripción:\s*([^\n\r]+)/i);
    const desc = descMatch ? descMatch[1].trim() : `Ventana ${ancho}x${alto}mm`;
    if (desc.toLowerCase().includes('corredera') || desc.toLowerCase().includes('corrediza')) tipo = 'Corredera';
    else if (desc.toLowerCase().includes('proyectante') || desc.toLowerCase().includes('abatible') || desc.toLowerCase().includes('batiente')) tipo = 'Practicable';

    items.push({
      pos: itemBlock.pos,
      ancho,
      alto,
      color,
      vidrio,
      qty,
      price: Math.round(price / qty),
      tipo,
      desc
    });
  }

  return items;
}

function parseFormat3(text) {
  const items = [];
  const matches = [...text.matchAll(/COMPONENTE[\s\r\n]*:[\s\r\n]*(V\d+|PV\d+|P\d+)/ig)];
  const blocks = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = (i + 1 < matches.length) ? matches[i+1].index : text.length;
    blocks.push({
      pos: matches[i][1],
      block: text.slice(start, end)
    });
  }

  for (const itemBlock of blocks) {
    const block = itemBlock.block;
    const medMatch = block.match(/DIMENSIONES[\s\r\n]*:[\s\r\n]*(\d+)\s*mm\s*x\s*(\d+)\s*mm/i);
    if (!medMatch) continue;

    const ancho = parseInt(medMatch[1], 10);
    const alto = parseInt(medMatch[2], 10);

    let qty = 1;
    const qtyMatch = block.match(/CANTIDAD[\s\r\n]*:[\s\r\n]*(\d+)/i);
    if (qtyMatch) qty = parseInt(qtyMatch[1], 10);

    let color = 'Nogal';
    const colorMatch = block.match(/COLOR[\s\r\n]*:[\s\r\n]*([^\n\r]+)/i);
    if (colorMatch) {
      color = cleanColor(colorMatch[1]);
    }

    let vidrio = '4/9/4 INC';
    const glassMatch = block.match(/VIDRIOS[\s\r\n]*:[\s\r\n]*([^\n\r]+)/i);
    if (glassMatch) {
      vidrio = glassMatch[1].trim();
      if (vidrio.includes(' -')) {
        vidrio = vidrio.split(' -')[0].trim();
      }
    }

    let price = 0;
    const priceMatch = block.match(/PRECIO UNITARIO[\s\r\n]*\$([\d.]+)/i);
    if (priceMatch) {
      price = parseInt(priceMatch[1].replace(/\./g, ''), 10);
    }

    let tipo = 'Fijo';
    const lineMatch = block.match(/LÍNEA[\s\r\n]*:[\s\r\n]*([^\n\r]+)/i);
    const lineName = lineMatch ? lineMatch[1].toLowerCase() : '';
    if (lineName.includes('corredera') || lineName.includes('corrediza') || block.toLowerCase().includes('corredera')) tipo = 'Corredera';

    items.push({
      pos: itemBlock.pos,
      ancho,
      alto,
      color,
      vidrio,
      qty,
      price,
      tipo,
      desc: `Ventana ${tipo} ${ancho}x${alto}mm`
    });
  }

  return items;
}

function parseSodivalCotizacion(text) {
  const items = [];
  const matches = [...text.matchAll(/Item\s*:\s*(V\d+|PV\d+|P\d+)/ig)];
  const blocks = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = (i + 1 < matches.length) ? matches[i+1].index : text.length;
    blocks.push({
      pos: matches[i][1],
      block: text.slice(start, end)
    });
  }

  for (const itemBlock of blocks) {
    const block = itemBlock.block;
    const medMatch = block.match(/Ancho\s*:\s*([\d.,]+)\s*mm/i);
    const altoMatch = block.match(/Alto\s*:\s*([\d.,]+)\s*mm/i);
    if (!medMatch || !altoMatch) continue;

    const ancho = Math.round(parseFloat(medMatch[1].replace(/\./g, '').replace(',', '.')));
    const alto  = Math.round(parseFloat(altoMatch[1].replace(/\./g, '').replace(',', '.')));

    let qty = 1;
    const qtyMatch = block.match(/Unidades\s*:\s*(\d+)/i);
    if (qtyMatch) qty = parseInt(qtyMatch[1], 10);

    let color = 'Nogal';
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      if (line.toLowerCase().includes('nogal') || line.toLowerCase().includes('roble') || line.toLowerCase().includes('blanco')) {
        color = cleanColor(line);
        break;
      }
    }

    let vidrio = '4/9/4 INC';
    for (const line of lines) {
      if (line.toLowerCase().includes('dvh') || line.toLowerCase().includes('vidrio') || line.match(/\d\+\d\+\d/)) {
        vidrio = line;
        break;
      }
    }

    let price = 0;
    const priceMatch = block.match(/\$\s*Unitario\s*:\s*\$\s*([\d.]+)/i);
    if (priceMatch) {
      price = parseInt(priceMatch[1].replace(/\./g, ''), 10);
    }

    let tipo = 'Fijo';
    if (block.toLowerCase().includes('corredera') || block.toLowerCase().includes('corrediza')) tipo = 'Corredera';
    else if (block.toLowerCase().includes('proyectante') || block.toLowerCase().includes('abatible') || block.toLowerCase().includes('batiente')) tipo = 'Practicable';

    items.push({
      pos: itemBlock.pos,
      ancho,
      alto,
      color,
      vidrio,
      qty,
      price,
      tipo,
      desc: `Ventana ${tipo} ${ancho}x${alto}mm`
    });
  }

  return items;
}

function parsePdfText(text) {
  const format = detectFormat(text);
  console.log(`Detected PDF format type: ${format}`);
  if (format === 'format3') {
    return parseFormat3(text);
  } else if (format === 'sodival_cotizacion') {
    return parseSodivalCotizacion(text);
  } else if (format === 'format2_roberto_multi') {
    return parseFormat2RobertoMulti(text);
  } else if (format === 'format2_gustavo') {
    return parseFormat2Gustavo(text);
  } else if (format === 'format2_roberto') {
    return parseFormat2Roberto(text);
  } else {
    return parseFormat1(text);
  }
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
    let workcenterId = 4; // Default to ID 4 (Taller Corte Armado PVC)
    let workcenterName = 'Taller Corte Armado PVC';
    try {
      const wcs = await odoo(req, 'mrp.workcenter', 'search_read', [[['name', 'ilike', 'Corte Armado PVC']]], { fields: ['id', 'name'], limit: 1 });
      if (wcs.length) {
        workcenterId = wcs[0].id;
        workcenterName = wcs[0].name;
      }
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
        
        // Create the MO
        const moId = await odoo(req, 'mrp.production', 'create', [moData]);
        moIds.push(moId);
        console.log(`Created MO ${moId} for ${item.pos}`);

        // Create a custom Work Order for Taller Corte Armado PVC
        const woName = `[${item.pos}] ${clientName} | Corte Armado PVC | ${item.ancho} x ${item.alto} mm | ${item.color} | ${item.tipo}`;
        const woData = {
          name: woName,
          production_id: moId,
          workcenter_id: workcenterId,
          x_studio_cliente: clientName,
        };
        const woId = await odoo(req, 'mrp.workorder', 'create', [woData]);
        console.log(`Created Work Order ${woId} for MO ${moId}`);

        // Confirm MO (transitions state to confirmed)
        await odoo(req, 'mrp.production', 'action_confirm', [[moId]]);
        console.log(`Confirmed MO ${moId}`);

        // Plan MO (allocates calendar schedule and dates for the work order)
        await odoo(req, 'mrp.production', 'button_plan', [[moId]]);
        console.log(`Planned MO ${moId}`);
      }
    } catch (e) {
      console.warn('MO creation/planning skipped:', e.message);
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
