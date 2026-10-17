# Probador RS485: OLIMEX ESP32-EVB + AccessPRO PRO12RF

Firmware para Arduino IDE. Recibe por RS485 las lecturas de tags UHF del lector
**AccessPRO PRO12RF**, las muestra en el Monitor Serie y activa el **Relé 1**
de la ESP32-EVB con cada tag nuevo (simula la apertura de una pluma).

---

## 1. Material

| Cant. | Material | Nota |
|---|---|---|
| 1 | OLIMEX ESP32-EVB | Con cable micro-USB |
| 1 | **Módulo TTL↔RS485 de 3.3 V** (MAX3485 / SP3485) | La ESP32-EVB **no trae RS485**. Ver nota abajo |
| 1 | Fuente 12 VDC para el PRO12RF | Según la etiqueta del lector (≥ 2 A recomendado) |
| 1 | Fuente 5 VDC para la ESP32-EVB (opcional) | O se alimenta solo por USB para la prueba |
| – | Cable calibre 22 de 2 hilos (o par trenzado) para A/B + 1 hilo de GND | |
| 1 | Resistencia de 120 Ω (opcional) | Terminación si el cable mide más de ~10 m |
| 1 | Resistencia de 10 kΩ (recomendada) | Pull-up en RX (GPIO36 no tiene pull-up interno) |

> **Ojo con el módulo RS485.** El típico módulo azul **MAX485 es de 5 V** y su
> salida RO entrega 5 V: **GPIO36 NO tolera 5 V**. Usa un módulo **MAX3485/SP3485
> a 3.3 V**, o un módulo "auto-dirección" (TXD/RXD sin DE/RE) alimentado a 3.3 V.
> Si sólo tienes un MAX485 de 5 V, pon un divisor en RO (RO → 1 kΩ → GPIO36 →
> 2 kΩ → GND).

---

## 2. Conector UEXT de la ESP32-EVB

El UEXT es el conector macho de 10 pines (2×5). El **pin 1** está marcado con
un cuadro/triángulo en la serigrafía. Fila impar: 1-3-5-7-9; fila par: 2-4-6-8-10.

```
            UEXT (vista superior)
          +-----+-----+
   3.3V   |  1  |  2  |  GND
   TX     |  3  |  4  |  RX
   (SCL)  |  5  |  6  |  (SDA)   <- usamos el 6 para DE/RE
   (MISO) |  7  |  8  |  (MOSI)
   (SCK)  |  9  | 10  |  (SS)
          +-----+-----+
```

| UEXT pin | GPIO ESP32 | Función en este firmware |
|---|---|---|
| 1 | 3.3V | VCC del módulo RS485 |
| 2 | GND | GND del módulo RS485 **y GND del lector** |
| 3 | GPIO4 | TX (UART2) → **DI** del módulo |
| 4 | GPIO36 | RX (UART2) ← **RO** del módulo (sólo entrada) |
| 6 | GPIO13 | **DE + /RE** (unidos) del módulo |

Otros recursos de la placa que usa el firmware:

| Recurso | GPIO |
|---|---|
| Relé 1 (se activa con cada tag) | GPIO32 |
| Relé 2 (libre, inicia apagado) | GPIO33 |
| Botón BUT1 (hace un inventario manual) | GPIO34 |

---

## 3. Diagrama de conexión

```
 OLIMEX ESP32-EVB (UEXT)          MÓDULO MAX3485 (3.3V)           AccessPRO PRO12RF
 ─────────────────────            ─────────────────────           ─────────────────
 pin 1  3.3V  ──────────────────► VCC
 pin 2  GND   ──────────────────► GND  ─────────────────────────► GND (negro)
 pin 3  GPIO4 (TX) ─────────────► DI
 pin 4  GPIO36(RX) ◄──────────── RO        (10k de RO a 3.3V)
 pin 6  GPIO13 ─────────┬───────► DE
                        └───────► RE
                                  A  ───────────────────────────► RS485 A+ (azul*)
                                  B  ───────────────────────────► RS485 B- (gris/plomo*)

                                                     Fuente 12 VDC ► +12V (rojo) / GND (negro)
```

\* Colores según la ficha del PRO12RF (variante BLU: azul = A, plomo = B; en la
ficha V2 aparecen como pin 10 = A+, pin 11 = B-). **Confírmalo con la etiqueta o
el manual de tu versión.** Si no recibes nada o sólo basura, **invierte A y B**:
no se daña nada.

Reglas importantes:

1. **El GND es común**: une el GND de la fuente del lector con el GND de la
   ESP32-EVB (a través del módulo). Sin GND común el RS485 falla mucho.
2. **No alimentes el lector desde la ESP32-EVB.** El lector va con su fuente de 12 V.
3. La ESP32-EVB se alimenta por USB (para la prueba) o por su jack de **5 VDC**.
   Los relés sólo funcionan con 5 V presentes (USB o jack), no con batería.
4. Terminación de 120 Ω entre A y B en cada extremo sólo en cableados largos.

Si usas un **módulo de auto-dirección** (sin pines DE/RE), no conectes el UEXT 6 y
en el código cambia:

```cpp
#define PIN_RS485_DE   -1
```

---

## 4. Preparar Arduino IDE

1. Instala **Arduino IDE 2.x**.
2. `Archivo → Preferencias → URLs adicionales de gestor de placas`, agrega:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. `Herramientas → Placa → Gestor de placas` → busca **esp32** (de *Espressif
   Systems*) → **Instalar** (versión 2.x o 3.x, ambas sirven).
4. Instala el driver **CH340** si Windows no reconoce el puerto (la ESP32-EVB usa
   el chip CH340T como convertidor USB-serie).
