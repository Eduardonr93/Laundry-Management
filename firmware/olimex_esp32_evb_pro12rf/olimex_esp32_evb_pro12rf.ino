/*
 * ============================================================================
 *  Probador RS485 para lector UHF AccessPRO PRO12RF
 *  Placa: OLIMEX ESP32-EVB          IDE: Arduino IDE (core esp32 de Espressif)
 * ============================================================================
 *
 *  Que hace:
 *   - Recibe por RS485 (half-duplex) lo que envia el PRO12RF.
 *   - Muestra TODO lo recibido en HEX + ASCII (modo sniffer) por el USB.
 *   - Decodifica automaticamente los protocolos UHF mas comunes:
 *       1) "UHF RFID Reader / PC communication protocol V2.0" (Chafon/UHFReader18)
 *          -> es el que cita la ficha tecnica del PRO12RF.  Trama:
 *             Len | Adr | Cmd | Status | Data... | CRC16-LSB | CRC16-MSB
 *       2) Impinj R2000 (cabecera 0xA0, checksum)
 *       3) MagicRF M100/QM100 (cabecera 0xBB ... 0x7E)
 *       4) Texto ASCII (p.ej. "E2003412...\r\n")
 *   - Por cada tag valido: imprime EPC, equivalente Wiegand-26 probable y
 *     activa el RELE 1 de la placa (simula apertura de pluma/barrera).
 *   - Comandos por el Monitor Serie (115200) para cambiar baudios, detectar
 *     baudios automaticamente, pedir info del lector, hacer inventario, etc.
 *   - Guarda la configuracion en la memoria flash (NVS).
 *
 *  Conexiones (ver README.md para el detalle):
 *   UEXT pin 1 (3.3V)  -> VCC del modulo RS485 (MAX3485 / modulo 3.3V)
 *   UEXT pin 2 (GND)   -> GND del modulo RS485 (y GND del lector)
 *   UEXT pin 3 (GPIO4) -> DI  del modulo (TX del ESP32)
 *   UEXT pin 4 (GPIO36)-> RO  del modulo (RX del ESP32, solo entrada)
 *   UEXT pin 6 (GPIO13)-> DE + /RE unidos (control de direccion)
 *   Modulo A/B         -> A+/B- del PRO12RF
 * ============================================================================
 */

#include <Arduino.h>
#include <HardwareSerial.h>
#include <Preferences.h>

// ---------------------------------------------------------------- Pines -----
#define PIN_RS485_RX   36   // UEXT pin 4  (GPIO36 = solo entrada)
#define PIN_RS485_TX    4   // UEXT pin 3
#define PIN_RS485_DE   13   // UEXT pin 6  (-1 si usas modulo con auto-direccion)
#define PIN_RELAY1     32   // Rele 1 de la ESP32-EVB
#define PIN_RELAY2     33   // Rele 2 de la ESP32-EVB
#define PIN_BUTTON     34   // BUT1 de la ESP32-EVB (activo en bajo)

// ------------------------------------------------------- Valores default ----
#define DEFAULT_BAUD        57600   // Default de la familia UHFReader V2.0
#define DEFAULT_ADDR        0xFF    // 0xFF = direccion broadcast
#define DEFAULT_RELAY_MS    1000    // Tiempo de pulso del rele 1
#define DEFAULT_DUP_MS      3000    // No repetir el mismo tag antes de X ms
#define DEFAULT_POLL_MS     500     // Periodo de inventario en modo "poll"
#define FRAME_GAP_MS        20      // Silencio que separa una trama de otra
#define RX_BUF_SIZE         512
#define MAX_EPC_LEN         64
#define DUP_TABLE_SIZE      16

HardwareSerial RS485(2);           // UART2 remapeado a GPIO36/GPIO4
Preferences prefs;

// ------------------------------------------------------------ Config --------
struct Config {
  uint32_t baud;
  uint8_t  addr;
  uint32_t relayMs;
  uint32_t dupMs;
  uint32_t pollMs;
  bool     raw;
  bool     poll;
} cfg;

// ------------------------------------------------------------ Estado --------
uint8_t  rxBuf[RX_BUF_SIZE];
size_t   rxLen = 0;
uint32_t lastByteMs = 0;
uint32_t relayOffAt = 0;
bool     relayOn = false;
uint32_t lastPollMs = 0;
String   cmdLine;

