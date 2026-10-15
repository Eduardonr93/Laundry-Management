# Notas de pruebas manuales

## 15-oct-2026 — Laptop de Eduardo (Windows 11, Chrome, datos de `npm run demo`)

Sesión de Claude en la laptop. `npm test`: 14/14 pasando.

### Funciona bien

- **Encargo completo** (E-00006, Ana Sofía Pech): 2 kg de lavado cobra el mínimo de 3 kg ($90). Anticipo de $40 en efectivo → saldo $50. Empezar a lavar → Marcar como listo → Cobrar y entregar (pagó $50 con tarjeta) → saldo $0. El historial registra cada paso con usuario y hora.
- **Autoservicio** (A-00004): Lavadora 1 con lavado normal ($45) + detergente ($15) = $60; pago con $100 muestra cambio de $40. La máquina queda con cuenta regresiva (~35 min).
- **Liberación automática**: Lavadora 2 (terminaba 1:46 p.m.) aparece disponible después de esa hora sin tocarla.
- **Caja**: cuadra. Efectivo $290 + tarjeta $209 = $499; encargos $272 + autoservicio $227.
- **Cancelación (admin)** de E-00005, pagado con $90 en efectivo: exige motivo ("Escribe el motivo de la cancelación"), registra reembolso de -$90 y la caja baja a $409 (efectivo $200).
- **Empleado (mostrador)**: no ve Ajustes; `#/ajustes` escrito a mano regresa a Inicio; en un encargo activo no aparece Cancelar. El servidor también bloquea (`requireAdmin` en cancelar, ajustes, servicios, máquinas y usuarios).
- **Celular por WiFi (verificado por Eduardo)**: desde su teléfono, en la misma red, la app abre y se ve bien.
- **Acceso por red local**: el servidor escucha en `0.0.0.0:3000`; desde `http://IP-DE-LA-LAPTOP:3000` carga, inicia sesión y opera igual que en localhost. El firewall de Windows ya permite Node.js (perfil Privado y Público).

### Hallazgos para corregir

1. **Ticket: el pago al entregar dice "Anticipo"**. En E-00006 el ticket muestra `Anticipo (Efectivo) $40` y `Anticipo (Tarjeta) $50`, pero los $50 se cobraron al entregar. Sugerencia: "Anticipo" solo para pagos hechos antes de entregar y "Pago al entregar" (o "Liquidación") para el resto.
2. **Ticket de encargo entregado** sigue diciendo "Presente este ticket para recoger su ropa". Para encargos entregados podría decir "Entregado el …" o quitar esa línea.

### Observaciones (no son errores)

- La laptop estaba conectada al hotspot del celular (red "Pública" en Windows). En la lavandería conviene marcar el WiFi como red **Privada**.
- Desde el celular hay que usar la IP de la laptop, que cambia según la red; si se usa diario, conviene reservarle una IP fija en el router.

### Sin verificar todavía

- **Impresión en impresora térmica de 80 mm.**

### Datos de prueba que quedaron en la BD

E-00006 entregado, A-00004 (Lavadora 1), E-00005 cancelado con reembolso.
