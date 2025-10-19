// /api/tb_peds_tda.js  — WHO-faithful scoring (Algorithms A & B)
// CommonJS for Vercel; keep your existing auth wrapper if you have one.

function isObject(v){ return v && typeof v === "object" && !Array.isArray(v); }

// ---------- WHO WEIGHTS ----------
const WHO_A_SYMPTOMS = {
  cough_gt_2w: 2,
  fever_gt_2w: 5,
  lethargy: 3,
  weight_loss_or_ftt: 3,
  haemoptysis: 4,
  night_sweats: 2,
  swollen_nodes: 4,
  tachycardia: 2,
  tachypnoea: -1,   // UK spelling
  tachypnea: -1     // US spelling -> same value
};

const WHO_A_CXR = {
  cavities: 6,                    // aliases normalized below
  enlarged_nodes: 17,             // hilar/mediastinal LAD
  opacities: 5,                   // opacity / consolidation / infiltrate
  miliary: 15,
  pleural_effusion: 8
};

const WHO_B_SYMPTOMS = {
  cough_gt_2w: 5,
  fever_gt_2w: 10,
  lethargy: 4,
  weight_loss_or_ftt: 5,
  haemoptysis: 9,
  night_sweats: 6,
  swollen_nodes: 7,
  tachycardia: 4,
  tachypnoea: 2,
  tachypnea: 2
};

// ---------- NORMALIZERS ----------
function normBool(v){ return v === true || v === "true" || v === 1; }

function normalizeSymptoms(raw){
  const s = isObject(raw) ? raw : {};
  return {
    cough_gt_2w:      normBool(s.cough_gt_2w ?? s.cough_2w_plus ?? s.cough14d_plus),
    fever_gt_2w:      normBool(s.fever_gt_2w ?? s.fever_2w_plus ?? s.fever14d_plus),
    lethargy:         normBool(s.lethargy ?? s.reduced_play ?? s.fatigue),
    weight_loss_or_ftt: normBool(s.weight_loss_or_ftt ?? s.weight_loss ?? s.poor_weight_gain ?? s.ftt),
    haemoptysis:      normBool(s.haemoptysis ?? s.hemoptysis),
    night_sweats:     normBool(s.night_sweats),
    swollen_nodes:    normBool(s.swollen_nodes ?? s.lymphadenopathy ?? s.peripheral_nodes),
    tachycardia:      normBool(s.tachycardia),
    tachypnoea:       normBool(s.tachypnoea),
    tachypnea:        normBool(s.tachypnea)
  };
}

function normalizeCxr(raw){
  const cxr = isObject(raw) ? raw : {};
  const any = (...ks)=>ks.some(k=>normBool(cxr[k]));

  const out = {
    opacities:        any("opacities","opacity","consolidation","infiltrate"),
    enlarged_nodes:   any("enlarged_nodes","hilar_lymphadenopathy","hilar_nodes","mediastinal_lymphadenopathy","mediastinal_nodes","adenopathy"),
    cavities:         any("cavities","cavity","cavitation"),
    miliary:          normBool(cxr.miliary),
    pleural_effusion: any("pleural_effusion","effusion"),
    performed:        cxr.performed !== false,
  };
  // Optional: derive 'normal' if performed and none positive
  out.normal = out.performed && !Object.entries(out).some(([k,v])=>["opacities","enlarged_nodes","cavities","miliary","pleural_effusion"].includes(k) && v);
  return out;
}

// ---------- SCORERS ----------
function scoreSymptoms(map, symptoms){
  return Object.entries(map).reduce((sum,[k,w]) => sum + (symptoms[k] ? w : 0), 0);
}
function scoreCxr(map, cxr){
  return Object.entries(map).reduce((sum,[k,w]) => sum + (cxr[k] ? w : 0), 0);
}

// ---------- HANDLER ----------
module.exports = async function handler(req, res){
  if (req.method !== "POST") return res.status(405).json({ error:"MethodNotAllowed" });

  // Auth (keep your existing key name)
  const API_KEY = process.env.TB_PEDS_TDA_API_KEY || "";
  if (!API_KEY) return res.status(500).json({ error:"ServerMisconfigured", message:"Missing API key" });
  if ((req.headers.authorization || "") !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error:"Unauthorized" });
  }

  const body = isObject(req.body) ? req.body : {};
  const algorithm = String(body.algorithm || "").toUpperCase();
  const age_band = body.age_band || null;

  if (!["A","B"].includes(algorithm)) {
    return res.status(400).json({ error:"BadRequest", message:"algorithm must be 'A' or 'B'" });
  }

  const symptoms = normalizeSymptoms(body.symptoms);
  const cxr = normalizeCxr(body.cxr);

  let result;

  if (algorithm === "A") {
    // WHO A: SumA (symptoms using WHO_A_SYMPTOMS) + SumB (CXR using WHO_A_CXR)
    const sumA = scoreSymptoms(WHO_A_SYMPTOMS, symptoms);
    const sumB = scoreCxr(WHO_A_CXR, cxr);

    const total = sumA + sumB;
    const treat = total > 10; // strict “>10” per WHO figs
    result = {
      algorithm: "A",
      age_band,
      sum_symptoms: sumA,
      sum_cxr: sumB,
      total_score: total,
      threshold_exceeded: treat,
      recommendation: treat ? "start_tb_treatment" : "reassess_in_1_2_weeks",
      detail: {
        symptom_hits: Object.entries(WHO_A_SYMPTOMS).filter(([k,w]) => symptoms[k]).map(([k])=>k),
        cxr_hits: Object.entries(WHO_A_CXR).filter(([k,w]) => cxr[k]).map(([k])=>k)
      }
    };
  } else {
    // WHO B: symptoms only, weights differ from A
    const sum = scoreSymptoms(WHO_B_SYMPTOMS, symptoms);
    const treat = sum > 10;
    result = {
      algorithm: "B",
      age_band,
      total_score: sum,
      threshold_exceeded: treat,
      recommendation: treat ? "start_tb_treatment" : "reassess_in_1_2_weeks",
      detail: {
        symptom_hits: Object.entries(WHO_B_SYMPTOMS).filter(([k,w]) => symptoms[k]).map(([k])=>k)
      }
    };
  }

  return res.status(200).json({ ok:true, input:{ algorithm, age_band, symptoms, cxr }, result });
};