// Contadores
uint32_t statBytes = 0, statFrames = 0, statTags = 0, statUnknown = 0;
uint32_t validFramesFlag = 0;   // lo usa el "scan" de baudios

struct SeenTag {
  char     id[MAX_EPC_LEN * 2 + 1];
  uint32_t lastMs;
  uint32_t count;
};
SeenTag seen[DUP_TABLE_SIZE];

// ============================================================================
//  Utilidades
// ============================================================================
uint16_t crc16Chafon(const uint8_t *d, size_t n) {
  // CRC16 del protocolo UHFReader V2.0: preset 0xFFFF, polinomio 0x8408
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < n; i++) {
    crc ^= d[i];
    for (int b = 0; b < 8; b++) crc = (crc & 1) ? (crc >> 1) ^ 0x8408 : (crc >> 1);
  }
  return crc;
}

void printHex(const uint8_t *d, size_t n) {
  for (size_t i = 0; i < n; i++) {
    if (d[i] < 0x10) Serial.print('0');
    Serial.print(d[i], HEX);
    if (i + 1 < n) Serial.print(' ');
  }
}

void toHexString(const uint8_t *d, size_t n, char *out) {
  static const char *H = "0123456789ABCDEF";
  for (size_t i = 0; i < n; i++) {
    out[i * 2]     = H[d[i] >> 4];
    out[i * 2 + 1] = H[d[i] & 0x0F];
  }
  out[n * 2] = 0;
}

void dumpRaw(const uint8_t *d, size_t n) {
  Serial.printf("[RAW %u bytes @%lu] ", (unsigned)n, (unsigned long)cfg.baud);
  printHex(d, n);
  Serial.print("  | ");
  for (size_t i = 0; i < n; i++) Serial.print((d[i] >= 32 && d[i] < 127) ? (char)d[i] : '.');
  Serial.println();
}

// ============================================================================
//  Rele
// ============================================================================
void relayPulse() {
  digitalWrite(PIN_RELAY1, HIGH);
  relayOn = true;
  relayOffAt = millis() + cfg.relayMs;
}

void relayTask() {
  if (relayOn && (int32_t)(millis() - relayOffAt) >= 0) {
    digitalWrite(PIN_RELAY1, LOW);
    relayOn = false;
  }
}

// ============================================================================
//  Manejo de tag leido
// ============================================================================
void onTag(const char *proto, const uint8_t *epc, size_t len, int rssi) {
  if (len == 0 || len > MAX_EPC_LEN) return;
  char id[MAX_EPC_LEN * 2 + 1];
  toHexString(epc, len, id);
  uint32_t now = millis();

  // Anti-repeticion: el lector UHF reporta el mismo tag muchas veces por segundo
  int slot = -1, oldest = 0;
  for (int i = 0; i < DUP_TABLE_SIZE; i++) {
    if (strcmp(seen[i].id, id) == 0) { slot = i; break; }
    if (seen[i].lastMs < seen[oldest].lastMs) oldest = i;
  }
  if (slot >= 0) {
    seen[slot].count++;
    if (now - seen[slot].lastMs < cfg.dupMs) { seen[slot].lastMs = now; return; }
  } else {
    slot = oldest;
    strncpy(seen[slot].id, id, sizeof(seen[slot].id));
    seen[slot].count = 1;
  }
  seen[slot].lastMs = now;
  statTags++;

  Serial.println(F("--------------------------------------------------------"));
  Serial.printf("[TAG] #%lu  protocolo=%s  bytes=%u", (unsigned long)statTags, proto, (unsigned)len);
  if (rssi != INT32_MIN) Serial.printf("  RSSI=%d", rssi);
  Serial.println();
  Serial.printf("      EPC = %s\n", id);
  if (len >= 3) {
    // La mayoria de lectores UHF arman el Wiegand-26 con los 3 ultimos bytes del EPC
    uint8_t  fc   = epc[len - 3];
    uint16_t card = ((uint16_t)epc[len - 2] << 8) | epc[len - 1];
    uint32_t w24  = ((uint32_t)fc << 16) | card;
    Serial.printf("      Wiegand26 probable: FC=%u  Tarjeta=%u  (decimal 24 bits=%lu)\n",
                  fc, card, (unsigned long)w24);
  }
  Serial.printf("      Lecturas acumuladas de este tag: %lu\n", (unsigned long)seen[slot].count);
  Serial.println(F("--------------------------------------------------------"));
  relayPulse();
}

