// /api/tb_peds_tda.js
// Vercel Node.js Serverless Function (CommonJS)
//
// Fixes:
//  - Supports echo via query (?echo=1), header (X-Debug-Echo: 1), and body ("echo": "1"/1/true)
//  - Defensive try/catch around COMPUTE section (balanced braces)
//  - Strict auth + validation preserved
//
// Replace your /api/tb_peds_tda.js with this file's content.

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

const CXR_KEYS = ["cavities","enlarged_nodes","opacities","miliary","pleural_effusion","atelectasis"];

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
  const expected = `Bearer ${API_KEY}`;
  if (auth !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ---- Body parse (Vercel already parses JSON; keep defensive) ----
  let body = {};
  try {
    body = isObject(req.body) ? req.body : {};
  } catch (_e) {
    return res.status(400).json({ error: "InvalidJSON" });
  }

  // ---- Echo mode (query, header, or body) ----
  let echo = false;
  try {
    const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    echo = u.searchParams.get("echo") === "1";
  } catch (_e) { /* noop */ }
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
      hint: "Echo mode active (query/header/body). Remove echo to run compute."
    });
  }

  // ---- Required fields ----
  if (!body.algorithm || !body.age_band || !isObject(body.symptoms)) {
    return res.status(400).json({
      error: "BadRequest",
      message: "Required fields: algorithm, age_band, symptoms (object)",
    });
  }

  // ---- Normalize & validate enums ----
  const algorithm = String(body.algorithm).trim().toUpperCase(); // 'A' or 'B'
  const age_band = String(body.age_band).trim();                 // 'lt1y' | '1-5y' | 'gt5y'
  const symptoms = body.symptoms;

  if (!["A", "B"].includes(algorithm)) {
    return res.status(400).json({ error: "BadRequest", message: "algorithm must be 'A' or 'B'" });
  }

  if (algorithm === "A") {
    const hasCXR = CXR_KEYS.some(k => !!symptoms[k]);
    if (!hasCXR) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Algorithm A requires ≥1 CXR finding to be true",
      });
    }
  }

  // ---- COMPUTE (defensive wrapper; BALANCED BRACES) ----
  try {
    // --- Example scoring for Algorithm B (replace with your exact logic if different) ---
    const B_POINTS = {
      cough_gt_2w: 5,
      fever_gt_2w: 10,
      lethargy: 4,
      weight_loss_or_ftt: 5,
      haemoptysis: 9,
      night_sweats: 4,
      swollen_nodes: 7,
      tachycardia: 4,
      tachypnoea: 2,
    };

    const stratify = (score) => {
      if (score >= 15) return "high";
      if (score >= 8) return "moderate";
      return "low";
    };

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
        ],
      };
    } else {
      // Minimal A placeholder: weight CXR findings more heavily
      const cxr_count = CXR_KEYS.reduce((n, k) => n + (symptoms[k] ? 1 : 0), 0);
      const nonCxrKeys = Object.keys(symptoms).filter(k => !CXR_KEYS.includes(k));
      const s_count = nonCxrKeys.reduce((n, k) => n + (symptoms[k] ? 1 : 0), 0);
      const score = cxr_count * 5 + s_count * 1;

      result = {
        algorithm: "A",
        age_band,
        score,
        cxr_hits: CXR_KEYS.filter(k => !!symptoms[k]),
        risk_band: stratify(score),
        next_steps: [
          "Review CXR with a TB-experienced clinician.",
          "Proceed with appropriate TB diagnostics based on age/capacity."
        ],
      };
    }

    return res.status(200).json({ ok: true, input: { algorithm, age_band, symptoms }, result });
  } catch (err) {
    console.error("tb_peds_tda runtime error:", err);
    return res.status(500).json({
      error: "InternalError",
      message: "Unexpected error while evaluating TB algorithm.",
      dev_hint: (err && err.message) || String(err),
    });
  }
};