5. Abre `olimex_esp32_evb_pro12rf/olimex_esp32_evb_pro12rf.ino`
   (la carpeta y el `.ino` deben llamarse igual).
6. `Herramientas`:
   - **Placa:** `esp32 → OLIMEX ESP32-EVB`
   - **Puerto:** el COM/tty que aparece al conectar el USB
   - Upload speed: 921600 (si falla, 115200)
7. Clic en **Subir** (→). No se necesitan librerías extra (`HardwareSerial` y
   `Preferences` vienen en el core).
8. Abre el **Monitor Serie** a **115200 baudios**, con fin de línea
   **"Nueva línea"** o **"Ambos NL & CR"**.

---

## 5. Procedimiento de prueba

1. Conecta todo **sin energía**, revisa GND común y A/B.
2. Energiza el lector (12 V) y luego la ESP32-EVB por USB.
3. En el Monitor Serie verás el encabezado, la configuración y el firmware envía
   automáticamente un **Get Reader Info** (`04 FF 21 19 95`).
4. **Si aparece `LECTOR DETECTADO`** → la comunicación es correcta. Escribe `inv`
   para un inventario o `poll on` para leer continuamente.
5. **Si no aparece nada**, escribe `scan`: prueba 9600, 19200, 38400, 57600 y
   115200 baudios, y guarda el que funcione. Mientras corre el scan, acerca un tag
   (por si el lector está en modo activo/automático).
6. Acerca un tag al lector. Por cada tag nuevo verás algo así y sonará el relé 1:

```
--------------------------------------------------------
[TAG] #1  protocolo=UHFReader-V2.0 (activo)  bytes=12
      EPC = E28011606000020A1B2C3D4E
      Wiegand26 probable: FC=60  Tarjeta=15694  (decimal 24 bits=3947854)
      Lecturas acumuladas de este tag: 1
--------------------------------------------------------
```

   El dato "Wiegand26 probable" sirve para compararlo con lo que el mismo tag
   reporta en tu controlador de acceso por Wiegand (normalmente son los 3 últimos
   bytes del EPC).

7. Por defecto `raw` está en **on**: cada bloque recibido también se imprime en
   HEX/ASCII. Si el lector usa un protocolo que no se decodifica, igual verás los
   bytes y podrás identificarlo. `raw off` para ver sólo los tags.

### Comandos del Monitor Serie

| Comando | Acción |
|---|---|
| `help` | Lista de comandos |
| `status` | Configuración, contadores y últimos tags |
| `baud 9600` | Cambia los baudios RS485 (se guarda en flash) |
| `scan` | Detecta los baudios automáticamente |
| `addr FF` | Dirección del lector (FF = broadcast, 00 = default de fábrica) |
| `info` | Pide información del lector (cmd 0x21) |
| `inv` | Un inventario (cmd 0x01) |
| `poll on` / `poll off` | Inventario periódico (lector en modo comando/respuesta) |
| `pollms 300` | Periodo del poll en ms |
| `raw on` / `raw off` | Volcado HEX/ASCII de todo lo recibido |
| `relay 2000` | Duración del pulso del relé 1 en ms |
| `dup 5000` | Tiempo para no repetir el mismo tag (ms) |
| `send 04 FF 21 19 95` | Envía bytes crudos al lector |
| `sendcrc 04 FF 21` | Envía bytes y agrega el CRC16 del protocolo V2.0 |
| `test` | Pulsa el relé 1 |
| `clear` | Borra contadores y tabla de tags |

---

## 6. Protocolos que reconoce

| Protocolo | Cómo se ve | Notas |
|---|---|---|
| **UHFReader V2.0** (Chafon) | `Len Adr Cmd Status Data CRC16` | El que cita la ficha del PRO12RF. CRC16 preset 0xFFFF, poly 0x8408. Modo activo = cmd `0xEE`; inventario = cmd `0x01`; info = cmd `0x21` |
| Impinj R2000 | `A0 Len Adr Cmd Data Chk` | Lectores R2000 genéricos |
| MagicRF M100 | `BB Tipo Cmd PL Data Chk 7E` | Módulos M100/QM100 |
| ASCII | `E2003412...\r\n` | Lectores que mandan el EPC como texto |

---

## 7. Configuración del PRO12RF

- El PRO12RF sale de fábrica con salida **Wiegand 26**. Para que mande datos por
  RS485 hay que habilitar el puerto/modo con el **software de configuración de
  AccessPRO** (conectado por RS232/RS485/TCP según tu versión):
  - **Modo respuesta/comando**: el lector sólo contesta cuando se le pregunta →
    usa `poll on` en este firmware.
  - **Modo activo/automático** con salida RS485: el lector manda el EPC solo al
    detectar un tag → sólo escucha (no hace falta `poll`).
- En algunas versiones (p. ej. la BLU) la ficha indica que los hilos RS485 son
  "para futuras actualizaciones". Si tu unidad no transmite nada por RS485 en
  ningún baudio ni polaridad, confirma con el distribuidor que tu versión/firmware
  tenga RS485 activo.

---

## 8. Solución de problemas

| Síntoma | Causa probable / solución |
|---|---|
| No se recibe ningún byte | Lector sin RS485 habilitado, A/B sin conectar, falta GND común, DE atorado en alto (revisa UEXT 6) |
| Llegan bytes "basura" (`datos no reconocidos`) | Baudios incorrectos → `scan`; A/B invertidos; falta GND común |
| Se reciben datos pero `info` no contesta | Lector en modo activo (normal) o dirección distinta → `addr 00` |
| El relé no suena | Sin 5 V (los relés no operan con batería); prueba con `test` |
| No sube el firmware | Driver CH340, cable USB sólo de carga, baja Upload speed a 115200 |
| Mismo tag muchas veces | Normal en UHF; ajusta `dup` |