// ============================================================================
//  Envio RS485 (half-duplex)
// ============================================================================
void rs485Send(const uint8_t *d, size_t n) {
  if (PIN_RS485_DE >= 0) digitalWrite(PIN_RS485_DE, HIGH);
  delayMicroseconds(50);
  RS485.write(d, n);
  RS485.flush();                       // espera a que salga el ultimo bit
  delayMicroseconds(50);
  if (PIN_RS485_DE >= 0) digitalWrite(PIN_RS485_DE, LOW);
  while (RS485.available()) RS485.read();   // descarta eco/ruido de la propia TX
  if (cfg.raw || !cfg.poll) {
    Serial.print(F("[TX] "));
    printHex(d, n);
    Serial.println();
  }
}

// Arma y envia una trama UHFReader V2.0: Len Adr Cmd Data... CRC
void sendChafon(uint8_t cmd, const uint8_t *data = nullptr, size_t dlen = 0) {
  uint8_t f[64];
  size_t n = 0;
  f[n++] = (uint8_t)(dlen + 4);   // Len = Adr + Cmd + Data + 2 CRC
  f[n++] = cfg.addr;
  f[n++] = cmd;
  for (size_t i = 0; i < dlen && n < sizeof(f) - 2; i++) f[n++] = data[i];
  uint16_t c = crc16Chafon(f, n);
  f[n++] = c & 0xFF;
  f[n++] = c >> 8;
  rs485Send(f, n);
}

void cmdGetInfo()   { sendChafon(0x21); }
void cmdInventory() { sendChafon(0x01); }

// ============================================================================
//  Decodificadores de protocolo.  Cada uno devuelve los bytes consumidos
//  (0 si no reconoce una trama valida en esa posicion).
// ============================================================================

// ---- 1) UHFReader V2.0 (Chafon) -------------------------------------------
size_t parseChafon(const uint8_t *b, size_t n) {
  if (n < 5) return 0;
  uint8_t len = b[0];
  if (len < 4 || (size_t)len + 1 > n) return 0;
  uint16_t crc = crc16Chafon(b, len - 1);
  if ((crc & 0xFF) != b[len - 1] || (crc >> 8) != b[len]) return 0;

  size_t total = len + 1;
  uint8_t adr = b[1], cmd = b[2];
  uint8_t status = (len >= 5) ? b[3] : 0xFF;
  const uint8_t *data = b + 4;
  size_t dlen = (len >= 5) ? len - 5 : 0;
  statFrames++;
  validFramesFlag++;

  if (cmd == 0xEE) {
    // Modo activo / auto: el lector manda el EPC solo
    if (dlen > 1 && data[0] == dlen - 1) onTag("UHFReader-V2.0 (activo)", data + 1, dlen - 1, INT32_MIN);
    else                                 onTag("UHFReader-V2.0 (activo)", data, dlen, INT32_MIN);
  } else if (cmd == 0x01) {
    // Respuesta a inventario
    if (status == 0xFB) {
      if (!cfg.poll) Serial.println(F("[INV] Sin tags en el campo"));
    } else if (status >= 0x01 && status <= 0x04 && dlen >= 1) {
      uint8_t num = data[0];
      size_t i = 1;
      Serial.printf("[INV] status=0x%02X  tags=%u\n", status, num);
      for (uint8_t t = 0; t < num && i < dlen; t++) {
        uint8_t el = data[i++];
        if (i + el > dlen) break;
        onTag("UHFReader-V2.0 (inventario)", data + i, el, INT32_MIN);
        i += el;
      }
    } else {
      Serial.printf("[INV] status=0x%02X\n", status);
    }
  } else if (cmd == 0x21 && status == 0x00 && dlen >= 8) {
    Serial.println(F("========== LECTOR DETECTADO (Get Reader Info) =========="));
    Serial.printf("  Direccion: 0x%02X   Baudios: %lu\n", adr, (unsigned long)cfg.baud);
    Serial.printf("  Version FW: %u.%02u   Tipo: 0x%02X   Protocolos: 0x%02X\n",
                  data[0], data[1], data[2], data[3]);
    Serial.printf("  Frec max: 0x%02X  Frec min: 0x%02X  Potencia: %u dBm  ScanTime: %u x100ms\n",
                  data[4], data[5], data[6], data[7]);
    Serial.println(F("========================================================"));
  } else {
    Serial.printf("[RESP V2.0] adr=0x%02X cmd=0x%02X status=0x%02X data=", adr, cmd, status);
    printHex(data, dlen);
    Serial.println();
  }
  return total;
}

