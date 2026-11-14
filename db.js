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
    // Check if backend API config is available
    try {
      const cfgRes = await fetch("/api/config", { signal: AbortSignal.timeout(1500) });
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        if (cfg.supabaseUrl) SUPABASE_CONFIG.url = cfg.supabaseUrl;
        if (cfg.supabasePublishableKey) SUPABASE_CONFIG.anonKey = cfg.supabasePublishableKey;
      }
    } catch {
      // Running on Render Static Site — uses configured SUPABASE_CONFIG
    }

    // Quick test if Supabase invoices table is reachable
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

  // Fetch all invoices (from Supabase if online, merged with local cache)
  async fetchInvoices() {
    const local = this.getLocalInvoices();

    // Check if backend API exists first (/api/invoices)
    try {
      const apiRes = await fetch("/api/invoices", { signal: AbortSignal.timeout(2500) });
      if (apiRes.ok) {
        const remoteData = await apiRes.json();
        if (Array.isArray(remoteData)) {
          const list = remoteData.map((row) => this.fromDbRow(row));
          this.setLocalInvoices(list);
          this.setStatus("online");
          return list;
        }
      }
    } catch {
      // Not running backend server, continue to direct Supabase
    }

    // Direct Supabase REST fetch
    try {
      const res = await fetch(
        `${SUPABASE_CONFIG.url}/rest/v1/invoices?select=*&order=created_at.desc`,
        {
          headers: {
            apikey: SUPABASE_CONFIG.anonKey,
            Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
          },
          signal: AbortSignal.timeout(4000),
        }
      );

      if (res.ok) {
        const rows = await res.json();
        const remoteList = rows.map((r) => this.fromDbRow(r));
        this.setLocalInvoices(remoteList);
        this.setStatus("online");
        return remoteList;
      }
    } catch (err) {
      console.warn("Direct Supabase fetch failed, using local cache:", err);
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

    // 2. Try sending to backend API if available
    try {
      const apiRes = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(3000),
      });
      if (apiRes.ok) {
        this.setStatus("online");
        return { success: true, localOnly: false };
      }
    } catch {
      // Continue to direct Supabase
    }

    // 3. Direct Supabase upsert
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/invoices`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_CONFIG.anonKey,
          Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok || res.status === 201 || res.status === 204) {
        this.setStatus("online");
        return { success: true, localOnly: false };
      } else {
        console.warn("Supabase save response:", res.status, await res.text());
      }
    } catch (err) {
      console.warn("Supabase save failed, stored locally:", err);
    }

    return { success: true, localOnly: true };
  }

  // Delete an invoice
  async deleteInvoice(id) {
    // 1. Remove from local cache immediately
    const local = this.getLocalInvoices().filter((i) => i.id !== id);
    this.setLocalInvoices(local);

    // 2. Try backend API
    try {
      const apiRes = await fetch(`/api/invoices/${id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(3000),
      });
      if (apiRes.ok) return true;
    } catch {
      // Continue to Supabase
    }

    // 3. Direct Supabase delete
    try {
      await fetch(`${SUPABASE_CONFIG.url}/rest/v1/invoices?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_CONFIG.anonKey,
          Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
        },
        signal: AbortSignal.timeout(4000),
      });
    } catch (err) {
      console.warn("Supabase delete failed:", err);
    }

    return true;
  }

  // Map JS invoice object to database row
  toDbRow(inv) {
    return {
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
      notes: row.notes || "",
      items: Array.isArray(row.items) ? row.items : [],
      updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
    };
  }
}

window.invoiceDb = new InvoiceDatabase();
