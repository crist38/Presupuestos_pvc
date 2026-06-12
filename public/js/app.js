// ── State ───────────────────────────────────────────────────────────────────
let parsedItems = [];
let pdfPageCount = 0;
let selectedPartnerId = null;
let isSaving = false;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const dropZone       = document.getElementById('dropZone');
const fileInput      = document.getElementById('fileInput');
const fileChip       = document.getElementById('fileChip');
const fileNameText   = document.getElementById('fileNameText');
const progressWrap   = document.getElementById('progressWrap');
const progressBar    = document.getElementById('progressBar');
const progressLabel  = document.getElementById('progressLabel');
const progressPct    = document.getElementById('progressPct');
const emptyState     = document.getElementById('emptyState');
const tableWrap      = document.getElementById('tableWrap');
const tableFooter    = document.getElementById('tableFooter');
const itemsBody      = document.getElementById('itemsBody');
const itemBadge      = document.getElementById('itemBadge');
const saveBtn        = document.getElementById('saveBtn');
const saveBtnText    = document.getElementById('saveBtnText');
const saveBtnSpinner = document.getElementById('saveBtnSpinner');
const clientNameEl   = document.getElementById('clientName');
const obraEl         = document.getElementById('obraName');
const suggestionsEl  = document.getElementById('clientSuggestions');
const statsEl        = document.getElementById('stats');
const statItems      = document.getElementById('statItems');
const statTotal      = document.getElementById('statTotal');
const odooStatus     = document.getElementById('odooStatus');

// ── Formatters ───────────────────────────────────────────────────────────────
function fmtCLP(n) {
  return '$' + Math.round(n).toLocaleString('es-CL');
}

function typeBadge(tipo) {
  const map = {
    Corredera:  'bg-blue-500/15 text-blue-400 border-blue-500/25',
    Fijo:       'bg-slate-500/15 text-slate-400 border-slate-500/25',
    Practicable:'bg-purple-500/15 text-purple-400 border-purple-500/25',
  };
  return `<span class="px-2 py-0.5 rounded-full text-xs font-medium border ${map[tipo] || 'bg-slate-500/15 text-slate-400 border-slate-500/25'}">${tipo}</span>`;
}

// ── Drag & drop ───────────────────────────────────────────────────────────────
['dragenter','dragover'].forEach(evt =>
  dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('drag-over'); })
);
['dragleave','dragend','drop'].forEach(evt =>
  dropZone.addEventListener(evt, () => dropZone.classList.remove('drag-over'))
);

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file && file.type === 'application/pdf') handleFile(file);
  else showToast('error', 'Archivo inválido', 'Solo se aceptan archivos PDF.');
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

dropZone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') fileInput.click();
});