// ---- 2) Impinj R2000 (0xA0) -----------------------------------------------
size_t parseR2000(const uint8_t *b, size_t n) {
  if (n < 5 || b[0] != 0xA0) return 0;
  uint8_t len = b[1];
  size_t total = (size_t)len + 2;
  if (len < 3 || total > n) return 0;
  uint8_t sum = 0;
  for (size_t i = 0; i < total - 1; i++) sum += b[i];
  if ((uint8_t)(~sum + 1) != b[total - 1]) return 0;

  statFrames++;
  validFramesFlag++;
  uint8_t cmd = b[3];
  const uint8_t *data = b + 4;
  size_t dlen = total - 5;
  // 0x89/0x8B real time inventory, 0x80 inventory: FreqAnt | PC(2) | EPC | RSSI
  if ((cmd == 0x89 || cmd == 0x8B || cmd == 0x8A) && dlen >= 6) {
    onTag("R2000 (0xA0)", data + 3, dlen - 4, (int)data[dlen - 1] - 129);
  } else {
    Serial.printf("[RESP R2000] cmd=0x%02X data=", cmd);
    printHex(data, dlen);
    Serial.println();
  }
  return total;
}

// ---- 3) MagicRF M100 (0xBB ... 0x7E) --------------------------------------
size_t parseMagicRF(const uint8_t *b, size_t n) {
  if (n < 7 || b[0] != 0xBB) return 0;
  uint16_t pl = ((uint16_t)b[3] << 8) | b[4];
  size_t total = 5 + pl + 2;
  if (total > n || b[total - 1] != 0x7E) return 0;
  uint8_t sum = 0;
  for (size_t i = 1; i < 5u + pl; i++) sum += b[i];
  if (sum != b[5 + pl]) return 0;

  statFrames++;
  validFramesFlag++;
  const uint8_t *p = b + 5;
  if (b[1] == 0x02 && b[2] == 0x22 && pl >= 6) {
    // RSSI | PC(2) | EPC | CRC(2)
    onTag("MagicRF (0xBB)", p + 3, pl - 5, (int8_t)p[0]);
  } else {
    Serial.printf("[RESP MagicRF] tipo=0x%02X cmd=0x%02X data=", b[1], b[2]);
    printHex(p, pl);
    Serial.println();
  }
  return total;
}

// ---- 4) Texto ASCII --------------------------------------------------------
bool parseAscii(const uint8_t *b, size_t n) {
  size_t printable = 0;
  for (size_t i = 0; i < n; i++)
    if ((b[i] >= 32 && b[i] < 127) || b[i] == '\r' || b[i] == '\n') printable++;
  if (n < 4 || printable * 10 < n * 9) return false;

  // Separa por lineas y trata cada linea hexadecimal como un ID de tag
  String s;
  for (size_t i = 0; i <= n; i++) {
    char c = (i < n) ? (char)b[i] : '\n';
    if (c == '\r' || c == '\n') {
      s.trim();
      if (s.length()) {
        Serial.printf("[ASCII] \"%s\"\n", s.c_str());
        String hex;
        for (unsigned k = 0; k < s.length(); k++)
          if (isxdigit((unsigned char)s[k])) hex += (char)toupper(s[k]);
        if (hex.length() >= 6 && hex.length() % 2 == 0 && hex.length() >= s.length() * 8 / 10) {
          uint8_t epc[MAX_EPC_LEN];
          size_t el = min((size_t)hex.length() / 2, (size_t)MAX_EPC_LEN);
          for (size_t k = 0; k < el; k++) epc[k] = strtoul(hex.substring(k * 2, k * 2 + 2).c_str(), nullptr, 16);
          onTag("ASCII", epc, el, INT32_MIN);
        }
      }
      s = "";
    } else {
      s += c;
    }
  }
  return true;
}

