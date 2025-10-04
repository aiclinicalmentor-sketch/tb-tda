module.exports = (req, res) => {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy</title>
<main style="max-width:720px;margin:48px auto;padding:0 16px;line-height:1.6;font-family:system-ui,sans-serif">
  <h1>Privacy Policy</h1>
  <p>Last updated: ${(new Date()).toISOString().split('T')[0]}</p>
  <p>This API is called by a ChatGPT Action. Requests include only the payload you submit and standard headers.
     No data is sold or shared. Logs may include timestamps, paths, status codes, and request bodies for debugging.</p>
  <h2>Data Collected</h2>
  <ul><li>Request payloads you submit</li><li>Server logs (timestamp, path, status)</li></ul>
  <h2>Purpose</h2><p>To process clinical scoring requests and return results.</p>
  <h2>Retention</h2><p>Short-term for debugging; logs are rotated by the platform.</p>
  <h2>Contact</h2><p>you@example.com</p>
</main></html>`;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.status(200).send(html);
};
