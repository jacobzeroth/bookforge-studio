/* BookForge Studio — minimal ZIP writer (STORE method) with CRC-32.
   Used to build genuine DOCX and EPUB containers in the browser. */
(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(str) {
    return new TextEncoder().encode(String(str));
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return utf8(data == null ? "" : data);
  }

  function dosDateTime(date) {
    var d = date || new Date();
    var time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
    var day = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
    return { time: time, date: day };
  }

  function Writer(size) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
  }
  Writer.prototype.u16 = function (v) { this.view.setUint16(this.pos, v, true); this.pos += 2; };
  Writer.prototype.u32 = function (v) { this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; };
  Writer.prototype.bytes = function (b) { this.buf.set(b, this.pos); this.pos += b.length; };
  Writer.prototype.string = function (s) { this.bytes(utf8(s)); };

  /* entries: [{ name, data(string|Uint8Array), date?, unicode? }]
     `stored` (or entry.store === true) disables compression — compression is
     never applied anyway (STORE only), which keeps EPUB `mimetype` valid. */
  function create(entries, options) {
    options = options || {};
    var now = options.date || new Date();
    var prepared = entries.map(function (e) {
      var data = toBytes(e.data);
      var dt = dosDateTime(e.date || now);
      return {
        name: String(e.name),
        nameBytes: utf8(e.name),
        data: data,
        crc: crc32(data),
        time: dt.time,
        date: dt.date
      };
    });

    var localSize = 0, centralSize = 0;
    prepared.forEach(function (e) {
      localSize += 30 + e.nameBytes.length + e.data.length;
      centralSize += 46 + e.nameBytes.length;
    });
    var eocdSize = 22;
    var writer = new Writer(localSize + centralSize + eocdSize);

    prepared.forEach(function (e) {
      e.offset = writer.pos;
      writer.u32(0x04034b50);          // local file header
      writer.u16(20);                  // version needed
      writer.u16(0x0800);              // UTF-8 flag
      writer.u16(0);                   // method: store
      writer.u16(e.time);
      writer.u16(e.date);
      writer.u32(e.crc);
      writer.u32(e.data.length);       // compressed size
      writer.u32(e.data.length);       // uncompressed size
      writer.u16(e.nameBytes.length);
      writer.u16(0);                   // extra length
      writer.bytes(e.nameBytes);
      writer.bytes(e.data);
    });

    var centralStart = writer.pos;
    prepared.forEach(function (e) {
      writer.u32(0x02014b50);          // central directory header
      writer.u16(20);                  // version made by
      writer.u16(20);                  // version needed
      writer.u16(0x0800);              // UTF-8 flag
      writer.u16(0);                   // method: store
      writer.u16(e.time);
      writer.u16(e.date);
      writer.u32(e.crc);
      writer.u32(e.data.length);
      writer.u32(e.data.length);
      writer.u16(e.nameBytes.length);
      writer.u16(0);                   // extra
      writer.u16(0);                   // comment
      writer.u16(0);                   // disk number
      writer.u16(0);                   // internal attributes
      writer.u32(0);                   // external attributes
      writer.u32(e.offset);
      writer.bytes(e.nameBytes);
    });

    writer.u32(0x06054b50);            // end of central directory
    writer.u16(0);
    writer.u16(0);
    writer.u16(prepared.length);
    writer.u16(prepared.length);
    writer.u32(centralSize);
    writer.u32(centralStart);
    writer.u16(0);

    return new Blob([writer.buf], { type: options.mime || "application/zip" });
  }

  BF.zip = { create: create, crc32: function (data) { return crc32(toBytes(data)); } };
})();
