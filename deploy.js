#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');

/**
 * Simple deployment script for Vendetta plugins
 * Serves JavaScript files with proper CORS headers
 */

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

function serveCORS(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  const filePath = req.url === '/' ? '/MessageLogger/index.js' : req.url;
  const fullPath = path.join(__dirname, filePath);
  
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
    
    // Set proper content type for JavaScript
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json');
    }
    
    res.writeHead(200);
    res.end(data);
  });
}

const server = http.createServer(serveCORS);

server.listen(PORT, HOST, () => {
  console.log(`Plugin server running at http://${HOST}:${PORT}/`);
  console.log(`Plugin URL: http://${HOST}:${PORT}/MessageLogger/index.js`);
  console.log(`Manifest URL: http://${HOST}:${PORT}/MessageLogger/manifest.json`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try a different port:`);
    console.error(`PORT=3001 node deploy.js`);
  } else {
    console.error('Server error:', err);
  }
});