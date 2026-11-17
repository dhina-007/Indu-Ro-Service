/**
 * INDU RO SERVICE — Database Adapter (Supabase & Local Sync)
 * Offline-first, timestamp-reconciled, tombstone-protected sync engine
 */

const SUPABASE_CONFIG = {
  url: "https://kyakvqoxfyvgpjklhflo.supabase.co",
  anonKey: "sb_publishable_MDedHPa7LQQ-_nAGA5PSEQ_hFf-TakX",
  storageKey: "indu_ro_invoices",
  draftKey: "indu_ro_draft",
  tombstoneKey: "indu_ro_deleted_ids",
  syncQueueKey: "indu_ro_sync_queue",
};

class InvoiceDatabase {
  constructor() {
    this.status = "connecting"; // "online" | "offline" | "local" | "connecting" | "syncing"
    this.listeners = [];
    this._isSyncing = false;
    this.init();
  }

  onStatusChange(fn) {
    this.listeners.push(fn);
    try {
      fn(this.status);
    } catch (e) {
      console.warn("Status listener error:", e);
    }
  }

  setStatus(newStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.listeners.forEach((fn) => {
        try {
          fn(this.status);
        } catch (e) {
          console.warn("Status listener callback error:", e);
        }
      });
    }
  }

  async init() {
    // Listen for browser online / offline events
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("online", () => {
        this.setStatus("online");
        this.processSyncQueue();
      });
      window.addEventListener("offline", () => {
        this.setStatus("offline");
      });
    }

    // Test if Supabase invoices table is reachable
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/invoices?select=id&limit=1`, {
        headers: {
          apikey: SUPABASE_CONFIG.anonKey,
          Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
        },
        signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
      });
      if (res.ok) {
        this.setStatus("online");
        this.processSyncQueue();
      } else {
        console.warn("Supabase reachable, waiting for table schema:", res.status);
        this.setStatus("local");
      }
    } catch (e) {
      this.setStatus("offline");
    }
  }

  _getStorage(key) {
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(key);
      }
      this._mem = this._mem || {};
      return this._mem[key] || null;
    } catch {
      return null;
    }
  }

  _setStorage(key, value) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, value);
      } else {
        this._mem = this._mem || {};
        this._mem[key] = value;
      }
    } catch (e) {
      console.warn("Storage write failed:", e);
    }
  }

  // Load cached invoices from localStorage
  getLocalInvoices() {
    try {
      const raw = this._getStorage(SUPABASE_CONFIG.storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  // Save cached invoices to localStorage
  setLocalInvoices(list) {
    this._setStorage(SUPABASE_CONFIG.storageKey, JSON.stringify(list));
  }

  // Tombstones: tracks deleted IDs so remote fetches don't resurrect them
  getDeletedIds() {
    try {
      const raw = this._getStorage(SUPABASE_CONFIG.tombstoneKey);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  addDeletedId(id) {
    if (!id) return;
    try {
      const set = this.getDeletedIds();
      set.add(String(id));
      this._setStorage(SUPABASE_CONFIG.tombstoneKey, JSON.stringify(Array.from(set)));
    } catch (e) {
      console.warn("addDeletedId failed:", e);
    }
  }

  // Offline Sync Queue: queues pending save/delete operations
  getSyncQueue() {
    try {
      const raw = this._getStorage(SUPABASE_CONFIG.syncQueueKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  saveSyncQueue(queue) {
    this._setStorage(SUPABASE_CONFIG.syncQueueKey, JSON.stringify(queue));
  }

  addToSyncQueue(action) {
    const queue = this.getSyncQueue();
    // De-duplicate if same invoice id and type already in queue
    const filtered = queue.filter(
      (item) => !(item.type === action.type && String(item.id) === String(action.id))
    );
    filtered.push({ ...action, timestamp: Date.now() });
    this.saveSyncQueue(filtered);
  }

  // Process any pending offline mutations
  async processSyncQueue() {
    if (this._isSyncing) return;
    const queue = this.getSyncQueue();
    if (!queue.length) return;

    this._isSyncing = true;
    const remaining = [];

    for (const item of queue) {
      try {
        if (item.type === "delete") {
          const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/invoices?id=eq.${item.id}`, {
            method: "DELETE",
            headers: {
              apikey: SUPABASE_CONFIG.anonKey,
              Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
            },
            signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
          });
          if (!res.ok && res.status !== 404) {
            remaining.push(item);
          }
        } else if (item.type === "save") {
          const row = item.row;
          let res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/invoices`, {
            method: "POST",
            headers: {
              apikey: SUPABASE_CONFIG.anonKey,
              Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates,return=minimal",
            },
            body: JSON.stringify(row),
            signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
          });

          // Schema fallback if profit column is not created in DB yet
          if (res.status === 400 && row.profit !== undefined) {
            const errText = await res.text();
            if (errText.includes("profit")) {
              const fallbackRow = { ...row };
              delete fallbackRow.profit;
              res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/invoices`, {
                method: "POST",
                headers: {
                  apikey: SUPABASE_CONFIG.anonKey,
                  Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
                  "Content-Type": "application/json",
                  Prefer: "resolution=merge-duplicates,return=minimal",
                },
                body: JSON.stringify(fallbackRow),
                signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
              });
            }
          }

          if (!res.ok && res.status !== 201 && res.status !== 204) {
            remaining.push(item);
          }
        }
      } catch (err) {
        remaining.push(item);
      }
    }

    this.saveSyncQueue(remaining);
    this._isSyncing = false;
  }

  // Conflict resolution & two-way merge
  mergeInvoices(localList, remoteList) {
    const deletedSet = this.getDeletedIds();
    const map = new Map();

    // 1. Remote records (excluding tombstones)
    for (const rem of remoteList) {
      if (!rem || !rem.id || deletedSet.has(String(rem.id))) continue;
      map.set(rem.id, rem);
    }

    // 2. Reconcile with local records based on updatedAt timestamp
    const offlineToPush = [];
    for (const loc of localList) {
      if (!loc || !loc.id || deletedSet.has(String(loc.id))) continue;

      if (!map.has(loc.id)) {
        // Created locally while offline
        map.set(loc.id, loc);
        offlineToPush.push(loc);
      } else {
        const rem = map.get(loc.id);
        const locTime = new Date(loc.updatedAt || 0).getTime();
        const remTime = new Date(rem.updatedAt || 0).getTime();
        if (locTime > remTime) {
          // Local changes are strictly newer than remote
          map.set(loc.id, loc);
          offlineToPush.push(loc);
        }
      }
    }

    // Queue any newer local invoices to sync to Supabase
    offlineToPush.forEach((inv) => {
      this.addToSyncQueue({ type: "save", id: inv.id, row: this.toDbRow(inv) });
    });

    const merged = Array.from(map.values());
    merged.sort((a, b) => {
      const da = String(a.issueDate || "");
      const db = String(b.issueDate || "");
      if (da !== db) return db.localeCompare(da);
      const ta = String(a.updatedAt || a.created_at || "");
      const tb = String(b.updatedAt || b.created_at || "");
      if (ta !== tb) return tb.localeCompare(ta);
      return String(b.refNo || "").localeCompare(String(a.refNo || ""));
    });

    return merged;
  }

  // Fetch all invoices directly from Supabase (merged with local cache)
  async fetchInvoices() {
    const local = this.getLocalInvoices();
    const deletedSet = this.getDeletedIds();

    try {
      const res = await fetch(
        `${SUPABASE_CONFIG.url}/rest/v1/invoices?select=*&order=created_at.desc`,
        {
          headers: {
            apikey: SUPABASE_CONFIG.anonKey,
            Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
          },
          signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
        }
      );

      if (res.ok) {
        const rows = await res.json();
        const remoteList = rows.map((r) => this.fromDbRow(r));

        // Reconcile and merge without overwriting local newer changes
        const mergedList = this.mergeInvoices(local, remoteList);
        this.setLocalInvoices(mergedList);
        this.setStatus("online");

        // Process any queued items
        this.processSyncQueue();
        return mergedList;
      } else {
        this.setStatus("local");
      }
    } catch (err) {
      console.warn("Supabase fetch failed, using local cache:", err);
      this.setStatus("offline");
    }

    // In offline mode, filter out any tombstones from local
    const sanitizedLocal = local.filter((i) => i && i.id && !deletedSet.has(String(i.id)));
    if (sanitizedLocal.length !== local.length) {
      this.setLocalInvoices(sanitizedLocal);
    }
    return sanitizedLocal;
  }

  // Save or update an invoice
  async saveInvoice(invoice) {
    if (!invoice || !invoice.id) {
      return { success: false, error: "Invalid invoice" };
    }

    // Ensure updatedAt is stamped
    invoice.updatedAt = new Date().toISOString();

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
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
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
            signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
          });
        }
      }

      if (res.ok || res.status === 201 || res.status === 204) {
        this.setStatus("online");
        return { success: true, localOnly: false };
      } else {
        console.warn("Supabase save response:", res.status);
        this.setStatus("local");
        this.addToSyncQueue({ type: "save", id: invoice.id, row });
      }
    } catch (err) {
      console.warn("Supabase save failed, stored locally and queued for sync:", err);
      this.setStatus("offline");
      this.addToSyncQueue({ type: "save", id: invoice.id, row });
    }

    return { success: true, localOnly: true };
  }

  // Delete an invoice
  async deleteInvoice(id) {
    if (!id) return true;
    const strId = String(id);

    // 1. Mark as tombstone immediately
    this.addDeletedId(strId);

    // 2. Remove from local cache immediately
    const local = this.getLocalInvoices().filter((i) => i && String(i.id) !== strId);
    this.setLocalInvoices(local);

    // 3. Queue deletion
    this.addToSyncQueue({ type: "delete", id: strId });

    // 4. Send delete to Supabase
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/invoices?id=eq.${strId}`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_CONFIG.anonKey,
          Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
        },
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
      if (res.ok || res.status === 404) {
        // Successfully deleted on Supabase, remove from sync queue
        const queue = this.getSyncQueue().filter(
          (item) => !(item.type === "delete" && String(item.id) === strId)
        );
        this.saveSyncQueue(queue);
      }
    } catch (err) {
      console.warn("Supabase delete failed, queued for sync:", err);
    }

    return true;
  }

  // Map JS invoice object to database row
  toDbRow(inv, includeProfit = true) {
    const row = {
      id: inv.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      ref_no: String(inv.refNo || "").trim(),
      customer_name: String(inv.customerName || "").trim(),
      customer_phone: String(inv.customerPhone || "").trim(),
      issue_date: inv.issueDate || new Date().toISOString().slice(0, 10),
      payment_mode: inv.paymentMode || "Paid – UPI / Cash",
      notes: inv.notes || "",
      items: Array.isArray(inv.items) ? inv.items : [],
      updated_at: inv.updatedAt || new Date().toISOString(),
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

if (typeof window !== "undefined") {
  window.invoiceDb = new InvoiceDatabase();
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { InvoiceDatabase, SUPABASE_CONFIG };
}
