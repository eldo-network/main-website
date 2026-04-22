export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/quote" && request.method === "POST") {
      return handleQuote(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

function quoteJob(s) {
  const enterpriseSignals = [
    s.gb_size >= 100,
    s.source_count >= 4,
    s.table_count >= 30,
    ['finance', 'legal', 'healthcare'].includes(s.industry) && s.has_pii,
    s.needs_schema_redesign && s.needs_entity_resolution,
    s.needs_schema_redesign && s.needs_llm_enrichment,
  ].filter(Boolean).length;

  const midMarketSignals = [
    s.gb_size >= 20,
    s.source_count >= 2,
    s.table_count >= 15,
    s.unstructured,
    s.needs_entity_resolution,
    s.needs_llm_enrichment,
    s.needs_schema_redesign,
    ['engineering', 'manufacturing', 'finance', 'legal', 'healthcare'].includes(s.industry),
  ].filter(Boolean).length;

  let tier;
  if (enterpriseSignals >= 2 || s.gb_size >= 250) tier = 'enterprise';
  else if (midMarketSignals >= 3 || s.gb_size >= 20) tier = 'professional';
  else tier = 'essentials';

  let complexity_points = 0;
  if (s.table_count > 5)  complexity_points += 1;
  if (s.table_count > 20) complexity_points += 1;
  if (s.source_count > 1) complexity_points += 1;
  if (s.source_count > 3) complexity_points += 1;
  if (s.unstructured)            complexity_points += 2;
  if (s.needs_dedup)             complexity_points += 1;
  if (s.needs_entity_resolution) complexity_points += 2;
  if (s.needs_llm_enrichment)    complexity_points += 2;
  if (s.needs_schema_redesign)   complexity_points += 2;
  if (s.has_pii)                 complexity_points += 1;

  if (tier === 'enterprise') {
    return {
      tier, price: null, delivery_days: null,
      delivery_hint: 'Typically 8–20 weeks depending on scope',
      complexity_points, manual_review: true,
    };
  }

  const tierConfig = {
    essentials: {
      base_price: 5000,
      volume_tiers: [
        { upto: 10,       rate: 400 },
        { upto: 50,       rate: 300 },
        { upto: Infinity, rate: 300 },
      ],
      complexity_curve: [
        { upto: 2,        mult: 1.0 },
        { upto: 5,        mult: 1.3 },
        { upto: 8,        mult: 1.6 },
        { upto: Infinity, mult: 2.0 },
      ],
    },
    professional: {
      base_price: 25000,
      volume_tiers: [
        { upto: 20,       rate: 0   },
        { upto: 100,      rate: 800 },
        { upto: 250,      rate: 500 },
        { upto: Infinity, rate: 500 },
      ],
      complexity_curve: [
        { upto: 2,        mult: 1.0 },
        { upto: 5,        mult: 1.4 },
        { upto: 8,        mult: 1.8 },
        { upto: Infinity, mult: 2.3 },
      ],
    },
  };

  const cfg = tierConfig[tier];

  let volume_price = 0;
  let remaining = s.gb_size;
  let prevThreshold = 0;
  for (const band of cfg.volume_tiers) {
    const bandSize = Math.min(remaining, band.upto - prevThreshold);
    if (bandSize > 0) volume_price += bandSize * band.rate;
    remaining -= bandSize;
    prevThreshold = band.upto;
    if (remaining <= 0) break;
  }

  let complexity_multiplier = 1.0;
  for (const band of cfg.complexity_curve) {
    if (complexity_points <= band.upto) { complexity_multiplier = band.mult; break; }
  }

  const industry_multipliers = {
    general: 1.0, ecommerce: 1.0, restaurant: 1.0,
    realestate: 1.1, engineering: 1.2, manufacturing: 1.2,
    finance: 1.45, legal: 1.5, healthcare: 1.55,
  };
  const industry_multiplier = industry_multipliers[s.industry] ?? 1.15;
  const urgency_multiplier = s.expedited ? 1.35 : 1.0;

  const subtotal = cfg.base_price + volume_price;
  const total_price = subtotal * complexity_multiplier * industry_multiplier * urgency_multiplier;

  const CURRENT_QUEUE_JOBS = 0;
  let base_days = tier === 'professional' ? 20 : 10;
  if (s.gb_size > 10)  base_days += 2;
  if (s.gb_size > 50)  base_days += 4;
  if (s.gb_size > 100) base_days += 6;
  base_days += Math.floor(complexity_points / 2) * (tier === 'professional' ? 2 : 1);
  base_days += CURRENT_QUEUE_JOBS;

  const delivery_days = s.expedited
    ? Math.max(5, Math.round(base_days * 0.7))
    : base_days;

  const manual_review = (
    s.industry === 'other' ||
    complexity_points >= 9 ||
    (['legal', 'healthcare'].includes(s.industry) && s.has_pii) ||
    (s.needs_schema_redesign && s.needs_entity_resolution && s.needs_llm_enrichment)
  );

  return {
    tier,
    price: Math.round(total_price / 100) * 100,
    delivery_days,
    manual_review,
    complexity_points,
  };
}

async function handleQuote(request, env) {
  try {
    const body = await request.json();

    const gbSize = parseFloat(body.gb_size) || 0.5;
    const sourceCount = parseInt(body.source_count) || 1;
    const industry = (body.industry || "general").toLowerCase();
    const hasPii = body.has_pii !== "no";
    const unstructured = body.unstructured === true;
    const needsDedup = body.needs_dedup === true;
    const needsEntityResolution = body.needs_entity_resolution === true;
    const needsLlmEnrichment = body.needs_llm_enrichment === true;
    const needsSchemaRedesign = body.needs_schema_redesign === true;
    const expedited = body.expedited === true;
    const email = body.email || "";

    const tableCount = sourceCount * 3 + (gbSize > 10 ? 5 : 0) + (gbSize > 50 ? 10 : 0);

    const quote = quoteJob({
      gb_size: gbSize,
      source_count: sourceCount,
      table_count: tableCount,
      industry,
      has_pii: hasPii,
      unstructured,
      needs_dedup: needsDedup,
      needs_entity_resolution: needsEntityResolution,
      needs_llm_enrichment: needsLlmEnrichment,
      needs_schema_redesign: needsSchemaRedesign,
      expedited,
    });

    const complexityPoints = quote.complexity_points;
    const manualReview = quote.manual_review;

    // Convert delivery_days → human range; null for enterprise
    let deliveryRange = null;
    if (quote.delivery_days !== null) {
      const lo = Math.floor(quote.delivery_days / 5);
      const hi = lo + 1;
      deliveryRange = `${lo}–${hi} weeks`;
    }

    // Build price range from single midpoint; null for enterprise
    let priceLow = null, priceHigh = null;
    if (quote.price !== null) {
      priceLow  = Math.round((quote.price * 0.9) / 100) * 100;
      priceHigh = Math.round((quote.price * 1.1) / 100) * 100;
    }

    const industryLabels = {
      ecommerce: "E-commerce / Retail",
      restaurant: "Restaurant / Hospitality",
      realestate: "Real Estate",
      engineering: "Engineering / Construction",
      manufacturing: "Manufacturing",
      finance: "Finance / Fintech",
      legal: "Legal",
      healthcare: "Healthcare",
      other: "Other / Not listed",
      general: "General",
    };
    const sizeLabels = {
      "0.5": "A few spreadsheets",
      "5": "Small database (1–10 GB)",
      "30": "Medium dataset (10–50 GB)",
      "75": "Large dataset (50–100 GB)",
      "150": "Enterprise scale (100+ GB)",
    };
    const sourceLabels = {
      "1": "Just one system",
      "2": "2–3 systems",
      "4": "4–5 systems",
      "6": "6 or more",
    };
    const needsList = [
      needsDedup && "Remove duplicates",
      needsEntityResolution && "Match & merge records across sources",
      needsLlmEnrichment && "AI-powered enrichment",
      needsSchemaRedesign && "Restructure / redesign schema",
      unstructured && "Unstructured data (docs, PDFs, emails)",
    ].filter(Boolean);

    const fmt = (n) => "$" + n.toLocaleString("en-US");
    const estimateRange = `${fmt(priceLow)} – ${fmt(priceHigh)}`;
    const industryLabel = industryLabels[industry] || industry;
    const sizeLabel = sizeLabels[String(body.gb_size)] || body.gb_size;
    const sourceLabel = sourceLabels[String(body.source_count)] || body.source_count;
    const piiLabel = body.has_pii === "yes" ? "Yes" : body.has_pii === "no" ? "No" : "Not sure";

    const scopeRows = `
      <tr><td style="color:#94a3b8;padding:6px 0;border-bottom:1px solid #1e293b">Industry</td><td style="padding:6px 0;border-bottom:1px solid #1e293b">${industryLabel}</td></tr>
      <tr><td style="color:#94a3b8;padding:6px 0;border-bottom:1px solid #1e293b">Data size</td><td style="padding:6px 0;border-bottom:1px solid #1e293b">${sizeLabel}</td></tr>
      <tr><td style="color:#94a3b8;padding:6px 0;border-bottom:1px solid #1e293b">Sources</td><td style="padding:6px 0;border-bottom:1px solid #1e293b">${sourceLabel}</td></tr>
      <tr><td style="color:#94a3b8;padding:6px 0;border-bottom:1px solid #1e293b">Sensitive data</td><td style="padding:6px 0;border-bottom:1px solid #1e293b">${piiLabel}</td></tr>
      <tr><td style="color:#94a3b8;padding:6px 0;border-bottom:1px solid #1e293b">Timeline</td><td style="padding:6px 0;border-bottom:1px solid #1e293b">${expedited ? "Expedited" : "Standard"}</td></tr>
      <tr><td style="color:#94a3b8;padding:6px 0" valign="top">Needs</td><td style="padding:6px 0">${needsList.length ? needsList.join("<br>") : "Not specified"}</td></tr>
    `;

    const internalHtml = `
      <div style="font-family:sans-serif;background:#0b0f14;color:#e2e8f0;padding:40px;max-width:560px;margin:0 auto;border-radius:12px">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#94a3b8">Eldo Network</p>
        <h1 style="margin:0 0 24px;font-size:22px;font-weight:600">New quote request</h1>
        <p style="margin:0 0 24px;font-size:15px;color:#cbd5e1">From <a href="mailto:${email}" style="color:#f1c453">${email}</a></p>
        <p style="margin:0 0 16px;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#475569">Tier: ${quote.tier}</p>
        ${manualReview ? `<p style="background:#422006;color:#fbbf24;padding:12px 16px;border-radius:8px;font-size:13px;margin:0 0 24px">⚠ Manual review flagged — do not send standard pricing without a custom scope call.</p>` : ""}
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">${scopeRows}</table>
        <div style="background:#0f172a;border-radius:8px;padding:20px;margin-bottom:24px">
          <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#94a3b8">Estimate shown to client</p>
          <p style="margin:0;font-size:28px;font-weight:700;color:#f1c453">${priceLow === null ? "Enterprise — custom scope" : estimateRange}</p>
          ${priceLow !== null ? `<p style="margin:6px 0 0;font-size:13px;color:#94a3b8">Delivery: ${deliveryRange} &nbsp;·&nbsp; Complexity score: ${complexityPoints}</p>` : ""}
          ${priceLow === null ? `<p style="margin:6px 0 0;font-size:13px;color:#94a3b8">Internal range: $250k–$1.5M · Delivery: 8–20 weeks</p>` : ""}
        </div>
        <a href="mailto:${email}" style="display:inline-block;background:#f1c453;color:#0b0f14;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">Reply to ${email}</a>
      </div>
    `;

    const clientHtml = `
      <div style="font-family:sans-serif;background:#0b0f14;color:#e2e8f0;padding:40px;max-width:560px;margin:0 auto;border-radius:12px">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#94a3b8">Eldo Network</p>
        <h1 style="margin:0 0 24px;font-size:22px;font-weight:600">Your estimate</h1>
        <div style="background:#0f172a;border-radius:8px;padding:24px;margin-bottom:28px;text-align:center">
          ${manualReview
            ? `<p style="margin:0 0 8px;font-size:13px;color:#94a3b8">Estimate</p>
               <p style="margin:0;font-size:28px;font-weight:700;color:#f1c453">Custom scope</p>
               <p style="margin:10px 0 0;font-size:14px;color:#94a3b8">Your project needs a closer look before we can put a number on it. We'll follow up shortly.</p>`
            : `<p style="margin:0 0 8px;font-size:13px;color:#94a3b8">Estimate</p>
               <p style="margin:0;font-size:32px;font-weight:700;color:#f1c453">${estimateRange}</p>
               <p style="margin:10px 0 0;font-size:14px;color:#94a3b8">Usually delivered in ${deliveryRange}</p>`
          }
        </div>
        <p style="margin:0 0 16px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8">What you submitted</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:28px">${scopeRows}</table>
        <div style="border-top:1px solid #1e293b;padding-top:24px">
          <p style="margin:0;font-size:14px;color:#cbd5e1">We'll follow up at this address within one business day to talk through scope and next steps. Just reply to this email if you have questions in the meantime.</p>
          <p style="margin:16px 0 0;font-size:14px;color:#94a3b8">— Joseph, Eldo Network<br><a href="mailto:joseph@eldo.network" style="color:#f1c453">joseph@eldo.network</a></p>
        </div>
      </div>
    `;

    const resendKey = env.RESEND_API_KEY;
    if (resendKey && email) {
      await Promise.allSettled([
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: "Eldo Network <joseph@eldo.network>",
            to: ["joseph@eldo.network"],
            reply_to: email,
            subject: `New quote request — ${email}`,
            html: internalHtml,
          }),
        }),
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: "Eldo Network <joseph@eldo.network>",
            to: [email],
            reply_to: "joseph@eldo.network",
            subject: manualReview
              ? "Your Eldo Network estimate — let's talk scope"
              : `Your Eldo Network estimate — ${estimateRange}`,
            html: clientHtml,
          }),
        }),
      ]);
    }

    return new Response(
      JSON.stringify({
        tier: quote.tier,
        price_low: priceLow,
        price_high: priceHigh,
        delivery_range: deliveryRange,
        manual_review: manualReview,
        complexity_points: complexityPoints,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
