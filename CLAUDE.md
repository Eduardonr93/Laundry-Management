# CLAUDE.md — Sistema para lavandería

Contexto para continuar el trabajo en cualquier sesión de Claude. El dueño del proyecto es Eduardo (Cancún, Q. Roo); se dedica a CCTV, redes, control de acceso y estacionamientos. Responde en **español**.

## Qué es

App web para **una lavandería** con sus dos servicios:

- **Encargo** (dejar y recoger): cobro por kg o pieza con mínimo (ej. 3 kg), anticipo, fecha de entrega, flujo `recibido → en_proceso → listo → entregado`. Para entregar se exige cobrar el saldo completo.
- **Autoservicio**: venta de ciclos de lavadora/secadora y productos. Al cobrar, la máquina queda ocupada hasta `ends_at` (lo calcula el servidor; el navegador solo muestra la cuenta regresiva).

Más: clientes con historial, ticket de 80 mm, botón de WhatsApp (`wa.me`, sin API), corte de caja por día, roles `admin` y `empleado` (en la interfaz se llama "Mostrador").

El repo antes tenía un prototipo de Angular generado en AI Studio, sin backend. Se descartó por completo ("borrón y cuenta nueva"); sigue en el historial de git.

## Cómo correrla

Requiere Node **22.13+** (usa `node:sqlite`, que viene integrado). En la laptop de Eduardo es Windows con Node 24 y PowerShell.

```bash
npm install
npm run demo     # catálogo + datos de prueba (admin/admin123, mostrador/mostrador123)
npm start        # http://localhost:3000
npm test         # 14 pruebas de la API (node:test)
```

- Base de datos: `data/lavanderia.db` (ignorada por git). Para empezar limpio, borra `data/`.
- `npm run seed` carga solo el catálogo. En el primer `npm start` sin usuarios se crea `admin`, con contraseña aleatoria impresa en la consola o tomada de `ADMIN_PASSWORD`.
- Variables de entorno: ver README.md (`PORT`, `DB_PATH`, `UTC_OFFSET=-05:00`, `SECURE_COOKIES`, `TRUST_PROXY`, `SESSION_HOURS`).

## Estructura

```
server/
  index.js        arranque + creación del admin inicial
  app.js          Express: cabeceras de seguridad/CSP, JSON obligatorio en escrituras, sesión, rutas
  db.js           esquema (migraciones con PRAGMA user_version) y tx()
  orders.js       REGLAS DE NEGOCIO: encargos, pagos, entregas, cancelaciones, ventas, máquinas
  auth.js         scrypt, sesiones (token sha256 en BD, cookie httpOnly), límite de intentos de login
  routes/auth.js      /api/auth/*
  routes/catalog.js   /api/settings, /api/services, /api/machines, /api/users
  routes/business.js  /api/customers, /api/orders, /api/sales, /api/cash, /api/dashboard
  seed.js         catálogo inicial (precios MXN de referencia) y --demo
public/
  index.html, css/app.css (tokens de color con modo oscuro)
  js/app.js       router por hash (#/encargos, #/pedidos/:id, #/ticket/:id …) y shell
  js/ui.js        html`` (escapa todo), money, fechas es-MX, diálogos, toasts, íconos SVG
  js/components.js  buscador de clientes, editor de partidas, selector de forma de pago
  js/views/*.js   una pantalla por archivo
test/api.test.js  pruebas de extremo a extremo de la API con reloj controlable
```

## Convenciones (respétalas)

- **Dinero en centavos** (enteros) en BD y API; la interfaz convierte con `money()` y `toCents()`.
- **Fechas en UTC ISO**; los días del corte usan `UTC_OFFSET` (`server/time.js`).
- **Reglas de negocio solo en `server/orders.js`**; las rutas validan la entrada y llaman a esas funciones. Toda escritura de varios pasos va dentro de `tx()`.
- **Permisos en el servidor** (`requireAdmin`); la interfaz solo oculta botones.
- **Frontend sin compilación**: módulos ES nativos. La CSP es `script-src 'self'; style-src 'self'`, así que nada de `<script>` o `style="..."` en línea, ni CDNs.
- **Plantillas siempre con `html```** de `ui.js` (escapa todo); `raw()` solo para HTML de confianza.
- No usar `alert()` ni `confirm()`: usa `openDialog()` y `confirmDialog()`.
- En formularios no nombres un campo `method`, `action` ni `name` si lo vas a leer como `form.xxx` (choca con las propiedades del form). Por eso las formas de pago usan `pay_method`.
- Textos de interfaz en español de México, claros y en voz activa.
- Debe funcionar en **Windows**: usa `path` y `pathToFileURL`; nunca compares rutas con `file://${...}` (ese fue un error ya corregido en seed.js).
- Antes de cada commit: `npm test`. Si tocas la interfaz, abre la pantalla y pruébala en el navegador.

## Git

- Rama de trabajo: **`claude/ecstatic-einstein-t2ua3b`** (no hay PR todavía; no crear PR sin que Eduardo lo pida).
- Puede haber dos sesiones trabajando (una en la nube y otra en la laptop). **Haz `git pull` antes de empezar y `git push` al terminar** cada cambio, y que solo una sesión edite a la vez.
- Anota hallazgos de pruebas manuales en `NOTAS-PRUEBAS.md` y súbelo, para que la otra sesión los lea.

## Estado actual (15-oct-2026)

Hecho y probado:
- API completa con 14 pruebas pasando.
- Recorrido en navegador (Chromium) en la nube: login → encargo nuevo → estados → cobrar y entregar → ticket; venta de autoservicio con cambio; vista de celular sin errores en consola.
- Eduardo la instaló y la corrió en su laptop con Windows.

Sin verificar:
- Impresión real en impresora térmica de 80 mm (solo se vio el formato en pantalla).
- Uso desde tablet o celular por WiFi en la red local.

Limitaciones conocidas:
- `node:sqlite` aún se marca como experimental en Node 22/24; los scripts ocultan el aviso con `--disable-warning=ExperimentalWarning`.
- Una sola sucursal (no hay multiempresa). La venta de autoservicio se cobra con una sola forma de pago.
- Sin facturación (CFDI), sin descuentos ni promociones, sin reportes por rango de fechas.

## Próximos pasos posibles (Eduardo decide el orden)

1. Ajustes tras su prueba real: textos, precios, flujo en mostrador.
2. Subirla a un servidor (VPS) con HTTPS (`SECURE_COOKIES=1`, `TRUST_PROXY=1` detrás de Caddy o nginx) y respaldos automáticos del archivo `.db`.
3. **Control de máquinas con relevador** (ESP32 o Shelly en la red local): que la lavadora solo encienda cuando el ciclo se cobró. Encaja con su especialidad: control de acceso y CCTV. Un buen punto de enganche es `createSale()` y `stopMachine()` en `server/orders.js`.
4. Lavandería 24/7: acceso con tag, QR o PIN y eventos ligados a clips de CCTV.
5. Reportes por rango de fechas, promociones (ej. décimo lavado gratis) y varias sucursales.