// ---- Procesa un bloque recibido -------------------------------------------
void processChunk(const uint8_t *b, size_t n) {
  if (cfg.raw) dumpRaw(b, n);

  bool any = false;
  size_t i = 0;
  while (i < n) {
    size_t used = parseChafon(b + i, n - i);
    if (!used) used = parseR2000(b + i, n - i);
    if (!used) used = parseMagicRF(b + i, n - i);
    if (used) { any = true; i += used; }
    else i++;
  }
  if (!any && !parseAscii(b, n)) {
    statUnknown++;
    if (!cfg.raw) dumpRaw(b, n);   // siempre mostrar lo desconocido
    Serial.println(F("  (datos no reconocidos: revisa baudios con 'scan' o la polaridad A/B)"));
  }
}

void rs485Task() {
  while (RS485.available()) {
    uint8_t c = RS485.read();
    statBytes++;
    if (rxLen < RX_BUF_SIZE) rxBuf[rxLen++] = c;
    lastByteMs = millis();
  }
  if (rxLen && (millis() - lastByteMs >= FRAME_GAP_MS || rxLen >= RX_BUF_SIZE)) {
    processChunk(rxBuf, rxLen);
    rxLen = 0;
  }
}

// ============================================================================
//  Configuracion persistente
// ============================================================================
void loadConfig() {
  prefs.begin("pro12rf", true);
  cfg.baud    = prefs.getUInt("baud", DEFAULT_BAUD);
  cfg.addr    = prefs.getUChar("addr", DEFAULT_ADDR);
  cfg.relayMs = prefs.getUInt("relay", DEFAULT_RELAY_MS);
  cfg.dupMs   = prefs.getUInt("dup", DEFAULT_DUP_MS);
  cfg.pollMs  = prefs.getUInt("pollms", DEFAULT_POLL_MS);
  cfg.raw     = prefs.getBool("raw", true);
  cfg.poll    = prefs.getBool("poll", false);
  prefs.end();
}

void saveConfig() {
  prefs.begin("pro12rf", false);
  prefs.putUInt("baud", cfg.baud);
  prefs.putUChar("addr", cfg.addr);
  prefs.putUInt("relay", cfg.relayMs);
  prefs.putUInt("dup", cfg.dupMs);
  prefs.putUInt("pollms", cfg.pollMs);
  prefs.putBool("raw", cfg.raw);
  prefs.putBool("poll", cfg.poll);
  prefs.end();
}

void openRS485(uint32_t baud) {
  RS485.end();
  RS485.setRxBufferSize(1024);
  RS485.begin(baud, SERIAL_8N1, PIN_RS485_RX, PIN_RS485_TX);
  rxLen = 0;
}

// ============================================================================
//  Auto-deteccion de baudios
// ============================================================================
void scanBauds() {
  static const uint32_t bauds[] = {9600, 19200, 38400, 57600, 115200};
  uint32_t best = 0, bestScore = 0;
  bool savedRaw = cfg.raw;
  cfg.raw = false;
  Serial.println(F("[SCAN] Probando baudios. Si el lector esta en modo activo, acerca un tag ahora."));
  for (uint32_t bd : bauds) {
    cfg.baud = bd;
    openRS485(bd);
    validFramesFlag = 0;
    uint32_t bytesBefore = statBytes;
    Serial.printf("[SCAN] %lu baud ...\n", (unsigned long)bd);
    cmdGetInfo();
    uint32_t t0 = millis();
    while (millis() - t0 < 1500) { rs485Task(); relayTask(); delay(1); }
    uint32_t got = statBytes - bytesBefore;
    Serial.printf("[SCAN] %lu baud -> bytes=%lu  tramas validas=%lu\n",
                  (unsigned long)bd, (unsigned long)got, (unsigned long)validFramesFlag);
    if (validFramesFlag > bestScore) { bestScore = validFramesFlag; best = bd; }
  }
  cfg.raw = savedRaw;
  if (best) {
    cfg.baud = best;
    Serial.printf("[SCAN] OK: el lector responde a %lu baud. Guardado.\n", (unsigned long)best);
  } else {
    cfg.baud = DEFAULT_BAUD;
    Serial.println(F("[SCAN] No se encontraron tramas validas. Revisa cableado A/B, GND y alimentacion."));
    Serial.println(F("       Si llegaron bytes 'basura' en algun baudio, prueba invertir A y B."));
  }
  openRS485(cfg.baud);
  saveConfig();
}