// ── Handle file upload ────────────────────────────────────────────────────────
async function handleFile(file) {
  // Show filename chip
  fileNameText.textContent = file.name;
  fileChip.classList.remove('hidden');

  // Show progress
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressBar.style.animation = 'none';
  progressLabel.textContent = 'Procesando PDF...';
  progressPct.textContent = '…';

  // Animate progress bar
  void progressBar.offsetWidth; // reflow
  progressBar.style.animation = 'progress 4s ease forwards';

  // Build form data
  const formData = new FormData();
  formData.append('pdf', file);

  try {
    const res = await fetch('/api/parse-pdf', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Error desconocido');

    parsedItems = data.items;
    pdfPageCount = data.pageCount;

    progressBar.style.width = '100%';
    progressLabel.textContent = '¡Listo!';
    progressPct.textContent = `${parsedItems.length} ítems`;

    renderTable(parsedItems, data.total);
    updateStats(parsedItems, data.total);
    checkSaveReady();

    showToast('success', 'PDF procesado', `Se encontraron ${parsedItems.length} ítems de ventana.`);

    setTimeout(() => progressWrap.classList.add('hidden'), 2500);
  } catch (err) {
    progressBar.style.animation = 'none';
    progressBar.style.width = '100%';
    progressBar.style.background = '#ef4444';
    progressLabel.textContent = 'Error al procesar';
    progressPct.textContent = '';
    showToast('error', 'Error al leer el PDF', err.message);
    setTimeout(() => progressWrap.classList.add('hidden'), 3000);
  }
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable(items, total) {
  if (!items.length) {
    emptyState.classList.remove('hidden');
    tableWrap.classList.add('hidden');
    tableFooter.classList.add('hidden');
    itemBadge.classList.add('hidden');
    return;
  }

  itemsBody.innerHTML = items.map(item => `
    <tr class="item-row">
      <td class="px-4 py-3">
        <span class="font-bold text-green-400">${item.pos}</span>
      </td>
      <td class="px-4 py-3">${typeBadge(item.tipo)}</td>
      <td class="px-4 py-3">
        <span class="font-mono text-slate-200">${item.ancho} × ${item.alto}</span>
        <span class="text-slate-600 text-xs ml-1">mm</span>
      </td>
      <td class="px-4 py-3">
        <span class="text-slate-300 text-xs">${item.vidrio}</span>
      </td>
      <td class="px-4 py-3">
        <span class="text-slate-300 text-xs">${item.color}</span>
      </td>
      <td class="px-4 py-3 text-center">
        <span class="text-slate-200">${item.qty}</span>
      </td>
      <td class="px-4 py-3 text-right">
        <span class="text-slate-300">${fmtCLP(item.price)}</span>
      </td>
      <td class="px-4 py-3 text-right">
        <span class="text-white font-semibold">${fmtCLP(item.price * item.qty)}</span>
      </td>
    </tr>
  `).join('');

  emptyState.classList.add('hidden');
  tableWrap.classList.remove('hidden');
  tableFooter.classList.remove('hidden');

  // Badge
  itemBadge.textContent = `${items.length} ítems`;
  itemBadge.classList.remove('hidden');
  itemBadge.style.animation = 'none';
  void itemBadge.offsetWidth;
  itemBadge.style.animation = '';
  itemBadge.classList.add('badge-pop');

  // Footer
  document.getElementById('footerItems').textContent = items.length;
  document.getElementById('footerPages').textContent = pdfPageCount;
  document.getElementById('footerTotal').textContent = fmtCLP(total);
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats(items, total) {
  statsEl.classList.remove('hidden');
  statItems.textContent = items.length;
  statTotal.textContent = fmtCLP(total);
}

// ── Client autocomplete ───────────────────────────────────────────────────────
let debounceTimer = null;

clientNameEl.addEventListener('input', () => {
  selectedPartnerId = null;
  checkSaveReady();

  clearTimeout(debounceTimer);
  const q = clientNameEl.value.trim();
  if (q.length < 2) { hideSuggestions(); return; }

  debounceTimer = setTimeout(() => fetchSuggestions(q), 320);
});

clientNameEl.addEventListener('blur', () => {
  setTimeout(hideSuggestions, 200);
});

async function fetchSuggestions(q) {
  try {
    const res = await fetch(`/api/search-client?q=${encodeURIComponent(q)}`);
    const partners = await res.json();
    renderSuggestions(partners);
  } catch {
    hideSuggestions();
  }
}

function renderSuggestions(partners) {
  if (!partners.length) { hideSuggestions(); return; }

  suggestionsEl.innerHTML = partners.map(p => `
    <li
      class="px-4 py-2.5 flex items-center gap-2.5 cursor-pointer hover:bg-white/5 transition"
      data-id="${p.id}"
      data-name="${p.name}"
    >
      <div class="w-7 h-7 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center flex-shrink-0">
        <svg class="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0"/>
        </svg>
      </div>
      <div>
        <div class="text-sm text-slate-200 font-medium">${p.name}</div>
        ${p.email ? `<div class="text-xs text-slate-500">${p.email}</div>` : ''}
      </div>
    </li>
  `).join('');

  suggestionsEl.querySelectorAll('li').forEach(li => {
    li.addEventListener('mousedown', (e) => {
      // Use mousedown instead of click to fire before input blur
      e.preventDefault();
      selectClient(parseInt(li.dataset.id), li.dataset.name);
    });
  });

  suggestionsEl.classList.remove('hidden');
}

function hideSuggestions() {
  suggestionsEl.classList.add('hidden');
}

function selectClient(id, name) {
  selectedPartnerId = id;
  clientNameEl.value = name;
  document.getElementById('selectedClientName').textContent = name;
  
  // Hide input row and show client chip
  const clientInputRow = clientNameEl.closest('.flex');
  if (clientInputRow) {
    clientInputRow.classList.add('hidden');
  }
  document.getElementById('selectedClientChip').classList.remove('hidden');
  checkSaveReady();
}

// Clear client chip handler
document.getElementById('clearClientChip').addEventListener('click', () => {
  selectedPartnerId = null;
  clientNameEl.value = '';
  document.getElementById('selectedClientChip').classList.add('hidden');
  
  const clientInputRow = clientNameEl.closest('.flex');
  if (clientInputRow) {
    clientInputRow.classList.remove('hidden');
  }
  clientNameEl.focus();
  checkSaveReady();
});

// ── Save button state ──────────────────────────────────────────────────────────
function checkSaveReady() {
  const hasItems = parsedItems.length > 0;
  const hasClient = clientNameEl.value.trim().length > 0;
  saveBtn.disabled = !(hasItems && hasClient) || isSaving;
}

clientNameEl.addEventListener('input', checkSaveReady);

// ── Save to Odoo ───────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', saveToOdoo);

async function saveToOdoo() {
  if (isSaving) return;
  const clientName = clientNameEl.value.trim();
  const obra = obraEl.value.trim();

  if (!clientName) { showToast('error', 'Falta el cliente', 'Ingresa el nombre del cliente.'); return; }
  if (!parsedItems.length) { showToast('error', 'Sin ítems', 'Carga un PDF primero.'); return; }

  isSaving = true;
  saveBtnText.textContent = 'Guardando...';
  saveBtnSpinner.classList.remove('hidden');
  saveBtn.disabled = true;

  // Show progress indicator
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressBar.style.animation = 'none';
  progressBar.style.background = '';
  progressLabel.textContent = 'Creando cotización en Odoo...';
  progressPct.textContent = '…';
  void progressBar.offsetWidth;
  progressBar.style.animation = 'progress 6s ease forwards';

  try {
    const res = await fetch('/api/save-to-odoo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName,
        partnerId: selectedPartnerId || null,
        obra: obra || null,
        items: parsedItems,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar en Odoo');

    progressBar.style.width = '100%';
    progressLabel.textContent = '¡Guardado!';
    progressPct.textContent = data.orderName;

    // Update Odoo status chip
    odooStatus.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-green-500"></span>
      <span class="text-green-400">${data.orderName}</span>
    `;

    // Show success modal
    document.getElementById('resultOrderName').textContent = data.orderName;
    document.getElementById('resultTotal').textContent = fmtCLP(data.orderTotal);
    document.getElementById('resultMoCount').textContent = `${data.moCount} órdenes creadas`;
    document.getElementById('resultOrderUrl').href = data.orderUrl;
    document.getElementById('successModal').classList.remove('hidden');

    setTimeout(() => progressWrap.classList.add('hidden'), 3000);
  } catch (err) {
    progressBar.style.animation = 'none';
    progressBar.style.width = '100%';
    progressBar.style.background = '#ef4444';
    progressLabel.textContent = 'Error';
    progressPct.textContent = '';
    showToast('error', 'Error al guardar', err.message);
    setTimeout(() => progressWrap.classList.add('hidden'), 3000);
  } finally {
    isSaving = false;
    saveBtnText.textContent = 'Guardar en Odoo';
    saveBtnSpinner.classList.add('hidden');
    checkSaveReady();
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(type, title, msg) {
  const icon = document.getElementById('toastIcon');
  const titleEl = document.getElementById('toastTitle');
  const msgEl = document.getElementById('toastMsg');
  const toast = document.getElementById('toast');

  titleEl.textContent = title;
  msgEl.textContent = msg;

  if (type === 'success') {
    icon.innerHTML = `<svg class="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>`;
    icon.className = 'flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5 bg-green-500/15 border border-green-500/25';
  } else {
    icon.innerHTML = `<svg class="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>`;
    icon.className = 'flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5 bg-red-500/15 border border-red-500/25';
  }

  toast.classList.remove('hide');
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  const toast = document.getElementById('toast');
  toast.classList.remove('show');
  toast.classList.add('hide');
}

// ── Modals & Add Client logic ─────────────────────────────────────────────────
const newClientModal = document.getElementById('newClientModal');
let clientIsCompany = false;

window.setClientType = function(isCompany) {
  clientIsCompany = isCompany;
  const personaBtn = document.getElementById('typePersona');
  const empresaBtn = document.getElementById('typeEmpresa');
  if (isCompany) {
    personaBtn.className = 'px-4 py-2 font-medium transition text-slate-400 hover:bg-slate-700/50';
    empresaBtn.className = 'px-4 py-2 font-medium transition bg-green-600 text-white';
  } else {
    personaBtn.className = 'px-4 py-2 font-medium transition bg-green-600 text-white';
    empresaBtn.className = 'px-4 py-2 font-medium transition text-slate-400 hover:bg-slate-700/50';
  }
};

// Open Client modal click listener
document.getElementById('newClientBtn').addEventListener('click', () => {
  document.getElementById('nc_name').value = '';
  document.getElementById('nc_email').value = '';
  document.getElementById('nc_phone').value = '';
  document.getElementById('nc_rut').value = '';
  document.getElementById('ncError').classList.add('hidden');
  window.setClientType(false);
  newClientModal.classList.remove('hidden');
});

window.closeNewClientModal = function() {
  newClientModal.classList.add('hidden');
};

window.saveNewClient = async function() {
  const name = document.getElementById('nc_name').value.trim();
  const email = document.getElementById('nc_email').value.trim();
  const phone = document.getElementById('nc_phone').value.trim();
  const rut = document.getElementById('nc_rut').value.trim();
  const errorEl = document.getElementById('ncError');

  if (!name) {
    errorEl.textContent = 'El nombre es obligatorio.';
    errorEl.classList.remove('hidden');
    return;
  }

  const saveBtnEl = document.getElementById('saveNewClientBtn');
  const spinnerEl = document.getElementById('saveNewClientSpinner');
  const textEl = document.getElementById('saveNewClientText');

  saveBtnEl.disabled = true;
  spinnerEl.classList.remove('hidden');
  textEl.textContent = 'Guardando...';
  errorEl.classList.add('hidden');

  try {
    const res = await fetch('/api/create-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, rut, isCompany: clientIsCompany }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al crear el cliente');

    selectClient(data.id, data.name);
    window.closeNewClientModal();
    showToast('success', 'Cliente creado', `Se ha creado y seleccionado a ${data.name}.`);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    saveBtnEl.disabled = false;
    spinnerEl.classList.add('hidden');
    textEl.textContent = 'Crear cliente';
  }
};

window.closeSuccessModal = function() {
  document.getElementById('successModal').classList.add('hidden');
};

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    window.closeSuccessModal();
    window.closeNewClientModal();
  }
});

// ── Auth Handling & Session ──────────────────────────────────────────────────
const loginScreen = document.getElementById('loginScreen');
const appScreen = document.getElementById('appScreen');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginCard = document.getElementById('loginCard');
const loginError = document.getElementById('loginError');
const loginErrorText = document.getElementById('loginErrorText');
const loginBtn = document.getElementById('loginBtn');
const loginBtnText = document.getElementById('loginBtnText');
const loginSpinner = document.getElementById('loginSpinner');
const togglePwd = document.getElementById('togglePwd');
const eyeIcon = document.getElementById('eyeIcon');
const userMenuBtn = document.getElementById('userMenuBtn');
const userMenu = document.getElementById('userMenu');
const logoutBtn = document.getElementById('logoutBtn');

// Toggle Password visibility
togglePwd.addEventListener('click', () => {
  const isPwd = loginPassword.type === 'password';
  loginPassword.type = isPwd ? 'text' : 'password';
  if (isPwd) {
    eyeIcon.innerHTML = `
      <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>
    `;
  } else {
    eyeIcon.innerHTML = `
      <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    `;
  }
});

// Dropdown user menu toggling
userMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  userMenu.classList.toggle('hidden');
});
document.addEventListener('click', () => userMenu.classList.add('hidden'));

