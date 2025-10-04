// CommonJS handler – safest for functions-only projects on Vercel
module.exports = (req, res) => {
  res.setHeader('content-type', 'application/json');
  res.status(200).send(JSON.stringify({ ok: true, t: Date.now() }));
};
