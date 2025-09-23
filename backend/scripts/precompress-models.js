const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const modelsDir = path.join(__dirname, '..', 'models');

if (!fs.existsSync(modelsDir)) {
  console.error('Models directory does not exist:', modelsDir);
  process.exit(1);
}

const files = fs.readdirSync(modelsDir).filter(f => f.toLowerCase().endsWith('.glb'));

files.forEach(file => {
  const src = path.join(modelsDir, file);
  const gzPath = src + '.gz';
  const brPath = src + '.br';

  const stat = fs.statSync(src);

  // Gzip
  try {
    let doGzip = true;
    if (fs.existsSync(gzPath)) {
      const gzStat = fs.statSync(gzPath);
      if (gzStat.mtimeMs >= stat.mtimeMs) doGzip = false;
    }
    if (doGzip) {
      const inp = fs.createReadStream(src);
      const out = fs.createWriteStream(gzPath);
      const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
      inp.pipe(gzip).pipe(out);
      out.on('finish', () => console.log('Wrote', gzPath));
    }
  } catch (e) {
    console.error('Gzip failed for', src, e);
  }

  // Brotli
  try {
    let doBr = true;
    if (fs.existsSync(brPath)) {
      const brStat = fs.statSync(brPath);
      if (brStat.mtimeMs >= stat.mtimeMs) doBr = false;
    }
    if (doBr) {
      const inp = fs.createReadStream(src);
      const out = fs.createWriteStream(brPath);
      const brotli = zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
      inp.pipe(brotli).pipe(out);
      out.on('finish', () => console.log('Wrote', brPath));
    }
  } catch (e) {
    console.error('Brotli failed for', src, e);
  }
});

console.log('Precompress complete');
