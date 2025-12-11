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
  purchaseDate?: string | null; // YYYY-MM-DD
  notes?: string;
};

type WearLog = {
  id: string;
  watchId: string;
  start: string; // ISO datetime
  end: string | null; // ISO datetime or null if still wearing
};

type BackupFileV1 = {
  version: 1;
  exportedAt: string; // ISO timestamp
  items: WatchItem[];
  wearLogs: WearLog[];
};

const STORAGE_ITEMS = "watch-tracker-items-v1";
const STORAGE_WEAR = "watch-tracker-wear-v2";

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

const formatTotalDuration = (totalMinutes: number) => {
  const mins = Math.round(totalMinutes);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) {
    return rem ? `${hours}h ${rem}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (!remHours && !rem) return `${days}d`;
  if (!rem) return `${days}d ${remHours}h`;
  return `${days}d ${remHours}h ${rem}m`;
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
  const [activeTab, setActiveTab] =
    useState<"inventory" | "sold" | "wear" | "stats">("inventory");
  const [search, setSearch] = useState("");

  // Filters
  const [soldYearFilter, setSoldYearFilter] = useState<string>("all");
  const [soldProfitFilter, setSoldProfitFilter] = useState<
    "all" | "profit" | "loss" | "breakeven"
  >("all");
  const [wearWatchFilter, setWearWatchFilter] = useState<string>("all");

  // Quick Add form state
  const [showAdd, setShowAdd] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [newPurchase, setNewPurchase] = useState("");
  const [newParts, setNewParts] = useState("");
  const [newPurchaseDate, setNewPurchaseDate] = useState("");

  const nowISO = () => new Date().toISOString();

  const derived = useMemo(() => {
    const wearCountMap: Record<string, number> = {};
    wearLogs.forEach((log) => {
      wearCountMap[log.watchId] = (wearCountMap[log.watchId] || 0) + 1;
    });

    const searchLower = search.toLowerCase();

    const available = items
      .filter(
        (w) =>
          w.status === "Available" &&
          w.model.toLowerCase().includes(searchLower)
      )
      .map((w) => ({ ...w, wearCount: wearCountMap[w.id] || 0 }));

    const soldRaw = items.filter(
      (w) =>
        w.status === "Sold" &&
        w.model.toLowerCase().includes(searchLower)
    );

    const sold = soldRaw.map((w) => {
      const totalCost = w.purchasePrice + w.partsCost;
      const profit =
        typeof w.soldPrice === "number" ? w.soldPrice - totalCost : null;
      return {
        ...w,
        totalCost,
        profit,
        wearCount: wearCountMap[w.id] || 0,
      };
    });

    const soldSummary = sold.reduce(
      (acc, w: any) => {
        acc.totalCost += w.totalCost;
        if (typeof w.soldPrice === "number") {
          acc.totalSold += w.soldPrice;
        }
        if (typeof w.profit === "number") {
          acc.totalProfit += w.profit;
        }
        return acc;
      },
      { totalCost: 0, totalSold: 0, totalProfit: 0 }
    );

    const activeWear = wearLogs.find((l) => l.end === null) || null;

    return { available, sold, soldSummary, wearCountMap, activeWear };
  }, [items, wearLogs, search]);

  // ===== Extra derived data for filters =====
  const soldYears = useMemo(() => {
    const years = new Set<string>();
    (derived.sold as any[]).forEach((w) => {
      if (w.dateSold && typeof w.dateSold === "string" && w.dateSold.length >= 4) {
        years.add(w.dateSold.slice(0, 4));
      }
    });
    return Array.from(years).sort();
  }, [derived.sold]);

  const filteredSold = useMemo(() => {
    return (derived.sold as any[]).filter((w) => {
      if (soldYearFilter !== "all") {
        if (!w.dateSold || !String(w.dateSold).startsWith(soldYearFilter)) {
          return false;
        }
      }
      if (soldProfitFilter === "profit") {
        return typeof w.profit === "number" && w.profit > 0;
      }
      if (soldProfitFilter === "loss") {
        return typeof w.profit === "number" && w.profit < 0;
      }
      if (soldProfitFilter === "breakeven") {
        return typeof w.profit === "number" && w.profit === 0;
      }
      return true;
    });
  }, [derived.sold, soldYearFilter, soldProfitFilter]);

  const soldSummaryFiltered = useMemo(
    () =>
      filteredSold.reduce(
        (acc, w: any) => {
          acc.totalCost += w.totalCost;
          if (typeof w.soldPrice === "number") acc.totalSold += w.soldPrice;
          if (typeof w.profit === "number") acc.totalProfit += w.profit;
          return acc;
        },
        { totalCost: 0, totalSold: 0, totalProfit: 0 }
      ),
    [filteredSold]
  );

  const wearLabels = useMemo(() => {
    const labels = new Set<string>();
    wearLogs.forEach((log) => {
      const watch = items.find((i) => i.id === log.watchId);
      const label = (watch?.model || "").trim();
      if (label) labels.add(label);
    });
    return Array.from(labels).sort();
  }, [wearLogs, items]);

  // ===== Stats per watch (wear count + total minutes) =====
  const statsByWatch = useMemo(() => {
    const map: Record<
      string,
      { watch: WatchItem; wearCount: number; totalMinutes: number }
    > = {};

    items.forEach((w) => {
      map[w.id] = { watch: w, wearCount: 0, totalMinutes: 0 };
    });

    wearLogs.forEach((log) => {
      const entry = map[log.watchId];
      if (!entry) return;

      const s = new Date(log.start);
      const e = log.end ? new Date(log.end) : new Date();
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return;
      const ms = e.getTime() - s.getTime();
      if (ms <= 0) return;

      const mins = ms / 60000;
      entry.wearCount += 1;
      entry.totalMinutes += mins;
    });

    return Object.values(map).sort((a, b) => b.wearCount - a.wearCount);
  }, [items, wearLogs]);

  // Quick highlights for Stats tab
  const favouriteWatch = statsByWatch.find((s) => s.wearCount > 0) || null;
  const mostProfitableWatch =
    (derived.sold as any[])
      .filter((w) => typeof w.profit === "number")
      .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))[0] || null;

  const totalWatches = items.length;
  const totalAvailable = items.filter((w) => w.status === "Available").length;
  const totalSoldCount = items.filter((w) => w.status === "Sold").length;

  // ===== Wear handling =====
  const startWear = (watchId: string) => {
    const watch = items.find((i) => i.id === watchId);
    if (!watch) return;

    if (watch.dateSold) {
      const soldDate = new Date(watch.dateSold + "T23:59:59");
      if (new Date() > soldDate) {
        alert("Cannot start wear after this watch has been sold.");
        return;
      }
    }

    const now = nowISO();

    setWearLogs((prev) => {
      const closed = prev.map((log) =>
        log.end === null ? { ...log, end: now } : log
      );

      const newLog: WearLog = {
        id: crypto.randomUUID(),
        watchId,
        start: now,
        end: null,
      };

      return [newLog, ...closed];
    });
  };

  const clearWearLogs = () => {
    if (!window.confirm("Clear ALL wear history? This cannot be undone.")) {
      return;
    }
    setWearLogs([]);
  };

  const deleteWearLog = (id: string) => {
    if (!window.confirm("Delete this wear entry?")) return;
    setWearLogs((prev) => prev.filter((l) => l.id !== id));
  };

  const editWearLog = (id: string) => {
    const log = wearLogs.find((l) => l.id === id);
    if (!log) return;

    const newStart = window.prompt(
      "Edit start time (ISO, e.g. 2025-12-05T15:30:00). Leave blank to keep.",
      log.start
    );
    const newEnd = window.prompt(
      "Edit end time (ISO, blank = still wearing).",
      log.end ?? ""
    );

    setWearLogs((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              start:
                newStart && newStart.trim() !== "" ? newStart.trim() : l.start,
              end:
                newEnd && newEnd.trim() !== ""
                  ? newEnd.trim()
                  : newEnd === ""
                  ? null
                  : l.end,
            }
          : l
      )
    );
  };

  // ===== Inventory helpers =====
  const undoSold = (id: string) => {
    const watch = items.find((w) => w.id === id);
    if (!watch) return;

    const ok = window.confirm(
      `Move "${watch.model}" back to inventory as Available?`
    );
    if (!ok) return;

    setItems((prev) =>
      prev.map((w) =>
        w.id === id
          ? { ...w, status: "Available", soldPrice: null, dateSold: null }
          : w
      )
    );
  };

  const handleAddWatch = () => {
    if (!newModel.trim()) {
      alert("Please enter a model name.");
      return;
    }

    const purchasePrice = newPurchase.trim()
      ? parseNumber(newPurchase)
      : 0;
    const partsCost = newParts.trim() ? parseNumber(newParts) : 0;
    const todayISO = new Date().toISOString().slice(0, 10);

    const newWatch: WatchItem = {
      id: crypto.randomUUID(),
      model: newModel.trim(),
      purchasePrice,
      partsCost,
      postedPrice: null,
      soldPrice: null,
      status: "Available",
      dateSold: null,
      purchaseDate: newPurchaseDate.trim() || todayISO,
      notes: undefined,
    };

    setItems((prev) => [newWatch, ...prev]);

    setNewModel("");
    setNewPurchase("");
    setNewParts("");
    setNewPurchaseDate("");
    setShowAdd(false);
  };

  const markSold = (id: string) => {
    const watch = items.find((w) => w.id === id);
    if (!watch) return;

    const defaultSoldPrice =
      typeof watch.soldPrice === "number" ? String(watch.soldPrice) : "";
    const defaultDate =
      watch.dateSold || new Date().toISOString().slice(0, 10);

    const soldPriceInput = window.prompt(
      "Sold price (leave blank to keep current / set later):",
      defaultSoldPrice
    );
    const dateInput = window.prompt(
      "Date sold (YYYY-MM-DD):",
      defaultDate
    );

    const soldPrice =
      soldPriceInput && soldPriceInput.trim() !== ""
        ? parseNumber(soldPriceInput)
        : watch.soldPrice ?? null;

    const dateSold =
      dateInput && dateInput.trim() !== "" ? dateInput.trim() : defaultDate;

    setItems((prev) =>
      prev.map((w) =>
        w.id === id
          ? {
              ...w,
              status: "Sold",
              soldPrice,
              dateSold,
            }
          : w
      )
    );
  };

  const editSoldWatch = (id: string) => {
    const watch = items.find((w) => w.id === id);
    if (!watch) return;

    const soldPriceInput = window.prompt(
      "Edit sold price:",
      typeof watch.soldPrice === "number" ? String(watch.soldPrice) : ""
    );
    const dateInput = window.prompt(
      "Edit date sold (YYYY-MM-DD):",
      watch.dateSold || new Date().toISOString().slice(0, 10)
    );

    const soldPrice =
      soldPriceInput && soldPriceInput.trim() !== ""
        ? parseNumber(soldPriceInput)
        : null;
    const dateSold =
      dateInput && dateInput.trim() !== "" ? dateInput.trim() : watch.dateSold;

    setItems((prev) =>
      prev.map((w) =>
        w.id === id
          ? {
              ...w,
              soldPrice,
              dateSold,
            }
          : w
      )
    );
  };

  const deleteWatch = (id: string) => {
    const watch = items.find((w) => w.id === id);
    const name = watch?.model || "this watch";

    const ok = window.confirm(
      `Delete "${name}" from your records? This will also delete its wear history.`
    );
    if (!ok) return;

    setItems((prev) => prev.filter((w) => w.id !== id));
    setWearLogs((prev) => prev.filter((l) => l.watchId !== id));
  };

  const editWatch = (id: string) => {
    const watch = items.find((w) => w.id === id);
    if (!watch) return;

    const modelInput = window.prompt("Edit model:", watch.model);
    if (!modelInput || modelInput.trim() === "") return;

    const purchaseInput = window.prompt(
      "Edit purchase price:",
      String(watch.purchasePrice)
    );
    const partsInput = window.prompt(
      "Edit parts cost:",
      String(watch.partsCost)
    );
    const postedInput = window.prompt(
      "Edit posted sale price (blank for none):",
      watch.postedPrice != null ? String(watch.postedPrice) : ""
    );
    const notesInput = window.prompt(
      "Edit notes (optional):",
      watch.notes ?? ""
    );

    setItems((prev) =>
      prev.map((w) =>
        w.id === id
          ? {
              ...w,
              model: modelInput.trim(),
              purchasePrice:
                purchaseInput && purchaseInput.trim() !== ""
                  ? parseNumber(purchaseInput)
                  : 0,
              partsCost:
                partsInput && partsInput.trim() !== ""
                  ? parseNumber(partsInput)
                  : 0,
              postedPrice:
                postedInput && postedInput.trim() !== ""
                  ? parseNumber(postedInput)
                  : null,
              notes:
                notesInput && notesInput.trim() !== ""
                  ? notesInput.trim()
                  : undefined,
            }
          : w
      )
    );
  };

  // ===== Watches CSV =====
  const exportWatchesCSV = () => {
    const header = [
      "Watch Model",
      "Date Purchased",
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
      w.purchaseDate ?? "",
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
      const idxPurchaseDate = header.indexOf("date purchased");
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

          const purchaseDate =
            idxPurchaseDate >= 0 ? (cols[idxPurchaseDate] || "").trim() : "";
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
            purchaseDate: purchaseDate || null,
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

  // ===== Wear CSV =====
  const exportWearCSV = () => {
    const header = ["Watch Model", "Start", "End"];
    const rows = wearLogs.map((log) => {
      const watch = items.find((i) => i.id === log.watchId);
      const label = watch?.model ?? "";
      return [label, log.start, log.end ?? ""];
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

  // ===== P/L CSV =====
  const exportPLCSV = () => {
    const defaultYear = new Date().getFullYear().toString();
    const yearInput = window.prompt(
      "Export P/L for which year? (YYYY, blank = all years)",
      defaultYear
    );

    const filterYear = yearInput?.trim() || "";

    const sold = derived.sold as any[];

    const filtered = sold.filter((w) => {
      if (!filterYear) return true;
      return w.dateSold && String(w.dateSold).startsWith(filterYear);
    });

    if (!filtered.length) {
      alert("No sold watches found for that period.");
      return;
    }

    const header = [
      "Date Sold",
      "Model",
      "Purchase Price",
      "Parts Cost",
      "Total Cost",
      "Sold Price",
      "Profit",
    ];

    let totalCost = 0;
    let totalSold = 0;
    let totalProfit = 0;

    const rows = filtered.map((w) => {
      const totalCostRow = w.totalCost;
      const soldPrice = typeof w.soldPrice === "number" ? w.soldPrice : 0;
      const profit = typeof w.profit === "number" ? w.profit : 0;

      totalCost += totalCostRow;
      totalSold += soldPrice;
      totalProfit += profit;

      return [
        w.dateSold || "",
        w.model,
        w.purchasePrice,
        w.partsCost,
        totalCostRow,
        soldPrice || "",
        profit || "",
      ];
    });

    const totalsRow = [
      "TOTALS",
      "",
      "",
      "",
      totalCost,
      totalSold,
      totalProfit,
    ];

    const csv = [header, ...rows, totalsRow]
      .map((r) => r.join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filterYear
      ? `watch-pl-${filterYear}.csv`
      : "watch-pl-all-years.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ===== FULL BACKUP (JSON) =====
  const exportFullBackup = () => {
    const backup: BackupFileV1 = {
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
      wearLogs,
    };

    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: "application/json" });

    const dateLabel = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `watch-tracker-backup-${dateLabel}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFullBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = String(e.target?.result || "");
        const parsed = JSON.parse(text) as Partial<BackupFileV1>;

        if (
          !parsed ||
          typeof parsed !== "object" ||
          parsed.version !== 1 ||
          !Array.isArray(parsed.items) ||
          !Array.isArray(parsed.wearLogs)
        ) {
          alert("This file does not look like a valid Watch Tracker backup.");
          return;
        }

        const ok = window.confirm(
          "Importing this backup will REPLACE your current watches and wear log. Continue?"
        );
        if (!ok) return;

        setItems(parsed.items as WatchItem[]);
        setWearLogs(parsed.wearLogs as WearLog[]);
        alert("Backup imported successfully.");
      } catch (err) {
        console.error(err);
        alert("Failed to import backup. Is this the correct JSON file?");
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

  const handleBackupFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importFullBackup(file);
    e.target.value = "";
  };

  // ================== UI ==================

  const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 12px",
    marginRight: 8,
    borderRadius: 999,
    border: active ? "1px solid #60a5fa" : "1px solid #374151",
    background: active ? "rgba(37,99,235,0.3)" : "#111827",
    color: "#e5e7eb",
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
    boxShadow: active ? "0 0 0 1px rgba(37,99,235,0.4)" : "none",
    transition: "background 0.15s ease, transform 0.12s ease",
  });

  const primaryButtonStyle: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #2563eb",
    background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
  };

  const subtleButtonStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #4b5563",
    background: "#111827",
    color: "#e5e7eb",
    cursor: "pointer",
  };

  const dangerButtonStyle: React.CSSProperties = {
    ...subtleButtonStyle,
    background: "#7f1d1d",
    border: "1px solid #b91c1c",
  };

  const tableHeadCell: React.CSSProperties = {
    borderBottom: "1px solid #374151",
    padding: 6,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#9ca3af",
    background: "#020617",
    textAlign: "left",
  };

  const tableBodyCell: React.CSSProperties = {
    borderBottom: "1px solid #1f2933",
    padding: 6,
    fontSize: 13,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, #111827 0, #020617 55%, #000 100%)",
        color: "#e5e7eb",
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "24px 16px 40px",
        }}
      >
        <header
          style={{
            marginBottom: 20,
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 700,
                margin: 0,
              }}
            >
              Watch Tracker
            </h1>
            <div
              style={{
                fontSize: 12,
                color: "#9ca3af",
                marginTop: 4,
              }}
            >
              Track inventory, wear time, and profit across your collection.
            </div>
          </div>
        </header>

        {/* Tabs */}
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => setActiveTab("inventory")}
            style={tabButtonStyle(activeTab === "inventory")}
          >
            Inventory
          </button>
          <button
            onClick={() => setActiveTab("sold")}
            style={tabButtonStyle(activeTab === "sold")}
          >
            Sold
          </button>
          <button
            onClick={() => setActiveTab("wear")}
            style={tabButtonStyle(activeTab === "wear")}
          >
            Wear Log
          </button>
          <button
            onClick={() => setActiveTab("stats")}
            style={tabButtonStyle(activeTab === "stats")}
          >
            Stats
          </button>
        </div>

        {/* Shared search */}
        <div
          style={{
            marginBottom: 12,
            display: "flex",
            flexDirection: "column",
            maxWidth: 260,
            gap: 4,
          }}
        >
          <label htmlFor="search" style={{ fontSize: 13 }}>
            Filter by model
          </label>
          <input
            id="search"
            type="text"
            placeholder="e.g. Sugess"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: 6,
              borderRadius: 6,
              border: "1px solid #374151",
              background: "#020617",
              color: "#e5e7eb",
              fontSize: 13,
            }}
          />
        </div>

        {/* INVENTORY TAB */}
        {activeTab === "inventory" && (
          <div>
            {/* Quick Add + CSV + Backup */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <button
                  onClick={() => setShowAdd((prev) => !prev)}
                  style={primaryButtonStyle}
                >
                  {showAdd ? "Cancel" : "+ Add Watch"}
                </button>
              </div>

              {showAdd && (
                <div
                  style={{
                    borderRadius: 10,
                    border: "1px solid #374151",
                    padding: 12,
                    background:
                      "linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))",
                    boxShadow: "0 22px 45px rgba(0,0,0,0.55)",
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
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                      gap: 10,
                    }}
                  >
                    <label style={{ fontSize: 13 }}>
                      Model
                      <input
                        type="text"
                        value={newModel}
                        placeholder="e.g. Sugess 1963"
                        onChange={(e) => setNewModel(e.target.value)}
                        style={{
                          padding: 6,
                          width: "100%",
                          marginTop: 2,
                          borderRadius: 6,
                          border: "1px solid #4b5563",
                          background: "#020617",
                          color: "#e5e7eb",
                          fontSize: 13,
                        }}
                      />
                    </label>

                    <label style={{ fontSize: 13 }}>
                      Purchase Date
                      <input
                        type="date"
                        value={newPurchaseDate}
                        onChange={(e) => setNewPurchaseDate(e.target.value)}
                        style={{
                          padding: 6,
                          width: "100%",
                          marginTop: 2,
                          borderRadius: 6,
                          border: "1px solid #4b5563",
                          background: "#020617",
                          color: "#e5e7eb",
                          fontSize: 13,
                        }}
                      />
                    </label>

                    <label style={{ fontSize: 13 }}>
                      Purchase Price
                      <input
                        type="text"
                        value={newPurchase}
                        placeholder="e.g. 250"
                        onChange={(e) => setNewPurchase(e.target.value)}
                        style={{
                          padding: 6,
                          width: "100%",
                          marginTop: 2,
                          borderRadius: 6,
                          border: "1px solid #4b5563",
                          background: "#020617",
                          color: "#e5e7eb",
                          fontSize: 13,
                        }}
                      />
                    </label>

                    <label style={{ fontSize: 13 }}>
                      Parts Cost
                      <input
                        type="text"
                        value={newParts}
                        placeholder="e.g. 30"
                        onChange={(e) => setNewParts(e.target.value)}
                        style={{
                          padding: 6,
                          width: "100%",
                          marginTop: 2,
                          borderRadius: 6,
                          border: "1px solid #4b5563",
                          background: "#020617",
                          color: "#e5e7eb",
                          fontSize: 13,
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
                        setNewPurchaseDate("");
                      }}
                      style={subtleButtonStyle}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddWatch}
                      style={primaryButtonStyle}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <button
                  onClick={exportWatchesCSV}
                  style={subtleButtonStyle}
                >
                  Export Watches CSV
                </button>

                <label
                  style={{
                    ...subtleButtonStyle,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
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

                <button
                  onClick={exportFullBackup}
                  style={subtleButtonStyle}
                >
                  Export FULL Backup (JSON)
                </button>

                <label
                  style={{
                    ...subtleButtonStyle,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                  }}
                >
                  Import Backup JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    style={{ display: "none" }}
                    onChange={handleBackupFileChange}
                  />
                </label>
              </div>
            </div>

            {/* Available inventory only */}
            <div
              style={{
                overflowX: "auto",
                borderRadius: 10,
                border: "1px solid #1f2933",
                background:
                  "linear-gradient(135deg,rgba(15,23,42,0.96),rgba(3,7,18,0.98))",
                boxShadow: "0 20px 45px rgba(0,0,0,0.55)",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 14,
                }}
              >
                <thead>
                  <tr>
                    <th style={tableHeadCell}>Model</th>
                    <th style={tableHeadCell}>Date Bought</th>
                    <th style={tableHeadCell}>Purchase</th>
                    <th style={tableHeadCell}>Parts</th>
                    <th style={tableHeadCell}>Posted</th>
                    <th style={tableHeadCell}>Status</th>
                    <th style={tableHeadCell}>Date Sold</th>
                    <th style={tableHeadCell}>Worn ×</th>
                    <th style={tableHeadCell}>Wear now</th>
                    <th style={tableHeadCell}>Mark sold</th>
                    <th style={tableHeadCell}>Edit</th>
                    <th style={tableHeadCell}>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {derived.available.map((w: any, idx: number) => (
                    <tr
                      key={w.id}
                      style={{
                        background:
                          idx % 2 === 0 ? "rgba(15,23,42,0.9)" : "rgba(2,6,23,0.9)",
                      }}
                    >
                      <td style={tableBodyCell}>{w.model}</td>
                      <td style={tableBodyCell}>
                        {w.purchaseDate || "—"}
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        {toCurrency(w.purchasePrice)}
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        {toCurrency(w.partsCost)}
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        {toCurrency(w.postedPrice ?? null)}
                      </td>
                      <td style={tableBodyCell}>{w.status}</td>
                      <td style={tableBodyCell}>{w.dateSold || "—"}</td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        {w.wearCount}
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        <button
                          onClick={() => startWear(w.id)}
                          style={subtleButtonStyle}
                        >
                          Wear now
                        </button>
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        <button
                          onClick={() => markSold(w.id)}
                          style={subtleButtonStyle}
                        >
                          Sold
                        </button>
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        <button
                          onClick={() => editWatch(w.id)}
                          style={subtleButtonStyle}
                        >
                          Edit
                        </button>
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        <button
                          onClick={() => deleteWatch(w.id)}
                          style={dangerButtonStyle}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {derived.available.length === 0 && (
                    <tr>
                      <td
                        colSpan={12}
                        style={{
                          padding: 10,
                          textAlign: "center",
                          color: "#6b7280",
                        }}
                      >
                        No available watches.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SOLD TAB */}
        {activeTab === "sold" && (
          <div>
            {/* Filters row */}
            <div
              style={{
                marginBottom: 12,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                fontSize: 14,
              }}
            >
              <div>
                <span style={{ marginRight: 4 }}>Year:</span>
                <select
                  value={soldYearFilter}
                  onChange={(e) => setSoldYearFilter(e.target.value)}
                  style={{
                    padding: 4,
                    borderRadius: 6,
                    border: "1px solid #374151",
                    background: "#020617",
                    color: "#e5e7eb",
                  }}
                >
                  <option value="all">All</option>
                  {soldYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span style={{ marginRight: 4 }}>Result:</span>
                <select
                  value={soldProfitFilter}
                  onChange={(e) =>
                    setSoldProfitFilter(e.target.value as any)
                  }
                  style={{
                    padding: 4,
                    borderRadius: 6,
                    border: "1px solid #374151",
                    background: "#020617",
                    color: "#e5e7eb",
                  }}
                >
                  <option value="all">All</option>
                  <option value="profit">Profit only</option>
                  <option value="loss">Loss only</option>
                  <option value="breakeven">Break-even</option>
                </select>
              </div>
            </div>

            {/* Summary bar */}
            <div
              style={{
                marginBottom: 12,
                padding: 10,
                borderRadius: 10,
                border: "1px solid #374151",
                background:
                  "linear-gradient(135deg,rgba(15,23,42,0.98),rgba(3,7,18,0.98))",
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                fontSize: 14,
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  Total Cost
                </div>
                <div>
                  {toCurrency(soldSummaryFiltered.totalCost || 0)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  Total Sold
                </div>
                <div>
                  {toCurrency(soldSummaryFiltered.totalSold || 0)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  Total Profit
                </div>
                <div>
                  {toCurrency(soldSummaryFiltered.totalProfit || 0)}
                </div>
              </div>
              <div style={{ marginLeft: "auto" }}>
                <button
                  onClick={exportPLCSV}
                  style={primaryButtonStyle}
                >
                  Export P/L CSV
                </button>
              </div>
            </div>

            <div
              style={{
                overflowX: "auto",
                borderRadius: 10,
                border: "1px solid #1f2933",
                background:
                  "linear-gradient(135deg,rgba(15,23,42,0.96),rgba(3,7,18,0.98))",
                boxShadow: "0 20px 45px rgba(0,0,0,0.55)",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 14,
                }}
              >
                <thead>
                  <tr>
                    <th style={tableHeadCell}>Model</th>
                    <th style={tableHeadCell}>Purchase</th>
                    <th style={tableHeadCell}>Parts</th>
                    <th style={tableHeadCell}>Total Cost</th>
                    <th style={tableHeadCell}>Sold Price</th>
                    <th style={tableHeadCell}>Profit</th>
                    <th style={tableHeadCell}>Date Sold</th>
                    <th style={tableHeadCell}>Worn ×</th>
                    <th style={tableHeadCell}>Undo</th>
                    <th style={tableHeadCell}>Edit</th>
                    <th style={tableHeadCell}>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSold.map((w: any, idx: number) => (
                    <tr
                      key={w.id}
                      style={{
                        background:
                          idx % 2 === 0 ? "rgba(15,23,42,0.9)" : "rgba(2,6,23,0.9)",
                      }}
                    >
                      <td style={tableBodyCell}>{w.model}</td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        {toCurrency(w.purchasePrice)}
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        {toCurrency(w.partsCost)}
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        {toCurrency(w.totalCost)}
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        {toCurrency(w.soldPrice ?? null)}
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                          color:
                            typeof w.profit === "number"
                              ? w.profit > 0
                                ? "#4ade80"
                                : w.profit < 0
                                ? "#f97373"
                                : "#e5e7eb"
                              : "#9ca3af",
                        }}
                      >
                        {typeof w.profit === "number"
                          ? toCurrency(w.profit)
                          : "—"}
                      </td>
                      <td style={tableBodyCell}>{w.dateSold || "—"}</td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        {w.wearCount}
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        <button
                          onClick={() => undoSold(w.id)}
                          style={subtleButtonStyle}
                        >
                          Undo
                        </button>
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        <button
                          onClick={() => editSoldWatch(w.id)}
                          style={subtleButtonStyle}
                        >
                          Edit
                        </button>
                      </td>
                      <td
                        style={{
                          ...tableBodyCell,
                          textAlign: "right",
                        }}
                      >
                        <button
                          onClick={() => deleteWatch(w.id)}
                          style={dangerButtonStyle}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredSold.length === 0 && (
                    <tr>
                      <td
                        colSpan={11}
                        style={{
                          padding: 10,
                          textAlign: "center",
                          color: "#6b7280",
                        }}
                      >
                        No sold watches match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* WEAR TAB */}
        {activeTab === "wear" && (
          <div>
            {/* Current active watch */}
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid #374151",
                marginBottom: 12,
                background:
                  "linear-gradient(135deg,rgba(15,23,42,0.96),rgba(3,7,18,0.98))",
              }}
            >
              {derived.activeWear ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    Currently wearing
                  </div>
                  <div style={{ fontSize: 14 }}>
                    {(() => {
                      const active = derived.activeWear!;
                      const watch = items.find(
                        (i) => i.id === active.watchId
                      );
                      const label = watch?.model || "(deleted)";
                      return (
                        <>
                          {label}
                          <br />
                          Since: {formatDateTime(active.start)}
                        </>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 14, color: "#9ca3af" }}>
                  No active watch. Start one from the Inventory tab with
                  “Wear now”.
                </div>
              )}
            </div>

            {/* Wear filters */}
            <div
              style={{
                marginBottom: 12,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                fontSize: 14,
              }}
            >
              <span>Filter by watch:</span>
              <select
                value={wearWatchFilter}
                onChange={(e) => setWearWatchFilter(e.target.value)}
                style={{
                  padding: 4,
                  borderRadius: 6,
                  border: "1px solid #374151",
                  background: "#020617",
                  color: "#e5e7eb",
                }}
              >
                <option value="all">All watches</option>
                {wearLabels.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {/* Controls */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 16,
              }}
            >
              <button
                onClick={clearWearLogs}
                style={dangerButtonStyle}
              >
                Clear Wear Log
              </button>
              <button
                onClick={exportWearCSV}
                style={subtleButtonStyle}
              >
                Export Wear CSV
              </button>
              <label
                style={{
                  ...subtleButtonStyle,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
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
            <div
              style={{
                overflowX: "auto",
                borderRadius: 10,
                border: "1px solid #1f2933",
                background:
                  "linear-gradient(135deg,rgba(15,23,42,0.96),rgba(3,7,18,0.98))",
                boxShadow: "0 20px 45px rgba(0,0,0,0.55)",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 14,
                }}
              >
                <thead>
                  <tr>
                    <th style={tableHeadCell}>Watch</th>
                    <th style={tableHeadCell}>Start</th>
                    <th style={tableHeadCell}>End</th>
                    <th style={tableHeadCell}>Duration</th>
                    <th style={tableHeadCell}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {wearLogs
                    .filter((log) => {
                      if (wearWatchFilter === "all") return true;
                      const watch = items.find(
                        (i) => i.id === log.watchId
                      );
                      const label = (watch?.model || "").trim();
                      return label === wearWatchFilter;
                    })
                    .map((log, idx) => {
                      const watch = items.find((i) => i.id === log.watchId);
                      const label = watch ? watch.model : "(deleted)";
                      return (
                        <tr
                          key={log.id}
                          style={{
                            background:
                              idx % 2 === 0
                                ? "rgba(15,23,42,0.9)"
                                : "rgba(2,6,23,0.9)",
                          }}
                        >
                          <td style={tableBodyCell}>{label}</td>
                          <td style={tableBodyCell}>
                            {formatDateTime(log.start)}
                          </td>
                          <td style={tableBodyCell}>
                            {formatDateTime(log.end)}
                          </td>
                          <td style={tableBodyCell}>
                            {formatDuration(log.start, log.end)}
                          </td>
                          <td style={tableBodyCell}>
                            <button
                              onClick={() => editWearLog(log.id)}
                              style={{
                                ...subtleButtonStyle,
                                padding: "3px 8px",
                                marginRight: 4,
                              }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteWearLog(log.id)}
                              style={{
                                ...dangerButtonStyle,
                                padding: "3px 8px",
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {wearLogs.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          padding: 10,
                          textAlign: "center",
                          color: "#6b7280",
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

        {/* STATS TAB */}
        {activeTab === "stats" && (
          <div>
            {/* Top summary */}
            <div
              style={{
                marginBottom: 16,
                padding: 10,
                borderRadius: 10,
                border: "1px solid #374151",
                background:
                  "linear-gradient(135deg,rgba(15,23,42,0.98),rgba(3,7,18,0.98))",
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                fontSize: 14,
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  Total watches
                </div>
                <div>{totalWatches}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  Available
                </div>
                <div>{totalAvailable}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>Sold</div>
                <div>{totalSoldCount}</div>
              </div>
              {favouriteWatch && (
                <div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>
                    Most worn
                  </div>
                  <div>
                    {favouriteWatch.watch.model} ·{" "}
                    {favouriteWatch.wearCount} wears
                  </div>
                </div>
              )}
              {mostProfitableWatch && (
                <div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>
                    Most profit
                  </div>
                  <div>
                    {mostProfitableWatch.model} ·{" "}
                    {toCurrency(mostProfitableWatch.profit)}
                  </div>
                </div>
              )}
            </div>

            {/* Per-watch stats table */}
            <div
              style={{
                overflowX: "auto",
                borderRadius: 10,
                border: "1px solid #1f2933",
                background:
                  "linear-gradient(135deg,rgba(15,23,42,0.96),rgba(3,7,18,0.98))",
                boxShadow: "0 20px 45px rgba(0,0,0,0.55)",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 14,
                }}
              >
                <thead>
                  <tr>
                    <th style={tableHeadCell}>Model</th>
                    <th style={tableHeadCell}>Status</th>
                    <th style={tableHeadCell}>Worn ×</th>
                    <th style={tableHeadCell}>Total wear time</th>
                    <th style={tableHeadCell}>Purchase</th>
                    <th style={tableHeadCell}>Sold price</th>
                    <th style={tableHeadCell}>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {statsByWatch.map((s, idx) => {
                    const w = s.watch;
                    const totalCost = w.purchasePrice + w.partsCost;
                    const profit =
                      w.status === "Sold" && typeof w.soldPrice === "number"
                        ? w.soldPrice - totalCost
                        : null;
                    return (
                      <tr
                        key={w.id}
                        style={{
                          background:
                            idx % 2 === 0
                              ? "rgba(15,23,42,0.9)"
                              : "rgba(2,6,23,0.9)",
                        }}
                      >
                        <td style={tableBodyCell}>{w.model}</td>
                        <td style={tableBodyCell}>{w.status}</td>
                        <td
                          style={{
                            ...tableBodyCell,
                            textAlign: "right",
                          }}
                        >
                          {s.wearCount}
                        </td>
                        <td style={tableBodyCell}>
                          {s.wearCount > 0
                            ? formatTotalDuration(s.totalMinutes)
                            : "—"}
                        </td>
                        <td
                          style={{
                            ...tableBodyCell,
                            textAlign: "right",
                          }}
                        >
                          {toCurrency(w.purchasePrice)}
                        </td>
                        <td
                          style={{
                            ...tableBodyCell,
                            textAlign: "right",
                          }}
                        >
                          {toCurrency(w.soldPrice ?? null)}
                        </td>
                        <td
                          style={{
                            ...tableBodyCell,
                            textAlign: "right",
                            color:
                              typeof profit === "number"
                                ? profit > 0
                                  ? "#4ade80"
                                  : profit < 0
                                  ? "#f97373"
                                  : "#e5e7eb"
                                : "#9ca3af",
                          }}
                        >
                          {typeof profit === "number"
                            ? toCurrency(profit)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {statsByWatch.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{
                          padding: 10,
                          textAlign: "center",
                          color: "#6b7280",
                        }}
                      >
                        No watches to show yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
