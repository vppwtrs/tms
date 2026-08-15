/* ============================================================
   xlsx.js — เขียนไฟล์ .xlsx จริง (OOXML) แบบไม่พึ่ง library
   ทำไมไม่ใช้ SpreadsheetML .xls แบบเดิม: Excel เตือน "format and
   extension don't match" ทุกครั้งที่เปิด เพราะเนื้อในเป็น XML แต่
   นามสกุลเป็นไบนารีเก่า

   ZIP เขียนแบบ store (ไม่บีบอัด) — ไม่ต้องมี deflate ไฟล์ใหญ่ขึ้น
   แต่ Excel อ่านได้ปกติ และโค้ดสั้นพอที่จะตรวจสอบเองได้ทั้งหมด

   ใช้งาน:
     buildXlsx({ sheet:'Report', rows:[ [cell, cell...], ... ],
                 cols:[{w:18},...], autoFilter:'A2:W2', merges:['A1:W1'] })
     cell = ค่าดิบ (string/number/null) หรือ { v, s }  โดย s = ชื่อ style
   ============================================================ */
(function (root) {

  /* ---------- CRC32 ---------- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();

  /* ---------- ZIP (store only) ---------- */
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;

    // เวลาแบบ MS-DOS — Excel ไม่ได้ใช้ค่านี้ทำอะไร ใส่เวลาปัจจุบันไว้ให้ดูปกติ
    const d = new Date();
    const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
    const dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;

    for (const f of files) {
      const name = enc.encode(f.name);
      const data = enc.encode(f.data);
      const crc = crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);          // version needed
      lh.setUint16(6, 0x0800, true);      // bit 11 = ชื่อไฟล์เป็น UTF-8
      lh.setUint16(8, 0, true);           // method 0 = store
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + data.length;
    }

    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
                    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- XML ---------- */
  const x = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  // เลข column: 1 → A, 27 → AA
  function colName(n) {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s;
  }

  /* ---------- styles ----------
     ลำดับใน cellXfs คือ index ที่อ้างด้วย s="n" ห้ามสลับ           */
  const STYLE = { def: 0, title: 1, head: 2, total: 3, ok: 4, warn: 5, wrap: 6 };

  const STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="4">' +
        '<font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="12"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '</fonts>' +
      '<fills count="6">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF548235"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFC6E0B4"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC000"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"/><right style="thin"/><top style="thin"/>' +
        '<bottom style="thin"/><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="7">' +
        '<xf xfId="0" borderId="1" applyBorder="1"/>' +
        '<xf xfId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
          '<alignment horizontal="center" vertical="center"/></xf>' +
        '<xf xfId="0" fontId="2" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
          '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
        '<xf xfId="0" fontId="3" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1">' +
          '<alignment horizontal="center" vertical="center"/></xf>' +
        '<xf xfId="0" fillId="4" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
          '<alignment horizontal="center" vertical="center"/></xf>' +
        '<xf xfId="0" fillId="5" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
          '<alignment horizontal="center" vertical="center"/></xf>' +
        '<xf xfId="0" borderId="1" applyBorder="1" applyAlignment="1">' +
          '<alignment vertical="center" wrapText="1"/></xf>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* ---------- sheet ---------- */
  function sheetXml(o) {
    const rows = o.rows || [];
    let body = '';

    rows.forEach((row, ri) => {
      const r = ri + 1;
      let cells = '';
      row.forEach((raw, ci) => {
        const c = (raw && typeof raw === 'object' && !(raw instanceof Date)) ? raw : { v: raw };
        const v = c.v;
        if (v === null || v === undefined || v === '') {
          // เขียน cell ว่างด้วย ถ้ามี style — ไม่งั้นเส้นตารางจะขาด
          if (c.s) cells += `<c r="${colName(ci + 1)}${r}" s="${STYLE[c.s] ?? 0}"/>`;
          return;
        }
        const ref = colName(ci + 1) + r;
        const st = ` s="${STYLE[c.s] ?? STYLE.def}"`;
        if (typeof v === 'number' && isFinite(v)) {
          cells += `<c r="${ref}"${st}><v>${v}</v></c>`;
        } else {
          cells += `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
        }
      });
      body += `<row r="${r}">${cells}</row>`;
    });

    const cols = (o.cols && o.cols.length)
      ? '<cols>' + o.cols.map((c, i) =>
          `<col min="${i + 1}" max="${i + 1}" width="${c.w || 14}" customWidth="1"/>`).join('') + '</cols>'
      : '';

    const merges = (o.merges && o.merges.length)
      ? `<mergeCells count="${o.merges.length}">` +
        o.merges.map(m => `<mergeCell ref="${m}"/>`).join('') + '</mergeCells>'
      : '';

    // ลำดับ element ต้องตรงตาม CT_Worksheet เป๊ะ ๆ ไม่งั้น Excel ทิ้งทั้ง part
    // แล้วขึ้น "Load error. Line 1, column 0" ทั้งที่ XML ถูกต้องทุกอย่าง
    //   sheetFormatPr → cols → sheetData → autoFilter → mergeCells
    // (autoFilter มาก่อน mergeCells — สลับกันเมื่อไหร่ไฟล์เสียทันที)
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      cols +
      `<sheetData>${body}</sheetData>` +
      (o.autoFilter ? `<autoFilter ref="${o.autoFilter}"/>` : '') +
      merges +
      '</worksheet>';
  }

  /* ---------- workbook ---------- */
  function buildXlsx(o) {
    const name = (o.sheet || 'Sheet1').replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 31);

    return zip([
      { name: '[Content_Types].xml', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>' },

      { name: '_rels/.rels', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },

      { name: 'xl/workbook.xml', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${x(name)}" sheetId="1" r:id="rId1"/></sheets>` +
        '</workbook>' },

      { name: 'xl/_rels/workbook.xml.rels', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' },

      { name: 'xl/styles.xml', data: STYLES_XML },
      { name: 'xl/worksheets/sheet1.xml', data: sheetXml(o) }
    ]);
  }

  root.buildXlsx = buildXlsx;
  root.XLSX_STYLE = STYLE;
  root.xlsxColName = colName;

})(typeof window !== 'undefined' ? window : globalThis);
