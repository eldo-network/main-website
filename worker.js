export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/quote" && request.method === "POST") {
      return handleQuote(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

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

    const basePrice = 2500;
    let volumePrice;
    if (gbSize <= 10) {
      volumePrice = gbSize * 250;
    } else if (gbSize <= 100) {
      volumePrice = 10 * 250 + (gbSize - 10) * 175;
    } else {
      volumePrice = 10 * 250 + 90 * 175 + (gbSize - 100) * 125;
    }

    let complexityPoints = 0;
    if (tableCount > 5) complexityPoints += 1;
    if (tableCount > 20) complexityPoints += 1;
    if (sourceCount > 1) complexityPoints += 1;
    if (sourceCount > 3) complexityPoints += 1;
    if (unstructured) complexityPoints += 2;
    if (needsDedup) complexityPoints += 1;
    if (needsEntityResolution) complexityPoints += 2;
    if (needsLlmEnrichment) complexityPoints += 2;
    if (needsSchemaRedesign) complexityPoints += 2;
    if (hasPii) complexityPoints += 1;

    let complexityMultiplier;
    if (complexityPoints <= 2) complexityMultiplier = 1.0;
    else if (complexityPoints <= 5) complexityMultiplier = 1.25;
    else if (complexityPoints <= 8) complexityMultiplier = 1.5;
    else complexityMultiplier = 1.85;

    const industryMultipliers = {
      general: 1.0,
      ecommerce: 1.0,
      restaurant: 1.0,
      realestate: 1.05,
      engineering: 1.15,
      manufacturing: 1.15,
      finance: 1.3,
      legal: 1.35,
      healthcare: 1.4,
    };
    const industryMultiplier = industryMultipliers[industry] || 1.2;
    const urgencyMultiplier = expedited ? 1.3 : 1.0;

    const subtotal = Math.max(basePrice, basePrice + volumePrice);
    const totalPrice = subtotal * complexityMultiplier * industryMultiplier * urgencyMultiplier;

    let deliveryRange;
    if (complexityPoints <= 2) deliveryRange = "2–3 weeks";
    else if (complexityPoints <= 5) deliveryRange = "3–5 weeks";
    else if (complexityPoints <= 8) deliveryRange = "5–8 weeks";
    else deliveryRange = "8–12 weeks";

    const manualReview =
      industry === "other" ||
      gbSize > 150 ||
      complexityPoints >= 9 ||
      (["legal", "healthcare"].includes(industry) && hasPii) ||
      (needsSchemaRedesign && needsEntityResolution && needsLlmEnrichment);

    const roundedPrice = Math.round(totalPrice / 100) * 100;
    const priceLow = Math.round((roundedPrice * 0.9) / 100) * 100;
    const priceHigh = Math.round((roundedPrice * 1.1) / 100) * 100;

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
        ${manualReview ? `<p style="background:#422006;color:#fbbf24;padding:12px 16px;border-radius:8px;font-size:13px;margin:0 0 24px">⚠ Manual review flagged — do not send standard pricing without a custom scope call.</p>` : ""}
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">${scopeRows}</table>
        <div style="background:#0f172a;border-radius:8px;padding:20px;margin-bottom:24px">
          <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#94a3b8">Estimate shown to client</p>
          <p style="margin:0;font-size:28px;font-weight:700;color:#f1c453">${manualReview ? "Manual review" : estimateRange}</p>
          ${!manualReview ? `<p style="margin:6px 0 0;font-size:13px;color:#94a3b8">Delivery: ${deliveryRange} &nbsp;·&nbsp; Complexity score: ${complexityPoints}</p>` : ""}
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
