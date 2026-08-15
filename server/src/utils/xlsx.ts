/**
 * Minimal XLSX writer — ไม่มี dependency ภายนอก
 *
 * ไฟล์ .xlsx จริง ๆ คือ zip ที่บรรจุ XML (SpreadsheetML) หลายชิ้น
 * เราสร้าง zip ด้วยวิธี STORE (ไม่บีบอัด — ทุกโปรแกรมเปิดได้) แล้วเขียน XML เอง:
 *   - เซลล์ข้อความใช้ inlineStr (Excel รองรับเต็มที่ ไม่ต้อง sharedStrings)
 *   - ตัวเลขเก็บเป็นตัวเลขจริง → คำนวณใน Excel ได้
 *   - ชื่อชีตต้อง ≤ 31 ตัวอักษร และห้ามมีอักขระ []:*?/\
 */

export type XlsxCell = string | number | null | undefined

export interface XlsxSheet {
  name: string
  rows: XlsxCell[][]
  /** แถวแรกเป็นหัวตาราง — ตัวหนา + พื้นเทาอ่อน */
  headerRow?: boolean
  /** ใส่เส้นขอบบางทุกเซลล์ (เหมาะกับแบบฟอร์ม/ใบนำส่ง) */
  borders?: boolean
  /** ความกว้างคอลัมน์ (หน่วยอักขระ) — ตัวแรก = คอลัมน์ A */
  colWidths?: number[]
  /** แถวที่ต้องการตัวหนา (0-based) — เช่น หัวข้อส่วนในแบบฟอร์ม */
  boldRows?: number[]
}

/* ================= zip (STORE) ================= */

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(d = new Date()): { date: number; time: number } {
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  return { date, time }
}

interface ZipItem {
  name: string
  data: Buffer
  crc: number
  date: number
  time: number
  offset: number
}

/** สร้าง zip (method STORE + UTF-8 flag) จากรายการไฟล์ */
export function zipStore(files: { name: string; data: Buffer }[]): Buffer {
  const now = new Date()
  const items: ZipItem[] = []
  const chunks: Buffer[] = []
  let offset = 0

  for (const f of files) {
    const { date, time } = dosDateTime(now)
    const crc = crc32(f.data)
    const nameBuf = Buffer.from(f.name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed to extract
    local.writeUInt16LE(0x0800, 6) // flags: filename UTF-8
    local.writeUInt16LE(0, 8) // compression method: 0 = STORE
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(f.data.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    chunks.push(local, nameBuf, f.data)
    items.push({ name: f.name, data: f.data, crc, date, time, offset })
    offset += local.length + nameBuf.length + f.data.length
  }

  // central directory
  const central: Buffer[] = []
  let centralOffset = 0
  for (const it of items) {
    const nameBuf = Buffer.from(it.name, 'utf8')
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0) // central directory signature
    cd.writeUInt16LE(20, 4) // version made by
    cd.writeUInt16LE(20, 6) // version needed
    cd.writeUInt16LE(0x0800, 8) // flags: UTF-8
    cd.writeUInt16LE(0, 10) // method: STORE
    cd.writeUInt16LE(it.time, 12)
    cd.writeUInt16LE(it.date, 14)
    cd.writeUInt32LE(it.crc, 16)
    cd.writeUInt32LE(it.data.length, 20)
    cd.writeUInt32LE(it.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30) // extra length
    cd.writeUInt16LE(0, 32) // comment length
    cd.writeUInt16LE(0, 34) // disk number
    cd.writeUInt16LE(0, 36) // internal attrs
    cd.writeUInt32LE(0, 38) // external attrs
    cd.writeUInt32LE(it.offset, 42) // local header offset
    central.push(cd, nameBuf)
    centralOffset += cd.length + nameBuf.length
  }

  // end of central directory
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // EOCD signature
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // disk with central dir
  eocd.writeUInt16LE(items.length, 8)
  eocd.writeUInt16LE(items.length, 10)
  eocd.writeUInt32LE(centralOffset, 12)
  eocd.writeUInt32LE(offset, 16) // central dir offset
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...chunks, ...central, eocd])
}