// ============================================================================
//  Consola (Monitor Serie USB a 115200)
// ============================================================================
void printHelp() {
  Serial.println(F("\n================ PRO12RF RS485 Tester - Comandos ================"));
  Serial.println(F(" help              Muestra esta ayuda"));
  Serial.println(F(" status            Configuracion y contadores"));
  Serial.println(F(" baud <n>          Baudios RS485 (9600,19200,38400,57600,115200)"));
  Serial.println(F(" scan              Detecta baudios automaticamente"));
  Serial.println(F(" addr <hex>        Direccion del lector (FF = broadcast)"));
  Serial.println(F(" info              Pide informacion al lector (cmd 0x21)"));
  Serial.println(F(" inv               Un inventario (cmd 0x01)"));
  Serial.println(F(" poll on|off       Inventario periodico (lector en modo comando)"));
  Serial.println(F(" pollms <ms>       Periodo del inventario periodico"));
  Serial.println(F(" raw on|off        Mostrar todos los bytes en HEX/ASCII"));
  Serial.println(F(" relay <ms>        Duracion del pulso del rele 1"));
  Serial.println(F(" dup <ms>          Tiempo anti-repeticion del mismo tag"));
  Serial.println(F(" send <hex..>      Envia bytes crudos. Ej: send 04 FF 21 19 95"));
  Serial.println(F(" sendcrc <hex..>   Envia bytes + CRC16 V2.0. Ej: sendcrc 04 FF 21"));
  Serial.println(F(" test              Pulsa el rele 1 (prueba de salida)"));
  Serial.println(F(" clear             Reinicia contadores y tabla de tags"));
  Serial.println(F(" Boton BUT1        Un inventario manual"));
  Serial.println(F("=================================================================\n"));
}

void printStatus() {
  Serial.println(F("------------------------ STATUS ------------------------"));
  Serial.printf(" RS485: %lu baud 8N1  RX=GPIO%d TX=GPIO%d DE=GPIO%d\n",
                (unsigned long)cfg.baud, PIN_RS485_RX, PIN_RS485_TX, PIN_RS485_DE);
  Serial.printf(" Direccion lector: 0x%02X\n", cfg.addr);
  Serial.printf(" raw=%s  poll=%s (%lums)  relay=%lums  dup=%lums\n",
                cfg.raw ? "on" : "off", cfg.poll ? "on" : "off",
                (unsigned long)cfg.pollMs, (unsigned long)cfg.relayMs, (unsigned long)cfg.dupMs);
  Serial.printf(" bytes=%lu  tramas=%lu  tags=%lu  desconocidos=%lu\n",
                (unsigned long)statBytes, (unsigned long)statFrames,
                (unsigned long)statTags, (unsigned long)statUnknown);
  for (int i = 0; i < DUP_TABLE_SIZE; i++)
    if (seen[i].id[0]) Serial.printf("   %s  x%lu\n", seen[i].id, (unsigned long)seen[i].count);
  Serial.println(F("--------------------------------------------------------"));
}

size_t parseHexBytes(const String &s, uint8_t *out, size_t maxLen) {
  size_t n = 0;
  String hex;
  for (unsigned i = 0; i < s.length(); i++) if (isxdigit((unsigned char)s[i])) hex += s[i];
  for (size_t i = 0; i + 1 < hex.length() && n < maxLen; i += 2)
    out[n++] = strtoul(hex.substring(i, i + 2).c_str(), nullptr, 16);
  return n;
}

bool parseOnOff(const String &a) { return a == "on" || a == "1"; }

