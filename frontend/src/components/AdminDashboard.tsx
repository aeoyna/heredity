import { useState, useEffect } from 'react';
import { 
  Database, 
  TrendingUp, 
  RefreshCw, 
  Download, 
  LineChart, 
  ArrowLeft,
  Activity,
  Users,
  Eye,
  BarChart2,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import { LineCanvas } from './LineCanvas';
import { MosaicCanvas } from './MosaicCanvas';
import type { LineDNA, MosaicDNA } from '../../../backend/src/shared-types';

interface AdminDashboardProps {
  lang: 'ja' | 'en';
  showMsg: (text: string, type: 'info' | 'success' | 'error') => void;
  API_BASE: string;
  onBack: () => void;
}

interface Thread {
  id: string;
  name: string;
  type: 'line' | 'mosaic';
  current_generation: number;
  total_swipes: number;
  created_at: string;
}

interface GenerationStat {
  generation: number;
  totalVotes: number;
  likes: number;
  nopes: number;
  likeRate: number;
  dnaMean: number;
  dnaVariance: number;
  // Representing the primary specimen's DNA structure
  dnas: any[]; 
}

interface OutsDist {
  outs: number;
  cnt: number;
}

export default function AdminDashboard({ lang, showMsg, API_BASE, onBack }: AdminDashboardProps) {
  const [loading, setLoading] = useState<boolean>(false);

  // Stats States
  const [systemStats, setSystemStats] = useState<{ 
    totalSessions: number; 
    totalThreads: number; 
    totalSwipes: number;
    outsDistribution: OutsDist[];
  } | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string>('');
  const [selectedThreadStats, setSelectedThreadStats] = useState<{ thread: Thread; generations: GenerationStat[] } | null>(null);
  
  // Restored specimen state
  const [selectedGenIndex, setSelectedGenIndex] = useState<number>(0);
  const [genInputText, setGenInputText] = useState<string>('');
  
  // Interactive Hover State for Charts
  const [hoveredPoint, setHoveredPoint] = useState<{ chart: 'like' | 'variance' | 'mean' | 'votes'; index: number; x: number; y: number } | null>(null);

  // Helper for API fetch
  const adminFetch = async (url: string, options: RequestInit = {}) => {
    return fetch(url, options);
  };

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/stats`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSystemStats(data.stats);
          fetchThreads();
        }
      } else {
        showMsg(lang === 'ja' ? '統計データの取得に失敗しました。' : 'Failed to fetch global metrics.', 'error');
      }
    } catch (err) {
      console.error(err);
      showMsg(lang === 'ja' ? '通信エラーが発生しました。' : 'Network error occurred.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchThreads = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/threads`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setThreads(data.threads);
          if (data.threads.length > 0) {
            setSelectedThreadId(data.threads[0].id);
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchThreadStats = async (threadId: string) => {
    if (!threadId) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${API_BASE}/api/admin/thread-stats?thread_id=${threadId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSelectedThreadStats(data);
          // Auto-select the latest generation
          if (data.generations && data.generations.length > 0) {
            setSelectedGenIndex(data.generations.length - 1);
          }
        }
      }
    } catch (err) {
      console.error(err);
      showMsg(lang === 'ja' ? '統計データの取得に失敗しました。' : 'Failed to fetch thread statistics.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Load stats on mount
  useEffect(() => {
    loadInitialData();
  }, []);

  // Fetch thread stats when selected thread changes
  useEffect(() => {
    if (selectedThreadId) {
      fetchThreadStats(selectedThreadId);
    }
  }, [selectedThreadId]);

  // Sync textbox input text when index changes
  useEffect(() => {
    setGenInputText(selectedGenIndex.toString());
  }, [selectedGenIndex]);

  // CSV Export utility
  const exportToCSV = () => {
    if (!selectedThreadStats) return;
    const { thread, generations } = selectedThreadStats;
    let csvContent = "data:text/csv;charset=utf-8,";
    
    // Header
    csvContent += "Generation,Total Swipes,Likes,Nopes,Like Rate (Fitness),DNA Mean,DNA Variance\n";
    
    // Rows
    generations.forEach(g => {
      csvContent += `${g.generation},${g.totalVotes},${g.likes},${g.nopes},${g.likeRate.toFixed(4)},${g.dnaMean.toFixed(4)},${g.dnaVariance.toFixed(6)}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `gene46_stats_${thread.name.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // SVG Chart Line generator helper
  const renderSVGChart = (
    data: number[],
    color: string,
    chartType: 'like' | 'variance' | 'mean' | 'votes',
    yMax = 1
  ) => {
    const width = 420;
    const height = 130;
    const padding = 25;
    
    if (data.length === 0) return null;

    const points: { x: number; y: number }[] = [];
    const stepX = (width - 2 * padding) / Math.max(1, data.length - 1);
    
    data.forEach((val, idx) => {
      const x = padding + idx * stepX;
      const y = height - padding - (val / (yMax || 1)) * (height - 2 * padding);
      points.push({ x, y });
    });

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible select-none">
        {/* Grids */}
        {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
          const y = padding + r * (height - 2 * padding);
          const gridVal = yMax - r * yMax;
          return (
            <g key={i}>
              <line 
                x1={padding} 
                y1={y} 
                x2={width - padding} 
                y2={y} 
                stroke="#11131e" 
                strokeWidth="1" 
              />
              <text 
                x={padding - 5} 
                y={y + 3} 
                fill="#4b5563" 
                fontSize="8" 
                textAnchor="end"
                className="font-mono font-bold"
              >
                {chartType === 'like' 
                  ? `${(gridVal * 100).toFixed(0)}%` 
                  : chartType === 'votes' 
                    ? gridVal.toFixed(0) 
                    : gridVal.toFixed(chartType === 'variance' ? 4 : 2)}
              </text>
            </g>
          );
        })}

        {/* X axis labels */}
        {points.map((p, i) => {
          const modulo = data.length > 15 ? Math.ceil(data.length / 8) : 1;
          if (i % modulo !== 0 && i !== data.length - 1) return null;
          return (
            <text
              key={i}
              x={p.x}
              y={height - 4}
              fill="#4b5563"
              fontSize="8"
              textAnchor="middle"
              className="font-mono font-bold"
            >
              G{i}
            </text>
          );
        })}

        {/* The Line */}
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="drop-shadow-[0_0_4px_rgba(168,85,247,0.2)]"
        />

        {/* Interactive Dots */}
        {points.map((p, i) => {
          const isSelected = i === selectedGenIndex;
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={isSelected ? "6" : "4"}
              fill={isSelected ? color : "#0b0c10"}
              stroke={color}
              strokeWidth="2"
              className="cursor-pointer transition-all hover:r-6"
              onClick={() => {
                setSelectedGenIndex(i);
              }}
              onMouseEnter={() => {
                setHoveredPoint({
                  chart: chartType,
                  index: i,
                  x: p.x,
                  y: p.y - 10
                });
              }}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          );
        })}

        {/* Hover Tooltip Overlay */}
        {hoveredPoint && hoveredPoint.chart === chartType && selectedThreadStats && (
          <g>
            <rect
              x={Math.max(padding, Math.min(width - padding - 95, hoveredPoint.x - 47))}
              y={hoveredPoint.y - 35}
              width="95"
              height="30"
              rx="6"
              fill="#030408"
              stroke={color}
              strokeWidth="1"
              opacity="0.95"
            />
            <text
              x={Math.max(padding + 47, Math.min(width - padding - 47, hoveredPoint.x))}
              y={hoveredPoint.y - 23}
              fill="#e5e7eb"
              fontSize="8"
              fontWeight="bold"
              textAnchor="middle"
            >
              Gen {hoveredPoint.index} {selectedGenIndex === hoveredPoint.index ? ' (Selected)' : ''}
            </text>
            <text
              x={Math.max(padding + 47, Math.min(width - padding - 47, hoveredPoint.x))}
              y={hoveredPoint.y - 12}
              fill={color}
              fontSize="9"
              fontWeight="black"
              textAnchor="middle"
              className="font-mono"
            >
              {chartType === 'like' 
                ? `Like: ${(data[hoveredPoint.index] * 100).toFixed(1)}%` 
                : chartType === 'variance'
                  ? `Var: ${data[hoveredPoint.index].toFixed(4)}`
                  : chartType === 'mean'
                    ? `Mean: ${data[hoveredPoint.index].toFixed(3)}`
                    : `Swipes: ${data[hoveredPoint.index]}`}
            </text>
          </g>
        )}
      </svg>
    );
  };

  const currentThread = selectedThreadStats?.thread;
  const currentGenerations = selectedThreadStats?.generations ?? [];
  const selectedGenData = currentGenerations[selectedGenIndex];

  // Restored specimen logic
  const restoredDna = selectedGenData?.dnas && selectedGenData.dnas.length > 0 
    ? selectedGenData.dnas[0] 
    : null;

  const maxLikeRate = 1.0;
  const maxVariance = currentGenerations.reduce((max, g) => Math.max(max, g.dnaVariance), 0) || 0.1;
  const maxMean = currentGenerations.reduce((max, g) => Math.max(max, g.dnaMean), 0) || 1.0;
  const maxVotes = currentGenerations.reduce((max, g) => Math.max(max, g.totalVotes), 0) || 10;

  return (
    <div className="w-full max-w-[440px] flex flex-col p-5 bg-[#090a10]/80 border border-gray-900 rounded-3xl shadow-2xl backdrop-blur-md min-h-[460px] max-h-[85vh] overflow-y-auto"
         style={{ fontFamily: "'Outfit', sans-serif" }}>
      
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-900 pb-3 mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button 
            onClick={onBack}
            className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-950 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="text-left">
            <span className="text-[8px] uppercase tracking-widest text-purple-400 font-bold block">GA Research Dashboard</span>
            <h3 className="text-xs font-black text-gray-200">
              {lang === 'ja' ? '統計分析ダッシュボード' : 'GA Analysis Stats'}
            </h3>
          </div>
        </div>
        
        <button
          onClick={() => {
            loadInitialData();
            if (selectedThreadId) fetchThreadStats(selectedThreadId);
          }}
          disabled={loading}
          className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-950 rounded-lg transition-colors flex items-center justify-center"
          title={lang === 'ja' ? '再読み込み' : 'Reload'}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 1. Global Metrics */}
      {systemStats && (
        <div className="grid grid-cols-3 gap-2 mb-4 flex-shrink-0">
          <div className="p-2.5 bg-black/40 border border-gray-900 rounded-xl text-center">
            <span className="text-[7.5px] text-gray-500 font-bold uppercase tracking-wider block mb-0.5">Sessions</span>
            <span className="text-xs font-black text-gray-200 flex items-center justify-center gap-1">
              <Users className="w-3 h-3 text-purple-400" />
              {systemStats.totalSessions}
            </span>
          </div>
          <div className="p-2.5 bg-black/40 border border-gray-900 rounded-xl text-center">
            <span className="text-[7.5px] text-gray-500 font-bold uppercase tracking-wider block mb-0.5">Projects</span>
            <span className="text-xs font-black text-gray-200 flex items-center justify-center gap-1">
              <Database className="w-3 h-3 text-indigo-400" />
              {systemStats.totalThreads}
            </span>
          </div>
          <div className="p-2.5 bg-black/40 border border-gray-900 rounded-xl text-center">
            <span className="text-[7.5px] text-gray-500 font-bold uppercase tracking-wider block mb-0.5">Evaluations</span>
            <span className="text-xs font-black text-gray-200 flex items-center justify-center gap-1">
              <Activity className="w-3 h-3 text-emerald-400" />
              {systemStats.totalSwipes}
            </span>
          </div>
        </div>
      )}

      {/* 2. Penalty outs distribution stats */}
      {systemStats?.outsDistribution && systemStats.outsDistribution.length > 0 && (
        <div className="mb-4 p-3 bg-black/30 border border-gray-900 rounded-2xl flex-shrink-0">
          <div className="flex items-center gap-1 mb-1.5 px-0.5">
            <AlertTriangle className="w-3 h-3 text-yellow-500" />
            <span className="text-[8px] text-gray-400 font-bold uppercase tracking-widest">
              {lang === 'ja' ? '警告ペナルティ(Outs)全体分布' : 'Noise Card Warnings Distribution'}
            </span>
          </div>
          <div className="flex h-3 bg-gray-950 rounded-lg overflow-hidden border border-gray-900 text-[8px] font-bold text-center">
            {systemStats.outsDistribution.map(item => {
              const total = systemStats.outsDistribution.reduce((sum, i) => sum + i.cnt, 0);
              const percentage = total > 0 ? (item.cnt / total) * 100 : 0;
              if (percentage <= 0) return null;
              
              // Colors based on out count severity
              const colors = ['bg-indigo-600/75', 'bg-yellow-600/75', 'bg-orange-600/75', 'bg-rose-600/75'];
              const label = item.outs === 3 ? 'Locked' : `${item.outs} Out`;
              
              return (
                <div 
                  key={item.outs} 
                  style={{ width: `${percentage}%` }} 
                  className={`${colors[item.outs] || 'bg-gray-600'} text-white flex items-center justify-center truncate px-0.5`}
                  title={`${label}: ${item.cnt} users (${percentage.toFixed(1)}%)`}
                >
                  {percentage > 12 && `${label} (${percentage.toFixed(0)}%)`}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Project Selector */}
      <div className="mb-4 flex-shrink-0">
        <label className="text-[9px] text-gray-500 font-bold uppercase tracking-widest block mb-1">
          {lang === 'ja' ? '分析対象プロジェクト' : 'Select Target Project'}
        </label>
        <select
          value={selectedThreadId}
          onChange={(e) => {
            setSelectedThreadId(e.target.value);
            setSelectedGenIndex(0);
          }}
          className="w-full px-3 py-2 bg-black/80 border border-gray-900 focus:border-purple-500/50 rounded-xl text-xs text-gray-200 focus:outline-none transition-colors"
        >
          {threads.map(t => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.type === 'line' ? (lang === 'ja' ? 'ライン' : 'Line') : (lang === 'ja' ? 'モザイク' : 'Mosaic')}) - {t.current_generation}世代
            </option>
          ))}
        </select>
      </div>

      {loading && !selectedThreadStats && (
        <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
          <RefreshCw className="w-6 h-6 text-purple-500 animate-spin" />
          <p className="text-[10px] text-gray-500 tracking-wider">LOADING D1 METRICS...</p>
        </div>
      )}

      {selectedThreadStats && (
        <div className="space-y-4 flex-1 min-h-0">

          {/* Restored SPECIMEN IMAGE Panel */}
          {restoredDna && currentThread && (
            <div className="p-3.5 bg-black/40 border border-purple-500/10 rounded-3xl flex flex-col items-center gap-3 relative overflow-hidden flex-shrink-0">
              <div className="absolute top-0 right-0 p-2 text-[7px] text-purple-400 font-extrabold uppercase tracking-widest flex items-center gap-1 bg-purple-950/20 rounded-bl-xl border-l border-b border-purple-500/10">
                <Eye className="w-2.5 h-2.5" />
                {lang === 'ja' ? 'DNA復元プレビュー' : 'Restored DNA Preview'}
              </div>

              <div className="w-[160px] aspect-square rounded-2xl overflow-hidden border border-gray-900 bg-gray-950 relative shadow-inner">
                {currentThread.type === 'line' ? (
                  <LineCanvas dna={restoredDna as LineDNA} />
                ) : (
                  <MosaicCanvas dna={restoredDna as MosaicDNA} />
                )}
              </div>

              <div className="text-center w-full">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <span className="text-[10px] text-gray-500 font-extrabold uppercase tracking-wider">
                    {lang === 'ja' ? '表示中の世代' : 'Selected Generation'}:
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={currentGenerations.length - 1}
                    value={genInputText}
                    onChange={(e) => {
                      const text = e.target.value;
                      setGenInputText(text);
                      const val = parseInt(text);
                      if (!isNaN(val) && val >= 0 && val < currentGenerations.length) {
                        setSelectedGenIndex(val);
                      }
                    }}
                    className="w-12 text-center text-xs font-black text-purple-400 bg-black/50 border border-purple-500/35 py-0.5 rounded-lg focus:outline-none font-mono"
                  />
                  <span className="text-[9px] text-gray-600 font-mono">/ {currentGenerations.length - 1}</span>
                </div>

                <div className="flex justify-center items-center gap-4 mt-2 text-[9px] font-mono text-gray-400">
                  <span>Fitness: <b className="text-purple-300">{(selectedGenData?.likeRate * 100).toFixed(1)}%</b></span>
                  <span>Diversity: <b className="text-indigo-300">{selectedGenData?.dnaVariance.toFixed(5)}</b></span>
                </div>
              </div>
            </div>
          )}

          {/* Interactive SVG Charts Container */}
          <div className="space-y-4">
            
            {/* Chart 1: Fitness / Like Rate */}
            <div className="p-3 bg-[#0a0b10]/60 border border-gray-900 rounded-2xl">
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[8.5px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-purple-400" />
                  {lang === 'ja' ? '生存率 (適応度) の推移' : 'Survival Rate (Fitness)'}
                </span>
                <span className="text-[7.5px] text-gray-600 font-mono">G0〜G{currentGenerations.length - 1}</span>
              </div>
              <div className="w-full flex items-center justify-center p-1 bg-black/40 border border-gray-950 rounded-xl overflow-hidden">
                {currentGenerations.length > 0 ? (
                  renderSVGChart(
                    currentGenerations.map(g => g.likeRate),
                    '#a855f7',
                    'like',
                    maxLikeRate
                  )
                ) : (
                  <div className="py-10 text-[9px] text-gray-600 font-mono">No generational history yet</div>
                )}
              </div>
            </div>

            {/* Chart 2: Genetic Diversity / Variance */}
            <div className="p-3 bg-[#0a0b10]/60 border border-gray-900 rounded-2xl">
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[8.5px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-1">
                  <LineChart className="w-3 h-3 text-indigo-400" />
                  {lang === 'ja' ? '遺伝子多様性 (パラメータ分散) の推移' : 'Genetic Diversity (Variance)'}
                </span>
                <span className="text-[7.5px] text-gray-600 font-mono">G0〜G{currentGenerations.length - 1}</span>
              </div>
              <div className="w-full flex items-center justify-center p-1 bg-black/40 border border-gray-950 rounded-xl overflow-hidden">
                {currentGenerations.length > 0 ? (
                  renderSVGChart(
                    currentGenerations.map(g => g.dnaVariance),
                    '#6366f1',
                    'variance',
                    maxVariance
                  )
                ) : (
                  <div className="py-10 text-[9px] text-gray-600 font-mono">No generational history yet</div>
                )}
              </div>
            </div>

            {/* Chart 3: DNA Mean / Evolution Direction */}
            <div className="p-3 bg-[#0a0b10]/60 border border-gray-900 rounded-2xl">
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[8.5px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-1">
                  <BarChart2 className="w-3 h-3 text-amber-400" />
                  {lang === 'ja' ? '進化の方向性 (パラメータ平均値) の推移' : 'Evolution Direction (Parameter Mean)'}
                </span>
                <span className="text-[7.5px] text-gray-600 font-mono">G0〜G{currentGenerations.length - 1}</span>
              </div>
              <div className="w-full flex items-center justify-center p-1 bg-black/40 border border-gray-950 rounded-xl overflow-hidden">
                {currentGenerations.length > 0 ? (
                  renderSVGChart(
                    currentGenerations.map(g => g.dnaMean),
                    '#f59e0b',
                    'mean',
                    maxMean
                  )
                ) : (
                  <div className="py-10 text-[9px] text-gray-600 font-mono">No generational history yet</div>
                )}
              </div>
            </div>

            {/* Chart 4: Total Swipe Count per Generation */}
            <div className="p-3 bg-[#0a0b10]/60 border border-gray-900 rounded-2xl">
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[8.5px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-emerald-400" />
                  {lang === 'ja' ? '世代別の総スワイプ評価数' : 'Swipes Count (Selection Pressure)'}
                </span>
                <span className="text-[7.5px] text-gray-600 font-mono">G0〜G{currentGenerations.length - 1}</span>
              </div>
              <div className="w-full flex items-center justify-center p-1 bg-black/40 border border-gray-950 rounded-xl overflow-hidden">
                {currentGenerations.length > 0 ? (
                  renderSVGChart(
                    currentGenerations.map(g => g.totalVotes),
                    '#10b981',
                    'votes',
                    maxVotes
                  )
                ) : (
                  <div className="py-10 text-[9px] text-gray-600 font-mono">No generational history yet</div>
                )}
              </div>
            </div>

          </div>

          {/* Data Grid & Export Action */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1 flex-shrink-0">
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest flex items-center gap-1">
                <Database className="w-3 h-3 text-emerald-400" />
                {lang === 'ja' ? '世代別詳細データ' : 'Detailed Data Grid'}
              </span>
              <button
                onClick={exportToCSV}
                className="py-1 px-2.5 rounded-lg border border-emerald-500/20 bg-emerald-950/15 text-emerald-400 hover:bg-emerald-950/30 hover:border-emerald-500/40 text-[9px] font-bold transition-all flex items-center gap-1 active:scale-95 animate-pulse"
              >
                <Download className="w-3 h-3" />
                {lang === 'ja' ? 'CSVエクスポート' : 'Export CSV'}
              </button>
            </div>

            {/* Scrollable Data Table */}
            <div className="border border-gray-900 rounded-xl overflow-hidden bg-black/20 max-h-[140px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-[9px]">
                <thead className="bg-[#050609] text-gray-500 uppercase font-black font-mono border-b border-gray-900 tracking-wider">
                  <tr>
                    <th className="py-1.5 px-2.5">Gen</th>
                    <th className="py-1.5 px-2">Votes</th>
                    <th className="py-1.5 px-2">Like Rate</th>
                    <th className="py-1.5 px-2">Mean</th>
                    <th className="py-1.5 px-2 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-950 font-medium font-mono text-gray-300">
                  {currentGenerations.map((g, idx) => {
                    const isSelected = idx === selectedGenIndex;
                    return (
                      <tr 
                        key={g.generation} 
                        className={`hover:bg-purple-950/10 cursor-pointer transition-colors ${
                          isSelected ? 'bg-purple-950/20 text-purple-200 font-bold border-l-2 border-purple-500' : ''
                        }`}
                        onClick={() => setSelectedGenIndex(idx)}
                      >
                        <td className="py-1.5 px-2.5 font-bold">G{g.generation}</td>
                        <td className="py-1.5 px-2 text-gray-500">{g.totalVotes}</td>
                        <td className="py-1.5 px-2 text-purple-300">{(g.likeRate * 100).toFixed(1)}%</td>
                        <td className="py-1.5 px-2 text-amber-300">{g.dnaMean.toFixed(3)}</td>
                        <td className="py-1.5 px-2 text-right text-indigo-300">{g.dnaVariance.toFixed(5)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
