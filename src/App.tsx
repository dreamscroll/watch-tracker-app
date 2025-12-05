import React, { useEffect, useMemo, useState } from "react";

type WatchItem = {
  id: string;
  model: string;
  purchasePrice: number;
  partsCost: number;
  postedPrice?: number | null;
  soldPrice?: number | null;
  status: "Available" | "Sold";
  dateSold?: string | null; // YYYY-MM-DD
  notes?: string;
};

type WearLog = {
  id: string;
  watchId: string;
  start: string; // ISO datetime
  end: string | null; // ISO datetime or null if still wearing
};

const STORAGE_ITEMS = "watch-tracker-items-v1";
const STORAGE_WEAR = "watch-tracker-wear-v2"; // bump version so old data doesn't break

const parseNumber = (v: string) => {
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const toCurrency = (n: number | null | undefined) =>
  typeof n === "number" && !Number.isNaN(n)
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD" })
    : "—";

const formatDateTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

const formatDuration = (start: string, end: string | null) => {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "—";
  const ms = e.getTime() - s.getTime();
  if (ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
};

const useLocalData = () => {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [wearLogs, setWearLogs] = useState<WearLog[]>([]);

  useEffect(() => {
    try {
      const rawItems = localStorage.getItem(STORAGE_ITEMS);
      if (rawItems) setItems(JSON.parse(rawItems));
    } catch (e) {
      console.error("Failed to load items", e);
    }

    try {
      const rawWear = localStorage.getItem(STORAGE_WEAR);
      if (rawWear) {
        const parsed = JSON.parse(rawWear);
        if (Array.isArray(parsed)) setWearLogs(parsed);
      }
    } catch (e) {
      console.error("Failed to load wear logs", e);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_ITEMS, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    localStorage.setItem(STORAGE_WEAR, JSON.stringify(wearLogs));
  }, [wearLogs]);

  return { items, setItems, wearLogs, setWearLogs };
};

const App: React.FC = () => {
  const { items, setItems, wearLogs, setWearLogs } = useLocalData();
  const [filter, setFilter] = useState<"All" | "Available" | "Sold">("All");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"inventory" | "wear">("inventory");

  // Quick Add form state
  const [showAdd, setShowAdd] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [newPurchase, setNewPurchase] = useState("");
  const [newParts, setNewParts] = useState("");

  const nowISO = () => new Date().toISOString();

  const derived = useMemo(() => {
    const wearCountMap: Record<string, number> = {};

    wearLogs.forEach((log) => {
      wearCountMap[log.watchId] = (wearCountMap[log.watchId] || 0) + 1;
    });

    const filtered = items
      .filter((w) => {
        const statusOk = filter === "All" || w.status === filter;
        const searchOk = w.model.toLowerCase().includes(search.toLowerCase());
        return statusOk && searchOk;
      })
      .map((w) => ({ ...w, wearCount: wearCountMap[w.id] || 0 }));

    const activeWear = wearLogs.find((l) => l.end === null) || null;

    return { filtered, wearCountMap, activeWear };
  }, [items, filter, search, wearLogs]);

  const startWear = (watchId: string) => {
    const watch = items.find((i) => i.id === watchId);
    if (!watch) return;

    // Prevent wearing after sold date (rough check on date)
    if (watch.dateSold) {
      const soldDate = new Date(watch.dateSold + "T23:59:59");
      if (new Date() > soldDate) {
        alert("Cannot start wear after this watch has been sold.");
        return;
      }
    }

    const now = nowISO();

    setWearLogs((prev) => {
      // Close any open sessions
      const closed = prev.map((log) =>
        log.end === null ? { ...log, end: now } : log
      );

      // Start new session for this watch
      const newLog: WearLog = {
        id: crypto.randomUUID(),
        watchId,
        start: now,
        end: null,
      };

      return [newLog, ...closed];
    });
  };

  // ===== Quick Add Watch =====
  const handleAddWatch = () => {
    if (!newModel.trim()) {
      alert("Please enter a watch model.");
      return;
    }

    const purchasePrice = newPurchase.trim()
      ? parseNumber(newPurchase)
      : 0;
    const partsCost = newParts.trim() ? parseNumber(newParts) : 0;

    const newWatch: WatchItem = {
      id: crypto.randomUUID(),
      model: newModel.trim(),
      purchasePrice,
      partsCost,
      postedPrice: null,
      soldPrice: null,
      status: "Available",
      dateSold: null,
      notes: undefined,
    };

    setItems((prev) => [newWatch, ...prev]);

    setNewModel("");
    setNewPurchase("");
    setNewParts("");
    setShowAdd(false);
  };

  // ===== Watches CSV (matches your spreadsheet headers) =====
  const exportWatchesCSV = () => {
    const header = [
      "Watch Model",
      "Purchase Price",
      "Parts Cost",
      "Posted Sale Price",
      "Sold Price",
      "Status",
      "Date Sold",
      "Notes",
    ];

    const rows = items.map((w) => [
      w.model,
      w.purchasePrice,
      w.partsCost,
      w.postedPrice ?? "",
      w.soldPrice ?? "",
      w.status,
      w.dateSold ?? "",
      w.notes ?? "",
    ]);

    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "watch-tracker.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importWatchesCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || "");
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length <= 1) return;

      const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const idxModel = header.indexOf("watch model");
      const idxPurchase = header.indexOf("purchase price");
      const idxParts = header.indexOf("parts cost");
      const idxPosted = header.indexOf("posted sale price");
      const idxSold = header.indexOf("sold price");
      const idxStatus = header.indexOf("status");
      const idxDateSold = header.indexOf("date sold");
      const idxNotes = header.indexOf("notes");

      const parsed: WatchItem[] = lines
        .slice(1)
        .map((line) => {
          const cols = line.split(",");
          const model = idxModel >= 0 ? cols[idxModel] ?? "" : "";
          if (!model.trim()) return null;

          const purchasePrice =
            idxPurchase >= 0 ? parseNumber(cols[idxPurchase] || "0") : 0;
          const partsCost =
            idxParts >= 0 ? parseNumber(cols[idxParts] || "0") : 0;
          const postedPrice =
            idxPosted >= 0 && cols[idxPosted]
              ? parseNumber(cols[idxPosted])
              : null;
          const soldPrice =
            idxSold >= 0 && cols[idxSold] ? parseNumber(cols[idxSold]) : null;
          const statusRaw =
            idxStatus >= 0 ? (cols[idxStatus] || "").trim() : "";
          const status: "Available" | "Sold" =
            statusRaw === "Sold" ? "Sold" : "Available";
          const dateSold = idxDateSold >= 0 ? cols[idxDateSold] || "" : "";
          const notes = idxNotes >= 0 ? cols[idxNotes] || "" : "";

          return {
            id: crypto.randomUUID(),
            model,
            purchasePrice,
            partsCost,
            postedPrice,
            soldPrice,
            status,
            dateSold: dateSold || null,
            notes: notes || undefined,
          } as WatchItem;
        })
        .filter((w): w is WatchItem => w !== null);

      if (parsed.length) {
        setItems(parsed);
      }
    };
    reader.readAsText(file);
  };

  // ===== Wear CSV (Watch Model, Start, End) =====
  const exportWearCSV = () => {
    const header = ["Watch Model", "Start", "End"];
    const rows = wearLogs.map((log) => {
      const watch = items.find((i) => i.id === log.watchId);
      return [watch?.model ?? "", log.start, log.end ?? ""];
    });

    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "watch-wear-log.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importWearCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || "");
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length <= 1) return;

      const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const idxModel = header.indexOf("watch model");
      const idxStart = header.indexOf("start");
      const idxEnd = header.indexOf("end");
      if (idxModel < 0 || idxStart < 0) {
        alert("Wear CSV must have 'Watch Model', 'Start', and 'End' headers.");
        return;
      }

      const newLogs: WearLog[] = [];

      lines.slice(1).forEach((line) => {
        const cols = line.split(",");
        const modelRaw = (cols[idxModel] || "").trim();
        const startRaw = (cols[idxStart] || "").trim();
        const endRaw = idxEnd >= 0 ? (cols[idxEnd] || "").trim() : "";

        if (!modelRaw || !startRaw) return;

        const watch = items.find(
          (i) => i.model.trim() === modelRaw
        );
        if (!watch) return;

        newLogs.push({
          id: crypto.randomUUID(),
          watchId: watch.id,
          start: startRaw,
          end: endRaw || null,
        });
      });

      if (newLogs.length) {
        setWearLogs((prev) => [...newLogs, ...prev]);
      }
    };
    reader.readAsText(file);
  };

  const handleWatchesFileChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (file) importWatchesCSV(file);
    e.target.value = "";
  };

  const handleWearFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importWearCSV(file);
    e.target.value = "";
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
        Watch Tracker
      </h1>

      {/* Tabs */}
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={() => setActiveTab("inventory")}
          style={{
            padding: "6px 12px",
            marginRight: 8,
            borderRadius: 4,
            border:
              activeTab === "inventory" ? "2px solid white" : "1px solid gray",
            background: activeTab === "inventory" ? "#444" : "#222",
            color: "white",
          }}
        >
          Inventory
        </button>
        <button
          onClick={() => setActiveTab("wear")}
          style={{
            padding: "6px 12px",
            borderRadius: 4,
            border: activeTab === "wear" ? "2px solid white" : "1px solid gray",
            background: activeTab === "wear" ? "#444" : "#222",
            color: "white",
          }}
        >
          Wear Log
        </button>
      </div>

      {activeTab === "inventory" && (
        <div>
          {/* Quick Add + Filters + CSV controls */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              marginBottom: 16,
            }}
          >
            {/* Row: Add button */}
            <div>
              <button
                onClick={() => setShowAdd((prev) => !prev)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 4,
                  border: "1px solid #aaa",
                  background: "#2d6cdf",
                  color: "white",
                  fontWeight: 600,
                }}
              >
                {showAdd ? "Cancel" : "+ Add Watch"}
              </button>
            </div>

            {/* Quick Add form */}
            {showAdd && (
              <div
                style={{
                  borderRadius: 6,
                  border: "1px solid #555",
                  padding: 10,
                  background: "#111",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Quick Add Watch
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <label>
                    Model
                    <input
                      type="text"
                      value={newModel}
                      placeholder="e.g. Sugess 1963"
                      onChange={(e) => setNewModel(e.target.value)}
                      style={{
                        padding: 4,
                        width: "100%",
                        marginTop: 2,
                      }}
                    />
                  </label>
                  <label>
                    Purchase Price
                    <input
                      type="text"
                      value={newPurchase}
                      placeholder="e.g. 250"
                      onChange={(e) => setNewPurchase(e.target.value)}
                      style={{
                        padding: 4,
                        width: "100%",
                        marginTop: 2,
                      }}
                    />
                  </label>
                  <label>
                    Parts Cost
                    <input
                      type="text"
                      value={newParts}
                      placeholder="e.g. 30"
                      onChange={(e) => setNewParts(e.target.value)}
                      style={{
                        padding: 4,
                        width: "100%",
                        marginTop: 2,
                      }}
                    />
                  </label>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                    marginTop: 6,
                  }}
                >
                  <button
                    onClick={() => {
                      setShowAdd(false);
                      setNewModel("");
                      setNewPurchase("");
                      setNewParts("");
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: "1px solid #666",
                      background: "#222",
                      color: "white",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddWatch}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: "1px solid #2d6cdf",
                      background: "#2d6cdf",
                      color: "white",
                      fontWeight: 600,
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {/* Filters + CSV (stacked for mobile) */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "flex-end",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <label htmlFor="search">Search</label>
                <input
                  id="search"
                  type="text"
                  placeholder="Search model…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ padding: 4, minWidth: 180, maxWidth: "100%" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column" }}>
                <label htmlFor="status-filter">Status</label>
                <select
                  id="status-filter"
                  value={filter}
                  onChange={(e) =>
                    setFilter(
                      e.target.value as "All" | "Available" | "Sold"
                    )
                  }
                  style={{ padding: 4, minWidth: 120 }}
                >
                  <option value="All">All</option>
                  <option value="Available">Available</option>
                  <option value="Sold">Sold</option>
                </select>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginLeft: "auto",
                }}
              >
                <button
                  onClick={exportWatchesCSV}
                  style={{ padding: "6px 10px", borderRadius: 4 }}
                >
                  Export Watches CSV
                </button>

                <label
                  style={{
                    padding: "6px 10px",
                    borderRadius: 4,
                    border: "1px solid gray",
                    cursor: "pointer",
                  }}
                >
                  Import Watches CSV
                  <input
                    type="file"
                    accept=".csv"
                    style={{ display: "none" }}
                    onChange={handleWatchesFileChange}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Inventory table */}
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Model
                  </th>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Purchase
                  </th>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Parts
                  </th>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Posted
                  </th>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Sold
                  </th>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Status
                  </th>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Date Sold
                  </th>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Worn ×
                  </th>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Wear now
                  </th>
                </tr>
              </thead>
              <tbody>
                {derived.filtered.map((w: any) => (
                  <tr key={w.id}>
                    <td style={{ borderBottom: "1px solid #333", padding: 6 }}>
                      {w.model}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #333",
                        padding: 6,
                        textAlign: "right",
                      }}
                    >
                      {toCurrency(w.purchasePrice)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #333",
                        padding: 6,
                        textAlign: "right",
                      }}
                    >
                      {toCurrency(w.partsCost)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #333",
                        padding: 6,
                        textAlign: "right",
                      }}
                    >
                      {toCurrency(w.postedPrice ?? null)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #333",
                        padding: 6,
                        textAlign: "right",
                      }}
                    >
                      {toCurrency(w.soldPrice ?? null)}
                    </td>
                    <td style={{ borderBottom: "1px solid #333", padding: 6 }}>
                      {w.status}
                    </td>
                    <td style={{ borderBottom: "1px solid #333", padding: 6 }}>
                      {w.dateSold || "—"}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #333",
                        padding: 6,
                        textAlign: "right",
                      }}
                    >
                      {w.wearCount}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #333",
                        padding: 6,
                        textAlign: "right",
                      }}
                    >
                      <button
                        onClick={() => startWear(w.id)}
                        style={{ padding: "4px 8px", borderRadius: 4 }}
                      >
                        Wear now
                      </button>
                    </td>
                  </tr>
                ))}
                {derived.filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      style={{
                        padding: 8,
                        textAlign: "center",
                        color: "#777",
                      }}
                    >
                      No watches found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "wear" && (
        <div>
          {/* Current active watch */}
          <div
            style={{
              padding: 10,
              borderRadius: 6,
              border: "1px solid #555",
              marginBottom: 12,
              background: "#111",
            }}
          >
            {derived.activeWear ? (
              <>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Currently wearing
                </div>
                <div style={{ fontSize: 14 }}>
                  {
                    items.find(
                      (i) => i.id === derived.activeWear!.watchId
                    )?.model
                  }{" "}
                  <br />
                  Since: {formatDateTime(derived.activeWear.start)}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: "#aaa" }}>
                No active watch. Start one from the Inventory tab with
                “Wear now”.
              </div>
            )}
          </div>

          {/* Export / Import */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 16,
            }}
          >
            <button
              onClick={exportWearCSV}
              style={{ padding: "6px 10px", borderRadius: 4 }}
            >
              Export Wear CSV
            </button>
            <label
              style={{
                padding: "6px 10px",
                borderRadius: 4,
                border: "1px solid gray",
                cursor: "pointer",
              }}
            >
              Import Wear CSV
              <input
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                onChange={handleWearFileChange}
              />
            </label>
          </div>

          {/* Wear history */}
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Watch
                  </th>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Start
                  </th>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    End
                  </th>
                  <th style={{ borderBottom: "1px solid #555", padding: 6 }}>
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {wearLogs.map((log) => {
                  const watch = items.find((i) => i.id === log.watchId);
                  return (
                    <tr key={log.id}>
                      <td
                        style={{
                          borderBottom: "1px solid #333",
                          padding: 6,
                        }}
                      >
                        {watch ? watch.model : "(deleted)"}
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid #333",
                          padding: 6,
                        }}
                      >
                        {formatDateTime(log.start)}
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid #333",
                          padding: 6,
                        }}
                      >
                        {formatDateTime(log.end)}
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid #333",
                          padding: 6,
                        }}
                      >
                        {formatDuration(log.start, log.end)}
                      </td>
                    </tr>
                  );
                })}
                {wearLogs.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        padding: 8,
                        textAlign: "center",
                        color: "#777",
                      }}
                    >
                      No wear sessions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
