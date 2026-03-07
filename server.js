const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => res.json({ status: 'OK', agents: 10, pdf: 'puppeteer-ready' }));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VERIFIED DATA — injected into every agent prompt
// Agents must NOT search for these facts. Use directly as ground truth.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const VERIFIED_DATA = `
═══════════════════════════════════════════════════════════════════
VERIFIED DATA — USE DIRECTLY. DO NOT SEARCH FOR THESE FACTS.
═══════════════════════════════════════════════════════════════════

YOGABAR (Sproutlife Foods Pvt Ltd):
• FY22 Revenue: ₹68 Cr | FY24: ₹110 Cr | FY25: ₹201.66 Cr | FY26 target: ~₹340 Cr
• YoY growth: FY24→FY25: 83%. FY25→FY26 target implies ~69% growth.
• Channel mix (FY25 estimate): D2C/E-commerce ~65%, Modern Trade ~30%, Quick Commerce ~3%, Other ~2%
• Brand: "Real Ingredients, No Compromise" — clean label, functional nutrition
• Core consumer: Urban millennial 25-40, health-conscious, premium buyer
• Manufacturing: Co-packers (Bengaluru-based)
• SKUs: ~50+ across nutrition bars, muesli, oats, cereals, breakfast biscuits
• Price range: ₹35 (single bar) to ₹600+ (large-format muesli)
• Currently loss-making — entirely normal for D2C brands investing aggressively in share capture.
  Do not flag this as a concern. Context: ITC's share of losses ₹12 Cr in FY25.

ITC ACQUISITION TIMELINE:
• Binding term sheet signed: 16 January 2023
• First stake (39.42%) completed: May 2023 — ₹175 Cr consideration
• ITC's plan: acquire 100% over 3-4 years from Jan 2023
• As of March 2026: ITC holds majority stake; full 100% acquisition due mid-2026
  (within 3 months of Yogabar filing FY26 results)

ITC LIMITED (ACQUIRER) — FROM OFFICIAL ITC ANNUAL REPORTS & Q3 FY26 RESULTS:
• FMCG Others segment revenue FY20: ₹12,844 Cr → FY25: ₹22,005 Cr
• FMCG Others 5-year revenue CAGR (FY20–FY25): 11.3%
• FMCG Others 5-year Segment Results (profit) CAGR (FY20–FY25): 30%
• FMCG Others EBITDA margin FY25: 9.8%
• Digital-first & Organic portfolio ARR (Yogabar + Mother Sparsh + Prasuma + 24 Mantra combined): ~₹1,100 Cr
• ITC total revenue FY25: ₹81,613 Cr
• Distribution: 2.9M outlets direct reach; 7M+ outlets total ITC availability
• Manufacturing: 200+ factories across India
• ITC Hotels: 120+ properties (ITC holds 39.88% stake post-demerger Jan 2025)
• ITC Agri Division: strategic sourcing — oats, cashews, spices, wheat
• ITC Life Sciences & Technology Centre (LSTC): R&D facility, Bengaluru — food science & clinical validation
• Key FMCG brands: Aashirvaad, Sunfeast, Bingo!, Yippee!, Fiama, Vivel, Savlon, Classmate, Mangaldeep

KNOWN COMPETITORS (search to verify current revenues and growth rates):
• Direct premium: Whole Truth Foods, True Elements, Baggry's, RiteBite Max Protein
• Indirect: Kellogg's, Britannia NutriChoice, Tata Soulfull
• Emerging: Super You, QC-native health snack brands