void handleCommand(String line) {
  line.trim();
  if (!line.length()) return;
  int sp = line.indexOf(' ');
  String cmd = (sp < 0) ? line : line.substring(0, sp);
  String arg = (sp < 0) ? "" : line.substring(sp + 1);
  cmd.toLowerCase();
  arg.trim();

  if (cmd == "help" || cmd == "?")        printHelp();
  else if (cmd == "status")               printStatus();
  else if (cmd == "info")                 cmdGetInfo();
  else if (cmd == "inv")                  cmdInventory();
  else if (cmd == "scan")                 scanBauds();
  else if (cmd == "test")                 { relayPulse(); Serial.println(F("[OK] Rele 1 pulsado")); }
  else if (cmd == "clear") {
    memset(seen, 0, sizeof(seen));
    statBytes = statFrames = statTags = statUnknown = 0;
    Serial.println(F("[OK] Contadores reiniciados"));
  }
  else if (cmd == "baud" && arg.toInt() >= 1200) {
    cfg.baud = arg.toInt(); openRS485(cfg.baud); saveConfig();
    Serial.printf("[OK] RS485 a %lu baud\n", (unsigned long)cfg.baud);
  }
  else if (cmd == "addr" && arg.length()) {
    cfg.addr = strtoul(arg.c_str(), nullptr, 16); saveConfig();
    Serial.printf("[OK] Direccion 0x%02X\n", cfg.addr);
  }
  else if (cmd == "raw")    { cfg.raw = parseOnOff(arg);  saveConfig(); Serial.printf("[OK] raw=%s\n", cfg.raw ? "on" : "off"); }
  else if (cmd == "poll")   { cfg.poll = parseOnOff(arg); saveConfig(); Serial.printf("[OK] poll=%s\n", cfg.poll ? "on" : "off"); }
  else if (cmd == "pollms" && arg.toInt() >= 50) { cfg.pollMs  = arg.toInt(); saveConfig(); Serial.println(F("[OK]")); }
  else if (cmd == "relay"  && arg.toInt() >= 50) { cfg.relayMs = arg.toInt(); saveConfig(); Serial.println(F("[OK]")); }
  else if (cmd == "dup"    && arg.length())      { cfg.dupMs   = arg.toInt(); saveConfig(); Serial.println(F("[OK]")); }
  else if (cmd == "send" || cmd == "sendcrc") {
    uint8_t buf[64];
    size_t n = parseHexBytes(arg, buf, sizeof(buf) - 2);
    if (!n) { Serial.println(F("[ERR] Sin bytes")); return; }
    if (cmd == "sendcrc") { uint16_t c = crc16Chafon(buf, n); buf[n++] = c & 0xFF; buf[n++] = c >> 8; }
    rs485Send(buf, n);
  }
  else Serial.println(F("[ERR] Comando no valido. Escribe 'help'"));
}

void consoleTask() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') { handleCommand(cmdLine); cmdLine = ""; }
    else if (cmdLine.length() < 200) cmdLine += c;
  }
}

// ============================================================================
//  Boton BUT1 (GPIO34, tiene pull-up externo en la placa)
// ============================================================================
void buttonTask() {
  static bool last = true;
  static uint32_t tChange = 0;
  bool now = digitalRead(PIN_BUTTON);
  if (now != last && millis() - tChange > 50) {
    tChange = millis();
    last = now;
    if (!now) { Serial.println(F("[BUT1] Inventario manual")); cmdInventory(); }
  }
}

// ============================================================================
//  Setup / Loop
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(PIN_RELAY1, OUTPUT);
  pinMode(PIN_RELAY2, OUTPUT);
  digitalWrite(PIN_RELAY1, LOW);
  digitalWrite(PIN_RELAY2, LOW);
  pinMode(PIN_BUTTON, INPUT);
  if (PIN_RS485_DE >= 0) {
    pinMode(PIN_RS485_DE, OUTPUT);
    digitalWrite(PIN_RS485_DE, LOW);   // por defecto en recepcion
  }

  memset(seen, 0, sizeof(seen));
  loadConfig();
  openRS485(cfg.baud);

  Serial.println();
  Serial.println(F("#########################################################"));
  Serial.println(F("#   OLIMEX ESP32-EVB  <-RS485->  AccessPRO PRO12RF      #"));
  Serial.println(F("#   Probador de lecturas de tags UHF                    #"));
  Serial.println(F("#########################################################"));
  printStatus();
  printHelp();
  Serial.println(F("[INFO] Escuchando RS485... Pidiendo informacion al lector:"));
  cmdGetInfo();
}

void loop() {
  consoleTask();
  rs485Task();
  relayTask();
  buttonTask();

  if (cfg.poll && millis() - lastPollMs >= cfg.pollMs) {
    lastPollMs = millis();
    cmdInventory();
  }
}
