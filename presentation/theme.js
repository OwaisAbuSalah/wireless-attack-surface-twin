// Writes the deck's colour scheme and theme name into ppt/theme/theme1.xml.
// pptxgenjs always writes the stock Office palette; scheme colours used on the slides
// (accent1…accent6, dk1/lt1/dk2/lt2, hyperlinks) resolve against this part.
const fs = require('fs');
const JSZip = require('jszip');

const SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function applyTheme(file, theme) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const parts = Object.keys(zip.files).filter((f) => /^ppt\/theme\/theme\d+\.xml$/.test(f));
  if (!parts.length) throw new Error('no theme part in ' + file);
  for (const part of parts) {
    let xml = await zip.file(part).async('string');
    for (const k of SLOTS) {
      const hex = theme.colors[k];
      if (!hex) continue;
      if (!/^[0-9A-Fa-f]{6}$/.test(hex)) throw new Error(`theme colour ${k} must be 6-digit hex, got ${hex}`);
      const re = new RegExp(`<a:${k}>[\\s\\S]*?</a:${k}>`);
      if (!re.test(xml)) throw new Error(`slot ${k} not found in ${part}`);
      xml = xml.replace(re, `<a:${k}><a:srgbClr val="${hex.toUpperCase()}"/></a:${k}>`);
    }
    if (theme.name) {
      xml = xml.replace(/(<a:theme\b[^>]*\bname=")[^"]*(")/, `$1${esc(theme.name)}$2`);
      xml = xml.replace(/(<a:clrScheme\b[^>]*\bname=")[^"]*(")/, `$1${esc(theme.name)}$2`);
    }
    if (theme.headFontFace) xml = xml.replace(/(<a:majorFont><a:latin typeface=")[^"]*(")/, `$1${esc(theme.headFontFace)}$2`);
    if (theme.bodyFontFace) xml = xml.replace(/(<a:minorFont><a:latin typeface=")[^"]*(")/, `$1${esc(theme.bodyFontFace)}$2`);
    zip.file(part, xml);
  }
  // repack without folder entries (some cloud viewers refuse packages that contain them);
  // [Content_Types].xml stays first, as in the original package
  const out = new JSZip();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    out.file(name, await entry.async('nodebuffer'), { createFolders: false });
  }
  const buf = await out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(file, buf);
}

module.exports = { applyTheme };
