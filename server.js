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
    {"label": "D2C Nutrition Segment Size", "value": "CURRENCY X,XXX UNIT", "sub": "the insurgent sub-segment [COMPANY] competes in — NOT the total ₹45,000 Cr FMCG category", "trend": "up", "confidence": "H|M|L"},
    {"label": "[COMPANY] Share in Segment", "value": "X.X%", "sub": "share within addressable segment — e.g. [COMPANY] revenue / segment size", "trend": "up", "confidence": "H|M|L"},
    {"label": "D2C Segment YoY Growth", "value": "XX%", "sub": "growth rate of the insurgent D2C sub-segment, not blended category average", "trend": "up", "confidence": "H|M|L"},
    {"label": "QC Share of [COMPANY] Revenue", "value": "XX%", "sub": "QC as % of [COMPANY] revenue — shows penetration gap", "trend": "up", "confidence": "H|M|L"}
  ],
  "competitorBubbles": [
    {"name": "[COMPANY]", "growthRate": 0, "brandStrength": 0, "revenueCr": 0, "highlight": true},
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
    {"channel": "Modern Trade",   "companyPresence": "H|M|L", "categoryGrowth": "H|M|L", "competitiveDensity": "H|M|L"},
    {"channel": "Quick Commerce", "companyPresence": "H|M|L", "categoryGrowth": "H|M|L", "competitiveDensity": "H|M|L"},
    {"channel": "D2C / E-comm",   "companyPresence": "H|M|L", "categoryGrowth": "H|M|L", "competitiveDensity": "H|M|L"},
    {"channel": "Institutional",  "companyPresence": "H|M|L", "categoryGrowth": "H|M|L", "competitiveDensity": "H|M|L"},
    {"channel": "Export / GCC",   "companyPresence": "H|M|L", "categoryGrowth": "H|M|L", "competitiveDensity": "H|M|L"}
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
    {"label": "Portfolio Gross Margin vs Peers", "value": "XX% vs XX%", "sub": "[COMPANY] GM vs premium peer benchmark", "trend": "up", "confidence": "H|M|L"},
    {"label": "Margin Upside via Mix Shift", "value": "+X pp", "sub": "gross margin gain if premium tier grows to X% of mix", "trend": "up", "confidence": "H|M|L"}
  ],
  "skuMatrix": [
    {"name": "SKU/Tier name", "marketGrowth": 0, "companyPosition": 0, "revenueCr": 0, "verdict": "STAR|CASHCOW|QUESTION|DOG"},
    {"name": "SKU/Tier name", "marketGrowth": 0, "companyPosition": 0, "revenueCr": 0, "verdict": "STAR|CASHCOW|QUESTION|DOG"},
    {"name": "SKU/Tier name", "marketGrowth": 0, "companyPosition": 0, "revenueCr": 0, "verdict": "STAR|CASHCOW|QUESTION|DOG"},
    {"name": "SKU/Tier name", "marketGrowth": 0, "companyPosition": 0, "revenueCr": 0, "verdict": "STAR|CASHCOW|QUESTION|DOG"},
    {"name": "SKU/Tier name", "marketGrowth": 0, "companyPosition": 0, "revenueCr": 0, "verdict": "STAR|CASHCOW|QUESTION|DOG"}
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
    {"label": "Aided Awareness (Core TG)", "value": "XX%", "sub": "urban health-conscious 25-40 — [COMPANY]'s actual target group, not general population", "trend": "up", "confidence": "H|M|L"},
    {"label": "Premium Score vs Whole Truth", "value": "X.X vs X.X", "sub": "[COMPANY] premium perception vs Whole Truth — the direct benchmark", "trend": "down", "confidence": "H|M|L"},
    {"label": "[ACQUIRER] Association Impact", "value": "Positive|Neutral|Negative", "sub": "sentiment among core TG toward [ACQUIRER] ownership", "trend": "flat", "confidence": "H|M|L"},
    {"label": "Repeat Rate vs D2C Benchmark", "value": "XX% vs XX%", "sub": "[COMPANY] repeat vs healthy D2C category benchmark", "trend": "up", "confidence": "H|M|L"}
  ],
  "positioningMap": [
    {"name": "[COMPANY]", "functional": 0, "premium": 0, "highlight": true, "arrowFunctional": 0, "arrowPremium": 0},
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
  "itcAssociationDial": null,
  "_dialNote": "IMPORTANT: Set itcAssociationDial to null if there is no acquirer. Only populate it when [ACQUIRER] is a real company that acquired [COMPANY]. If populated, use: {acquirerName, currentPosition (0-100), recommendedPosition (0-100), note}",
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
    {"label": "[COMPANY] Functional Gap", "value": "X SKUs vs XX", "sub": "functional/protein SKUs vs Whole Truth — product territory risk", "trend": "flat", "confidence": "H|M|L"}
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
    {"label": "Value Unlocked (est.)", "value": "CURRENCY XX UNIT", "sub": "synergies captured or partnerships activated to date", "trend": "up", "confidence": "H|M|L"},
    {"label": "Untapped Leverage Value", "value": "CURRENCY XX UNIT", "sub": "est. 3-yr potential from remaining levers", "trend": "flat", "confidence": "H|M|L"},
    {"label": "Highest-Value Next Action", "value": "name it", "sub": "est. value unlock", "trend": "up", "confidence": "H|M|L"},
    {"label": "Time to Capture Top 3", "value": "XX months", "sub": "est.", "trend": "flat", "confidence": "H|M|L"}
  ],
  "synergyMatrix": [
    {"asset": "Asset or leverage point 1 — name it specifically", "acquirerName": "[ACQUIRER]", "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"},
    {"asset": "Asset or leverage point 2 — name it specifically", "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"},
    {"asset": "Asset or leverage point 3 — name it specifically", "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"},
    {"asset": "Asset or leverage point 4 — name it specifically", "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"},
    {"asset": "Asset or leverage point 5 — name it specifically", "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"},
    {"asset": "Asset or leverage point 6 — name it specifically", "ease": 0, "valueCr": 0, "status": "activated|partial|untapped"}
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
    {"name": "opportunity name", "strategicFitScore": 0, "marketGrowthPct": 0, "tamCr": 0},
    {"name": "opportunity name", "strategicFitScore": 0, "marketGrowthPct": 0, "tamCr": 0},
    {"name": "opportunity name", "strategicFitScore": 0, "marketGrowthPct": 0, "tamCr": 0},
    {"name": "opportunity name", "strategicFitScore": 0, "marketGrowthPct": 0, "tamCr": 0},
    {"name": "opportunity name", "strategicFitScore": 0, "marketGrowthPct": 0, "tamCr": 0}
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
    "axes": ["Market Size", "[ACQUIRER] Fit", "Diaspora Density", "Regulatory Ease", "Competitive Intensity"],
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

// ━━━ SAAS DATA_BLOCK SCHEMAS ━━━
const SAAS_DATA_BLOCK_SCHEMAS = {

  market: `<<<DATA_BLOCK>>>
{
  "agent": "market",
  "kpis": [
    {"label": "Category TAM", "value": "$XB", "sub": "total addressable market", "trend": "up|down|flat", "confidence": "H|M|L"},
    {"label": "TAM Growth Rate", "value": "XX%", "sub": "CAGR estimate", "trend": "up|down|flat", "confidence": "H|M|L"},
    {"label": "Category Stage", "value": "word", "sub": "land-grab|growth|consolidation|mature", "trend": "up|down|flat", "confidence": "H|M|L"},
    {"label": "Company Category Share", "value": "X%", "sub": "estimated share of served market", "trend": "up|down|flat", "confidence": "H|M|L"}
  ],
  "categoryMap": [
    {"competitor": "company name", "revenueM": 0, "growth": 0, "position": "leader|challenger|niche|emerging"},
    {"competitor": "company name", "revenueM": 0, "growth": 0, "position": "leader|challenger|niche|emerging"},
    {"competitor": "company name", "revenueM": 0, "growth": 0, "position": "leader|challenger|niche|emerging"},
    {"competitor": "company name", "revenueM": 0, "growth": 0, "position": "leader|challenger|niche|emerging"},
    {"competitor": "company name", "revenueM": 0, "growth": 0, "position": "leader|challenger|niche|emerging"}
  ],
  "structuralForces": [
    {"force": "describe force", "impact": "H|M|L", "timeline": "6-12mo|1-2yr|3-5yr", "verdict": "tailwind|headwind"},
    {"force": "describe force", "impact": "H|M|L", "timeline": "6-12mo|1-2yr|3-5yr", "verdict": "tailwind|headwind"},
    {"force": "describe force", "impact": "H|M|L", "timeline": "6-12mo|1-2yr|3-5yr", "verdict": "tailwind|headwind"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important market finding", "confidence": "H|M|L"}
}
<<<END_DATA_BLOCK>>>`,

  product: `<<<DATA_BLOCK>>>
{
  "agent": "product",
  "kpis": [
    {"label": "Core Moat Type", "value": "word", "sub": "network effects|data|switching cost|brand", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Moat Durability", "value": "word", "sub": "strong|moderate|shallow — with timeline", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Platform vs Point Solution", "value": "word", "sub": "platform|expanding|point solution", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Network Effect Strength", "value": "word", "sub": "real|partial|absent", "trend": "up|down|flat|watch", "confidence": "H|M|L"}
  ],
  "moatAssessment": [
    {"dimension": "Data Network Effects", "strength": 0, "verdict": "real|partial|absent", "evidence": "one sentence"},
    {"dimension": "Switching Costs", "strength": 0, "verdict": "high|medium|low", "evidence": "one sentence"},
    {"dimension": "Technical Differentiation", "strength": 0, "verdict": "strong|moderate|weak", "evidence": "one sentence"},
    {"dimension": "Supplier/Partner Lock-in", "strength": 0, "verdict": "strong|moderate|weak", "evidence": "one sentence"}
  ],
  "disintermediationRisks": [
    {"threat": "company or force", "probability": "H|M|L", "timeline": "6mo|12mo|24mo|36mo", "impact": "existential|serious|manageable"},
    {"threat": "company or force", "probability": "H|M|L", "timeline": "6mo|12mo|24mo|36mo", "impact": "existential|serious|manageable"},
    {"threat": "company or force", "probability": "H|M|L", "timeline": "6mo|12mo|24mo|36mo", "impact": "existential|serious|manageable"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important product finding", "confidence": "H|M|L"}
}
<<<END_DATA_BLOCK>>>`,

  gtm: `<<<DATA_BLOCK>>>
{
  "agent": "gtm",
  "kpis": [
    {"label": "Primary GTM Motion", "value": "word", "sub": "PLG|direct sales|channel|hybrid", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Est. CAC Payback", "value": "Xmo", "sub": "months to recover CAC", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Pricing Model", "value": "word", "sub": "seat|usage|credits|outcome|tier", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "GTM Efficiency", "value": "word", "sub": "improving|stable|declining", "trend": "up|down|flat|watch", "confidence": "H|M|L"}
  ],
  "funnelStages": [
    {"stage": "Awareness", "mechanic": "describe", "strength": "strong|moderate|weak", "gap": "describe gap or null"},
    {"stage": "Trial/Activation", "mechanic": "describe", "strength": "strong|moderate|weak", "gap": "describe gap or null"},
    {"stage": "Conversion", "mechanic": "describe", "strength": "strong|moderate|weak", "gap": "describe gap or null"},
    {"stage": "Expansion", "mechanic": "describe", "strength": "strong|moderate|weak", "gap": "describe gap or null"},
    {"stage": "Enterprise", "mechanic": "describe", "strength": "strong|moderate|weak", "gap": "describe gap or null"}
  ],
  "pricingComps": [
    {"company": "name", "model": "seat|usage|credits|tier", "avcEst": "$XXk", "nrrSignal": "strong|moderate|weak"},
    {"company": "name", "model": "seat|usage|credits|tier", "avcEst": "$XXk", "nrrSignal": "strong|moderate|weak"},
    {"company": "name", "model": "seat|usage|credits|tier", "avcEst": "$XXk", "nrrSignal": "strong|moderate|weak"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important GTM finding", "confidence": "H|M|L"}
}
<<<END_DATA_BLOCK>>>`,

  revenue: `<<<DATA_BLOCK>>>
{
  "agent": "revenue",
  "kpis": [
    {"label": "Est. ARR", "value": "$XXM", "sub": "methodology shown in prose", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Est. ARR Growth", "value": "XX%", "sub": "YoY estimate", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Est. Gross Margin", "value": "XX%", "sub": "vs 70-80% SaaS benchmark", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Rule of 40", "value": "XX", "sub": "growth% + FCF margin%", "trend": "up|down|flat|watch", "confidence": "H|M|L"}
  ],
  "arrTriangulation": [
    {"method": "Funding round back-calculation", "estimate": "$XXM", "confidence": "H|M|L", "basis": "one sentence"},
    {"method": "Headcount × revenue/employee", "estimate": "$XXM", "confidence": "H|M|L", "basis": "one sentence"},
    {"method": "Public signals / founder statements", "estimate": "$XXM", "confidence": "H|M|L", "basis": "one sentence"}
  ],
  "ruleOf40Comps": [
    {"company": "name", "growthRate": 0, "fcfMargin": 0, "ruleOf40": 0, "stage": "comparable stage"},
    {"company": "name", "growthRate": 0, "fcfMargin": 0, "ruleOf40": 0, "stage": "comparable stage"},
    {"company": "name", "growthRate": 0, "fcfMargin": 0, "ruleOf40": 0, "stage": "comparable stage"},
    {"company": "name", "growthRate": 0, "fcfMargin": 0, "ruleOf40": 0, "stage": "comparable stage"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important revenue health finding", "confidence": "H|M|L"}
}
<<<END_DATA_BLOCK>>>`,

  customer: `<<<DATA_BLOCK>>>
{
  "agent": "customer",
  "kpis": [
    {"label": "Primary ICP", "value": "short description", "sub": "ideal customer profile", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Customer Base Health", "value": "word", "sub": "strong|mixed|at-risk", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Top Churn Driver", "value": "short label", "sub": "primary reason customers leave", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Concentration Risk", "value": "word", "sub": "high|medium|low", "trend": "up|down|flat|watch", "confidence": "H|M|L"}
  ],
  "segmentMap": [
    {"segment": "segment name", "sizeEst": "S|M|L", "retentionSignal": "strong|moderate|weak", "expansionSignal": "strong|moderate|weak", "verdict": "engine|neutral|anchor"},
    {"segment": "segment name", "sizeEst": "S|M|L", "retentionSignal": "strong|moderate|weak", "expansionSignal": "strong|moderate|weak", "verdict": "engine|neutral|anchor"},
    {"segment": "segment name", "sizeEst": "S|M|L", "retentionSignal": "strong|moderate|weak", "expansionSignal": "strong|moderate|weak", "verdict": "engine|neutral|anchor"},
    {"segment": "segment name", "sizeEst": "S|M|L", "retentionSignal": "strong|moderate|weak", "expansionSignal": "strong|moderate|weak", "verdict": "engine|neutral|anchor"}
  ],
  "churnDrivers": [
    {"driver": "describe driver", "severity": "H|M|L", "segment": "which segment", "mitigation": "one sentence"},
    {"driver": "describe driver", "severity": "H|M|L", "segment": "which segment", "mitigation": "one sentence"},
    {"driver": "describe driver", "severity": "H|M|L", "segment": "which segment", "mitigation": "one sentence"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important customer finding", "confidence": "H|M|L"}
}
<<<END_DATA_BLOCK>>>`,

  competitive: `<<<DATA_BLOCK>>>
{
  "agent": "competitive",
  "kpis": [
    {"label": "Competitive Position", "value": "word", "sub": "leader|strong challenger|vulnerable|at-risk", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Switching Cost", "value": "word", "sub": "high|medium|low — with time estimate", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Most Dangerous Threat", "value": "company name", "sub": "timeline to parity", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Differentiation Durability", "value": "word", "sub": "durable|12-18mo window|eroding", "trend": "up|down|flat|watch", "confidence": "H|M|L"}
  ],
  "competitorBattlecard": [
    {"competitor": "name", "revenueM": 0, "overlap": "H|M|L", "attackVector": "describe", "vulnerability": "describe", "threat": "H|M|L"},
    {"competitor": "name", "revenueM": 0, "overlap": "H|M|L", "attackVector": "describe", "vulnerability": "describe", "threat": "H|M|L"},
    {"competitor": "name", "revenueM": 0, "overlap": "H|M|L", "attackVector": "describe", "vulnerability": "describe", "threat": "H|M|L"},
    {"competitor": "name", "revenueM": 0, "overlap": "H|M|L", "attackVector": "describe", "vulnerability": "describe", "threat": "H|M|L"}
  ],
  "moatComponents": [
    {"component": "describe moat component", "strength": 0, "replicableIn": "6mo|12mo|24mo|not replicable", "verdict": "strong|moderate|weak"},
    {"component": "describe moat component", "strength": 0, "replicableIn": "6mo|12mo|24mo|not replicable", "verdict": "strong|moderate|weak"},
    {"component": "describe moat component", "strength": 0, "replicableIn": "6mo|12mo|24mo|not replicable", "verdict": "strong|moderate|weak"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important competitive finding", "confidence": "H|M|L"}
}
<<<END_DATA_BLOCK>>>`,

  funding: `<<<DATA_BLOCK>>>
{
  "agent": "funding",
  "kpis": [
    {"label": "Last Valuation", "value": "$XB", "sub": "date of last round", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Implied ARR Multiple", "value": "XXx", "sub": "valuation ÷ estimated ARR", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Multiple vs Peers", "value": "word", "sub": "premium|at-market|discount", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Most Likely Outcome", "value": "word", "sub": "IPO|acquisition|PE|independent", "trend": "up|down|flat|watch", "confidence": "H|M|L"}
  ],
  "fundingHistory": [
    {"round": "Seed|A|B|C|D|other", "amount": "$XXM", "date": "YYYY", "leadInvestor": "name", "impliedValuation": "$XXM"},
    {"round": "Seed|A|B|C|D|other", "amount": "$XXM", "date": "YYYY", "leadInvestor": "name", "impliedValuation": "$XXM"},
    {"round": "Seed|A|B|C|D|other", "amount": "$XXM", "date": "YYYY", "leadInvestor": "name", "impliedValuation": "$XXM"}
  ],
  "exitScenarios": [
    {"outcome": "Strategic Acquisition", "probability": 0, "valuationRangeM": "$XXX-XXXm", "likelyBuyer": "name", "rationale": "one sentence"},
    {"outcome": "IPO", "probability": 0, "valuationRangeM": "$X-XB", "likelyBuyer": "public markets", "rationale": "one sentence"},
    {"outcome": "PE Buyout", "probability": 0, "valuationRangeM": "$XXX-XXXm", "likelyBuyer": "PE firm type", "rationale": "one sentence"}
  ],
  "compTable": [
    {"company": "name", "arrM": 0, "multiple": 0, "outcome": "acquired|IPO|private", "acquirer": "name or null"},
    {"company": "name", "arrM": 0, "multiple": 0, "outcome": "acquired|IPO|private", "acquirer": "name or null"},
    {"company": "name", "arrM": 0, "multiple": 0, "outcome": "acquired|IPO|private", "acquirer": "name or null"},
    {"company": "name", "arrM": 0, "multiple": 0, "outcome": "acquired|IPO|private", "acquirer": "name or null"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important funding/valuation finding", "confidence": "H|M|L"}
}
<<<END_DATA_BLOCK>>>`,

  pricing: `<<<DATA_BLOCK>>>
{
  "agent": "pricing",
  "kpis": [
    {"label": "Pricing Model", "value": "word", "sub": "credits|seat|consumption|tier|outcome", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Pricing Power", "value": "word", "sub": "strong|moderate|weak", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Value Metric Alignment", "value": "word", "sub": "strong|partial|misaligned", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Enterprise Pricing Gap", "value": "word", "sub": "addressed|partial|missing", "trend": "up|down|flat|watch", "confidence": "H|M|L"}
  ],
  "pricingModelAssessment": [
    {"dimension": "Predictability for buyer", "score": 0, "verdict": "good|neutral|problem", "evidence": "one sentence"},
    {"dimension": "NRR expansion mechanics", "score": 0, "verdict": "good|neutral|problem", "evidence": "one sentence"},
    {"dimension": "Enterprise scalability", "score": 0, "verdict": "good|neutral|problem", "evidence": "one sentence"},
    {"dimension": "Competitive positioning", "score": 0, "verdict": "good|neutral|problem", "evidence": "one sentence"},
    {"dimension": "Value metric alignment", "score": 0, "verdict": "good|neutral|problem", "evidence": "one sentence"}
  ],
  "pricingComps": [
    {"company": "name", "model": "describe", "avgACV": "$XXk", "nrrSignal": "strong|moderate|weak", "lesson": "one sentence"},
    {"company": "name", "model": "describe", "avgACV": "$XXk", "nrrSignal": "strong|moderate|weak", "lesson": "one sentence"},
    {"company": "name", "model": "describe", "avgACV": "$XXk", "nrrSignal": "strong|moderate|weak", "lesson": "one sentence"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important pricing finding", "confidence": "H|M|L"}
}
<<<END_DATA_BLOCK>>>`,

  intl: `<<<DATA_BLOCK>>>
{
  "agent": "intl",
  "kpis": [
    {"label": "Est. International Revenue", "value": "XX%", "sub": "share of total ARR", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Primary Expansion Market", "value": "region", "sub": "most ready for expansion", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Regulatory Barrier Level", "value": "word", "sub": "high|medium|low by region", "trend": "up|down|flat|watch", "confidence": "H|M|L"},
    {"label": "Best Global Benchmark", "value": "company name", "sub": "closest comparable trajectory", "trend": "up|down|flat|watch", "confidence": "H|M|L"}
  ],
  "globalBenchmarks": [
    {"company": "name", "market": "region", "similarity": "H|M|L", "lesson": "one specific actionable lesson", "outcome": "succeeded|failed|mixed"},
    {"company": "name", "market": "region", "similarity": "H|M|L", "lesson": "one specific actionable lesson", "outcome": "succeeded|failed|mixed"},
    {"company": "name", "market": "region", "similarity": "H|M|L", "lesson": "one specific actionable lesson", "outcome": "succeeded|failed|mixed"}
  ],
  "expansionMarkets": [
    {"market": "region/country", "readiness": "H|M|L", "tam": "$XXM", "barrier": "describe main barrier", "priority": 1},
    {"market": "region/country", "readiness": "H|M|L", "tam": "$XXM", "barrier": "describe main barrier", "priority": 2},
    {"market": "region/country", "readiness": "H|M|L", "tam": "$XXM", "barrier": "describe main barrier", "priority": 3}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — single most important international finding", "confidence": "H|M|L"}
}
<<<END_DATA_BLOCK>>>`,

  synopsis: `<<<DATA_BLOCK>>>
{
  "agent": "synopsis",
  "kpis": [
    {"label": "Overall Verdict", "value": "word", "sub": "basis in one phrase", "trend": "up", "confidence": "H"},
    {"label": "Biggest Opportunity", "value": "$XXM", "sub": "what it is", "trend": "up", "confidence": "H|M|L"},
    {"label": "Biggest Risk", "value": "name it", "sub": "why it matters", "trend": "watch", "confidence": "H|M|L"},
    {"label": "12-Month Inflection", "value": "short label", "sub": "the decision that determines the outcome", "trend": "up|watch", "confidence": "H|M|L"}
  ],
  "agentVerdicts": [
    {"agent": "Market",      "agentId": "market",      "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Product",     "agentId": "product",     "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "GTM",         "agentId": "gtm",         "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Revenue",     "agentId": "revenue",     "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Customer",    "agentId": "customer",    "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Competitive", "agentId": "competitive", "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Funding",     "agentId": "funding",     "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Pricing",     "agentId": "pricing",     "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"},
    {"agent": "Global",      "agentId": "intl",        "verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "oneLiner": "one sentence"}
  ],
  "topActions": [
    {"rank": 1, "action": "specific action", "owner": "team", "quarter": "Q? 20??", "impactM": 0, "effort": "H|M|L"},
    {"rank": 2, "action": "specific action", "owner": "team", "quarter": "Q? 20??", "impactM": 0, "effort": "H|M|L"},
    {"rank": 3, "action": "specific action", "owner": "team", "quarter": "Q? 20??", "impactM": 0, "effort": "H|M|L"},
    {"rank": 4, "action": "specific action", "owner": "team", "quarter": "Q? 20??", "impactM": 0, "effort": "H|M|L"},
    {"rank": 5, "action": "specific action", "owner": "team", "quarter": "Q? 20??", "impactM": 0, "effort": "H|M|L"}
  ],
  "risks": [
    {"risk": "describe risk", "severity": "H|M|L", "mitigation": "one sentence"},
    {"risk": "describe risk", "severity": "H|M|L", "mitigation": "one sentence"},
    {"risk": "describe risk", "severity": "H|M|L", "mitigation": "one sentence"}
  ],
  "opportunities": [
    {"opportunity": "describe it", "valueM": 0, "confidence": "H|M|L"},
    {"opportunity": "describe it", "valueM": 0, "confidence": "H|M|L"},
    {"opportunity": "describe it", "valueM": 0, "confidence": "H|M|L"}
  ],
  "verdictRow": {"verdict": "STRONG|WATCH|OPTIMISE|UNDERDELIVERED|RISK", "finding": "one sentence — the single most important finding across all 9 agents", "confidence": "H|M|L"},
  "boardQuestions": [
    {"question": "specific strategic question the board must answer", "whyItMatters": "one sentence — consequence if unanswered", "answerableBy": "primary research|founder conversation|market test|regulatory clarity"},
    {"question": "specific strategic question the board must answer", "whyItMatters": "one sentence — consequence if unanswered", "answerableBy": "primary research|founder conversation|market test|regulatory clarity"},
    {"question": "specific strategic question the board must answer", "whyItMatters": "one sentence — consequence if unanswered", "answerableBy": "primary research|founder conversation|market test|regulatory clarity"}
  ]
}
<<<END_DATA_BLOCK>>>`

  // brief is consumer-only — this entry prevents silent fallback to market schema
  // The SaaS guard above means this is never reached in practice
  // brief: null  (intentionally absent — consumer App.js owns the brief prompt)

};


// ━━━ SAAS AGENT PROMPTS ━━━
const SAAS_PROMPTS = {

  market: `# AGENT 1: MARKET & CATEGORY INTELLIGENCE

## YOUR MANDATE
Define the battlefield. What category does [COMPANY] actually compete in — and is that the right category to be in? Most companies describe their category in self-serving terms. Your job is to define it accurately, map its size and maturity, and identify the 2-3 structural forces that will reshape it in the next 3 years.

## WHAT YOU MUST PRODUCE

**Category Definition — Commit to One**
[COMPANY] may compete in multiple adjacent categories. Name the primary one with precision. For data enrichment companies: is it "B2B data," "GTM tooling," "revenue intelligence," or "workflow automation"? The choice determines the competitive set, the valuation multiple, and the strategic options. Do not hedge — pick the most accurate category and explain why.

**TAM — Built Two Ways**
Top-down: total B2B SaaS spend on this category, apply realistic penetration rate, show calculation.
Bottom-up: number of addressable buyers × average ACV × realistic conversion. Show both, explain if they diverge significantly, state which you find more credible.

**Category Maturity Signal**
Is this category in land-grab phase (grow at all costs, winner-take-most dynamics), growth phase (multiple winners possible, efficiency starting to matter), or consolidation phase (M&A pressure, profitability required, bundling threat)? The answer changes what [COMPANY] should be doing right now. State your verdict with evidence.

**3 Structural Forces**
Identify the forces that will reshape this category in 3 years. Not generic trends — specific, named forces with timeline and impact direction. Examples: a major acquisition that changes the competitive map, a regulatory development that restricts current practices, an AI capability that makes current tooling obsolete. For each: tailwind or headwind for [COMPANY], and why.

**Competitive Landscape Map**
Name the 5 most relevant competitors. For each: estimated revenue, growth signal, and their position (leader, challenger, niche, emerging). Where is [COMPANY] in this map — and is that position improving or eroding?

## SEARCHES TO RUN (pick the 3 most valuable)
- "[COMPANY] market category size TAM 2024 2025"
- "[COMPANY] competitors market share 2024"
- "[category name] market growth consolidation 2025"
- "biggest acquisition [category] 2023 2024"

## WHAT NOT TO COVER
Do not cover product architecture, pricing, unit economics, competitive tactics, or funding — those belong to other agents. Stay strictly within market and category dynamics.`,

  product: `# AGENT 2: PRODUCT & PLATFORM ARCHITECTURE

## YOUR MANDATE
Interrogate the product itself. Not what the marketing page says — what the product actually does, where the technical moat genuinely sits, and whether the architecture is built for the next phase of growth or the last one. The central question: is this product defensible or replicable?

## WHAT YOU MUST PRODUCE

**The Core Mechanic — Precisely**
Describe exactly what [COMPANY]'s product does in 3-4 sentences with technical precision. No marketing language. What data flows in, what transformation occurs, what the user gets out. This establishes the foundation for every other assessment.

**Network Effects Audit — Commit to a Verdict**
Does [COMPANY]'s product get meaningfully better as more customers use it? Specifically: does usage data from one customer improve results for another? If yes, describe the exact mechanism — this is a genuine data network effect and the moat is real. If no, say so clearly. Partial network effects are common; quantify what percentage of the product benefit comes from network dynamics vs raw product quality.

**Disintermediation Risk — Name the Threats**
Who are [COMPANY]'s key suppliers, partners, or data providers? For each critical dependency: what is the realistic scenario where they decide to build what [COMPANY] does natively? What is the probability and timeline? This is often the most important product risk and it must be addressed directly, not waved away.

**Platform vs Point Solution Assessment**
A platform creates value for other builders on top of it. A point solution solves one problem well. Where is [COMPANY] on this spectrum today, and where is the product strategy pointing? Specific evidence: do third parties build on [COMPANY]'s API? Is there an app marketplace or ecosystem? What would make this a platform and how far away is it?

**AI Integration — Genuine or Cosmetic?**
Assess [COMPANY]'s AI features or roadmap. Is AI integration genuinely transforming the product's value delivery — or is it a feature layer on a fundamentally unchanged architecture? What specifically does the AI version do that the non-AI version could not? Does it create a new moat or just maintain parity with competitors who are all doing the same thing?

**Build vs Buy vs Partner Map**
What has [COMPANY] built natively, what does it aggregate from partners, and what does it buy through acquisition? This map reveals what the company believes its core competence is. Assess whether those boundaries are drawn correctly.

## SEARCHES TO RUN (pick the 3 most valuable)
- "[COMPANY] product how it works technology architecture"
- "[COMPANY] API platform integrations developer"
- "[COMPANY] AI features product roadmap 2024 2025"
- "[COMPANY] data network effects moat"

## WHAT NOT TO COVER
Do not cover pricing, GTM motion, competitive tactics, or financial metrics — those belong to other agents. Stay within product architecture and technical differentiation.`,

  gtm: `# AGENT 3: GO-TO-MARKET & REVENUE ARCHITECTURE

## YOUR MANDATE
Map how [COMPANY] acquires, converts, and expands customers. The central question: is the GTM engine efficient and scalable, or is growth masking a fundamentally broken motion?

## WHAT YOU MUST PRODUCE

**GTM Motion Classification — Be Specific**
Is [COMPANY] product-led (users discover and adopt independently), sales-led (AEs drive deals), community-led (practitioners spread word-of-mouth), or a hybrid? For each motion present, assess: what percentage of new ARR does it drive, and is that percentage growing or shrinking? The honest answer here is often more complex than the company's public narrative.

**The Growth Loop — Find and Quantify It**
Every high-growth SaaS company has a flywheel. For PLG companies: a user adopts → builds something public → drives new signups. For community-led: practitioners share → create demand → convert. Describe [COMPANY]'s specific loop, identify the rate-limiting step, and assess whether it is compounding or plateauing. Where does the loop break?

**Pricing Model Mechanics**
Describe the exact pricing model — seat-based, credit-based, consumption-based, tiered, or outcome-based. For each model element: does it align price with value delivered? Does it create natural expansion revenue as customers grow? Does it make budgeting easy or hard for buyers? Does it work for SMB and enterprise or just one? Credit-based and consumption-based models require specific scrutiny — find customer complaints about pricing predictability.

**Enterprise Transition Readiness**
PLG and community-led motions work brilliantly up to a certain company size, then require sales infrastructure to continue scaling. Where is [COMPANY] in this transition? Specific evidence: VP of Enterprise Sales hired when, AE headcount, published enterprise tier, SOC 2 certification, MSA capability. If [COMPANY] is pre-transition, what is the ceiling on the current motion and how far away is it?

**Content and Community as Distribution**
Assess [COMPANY]'s content, community, and thought leadership as a GTM moat. Is the playbook/template ecosystem proprietary and defensible or can a well-funded competitor replicate it in 12 months? What is the cost of content/community acquisition vs paid acquisition? Which channel drives the highest-quality customers?

## SEARCHES TO RUN (pick the 3 most valuable)
- "[COMPANY] go to market strategy growth PLG community"
- "[COMPANY] pricing plans enterprise 2024 2025"
- "[COMPANY] sales team hiring enterprise AE 2024"
- "[COMPANY] customer acquisition growth loop playbook"

## WHAT NOT TO COVER
Do not cover product architecture, financial metrics, competitive moat analysis, or funding — those belong to other agents.`,

  revenue: `# AGENT 4: REVENUE HEALTH & UNIT ECONOMICS

## YOUR MANDATE
Build the financial picture from public signals. [COMPANY] is likely private — no published financials. Your job is to triangulate ARR, growth rate, gross margin, and unit economics from three independent methods, show your work on every number, and land on a credible range with honest confidence levels.

## WHAT YOU MUST PRODUCE

**ARR Triangulation — Three Methods**
Method 1 — Funding back-calculation: Take the last known valuation. Apply current SaaS revenue multiples for companies at this growth stage (find current market data — multiples have compressed significantly from 2021 peaks). Back-calculate implied ARR. Show the multiple used and its source.
Method 2 — Headcount × revenue per employee: Find current headcount (LinkedIn). Apply the revenue-per-employee benchmark for SaaS companies at this stage ($150k-$300k/employee is typical range depending on GTM motion). Show the benchmark used.
Method 3 — Public signals: Founder interviews, press releases, customer announcements, job posting volume changes YoY. What do these signals imply about scale?
State all three estimates. If they converge, high confidence. If they diverge, explain why and weight them.

**Growth Rate Estimation**
Find YoY growth signals: headcount growth rate (LinkedIn 6-month snapshots), job posting volume trend, any public revenue statements. Calculate what growth rate the current valuation requires at prevailing SaaS multiples — does the market signal data support that rate? Be honest if it doesn't.

**Gross Margin Assessment**
Pure SaaS: 75-85%. Data aggregators with per-query COGS: 60-70%. Services-heavy businesses: 40-60%. Classify [COMPANY] and estimate gross margin accordingly. This matters for valuation — a 65% gross margin business is worth materially less than an 80% gross margin business at the same revenue. Find any comparable companies whose gross margins are public and use them as benchmarks.

**Rule of 40**
Growth rate + FCF margin. For pre-profitability companies, FCF margin is negative — estimate burn rate from headcount and funding runway. Calculate best case and worst case Rule of 40. Benchmark against 4-5 public SaaS companies at similar scale and growth stage.

**Burn Multiple**
New ARR added ÷ net cash burned. Best-in-class is below 1x. Estimate from funding history and headcount growth. What does this imply about capital efficiency?

## SEARCHES TO RUN (pick the 3 most valuable)
- "[COMPANY] revenue ARR 2024 growth rate"
- "[COMPANY] funding valuation investors 2024"
- "[COMPANY] headcount employees LinkedIn 2024"
- "SaaS revenue multiples 2024 2025 growth stage"

## WHAT NOT TO COVER
Do not cover pricing model design, competitive dynamics, product architecture, or exit scenarios — those belong to other agents. Focus entirely on revenue health and unit economics.`,

  customer: `# AGENT 5: CUSTOMER & SEGMENT INTELLIGENCE

## YOUR MANDATE
Identify who is actually buying [COMPANY], which segments are healthy, and where the dangerous concentrations are. The central question: which customers are the engine and which are the anchor?

## WHAT YOU MUST PRODUCE

**ICP Definition — Be Precise**
The ideal customer profile is not "B2B SaaS companies." Define it with specificity: company size range (employees or ARR), industry vertical if concentrated, the specific job title that champions [COMPANY] internally, the specific pain that drives purchase, and the tech stack they typically run alongside [COMPANY]. Find evidence for each element — customer case studies, G2 reviewer profiles, company blog posts about customer stories.

**Segment Map — Engine vs Anchor**
Identify 3-4 distinct customer segments. For each: estimated size as share of customer base, retention signal (are customers in this segment staying or churning — find evidence from reviews, social media, churned customer comments), expansion signal (are they buying more over time), and a verdict — engine (growing, retaining, expanding), neutral (stable, not a priority), or anchor (high churn, high support cost, low ACV).

**Top 3 Churn Drivers**
Find the real reasons customers leave. Primary sources: G2 and Capterra reviews filtered for negative, Reddit and Slack community discussions, Twitter/X complaints. Do not guess — find evidence. For each driver: which segment does it concentrate in, severity, and what would fix it.

**Customer Concentration Risk**
Does [COMPANY] have a small number of very large, very vocal customers who represent disproportionate revenue? The PLG trap: a few power users with huge followings create enormous brand value but may not represent the median paying customer. Assess whether the customer base is broadly distributed or dangerously concentrated in a segment that could shift.

**The SMB Trap Assessment**
Many PLG companies grow fast with startups and early-stage companies who churn when they run out of funding, pivot, or get acquired. Estimate what percentage of [COMPANY]'s customer base is in companies under 50 employees or pre-Series B funding. What does that imply for cohort retention over a 24-month horizon?

## SEARCHES TO RUN (pick the 3 most valuable)
- "[COMPANY] customer reviews G2 Capterra 2024"
- "[COMPANY] case studies customers enterprise 2024"
- "[COMPANY] churn complaints Reddit Twitter 2024"
- "[COMPANY] ideal customer profile target market"

## WHAT NOT TO COVER
Do not cover pricing model, product architecture, competitive dynamics, or financial metrics — those belong to other agents.`,

  competitive: `# AGENT 6: COMPETITIVE MOAT & BATTLEGROUND

## YOUR MANDATE
Map the competitive landscape with tactical precision. The central question: how durable is [COMPANY]'s competitive position and where is it most vulnerable? Every claim of differentiation must be stress-tested against a well-funded competitor with 18 months and a clear attack vector.

## WHAT YOU MUST PRODUCE

**Switching Cost Quantification**
What does a customer actually lose when they leave [COMPANY]? Be specific: data exported and lost, workflows rebuilt, integrations re-implemented, team retraining, lost institutional knowledge. Estimate this in hours and dollars for a mid-market customer who has been on [COMPANY] for 18 months. High switching cost = durable position. Low switching cost = the moat is shallower than the company claims.

**Competitor Battlecard — 4 Named Threats**
For each: estimated revenue, overlap with [COMPANY]'s core use case (high/medium/low), their most effective attack vector against [COMPANY], their biggest vulnerability that [COMPANY] could exploit, and an overall threat level. Be specific and honest — if a competitor is genuinely superior in a key dimension, say so.

**The Partner-Becomes-Competitor Risk**
Identify which of [COMPANY]'s current partners or data suppliers have the distribution, data, and incentive to build what [COMPANY] does natively. For each: what would trigger the decision to compete, what is the realistic timeline, and what is the impact if they do. This is often the most underestimated competitive threat in SaaS.

**Moat Components — Honest Assessment**
Break the moat into specific components: data assets, network effects, switching costs, brand, community, technical architecture. For each: rate the strength (0-10), assess whether a competitor with sufficient funding could replicate it in 6, 12, or 24 months, and give a verdict. If the honest answer is that the moat is primarily brand and community — which are real but not structural — say so.

**Defensible Differentiation After Removing Marketing**
After stripping out what every competitor also claims (AI-powered, easy to use, integrates with everything), what does [COMPANY] have that is genuinely unique and not replicable in 18 months? This is the core of the moat. If the list is short, that is the most important finding.

## SEARCHES TO RUN (pick the 3 most valuable)
- "[COMPANY] vs [top competitor] comparison 2024 2025"
- "[COMPANY] competitors alternatives 2024"
- "[top partner] building competing feature [COMPANY] 2024"
- "[COMPANY] switching cost migration"

## WHAT NOT TO COVER
Do not cover financial metrics, pricing architecture, funding, or product roadmap details — those belong to other agents.`,

  funding: `# AGENT 7: FUNDING, VALUATION & STRATEGIC OPTIONS

## YOUR MANDATE
Reconstruct the financial picture from public signals and model the exit landscape. The central question: what is [COMPANY] actually worth today, who writes the next cheque or the acquisition offer, and what does the cap table pressure mean for decisions being made right now?

## WHAT YOU MUST PRODUCE

**Funding History Reconstruction**
Map every known funding round: amount, date, lead investor, implied valuation if available. From this, derive: total capital raised, approximate ownership structure, and what each round's size and timing implies about the company's trajectory at that moment. A down round or long gap between rounds is as significant as a headline raise.

**Valuation Benchmarking**
Current implied valuation ÷ estimated ARR (from Agent 4) = revenue multiple. Find current SaaS revenue multiples for comparable public companies at similar growth rates — multiples have compressed 60-70% from 2021 peaks and the market has bifurcated between high-growth AI-adjacent companies and everything else. Is [COMPANY]'s multiple justified, rich, or cheap? Show the comp table with 4 named companies.

**Three Exit Scenarios — Probability Weighted**
Scenario 1 — Strategic Acquisition: Who buys [COMPANY] and why? Name the most likely acquirer specifically, explain the strategic rationale (distribution leverage, data asset, competitive defence, product extension), and estimate the valuation range at acquisition. What would have to be true for this to happen in the next 24 months?
Scenario 2 — IPO: What ARR, growth rate, and profitability profile does [COMPANY] need to be IPO-ready? At current trajectory when does it get there? What is the narrative risk — does the story differentiate from comparable public companies or does it invite comparison to companies that have underperformed?
Scenario 3 — PE Buyout or Recapitalisation: At what point does a PE firm make a credible offer? What growth rate decline or cap table pressure would trigger this path?

**Cap Table Pressure Analysis**
Investors in the last round paid a specific price per share. What return do they need and by when? What does that pressure mean for the decisions being made right now — IPO timeline, acquisition openness, pricing strategy, hiring pace?

**Investor Signal Reading**
Who are the lead investors and what does their portfolio and investment thesis reveal about how they see [COMPANY]'s future? A16z, Sequoia, and Accel back different archetypes. The lead investor's other bets are a signal about the exit path they are optimising for.

## SEARCHES TO RUN (pick the 3 most valuable)
- "[COMPANY] funding rounds investors valuation 2024"
- "[COMPANY] acquisition IPO strategic options"
- "SaaS M&A multiples [category] 2024 2025"
- "[most likely acquirer] acquisition strategy [category]"

## WHAT NOT TO COVER
Do not cover product architecture, customer segments, pricing design, or GTM motion — those belong to other agents.`,

  pricing: `# AGENT 8: PRICING POWER & REVENUE MODEL ARCHITECTURE

## YOUR MANDATE
Stress-test the revenue model. Not just what [COMPANY] charges — whether the pricing architecture is correctly designed for the business it is trying to build. The central question: is the pricing model capturing the maximum revenue the market will bear, or is it leaving money on the table while creating friction that limits growth?

## WHAT YOU MUST PRODUCE

**Pricing Model Mechanics — Precise Description**
Describe exactly how [COMPANY] charges customers. Credits per action, seats per user, consumption tiers, outcome-based, or hybrid. For credit-based models specifically: what triggers a credit spend, what is the cost per credit at each tier, and what happens when credits run out. Find this from the public pricing page, customer reviews, and any published pricing analysis. Do not guess — find the actual numbers.

**The Five-Dimension Assessment**
Score the pricing model on:
1. Predictability for the buyer — can enterprise finance teams forecast their annual spend? Variable pricing models that create surprise invoices kill enterprise deals.
2. NRR expansion mechanics — does the pricing model create natural expansion as customers grow? The best models grow revenue without any sales effort.
3. Enterprise scalability — does the model work for a 500-person revenue team the same way it works for a 5-person startup? Or does it break at enterprise scale?
4. Competitive positioning — does the pricing signal premium, fair value, or commodity? Does it make the sales conversation easier or harder?
5. Value metric alignment — is [COMPANY] pricing on the unit that most directly scales with customer value delivered? For enrichment tools, contacts found is better than API calls. Verified pipeline influenced is better than contacts found.

**Pricing Power Stress Test**
If [COMPANY] raised prices 30% tomorrow, what percentage of customers would leave? Which segment would leave first — startups, mid-market, or enterprise? The answer reveals where the real moat is. Find evidence from customer reviews about price sensitivity and value perception. A company with genuine pricing power has customers who say "expensive but worth it." A company without it has customers who say "looking for alternatives."

**Benchmark Against 3 Comps**
Find 3 comparable companies whose pricing architecture is known. For each: describe their model, estimate average ACV, assess NRR signal (do customers expand or churn), and extract one specific lesson for [COMPANY]. Snowflake's consumption model, HubSpot's seat expansion, and Twilio's usage-based model are useful reference points even if not direct competitors.

**The One Pricing Change That Would Move the Needle**
Based on the above: what is the single most impactful change to [COMPANY]'s pricing architecture — adding an enterprise tier, shifting the value metric, introducing annual commit discounts, or moving to outcome-based pricing? Specify exactly what the change is, why it would improve NRR, and what the implementation risk is.

## SEARCHES TO RUN (pick the 3 most valuable)
- "[COMPANY] pricing plans credits cost 2024 2025"
- "[COMPANY] pricing complaints expensive alternative"
- "[COMPANY] enterprise pricing annual contract"
- "SaaS pricing model NRR consumption vs seat based"

## WHAT NOT TO COVER
Do not cover product architecture, GTM motion, competitive dynamics, or funding — those belong to other agents.`,

  intl: `# AGENT 9: INTERNATIONAL EXPANSION & GLOBAL BENCHMARKS

## YOUR MANDATE
Two jobs. First: find the global company that most closely mirrors [COMPANY]'s current situation and extract actionable lessons. Second: map the international expansion opportunity with honest assessment of regulatory and product barriers. The central question: what does the global playbook say about what comes next?

## WHAT YOU MUST PRODUCE

**The Primary Global Benchmark — Commit to One**
Find the company internationally that most closely matches [COMPANY] on: category, GTM motion, valuation stage, and competitive dynamics. Do not pick a vague analog — find the specific company whose trajectory is the most instructive. For data enrichment platforms the comp might be Lusha (Israeli, scaled internationally, GDPR constraints). For decision intelligence platforms the comp is YouGov (UK polling → global brand intelligence, publicly listed). For PLG-led SaaS tools look at Figma, Miro, or Notion's international expansion.
Extract 3 specific lessons from this benchmark that are actionable for [COMPANY] now — not generic observations but specific decisions the benchmark company made (or failed to make) that [COMPANY] should replicate or avoid.

**Secondary Benchmark — Different Geography or Outcome**
Find a second company that mirrors [COMPANY] but chose a different path — either a different international strategy or a different exit outcome. What does the contrast reveal?

**International Revenue Assessment**
Estimate what percentage of [COMPANY]'s current ARR comes from non-US customers. For US-founded B2B SaaS, 20-30% international at Series C stage is typical. Above that = strong international traction. Below 15% = predominantly US business with expansion optionality. Find any signals: EU-specific pricing pages, non-US customer case studies, international office hiring, non-English community content.

**Market-by-Market Expansion Assessment**
Rank 3 international markets by expansion readiness: TAM in market, product-market fit signals (existing customers, inbound demand), regulatory barrier (GDPR in EU, data localisation in India, PDPA in Southeast Asia), and localisation requirements. For each: give a readiness verdict and the single biggest barrier to overcome before expanding.

**Regulatory Constraints as Strategic Signal**
For companies handling B2B contact data (like Clay) or opinion data (like Morning Consult): which international markets require fundamental product changes to comply with local law, and which are accessible with current architecture? GDPR Article 6 lawful basis for processing B2B personal data is the most important constraint for enrichment companies. Assess [COMPANY]'s current posture and what it would take to be compliant at scale in the EU.

## SEARCHES TO RUN (pick the 3 most valuable)
- "[COMPANY] international expansion Europe customers 2024"
- "[closest benchmark company] international strategy lessons"
- "[COMPANY] GDPR compliance data privacy Europe"
- "[category] international market opportunity Europe Asia"

## WHAT NOT TO COVER
Do not cover domestic competitive dynamics, US pricing, funding, or product architecture details — those belong to other agents.`,

  synopsis: `# AGENT 10: EXECUTIVE SYNOPSIS — STRATEGIC SYNTHESIS

## YOUR MANDATE
You have read all 9 agent outputs. Your job is not to summarise them — it is to find the single insight that only emerges when you see the full picture. The thread that connects the product architecture risk, the GTM inflection, the valuation pressure, and the competitive timeline into one coherent strategic narrative. If your Synopsis could have been written without reading the 9 agents, it has failed.

## WHAT YOU MUST PRODUCE

**The Central Thesis — One Paragraph**
Not a summary of what each agent found. The overarching strategic conclusion that explains why everything is connected. What is the fundamental strategic question [COMPANY] must answer in the next 12 months — and what happens if they answer it wrong? This paragraph should make a reader who has been following [COMPANY] closely say "I hadn't thought about it that way."

**9-Agent Verdict Dashboard**
For each agent: verdict (STRONG / WATCH / OPTIMISE / UNDERDELIVERED / RISK) and one sentence — the single most important finding from that agent's analysis. These verdicts are inputs to the DATA_BLOCK.

**Top 5 Priority Actions — Sequenced**
Not 10 generic recommendations. The 5 highest-impact, most time-sensitive actions, sequenced by: impact magnitude × speed to result. For each: what specifically to do, which team owns it, which quarter to complete it, estimated revenue impact, and effort level. These should be specific enough that a founder or investor could act on them Monday morning.

**The Underweighted Risk**
The one threat that appeared in multiple agent analyses but is not getting enough attention publicly. This is the finding that separates a 10-agent synthesis from a single analyst's view — you saw it in the competitive analysis, confirmed it in the product analysis, and the funding analysis explains why it hasn't been addressed. Name it, explain why it is underweighted, and state what the consequence is if it materialises.

**Three Questions the Board Must Answer**
Not rhetorical questions — specific strategic questions that this report cannot answer because they require primary research, founder conversations, regulatory clarity, or a market test. For each: the question itself (one sentence, specific to [COMPANY], not generic), why it matters (one concrete consequence if unanswered), and what type of information would answer it. These are the questions a board member would raise that no analyst report pre-empts.

**The One Unanswered Question**
The single most important strategic question [COMPANY] has not answered publicly and must answer in the next 12 months. Not a question about tactics — a question about identity. Examples: "Is [COMPANY] a data company or a workflow company?" "Does [COMPANY] need to own the data or just orchestrate it?" "Can [COMPANY] win enterprise without a direct sales motion?" The answer to this question determines the next 3 years.

**Risks and Opportunities**
3 risks with severity and mitigation. 3 opportunities with estimated value and confidence. These are the most important ones across all 9 agents — not the obvious ones, the ones that require the full picture to see.

## SYNTHESIS STANDARD
Read every agent output. Find connections between agents that no individual agent could see. The competitive moat finding + the pricing stress test + the funding cap table pressure may together reveal a strategic imperative that none of them identified alone. That synthesis is what Opus is for.`

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
  const { prompt, agentId, market, mode } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  const isSaaS = mode === 'saas';

  // CEO Opportunity Brief is consumer-only
  // Guard so a misconfigured call fails loudly, not silently with wrong output
  if (isSaaS && agentId === 'brief') {
    return res.status(400).json({ error: 'CEO Opportunity Brief is consumer-only — not available in SaaS mode' });
  }

  // Detect if this is a [COMPANY]/ITC run (consumer mode only)
  const isYogabar = !isSaaS && (prompt.toLowerCase().includes('yogabar') || prompt.toLowerCase().includes('yoga bar'));
  const currencySymbol = (market === 'US' || market === 'Global' || isSaaS) ? '$' : '₹';
  const currencyUnit = (market === 'US' || market === 'Global' || isSaaS) ? 'M' : 'Cr';
  const currencyLabel = (market === 'US' || market === 'Global' || isSaaS) ? '$M' : '₹ Cr';

  const model =
    agentId === 'synopsis' ? 'claude-opus-4-6' :
    agentId === 'synergy'  ? 'claude-opus-4-6' :
    agentId === 'brief'    ? 'claude-opus-4-6' :
                             'claude-sonnet-4-6';

  const maxTokens =
    agentId === 'synopsis' ? 10000 :
    agentId === 'synergy'  ? 10000 :
    agentId === 'brief'    ? 12000 :
                             16000;

  const maxSearches = agentId === 'synopsis' ? 2 : agentId === 'brief' ? 3 : 5;

  // Pick schema set based on mode
  const schemaSet = isSaaS ? SAAS_DATA_BLOCK_SCHEMAS : DATA_BLOCK_SCHEMAS;
  const schema = schemaSet[agentId] || schemaSet[Object.keys(schemaSet)[0]];
  // Extract company/acquirer from prompt for schema personalisation
  const schemaCompany = (() => {
    // Primary: explicit COMPANY: prefix from App.js makePrompt
    const m = prompt.match(/^COMPANY:\s*(.+)/im);
    if (m) return m[1].trim();
    // Secondary: [COMPANY] already replaced in prompt text
    const w = prompt.match(/(?:analyzing|report on|analysis of)\s+([A-Z][\w\s]+?)(?:\s+for|\s+in|\.|,|\n)/i);
    if (w) return w[1].trim();
    // Fallback: first proper noun cluster
    const words = prompt.split('\n')[0].match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g);
    return (words && words[0]) || 'the company';
  })();
  const schemaAcquirer = (() => {
    const m = prompt.match(/^ACQUIRER:\s*(.+)/im);
    if (m) return m[1].trim();
    const a = prompt.match(/acquired by\s+([A-Z][\w\s]+?)(?:\s+in|\.|,|\n)/i);
    return a ? a[1].trim() : 'the acquirer';
  })();

  const schemaForMarket = schema
    .replace(/CURRENCY/g, currencySymbol)
    .replace(/UNIT/g, currencyUnit)
    .replace(/\[COMPANY\]/g, schemaCompany)
    .replace(/\[COMPANY_LOWER\]/g, schemaCompany.toLowerCase())
    .replace(/\[ACQUIRER\]/g, schemaAcquirer);

  // For SaaS mode: inject the SaaS narrative rules + SaaS prompt
  // For consumer mode: use the prompt as-is (NARRATIVE_RULES already in prompt from App.js)
  let finalPrompt;
  if (isSaaS) {
    // Extract company name from context (App.js sends "COMPANY: Clay\n..." prefix)
    const companyMatch = prompt.match(/^COMPANY:\s*(.+)/m);
    const companyName = companyMatch ? companyMatch[1].trim() : 'the company';
    const acquirerMatch = prompt.match(/^ACQUIRER:\s*(.+)/m);
    const acquirerName = acquirerMatch ? acquirerMatch[1].trim() : 'the acquirer';

    // Replace [COMPANY] and [ACQUIRER] placeholders in agent prompt
    // brief is consumer-only and guarded above — this line is never reached for brief
    // but if it were, fail to synopsis rather than market to make the error obvious
    const rawAgentPrompt = SAAS_PROMPTS[agentId] || (agentId === 'brief' ? null : SAAS_PROMPTS['market']);
    if (!rawAgentPrompt) return res.status(400).json({ error: `No SaaS prompt found for agentId: ${agentId}` });
    const saasAgentPrompt = rawAgentPrompt
      .replace(/\[COMPANY\]/g, companyName)
      .replace(/\[ACQUIRER\]/g, acquirerName);

    const cleanedUserContext = prompt
      .replace(/DATA_BLOCK — WRITE THIS FIRST[\s\S]*?<<<END_DATA_BLOCK>>>\s*\nDATA_BLOCK rules:[\s\S]*?Do not repeat or summarise the DATA_BLOCK in your prose\.\s*/g, '')
      .trim();

    const saasNarrativeRules = `COMPANY CONTEXT:
This is a B2B SaaS/technology company analysis. All revenue figures in $M (USD millions) unless stated otherwise.

WRITING STYLE — MANDATORY:
Write in dense, precise prose — not bullet points, not numbered lists. Paragraphs only. Each paragraph makes one argument, develops it with evidence, and lands on an implication. Numbers appear inside sentences. Never write bullet lists. HTML tables permitted only for structured comparisons.

CONFIDENCE LABELLING — MANDATORY FOR EVERY NUMBER:
Every number, estimate, or data claim must carry: [HIGH CONFIDENCE — source], [MEDIUM CONFIDENCE — basis], or [LOW CONFIDENCE — basis] immediately after it.

SHOW YOUR CALCULATIONS — MANDATORY:
When you state a revenue figure, market size, or financial projection, show the calculation inline. Format: state the figure, then: "Calculation: [starting point] × [factor] = [result]"

WEB SEARCH BUDGET: You have exactly 3 web searches. Use them on the highest-value queries — company-specific data that cannot be estimated from general knowledge.

LENGTH: Target 700-1000 words of dense prose. Complete every section. Never truncate. For Synopsis: up to 1500 words.

NEVER SHOW YOUR REASONING PROCESS: Begin immediately with analysis. No preamble, no meta-commentary.

NO OPENING ORIENTATION: Do not begin with sentences that describe what you are about to cover. Never write: "This section examines...", "In this analysis we will cover...", "Agent [N] focuses on...", or any variant. The first sentence must deliver a substantive finding — a number, a market dynamic, a competitive fact, a strategic implication. Not a description of what follows.

PROSE TIGHTENING — MANDATORY:
Do not write a sentence that only restates a number already in your DATA_BLOCK or a section header. Assume the reader has seen the number — the sentence must add interpretation, not repetition.
Do not write closing summary sentences at the end of a section. Never write: "In summary...", "Taken together...", "This analysis shows...", or any sentence that summarises what the preceding paragraph already said. End each section on its last substantive point.
Do not write transition sentences between sections. Move directly to the next section's first finding.
Every sentence must do one of: deliver a fact not yet stated, explain what a fact means, or name an action that follows from a fact. Any sentence doing none of these must not be written.

DATA_BLOCK — WRITE THIS FIRST, BEFORE YOUR PROSE:
Begin your response with this block. Fill in ALL fields with real data.
IMPORTANT: Use $M for ALL monetary values.

${schemaForMarket}

${DATA_BLOCK_RULES}`;

    finalPrompt = saasNarrativeRules + '\n\n' + cleanedUserContext + '\n\n' + saasAgentPrompt;
  } else {
    const cleanedPrompt = prompt
      .replace(/DATA_BLOCK — WRITE THIS FIRST[\s\S]*?<<<END_DATA_BLOCK>>>\s*\nDATA_BLOCK rules:[\s\S]*?Do not repeat or summarise the DATA_BLOCK in your prose\.\s*/g, '')
      .replace(/VERIFIED FINANCIAL DATA:[\s\S]*?If no figures are provided, find them through web search\.\s*/g, '');
    const verifiedBlock = isYogabar ? VERIFIED_DATA + '\n\n' : '';
    const dataBlockInstruction = `
DATA_BLOCK — WRITE THIS FIRST, BEFORE YOUR PROSE:

Begin your response with this block. Fill in ALL fields with real data from your research.
Why first: guarantees it is present even if response is long.
IMPORTANT: Use ${currencyLabel} for ALL monetary values in this DATA_BLOCK.

${schemaForMarket}

${DATA_BLOCK_RULES}`;
    finalPrompt = verifiedBlock + dataBlockInstruction + '\n\n' + cleanedPrompt;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Alt-Svc', 'clear');  // Force HTTP/1.1 — prevents Chrome QUIC drops on long streams

  const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

  // Synopsis/Synergy use Opus and take 3-4 min — keepalive every 8s to prevent QUIC drops
  const keepaliveMs = (agentId === 'synopsis' || agentId === 'synergy' || agentId === 'brief') ? 8000 : 20000;
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
