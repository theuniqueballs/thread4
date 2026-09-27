import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const src = 'upload/t4-08-imgs';
const dst = 'upload/t4-08-imgs-small';
fs.mkdirSync(dst, { recursive: true });
const files = fs.readdirSync(src).filter((f) => f.endsWith('.webp'));
for (const f of files) {
  const out = path.join(dst, f.replace(/\.webp$/, '.jpg'));
  const meta = await sharp(path.join(src, f)).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(out);
  console.log(f.slice(0, 8), meta.width + 'x' + meta.height, Math.round(meta.size / 1024) + 'KB');
}
console.log('DONE', files.length);
