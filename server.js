const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kyakvqoxfyvgpjklhflo.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_MDedHPa7LQQ-_nAGA5PSEQ_hFf-TakX";

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname)));

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

// Health check
app.get("/api/health", async (req, res) => {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers });
    res.json({
      status: "ok",
      service: "INDU RO Invoice Service",
      database: r.status === 200 ? "connected" : "unreachable",
      port: PORT,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET all invoices
app.get("/api/invoices", async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?select=*&order=created_at.desc`,
      { headers }
    );
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json(data);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / PUT invoice (upsert)
app.post("/api/invoices", async (req, res) => {
  try {
    const inv = req.body;
    const row = {
      id: inv.id,
      ref_no: inv.ref_no || inv.refNo || "",
      customer_name: inv.customer_name || inv.customerName || "",
      customer_phone: inv.customer_phone || inv.customerPhone || "",
      issue_date: inv.issue_date || inv.issueDate,
      payment_mode: inv.payment_mode || inv.paymentMode || "Paid – UPI / Cash",
      notes: inv.notes || "",
      items: inv.items || [],
      updated_at: new Date().toISOString(),
    };

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?on_conflict=id`,
      {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(row),
      }
    );
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json(data);
    }
    res.json(Array.isArray(data) ? data[0] : data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE invoice
app.delete("/api/invoices/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/invoices?id=eq.${id}`, {
      method: "DELETE",
      headers,
    });
    if (!r.ok) {
      const data = await r.json();
      return res.status(r.status).json(data);
    }
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all route to serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`INDU RO Invoice Service running on http://localhost:${PORT}`);
});
