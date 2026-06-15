import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Sparkles, RefreshCw, ShieldAlert, Plus, X, Star, Trash2, ShoppingCart, List, Diamond, Download, GitFork } from 'lucide-react';
import type { LineDNA, MosaicDNA } from '../../backend/src/shared-types';
import { SwipeCard } from './components/SwipeCard';
import { LineCanvas } from './components/LineCanvas';
import { MosaicCanvas } from './components/MosaicCanvas';

// Configure worker backend API base url (we can use local wrangler in dev)
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8787'
  : `http://${window.location.hostname}:8787`;

// Obfuscation and Cryptographic Checksum Helpers to Prevent DevTools Cheating
const OBFS_KEY = 0xAF;
const SIGNATURE_SALT = 'project-x-stamina-integrity-salt-42f8e1';

const calculateStaminaChecksum = (
  stamina: number,
  maxStamina: number,
  lifetimeSwipes: number,
  lastRecovery: number,
  souls: number,
  isAdFree: boolean
): string => {
  const payload = `${stamina}:${maxStamina}:${lifetimeSwipes}:${lastRecovery}:${souls}:${isAdFree ? 1 : 0}:${SIGNATURE_SALT}`;
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) + hash) + payload.charCodeAt(i);
  }
  return hash.toString(16);
};

const serializeAndSign = (data: {
  stamina: number;
  maxStamina: number;
  lifetimeSwipes: number;
  lastRecoveryTime: number;
  souls: number;
  isAdFree: boolean;
}): string => {
  const checksum = calculateStaminaChecksum(
    data.stamina,
    data.maxStamina,
    data.lifetimeSwipes,
    data.lastRecoveryTime,
    data.souls,
    data.isAdFree
  );
  
  const envelope = { ...data, checksum };
  const rawString = JSON.stringify(envelope);
  
  let xored = '';
  for (let i = 0; i < rawString.length; i++) {
    xored += String.fromCharCode(rawString.charCodeAt(i) ^ OBFS_KEY);
  }
  
  return btoa(xored);
};

const verifyAndDeserialize = (
  encoded: string
): {
  stamina: number;
  maxStamina: number;
  lifetimeSwipes: number;
  lastRecoveryTime: number;
  souls: number;
  isAdFree: boolean;
} | null => {
  try {
    const rawXored = atob(encoded);
    let decoded = '';
    for (let i = 0; i < rawXored.length; i++) {
      decoded += String.fromCharCode(rawXored.charCodeAt(i) ^ OBFS_KEY);
    }
    
    const parsed = JSON.parse(decoded);
    const isAdFree = typeof parsed.isAdFree === 'boolean' ? parsed.isAdFree : false;
    if (
      typeof parsed.stamina !== 'number' ||
      typeof parsed.maxStamina !== 'number' ||
      typeof parsed.lifetimeSwipes !== 'number' ||
      typeof parsed.lastRecoveryTime !== 'number' ||
      typeof parsed.souls !== 'number' ||
      typeof parsed.checksum !== 'string'
    ) {
      return null;
    }
    
    const calculatedChecksum = calculateStaminaChecksum(
      parsed.stamina,
      parsed.maxStamina,
      parsed.lifetimeSwipes,
      parsed.lastRecoveryTime,
      parsed.souls,
      isAdFree
    );
    
    if (calculatedChecksum !== parsed.checksum) {
      console.warn('Stamina integrity verification failed! Signature mismatch.');
      return null;
    }
    
    return {
      stamina: parsed.stamina,
      maxStamina: parsed.maxStamina,
      lifetimeSwipes: parsed.lifetimeSwipes,
      lastRecoveryTime: parsed.lastRecoveryTime,
      souls: parsed.souls,
      isAdFree
    };
  } catch (e) {
    // If it's invalid base64 (e.g. legacy plain JSON), catch it cleanly
    return null;
  }
};

interface CardData {
  id: string;
  generation: number;
  dna: LineDNA | MosaicDNA;
}

interface Thread {
  id: string;
  name: string;
  type: 'line' | 'mosaic';
  generation: number;
  creator_session_id?: string | null;
}

interface SpecimenData {
  id: string;
  generation: number;
  dna: LineDNA | MosaicDNA;
  likes_count: number;
  nopes_count: number;
}

function safeUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default function App() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const [cards, setCards] = useState<CardData[]>([]);
  const swipedCardIdsRef = useRef<string[]>([]);
  const generationRef = useRef<number>(0);
  const [generation, setGeneration] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>(undefined);

  const [message, setMessage] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);

  // Thread Creation State
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newThreadName, setNewThreadName] = useState<string>('');
  const [newThreadType, setNewThreadType] = useState<'line' | 'mosaic'>('line');
  const [creatingThread, setCreatingThread] = useState<boolean>(false);

  // History Gallery State
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [historySpecimens, setHistorySpecimens] = useState<SpecimenData[]>([]);
  const [galleryLoading, setGalleryLoading] = useState<boolean>(false);

  // App View State ('swipe' for swiping cards, 'threads' for threads explorer)
  const [view, setView] = useState<'swipe' | 'threads'>('swipe');
  // Explorer Tab State ('all' for all threads, 'saved' for bookmarked ones)
  const [threadsTab, setThreadsTab] = useState<'all' | 'saved'>('all');
  const [savedThreadIds, setSavedThreadIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('project_x_saved_thread_ids');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Card Detail Modal State
  const [selectedCard, setSelectedCard] = useState<(CardData & { threadId?: string; threadName?: string; type?: 'line' | 'mosaic' }) | null>(null);
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);
  const [savedSubTab, setSavedSubTab] = useState<'threads' | 'cards'>('threads');

  // Fork inline thread creation name
  const [forkThreadName, setForkThreadName] = useState<string>('');
  const [isForking, setIsForking] = useState<boolean>(false);
  const [forkingMode, setForkingMode] = useState<boolean>(false);

  // Saved Cards / Bookmarked DNA images
  interface SavedCard {
    id: string;
    threadId: string;
    threadName: string;
    generation: number;
    dna: any;
    type: 'line' | 'mosaic';
    savedAt: number;
  }
  const [savedCards, setSavedCards] = useState<SavedCard[]>(() => {
    try {
      const saved = localStorage.getItem('project_x_saved_cards');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load saved cards:', e);
      return [];
    }
  });

  // PWA installation states
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isPwaInstalled, setIsPwaInstalled] = useState<boolean>(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setIsPwaInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Stamina State (Persistent in LocalStorage, Signed & Obfuscated, Initial limit = 80)
  const [staminaData, setStaminaData] = useState<{
    stamina: number;
    maxStamina: number;
    lifetimeSwipes: number;
    lastRecoveryTime: number;
    souls: number;
    isAdFree: boolean;
  }>(() => {
    try {
      const saved = localStorage.getItem('project_x_stamina_data');
      if (saved) {
        const verified = verifyAndDeserialize(saved);
        if (verified) {
          return verified;
        } else {
          console.warn('Stamina integrity check failed. Resets to default values.');
        }
      }
    } catch (e) {
      console.error('Failed to load stamina data:', e);
    }
    return {
      stamina: 80,
      maxStamina: 80,
      lifetimeSwipes: 0,
      lastRecoveryTime: Date.now(),
      souls: 0,
      isAdFree: false
    };
  });

  // Swipe Onboarding Guide State (shown automatically to users with 0 swipes)
  const [showSwipeGuide, setShowSwipeGuide] = useState<boolean>(staminaData.lifetimeSwipes === 0);



  const [nextRecoverySeconds, setNextRecoverySeconds] = useState<number>(0);
  const [showShopModal, setShowShopModal] = useState<boolean>(false);

  // Stamina Recovery Hook (60 seconds per stamina recovery)
  useEffect(() => {
    const RECOVERY_INTERVAL = 60000; // 60 seconds
    
    const interval = setInterval(() => {
      setStaminaData(prev => {
        const now = Date.now();
        if (prev.stamina >= prev.maxStamina) {
          if (prev.lastRecoveryTime !== now) {
            const nextData = { ...prev, lastRecoveryTime: now };
            localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
            return nextData;
          }
          return prev;
        }

        const elapsed = now - prev.lastRecoveryTime;
        if (elapsed >= RECOVERY_INTERVAL) {
          const pointsToAdd = Math.floor(elapsed / RECOVERY_INTERVAL);
          const newStamina = Math.min(prev.maxStamina, prev.stamina + pointsToAdd);
          const newLastRecoveryTime = now - (elapsed % RECOVERY_INTERVAL);
          const nextData = {
            ...prev,
            stamina: newStamina,
            lastRecoveryTime: newLastRecoveryTime
          };
          localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
          return nextData;
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Countdown timer for next recovery (60 seconds interval)
  useEffect(() => {
    const RECOVERY_INTERVAL = 60000;
    const interval = setInterval(() => {
      if (staminaData.stamina >= staminaData.maxStamina) {
        setNextRecoverySeconds(0);
        return;
      }
      const elapsed = Date.now() - staminaData.lastRecoveryTime;
      const secondsLeft = Math.max(0, Math.ceil((RECOVERY_INTERVAL - elapsed) / 1000));
      setNextRecoverySeconds(secondsLeft);
    }, 200);

    return () => clearInterval(interval);
  }, [staminaData.stamina, staminaData.maxStamina, staminaData.lastRecoveryTime]);

  const handleSwipeStateUpdate = () => {
    setStaminaData(prev => {
      const nextSwipes = prev.lifetimeSwipes + 1;
      const nextSouls = prev.souls + 1;
      const newStamina = Math.max(0, prev.stamina - 1);
      
      const nextData = {
        ...prev,
        stamina: newStamina,
        lifetimeSwipes: nextSwipes,
        souls: nextSouls,
        lastRecoveryTime: prev.stamina >= prev.maxStamina ? Date.now() : prev.lastRecoveryTime
      };

      localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
      return nextData;
    });
  };

  const buyStaminaRecovery = () => {
    setStaminaData(prev => {
      if (prev.souls < 50) {
        showMsg('Soulが足りません！', 'error');
        return prev;
      }
      if (prev.stamina >= prev.maxStamina) {
        showMsg('すでにスタミナは満タンです！', 'error');
        return prev;
      }
      const newStamina = Math.min(prev.maxStamina, prev.stamina + 10);
      const nextData = {
        ...prev,
        stamina: newStamina,
        souls: prev.souls - 50
      };
      localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
      showMsg('スタミナを10回復しました！', 'success');
      return nextData;
    });
  };

  const buyMaxStaminaUpgrade = () => {
    setStaminaData(prev => {
      if (prev.souls < 100) {
        showMsg('Soulが足りません！', 'error');
        return prev;
      }
      const newMax = prev.maxStamina + 5;
      const newStamina = prev.stamina + 5; // Also increase current stamina by 5
      const nextData = {
        ...prev,
        stamina: newStamina,
        maxStamina: newMax,
        souls: prev.souls - 100
      };
      localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
      showMsg(`スタミナ上限が ${newMax} にアップしました！`, 'success');
      return nextData;
    });
  };

  const buyAdFreePass = () => {
    setStaminaData(prev => {
      if (prev.souls < 150) {
        showMsg('Soulが足りません！', 'error');
        return prev;
      }
      if (prev.isAdFree) {
        showMsg('すでに広告非表示パスを購入済みです！', 'error');
        return prev;
      }
      const nextData = {
        ...prev,
        isAdFree: true,
        souls: prev.souls - 150
      };
      localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
      showMsg('🎉 広告非表示パスを購入しました！広告が非表示になりました。', 'success');
      return nextData;
    });
  };

  // Initialize Session ID
  const [sessionId] = useState<string>(() => {
    let id = localStorage.getItem('project_x_session_id');
    if (!id) {
      id = safeUUID();
      localStorage.setItem('project_x_session_id', id);
    }
    return id;
  });

  // Derive mode from active thread
  const activeThread = threads.find(t => t.id === activeThreadId);
  const mode = activeThread?.type || 'line';

  // Toggle Save/Favorite status of a thread
  const toggleSaveThread = (threadId: string) => {
    setSavedThreadIds(prev => {
      const next = prev.includes(threadId) ? prev.filter(id => id !== threadId) : [...prev, threadId];
      localStorage.setItem('project_x_saved_thread_ids', JSON.stringify(next));
      return next;
    });
  };

  // Fetch threads list
  const fetchThreads = useCallback(async (selectThreadId?: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/threads`);
      const data = await res.json();
      if (data.threads) {
        setThreads(data.threads);
        if (data.threads.length > 0) {
          if (selectThreadId) {
            setActiveThreadId(selectThreadId);
          } else if (!activeThreadId) {
            setActiveThreadId(data.threads[0].id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch threads:', err);
      showMsg('Failed to load threads from server.', 'error');
    }
  }, [activeThreadId]);

  useEffect(() => {
    fetchThreads();
  }, []);

  // Fetch Evolutionary History
  const fetchHistory = useCallback(async () => {
    if (!activeThreadId) return;
    setGalleryLoading(true);
    try {
      const historyRes = await fetch(`${API_BASE}/api/threads/history?thread_id=${activeThreadId}`);
      const historyData = await historyRes.json();
      if (historyData.history) setHistorySpecimens(historyData.history);
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setGalleryLoading(false);
    }
  }, [activeThreadId]);

  const fetchCards = useCallback(async (append = false, currentDeckIds?: string[], lastSwipedCardId?: string) => {
    if (!activeThreadId) return;
    try {
      if (!append) setLoading(true);
      
      const deckIds = currentDeckIds ?? [];
      const excludeIds = Array.from(new Set([...swipedCardIdsRef.current, ...deckIds]));
      const excludeParam = excludeIds.length > 0 ? `&exclude=${excludeIds.join(',')}` : '';
      const lastSwipedParam = lastSwipedCardId ? `&last_swiped_card_id=${lastSwipedCardId}` : '';

      const res = await fetch(`${API_BASE}/api/cards?thread_id=${activeThreadId}&session_id=${sessionId}${excludeParam}${lastSwipedParam}`, {
        headers: {
          'x-session-id': sessionId
        }
      });
      const data = await res.json();
      
      if (data.cards) {
        setCards(prev => append ? [...data.cards, ...prev] : data.cards);
        
        // Update generation in local threads state
        setThreads(prev => prev.map(t => t.id === activeThreadId ? { ...t, generation: data.generation } : t));
        
        if (data.generation !== generationRef.current) {
          swipedCardIdsRef.current = [];
          if (append) {
            showMsg(`All specimens swiped! Auto-evolved to Gen ${data.generation}`, 'success');
          }
        }
        setGeneration(data.generation);
        generationRef.current = data.generation;
      }
    } catch (err) {
      console.error('Failed to fetch cards:', err);
      showMsg('Failed to fetch cards from server. Is Wrangler running?', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeThreadId, sessionId]);

  // Load cards and history on activeThreadId change
  useEffect(() => {
    setCards([]); // Clear cards immediately
    swipedCardIdsRef.current = []; // Reset swiped history
    if (activeThreadId) {
      fetchCards(false);
      fetchHistory();
    }
  }, [activeThreadId, fetchCards, fetchHistory]);

  // Cloudflare Turnstile Injection
  useEffect(() => {
    setTurnstileToken(undefined);
    const container = document.getElementById('turnstile-container');
    if (container) container.innerHTML = '';

    if (!document.getElementById('cf-turnstile-script')) {
      const script = document.createElement('script');
      script.id = 'cf-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }

    let attempts = 0;
    const checkAndRender = () => {
      attempts++;
      if (attempts > 30) {
        console.warn('Turnstile script load timed out. Continuing without Turnstile widget.');
        return;
      }

      if ((window as any).turnstile && document.getElementById('turnstile-container')) {
        try {
          (window as any).turnstile.render('#turnstile-container', {
            sitekey: '10000000-aaaa-bbbb-cccc-000000000001', // Cloudflare local testing key
            callback: (token: string) => {
              setTurnstileToken(token);
            },
            'expired-callback': () => {
              setTurnstileToken(undefined);
            },
            'error-callback': () => {
              setTurnstileToken(undefined);
            }
          });
        } catch (e) {
          console.error('Turnstile render error', e);
        }
      } else {
        setTimeout(checkAndRender, 200);
      }
    };

    checkAndRender();
  }, [activeThreadId]);

  // Helper for messages
  const showMsg = (text: string, type: 'info' | 'error' | 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  // Submit Swipe to API
  const submitSwipe = async (cardId: string, swipe: 'like' | 'nope') => {
    if (!activeThreadId) return;
    try {
      const response = await fetch(`${API_BASE}/api/swipe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          thread_id: activeThreadId,
          card_id: cardId,
          swipe,
          session_id: sessionId,
          turnstile_token: turnstileToken
        })
      });

      const result = await response.json();
      if (result.error) {
        showMsg(result.error, 'error');
      } else {
        fetchHistory();
      }
    } catch (err) {
      console.error('Failed to submit swipe:', err);
    }
  };

  // Handle Swipe interaction
  const handleSwipe = (direction: 'like' | 'nope', cardId: string) => {
    if (staminaData.stamina <= 0) {
      showMsg('スタミナがありません！', 'error');
      return;
    }
    if (showSwipeGuide) {
      setShowSwipeGuide(false);
      showMsg('進化の旅へようこそ！', 'success');
    }
    submitSwipe(cardId, direction);
    swipedCardIdsRef.current.push(cardId);
    handleSwipeStateUpdate();

    setCards(prev => {
      const nextCards = prev.filter(c => c.id !== cardId);
      if (nextCards.length < 5) {
        fetchCards(true, nextCards.map(c => c.id), cardId);
      }
      return nextCards;
    });
  };

  // Create Thread API Call
  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newThreadName.trim()) {
      showMsg('Thread name is required', 'error');
      return;
    }

    const cost = newThreadType === 'line' ? 100 : 200;
    if (staminaData.souls < cost) {
      showMsg(`Soulが足りません！作成には ${cost} Soulが必要です。（現在: ${staminaData.souls} Soul）`, 'error');
      return;
    }

    setCreatingThread(true);
    try {
      const res = await fetch(`${API_BASE}/api/threads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId
        },
        body: JSON.stringify({
          name: newThreadName,
          type: newThreadType
        })
      });
      const data = await res.json();
      if (data.error) {
        showMsg(data.error, 'error');
      } else if (data.success && data.thread) {
        // Subtract Souls upon success
        setStaminaData(prev => {
          const nextData = {
            ...prev,
            souls: prev.souls - cost
          };
          localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
          return nextData;
        });

        showMsg(`プロジェクト「${data.thread.name}」を作成しました！（コスト: ${cost} Soul）`, 'success');
        setNewThreadName('');
        setShowCreateModal(false);
        await fetchThreads(data.thread.id);
      }
    } catch (err) {
      console.error(err);
      showMsg('Failed to create thread.', 'error');
    } finally {
      setCreatingThread(false);
    }
  };

  const downloadCardAsPNG = (card: CardData, type: 'line' | 'mosaic') => {
    const canvas = document.createElement('canvas');
    const isActiveFirstCard = staminaData.lifetimeSwipes === 0 && card.id === cards[cards.length - 1]?.id;

    if (isActiveFirstCard) {
      canvas.width = 800;
      canvas.height = 800;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(156, 163, 175, 0.6)';
      ctx.font = 'bold 120px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TEST', canvas.width / 2, canvas.height / 2);
    } else if (type === 'line') {
      canvas.width = 800;
      canvas.height = 800;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      const dna = card.dna as LineDNA;
      dna.forEach(gene => {
        ctx.beginPath();
        const sx = gene.sx * canvas.width;
        const sy = gene.sy * canvas.height;
        const cp1x = gene.cp1x * canvas.width;
        const cp1y = gene.cp1y * canvas.height;
        const cp2x = gene.cp2x * canvas.width;
        const cp2y = gene.cp2y * canvas.height;
        const ex = gene.ex * canvas.width;
        const ey = gene.ey * canvas.height;
        ctx.lineWidth = gene.width * 20; // Thicker for higher res
        ctx.strokeStyle = gene.color;
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
        ctx.stroke();
      });
    } else {
      const size = 256;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dna = card.dna as MosaicDNA;
      if (dna.length === 0) {
        // Honeypot sandstorm
        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const val = Math.random() > 0.5 ? 255 : 0;
          data[i] = val;
          data[i + 1] = val;
          data[i + 2] = val;
          data[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
      } else {
        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;
        const outputs = new Float32Array(4 + dna.length);
        const halfSize = size / 2;
        const div = halfSize - 0.5;

        for (let py = 0; py < size; py++) {
          const y = py / div - 1.0;
          for (let px = 0; px < size; px++) {
            const x = px / div - 1.0;
            const d = Math.sqrt(x * x + y * y);

            outputs[0] = x;
            outputs[1] = y;
            outputs[2] = d;
            outputs[3] = 1.0;

            for (let i = 0; i < dna.length; i++) {
              const node = dna[i];
              const val1 = outputs[node.in1];
              const val2 = outputs[node.in2];
              const sum = val1 * node.w1 + val2 * node.w2;

              let out = sum;
              switch (node.fn) {
                case 0: out = Math.sin(sum); break;
                case 1: out = Math.cos(sum); break;
                case 2: out = Math.tanh(sum); break;
                case 3: out = Math.abs(sum); break;
                case 4: out = sum * sum; break;
                case 5: out = Math.exp(-sum * sum); break;
                case 6: out = sum > 0 ? 1.0 : -1.0; break;
                case 7: out = Math.max(-1.0, Math.min(1.0, sum)); break;
              }
              outputs[4 + i] = out;
            }

            const outR = outputs[outputs.length - 3];
            const outG = outputs[outputs.length - 2];
            const outB = outputs[outputs.length - 1];

            const r = Math.floor(Math.max(-1.0, Math.min(1.0, outR)) * 127.5 + 127.5);
            const g = Math.floor(Math.max(-1.0, Math.min(1.0, outG)) * 127.5 + 127.5);
            const b = Math.floor(Math.max(-1.0, Math.min(1.0, outB)) * 127.5 + 127.5);

            const pIdx = (py * size + px) * 4;
            data[pIdx] = r;
            data[pIdx + 1] = g;
            data[pIdx + 2] = b;
            data[pIdx + 3] = 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);
      }
    }

    // Trigger download
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `heredity-${type}-${card.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showMsg('画像をダウンロードしました！', 'success');
  };

  const toggleSaveCard = (card: CardData & { threadId?: string; threadName?: string; type?: 'line' | 'mosaic' }) => {
    const isAlreadySaved = savedCards.some(c => c.id === card.id);
    let updatedCards: SavedCard[] = [];
    if (isAlreadySaved) {
      updatedCards = savedCards.filter(c => c.id !== card.id);
      showMsg('画像をコレクションから削除しました。', 'info');
    } else {
      const newSavedCard: SavedCard = {
        id: card.id,
        threadId: card.threadId || activeThreadId || '',
        threadName: card.threadName || activeThread?.name || 'Unknown',
        generation: card.generation,
        dna: card.dna,
        type: card.type || (mode as 'line' | 'mosaic'),
        savedAt: Date.now()
      };
      updatedCards = [newSavedCard, ...savedCards];
      showMsg('画像をコレクションに保存しました！', 'success');
    }
    setSavedCards(updatedCards);
    localStorage.setItem('project_x_saved_cards', JSON.stringify(updatedCards));
  };

  const handleForkThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard) return;
    if (!forkThreadName.trim()) {
      showMsg('プロジェクト名は必須です', 'error');
      return;
    }
    const cost = 500;
    if (staminaData.souls < cost) {
      showMsg(`Soulが足りません！作成には ${cost} Soulが必要です。`, 'error');
      return;
    }

    setIsForking(true);
    try {
      const res = await fetch(`${API_BASE}/api/threads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId
        },
        body: JSON.stringify({
          name: forkThreadName,
          type: selectedCard.type || mode,
          fork_dna: selectedCard.dna
        })
      });
      const data = await res.json();
      if (data.error) {
        showMsg(data.error, 'error');
      } else if (data.success && data.thread) {
        // Deduct 500 Souls
        setStaminaData(prev => {
          const nextData = {
            ...prev,
            souls: prev.souls - cost
          };
          localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
          return nextData;
        });

        showMsg(`分岐プロジェクト「${data.thread.name}」を作成しました！（コスト: ${cost} Soul）`, 'success');
        setForkThreadName('');
        setForkingMode(false);
        setShowDetailModal(false);
        await fetchThreads(data.thread.id);
      }
    } catch (err) {
      console.error(err);
      showMsg('Failed to create thread.', 'error');
    } finally {
      setIsForking(false);
    }
  };

  const handleInstallPwa = async () => {
    if (!deferredPrompt) {
      alert("iOS (Safari) の場合は、ブラウザ下部の共有アイコン（スクエアに上矢印）をタップし、「ホーム画面に追加」を選択してください。\n\nAndroid/Chrome等の場合は、すでにインストールされているか、ブラウザメニューからインストールできます。");
      return;
    }
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`PWA install prompt choice: ${outcome}`);
      setDeferredPrompt(null);
    } catch (e) {
      console.error('PWA install error:', e);
    }
  };

  // Delete Thread API Call
  const handleDeleteThread = async (threadId: string) => {
    const thread = threads.find(t => t.id === threadId);
    if (!thread) return;
    if (!window.confirm(`本当にプロジェクト「${thread.name}」を削除しますか？\n（この操作は取り消せません）`)) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/threads/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          thread_id: threadId,
          session_id: sessionId
        })
      });
      const data = await res.json();
      if (data.error) {
        showMsg(data.error, 'error');
      } else if (data.success) {
        showMsg(`プロジェクト「${thread.name}」を削除しました。`, 'success');
        
        // Remove from saved threads if it was saved
        setSavedThreadIds(prev => {
          const next = prev.filter(id => id !== threadId);
          localStorage.setItem('project_x_saved_thread_ids', JSON.stringify(next));
          return next;
        });

        // Determine next active thread if the deleted one was active
        let nextActiveId = activeThreadId;
        if (activeThreadId === threadId) {
          const remainingThreads = threads.filter(t => t.id !== threadId);
          nextActiveId = remainingThreads.length > 0 ? remainingThreads[0].id : null;
        }

        // Fetch threads list
        await fetchThreads(nextActiveId || undefined);
      }
    } catch (err) {
      console.error(err);
      showMsg('プロジェクトの削除に失敗しました。', 'error');
    }
  };



  return (
    <div className="h-[100dvh] bg-[#07080d] text-gray-100 flex flex-col items-center justify-between font-sans selection:bg-purple-600 selection:text-white relative overflow-hidden pb-2 sm:pb-3 md:pb-4">
      
      {/* Background Gradients */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-purple-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-emerald-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute top-[40%] left-[30%] w-[40%] h-[40%] rounded-full bg-indigo-900/10 blur-[150px] pointer-events-none" />

      {/* Header */}
      <header className="w-full max-w-lg px-6 pt-3 sm:pt-4 flex-shrink-0 flex flex-col items-center gap-4 z-20">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 shadow-lg shadow-indigo-600/30">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-300 to-gray-500 tracking-wider">GeneX</h1>
          </div>
          
          <div className="flex items-center gap-5">
            {/* Shop Button */}
            <button
              onClick={() => setShowShopModal(true)}
              className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-purple-400 transition-colors"
              title="Shop"
            >
              <span className="text-[7px] font-bold text-gray-600 uppercase tracking-widest">Shop</span>
              <ShoppingCart className="w-5 h-5 text-purple-400 hover:scale-110 transition-transform" />
            </button>

            {/* Project List Button */}
            <button
              onClick={() => {
                if (view === 'threads' && threadsTab === 'all') {
                  setView('swipe');
                } else {
                  setView('threads');
                  setThreadsTab('all');
                }
              }}
              className={`flex flex-col items-center gap-0.5 transition-colors ${
                view === 'threads' && threadsTab === 'all'
                  ? 'text-purple-400'
                  : 'text-gray-400 hover:text-purple-400'
              }`}
              title="Project"
            >
              <span className="text-[7px] font-bold text-gray-600 uppercase tracking-widest">Project</span>
              <List className="w-5 h-5" />
            </button>

            {/* Save Button */}
            <button
              onClick={() => {
                if (view === 'threads' && threadsTab === 'saved') {
                  setView('swipe');
                } else {
                  setView('threads');
                  setThreadsTab('saved');
                }
              }}
              className={`flex flex-col items-center gap-0.5 transition-colors ${
                view === 'threads' && threadsTab === 'saved'
                  ? 'text-purple-400 font-bold'
                  : 'text-gray-400 hover:text-purple-400'
              }`}
              title="Save"
            >
              <span className="text-[7px] font-bold text-gray-600 uppercase tracking-widest">Save</span>
              <Diamond className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-lg px-6 flex-1 flex flex-col items-center justify-center pt-1.5 sm:pt-4 md:pt-6 pb-0 z-10 min-h-0 overflow-hidden relative">
        
        {/* Floating Feedback Message Toast */}
        <AnimatePresence>
          {message && (
            <motion.div
              initial={{ opacity: 0, y: -20, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: -20, x: '-50%' }}
              className={`absolute top-4 left-1/2 z-50 px-4 py-2 rounded-xl text-xs font-bold shadow-2xl text-center whitespace-nowrap min-w-[200px] ${
                message.type === 'error' ? 'bg-rose-950/90 border border-rose-500/35 text-rose-300' :
                message.type === 'success' ? 'bg-emerald-950/90 border border-emerald-500/35 text-emerald-300' :
                'bg-gray-950/90 border border-gray-800 text-gray-300'
              }`}
            >
              {message.text}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {view === 'swipe' ? (
            <motion.div
              key="swipe"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="w-full flex flex-col items-center justify-center mt-2 sm:mt-3 md:mt-4"
            >
              {/* Project Name Selector Bar (Above Deck) */}
              {activeThread && (
                <div 
                  onClick={() => {
                    setView('threads');
                    setThreadsTab('all');
                  }}
                  className="w-full max-w-[380px] py-3 sm:py-4 md:py-5 px-[18px] bg-gray-950/60 border border-gray-900/60 hover:border-purple-500/30 rounded-2xl backdrop-blur-md mb-2 sm:mb-3 flex items-center justify-between cursor-pointer transition-all group"
                >
                  <span className="text-xs font-bold text-gray-200 group-hover:text-purple-300 transition-colors truncate">
                    {activeThread.name}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="px-2 py-0.5 text-[8px] rounded bg-purple-950/30 border border-purple-500/10 text-purple-300 font-medium">
                      {activeThread.type === 'line' ? 'ライン' : 'モザイク'}
                    </span>
                    <Diamond className="w-3.5 h-3.5 text-purple-400 group-hover:scale-110 transition-transform" />
                  </div>
                </div>
              )}

              {/* Swipe Hints Bar (Above Deck) */}
              {!loading && cards.length > 0 && staminaData.stamina > 0 && (
                <div className="w-full max-w-[380px] flex justify-between items-center px-4 mb-2 sm:mb-3 text-gray-500 font-bold uppercase tracking-wider select-none">
                  {/* Left Swipe Hint */}
                  <div className="flex items-center gap-1.5 opacity-60">
                    <span className="text-xs font-black animate-bounce-x">←</span>
                    <span className="font-extrabold text-[9px] tracking-widest">NOPE</span>
                  </div>

                  {/* Gene History Trigger Link (Center) */}
                  {activeThread && (
                    <button
                      onClick={() => {
                        fetchHistory();
                        setShowHistoryModal(true);
                      }}
                      className="text-[9px] text-gray-400 hover:text-purple-400 uppercase tracking-widest font-extrabold transition-colors py-1 px-2.5 bg-gray-950/40 border border-gray-900 rounded-lg backdrop-blur-sm shadow-md active:scale-95"
                    >
                      - gene history -
                    </button>
                  )}

                  {/* Right Swipe Hint */}
                  <div className="flex items-center gap-1.5 opacity-60">
                    <span className="font-extrabold text-[9px] tracking-widest">LIKE</span>
                    <span className="text-xs font-black animate-bounce-x-reverse">→</span>
                  </div>
                </div>
              )}

              {/* Deck Container */}
              <div className="relative w-full max-w-[min(380px,100dvh-280px)] aspect-square flex items-center justify-center mb-2 sm:mb-4 md:mb-5">
                {loading ? (
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                    <p className="text-gray-500 text-xs tracking-wider animate-pulse">LOADING SPECIMENS...</p>
                  </div>
                ) : cards.length === 0 ? (
                  <div className="text-center p-6 bg-gray-950/40 border border-gray-900 rounded-2xl flex flex-col items-center gap-3">
                    <ShieldAlert className="w-10 h-10 text-purple-400 opacity-60" />
                    <p className="text-gray-400 font-semibold text-sm">No specimens left</p>
                    <button 
                      onClick={() => {
                        swipedCardIdsRef.current = []; // Reset swiped history
                        fetchCards(false);
                      }}
                      className="px-4 py-2 text-xs font-semibold bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
                    >
                      Refresh Pool
                    </button>
                  </div>
                ) : staminaData.stamina <= 0 ? (
                  <div className="text-center p-6 bg-gray-950/40 border border-gray-900 rounded-2xl flex flex-col items-center justify-center gap-4 w-full h-full relative overflow-hidden">
                    <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-rose-950/20 blur-[50px] pointer-events-none" />
                    <div className="relative">
                      <Activity className="w-12 h-12 text-rose-500 animate-pulse" />
                      <div className="absolute inset-0 bg-rose-500/20 blur-xl rounded-full" />
                    </div>
                    <div>
                      <p className="text-rose-400 font-bold text-sm tracking-wider">スタミナ切れ</p>
                      <p className="text-gray-400 text-[10px] mt-1 uppercase tracking-wider">時間経過で徐々に回復します</p>
                    </div>
                    <div className="px-4 py-2 rounded-xl bg-gray-900 border border-gray-800 text-xs font-semibold text-gray-200">
                      回復まで: <span className="text-purple-400 font-bold">{nextRecoverySeconds}秒</span>
                    </div>
                    <div className="text-[9px] text-gray-500 uppercase tracking-widest font-semibold text-center mt-1 space-y-0.5">
                      <div>現在のスワイプ上限: <span className="text-gray-300 font-bold">{staminaData.maxStamina}</span></div>
                      <div>所持ソウル: <span className="text-yellow-300 font-bold">🔮 {staminaData.souls} Soul</span></div>
                    </div>
                    <button
                      onClick={() => setShowShopModal(true)}
                      className="px-4 py-2 text-xs font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg hover:from-purple-500 hover:to-indigo-500 text-white transition-colors shadow-md flex items-center gap-1 border border-purple-500/20"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-yellow-300 animate-pulse" />
                      ショップを開く
                    </button>

                    {/* PWA recommendation banner */}
                    {!isPwaInstalled && (
                      <div className="w-full max-w-[280px] mt-2 p-2.5 bg-indigo-950/20 border border-indigo-500/10 rounded-xl flex flex-col items-center gap-1.5 backdrop-blur-sm relative z-10">
                        <span className="text-[8px] uppercase tracking-widest text-indigo-400 font-extrabold flex items-center gap-1">
                          💡 アプリ（PWA）の追加
                        </span>
                        <p className="text-[9px] text-gray-400 text-center leading-relaxed font-medium">
                          忘れないようにホーム画面にアプリを追加しませんか？
                        </p>
                        <button
                          onClick={handleInstallPwa}
                          className="w-full mt-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold transition-all shadow-md active:scale-[0.98]"
                        >
                          {deferredPrompt ? 'アプリをインストール' : 'インストール方法を見る'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-full relative">
                    {cards.slice(-3).map((card, idx, arr) => {
                      const isActive = idx === arr.length - 1;
                      return (
                        <SwipeCard
                          key={card.id}
                          isActive={isActive}
                          onSwipe={(dir) => handleSwipe(dir, card.id)}
                          onTap={() => {
                            setSelectedCard({
                              ...card,
                              threadId: activeThreadId || undefined,
                              threadName: activeThread?.name,
                              type: mode
                            });
                            setForkingMode(false);
                            setForkThreadName('');
                            setShowDetailModal(true);
                          }}
                        >
                          {staminaData.lifetimeSwipes === 0 && isActive ? (
                            <div className="w-full h-full bg-white flex items-center justify-center">
                              <span className="text-4xl md:text-5xl font-light text-gray-400 font-sans tracking-widest select-none">
                                TEST
                              </span>
                            </div>
                          ) : mode === 'line' ? (
                            <LineCanvas 
                              dna={card.dna as LineDNA} 
                            />
                          ) : (
                            <MosaicCanvas 
                              dna={card.dna as MosaicDNA} 
                            />
                          )}
                        </SwipeCard>
                      );
                    })}
                  </div>
                )}
              </div>


            </motion.div>
          ) : (
            <motion.div
              key="threads"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-[340px] flex flex-col p-5 bg-[#090a10]/80 border border-gray-900 rounded-3xl shadow-2xl backdrop-blur-md min-h-[420px]"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-900 pb-3.5 mb-5">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-purple-400" />
                  <h2 className="text-xs font-bold text-gray-200 uppercase tracking-wider">プロジェクト選択・管理</h2>
                </div>
              </div>

              {/* Create Thread Action */}
              {threadsTab === 'all' && (
                <div className="mb-5">
                  <button
                    onClick={() => {
                      setShowCreateModal(true);
                    }}
                    className="w-full py-2.5 border border-dashed border-purple-500/30 bg-purple-950/10 hover:bg-purple-950/20 hover:border-purple-500/60 text-purple-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-purple-950/20"
                  >
                    <Plus className="w-4 h-4" />
                    新規プロジェクトを作成
                  </button>
                </div>
              )}

              {/* Tab Content */}
              <div className="flex-1 flex flex-col min-h-0">
                {threadsTab === 'all' ? (
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[300px] scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
                    {threads.map(thread => {
                      const isActive = thread.id === activeThreadId;
                      const isSaved = savedThreadIds.includes(thread.id);
                      return (
                        <div
                          key={thread.id}
                          className={`group w-full flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                            isActive
                              ? 'bg-purple-950/30 border-purple-500/30 text-purple-200'
                              : 'bg-gray-950/20 border-gray-900 text-gray-400 hover:text-gray-200 hover:border-gray-800'
                          }`}
                        >
                          <button
                            onClick={() => {
                              setActiveThreadId(thread.id);
                              setView('swipe');
                            }}
                            className="flex-1 text-left flex items-center gap-2 min-w-0"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${thread.type === 'line' ? 'bg-purple-400' : 'bg-emerald-400'}`} />
                            <span className="text-xs font-semibold truncate">{thread.name}</span>
                            <span className="text-[8px] opacity-60 px-1 py-0.5 rounded bg-gray-900 border border-gray-800 flex-shrink-0">
                              G{thread.generation}
                            </span>
                          </button>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {thread.creator_session_id === sessionId && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteThread(thread.id);
                                }}
                                className="p-1 text-gray-500 hover:text-rose-400 transition-colors"
                                title="Delete Thread"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSaveThread(thread.id);
                              }}
                              className={`p-1 transition-colors ${
                                isSaved 
                                  ? 'text-purple-400 hover:text-purple-300' 
                                  : 'text-gray-600 hover:text-gray-400'
                              }`}
                            >
                              <Star className={`w-3.5 h-3.5 ${isSaved ? 'fill-purple-400 text-purple-400' : ''}`} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col min-h-0">
                    {/* Sub-tab selector */}
                    <div className="flex gap-1 mb-3 p-0.5 bg-gray-950/60 border border-gray-900 rounded-lg">
                      <button
                        onClick={() => setSavedSubTab('threads')}
                        className={`flex-1 py-1 text-[9px] font-bold uppercase tracking-wider rounded-md transition-all ${
                          savedSubTab === 'threads'
                            ? 'bg-purple-600/20 text-purple-300 border border-purple-500/10'
                            : 'text-gray-500 hover:text-gray-300 border border-transparent'
                        }`}
                      >
                        プロジェクト ({threads.filter(t => savedThreadIds.includes(t.id)).length})
                      </button>
                      <button
                        onClick={() => setSavedSubTab('cards')}
                        className={`flex-1 py-1 text-[9px] font-bold uppercase tracking-wider rounded-md transition-all ${
                          savedSubTab === 'cards'
                            ? 'bg-purple-600/20 text-purple-300 border border-purple-500/10'
                            : 'text-gray-500 hover:text-gray-300 border border-transparent'
                        }`}
                      >
                        画像 ({savedCards.length})
                      </button>
                    </div>

                    {savedSubTab === 'threads' ? (
                      <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[260px] scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent">
                        {threads.filter(t => savedThreadIds.includes(t.id)).length === 0 ? (
                          <div className="text-center py-12 text-gray-600 text-[9px] uppercase tracking-wider font-semibold">
                            保存したプロジェクトはありません
                          </div>
                        ) : (
                          threads.filter(t => savedThreadIds.includes(t.id)).map(thread => {
                            const isActive = thread.id === activeThreadId;
                            return (
                              <div
                                key={thread.id}
                                className={`group w-full flex items-center justify-between p-2 rounded-xl border transition-all ${
                                  isActive
                                    ? 'bg-purple-950/30 border-purple-500/30 text-purple-200'
                                    : 'bg-gray-950/20 border-gray-900 text-gray-400 hover:text-gray-200 hover:border-gray-800'
                                }`}
                              >
                                <button
                                  onClick={() => {
                                    setActiveThreadId(thread.id);
                                    setView('swipe');
                                  }}
                                  className="flex-1 text-left flex items-center gap-2 min-w-0"
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${thread.type === 'line' ? 'bg-purple-400' : 'bg-emerald-400'}`} />
                                  <span className="text-xs font-semibold truncate">{thread.name}</span>
                                  <span className="text-[8px] opacity-60 px-1 py-0.5 rounded bg-gray-900 border border-gray-800 flex-shrink-0">
                                    G{thread.generation}
                                  </span>
                                </button>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {thread.creator_session_id === sessionId && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteThread(thread.id);
                                      }}
                                      className="p-1 text-gray-500 hover:text-rose-400 transition-colors"
                                      title="Delete Thread"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleSaveThread(thread.id);
                                    }}
                                    className="p-1 text-purple-400 hover:text-purple-300 transition-colors"
                                  >
                                    <Star className="w-3.5 h-3.5 fill-purple-400 text-purple-400" />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 overflow-y-auto pr-1 max-h-[260px] scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent">
                        {savedCards.length === 0 ? (
                          <div className="text-center py-12 text-gray-600 text-[9px] uppercase tracking-wider font-semibold">
                            保存した画像はありません
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            {savedCards.map(card => (
                              <div
                                key={card.id}
                                onClick={() => {
                                  setSelectedCard({
                                    id: card.id,
                                    generation: card.generation,
                                    dna: card.dna,
                                    threadId: card.threadId,
                                    threadName: card.threadName,
                                    type: card.type
                                  });
                                  setForkingMode(false);
                                  setForkThreadName('');
                                  setShowDetailModal(true);
                                }}
                                className="relative aspect-square rounded-xl bg-gray-950/60 border border-gray-900 hover:border-purple-500/30 transition-all p-1 cursor-pointer overflow-hidden group animate-fade-in"
                              >
                                <div className="w-full h-full rounded-lg overflow-hidden bg-black flex items-center justify-center relative">
                                  {card.type === 'line' ? (
                                    <LineCanvas dna={card.dna as LineDNA} />
                                  ) : (
                                    <MosaicCanvas dna={card.dna as MosaicDNA} />
                                  )}
                                </div>
                                {/* Overlay tag */}
                                <div className="absolute bottom-1 left-1 right-1 flex justify-between items-center bg-black/75 px-1 py-0.5 rounded text-[5px] text-gray-300 font-semibold border border-gray-800/40">
                                  <span className="truncate max-w-[45px]">{card.threadName}</span>
                                  <span className="text-purple-300">G{card.generation}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-lg px-6 pb-2 sm:pb-3 md:pb-4 flex-shrink-0 flex flex-col items-center gap-2 sm:gap-3 z-10">
        
        {/* Invisible/Compact Turnstile Widget container */}
        <div id="turnstile-container" className="absolute pointer-events-none opacity-0" />

        {/* Flat 3-Column Stats Bar */}
        <div className="w-full border-t border-gray-900/60 pt-1.5 flex flex-col gap-2 text-xs backdrop-blur-md">
          <div className="grid grid-cols-3 border-t border-b border-gray-900 bg-gray-950/20 py-2 text-center font-bold tracking-wider text-[11px] uppercase">
            <div className="border-r border-gray-900/60 flex items-center justify-center gap-1.5">
              <span className="text-gray-500 text-[8px] font-extrabold tracking-widest">soul:</span>
              <span className="text-gray-300 font-bold text-[10px]">{staminaData.souls}</span>
            </div>
            <div className="border-r border-gray-900/60 flex items-center justify-center gap-1.5">
              <span className="text-gray-500 text-[8px] font-extrabold tracking-widest">Gen:</span>
              <span className="text-gray-300 font-bold text-[10px]">{generation}</span>
            </div>
            <div className="flex items-center justify-center gap-1.5">
              <span className="text-gray-500 text-[8px] font-extrabold tracking-widest">swip:</span>
              <span className="text-gray-300 font-bold text-[10px] whitespace-nowrap">
                {staminaData.stamina}/{staminaData.maxStamina}
              </span>
              {staminaData.stamina < staminaData.maxStamina && (
                <span className="text-[7px] text-gray-500 font-medium lowercase tracking-normal flex-shrink-0">
                  +{nextRecoverySeconds}s
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Ad Section */}
        {!staminaData.isAdFree && (
          <div className="w-full max-w-[380px] h-[50px] bg-gradient-to-r from-gray-950 to-gray-900 border border-gray-900 rounded-xl overflow-hidden flex items-center justify-between px-3 relative group">
            {/* Small 'Ad' badge */}
            <span className="absolute top-1 left-1.5 bg-gray-800/80 text-[6px] text-gray-500 font-bold px-1 py-0.2 rounded border border-gray-700/30 uppercase tracking-widest">
              Ad
            </span>
            <div className="flex items-center gap-2 pl-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-pink-500 via-purple-600 to-indigo-500 flex items-center justify-center flex-shrink-0 shadow-md">
                <Sparkles className="w-4 h-4 text-white animate-pulse" />
              </div>
              <div className="text-left min-w-0">
                <h4 className="text-[10px] font-extrabold text-gray-200 tracking-wide truncate">GenX Premium Engine</h4>
                <p className="text-[8px] text-gray-500 truncate">Unlock unlimited mutation pools & 10x souls!</p>
              </div>
            </div>
            <button 
              onClick={() => setShowShopModal(true)}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-[8px] font-black uppercase tracking-wider transition-colors shadow-sm whitespace-nowrap"
            >
              Get
            </button>
          </div>
        )}

      </footer>



      {/* History Modal */}
      <AnimatePresence>
        {showHistoryModal && (
          <div 
            onClick={() => setShowHistoryModal(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-[#0a0b10] border border-gray-900 rounded-2xl p-6 shadow-2xl relative overflow-hidden"
            >
              {/* Background gradient flare */}
              <div className="absolute top-[-50%] left-[-50%] w-[100%] h-[100%] rounded-full bg-purple-500/5 blur-[80px] pointer-events-none" />

              <div className="flex items-center justify-between mb-4 relative z-10 border-b border-gray-900 pb-3">
                <div className="text-left">
                  <span className="text-[8px] uppercase tracking-widest text-purple-500 font-bold block">Evolutionary History</span>
                  <h3 className="text-sm font-bold text-gray-200">{activeThread?.name}</h3>
                </div>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* History Content */}
              <div className="relative z-10 max-h-[300px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent">
                {galleryLoading ? (
                  <div className="flex justify-center items-center py-12">
                    <RefreshCw className="w-5 h-5 text-purple-500 animate-spin" />
                  </div>
                ) : historySpecimens.length === 0 ? (
                  <div className="text-center py-12 text-gray-600 text-[10px] uppercase tracking-wider font-semibold">
                    No history recorded yet.<br/>Evolve the thread to see past generations!
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {historySpecimens.map(specimen => (
                      <div 
                        key={specimen.id} 
                        className="bg-gray-950/60 border border-gray-900 rounded-xl p-2 flex flex-col items-center gap-1.5 hover:border-purple-500/25 transition-colors"
                      >
                        <div className="w-full aspect-square rounded-lg overflow-hidden bg-black relative flex items-center justify-center">
                          {mode === 'line' ? (
                            <LineCanvas dna={specimen.dna as LineDNA} />
                          ) : (
                            <MosaicCanvas dna={specimen.dna as MosaicDNA} />
                          )}
                          <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[7px] text-purple-300 font-semibold border border-purple-500/10">
                            Gen {specimen.generation}
                          </span>
                        </div>
                        <span className="text-[7px] font-bold text-gray-500 uppercase tracking-widest text-center mt-0.5">
                          Top Specimen
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Thread Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div 
            onClick={() => setShowCreateModal(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-[#0a0b10] border border-gray-900 rounded-2xl p-6 shadow-2xl relative overflow-hidden"
            >
              {/* Background gradient flare */}
              <div className="absolute top-[-50%] left-[-50%] w-[100%] h-[100%] rounded-full bg-purple-500/5 blur-[80px] pointer-events-none" />

              <div className="flex items-center justify-between mb-6 relative z-10">
                <div>
                  <h3 className="text-sm font-bold tracking-wider text-purple-400 uppercase">新規プロジェクトを作成</h3>
                  <span className="text-[9px] text-yellow-300 font-bold block mt-0.5">所持ソウル: 🔮 {staminaData.souls} Soul</span>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateThread} className="space-y-4 relative z-10">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-1.5">
                    プロジェクト名
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={30}
                    placeholder="例: サイバー幾何学, サイバーパンクガール"
                    value={newThreadName}
                    onChange={(e) => setNewThreadName(e.target.value)}
                    className="w-full text-xs bg-gray-950 border border-gray-900 rounded-xl px-4 py-3 text-gray-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-1.5">
                    スタイル / 突然変異ベース
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewThreadType('line')}
                      className={`p-3 text-xs font-semibold rounded-xl border transition-all text-center flex flex-col items-center gap-1 ${
                        newThreadType === 'line'
                          ? 'bg-purple-950/40 border-purple-500/40 text-purple-200'
                          : 'bg-gray-950/20 border-gray-900 text-gray-500 hover:text-gray-300 hover:border-gray-800'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-purple-400" />
                      ライン
                      <span className="text-[9px] text-gray-500 font-bold block mt-0.5">100 Soul</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewThreadType('mosaic')}
                      className={`p-3 text-xs font-semibold rounded-xl border transition-all text-center flex flex-col items-center gap-1 ${
                        newThreadType === 'mosaic'
                          ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                          : 'bg-gray-950/20 border-gray-900 text-gray-500 hover:text-gray-300 hover:border-gray-800'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      モザイク
                      <span className="text-[9px] text-gray-500 font-bold block mt-0.5">200 Soul</span>
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={creatingThread || staminaData.souls < (newThreadType === 'line' ? 100 : 200)}
                    className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-purple-600/20 disabled:opacity-50"
                  >
                    {creatingThread && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    プロジェクトを作成 ({newThreadType === 'line' ? '100' : '200'} Soul)
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Shop Modal */}
      <AnimatePresence>
        {showShopModal && (
          <div 
            onClick={() => setShowShopModal(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-[#0a0b10] border border-gray-900 rounded-2xl p-6 shadow-2xl relative overflow-hidden"
            >
              {/* Background gradient flare */}
              <div className="absolute top-[-50%] left-[-50%] w-[100%] h-[100%] rounded-full bg-purple-500/5 blur-[80px] pointer-events-none" />

              <div className="flex items-center justify-between mb-4 relative z-10 border-b border-gray-900 pb-3">
                <div className="text-left">
                  <span className="text-[8px] uppercase tracking-widest text-purple-500 font-bold block">Soul Exchange Shop</span>
                  <h3 className="text-sm font-bold text-gray-200">ソウルショップ</h3>
                </div>
                <button
                  onClick={() => setShowShopModal(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Current Souls Display */}
              <div className="mb-5 p-4 rounded-xl bg-gradient-to-br from-purple-950/30 to-indigo-950/30 border border-purple-500/10 flex flex-col items-center justify-center gap-1 shadow-inner relative z-10">
                <span className="text-[9px] uppercase tracking-wider text-purple-400 font-bold">現在の所持ソウル</span>
                <span className="text-2xl font-black text-yellow-300 drop-shadow-[0_0_8px_rgba(253,224,71,0.2)]">
                  🔮 {staminaData.souls} <span className="text-xs font-semibold text-gray-400">Soul</span>
                </span>
              </div>

              {/* Shop Items Grid */}
              <div className="space-y-3 relative z-10">
                {/* Item 1: Recover Stamina */}
                <div className="p-3 bg-gray-950/40 border border-gray-900 rounded-xl flex items-center justify-between gap-4">
                  <div className="text-left min-w-0">
                    <h4 className="text-xs font-bold text-gray-200">スタミナ10回復薬</h4>
                    <p className="text-[9px] text-gray-500 mt-0.5">スタミナを10回復します（上限を超えません）</p>
                    <span className="text-[10px] text-yellow-300/80 font-bold block mt-1">価格: 50 Soul</span>
                  </div>
                  <button
                    onClick={buyStaminaRecovery}
                    disabled={staminaData.souls < 50 || staminaData.stamina >= staminaData.maxStamina}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-900 disabled:text-gray-600 text-white rounded-lg text-[10px] font-bold transition-all shadow-md flex-shrink-0"
                  >
                    交換する
                  </button>
                </div>

                {/* Item 2: Upgrade Max Stamina */}
                <div className="p-3 bg-gray-950/40 border border-gray-900 rounded-xl flex items-center justify-between gap-4">
                  <div className="text-left min-w-0">
                    <h4 className="text-xs font-bold text-gray-200">スタミナ上限+5追加</h4>
                    <p className="text-[9px] text-gray-500 mt-0.5">最大スタミナ上限を5増やします（現在値も5増えます）</p>
                    <span className="text-[10px] text-yellow-300/80 font-bold block mt-1">価格: 100 Soul</span>
                  </div>
                  <button
                    onClick={buyMaxStaminaUpgrade}
                    disabled={staminaData.souls < 100}
                    className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-gray-900 disabled:to-gray-900 disabled:text-gray-600 text-white rounded-lg text-[10px] font-bold transition-all shadow-md flex-shrink-0"
                  >
                    交換する
                  </button>
                </div>

                {/* Item 3: Ad-Free Pass */}
                <div className="p-3 bg-gray-950/40 border border-gray-900 rounded-xl flex items-center justify-between gap-4">
                  <div className="text-left min-w-0">
                    <h4 className="text-xs font-bold text-gray-200">広告非表示パス (Ad-Free)</h4>
                    <p className="text-[9px] text-gray-500 mt-0.5">画面下部の広告バナーを永久に非表示にします</p>
                    <span className="text-[10px] text-yellow-300/80 font-bold block mt-1">価格: 150 Soul</span>
                  </div>
                  <button
                    onClick={buyAdFreePass}
                    disabled={staminaData.souls < 150 || staminaData.isAdFree}
                    className="px-3 py-1.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:from-gray-900 disabled:to-gray-900 disabled:text-gray-600 text-white rounded-lg text-[10px] font-bold transition-all shadow-md flex-shrink-0"
                  >
                    {staminaData.isAdFree ? '購入済み' : '交換する'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Card Detail Modal */}
      <AnimatePresence>
        {showDetailModal && selectedCard && (
          <div 
            onClick={() => setShowDetailModal(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-[#0a0b10] border border-gray-900 rounded-2xl p-6 shadow-2xl relative overflow-hidden flex flex-col gap-4"
            >
              {/* Background gradient flare */}
              <div className="absolute top-[-50%] left-[-50%] w-[100%] h-[100%] rounded-full bg-purple-500/5 blur-[80px] pointer-events-none" />

              <div className="flex items-center justify-between relative z-10 border-b border-gray-900 pb-3">
                <div className="text-left min-w-0">
                  <span className="text-[8px] uppercase tracking-widest text-purple-500 font-bold block">
                    {selectedCard.threadName ? `プロジェクト: ${selectedCard.threadName}` : '画像詳細'}
                  </span>
                  <h3 className="text-xs font-bold text-gray-200 truncate">
                    第 {selectedCard.generation} 世代 / ID: {selectedCard.id.replace('line_', '').replace('mosaic_', '').substring(0, 8)}...
                  </h3>
                </div>
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Centered Image Preview */}
              <div className="relative z-10 w-full aspect-square rounded-2xl border border-gray-800 bg-black overflow-hidden flex items-center justify-center shadow-inner max-w-[260px] mx-auto">
                {staminaData.lifetimeSwipes === 0 && selectedCard.id === cards[cards.length - 1]?.id ? (
                  <div className="w-full h-full bg-white flex items-center justify-center">
                    <span className="text-4xl md:text-5xl font-light text-gray-400 font-sans tracking-widest select-none">
                      TEST
                    </span>
                  </div>
                ) : selectedCard.type === 'line' ? (
                  <LineCanvas dna={selectedCard.dna as LineDNA} className="w-full h-full" />
                ) : (
                  <MosaicCanvas dna={selectedCard.dna as MosaicDNA} className="w-full h-full" />
                )}
                
                {/* Micro badge for order */}
                <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 border border-gray-800/50 text-[7px] text-gray-400 font-semibold tracking-wider uppercase select-none">
                  累計 {staminaData.lifetimeSwipes} 枚目の画像
                </div>
              </div>

              {/* Action Buttons */}
              <div className="relative z-10 grid grid-cols-2 gap-2">
                {/* Download Button */}
                <button
                  onClick={() => downloadCardAsPNG(selectedCard, selectedCard.type || 'line')}
                  className="py-2.5 bg-gray-950/60 border border-gray-900 hover:border-purple-500/30 text-gray-200 hover:text-purple-300 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 shadow-md"
                >
                  <Download className="w-3.5 h-3.5" />
                  ダウンロード
                </button>

                {/* Save/Favorite Toggle */}
                {(() => {
                  const isSaved = savedCards.some(c => c.id === selectedCard.id);
                  return (
                    <button
                      onClick={() => toggleSaveCard(selectedCard)}
                      className={`py-2.5 border rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 shadow-md ${
                        isSaved
                          ? 'bg-purple-950/40 border-purple-500/40 text-purple-200 hover:bg-purple-900/30'
                          : 'bg-gray-950/60 border-gray-900 hover:border-purple-500/30 text-gray-200 hover:text-purple-300'
                      }`}
                    >
                      <Star className={`w-3.5 h-3.5 ${isSaved ? 'fill-purple-400 text-purple-400' : ''}`} />
                      {isSaved ? '保存解除' : 'お気に入り保存'}
                    </button>
                  );
                })()}
              </div>

              {/* Branching (Fork) Thread Section */}
              <div className="relative z-10 border-t border-gray-900 pt-3 flex flex-col gap-2">
                {!forkingMode ? (
                  <button
                    onClick={() => setForkingMode(true)}
                    className="w-full py-3 bg-gradient-to-r from-purple-600/90 to-indigo-600/90 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-purple-600/10 border border-purple-500/20"
                  >
                    <GitFork className="w-4 h-4 text-purple-200 animate-pulse" />
                    この個体から分岐して新プロジェクトを作成
                    <span className="text-[9px] opacity-75 font-semibold bg-black/40 px-1.5 py-0.5 rounded text-yellow-300">
                      500 Soul
                    </span>
                  </button>
                ) : (
                  <form onSubmit={handleForkThread} className="space-y-3 p-3 bg-gray-950/40 border border-gray-900 rounded-xl">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase tracking-wider font-extrabold text-purple-400 flex items-center gap-1">
                        <GitFork className="w-3 h-3" /> 分岐プロジェクト作成
                      </span>
                      <span className="text-[8px] font-bold text-yellow-300 bg-yellow-950/30 border border-yellow-500/10 px-1.5 py-0.5 rounded">
                        コスト: 500 Soul
                      </span>
                    </div>

                    <input
                      type="text"
                      required
                      maxLength={30}
                      placeholder="新しいプロジェクト名を入力"
                      value={forkThreadName}
                      onChange={(e) => setForkThreadName(e.target.value)}
                      className="w-full text-xs bg-gray-950 border border-gray-900 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                    />

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setForkingMode(false)}
                        className="py-2 bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] font-bold rounded-lg transition-colors"
                      >
                        キャンセル
                      </button>
                      <button
                        type="submit"
                        disabled={isForking || staminaData.souls < 500}
                        className="py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-900 disabled:text-gray-600 text-white text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {isForking && <RefreshCw className="w-3 h-3 animate-spin" />}
                        {staminaData.souls < 500 ? 'Soul不足' : '作成する'}
                      </button>
                    </div>
                    {staminaData.souls < 500 && (
                      <span className="text-[8px] text-rose-400 block text-center font-semibold mt-1">
                        ※作成には500 Soul必要です（現在: {staminaData.souls} Soul）
                      </span>
                    )}
                  </form>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Full-Screen Swipe Guide Overlay for New Users */}
      <AnimatePresence>
        {showSwipeGuide && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden select-none pointer-events-none">
            {/* Background glowing flares */}
            <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] rounded-full bg-rose-600/5 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-20%] w-[80%] h-[80%] rounded-full bg-emerald-600/5 blur-[120px] pointer-events-none" />

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="w-full h-full relative flex flex-col items-center justify-between py-12 px-4 pointer-events-none"
            >
              {/* Hourglass Curved Guidelines (SVG) */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-0">
                <svg className="w-full h-full text-white" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {/* Left curve path */}
                  <path 
                    d="M 40,0 Q 48,50 40,100" 
                    fill="none" 
                    stroke="url(#nopeGradient)" 
                    strokeWidth="0.3" 
                    strokeDasharray="1 1.5"
                    className="opacity-50"
                  />
                  {/* Right curve path */}
                  <path 
                    d="M 60,0 Q 52,50 60,100" 
                    fill="none" 
                    stroke="url(#likeGradient)" 
                    strokeWidth="0.3" 
                    strokeDasharray="1 1.5"
                    className="opacity-50"
                  />
                  
                  {/* Defs for gradients */}
                  <defs>
                    <linearGradient id="nopeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.1" />
                      <stop offset="50%" stopColor="#f43f5e" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.1" />
                    </linearGradient>
                    <linearGradient id="likeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.1" />
                      <stop offset="50%" stopColor="#10b981" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              {/* Top: Onboarding Guide Header */}
              <div className="text-center relative z-10 pt-4 max-w-sm">
                <h2 className="text-[11px] font-black tracking-widest text-purple-400 uppercase mb-1">
                  Art Evolutionary Onboarding
                </h2>
                <h3 className="text-xs text-gray-400 font-bold px-4">
                  直感的な操作で、アートを無限に進化させましょう
                </h3>
              </div>

              {/* Middle Content Layout: Left and Right Columns */}
              <div className="flex-1 w-full max-w-md grid grid-cols-2 gap-4 items-center relative z-10 my-auto">
                {/* Left Column: NOPE */}
                <div className="flex flex-col items-center justify-center text-center h-full px-2">
                  {/* Above Explanation */}
                  <div className="flex flex-col items-center justify-end h-[100px] mb-4">
                    <span className="text-rose-400/80 text-[10px] font-bold uppercase tracking-widest mb-1.5 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20">
                      淘汰 / ELIMINATE
                    </span>
                    <p className="text-[10.5px] text-gray-300 font-medium leading-relaxed">
                      好みではないデザイン
                    </p>
                  </div>

                  {/* NOPE Text */}
                  <div className="flex items-center justify-center h-[80px] my-2">
                    <span className="text-4xl md:text-5xl font-black tracking-wider text-rose-500 font-sans select-none filter drop-shadow-[0_0_12px_rgba(244,63,94,0.65)] animate-pulse">
                      NOPE
                    </span>
                  </div>

                  {/* Below Explanation */}
                  <div className="flex flex-col items-center justify-start h-[100px] mt-4">
                    <p className="text-[10px] text-gray-400 leading-relaxed max-w-[140px]">
                      左にスワイプしてスキップします。その個体の特徴は淘汰され、次世代へ受け継がれません。
                    </p>
                  </div>
                </div>

                {/* Right Column: LIKE */}
                <div className="flex flex-col items-center justify-center text-center h-full px-2">
                  {/* Above Explanation */}
                  <div className="flex flex-col items-center justify-end h-[100px] mb-4">
                    <span className="text-emerald-400/80 text-[10px] font-bold uppercase tracking-widest mb-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                      進化 / EVOLVE
                    </span>
                    <p className="text-[10.5px] text-gray-300 font-medium leading-relaxed">
                      お気に入りのデザイン
                    </p>
                  </div>

                  {/* LIKE Text */}
                  <div className="flex items-center justify-center h-[80px] my-2">
                    <span className="text-4xl md:text-5xl font-black tracking-wider text-emerald-500 font-sans select-none filter drop-shadow-[0_0_12px_rgba(16,185,129,0.65)] animate-pulse">
                      LIKE
                    </span>
                  </div>

                  {/* Below Explanation */}
                  <div className="flex flex-col items-center justify-start h-[100px] mt-4">
                    <p className="text-[10px] text-gray-400 leading-relaxed max-w-[140px]">
                      右にスワイプして残します。お気に入りの特徴をもとに、AIが突然変異を繰り返します。
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom: Swipe Hint */}
              <div className="text-center relative z-10 pb-4 flex flex-col items-center gap-2">
                <div className="flex items-center gap-2 text-xs font-black text-white/70 animate-bounce tracking-widest">
                  <span>←</span>
                  <span>カードを左右にスワイプして開始</span>
                  <span>→</span>
                </div>
                <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">
                  ※カードをスワイプするとガイドは自動的に消えます
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
