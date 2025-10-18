// /api/tb_peds_tda.js
// Vercel functions-only (CommonJS)
// Hardened: dual echo, strict validation, A-requires-CXR, normalization

module.exports = async (req, res) => {
  res.setHeader("content-type", "application/json");

  // ---- Method / Auth guards ----
  if (req.method !== "POST") {
    return res.status(405).json({ error: "MethodNotAllowed" });
  }

  const API_KEY = process.env.TB_PEDS_TDA_API_KEY || "";
  if (!API_KEY) {
    return res.status(500).json({ error: "ServerMisconfigured", message: "Missing API key" });
  }
  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ---- Parse body safely (supports raw JSON string || parsed object) ----
  let body = {};
  try {
    body =
      isObject(req.body) && Object.keys(req.body || {}).length
        ? req.body
        : JSON.parse(await readBody(req));
  } catch {
    return res.status(400).json({ error: "InvalidJSON" });
  }

  // ---- Echo mode (either ?echo=1 query || X-Debug-Echo: 1 header) ----
  let echo = false;
  try {
    const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    echo = u.searchParams.get("echo") === "1";
  } catch { /* noop */ }
  const echoHeader = (req.headers["x-debug-echo"] || "") === "1";
  const echoBody = body && (body.echo === "1" || body.echo === 1 || body.echo === true);
  if (echo || echoHeader || echoBody) {
    return res.status(200).json({
      received: body,
      validation: {
        has_algorithm: !!body?.algorithm,
        has_age_band: !!body?.age_band,
        has_symptoms_obj: isObject(body?.symptoms),
      },
    });
  }

  // ---- Early validation of required structure ----
  if (!body.algorithm || !body.age_band || !isObject(body.symptoms)) {
    return res.status(400).json({
      error: "BadRequest",
      message:
        "Body must include algorithm (A|B), age_band (<2m|2-12m|1-5y|>5y), and symptoms (object).",
      example: {
        algorithm: "B",
        age_band: "1-5y",
        symptoms: { cough_gt_2w: true, weight_loss_or_ftt: true },
      },
    });
  }

  // ---- Normalize inputs ----
  const algorithm = String(body.algorithm).toUpperCase().trim(); // "A" | "B"
  const age_band = normalizeAgeBand(String(body.age_band));
  const symptoms = isObject(body.symptoms) ? body.symptoms : {};
  const vitals = isObject(body.vitals) ? body.vitals : {};
  const cxr = isObject(body.cxr) ? body.cxr : {};

  // Validate enums
  if (!["A", "B"].includes(algorithm)) {
    return res.status(400).json({ error: "BadRequest", message: 'algorithm must be "A" || "B"' });
  }
  const allowedAgeBands = new Set(["<2m", "2-12m", "1-5y", ">5y"]);
  if (!allowedAgeBands.has(age_band)) {
    return res.status(400).json({
      error: "BadRequest",
      message: 'age_band must be one of "<2m","2-12m","1-5y",">5y"',
    });
  }

  // ---- Enforce: Algorithm A requires at least one CXR finding true ----
  const CXR_KEYS = ["cavities", "enlarged_nodes", "opacities", "miliary", "effusion"];
  if (algorithm === "A" && !hasAnyTrue(cxr, CXR_KEYS)) {
    return res.status(400).json({
      error: "BadRequest",
      message: "Algorithm A requires CXR findings. Use Algorithm B when CXR is not available.",
    });
  }

  // ---- COMPUTE (defensive wrapper) ----
try {
// ---- Scoring tables ----
  const B_POINTS = {
    cough_gt_2w: 5,
    fever_gt_2w: 10,
    lethargy: 4,
    weight_loss_or_ftt: 5,
    haemoptysis: 9,
    night_sweats: 6,
    swollen_nodes: 7,
    tachycardia: 4,
    tachypnoea: 2,
  
} catch (err) {
  console.error('tb_peds_tda runtime error:', err);
  return res.status(500).json({
    error: 'InternalError',
    message: 'Unexpected error while evaluating TB algorithm.',
    dev_hint: (err && err.message) || String(err),
  });
}
};
  const A_SYMPTOMS = {
    c
