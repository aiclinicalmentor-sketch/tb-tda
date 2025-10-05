// api/tb_peds_tda.js
module.exports = async (req, res) => {
  // Always respond as JSON
  res.setHeader("content-type", "application/json");

  const API_KEY = process.env.TB_PEDS_TDA_API_KEY || "";

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!API_KEY) {
    res.status(500).json({ error: "Server misconfigured: missing API key" });
    return;
  }
  if ((req.headers.authorization || "") !== `Bearer ${API_KEY}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Robust JSON body parse (handles string body too)
  let body = {};
  try {
    body =
      typeof req.body === "object" && req.body
        ? req.body
        : JSON.parse(await readBody(req));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  // --- ECHO BLOCK (place BEFORE validation/logic) ---
  // Use URL to read query reliably in Vercel functions
  let echo = false;
  try {
    const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    echo = u.searchParams.get("echo") === "1";
  } catch {}
  if (echo) {
    return res.status(200).json({
      received: body,
      validation: {
        has_algorithm: !!body?.algorithm,
        has_age_band: !!body?.age_band,
        has_symptoms: !!body?.symptoms && typeof body.symptoms === "object",
      },
    });
  }
  // --- END ECHO BLOCK ---

  // Validate required keys early
  if (!body.algorithm || !body.age_band || !body.symptoms) {
    res.status(400).json({
      error: "BadRequest",
      message:
        "Body must include algorithm (A|B), age_band (<1y|1-5y|>5y), and symptoms (object).",
      example: {
        algorithm: "B",
        age_band: "1-5y",
        symptoms: { cough_gt_2w: true, weight_loss_or_ftt: true },
      },
    });
    return;
  }

  // Normalize common variants (en-dash vs hyphen, spacing)
  const algorithm = String(body.algorithm).toUpperCase().trim();
  const age_band = normalizeAgeBand(String(body.age_band));
  const symptoms = body.symptoms || {};
  const vitals = body.vitals || {};
  const cxr = body.cxr || {};

  // --- Scoring tables ---
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
  };
  const A_SYMPTOMS = {
    cough_gt_2w: 2,
    fever_gt_2w: 5,
    lethargy: 3,
    weight_loss_or_ftt: 3,
    haemoptysis: 4,
    night_sweats: 2,
    swollen_nodes: 4,
    tachycardia: 2,
    tachypnoea: -1,
  };
  const A_CXR = {
    cavities: 6,
    enlarged_nodes: 17,
    opacities: 5,
    miliary: 15,
    effusion: 8,
  };
  const TREAT_THRESHOLD = 11; // >10 meets threshold

  // Derive tachy flags if not provided explicitly
  const tachycardia =
    typeof symptoms.tachycardia === "boolean"
      ? symptoms.tachycardia
      : isTachycardic(age_band, vitals.hr);
  const tachypnoea =
    typeof symptoms.tachypnoea === "boolean"
      ? symptoms.tachypnoea
      : isTachypnoeic(age_band, vitals.rr);

  let score = 0;
  const explanation = [];

  if (algorithm === "B") {
    const entries = { ...symptoms, tachycardia, tachypnoea };
    for (const [k, v] of Object.entries(entries)) {
      if (v && B_POINTS[k] != null) {
        score += B_POINTS[k];
        explanation.push(`${human(k)} (+${B_POINTS[k]})`);
      }
    }
  } else {
    // Algorithm A
    const entriesA = { ...symptoms, tachycardia, tachypnoea };
    for (const [k, v] of Object.entries(entriesA)) {
      if (v && A_SYMPTOMS[k] != null) {
        score += A_SYMPTOMS[k];
        explanation.push(`${human(k)} (+${A_SYMPTOMS[k]})`);
      }
    }
    for (const [k, v] of Object.entries(cxr)) {
      if (v && A_CXR[k] != null) {
        score += A_CXR[k];
        explanation.push(`CXR ${human(k)} (+${A_CXR[k]})`);
      }
    }
  }

  res.status(200).json({
    algorithm,
    score,
    meets_threshold: score >= TREAT_THRESHOLD,
    explanation,
  });
};

// ---- helpers ----
function normalizeAgeBand(a) {
  // Accept "<2m","2–12m","2-12m","1–5y","1-5y",">5y"
  return a.replace(/–/g, "-").trim();
}
function isTachypnoeic(age, rr) {
  if (rr == null) return false;
  const a = normalizeAgeBand(age);
  if (a === "<2m") return rr >= 60;
  if (a === "2-12m") return rr >= 50;
  if (a === "1-5y") return rr >= 40;
  return rr >= 30; // >5y
}
function isTachycardic(age, hr) {
  if (hr == null) return false;
  const a = normalizeAgeBand(age);
  if (a === "<2m") return hr >= 170;
  if (a === "2-12m") return hr >= 160;
  if (a === "1-5y") return hr >= 140;
  return hr >= 120; // >5y
}
function human(k) {
  return k
    .replace(/_/g, " ")
    .replace("gt", ">")
    .replace("ftt", "FTT")
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d || "{}"));
  });
}