/* ================= SpreadsheetML ================= */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31)
  return cleaned || 'ชีต'
}

/* สไตล์ index ใน cellXfs: 0=ปกติ 1=หัวหนา 2=หัวหนา+พื้น+ขอบ 3=ขอบบาง */
const STYLE_NORMAL = 0
const STYLE_BOLD = 1
const STYLE_HEADER_BORDER = 2
const STYLE_BORDER = 3

/** XML ของหนึ่งชีต — ข้อความใช้ inlineStr, ตัวเลขใช้ <v> */
function sheetXml(rows: XlsxCell[][], headerRow: boolean, borders: boolean, colWidths?: number[], boldRows?: number[]): Buffer {
  const body: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>']
  body.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
  if (colWidths && colWidths.length > 0) {
    body.push('<cols>')
    colWidths.forEach((w, i) => {
      body.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    })
    body.push('</cols>')
  }
  body.push('<sheetData>')
  rows.forEach((row, ri) => {
    const isHeader = headerRow && ri === 0
    const isBold = boldRows?.includes(ri) ?? false
    const cells = row
      .map((cell, ci) => {
        if (cell === null || cell === undefined) return ''
        let s = STYLE_NORMAL
        if (borders) s = isHeader || isBold ? STYLE_HEADER_BORDER : STYLE_BORDER
        else if (isHeader || isBold) s = STYLE_BOLD
        const ref = `${colName(ci)}${ri + 1}`
        if (typeof cell === 'number') {
          return `<c r="${ref}" s="${s}"><v>${Number.isInteger(cell) ? cell : String(cell)}</v></c>`
        }
        return `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`
      })
      .join('')
    body.push(`<row r="${ri + 1}">${cells}</row>`)
  })
  body.push('</sheetData>')
  body.push('</worksheet>')
  return Buffer.from(body.join(''), 'utf8')
}

/** ไฟล์ styles.xml — ฟอนต์/พื้น/เส้นขอบ ขั้นต่ำสำหรับหัวตารางและแบบฟอร์ม */
function stylesXml(): Buffer {
  const xml = `${XML_DECL}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Tahoma"/></font>
    <font><b/><sz val="11"/><name val="Tahoma"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1EDE3"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF9A8C6F"/></left>
      <right style="thin"><color rgb="FF9A8C6F"/></right>
      <top style="thin"><color rgb="FF9A8C6F"/></top>
      <bottom style="thin"><color rgb="FF9A8C6F"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
  return Buffer.from(xml, 'utf8')
}

/** ชื่อคอลัมน์ A, B, ... Z, AA, AB ... */
function colName(i: number): string {
  let n = i
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** รวมทุกส่วนเป็นไฟล์ .xlsx ที่เปิดได้ใน Excel/Sheets/Numbers */
export function buildXlsx(sheets: XlsxSheet[]): Buffer {
  if (sheets.length === 0) throw new Error('ต้องมีอย่างน้อย 1 ชีต')
  const names = new Set<string>()
  const sheetFiles = sheets.map((s, i) => {
    let name = safeSheetName(s.name)
    let n = 2
    while (names.has(name)) name = `${safeSheetName(s.name)}${n++}`
    names.add(name)
    return { name, file: `xl/worksheets/sheet${i + 1}.xml`, xml: sheetXml(s.rows, s.headerRow ?? false, s.borders ?? false, s.colWidths, s.boldRows) }
  })

  const contentTypes = `${XML_DECL}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetFiles.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n  ')}
</Types>`

  const rels = `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const workbookRels = `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetFiles.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n  ')}
  <Relationship Id="rId${sheetFiles.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const workbook = `${XML_DECL}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheetFiles.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n    ')}
  </sheets>
</workbook>`

  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    { name: 'xl/styles.xml', data: stylesXml() },
    ...sheetFiles.map((s) => ({ name: s.file, data: s.xml })),
  ]
  return zipStore(files)
}
