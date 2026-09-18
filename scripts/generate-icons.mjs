import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}
mkdirSync('public/icons', { recursive: true });
for (const size of [192, 512]) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = (x / size) * 128,
        py = (y / size) * 128;
      let color = [32, 59, 52];
      if (py >= 80 && py < 101 && px > 60 && px < 68) color = [217, 195, 147];
      if (py >= 40 && py < 86 && Math.abs(px - 64) < (py - 40) * 0.63) color = [217, 195, 147];
      if (py >= 31 && py < 66 && Math.abs(px - 64) < (py - 31) * 0.57) color = [170, 190, 146];
      if (py >= 100 && py < 103 && px > 30 && px < 98) color = [129, 154, 112];
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      rows.set([...color, 255], offset);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(
    `public/icons/icon-${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
