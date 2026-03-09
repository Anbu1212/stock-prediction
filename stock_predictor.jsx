import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, ReferenceLine } from "recharts";

// ─── In-Memory Database ───────────────────────────────────────────────────────
const DB = {
  stocks: {},
  predictions: [],
  watchlist: ["AAPL", "TSLA", "MSFT", "GOOGL", "NVDA"],
  init() {
    const saved = this._load("stockDB");
    if (saved) {
      this.stocks = saved.stocks || {};
      this.predictions = saved.predictions || [];
      this.watchlist = saved.watchlist || this.watchlist;
    }
  },
  save() {
    this._save("stockDB", { stocks: this.stocks, predictions: this.predictions, watchlist: this.watchlist });
  },
  _save(key, data) { try { sessionStorage.setItem(key, JSON.stringify(data)); } catch(e) {} },
  _load(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch(e) { return null; } },
  upsertStock(ticker, data) {
    this.stocks[ticker] = { ...this.stocks[ticker], ...data, updatedAt: Date.now() };
    this.save();
  },
  addPrediction(pred) {
    this.predictions.unshift({ ...pred, id: Date.now(), createdAt: new Date().toISOString() });
    this.predictions = this.predictions.slice(0, 50);
    this.save();
  },
  getPredictions(ticker) {
    return this.predictions.filter(p => p.ticker === ticker);
  },
  addToWatchlist(ticker) {
    if (!this.watchlist.includes(ticker)) { this.watchlist.push(ticker); this.save(); }
  },
  removeFromWatchlist(ticker) {
    this.watchlist = this.watchlist.filter(t => t !== ticker); this.save();
  }
};

// ─── Data Generation ──────────────────────────────────────────────────────────
function generateStockData(ticker, days = 90) {
  const seeds = { AAPL: 182, TSLA: 245, MSFT: 378, GOOGL: 140, NVDA: 875, AMZN: 178, META: 495, NFLX: 620, AMD: 165, INTC: 42 };
  let price = seeds[ticker] || (ticker.charCodeAt(0) * 3.7 + 50);
  const data = [];
  const now = Date.now();
  const volatility = { TSLA: 0.035, NVDA: 0.03, AAPL: 0.015, MSFT: 0.012, GOOGL: 0.018, AMZN: 0.02, META: 0.025, NFLX: 0.028, AMD: 0.03, INTC: 0.02 };
  const vol = volatility[ticker] || 0.02;
  const trend = (Math.random() - 0.45) * 0.003;

  for (let i = days; i >= 0; i--) {
    const date = new Date(now - i * 86400000);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const change = (Math.random() - 0.5) * 2 * vol + trend;
    price = Math.max(price * (1 + change), 1);
    const open = price * (1 + (Math.random() - 0.5) * 0.01);
    const high = Math.max(price, open) * (1 + Math.random() * 0.02);
    const low = Math.min(price, open) * (1 - Math.random() * 0.02);
    const volume = Math.floor((Math.random() * 80 + 20) * 1e6);
    data.push({
      date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      fullDate: date.toISOString().split("T")[0],
      close: +price.toFixed(2), open: +open.toFixed(2),
      high: +high.toFixed(2), low: +low.toFixed(2), volume
    });
  }
  return data;
}

function predictNextDays(historicalData, days = 14) {
  const recent = historicalData.slice(-20);
  const prices = recent.map(d => d.close);
  const avgChange = prices.slice(1).reduce((s, p, i) => s + (p - prices[i]) / prices[i], 0) / (prices.length - 1);
  const volatility = Math.sqrt(prices.slice(1).reduce((s, p, i) => s + Math.pow((p - prices[i]) / prices[i], 2), 0) / (prices.length - 1));
  const lastPrice = prices[prices.length - 1];
  const lastDate = new Date(historicalData[historicalData.length - 1].fullDate);
  const predictions = [];
  let price = lastPrice;
  const confidence = Math.max(0.3, Math.min(0.95, 1 - volatility * 15));

  for (let i = 1; i <= days; i++) {
    const date = new Date(lastDate);
    date.setDate(date.getDate() + i);
    if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    if (date.getDay() === 6) date.setDate(date.getDate() + 2);
    const change = avgChange + (Math.random() - 0.5) * volatility;
    price = price * (1 + change);
    const margin = price * volatility * 1.5 * Math.sqrt(i);
    predictions.push({
      date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      predicted: +price.toFixed(2),
      upper: +(price + margin).toFixed(2),
      lower: +(Math.max(price - margin, 1)).toFixed(2),
      confidence: +(confidence * Math.max(0.5, 1 - i * 0.03)).toFixed(2)
    });
  }
  return { predictions, trend: avgChange > 0 ? "BULLISH" : "BEARISH", confidence, volatility };
}

