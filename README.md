# Cotizador de Ventanas PVC & Sincronizador Odoo

Esta es una aplicación web y suite de herramientas construida en **Node.js** y **Tailwind CSS** diseñada para procesar cotizaciones de ventanas de PVC en formato PDF de diversas marcas (Muchtek, Veka, DVP, Kömmerling, Winhause, Sodival), extraer de forma automática y precisa el detalle de sus ítems, y guardarlos en **Odoo** como presupuestos de venta (Sales Quotations) y órdenes de fabricación de taller.

---

## 🚀 Características Clave

1. **Lector Multiformato de PDFs (99.9% de precisión)**:
   - Detecta de forma dinámica la marca y distribución de la cotización cargada.
   - Soporta y extrae medidas (ancho, alto), colores, vidrios, cantidades, precios y tipologías (corredizas, practicables, paños fijos) de formatos como:
     - **Format 1**: Prowindows y Muchtek (incluyendo soporte de puertas `P` y `PV`).
     - **Format 2 (Gustavo)**: Veka y DVP (con etiquetas de posición variables y dimensiones en múltiples líneas).
     - **Format 2 (Roberto)**: Kömmerling de un solo ítem.
     - **Format 2 (Roberto Multi-Ítem)**: Kömmerling con tablas segmentadas por páginas.
     - **Format 3**: Winhause y Sodival.
     - **Sodival Cotización**: Formato propio de Sodival con desglose lineal.

2. **Particionado Dinámico de Variantes (Límite Odoo)**:
   - Duplica el producto plantilla base (`Ventana 2 hojas correderas PVC`) para cada cliente o cotización.
   - Calcula el producto cartesiano de atributos únicos. Si excede el límite de Odoo de 1,000 variantes (ej. Gustavo Bresky con 1,530 combinaciones), particiona los ítems automáticamente en sub-plantillas (`CLIENTE A`, `CLIENTE B`) para evitar caídas del servidor de Odoo.

3. **Integración con Órdenes de Fabricación (MRP)**:
   - Al guardar la cotización, busca y vincula las líneas del pedido a la variante de producto exacta generada en Odoo.
   - Crea automáticamente Órdenes de Fabricación (Manufacturing Orders) para cada ítem asignadas al centro de trabajo `Taller Armado PVC`.

4. **Tema Personalizado Claro / Oscuro**:
   - Selector de tema integrado en el login y en el panel de trabajo.
   - Persistencia del tema a través de `localStorage`.
   - Carga en head síncrona para evitar parpadeos visuales (screen flash).

5. **Panel Autocompletado de Clientes**:
   - Búsqueda en tiempo real de clientes existentes en Odoo mediante XML-RPC.
   - Modal de creación rápida de nuevos clientes (Persona o Empresa) directamente a la base de datos de Odoo.

---

## 🛠️ Tecnologías Utilizadas

- **Servidor (Backend)**: Node.js, Express, XML-RPC (comunicación segura con Odoo), Multer, `pdf-parse`.
- **Cliente (Frontend)**: HTML5 Semántico, Tailwind CSS (CDN), Vanilla Javascript (con persistencia local y glassmorphism), CSS Variables para el control de temas.
- **Herramientas Batch (Python)**: Complemento CLI escrito en Python (`sync_all_pdfs_to_odoo.py` y `sync_pdf_to_odoo.py`) que utiliza `xmlrpc.client` y `pypdf` para automatizar subidas masivas directamente desde consola.

---

## 📁 Estructura del Proyecto

```bash
├── pdfs/                      # Carpeta de cotizaciones de prueba ordenadas por marca
├── public/                    # Archivos estáticos del frontend
│   ├── index.html             # Página web principal y estilos responsivos (Light/Dark)
│   ├── logo.png               # Logotipo corporativo de Prowindows
│   └── js/
│       └── app.js             # Lógica de carga de archivos, autocompletado y API de cliente
├── server.js                  # Servidor Express, endpoints REST y XML-RPC Helpers de Odoo
├── sync_all_pdfs_to_odoo.py   # Script de sincronización masiva CLI (Python)
├── package.json               # Dependencias de Node.js
└── README.md                  # Documentación del proyecto
```

---

## ⚙️ Instalación y Configuración

### Requisitos Previos
- Node.js (v16 o superior)
- Conexión a internet para comunicarse con la instancia de Odoo (`prowindows-ltda.odoo.com`).

### Pasos de Instalación

1. **Instalar Dependencias**:
   ```bash
   npm install
   ```

2. **Configuración de Odoo**:
   La base de datos de Odoo y el host se configuran directamente en el servidor. Por defecto apunta a:
   - **Instancia**: `prowindows-ltda.odoo.com`
   - **Base de Datos**: `prowindows-ltda`
   
   *Nota: Las credenciales de acceso (email y contraseña) se solicitan de forma segura al iniciar sesión en la interfaz web de la aplicación.*

---

## 🎮 Ejecución

### Modo Desarrollo (con recarga automática)
Para iniciar el servidor con Nodemon y aplicar cambios automáticamente al guardar archivos:
```bash
npm run dev
```

### Modo Producción
Para iniciar el servidor Node ordinario:
```bash
npm start
```

El servidor web se levantará en el puerto **3000**:
👉 [http://localhost:3000](http://localhost:3000)

---

## 🧪 Pruebas de Lector

Para comprobar la precisión del extractor en todos los PDFs recursivamente, puedes ejecutar el script de validación masiva:
```bash
node verify_all_recursive.js
```
*Este comando analizará los más de 1,300 archivos PDF locales de prueba, verificando las tipologías, tamaños, colores y precios extraídos.*
