// /api/tb_peds_tda.js
// Vercel Node.js Serverless Function (CommonJS)

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

// Canonical CXR keys for Algorithm A
const CXR_KEYS = ["opacities","enlarged_nodes","cavities","miliary","pleural_effusion","atelectasis"];

// ---- CXR alias normalizer (reads only from body.cxr) ----
function normalizeCxr(raw) {
  const cxr = isObject(raw) ? raw : {};
  const anyTrue = (o, ...keys) => keys.some(k => !!o[k]);

  const opacities = !!(cxr.opacities ?? cxr.opacity ?? cxr.consolidation ?? cxr.infiltrate);
  const enlarged_nodes = anyTrue(
    cxr,
    "enlarged_nodes",
    "hilar_lymphadenopathy",
    "hilar_nodes",
    "mediastinal_lymphadenopathy",
    "mediastinal_nodes"
  );
  const cavities = !!(cxr.cavities ?? cxr.cavity ?? cxr.cavitation);
  const miliary = !!cxr.miliary;
  const pleural_effusion = !!(cxr.pleural_effusion ?? cxr.effusion);
  const atelectasis = !!cxr.atelectasis;

  const normalized = { opacities, enlarged_nodes, cavities, miliary, pleural_effusion, atelectasis };

  // Optional coherence
  normalized.performed = cxr.performed !== false; // default true if not explicitly false
  normalized.normal = !CXR_KEYS.some(k => normalized[k] === true);

  return normalized;
}

module.exports = async function handler(req, res) {
  // ---- Method gate ----
  if (req.method !== "POST") {
    return res.status(405).json({ error: "MethodNotAllowed" });
  }

  // ---- Auth gate ----
  const API_KEY = process.env.TB_PEDS_TDA_API_KEY || "";
  if (!API_KEY) {
    return res.status(500).json({ error: "ServerMisconfigured", message: "Missing API key" });
  }
  const auth = String(req.headers.authorization || "");
  if (auth !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ---- Body parse ----
  let body = {};
  try {
    body = isObject(req.body) ? req.body : {};
  } catch {
    return res.status(400).json({ error: "InvalidJSON" });
  }

  // ---- Echo mode (query, header, or body) ----
  let echo = false;
  try {
    const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    echo = u.searchParams.get("echo") === "1";
  } catch {}
  const echoHeader = (req.headers["x-debug-echo"] || "") === "1";
  const echoBody = body && (body.echo === "1" || body.echo === 1 || body.echo === true);
  if (echo || echoHeader || echoBody) {
    return res.status(200).json({
      received: body,
      validation: {
        has_algorithm: !!body?.algorithm,
        has_age_band: !!body?.age_band,
        has_symptoms_obj: isObject(body?.symptoms),
        has_cxr_obj: isObject(body?.cxr)
      },
      hint: "Echo mode active (query/header/body). Remove echo to run compute."
    });
  }

  // ---- Required fields ----
  if (!body.algorithm || !body.age_band || !isObject(body.symptoms)) {
    return res.status(400).json({
      error: "BadRequest",
      message: "Required fields: algorithm, age_band, symptoms (object)"
    });
  }

  // ---- Normalize inputs ----
  const algorithm = String(body.algorithm).trim().toUpperCase(); // 'A' | 'B'
  const age_band = String(body.age_band).trim();                 // e.g., 'lt1y' | '1-5y' | 'gt5y'
  const symptoms = body.symptoms;
  const cxr = normalizeCxr(body.cxr);

  if (!["A", "B"].includes(algorithm)) {
    return res.status(400).json({ error: "BadRequest", message: "algorithm must be 'A' or 'B'" });
  }

  // ---- Validation specific to Algorithm A: require ≥1 positive CXR finding under cxr ----
  if (algorithm === "A") {
    const hasCxrFinding = CXR_KEYS.some(k => cxr[k] === true);
    if (!hasCxrFinding) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Algorithm A requires ≥1 positive CXR finding under 'cxr'."
      });
    }
  }

  // ---- COMPUTE (defensive wrapper) ----
  try {
    // Example B points (keep your existing mapping if different)
    const B_POINTS = {
      cough_gt_2w: 5,
      fever_gt_2w: 10,
      lethargy: 4,
      weight_loss_or_ftt: 5,
      haemoptysis: 9,
      night_sweats: 4,
      swollen_nodes: 7,
      tachycardia: 4,
      tachypnoea: 2, // accept UK spelling in symptoms
      tachypnea: 2   // and US spelling
    };

    const stratify = (score) => (score >= 15 ? "high" : score >= 8 ? "moderate" : "low");

    let result;

    if (algorithm === "B") {
      let score = 0;
      for (const [k, w] of Object.entries(B_POINTS)) {
        if (symptoms[k]) score += w;
      }
      result = {
        algorithm: "B",
        age_band,
        score,
        risk_band: stratify(score),
        next_steps: [
          "Consider TB testing per local protocol (e.g., Xpert MTB/RIF).",
          "Assess for alternative diagnoses and severity.",
          "If risk is high or concern persists, escalate for imaging/specialist review."
        ]
      };
    } else {
      // Algorithm A: CXR-driven (use ONLY cxr for CXR hits)
      const cxr_count = CXR_KEYS.reduce((n, k) => n + (cxr[k] ? 1 : 0), 0);

      // If you also add symptom weight in A, count non-CXR symptoms from `symptoms`
      const nonCxrSymptomCount = Object.values(symptoms).reduce((n, v) => n + (v ? 1 : 0), 0);

      const score = cxr_count * 5 + nonCxrSymptomCount * 1;

      result = {
        algorithm: "A",
        age_band,
        score,
        cxr_hits: CXR_KEYS.filter(k => cxr[k]),
        cxr: { ...cxr, normal: !CXR_KEYS.some(k => cxr[k]) },
        risk_band: stratify(score),
        next_steps: [
          "Review CXR with a TB-experienced clinician.",
          "Proceed with appropriate TB diagnostics based on age/capacity."
        ]
      };
    }

    return res.status(200).json({
      ok: true,
      input: { algorithm, age_band, symptoms, cxr },
      result
    });
  } catch (err) {
    console.error("tb_peds_tda runtime error:", err);
    return res.status(500).json({
      error: "InternalError",
      message: "Unexpected error while evaluating TB algorithm.",
      dev_hint: (err && err.message) || String(err)
    });
  }
};