// ─── AI Analysis ──────────────────────────────────────────────────────────────
async function getAIAnalysis(ticker, data, predResult) {
  const recent = data.slice(-5);
  const change5d = ((recent[recent.length - 1].close - recent[0].close) / recent[0].close * 100).toFixed(2);
  const prompt = `You are a stock market analyst. Analyze ${ticker} stock briefly.
Recent data: last 5-day change is ${change5d}%, current price $${recent[recent.length-1].close}, 
volatility is ${(predResult.volatility * 100).toFixed(2)}%, trend is ${predResult.trend}, 
14-day prediction confidence ${(predResult.confidence * 100).toFixed(0)}%.
Provide: 1) 2-sentence market analysis 2) Key risk factor 3) Sentiment: BULLISH/BEARISH/NEUTRAL with brief reason.
Keep total response under 120 words. Be direct and specific.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const json = await res.json();
  return json.content?.[0]?.text || "Analysis unavailable.";
}

// ─── Components ───────────────────────────────────────────────────────────────
const TICKERS = ["AAPL", "TSLA", "MSFT", "GOOGL", "NVDA", "AMZN", "META", "NFLX", "AMD", "INTC"];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 14px" }}>
      <p style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color, fontSize: 13, fontWeight: 600 }}>
          {p.name}: ${typeof p.value === "number" ? p.value.toFixed(2) : p.value}
        </p>
      ))}
    </div>
  );
};

export default function App() {
  const [selectedTicker, setSelectedTicker] = useState("AAPL");
  const [historicalData, setHistoricalData] = useState([]);
  const [predictionData, setPredictionData] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [activeTab, setActiveTab] = useState("chart");
  const [dbHistory, setDbHistory] = useState([]);
  const [newTicker, setNewTicker] = useState("");
  const [watchlist, setWatchlist] = useState([]);
  const [marketOverview, setMarketOverview] = useState([]);
  const [showPrediction, setShowPrediction] = useState(false);

  useEffect(() => { DB.init(); setWatchlist([...DB.watchlist]); }, []);

  const loadStock = useCallback((ticker) => {
    const data = generateStockData(ticker, 90);
    DB.upsertStock(ticker, { history: data.slice(-30).map(d => d.close), lastPrice: data[data.length - 1].close });
    setHistoricalData(data);
    setPredictionData(null);
    setAiAnalysis("");
    setShowPrediction(false);
    setDbHistory(DB.getPredictions(ticker));
  }, []);

  useEffect(() => { loadStock(selectedTicker); }, [selectedTicker, loadStock]);

  useEffect(() => {
    const overview = TICKERS.slice(0, 6).map(t => {
      const d = generateStockData(t, 5);
      const change = ((d[d.length - 1].close - d[0].close) / d[0].close * 100);
      return { ticker: t, price: d[d.length - 1].close, change: +change.toFixed(2) };
    });
    setMarketOverview(overview);
  }, []);

  const runPrediction = async () => {
    setIsLoadingAI(true);
    const result = predictNextDays(historicalData);
    setPredictionData(result);
    setShowPrediction(true);
    DB.addPrediction({ ticker: selectedTicker, trend: result.trend, confidence: result.confidence, targetPrice: result.predictions[result.predictions.length - 1].predicted });
    setDbHistory(DB.getPredictions(selectedTicker));
    try {
      const analysis = await getAIAnalysis(selectedTicker, historicalData, result);
      setAiAnalysis(analysis);
    } catch { setAiAnalysis("AI analysis temporarily unavailable."); }
    setIsLoadingAI(false);
  };

  const addToWatchlist = () => {
    const t = newTicker.toUpperCase().trim();
    if (t && !watchlist.includes(t)) { DB.addToWatchlist(t); setWatchlist([...DB.watchlist]); setNewTicker(""); }
  };

  const removeFromWatchlist = (t) => { DB.removeFromWatchlist(t); setWatchlist([...DB.watchlist]); };

  const currentPrice = historicalData[historicalData.length - 1]?.close || 0;
  const prevPrice = historicalData[historicalData.length - 2]?.close || currentPrice;
  const priceChange = currentPrice - prevPrice;
  const pctChange = ((priceChange / prevPrice) * 100).toFixed(2);
  const isUp = priceChange >= 0;

  const chartData = showPrediction && predictionData
    ? [...historicalData.slice(-30).map(d => ({ ...d, type: "historical" })),
       ...predictionData.predictions.map(d => ({ ...d, close: d.predicted, type: "predicted" }))]
    : historicalData.slice(-30);

  const minPrice = Math.min(...chartData.map(d => d.lower || d.close || d.low || 999999)) * 0.98;
  const maxPrice = Math.max(...chartData.map(d => d.upper || d.close || d.high || 0)) * 1.02;

  return (
    <div style={{ background: "#020c1b", minHeight: "100vh", fontFamily: "'JetBrains Mono', 'Courier New', monospace", color: "#e2e8f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0f172a; } ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 2px; }
        .ticker-btn { background: transparent; border: 1px solid #1e3a5f; color: #64748b; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 13px; transition: all 0.2s; }
        .ticker-btn:hover { border-color: #0ea5e9; color: #0ea5e9; }
        .ticker-btn.active { background: #0ea5e9; border-color: #0ea5e9; color: #fff; font-weight: 600; }
        .tab-btn { background: transparent; border: none; color: #64748b; padding: 8px 16px; cursor: pointer; font-family: inherit; font-size: 13px; border-bottom: 2px solid transparent; transition: all 0.2s; }
        .tab-btn.active { color: #0ea5e9; border-bottom-color: #0ea5e9; }
        .predict-btn { background: linear-gradient(135deg, #0ea5e9, #6366f1); border: none; color: #fff; padding: 12px 28px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 14px; font-weight: 600; transition: all 0.2s; letter-spacing: 0.5px; }
        .predict-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(14,165,233,0.4); }
        .predict-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .card { background: #0a1628; border: 1px solid #1e2d45; border-radius: 12px; padding: 20px; }
        .pulse { animation: pulse 2s infinite; } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        .slide-in { animation: slideIn 0.4s ease; } @keyframes slideIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        input { background: #0a1628; border: 1px solid #1e2d45; color: #e2e8f0; padding: 8px 12px; border-radius: 6px; font-family: inherit; font-size: 13px; outline: none; }
        input:focus { border-color: #0ea5e9; }
        .add-btn { background: #0ea5e9; border: none; color: #fff; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; }
        .badge { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; }
        .badge-bull { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); }
        .badge-bear { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
        .badge-neutral { background: rgba(251,191,36,0.15); color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e2d45", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#050e1f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, background: "linear-gradient(135deg,#0ea5e9,#6366f1)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📈</div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "-0.5px" }}>StockOracle</div>
            <div style={{ fontSize: 10, color: "#475569", letterSpacing: "1px" }}>AI-POWERED PREDICTIONS</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {marketOverview.map(m => (
            <div key={m.ticker} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#64748b" }}>{m.ticker}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: m.change >= 0 ? "#10b981" : "#ef4444" }}>
                {m.change >= 0 ? "▲" : "▼"} {Math.abs(m.change)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: "calc(100vh - 61px)" }}>
        {/* Sidebar */}
        <div style={{ borderRight: "1px solid #1e2d45", padding: 16, background: "#050e1f" }}>
          <div style={{ fontSize: 10, color: "#475569", letterSpacing: "1px", marginBottom: 12 }}>WATCHLIST</div>
          {watchlist.map(t => {
            const d = generateStockData(t, 2);
            const p = d[d.length - 1]?.close || 0;
            const chg = d.length > 1 ? ((p - d[0].close) / d[0].close * 100).toFixed(2) : "0.00";
            const up = parseFloat(chg) >= 0;
            return (
              <div key={t} onClick={() => setSelectedTicker(t)}
                style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer", marginBottom: 4, background: selectedTicker === t ? "rgba(14,165,233,0.1)" : "transparent", border: selectedTicker === t ? "1px solid rgba(14,165,233,0.3)" : "1px solid transparent", transition: "all 0.2s", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: selectedTicker === t ? "#0ea5e9" : "#e2e8f0" }}>{t}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>${p.toFixed(2)}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <div style={{ fontSize: 11, color: up ? "#10b981" : "#ef4444" }}>{up ? "+" : ""}{chg}%</div>
                  <button onClick={e => { e.stopPropagation(); removeFromWatchlist(t); }} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 10 }}>✕</button>
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 16, display: "flex", gap: 6 }}>
            <input value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase())} placeholder="+ Add ticker" style={{ flex: 1, width: 0 }} onKeyDown={e => e.key === "Enter" && addToWatchlist()} maxLength={5} />
            <button className="add-btn" onClick={addToWatchlist}>+</button>
          </div>

          <div style={{ fontSize: 10, color: "#475569", letterSpacing: "1px", margin: "24px 0 12px" }}>DB RECORDS</div>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>Stored predictions: <span style={{ color: "#0ea5e9" }}>{DB.predictions.length}</span></div>
          <div style={{ fontSize: 11, color: "#475569" }}>Tracked stocks: <span style={{ color: "#0ea5e9" }}>{Object.keys(DB.stocks).length}</span></div>

          {dbHistory.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, color: "#475569", letterSpacing: "1px", marginBottom: 8 }}>RECENT PREDICTIONS</div>
              {dbHistory.slice(0, 3).map(p => (
                <div key={p.id} className="card" style={{ padding: "8px 10px", marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: "#475569" }}>{new Date(p.createdAt).toLocaleDateString()}</div>
                  <div style={{ fontSize: 12, display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                    <span className={`badge badge-${p.trend === "BULLISH" ? "bull" : "bear"}`}>{p.trend}</span>
                    <span style={{ color: "#0ea5e9" }}>${p.targetPrice?.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Main */}
        <div style={{ padding: 24, overflow: "auto" }}>
          {/* Stock Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 32, fontWeight: 700 }}>{selectedTicker}</span>
                <span style={{ fontSize: 28, fontWeight: 300, color: "#94a3b8" }}>${currentPrice.toFixed(2)}</span>
                <span style={{ fontSize: 16, color: isUp ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                  {isUp ? "▲" : "▼"} ${Math.abs(priceChange).toFixed(2)} ({isUp ? "+" : ""}{pctChange}%)
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                Volume: {(historicalData[historicalData.length - 1]?.volume / 1e6)?.toFixed(1)}M · High: ${historicalData[historicalData.length - 1]?.high?.toFixed(2)} · Low: ${historicalData[historicalData.length - 1]?.low?.toFixed(2)}
              </div>
            </div>
            <button className="predict-btn" onClick={runPrediction} disabled={isLoadingAI}>
              {isLoadingAI ? <span className="pulse">⚡ Analyzing...</span> : "⚡ Run AI Prediction"}
            </button>
          </div>

          {/* Ticker row */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            {TICKERS.map(t => (
              <button key={t} className={`ticker-btn ${selectedTicker === t ? "active" : ""}`} onClick={() => setSelectedTicker(t)}>{t}</button>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ borderBottom: "1px solid #1e2d45", marginBottom: 20, display: "flex", gap: 4 }}>
            {["chart", "stats", "database"].map(tab => (
              <button key={tab} className={`tab-btn ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
                {tab === "chart" ? "📊 Chart" : tab === "stats" ? "📋 Stats" : "🗄️ Database"}
              </button>
            ))}
          </div>

          {/* Chart Tab */}
          {activeTab === "chart" && (
            <div className="slide-in">
              {/* Prediction banner */}
              {predictionData && (
                <div className="card" style={{ marginBottom: 16, display: "flex", gap: 20, alignItems: "center", borderColor: predictionData.trend === "BULLISH" ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#475569", letterSpacing: "1px" }}>TREND SIGNAL</div>
                    <span className={`badge badge-${predictionData.trend === "BULLISH" ? "bull" : "bear"}`} style={{ fontSize: 14, padding: "4px 14px" }}>{predictionData.trend}</span>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#475569", letterSpacing: "1px" }}>CONFIDENCE</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#0ea5e9" }}>{(predictionData.confidence * 100).toFixed(0)}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#475569", letterSpacing: "1px" }}>14D TARGET</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: predictionData.trend === "BULLISH" ? "#10b981" : "#ef4444" }}>
                      ${predictionData.predictions[predictionData.predictions.length - 1]?.predicted?.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#475569", letterSpacing: "1px" }}>VOLATILITY</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#fbbf24" }}>{(predictionData.volatility * 100).toFixed(2)}%</div>
                  </div>
                  {aiAnalysis && (
                    <div style={{ flex: 1, borderLeft: "1px solid #1e2d45", paddingLeft: 20, fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
                      {aiAnalysis}
                    </div>
                  )}
                </div>
              )}

              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Price History {showPrediction ? "+ 14-Day Forecast" : "(90 Days)"}</div>
                  {showPrediction && <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#64748b" }}>
                    <span style={{ color: "#0ea5e9" }}>━━ Historical</span>
                    <span style={{ color: "#a855f7" }}>- - Predicted</span>
                    <span style={{ color: "#475569" }}>░░ Confidence Band</span>
                  </div>}
                </div>
                <ResponsiveContainer width="100%" height={340}>
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 10 }}>
                    <defs>
                      <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorPred" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                    <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} interval={Math.floor(chartData.length / 8)} />
                    <YAxis domain={[minPrice, maxPrice]} tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
                    <Tooltip content={<CustomTooltip />} />
                    {showPrediction && <ReferenceLine x={historicalData.slice(-30)[historicalData.slice(-30).length - 1]?.date} stroke="#1e3a5f" strokeDasharray="4 4" label={{ value: "Today", fill: "#475569", fontSize: 10 }} />}
                    <Area type="monotone" dataKey="close" stroke="#0ea5e9" strokeWidth={2} fill="url(#colorClose)" dot={false} connectNulls />
                    {showPrediction && <>
                      <Area type="monotone" dataKey="upper" stroke="transparent" fill="url(#colorPred)" dot={false} connectNulls />
                      <Area type="monotone" dataKey="predicted" stroke="#a855f7" strokeWidth={2} strokeDasharray="6 3" fill="none" dot={false} connectNulls />
                      <Area type="monotone" dataKey="lower" stroke="transparent" fill="#020c1b" dot={false} connectNulls />
                    </>}
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Prediction Table */}
              {predictionData && (
                <div className="card" style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>14-Day Prediction Schedule</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
                    {predictionData.predictions.map((p, i) => (
                      <div key={i} style={{ background: "#050e1f", borderRadius: 8, padding: "10px 8px", textAlign: "center", border: `1px solid ${p.predicted > currentPrice ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                        <div style={{ fontSize: 10, color: "#475569", marginBottom: 4 }}>Day {i + 1}</div>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{p.date}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: p.predicted > currentPrice ? "#10b981" : "#ef4444" }}>${p.predicted}</div>
                        <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>{(p.confidence * 100).toFixed(0)}% conf</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Stats Tab */}
          {activeTab === "stats" && (
            <div className="slide-in">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 16 }}>
                {[
                  { label: "52W High", value: `$${Math.max(...historicalData.map(d => d.high)).toFixed(2)}`, color: "#10b981" },
                  { label: "52W Low", value: `$${Math.min(...historicalData.map(d => d.low)).toFixed(2)}`, color: "#ef4444" },
                  { label: "Avg Volume", value: `${(historicalData.reduce((s, d) => s + d.volume, 0) / historicalData.length / 1e6).toFixed(1)}M`, color: "#0ea5e9" },
                  { label: "30D Volatility", value: `${(Math.sqrt(historicalData.slice(-30).slice(1).reduce((s, d, i) => s + Math.pow(Math.log(d.close / historicalData.slice(-30)[i].close), 2), 0) / 29) * 100 * Math.sqrt(252)).toFixed(2)}%`, color: "#fbbf24" },
                  { label: "30D Return", value: `${((historicalData[historicalData.length - 1]?.close - historicalData[historicalData.length - 31]?.close) / historicalData[historicalData.length - 31]?.close * 100).toFixed(2)}%`, color: isUp ? "#10b981" : "#ef4444" },
                  { label: "Market Cap", value: `$${(currentPrice * (Math.random() * 5 + 2)).toFixed(1)}B`, color: "#a855f7" },
                ].map(s => (
                  <div key={s.label} className="card">
                    <div style={{ fontSize: 11, color: "#475569", marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Recent OHLCV Data</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ borderBottom: "1px solid #1e2d45" }}>
                    {["Date", "Open", "High", "Low", "Close", "Volume"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#475569", fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {historicalData.slice(-10).reverse().map((d, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #0a1628" }}>
                        <td style={{ padding: "8px 12px", color: "#94a3b8" }}>{d.date}</td>
                        <td style={{ padding: "8px 12px" }}>${d.open}</td>
                        <td style={{ padding: "8px 12px", color: "#10b981" }}>${d.high}</td>
                        <td style={{ padding: "8px 12px", color: "#ef4444" }}>${d.low}</td>
                        <td style={{ padding: "8px 12px", fontWeight: 600, color: d.close >= d.open ? "#10b981" : "#ef4444" }}>${d.close}</td>
                        <td style={{ padding: "8px 12px", color: "#64748b" }}>{(d.volume / 1e6).toFixed(1)}M</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Database Tab */}
          {activeTab === "database" && (
            <div className="slide-in">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div className="card">
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>🗄️ Stocks Table <span style={{ fontSize: 11, color: "#475569", fontWeight: 400 }}>({Object.keys(DB.stocks).length} records)</span></div>
                  <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace", marginBottom: 10, padding: "8px 10px", background: "#020c1b", borderRadius: 6 }}>
                    SELECT * FROM stocks ORDER BY updatedAt DESC;
                  </div>
                  {Object.entries(DB.stocks).map(([ticker, data]) => (
                    <div key={ticker} style={{ padding: "8px 10px", borderRadius: 6, background: "#050e1f", marginBottom: 6, fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ color: "#0ea5e9", fontWeight: 700 }}>{ticker}</span>
                        <span style={{ color: "#475569", marginLeft: 8 }}>${data.lastPrice?.toFixed(2)}</span>
                      </div>
                      <span style={{ fontSize: 10, color: "#475569" }}>{new Date(data.updatedAt).toLocaleTimeString()}</span>
                    </div>
                  ))}
                  {Object.keys(DB.stocks).length === 0 && <div style={{ color: "#475569", fontSize: 12 }}>No stocks viewed yet.</div>}
                </div>

                <div className="card">
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>📊 Predictions Table <span style={{ fontSize: 11, color: "#475569", fontWeight: 400 }}>({DB.predictions.length} records)</span></div>
                  <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace", marginBottom: 10, padding: "8px 10px", background: "#020c1b", borderRadius: 6 }}>
                    SELECT * FROM predictions ORDER BY createdAt DESC LIMIT 20;
                  </div>
                  <div style={{ maxHeight: 300, overflow: "auto" }}>
                    {DB.predictions.map(p => (
                      <div key={p.id} style={{ padding: "8px 10px", borderRadius: 6, background: "#050e1f", marginBottom: 6, fontSize: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <span style={{ color: "#0ea5e9", fontWeight: 700 }}>{p.ticker}</span>
                          <span style={{ fontSize: 10, color: "#475569" }}>{new Date(p.createdAt).toLocaleString()}</span>
                        </div>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span className={`badge badge-${p.trend === "BULLISH" ? "bull" : "bear"}`}>{p.trend}</span>
                          <span style={{ color: "#94a3b8" }}>Target: <span style={{ color: "#fbbf24" }}>${p.targetPrice?.toFixed(2)}</span></span>
                          <span style={{ color: "#94a3b8" }}>Conf: <span style={{ color: "#0ea5e9" }}>{(p.confidence * 100).toFixed(0)}%</span></span>
                        </div>
                      </div>
                    ))}
                    {DB.predictions.length === 0 && <div style={{ color: "#475569", fontSize: 12 }}>No predictions yet. Run AI Prediction to populate.</div>}
                  </div>
                </div>

                <div className="card" style={{ gridColumn: "1/-1" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>📋 Watchlist Table <span style={{ fontSize: 11, color: "#475569", fontWeight: 400 }}>({DB.watchlist.length} records)</span></div>
                  <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace", marginBottom: 10, padding: "8px 10px", background: "#020c1b", borderRadius: 6 }}>
                    SELECT * FROM watchlist;
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {DB.watchlist.map(t => (
                      <div key={t} style={{ padding: "6px 14px", background: "#050e1f", borderRadius: 6, fontSize: 12, border: "1px solid #1e2d45" }}>
                        <span style={{ color: "#0ea5e9" }}>{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
