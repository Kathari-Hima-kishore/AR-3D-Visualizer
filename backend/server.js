const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const portfinder = require('portfinder');
const compression = require('compression');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(compression());
// Use permissive CORS in development to support tunnels and forwarded ports.
// In production you should lock this down to a known origin.
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like curl or native apps)
    if (!origin) return callback(null, true);
    // Allow common localhost, 127.0.0.1 and known dev tunnels
    if (origin.includes('.devtunnels.ms') || origin.includes('.tunnels.ngrok.io') || origin.includes('.loca.lt')) {
      return callback(null, true);
    }
    const allowedOrigins = [
      'http://localhost:3000',
      'https://localhost:3000',
      'http://localhost:5000',
      'https://localhost:5000',
      'http://127.0.0.1:3000',
      'https://127.0.0.1:3000',
      'http://127.0.0.1:5000',
      'https://127.0.0.1:5000'
    ];
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    // Default deny
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  credentials: true
}));

// Ensure preflight requests are handled for all routes
app.options('*', (req, res) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Origin, Accept');
  res.sendStatus(204);
});
app.use(express.json());

// Middleware to dynamically set CORS headers
app.use((req, res, next) => {
  const allowedOrigin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', allowedOrigin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Create models directory if it doesn't exist
const modelsDir = path.join(__dirname, 'models');
if (!fs.existsSync(modelsDir)) {
  fs.mkdirSync(modelsDir, { recursive: true });
}

// Serve Draco decoder files
// Serve Draco decoder and models with CORS headers set on the static responses
app.use('/draco', express.static(path.join(__dirname, 'draco'), {
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// Serve models with support for Range requests and pre-compressed files when available.
// This streams bytes and allows clients to start rendering sooner without changing model quality.
app.get('/models/:file', (req, res) => {
  const fileName = req.params.file;
  const originalPath = path.join(modelsDir, fileName);

  if (!fs.existsSync(originalPath)) {
    return res.status(404).send('Not found');
  }

  // Always allow cross-origin requests for model files in dev/tunnel scenarios
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Accept-Encoding');

  // Determine if client accepts brotli or gzip
  const acceptEnc = req.headers['accept-encoding'] || '';
  let chosenPath = originalPath;
  let contentEncoding = '';

  // Prefer brotli if available and accepted
  if (acceptEnc.includes('br') && fs.existsSync(`${originalPath}.br`)) {
    chosenPath = `${originalPath}.br`;
    contentEncoding = 'br';
  } else if (acceptEnc.includes('gzip') && fs.existsSync(`${originalPath}.gz`)) {
    chosenPath = `${originalPath}.gz`;
    contentEncoding = 'gzip';
  }

  try {
    const stat = fs.statSync(chosenPath);
    const total = stat.size;
    const range = req.headers.range;

    // Content-Type for GLB (model/gltf-binary)
    res.setHeader('Content-Type', 'model/gltf-binary');
    if (contentEncoding) {
      res.setHeader('Content-Encoding', contentEncoding);
    }

    // Caching: long cache for files named optimized, shorter for others
    if (/-optimized/.test(fileName)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }

    if (range) {
      // Parse Range header: bytes=start-end
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`);
        return res.end();
      }

      const chunkSize = (end - start) + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);

      const stream = fs.createReadStream(chosenPath, { start, end });
      stream.on('open', () => stream.pipe(res));
      stream.on('error', (err) => {
        console.error('Stream error', err);
        res.sendStatus(500);
      });
    } else {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', total);
      const stream = fs.createReadStream(chosenPath);
      stream.on('open', () => stream.pipe(res));
      stream.on('error', (err) => {
        console.error('Stream error', err);
        res.sendStatus(500);
      });
    }
  } catch (err) {
    console.error('Error serving model:', err);
    res.status(500).send('Server error');
  }
});

// API Routes

// Get all GLB files
app.get('/api/models', (req, res) => {
  try {
    const files = fs.readdirSync(modelsDir);
    // Prefer optimized-draco variants when present to reduce client download sizes
    const glbFilesRaw = files.filter(file => file.toLowerCase().endsWith('.glb'));
    const optimizedSet = new Set(glbFilesRaw.filter(f => f.toLowerCase().includes('-optimized-draco')));
    const glbFiles = glbFilesRaw
      .map(file => {
        const isOptimized = file.toLowerCase().includes('-optimized-draco') || file.toLowerCase().includes('-optimized');
        return {
          name: file,
          path: `/models/${file}`,
          id: file.replace('.glb', ''),
          size: fs.statSync(path.join(modelsDir, file)).size,
          optimized: isOptimized
        };
      })
      // sort optimized files first
      .sort((a, b) => (a.optimized === b.optimized ? 0 : a.optimized ? -1 : 1));
    
    res.json(glbFiles);
  } catch (error) {
    console.error('Error reading models directory:', error);
    res.status(500).json({ error: 'Failed to read models directory' });
  }
});

// Get specific model info
app.get('/api/models/:id', (req, res) => {
  try {
    const { id } = req.params;
    const fileName = `${id}.glb`;
    const filePath = path.join(modelsDir, fileName);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    const stats = fs.statSync(filePath);
    res.json({
      name: fileName,
      path: `/models/${fileName}`,
      id: id,
      size: stats.size,
      modified: stats.mtime
    });
  } catch (error) {
    console.error('Error getting model info:', error);
    res.status(500).json({ error: 'Failed to get model info' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'GLB Viewer Backend is running' });
});


// Serve frontend build (React app) for all non-API/static routes
app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));
app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'frontend', 'build', 'index.html'));
});

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`HTTP Server running on http://localhost:${PORT}`);
  console.log(`Models directory: ${modelsDir}`);
  console.log(`Place your GLB files in the models directory`);
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New WebSocket connection established');

  ws.on('message', (message) => {
    console.log(`Received message: ${message}`);

    // Broadcast the message to all connected clients
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});
