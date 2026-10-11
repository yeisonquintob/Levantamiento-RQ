/**
 * Escritor mínimo de ZIP sin compresión (método «store»). Los PNG ya están comprimidos, así que
 * no hace falta una librería: se escriben las cabeceras locales, el directorio central y el
 * registro final de un ZIP estándar (nombres en UTF-8).
 */
export interface ZipEntry {
  /** Ruta dentro del ZIP; usa «/» para carpetas (p. ej. `web/01-login-web.png`). */
  name: string;
  data: Uint8Array;
  modified?: Date;
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc =
      (CRC_TABLE[(crc ^ (data[index] as number)) & 0xff] as number) ^
      (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff)
    throw new Error("El ZIP admite como máximo 65535 archivos.");
  const encoder = new TextEncoder();
  const records = entries.map((entry) => {
    if (entry.data.length > 0xfffffffe)
      throw new Error("Un archivo supera el tamaño máximo del ZIP.");
    const stamp = dosDateTime(entry.modified ?? new Date());
    return {
      entry,
      name: encoder.encode(entry.name),
      crc: crc32(entry.data),
      stamp,
      offset: 0,
    };
  });

  let size = 22;
  for (const record of records)
    size +=
      30 +
      record.name.length +
      record.entry.data.length +
      46 +
      record.name.length;
  if (size > 0xfffffffe) throw new Error("El ZIP supera los 4 GB.");

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let position = 0;
  const u16 = (value: number) => {
    view.setUint16(position, value, true);
    position += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(position, value, true);
    position += 4;
  };
  const bytes = (value: Uint8Array) => {
    out.set(value, position);
    position += value.length;
  };

  for (const record of records) {
    record.offset = position;
    u32(0x04034b50);
    u16(20); // versión necesaria
    u16(0x0800); // nombres en UTF-8
    u16(0); // sin compresión
    u16(record.stamp.time);
    u16(record.stamp.date);
    u32(record.crc);
    u32(record.entry.data.length);
    u32(record.entry.data.length);
    u16(record.name.length);
    u16(0);
    bytes(record.name);
    bytes(record.entry.data);
  }

  const directoryStart = position;
  for (const record of records) {
    u32(0x02014b50);
    u16(20); // versión con la que se creó
    u16(20); // versión necesaria
    u16(0x0800);
    u16(0);
    u16(record.stamp.time);
    u16(record.stamp.date);
    u32(record.crc);
    u32(record.entry.data.length);
    u32(record.entry.data.length);
    u16(record.name.length);
    u16(0); // extra
    u16(0); // comentario
    u16(0); // disco
    u16(0); // atributos internos
    u32(0); // atributos externos
    u32(record.offset);
    bytes(record.name);
  }
  const directorySize = position - directoryStart;

  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(records.length);
  u16(records.length);
  u32(directorySize);
  u32(directoryStart);
  u16(0);
  return out;
}
