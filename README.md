# Lavandería

Sistema web para una lavandería con sus dos servicios principales:

- **Encargo (dejar y recoger):** el cliente deja su ropa, se cobra por kilo o por pieza (con mínimo, por ejemplo 3 kg), se registra un anticipo y una fecha de entrega, y el pedido avanza por *Recibido → En proceso → Listo para entregar → Entregado*. Para entregar hay que cobrar el saldo.
- **Autoservicio:** venta de ciclos de lavadora o secadora y de productos (detergente, suavizante). Al cobrar, la máquina queda ocupada con cuenta regresiva hasta que termina el ciclo.

También incluye clientes con historial, ticket para impresora térmica de 80 mm, aviso por WhatsApp cuando la ropa está lista, corte de caja por día y forma de pago, y usuarios con dos roles.

| Rol | Puede |
|---|---|
| **Mostrador** | Encargos, ventas de autoservicio, clientes, cobros, liberar máquinas y ver el corte del día. |
| **Administrador** | Todo lo anterior, más precios y servicios, máquinas, usuarios, cancelaciones con reembolso y cortes de días anteriores. |

## Requisitos

- Node.js **22.13 o más reciente** (trae SQLite integrado; no hace falta instalar una base de datos).

## Instalación

```bash
npm install
npm run seed      # carga el catálogo inicial de servicios y máquinas (solo si está vacío)
npm start         # abre http://localhost:3000
```

La primera vez que arranca se crea el usuario `admin` y la contraseña aparece en la consola. Para elegirla tú:

```bash
ADMIN_PASSWORD='una-contraseña-segura' npm start
```

Para probar con datos de ejemplo (clientes, encargos y máquinas trabajando), en una base de datos nueva:

```bash
npm run demo      # usuarios: admin / admin123 y mostrador / mostrador123
npm start
```

## Configuración

Variables de entorno opcionales:

| Variable | Valor por defecto | Para qué sirve |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor. |
| `DB_PATH` | `data/lavanderia.db` | Archivo de la base de datos. |
| `UTC_OFFSET` | `-05:00` | Huso horario del negocio para el corte de caja (Cancún no tiene horario de verano). |
| `SECURE_COOKIES` | (vacío) | Pon `1` cuando la app se sirva por HTTPS. |
| `TRUST_PROXY` | (vacío) | Pon `1` si hay un proxy (nginx, Caddy) delante. |
| `SESSION_HOURS` | `12` | Duración de la sesión. |

Los precios, máquinas, datos del ticket y el tiempo normal de entrega se cambian desde **Ajustes** dentro de la app.

## Respaldos

Toda la información está en un solo archivo (`data/lavanderia.db`). Para respaldarlo con la app encendida:

```bash
sqlite3 data/lavanderia.db ".backup respaldo-$(date +%F).db"
```

Si no tienes `sqlite3`, detén la app y copia la carpeta `data/`.

## Pruebas

```bash
npm test
```

Las pruebas cubren el login y los permisos, el cálculo de mínimos, el flujo de estados, el cobro obligatorio al entregar, la ocupación de máquinas, las cancelaciones con reembolso y el corte de caja.

## Estructura

```
server/          API (Express + SQLite)
  orders.js      reglas de negocio de encargos, ventas y máquinas
  routes/        rutas de la API
  db.js          esquema de la base de datos
public/          interfaz (HTML, CSS y JavaScript sin paso de compilación)
  js/views/      una pantalla por archivo
test/            pruebas de la API
```

Los montos se guardan en centavos y las fechas en UTC.
