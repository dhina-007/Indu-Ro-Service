/**
 * INDU RO SERVICE — Database Adapter (Supabase & Local Sync)
 * Supports Render Static Service (direct Supabase HTTPS) & LocalStorage Cache
 */

const SUPABASE_CONFIG = {
  url: "https://kyakvqoxfyvgpjklhflo.supabase.co",
  anonKey: "sb_publishable_MDedHPa7LQQ-_nAGA5PSEQ_hFf-TakX",
  storageKey: "indu_ro_invoices",
  draftKey: "indu_ro_draft",
};

class InvoiceDatabase {
  constructor() {
    this.status = "connecting"; // "online" | "offline" | "connecting"
    this.listeners = [];
    this.init();
  }

  onStatusChange(fn) {
    this.listeners.push(fn);
    fn(this.status);
  }

  setStatus(newStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.listeners.forEach((fn) => fn(this.status));
    }
  }

  async init() {
    // Test if Supabase invoices table is reachable
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/invoices?select=id&limit=1`, {
        headers: {
          apikey: SUPABASE_CONFIG.anonKey,
          Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
        },
      });
      if (res.ok) {
        this.setStatus("online");
      } else {
        // Table not created yet or RLS restricted
        console.warn("Supabase reachable, waiting for table schema:", res.status);
        this.setStatus("local");
      }
    } catch (e) {
      console.warn("Supabase offline / network check failed:", e);
      this.setStatus("offline");
    }
  }

  // Load cached invoices from localStorage
  getLocalInvoices() {
    try {
      const raw = localStorage.getItem(SUPABASE_CONFIG.storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  // Save cached invoices to localStorage
  setLocalInvoices(list) {
    try {
      localStorage.setItem(SUPABASE_CONFIG.storageKey, JSON.stringify(list));
    } catch (e) {
      console.warn("localStorage write failed:", e);
    }
  }

  // Fetch all invoices directly from Supabase (merged with local cache)
  async fetchInvoices() {
    const local = this.getLocalInvoices();

    try {
      const res = await fetch(
        `${SUPABASE_CONFIG.url}/rest/v1/invoices?select=*&order=created_at.desc`,
        {
          headers: {
            apikey: SUPABASE_CONFIG.anonKey,
            Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
          },
          signal: AbortSignal.timeout(5000),
        }
      );

      if (res.ok) {
        const rows = await res.json();
        const remoteList = rows.map((r) => this.fromDbRow(r));
        this.setLocalInvoices(remoteList);
        this.setStatus("online");
        return remoteList;
      } else {
        this.setStatus("local");
      }
    } catch (err) {
      console.warn("Supabase fetch failed, using local cache:", err);
      this.setStatus("offline");
    }

    return local;
  }

  // Save or update an invoice
  async saveInvoice(invoice) {
    // 1. Update local cache immediately
    const local = this.getLocalInvoices();
    const idx = local.findIndex((i) => i.id === invoice.id);
    if (idx >= 0) local[idx] = invoice;
    else local.unshift(invoice);
    this.setLocalInvoices(local);

    const row = this.toDbRow(invoice);

    // 2. Direct Supabase upsert
    try {
      let res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/invoices`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_CONFIG.anonKey,
          Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(5000),
      });

      // If profit column is not in Supabase schema yet, retry without profit column
      if (res.status === 400 && row.profit !== undefined) {
        const errText = await res.text();
        if (errText.includes("profit")) {
          const fallbackRow = this.toDbRow(invoice, false);
          res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/invoices`, {
            method: "POST",
            headers: {
              apikey: SUPABASE_CONFIG.anonKey,
              Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates,return=minimal",
            },
            body: JSON.stringify(fallbackRow),
            signal: AbortSignal.timeout(5000),
          });
        }
      }

      if (res.ok || res.status === 201 || res.status === 204) {
        this.setStatus("online");
        return { success: true, localOnly: false };
      } else {
        console.warn("Supabase save response:", res.status, await res.text());
        this.setStatus("local");
      }
    } catch (err) {
      console.warn("Supabase save failed, stored locally:", err);
      this.setStatus("offline");
    }

    return { success: true, localOnly: true };
  }

  // Delete an invoice
  async deleteInvoice(id) {
    // 1. Remove from local cache immediately
    const local = this.getLocalInvoices().filter((i) => i.id !== id);
    this.setLocalInvoices(local);

    // 2. Direct Supabase delete
    try {
      await fetch(`${SUPABASE_CONFIG.url}/rest/v1/invoices?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_CONFIG.anonKey,
          Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      console.warn("Supabase delete failed:", err);
    }

    return true;
  }

  // Map JS invoice object to database row
  toDbRow(inv, includeProfit = true) {
    const row = {
      id: inv.id || crypto.randomUUID(),
      ref_no: String(inv.refNo || "").trim(),
      customer_name: String(inv.customerName || "").trim(),
      customer_phone: String(inv.customerPhone || "").trim(),
      issue_date: inv.issueDate || new Date().toISOString().slice(0, 10),
      payment_mode: inv.paymentMode || "Paid – UPI / Cash",
      notes: inv.notes || "",
      items: Array.isArray(inv.items) ? inv.items : [],
      updated_at: new Date().toISOString(),
    };
    if (includeProfit && inv.profit !== undefined && inv.profit !== null && String(inv.profit).trim() !== "") {
      row.profit = parseFloat(inv.profit) || 0;
    }
    return row;
  }

  // Map database row to JS invoice object
  fromDbRow(row) {
    return {
      id: row.id,
      refNo: row.ref_no || row.refNo || "",
      customerName: row.customer_name || row.customerName || "",
      customerPhone: row.customer_phone || row.customerPhone || "",
      issueDate: row.issue_date || row.issueDate || new Date().toISOString().slice(0, 10),
      paymentMode: row.payment_mode || row.paymentMode || "Paid – UPI / Cash",
      profit: row.profit !== undefined && row.profit !== null ? parseFloat(row.profit) : 0,
      notes: row.notes || "",
      items: Array.isArray(row.items) ? row.items : [],
      updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
    };
  }
}

window.invoiceDb = new InvoiceDatabase();
