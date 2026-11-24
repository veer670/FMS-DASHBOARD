'use strict';
// Vercel entry point: every address is routed here by vercel.json.
// The token and other settings come from Vercel > Settings > Environment Variables.
const { handler } = require('../lib/app');

module.exports = async (req, res) => {
  try {
    await handler(req, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'text/plain'); res.end('Server error. See the Logs tab in Vercel.'); }
  }
};