INDUSTRY CONTEXT (search to verify exact current figures):
• Healthy snacks / nutrition category India: ~₹45,000 Cr (ITC's own filing at acquisition, Jan 2023)
• Quick Commerce share of nutrition category: rapidly growing — search for current %
• Functional nutrition segment growth rate: search for current YoY figure
═══════════════════════════════════════════════════════════════════
`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AGENT-SPECIFIC DATA_BLOCK SCHEMAS
// Each agent gets a schema tailored to its visual requirements
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const DATA_BLOCK_SCHEMAS = {

  market: `<<<DATA_BLOCK>>>
{
  "agent": "market",
  "kpis": [
    {"label": "D2C Nutrition Segment Size", "value": "CURRENCY X,XXX UNIT", "sub": "the insurgent sub-segment Yogabar competes in — NOT the total ₹45,000 Cr FMCG category", "trend": "up", "confidence": "H|M|L"},
    {"label": "Yogabar Share in D2C Segment", "value": "X.X%", "sub": "share within D2C/premium nutrition segment, not total FMCG — e.g. ₹202Cr / CURRENCY X,XXXCr segment", "trend": "up", "confidence": "H|M|L"},
    {"label": "D2C Segment YoY Growth", "value": "XX%", "sub": "growth rate of the insurgent D2C sub-segment, not blended category average", "trend": "up", "confidence": "H|M|L"},
    {"label": "QC Share of Nutrition Revenue", "value": "XX%", "sub": "QC as % of Yogabar revenue — shows penetration gap", "trend": "up", "confidence": "H|M|L"}
  ],
  "competitorBubbles": [
    {"name": "Yogabar", "growthRate": 83, "brandStrength": 72, "revenueCr": 202, "highlight": true},
    {"name": "Whole Truth", "growthRate": 0, "brandStrength": 0, "revenueCr": 0},
    {"name": "RiteBite", "growthRate": 0, "brandStrength": 0, "revenueCr": 0},
    {"name": "True Elements", "growthRate": 0, "brandStrength": 0, "revenueCr": 0},
    {"name": "Tata Soulfull", "growthRate": 0, "brandStrength": 0, "revenueCr": 0}
  ],
  "categoryShifts": [
    {"year": "2023", "event": "describe shift", "type": "channel|product|competitive"},
    {"year": "2024", "event": "describe shift", "type": "channel|product|competitive"},
    {"year": "2025", "event": "describe shift", "type": "channel|product|competitive"},
    {"year": "2026", "event": "describe shift", "type": "channel|product|competitive"}
  ],
  "channelHeatmap": [
    {"channel": "Modern Trade",   "yogabarPresence": "H|M|L", "categoryGrowth": "H|M|L", "competitiveDensity": "H|M|L"},
    {"channel": "Quick Commerce", "yogabarPresence": "H|M|L", "categoryGrowth": "H|M|L", "competitiveDensity": "H|M|L"},
    {"channel": "D2C / E-comm",   "yogabarPresence": "H|M|L", "categoryGrowth": "H|M|L", "competitiveDensity": "H|M|L"},
    {"channel": "Institutional",  "yogabarPresence": "H|M|L", "categoryGrowth": "H|M|L", "competitiveDensity": "H|M|L"},
    {"channel": "Export / GCC",   "yogabarPresence": "H|M|L", "categoryGrowth": "H|M|L", "competitiveDensity": "H|M|L"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important finding"}
}
<<<END_DATA_BLOCK>>>`,

  portfolio: `<<<DATA_BLOCK>>>
{
  "agent": "portfolio",
  "kpis": [
    {"label": "Active SKU Count", "value": "XX", "sub": "est. — focus on productive SKUs not total launches", "trend": "flat", "confidence": "H|M|L"},
    {"label": "Top SKU Revenue Concentration", "value": "XX%", "sub": "top 3 SKUs as % of revenue — concentration risk signal", "trend": "up", "confidence": "H|M|L"},
    {"label": "Portfolio Gross Margin vs Peers", "value": "XX% vs XX%", "sub": "Yogabar GM vs premium D2C peer benchmark (not vs FMCG average)", "trend": "up", "confidence": "H|M|L"},
    {"label": "Margin Upside via Mix Shift", "value": "+X pp", "sub": "gross margin gain if premium tier grows to X% of mix", "trend": "up", "confidence": "H|M|L"}
  ],
  "skuMatrix": [
    {"name": "SKU/Tier name", "marketGrowth": 0, "yogabarPosition": 0, "revenueCr": 0, "verdict": "STAR|CASHCOW|QUESTION|DOG"},
    {"name": "SKU/Tier name", "marketGrowth": 0, "yogabarPosition": 0, "revenueCr": 0, "verdict": "STAR|CASHCOW|QUESTION|DOG"},
    {"name": "SKU/Tier name", "marketGrowth": 0, "yogabarPosition": 0, "revenueCr": 0, "verdict": "STAR|CASHCOW|QUESTION|DOG"},
    {"name": "SKU/Tier name", "marketGrowth": 0, "yogabarPosition": 0, "revenueCr": 0, "verdict": "STAR|CASHCOW|QUESTION|DOG"},
    {"name": "SKU/Tier name", "marketGrowth": 0, "yogabarPosition": 0, "revenueCr": 0, "verdict": "STAR|CASHCOW|QUESTION|DOG"}
  ],
  "tierMargins": [
    {"tier": "Core (₹40-55)", "revenueSharePct": 0, "grossMarginPct": 0, "verdict": "KILL|KEEP|GROW|BUILD"},
    {"tier": "Mid (₹55-75)", "revenueSharePct": 0, "grossMarginPct": 0, "verdict": "KILL|KEEP|GROW|BUILD"},
    {"tier": "Premium (₹75-120)", "revenueSharePct": 0, "grossMarginPct": 0, "verdict": "KILL|KEEP|GROW|BUILD"},
    {"tier": "Bulk / Institutional", "revenueSharePct": 0, "grossMarginPct": 0, "verdict": "KILL|KEEP|GROW|BUILD"}
  ],
  "launchPipeline": [
    {"name": "SKU concept name", "pricePoint": "₹XX", "channel": "channel name", "paybackMonths": 0, "priority": 1},
    {"name": "SKU concept name", "pricePoint": "₹XX", "channel": "channel name", "paybackMonths": 0, "priority": 2},
    {"name": "SKU concept name", "pricePoint": "₹XX", "channel": "channel name", "paybackMonths": 0, "priority": 3}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important finding"}
}
<<<END_DATA_BLOCK>>>`,

  brand: `<<<DATA_BLOCK>>>
{
  "agent": "brand",
  "kpis": [
    {"label": "Aided Awareness (Core TG)", "value": "XX%", "sub": "urban health-conscious 25-40 — Yogabar's actual target group, not general population", "trend": "up", "confidence": "H|M|L"},
    {"label": "Premium Score vs Whole Truth", "value": "X.X vs X.X", "sub": "Yogabar premium perception vs Whole Truth — the direct benchmark", "trend": "down", "confidence": "H|M|L"},
    {"label": "ITC Association Impact", "value": "Positive|Neutral|Negative", "sub": "sentiment among core TG toward ITC ownership", "trend": "flat", "confidence": "H|M|L"},
    {"label": "Repeat Rate vs D2C Benchmark", "value": "XX% vs XX%", "sub": "Yogabar repeat vs healthy D2C category benchmark", "trend": "up", "confidence": "H|M|L"}
  ],
  "positioningMap": [
    {"name": "Yogabar", "functional": 0, "premium": 0, "highlight": true, "arrowFunctional": 0, "arrowPremium": 0},
    {"name": "Whole Truth", "functional": 0, "premium": 0, "highlight": false},
    {"name": "RiteBite Max", "functional": 0, "premium": 0, "highlight": false},
    {"name": "Britannia NutriChoice", "functional": 0, "premium": 0, "highlight": false},
    {"name": "Tata Soulfull", "functional": 0, "premium": 0, "highlight": false}
  ],
  "perceptionGap": [
    {"dimension": "Clean Label / Quality", "brandSaysPct": 0, "customerHearsPct": 0},
    {"dimension": "Authenticity / Story", "brandSaysPct": 0, "customerHearsPct": 0},
    {"dimension": "Innovation / Functional", "brandSaysPct": 0, "customerHearsPct": 0},
    {"dimension": "Value for Money", "brandSaysPct": 0, "customerHearsPct": 0}
  ],
  "itcAssociationDial": {
    "currentPosition": 0,
    "recommendedPosition": 0,
    "note": "0=hide ITC entirely, 50=equal prominence, 100=lead with ITC"
  },
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important finding"}
}
<<<END_DATA_BLOCK>>>`,

  margins: `<<<DATA_BLOCK>>>
{
  "agent": "margins",
  "kpis": [
    {"label": "Est. Gross Margin", "value": "XX%", "sub": "est. FY25", "trend": "up", "confidence": "H|M|L"},
    {"label": "Contribution Margin", "value": "XX%", "sub": "est.", "trend": "flat", "confidence": "H|M|L"},
    {"label": "EBITDA Margin", "value": "X%", "sub": "est.", "trend": "up", "confidence": "H|M|L"},
    {"label": "Target Gross Margin", "value": "45%+", "sub": "premium benchmark", "trend": "up", "confidence": "H"}
  ],
  "marginWaterfall": [
    {"label": "Revenue", "valuePct": 100, "type": "total"},
    {"label": "Ingredients", "valuePct": 0, "type": "cost"},
    {"label": "Manufacturing", "valuePct": 0, "type": "cost"},
    {"label": "Packaging", "valuePct": 0, "type": "cost"},
    {"label": "Gross Margin", "valuePct": 0, "type": "subtotal"},
    {"label": "Channel Costs", "valuePct": 0, "type": "cost"},
    {"label": "Marketing", "valuePct": 0, "type": "cost"},
    {"label": "Logistics", "valuePct": 0, "type": "cost"},
    {"label": "EBITDA", "valuePct": 0, "type": "total"}
  ],
  "channelMargins": [
    {"channel": "D2C", "grossMarginPct": 0, "contributionMarginPct": 0},
    {"channel": "Quick Commerce", "grossMarginPct": 0, "contributionMarginPct": 0},
    {"channel": "Modern Trade", "grossMarginPct": 0, "contributionMarginPct": 0},
    {"channel": "E-commerce", "grossMarginPct": 0, "contributionMarginPct": 0},
    {"channel": "Institutional", "grossMarginPct": 0, "contributionMarginPct": 0}
  ],
  "marginLevers": [
    {"lever": "lever name", "impactPoints": 0.0, "investmentCr": 0, "paybackMonths": 0},
    {"lever": "lever name", "impactPoints": 0.0, "investmentCr": 0, "paybackMonths": 0},
    {"lever": "lever name", "impactPoints": 0.0, "investmentCr": 0, "paybackMonths": 0},
    {"lever": "lever name", "impactPoints": 0.0, "investmentCr": 0, "paybackMonths": 0},
    {"lever": "lever name", "impactPoints": 0.0, "investmentCr": 0, "paybackMonths": 0}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important finding"}
}
<<<END_DATA_BLOCK>>>`,

  growth: `<<<DATA_BLOCK>>>
{
  "agent": "growth",
  "kpis": [
    {"label": "FY25 Revenue", "value": "₹201.66 Cr", "sub": "verified", "trend": "up", "confidence": "H"},
    {"label": "FY26 Target", "value": "₹340 Cr", "sub": "projected", "trend": "up", "confidence": "H"},
    {"label": "Growth Gap to Bridge", "value": "₹138 Cr", "sub": "FY25→FY26", "trend": "flat", "confidence": "H"},
    {"label": "Fastest Growing Channel", "value": "fill in", "sub": "est.", "trend": "up", "confidence": "H|M|L"}
  ],
  "revenueBridge": [
    {"label": "FY25 Base", "valueCr": 202, "type": "start"},
    {"label": "lever 1 — fill in", "valueCr": 0, "type": "up"},
    {"label": "lever 2 — fill in", "valueCr": 0, "type": "up"},
    {"label": "lever 3 — fill in", "valueCr": 0, "type": "up"},
    {"label": "lever 4 — fill in", "valueCr": 0, "type": "up"},
    {"label": "lever 5 — fill in", "valueCr": 0, "type": "up"},
    {"label": "risk 1 — fill in", "valueCr": 0, "type": "down"},
    {"label": "FY26 Target", "valueCr": 340, "type": "end"}
  ],
  "channelMixCurrent": [
    {"channel": "D2C / E-comm", "pct": 65},
    {"channel": "Modern Trade", "pct": 30},
    {"channel": "Quick Commerce", "pct": 3},
    {"channel": "Institutional", "pct": 1},
    {"channel": "Other", "pct": 1}
  ],
  "channelMixTarget": [
    {"channel": "D2C / E-comm", "pct": 0},
    {"channel": "Modern Trade", "pct": 0},
    {"channel": "Quick Commerce", "pct": 0},
    {"channel": "Institutional", "pct": 0},
    {"channel": "Export / Other", "pct": 0}
  ],
  "milestones": [
    {"quarter": "Q1 2026", "milestone": "describe milestone", "type": "channel|product|campaign|strategic"},
    {"quarter": "Q2 2026", "milestone": "describe milestone", "type": "channel|product|campaign|strategic"},
    {"quarter": "Q3 2026", "milestone": "describe milestone", "type": "channel|product|campaign|strategic"},
    {"quarter": "Q4 2026", "milestone": "describe milestone", "type": "channel|product|campaign|strategic"},
    {"quarter": "Q1 2027", "milestone": "describe milestone", "type": "channel|product|campaign|strategic"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important finding"}
}
<<<END_DATA_BLOCK>>>`,

  competitive: `<<<DATA_BLOCK>>>
{
  "agent": "competitive",
  "kpis": [
    {"label": "Rank in D2C Nutrition Segment", "value": "#X of X", "sub": "by revenue within D2C/premium nutrition — not vs Britannia or Kellogg's", "trend": "flat", "confidence": "H|M|L"},
    {"label": "Whole Truth Revenue Gap", "value": "₹XXCr behind/ahead", "sub": "absolute gap vs closest direct rival — closing or widening?", "trend": "up", "confidence": "H|M|L"},
    {"label": "Fastest Rival Growth Rate", "value": "+XX% (Name)", "sub": "who is accelerating fastest within the D2C peer set", "trend": "up", "confidence": "H|M|L"},
    {"label": "Yogabar Functional Gap", "value": "X SKUs vs XX", "sub": "functional/protein SKUs vs Whole Truth — product territory risk", "trend": "flat", "confidence": "H|M|L"}
  ],
  "threatHeatmap": [
    {"competitor": "Whole Truth",   "price": "H|M|L", "channel": "H|M|L", "product": "H|M|L", "brand": "H|M|L", "distribution": "H|M|L", "growth": "H|M|L"},
    {"competitor": "RiteBite Max",  "price": "H|M|L", "channel": "H|M|L", "product": "H|M|L", "brand": "H|M|L", "distribution": "H|M|L", "growth": "H|M|L"},
    {"competitor": "True Elements", "price": "H|M|L", "channel": "H|M|L", "product": "H|M|L", "brand": "H|M|L", "distribution": "H|M|L", "growth": "H|M|L"},
    {"competitor": "Tata Soulfull",  "price": "H|M|L", "channel": "H|M|L", "product": "H|M|L", "brand": "H|M|L", "distribution": "H|M|L", "growth": "H|M|L"},
    {"competitor": "Baggry's",       "price": "H|M|L", "channel": "H|M|L", "product": "H|M|L", "brand": "H|M|L", "distribution": "H|M|L", "growth": "H|M|L"}
  ],
  "speedThreatMatrix": [
    {"name": "Whole Truth",   "threatScore": 0, "speedScore": 0, "revenueCr": 0},
    {"name": "RiteBite Max",  "threatScore": 0, "speedScore": 0, "revenueCr": 0},
    {"name": "True Elements", "threatScore": 0, "speedScore": 0, "revenueCr": 0},
    {"name": "Tata Soulfull",  "threatScore": 0, "speedScore": 0, "revenueCr": 0},
    {"name": "Baggry's",       "threatScore": 0, "speedScore": 0, "revenueCr": 0}
  ],
  "battleCards": [
    {"mode": "ATTACK",  "target": "competitor name", "move": "specific action", "timeline": "Q? 20??"},
    {"mode": "DEFEND",  "target": "competitor name", "move": "specific action", "timeline": "Q? 20??"},
    {"mode": "MONITOR", "target": "competitor name", "move": "specific action", "timeline": "Q? 20??"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important finding"}
}
<<<END_DATA_BLOCK>>>`,

  synergy: `<<<DATA_BLOCK>>>
{
  "agent": "synergy",
  "kpis": [
    {"label": "Synergies Realised (est.)", "value": "CURRENCY XX UNIT", "sub": "cumulative to date", "trend": "up", "confidence": "H|M|L"},
    {"label": "Unrealised Synergy Value", "value": "CURRENCY XX UNIT", "sub": "est. 3-yr potential", "trend": "flat", "confidence": "H|M|L"},
    {"label": "Highest-Value Next Asset", "value": "asset name", "sub": "est. value", "trend": "up", "confidence": "H|M|L"},
    {"label": "Time to Capture Top 3", "value": "XX months", "sub": "est.", "trend": "flat", "confidence": "H|M|L"}
  ],
  "synergyMatrix": [
    {"asset": "ITC GT Distribution (4M outlets)", "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"},
    {"asset": "MT Shelf Relationships",           "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"},
    {"asset": "Agri Division Sourcing",           "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"},
    {"asset": "LSTC R&D Lab",                     "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"},
    {"asset": "ITC Hotels Channel",               "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"},
    {"asset": "Export Infrastructure",            "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"},
    {"asset": "ITC Brand Trust Halo",             "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"}
  ],
  "synergyRoadmap": [
    {"quarter": "Q1 2026", "synergy": "describe action", "valueCr": 0},
    {"quarter": "Q2 2026", "synergy": "describe action", "valueCr": 0},
    {"quarter": "Q3 2026", "synergy": "describe action", "valueCr": 0},
    {"quarter": "Q4 2026", "synergy": "describe action", "valueCr": 0},
    {"quarter": "Q2 2027", "synergy": "describe action", "valueCr": 0}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important finding"}
}
<<<END_DATA_BLOCK>>>`,

  platform: `<<<DATA_BLOCK>>>
{
  "agent": "platform",
  "kpis": [
    {"label": "Total Addressable TAM", "value": "CURRENCY X,XXX UNIT", "sub": "combined opportunities", "trend": "up", "confidence": "H|M|L"},
    {"label": "Top Opportunity", "value": "name it", "sub": "TAM", "trend": "up", "confidence": "H|M|L"},
    {"label": "Min Investment Required", "value": "CURRENCY XX UNIT", "sub": "lowest-entry opportunity", "trend": "flat", "confidence": "H|M|L"},
    {"label": "Fastest Payback", "value": "XX months", "sub": "best opportunity", "trend": "up", "confidence": "H|M|L"}
  ],
  "opportunityBubbles": [
    {"name": "opportunity name", "itcFitScore": 0, "marketGrowthPct": 0, "tamCr": 0},
    {"name": "opportunity name", "itcFitScore": 0, "marketGrowthPct": 0, "tamCr": 0},
    {"name": "opportunity name", "itcFitScore": 0, "marketGrowthPct": 0, "tamCr": 0},
    {"name": "opportunity name", "itcFitScore": 0, "marketGrowthPct": 0, "tamCr": 0},
    {"name": "opportunity name", "itcFitScore": 0, "marketGrowthPct": 0, "tamCr": 0}
  ],
  "investmentReturn": [
    {"opportunity": "name", "investmentCr": 0, "year3RevenueCr": 0, "paybackMonths": 0},
    {"opportunity": "name", "investmentCr": 0, "year3RevenueCr": 0, "paybackMonths": 0},
    {"opportunity": "name", "investmentCr": 0, "year3RevenueCr": 0, "paybackMonths": 0},
    {"opportunity": "name", "investmentCr": 0, "year3RevenueCr": 0, "paybackMonths": 0}
  ],
  "buildPartnerAcquire": [
    {"opportunity": "name", "recommendation": "build|partner|acquire", "rationale": "one sentence why"},
    {"opportunity": "name", "recommendation": "build|partner|acquire", "rationale": "one sentence why"},
    {"opportunity": "name", "recommendation": "build|partner|acquire", "rationale": "one sentence why"},
    {"opportunity": "name", "recommendation": "build|partner|acquire", "rationale": "one sentence why"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important finding"}
}
<<<END_DATA_BLOCK>>>`,

  intl: `<<<DATA_BLOCK>>>
{
  "agent": "intl",
  "kpis": [
    {"label": "Best Entry Market", "value": "market name", "sub": "rationale", "trend": "up", "confidence": "H|M|L"},
    {"label": "GCC Indian Diaspora", "value": "X.XM people", "sub": "verified", "trend": "up", "confidence": "H|M|L"},
    {"label": "Analog Brand 3-yr Revenue", "value": "CURRENCY XXX UNIT", "sub": "best analog", "trend": "up", "confidence": "H|M|L"},
    {"label": "GCC Entry Investment", "value": "CURRENCY XX UNIT", "sub": "est.", "trend": "flat", "confidence": "H|M|L"}
  ],
  "analogBrands": [
    {"name": "brand name", "market": "market", "strategy": "brief strategy", "revenueTrajectory": [0, 0, 0, 0], "lesson": "one transferable lesson"},
    {"name": "brand name", "market": "market", "strategy": "brief strategy", "revenueTrajectory": [0, 0, 0, 0], "lesson": "one transferable lesson"},
    {"name": "brand name", "market": "market", "strategy": "brief strategy", "revenueTrajectory": [0, 0, 0, 0], "lesson": "one transferable lesson"}
  ],
  "marketRadar": {
    "axes": ["Market Size", "ITC Fit", "Diaspora Density", "Regulatory Ease", "Competitive Intensity"],
    "markets": [
      {"name": "GCC (UAE+KSA)", "scores": [0, 0, 0, 0, 0]},
      {"name": "UK", "scores": [0, 0, 0, 0, 0]},
      {"name": "USA", "scores": [0, 0, 0, 0, 0]}
    ]
  },
  "entryPriority": [
    {"rank": 1, "market": "market name", "mode": "entry mode", "investmentCr": 0, "year3RevenueCr": 0, "readiness": "H|M|L"},
    {"rank": 2, "market": "market name", "mode": "entry mode", "investmentCr": 0, "year3RevenueCr": 0, "readiness": "H|M|L"},
    {"rank": 3, "market": "market name", "mode": "entry mode", "investmentCr": 0, "year3RevenueCr": 0, "readiness": "H|M|L"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important finding"}
}
<<<END_DATA_BLOCK>>>`,

  synopsis: `<<<DATA_BLOCK>>>
{
  "agent": "synopsis",
  "kpis": [
    {"label": "Overall Verdict", "value": "word", "sub": "basis", "trend": "up", "confidence": "H"},
    {"label": "Biggest Opportunity", "value": "CURRENCY XXX UNIT", "sub": "what it is", "trend": "up", "confidence": "H|M|L"},
    {"label": "Biggest Risk", "value": "name it", "sub": "why", "trend": "up", "confidence": "H|M|L"},
    {"label": "Revenue Milestone Target", "value": "FY2X", "sub": "next major revenue milestone — e.g. 2x current revenue target year", "trend": "up", "confidence": "H|M|L"}
  ],
  "agentVerdicts": [
    {"agent": "Market",      "agentId": "market",      "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Portfolio",   "agentId": "portfolio",   "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Brand",       "agentId": "brand",       "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Margins",     "agentId": "margins",     "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Growth",      "agentId": "growth",      "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Competitive", "agentId": "competitive", "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Synergy",     "agentId": "synergy",     "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Platform",    "agentId": "platform",    "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Global",      "agentId": "intl",        "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"}
  ],
  "topActions": [
    {"rank": 1, "action": "specific action", "owner": "team", "quarter": "Q? 20??", "revenueCr": 0, "investmentCr": 0},
    {"rank": 2, "action": "specific action", "owner": "team", "quarter": "Q? 20??", "revenueCr": 0, "investmentCr": 0},
    {"rank": 3, "action": "specific action", "owner": "team", "quarter": "Q? 20??", "revenueCr": 0, "investmentCr": 0},
    {"rank": 4, "action": "specific action", "owner": "team", "quarter": "Q? 20??", "revenueCr": 0, "investmentCr": 0},
    {"rank": 5, "action": "specific action", "owner": "team", "quarter": "Q? 20??", "revenueCr": 0, "investmentCr": 0}
  ],
  "risks": [
    {"risk": "describe risk", "severity": "H|M|L", "mitigation": "one sentence"},
    {"risk": "describe risk", "severity": "H|M|L", "mitigation": "one sentence"},
    {"risk": "describe risk", "severity": "H|M|L", "mitigation": "one sentence"}
  ],
  "opportunities": [
    {"opportunity": "describe it", "valueCr": 0, "confidence": "H|M|L"},
    {"opportunity": "describe it", "valueCr": 0, "confidence": "H|M|L"},
    {"opportunity": "describe it", "valueCr": 0, "confidence": "H|M|L"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important finding"}
}
<<<END_DATA_BLOCK>>>`
};

const DATA_BLOCK_RULES = `
DATA_BLOCK RULES — READ CAREFULLY:
— Write the DATA_BLOCK FIRST. Your prose analysis comes AFTER <<<END_DATA_BLOCK>>>.
— Do NOT wrap in code fences. No backticks around the block or inside it.
— Fill in every field with real data from your research. Replace all placeholder text.
— Use null only for genuinely unknown values — never omit a field entirely.
— All percentage values are plain numbers (e.g. 45 not "45%").
— All ₹ values in Crores as plain numbers (e.g. 202 not "₹202 Cr").
— JSON must be valid: no trailing commas, no comments, no extra text inside the block.
— Do not repeat or summarise the DATA_BLOCK in your prose.
— The prose explains WHY and SO WHAT. The block shows the WHAT.
`;

// ━━━ CLAUDE STREAMING ENDPOINT ━━━
app.post('/api/claude', async (req, res) => {
  const { prompt, agentId, market } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  // Detect if this is a Yogabar/ITC run
  const isYogabar = prompt.toLowerCase().includes('yogabar') || prompt.toLowerCase().includes('yoga bar');
  const currencySymbol = (market === 'US' || market === 'Global') ? '$' : '₹';
  const currencyUnit = (market === 'US' || market === 'Global') ? 'M' : 'Cr';
  const currencyLabel = (market === 'US' || market === 'Global') ? '$M' : '₹ Cr';

  const model =
    agentId === 'synopsis' ? 'claude-opus-4-6' :
    agentId === 'synergy'  ? 'claude-opus-4-6' :
                             'claude-sonnet-4-6';

  const maxTokens =
    agentId === 'synopsis' ? 6000 :  // reduced from 8000 — shorter generation = less QUIC timeout risk
    agentId === 'synergy'  ? 8000 :
                             16000;

  const maxSearches = agentId === 'synopsis' ? 2 : 5;

  // Inject VERIFIED_DATA + agent-specific DATA_BLOCK schema into prompt
  const schema = DATA_BLOCK_SCHEMAS[agentId] || DATA_BLOCK_SCHEMAS['market'];
  // Replace CURRENCY/UNIT placeholders in schema with actual currency for this market
  const schemaForMarket = schema
    .replace(/CURRENCY/g, currencySymbol)
    .replace(/UNIT/g, currencyUnit);

  const dataBlockInstruction = `
DATA_BLOCK — WRITE THIS FIRST, BEFORE YOUR PROSE:

Begin your response with this block. Fill in ALL fields with real data from your research.
Why first: guarantees it is present even if response is long.
IMPORTANT: Use ${currencyLabel} for ALL monetary values in this DATA_BLOCK.

${schemaForMarket}

${DATA_BLOCK_RULES}`;

  // Replace the generic DATA_BLOCK section in the incoming prompt with the agent-specific one
  // The prompt from App.js already contains NARRATIVE_RULES with old generic schema —
  // we strip that section and inject the agent-specific one
  const cleanedPrompt = prompt
    .replace(/DATA_BLOCK — WRITE THIS FIRST[\s\S]*?<<<END_DATA_BLOCK>>>\s*\nDATA_BLOCK rules:[\s\S]*?Do not repeat or summarise the DATA_BLOCK in your prose\.\s*/g, '')
    .replace(/VERIFIED FINANCIAL DATA:[\s\S]*?If no figures are provided, find them through web search\.\s*/g, '');

  // Only inject VERIFIED_DATA for Yogabar/ITC runs — other companies get wrong data otherwise
  const verifiedBlock = isYogabar ? VERIFIED_DATA + '\n\n' : '';
  const finalPrompt = verifiedBlock + dataBlockInstruction + '\n\n' + cleanedPrompt;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Alt-Svc', 'clear');  // Force HTTP/1.1 — prevents Chrome QUIC drops on long streams

  const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

  // Synopsis/Synergy use Opus and take 3-4 min — keepalive every 8s to prevent QUIC drops
  const keepaliveMs = (agentId === 'synopsis' || agentId === 'synergy') ? 8000 : 20000;
  const keepaliveInterval = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch(e) { clearInterval(keepaliveInterval); }
  }, keepaliveMs);

  try {
    let fullText = '';
    const sources = [];

    const stream = anthropic.messages.stream({
      model, max_tokens: maxTokens,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }],
      messages: [{ role: 'user', content: finalPrompt }],
    });

    stream.on('text', (text) => { fullText += text; sendEvent('chunk', { text }); });

    stream.on('streamEvent', (event) => {
      if (event.type !== 'content_block_delta' && event.type !== 'ping') {
        console.log(`[${agentId}] streamEvent:`, event.type, event.content_block?.type || '');
      }
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block?.type === 'tool_use' && block?.name === 'web_search') sendEvent('searching', { query: '' });
        if (block?.type === 'web_search_tool_result') {
          const results = Array.isArray(block.content) ? block.content : [];
          for (const item of results) {
            const url = item.url || item.source || item.link;
            const title = item.title || item.name || url;
            if (url && !sources.find(s => s.url === url)) {
              sources.push({ url, title, agent: agentId });
              sendEvent('source', { url, title, agent: agentId });
            }
          }
        }
      }
    });

    stream.on('message', (msg) => {
      for (const block of msg.content) {
        if (block.type === 'server_tool_use' && block.name === 'web_search' && block.input?.query)
          sendEvent('searching', { query: block.input.query.slice(0, 40) });
        if (block.type === 'web_search_tool_result') {
          const results = Array.isArray(block.content) ? block.content : [];
          for (const item of results) {
            const url = item.url || item.source || item.link;
            const title = item.title || item.name || url;
            if (url && !sources.find(s => s.url === url)) sources.push({ url, title, agent: agentId });
          }
        }
      }
    });

    await stream.finalMessage();
    clearInterval(keepaliveInterval);
    sendEvent('done', { text: fullText });
    res.end();
  } catch (error) {
    clearInterval(keepaliveInterval);
    console.error(`Agent ${agentId} error:`, error.message);
    sendEvent('error', { message: error.message });
    res.end();
  }
});

// ━━━ PUPPETEER PDF ENDPOINT ━━━
app.post('/api/pdf', async (req, res) => {
  const { html, company, acquirer } = req.body;
  if (!html) return res.status(400).json({ error: 'Missing html' });
  console.log(`[PDF] Generating for ${company} — ${html.length} chars`);
  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: null,
    });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3500));
    await new Promise(r => setTimeout(r, 2500));
    const pdf = await page.pdf({
      format: 'A4', printBackground: true,
      margin: { top:'0mm', right:'0mm', bottom:'0mm', left:'0mm' }
    });
    await browser.close();
    const filename = `${(company||'Report').replace(/\s+/g,'_')}_AdvisorSprint_${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
    console.log(`[PDF] Done — ${pdf.length} bytes`);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error('[PDF] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AdvisorSprint — Sonnet 4.6 × 8 + Opus 4.6 × 2 — port ${PORT}`);
  console.log('[PDF] Using @sparticuz/chromium — no download needed');
});
