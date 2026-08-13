# Cotizador de Ventanas PVC & Sincronizador Odoo

Aplicación web y suite de herramientas construida en **Node.js** y **Tailwind CSS** para procesar cotizaciones de ventanas PVC en formato PDF de diversas marcas, extraer automáticamente sus ítems y guardarlos en **Odoo** como presupuestos de venta (Sales Quotations) y órdenes de fabricación de taller.

---

## 🚀 Características Clave

1. **Lector Multiformato de PDFs (99.9% de precisión)**
   - Detecta dinámicamente la marca y distribución de la cotización cargada.
   - Soporta y extrae medidas (ancho, alto), colores, vidrios, cantidades, precios y tipologías (corredizas, practicables, paños fijos) de los siguientes formatos:
     - **Format 1**: Prowindows y Muchtek (incluye puertas `P` y `PV`).
     - **Format 2 (Gustavo)**: Veka y DVP (etiquetas de posición variables, dimensiones en múltiples líneas).
     - **Format 2 (Roberto)**: Kömmerling de un solo ítem.
     - **Format 2 (Roberto Multi-Ítem)**: Kömmerling con tablas segmentadas por páginas.
     - **Format 3**: Winhause y Sodival.
     - **Sodival Cotización**: Formato propio de Sodival con desglose lineal.

2. **Compresión Automática de PDFs (Anti error 413)**
   - Compresión en el **navegador** (frontend) usando `pdf-lib` antes de enviar el PDF al servidor.
   - PDFs mayores a 3 MB se reescriben con `useObjectStreams: true`, eliminando objetos duplicados y metadata innecesaria.
   - Compresión adicional en el **servidor** (backend) como segunda capa de seguridad.
   - Fallback automático: si la compresión falla, se usa el PDF original sin interrumpir el flujo.
   - Evita el error `413 Request Entity Too Large` tanto en Vercel (límite 4.5 MB) como en Odoo.

3. **Particionado Dinámico de Variantes (Límite Odoo)**
   - Duplica el producto plantilla base (`Ventana 2 hojas correderas PVC`) para cada cliente o cotización.
   - Calcula el producto cartesiano de atributos únicos. Si excede el límite de Odoo de 1,000 variantes, particiona automáticamente en sub-plantillas (`CLIENTE A`, `CLIENTE B`) para evitar caídas del servidor.

4. **Integración con Órdenes de Fabricación (MRP)**
   - Al guardar la cotización, vincula cada línea del pedido a la variante exacta generada en Odoo.
   - Crea automáticamente Órdenes de Fabricación (MOs) por ítem asignadas al centro de trabajo `Taller Armado PVC`.

5. **Tema Claro / Oscuro**
   - Selector de tema integrado en el login y en el panel de trabajo.
   - Persistencia mediante `localStorage`. Carga síncrona en `<head>` para evitar parpadeos.

6. **Autocompletado de Clientes**
   - Búsqueda en tiempo real de clientes existentes en Odoo mediante XML-RPC.
   - Modal de creación rápida de nuevos clientes (Persona o Empresa).

---

## 🛠️ Tecnologías Utilizadas

| Capa | Tecnologías |
|------|-------------|
| **Backend** | Node.js, Express, `xmlrpc`, `multer`, `pdf-parse`, `pdf-lib`, `express-session` |
| **Frontend** | HTML5, Tailwind CSS (CDN), Vanilla JavaScript, `pdf-lib` (CDN) |
| **Despliegue** | Vercel |
| **Scripts CLI** | Python 3, `xmlrpc.client`, `pypdf` |

---

## 📁 Estructura del Proyecto

```bash
├── pdfs/                        # Cotizaciones de prueba ordenadas por marca
├── public/                      # Archivos estáticos del frontend
│   ├── index.html               # Página principal (Light/Dark, pdf-lib CDN)
│   ├── logo.png                 # Logotipo corporativo Prowindows
│   └── js/
│       └── app.js               # Lógica frontend: carga, compresión PDF, autocompletado
├── server.js                    # Servidor Express, endpoints REST, helpers Odoo XML-RPC
├── sync_all_pdfs_to_odoo.py     # Script de sincronización masiva CLI (Python)
├── sync_pdf_to_odoo.py          # Script de sincronización individual CLI (Python)
├── package.json                 # Dependencias Node.js
└── README.md                    # Documentación del proyecto
```

---

## ⚙️ Instalación y Configuración

### Requisitos Previos
- Node.js v16 o superior
- Conexión a internet (Odoo en `prowindows-ltda.odoo.com`)

### Instalación

```bash
npm install
```

### Configuración de Odoo

La instancia y base de datos se configuran en `server.js`:

```js
const ODOO_HOST = 'prowindows-ltda.odoo.com';
const ODOO_DB   = 'prowindows-ltda';
```

> Las credenciales (email y contraseña) se ingresan de forma segura desde la interfaz web al iniciar sesión.

---

## 🎮 Ejecución Local

```bash
# Modo desarrollo (con recarga automática)
npm run dev

# Modo producción
npm start
```

El servidor se levanta en el puerto **3000**:
👉 [http://localhost:3000](http://localhost:3000)

---

## ☁️ Despliegue en Vercel

El proyecto se despliega automáticamente en Vercel al hacer `git push` a la rama `main`.

> **Límite de Vercel**: los requests tienen un máximo de **4.5 MB**. Por eso el PDF se comprime en el navegador antes de enviarlo. PDFs de hasta ~15 MB generalmente quedan por debajo del límite tras la compresión.

Si el PDF sigue siendo demasiado grande tras la compresión, se recomienda reducirlo manualmente con [ilovepdf.com](https://www.ilovepdf.com/compress_pdf) antes de cargarlo.

---

## 🔧 Solución de Errores Comunes

| Error | Causa | Solución |
|-------|-------|----------|
| `413 Request Entity Too Large` | PDF demasiado grande para Vercel u Odoo | La compresión automática lo maneja. Si persiste, comprime el PDF manualmente antes de cargarlo. |
| `401 Sesión expirada` | La sesión de Express dura 8 horas | Cerrar sesión y volver a iniciar sesión. |
| `No items parsed` | Formato de PDF no reconocido | Verificar que el PDF no sea escaneado (imagen); debe tener texto seleccionable. |

---

## 🧪 Validación Masiva

Para verificar la precisión del extractor en todos los PDFs locales:

```bash
node verify_all_recursive.js
```

Analiza más de 1,300 archivos PDF de prueba verificando tipologías, tamaños, colores y precios extraídos.