// Login form submission
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email || !password) {
    loginErrorText.textContent = 'Ingresa tu email y contraseña.';
    loginError.classList.remove('hidden');
    loginCard.classList.add('shake');
    setTimeout(() => loginCard.classList.remove('shake'), 400);
    return;
  }

  loginError.classList.add('hidden');
  loginBtn.disabled = true;
  loginSpinner.classList.remove('hidden');
  loginBtnText.textContent = 'Iniciando sesión...';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Credenciales incorrectas');

    loginPassword.value = '';
    showApp(data);
    showToast('success', 'Sesión iniciada', `Bienvenido, ${data.name}`);
  } catch (err) {
    loginErrorText.textContent = err.message;
    loginError.classList.remove('hidden');
    loginCard.classList.add('shake');
    setTimeout(() => loginCard.classList.remove('shake'), 400);
  } finally {
    loginBtn.disabled = false;
    loginSpinner.classList.add('hidden');
    loginBtnText.textContent = 'Iniciar sesión';
  }
});

// Logout click listener
logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
    showLogin();
    showToast('success', 'Sesión cerrada', 'Has cerrado tu sesión de Odoo.');
  } catch (err) {
    showToast('error', 'Error', 'No se pudo cerrar la sesión.');
  }
});

function showApp(user) {
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');

  // Load avatar or initials
  document.getElementById('userDisplayName').textContent = user.name;
  document.getElementById('menuUserName').textContent = user.name;
  document.getElementById('menuUserEmail').textContent = user.email;
  document.getElementById('userInitial').textContent = user.name.charAt(0).toUpperCase();

  if (user.avatar) {
    document.getElementById('userAvatar').innerHTML = `<img src="data:image/png;base64,${user.avatar}" class="w-full h-full object-cover" />`;
  } else {
    document.getElementById('userAvatar').innerHTML = `<span id="userInitial">${user.name.charAt(0).toUpperCase()}</span>`;
  }

  pingOdoo();
}

function showLogin() {
  appScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

async function pingOdoo() {
  try {
    const res = await fetch('/api/search-client?q=test');
    if (res.ok) {
      odooStatus.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
        <span class="text-green-400">Odoo Conectado</span>
      `;
    } else {
      throw new Error();
    }
  } catch {
    odooStatus.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
      <span class="text-red-400">Odoo Sin sesión</span>
    `;
  }
}

// ── Check session on page load ────────────────────────────────────────────────
(async () => {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const user = await res.json();
      showApp(user);
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
})();

