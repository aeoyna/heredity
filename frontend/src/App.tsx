import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Sparkles, RefreshCw, ShieldAlert, Plus, X, Star, Trash2, ShoppingCart, List, Diamond, Download, GitFork, Dna, Copy } from 'lucide-react';
import type { LineDNA, MosaicDNA } from '../../backend/src/shared-types';
import { SwipeCard } from './components/SwipeCard';
import { LineCanvas } from './components/LineCanvas';
import { MosaicCanvas } from './components/MosaicCanvas';
import { 
  playClick, 
  playSwipeLike, 
  playSwipeNope, 
  playEvolve, 
  playPurchase, 
  playCreate, 
  playError 
} from './utils/sound';

// Configure worker backend API base url
const API_BASE = import.meta.env.VITE_API_BASE || 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8787'
    : '');

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
  is_honeypot?: boolean;
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
  // Per-thread latest card preview (populated lazily as user visits threads)
  const [threadPreviews, setThreadPreviews] = useState<Record<string, { dna: any; type: 'line' | 'mosaic' }>>({});
  const [galleryLoading, setGalleryLoading] = useState<boolean>(false);

  // App View State ('swipe' for swiping cards, 'threads' for threads explorer, 'shop' for soul shop)
  const [view, setView] = useState<'swipe' | 'threads' | 'shop'>('swipe');
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

  const staminaDataRef = useRef(staminaData);
  useEffect(() => {
    staminaDataRef.current = staminaData;
  }, [staminaData]);

  const syncStaminaWithServer = async (overrideData?: typeof staminaData) => {
    try {
      const data = overrideData || staminaDataRef.current;
      const res = await fetch(`${API_BASE}/api/stamina/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          stamina: data.stamina,
          maxStamina: data.maxStamina,
          lifetimeSwipes: data.lifetimeSwipes,
          lastRecoveryTime: data.lastRecoveryTime,
          souls: data.souls,
          isAdFree: data.isAdFree
        })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.state) {
          const merged = json.state;
          const nextData = {
            stamina: merged.stamina,
            maxStamina: merged.maxStamina,
            lifetimeSwipes: merged.lifetimeSwipes,
            lastRecoveryTime: merged.lastRecoveryTime,
            souls: merged.souls,
            isAdFree: merged.isAdFree
          };
          localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
          setStaminaData(nextData);
        }
      }
    } catch (e) {
      console.error('Failed to sync stamina with server:', e);
    }
  };


  // Left Drawer & Legal/Report Modals
  const [showDrawer, setShowDrawer] = useState<boolean>(false);
  const [showTermsModal, setShowTermsModal] = useState<boolean>(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState<boolean>(false);
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [reportCategory, setReportCategory] = useState<string>('不具合');
  const [reportDesc, setReportDesc] = useState<string>('');
  const [submittingReport, setSubmittingReport] = useState<boolean>(false);

  const [nextRecoverySeconds, setNextRecoverySeconds] = useState<number>(0);

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

  const handleSwipeStateUpdate = (isAd = false) => {
    setStaminaData(prev => {
      const nextSwipes = prev.lifetimeSwipes + 1;
      const nextSouls = prev.souls + (isAd ? 3 : 1); // Reward +3 souls for swiping an ad!
      const newStamina = isAd ? prev.stamina : Math.max(0, prev.stamina - 1);
      
      const nextData = {
        ...prev,
        stamina: newStamina,
        lifetimeSwipes: nextSwipes,
        souls: nextSouls,
        lastRecoveryTime: prev.stamina >= prev.maxStamina ? Date.now() : prev.lastRecoveryTime
      };

      localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));

      // Sync with server on every 5th swipe
      if (nextSwipes % 5 === 0) {
        syncStaminaWithServer(nextData);
      }

      return nextData;
    });
  };

  const buyStaminaRecovery = () => {
    setStaminaData(prev => {
      if (prev.souls < 300) {
        showMsg('Soulが足りません！（必要: 300 Soul）', 'error');
        playError();
        return prev;
      }
      if (prev.stamina >= prev.maxStamina) {
        showMsg('すでにスタミナは満タンです！', 'error');
        playError();
        return prev;
      }
      const newStamina = Math.min(prev.maxStamina, prev.stamina + 10);
      const nextData = {
        ...prev,
        stamina: newStamina,
        souls: prev.souls - 300
      };
      localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
      showMsg('スタミナを10回復しました！', 'success');
      playPurchase();
      syncStaminaWithServer(nextData);
      return nextData;
    });
  };

  const buyMaxStaminaUpgrade = () => {
    setStaminaData(prev => {
      if (prev.souls < 1000) {
        showMsg('Soulが足りません！（必要: 1000 Soul）', 'error');
        playError();
        return prev;
      }
      const newMax = prev.maxStamina + 5;
      const newStamina = prev.stamina + 5; // Also increase current stamina by 5
      const nextData = {
        ...prev,
        stamina: newStamina,
        maxStamina: newMax,
        souls: prev.souls - 1000
      };
      localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
      showMsg(`スタミナ上限が ${newMax} にアップしました！`, 'success');
      playPurchase();
      syncStaminaWithServer(nextData);
      return nextData;
    });
  };

  const buyAdFreePass = () => {
    setStaminaData(prev => {
      if (prev.souls < 150) {
        showMsg('Soulが足りません！', 'error');
        playError();
        return prev;
      }
      if (prev.isAdFree) {
        showMsg('すでに広告非表示パスを購入済みです！', 'error');
        playError();
        return prev;
      }
      const nextData = {
        ...prev,
        isAdFree: true,
        souls: prev.souls - 150
      };
      localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
      showMsg('🎉 広告非表示パスを購入しました！広告が非表示になりました。', 'success');
      playPurchase();
      syncStaminaWithServer(nextData);
      return nextData;
    });
  };

  const [sessionId, setSessionId] = useState<string>('');
  const [sessionType, setSessionType] = useState<'anonymous' | 'authenticated'>('anonymous');
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticating' | 'authenticated' | 'error'>('checking');
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setSessionId(data.session_id);
            setSessionType(data.type);
            setAuthStatus('authenticated');
            return;
          }
        }
        setAuthStatus('authenticating');
      } catch (err) {
        console.error('Auth check error:', err);
        setAuthStatus('authenticating');
      }
    };
    checkAuth();
  }, []);

  // Check for error parameters in URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error');
    if (errorParam) {
      showMsg(`ログインエラー: ${errorParam}`, 'error');
      // Clean up the error query parameter from the browser URL bar
      const url = new URL(window.location.href);
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Trigger silent registration once turnstileToken is available (or fallback after timeout)
  useEffect(() => {
    if (authStatus !== 'authenticating') return;

    const registerAnonymous = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/anonymous`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ turnstile_token: turnstileToken })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to authenticate silently');
        }
        const data = await res.json();
        if (data.success) {
          setSessionId(data.session_id);
          setSessionType(data.type);
          setAuthStatus('authenticated');
          showMsg('セッションを開始しました（サイレント認証）', 'success');
        }
      } catch (err: any) {
        console.error('Silent auth error:', err);
        showMsg(`認証に失敗しました: ${err.message}`, 'error');
      }
    };

    if (turnstileToken) {
      registerAnonymous();
    } else {
      const timer = setTimeout(() => {
        if (authStatus === 'authenticating' && !turnstileToken) {
          console.log('Turnstile timeout, attempting registration without token');
          registerAnonymous();
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [authStatus, turnstileToken]);

  // Sync stamina data with server once authenticated
  useEffect(() => {
    if (authStatus === 'authenticated') {
      syncStaminaWithServer();
    }
  }, [authStatus]);

  // Derive mode from active thread
  const activeThread = threads.find(t => t.id === activeThreadId);
  const mode = activeThread?.type || 'line';

  const THREAD_FAVORITES_LIMIT = 20;

  // Toggle Save/Favorite status of a thread
  const toggleSaveThread = (threadId: string) => {
    setSavedThreadIds(prev => {
      if (!prev.includes(threadId) && prev.length >= THREAD_FAVORITES_LIMIT) {
        showMsg(`プロジェクトのお気に入りは${THREAD_FAVORITES_LIMIT}件までです。`, 'error');
        playError();
        return prev;
      }
      const next = prev.includes(threadId) ? prev.filter(id => id !== threadId) : [...prev, threadId];
      localStorage.setItem('project_x_saved_thread_ids', JSON.stringify(next));
      return next;
    });
  };

  // Fetch threads list
  const fetchThreads = useCallback(async (selectThreadId?: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/threads`, { credentials: 'include' });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.threads) {
        setThreads(data.threads);
        if (data.threads.length > 0) {
          if (selectThreadId) {
            setActiveThreadId(selectThreadId);
          } else if (!activeThreadId) {
            const params = new URLSearchParams(window.location.search);
            const urlThreadId = params.get('t') || params.get('thread');
            const exists = data.threads.some((t: any) => t.id === urlThreadId);
            if (urlThreadId && exists) {
              setActiveThreadId(urlThreadId);
            } else {
              setActiveThreadId(data.threads[0].id);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch threads:', err);
      let errorMsg = err.message || 'Unknown error';
      if (err.message && err.message.includes('Failed to fetch') && window.location.hostname === 'localhost') {
        errorMsg = 'Cannot connect to local backend. Make sure the local Wrangler dev server is running on port 8787.';
      }
      showMsg(`Failed to load threads: ${errorMsg}`, 'error');
      playError();
    }
  }, [activeThreadId]);

  useEffect(() => {
    fetchThreads();
  }, []);

  // Synchronize activeThreadId to URL query parameter t
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentParam = params.get('t') || params.get('thread');
    if (activeThreadId) {
      if (currentParam !== activeThreadId) {
        const url = new URL(window.location.href);
        url.searchParams.set('t', activeThreadId);
        url.searchParams.delete('thread');
        window.history.pushState({}, '', url.toString());
      }
    } else {
      if (currentParam) {
        const url = new URL(window.location.href);
        url.searchParams.delete('t');
        url.searchParams.delete('thread');
        window.history.pushState({}, '', url.toString());
      }
    }
  }, [activeThreadId]);

  // Listen to browser Back/Forward navigation (popstate)
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const urlThreadId = params.get('t') || params.get('thread');
      if (urlThreadId && threads.some(t => t.id === urlThreadId)) {
        setActiveThreadId(urlThreadId);
      } else if (threads.length > 0) {
        setActiveThreadId(threads[0].id);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [threads]);

  // Fetch Evolutionary History
  const fetchHistory = useCallback(async () => {
    if (!activeThreadId) return;
    setGalleryLoading(true);
    try {
      const historyRes = await fetch(`${API_BASE}/api/threads/history?thread_id=${activeThreadId}`, { credentials: 'include' });
      if (!historyRes.ok) {
        const errorData = await historyRes.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${historyRes.status}`);
      }
      const historyData = await historyRes.json();
      if (historyData.history) {
        setHistorySpecimens(historyData.history);
        // Use the last history specimen as a preview icon for this thread
        if (historyData.history.length > 0 && activeThreadId) {
          const latest = historyData.history[historyData.history.length - 1];
          setThreadPreviews(prev => ({
            ...prev,
            [activeThreadId]: { dna: latest.dna, type: activeThread?.type || 'line' }
          }));
        }
      }
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

      const res = await fetch(`${API_BASE}/api/cards?thread_id=${activeThreadId}${excludeParam}${lastSwipedParam}`, {
        credentials: 'include'
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      
      if (data.cards) {
        setCards(prev => append ? [...data.cards, ...prev] : data.cards);
        // Store first card as preview for this thread
        if (data.cards.length > 0 && activeThreadId) {
          setThreadPreviews(prev => ({
            ...prev,
            [activeThreadId]: { dna: data.cards[0].dna, type: activeThread?.type || 'line' }
          }));
        }
        
        // Update generation in local threads state
        setThreads(prev => prev.map(t => t.id === activeThreadId ? { ...t, generation: data.generation } : t));
        
        if (data.generation !== generationRef.current) {
          swipedCardIdsRef.current = [];
          if (append) {
            showMsg(`All specimens swiped! Auto-evolved to Gen ${data.generation}`, 'success');
            playEvolve();
          }
        }
        setGeneration(data.generation);
        generationRef.current = data.generation;
      }
    } catch (err: any) {
      console.error('Failed to fetch cards:', err);
      let errorMsg = err.message || 'Unknown error';
      if (err.message && err.message.includes('Failed to fetch') && window.location.hostname === 'localhost') {
        errorMsg = 'Cannot connect to local backend. Make sure the local Wrangler dev server is running on port 8787.';
      }
      showMsg(`Failed to fetch cards: ${errorMsg}`, 'error');
      playError();
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

  // Trigger Mock Auth for local development/testing
  const triggerMockAuth = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/upgrade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ clerk_token: 'mock_developer_token' })
      });
      if (!res.ok) throw new Error('Upgrade endpoint returned error');
      const data = await res.json();
      if (data.success) {
        setSessionType('authenticated');
        setShowAuthModal(false);
        showMsg('🎉 ログイン完了！（開発用アカウント）', 'success');
      }
    } catch (err: any) {
      console.error(err);
      showMsg('モックログインに失敗しました', 'error');
    }
  };

  const triggerGoogleAuth = () => {
    // Redirect browser to the backend Google login endpoint
    const redirectUrl = `${API_BASE}/api/auth/google/login?state=${sessionId}&redirect_back=${encodeURIComponent(window.location.origin)}`;
    window.location.href = redirectUrl;
  };

  const handleClerkUpgrade = () => {
    setShowAuthModal(true);
  };

  const handleLogout = async () => {
    if (!window.confirm('本当にログアウトしますか？\n（現在のデバイスでログイン状態が解除され、データがリセットされて新しい匿名アカウントになります）')) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        // Clear local storage to fully reset this client
        localStorage.removeItem('project_x_stamina_data');
        localStorage.removeItem('project_x_saved_cards');
        localStorage.removeItem('project_x_saved_thread_ids');
        
        showMsg('ログアウトしました。再起動しています...', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } else {
        showMsg('ログアウトに失敗しました。', 'error');
      }
    } catch (err) {
      console.error('Logout error:', err);
      showMsg('ログアウト中にエラーが発生しました。', 'error');
    }
  };

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
        credentials: 'include',
        body: JSON.stringify({
          thread_id: activeThreadId,
          card_id: cardId,
          swipe,
          turnstile_token: turnstileToken
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      if (result.error) {
        showMsg(result.error, 'error');
        playError();
      } else {
        fetchHistory();
      }
    } catch (err: any) {
      console.error('Failed to submit swipe:', err);
      showMsg(`Failed to submit swipe: ${err.message}`, 'error');
      playError();
    }
  };

  // Handle Swipe interaction
  const handleSwipe = (direction: 'like' | 'nope', cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    const isAd = card?.is_honeypot === true;

    if (!isAd && staminaData.stamina <= 0) {
      showMsg('スタミナがありません！', 'error');
      playError();
      return;
    }
    
    const isTestSwipe = staminaData.lifetimeSwipes === 0;

    if (direction === 'like') {
      playSwipeLike();
    } else {
      playSwipeNope();
    }

    submitSwipe(cardId, direction);
    swipedCardIdsRef.current.push(cardId);
    handleSwipeStateUpdate(isAd);

    if (isTestSwipe) {
      setTimeout(() => {
        handleClerkUpgrade();
      }, 600);
    }

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

    const cost = newThreadType === 'line' ? 200 : 500;
    if (staminaData.souls < cost) {
      showMsg(`Soulが足りません！作成には ${cost} Soulが必要です。（現在: ${staminaData.souls} Soul）`, 'error');
      playError();
      return;
    }

    setCreatingThread(true);
    try {
      const res = await fetch(`${API_BASE}/api/threads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          name: newThreadName,
          type: newThreadType
        })
      });
      const data = await res.json();
      if (data.error) {
        showMsg(data.error, 'error');
        playError();
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
        playCreate();
        setNewThreadName('');
        setShowCreateModal(false);
        await fetchThreads(data.thread.id);
      }
    } catch (err) {
      console.error(err);
      showMsg('Failed to create thread.', 'error');
      playError();
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

  const CARD_FAVORITES_LIMIT = 10;

  const toggleSaveCard = (card: CardData & { threadId?: string; threadName?: string; type?: 'line' | 'mosaic' }) => {
    const isAlreadySaved = savedCards.some(c => c.id === card.id);
    let updatedCards: SavedCard[] = [];
    if (isAlreadySaved) {
      updatedCards = savedCards.filter(c => c.id !== card.id);
      showMsg('カードをコレクションから削除しました。', 'info');
    } else {
      if (savedCards.length >= CARD_FAVORITES_LIMIT) {
        showMsg(`カードのお気に入りは${CARD_FAVORITES_LIMIT}件までです。`, 'error');
        playError();
        return;
      }
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
      showMsg('カードをコレクションに保存しました！', 'success');
    }
    setSavedCards(updatedCards);
    localStorage.setItem('project_x_saved_cards', JSON.stringify(updatedCards));
  };

  const handleForkThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard) return;
    if (!forkThreadName.trim()) {
      showMsg('プロジェクト名は必須です', 'error');
      playError();
      return;
    }
    const cost = 1000;
    if (staminaData.souls < cost) {
      showMsg(`Soulが足りません！作成には ${cost} Soulが必要です。`, 'error');
      playError();
      return;
    }

    setIsForking(true);
    try {
      const res = await fetch(`${API_BASE}/api/threads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          name: forkThreadName,
          type: selectedCard.type || mode,
          fork_dna: selectedCard.dna
        })
      });
      const data = await res.json();
      if (data.error) {
        showMsg(data.error, 'error');
        playError();
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
        playCreate();
        setForkThreadName('');
        setForkingMode(false);
        setShowDetailModal(false);
        setView('swipe');
        await fetchThreads(data.thread.id);
      }
    } catch (err) {
      console.error(err);
      showMsg('Failed to create thread.', 'error');
      playError();
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

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportDesc.trim()) {
      showMsg('内容を入力してください。', 'error');
      return;
    }
    setSubmittingReport(true);
    try {
      const res = await fetch(`${API_BASE}/api/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          category: reportCategory,
          description: reportDesc
        })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      showMsg('ご報告ありがとうございました。', 'success');
      setReportDesc('');
      setShowReportModal(false);
      setShowDrawer(false);
    } catch (err: any) {
      console.error(err);
      showMsg(`報告に失敗しました: ${err.message}`, 'error');
      playError();
    } finally {
      setSubmittingReport(false);
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
        credentials: 'include',
        body: JSON.stringify({
          thread_id: threadId
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



  if (authStatus === 'checking' || authStatus === 'authenticating') {
    return (
      <div className="h-[100dvh] bg-[#07080d] text-gray-100 flex flex-col items-center justify-center font-sans relative overflow-hidden">
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-purple-900/10 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-emerald-900/10 blur-[120px] pointer-events-none" />
        <div className="flex flex-col items-center gap-4 z-10">
          <div className="p-4 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 shadow-2xl shadow-indigo-600/30">
            <Sparkles className="w-8 h-8 text-white animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-300 to-gray-500 tracking-widest animate-pulse">gene46</h1>
          <div className="flex items-center gap-2 mt-4 text-xs font-semibold text-purple-400 uppercase tracking-widest">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Connecting securely...</span>
          </div>
        </div>
        <div id="turnstile-container" className="hidden" />
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-[#07080d] text-gray-100 flex flex-col items-center justify-between font-sans selection:bg-purple-600 selection:text-white relative overflow-hidden pb-2 sm:pb-3 md:pb-4">
      
      {/* Background Gradients */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-purple-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-emerald-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute top-[40%] left-[30%] w-[40%] h-[40%] rounded-full bg-indigo-900/10 blur-[150px] pointer-events-none" />

      {/* Header */}
      <header className="w-full max-w-lg px-6 pt-3 sm:pt-4 flex-shrink-0 flex flex-col items-center gap-4 z-20">
        <div className="w-full flex items-center justify-between">
          <div 
            onClick={() => {
              playClick();
              setShowDrawer(true);
            }}
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity active:scale-95 duration-200"
            title="メニューを開く"
          >
            <div className="p-2 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 shadow-lg shadow-indigo-600/30">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-300 to-gray-500 tracking-wider">gene46</h1>
          </div>
          
          <div className="flex items-center gap-5">
            {/* Evolve Button */}
            <button
              onClick={() => {
                playClick();
                setView('swipe');
              }}
              className={`flex flex-col items-center gap-0.5 transition-colors ${
                view === 'swipe'
                  ? 'text-purple-400 font-bold'
                  : 'text-gray-400 hover:text-purple-400'
              }`}
              title="Evolve"
            >
              <span className="text-[7px] font-bold text-gray-600 uppercase tracking-widest">Evolve</span>
              <Activity className="w-5 h-5" />
            </button>

            {/* Shop Button */}
            <button
              onClick={() => {
                playClick();
                if (view === 'shop') {
                  setView('swipe');
                } else {
                  setView('shop');
                }
              }}
              className={`flex flex-col items-center gap-0.5 transition-colors ${
                view === 'shop'
                  ? 'text-purple-400 font-bold'
                  : 'text-gray-400 hover:text-purple-400'
              }`}
              title="Shop"
            >
              <span className="text-[7px] font-bold text-gray-600 uppercase tracking-widest">Shop</span>
              <ShoppingCart className="w-5 h-5 hover:scale-110 transition-transform" />
            </button>

            {/* Project List Button */}
            <button
              onClick={() => {
                playClick();
                if (view === 'threads' && threadsTab === 'all') {
                  setView('swipe');
                } else {
                  setView('threads');
                  setThreadsTab('all');
                }
              }}
              className={`flex flex-col items-center gap-0.5 transition-colors ${
                view === 'threads' && threadsTab === 'all'
                  ? 'text-purple-400 font-bold'
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
                playClick();
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
                    playClick();
                    setView('threads');
                    setThreadsTab('all');
                  }}
                  className="w-full max-w-[380px] py-3 sm:py-4 md:py-5 px-[18px] bg-gray-950/60 border border-gray-900/60 hover:border-purple-500/30 rounded-2xl backdrop-blur-md mb-2 sm:mb-3 flex items-center justify-between cursor-pointer transition-all group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-gray-200 group-hover:text-purple-300 transition-colors truncate">
                      {activeThread.name}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent opening the threads screen
                        playClick();
                        const shareUrl = `${window.location.origin}${window.location.pathname}?t=${activeThread.id}`;
                        navigator.clipboard.writeText(shareUrl)
                          .then(() => {
                            showMsg('プロジェクトの共有リンクをコピーしました！', 'success');
                          })
                          .catch(() => {
                            showMsg('コピーに失敗しました', 'error');
                          });
                      }}
                      className="p-1 text-gray-500 hover:text-purple-400 hover:bg-purple-950/30 rounded transition-colors flex-shrink-0"
                      title="プロジェクトのリンクをコピー"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
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
                        playClick();
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
                        playClick();
                        swipedCardIdsRef.current = []; // Reset swiped history
                        fetchCards(false);
                      }}
                      className="px-4 py-2 text-xs font-semibold bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
                    >
                      Refresh Pool
                    </button>
                  </div>
                ) : (staminaData.lifetimeSwipes > 0 && sessionType === 'anonymous') ? (
                  <div className="text-center p-8 bg-[#0c0e15]/80 border border-purple-500/10 rounded-3xl flex flex-col items-center justify-between w-full h-full relative overflow-hidden backdrop-blur-lg shadow-2xl"
                    style={{
                      boxShadow: '0 0 40px rgba(168, 85, 247, 0.15), inset 0 0 12px rgba(255, 255, 255, 0.05)',
                      fontFamily: "'Outfit', sans-serif"
                    }}
                  >
                    <div className="absolute top-[-30%] left-[20%] right-[20%] h-[40%] rounded-full bg-gradient-to-r from-purple-500/20 to-indigo-500/20 blur-2xl pointer-events-none" />
                    
                    <div className="my-auto py-2 flex flex-col items-center w-full">
                      {/* Glowing DNA helix logo for Locked Card Gate */}
                      <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-500/10 to-indigo-500/10 border border-purple-500/20 shadow-inner mb-5 mx-auto">
                        <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/20 to-indigo-500/20 rounded-2xl blur-md opacity-75" />
                        <Dna className="w-8 h-8 text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.7)] animate-pulse z-10" />
                      </div>

                      {/* Title and Branding */}
                      <h2 className="text-xl font-bold tracking-tight text-white mb-2">
                        gene46 <span className="text-purple-400 font-medium">Evolution</span>
                      </h2>
                      <p className="text-xs text-gray-400 leading-relaxed max-w-[280px] mx-auto mb-6">
                        遺伝子の螺旋を探索し、 specimen（スペックメン）の進化を進めるにはログインが必要です。
                      </p>

                      {/* Continue with Google button */}
                      <button
                        onClick={() => {
                          playClick();
                          triggerGoogleAuth();
                        }}
                        className="w-full py-3.5 px-5 bg-white text-gray-900 rounded-full text-xs font-bold transition-all flex items-center justify-center gap-2 hover:bg-gray-100 hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-white/5 duration-150 mb-2"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                        </svg>
                        Googleでログイン
                      </button>

                      {import.meta.env.DEV && (
                        <button
                          onClick={() => {
                            playClick();
                            triggerMockAuth();
                          }}
                          className="w-full py-2.5 px-4 bg-purple-950/40 border border-purple-500/20 hover:border-purple-500/40 text-purple-300 rounded-full text-xs font-bold transition-all flex items-center justify-center gap-2 mb-4"
                        >
                          Mock Developer Login
                        </button>
                      )}

                      {/* Muted Terms */}
                      <p className="text-[10px] text-gray-500 leading-normal max-w-[240px] mx-auto">
                        ログインすることで、当サービスの
                        <a href="#" className="underline hover:text-gray-400 mx-1">利用規約</a>及び
                        <a href="#" className="underline hover:text-gray-400 ml-1">プライバシーポリシー</a>に同意したものとみなされます。
                      </p>
                    </div>
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
                      onClick={() => {
                        playClick();
                        setView('shop');
                      }}
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
                          onClick={() => {
                            playClick();
                            handleInstallPwa();
                          }}
                          className="w-full mt-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold transition-all shadow-md active:scale-[0.98]"
                        >
                          {deferredPrompt ? 'アプリをインストール' : 'インストール方法を見る'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-full relative">
                    {cards
                      .filter(card => !card.is_honeypot)
                      .slice(-3)
                      .map((card, idx, arr) => {
                      const isActive = idx === arr.length - 1;
                      return (
                        <SwipeCard
                          key={card.id}
                          isActive={isActive}
                          onSwipe={(dir) => handleSwipe(dir, card.id)}
                          onTap={() => {
                            playClick();
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
          ) : view === 'threads' ? (
            <motion.div
              key="threads"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-[400px] flex flex-col p-5 bg-[#090a10]/80 border border-gray-900 rounded-3xl shadow-2xl backdrop-blur-md min-h-[420px]"
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
                      playClick();
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
                  <div className="flex-1 overflow-y-auto pr-1 max-h-[340px] scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
                    <div className="grid grid-cols-2 gap-2">
                    {threads.map(thread => {
                      const isActive = thread.id === activeThreadId;
                      const isSaved = savedThreadIds.includes(thread.id);
                      const preview = threadPreviews[thread.id];
                      return (
                        <div
                          key={thread.id}
                          className={`group relative flex flex-col rounded-xl border overflow-hidden cursor-pointer transition-all ${
                            isActive
                              ? 'border-purple-500/60 shadow-[0_0_12px_rgba(168,85,247,0.25)]'
                              : 'border-gray-800 hover:border-purple-500/30'
                          }`}
                        >
                          {/* Preview thumbnail */}
                          <button
                            onClick={() => {
                              playClick();
                              setActiveThreadId(thread.id);
                              setView('swipe');
                            }}
                            className="w-full aspect-square bg-black overflow-hidden flex items-center justify-center relative"
                          >
                            {preview ? (
                              preview.type === 'line'
                                ? <LineCanvas dna={preview.dna as LineDNA} />
                                : <MosaicCanvas dna={preview.dna as MosaicDNA} />
                            ) : (
                              <div className={`w-full h-full flex items-center justify-center ${
                                thread.type === 'line'
                                  ? 'bg-gradient-to-br from-purple-950/60 to-indigo-950/60'
                                  : 'bg-gradient-to-br from-emerald-950/60 to-teal-950/60'
                              }`}>
                                <span className={`text-[9px] font-bold uppercase tracking-widest opacity-50 ${
                                  thread.type === 'line' ? 'text-purple-300' : 'text-emerald-300'
                                }`}>{thread.type === 'line' ? 'LINE' : 'MOSAIC'}</span>
                              </div>
                            )}
                            {/* Active indicator */}
                            {isActive && (
                              <div className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.9)]" />
                            )}
                            {/* Gen badge */}
                            <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/70 text-[7px] text-purple-300 font-bold border border-purple-500/20">
                              G{thread.generation}
                            </span>
                          </button>

                          {/* Footer: name + actions */}
                          <div className={`flex items-center justify-between px-1.5 py-1 ${
                            isActive ? 'bg-purple-950/50' : 'bg-gray-950/80'
                          }`}>
                            <span className="text-[9px] font-bold text-gray-200 truncate flex-1 min-w-0">{thread.name}</span>
                            <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
                              {thread.creator_session_id === sessionId && (
                                <button
                                  onClick={(e) => { playClick(); e.stopPropagation(); handleDeleteThread(thread.id); }}
                                  className="p-0.5 text-gray-600 hover:text-rose-400 transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                onClick={(e) => { playClick(); e.stopPropagation(); toggleSaveThread(thread.id); }}
                                className={`p-0.5 transition-colors ${
                                  isSaved ? 'text-purple-400' : 'text-gray-600 hover:text-gray-400'
                                }`}
                              >
                                <Star className={`w-3 h-3 ${isSaved ? 'fill-purple-400' : ''}`} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col min-h-0">
                    {/* Sub-tab selector */}
                    <div className="flex gap-1 mb-3 p-0.5 bg-gray-950/60 border border-gray-900 rounded-lg">
                      <button
                        onClick={() => {
                          playClick();
                          setSavedSubTab('threads');
                        }}
                        className={`flex-1 py-1 text-[9px] font-bold uppercase tracking-wider rounded-md transition-all ${
                          savedSubTab === 'threads'
                            ? 'bg-purple-600/20 text-purple-300 border border-purple-500/10'
                            : 'text-gray-500 hover:text-gray-300 border border-transparent'
                        }`}
                      >
                        プロジェクト ({threads.filter(t => savedThreadIds.includes(t.id)).length})
                      </button>
                      <button
                        onClick={() => {
                          playClick();
                          setSavedSubTab('cards');
                        }}
                        className={`flex-1 py-1 text-[9px] font-bold uppercase tracking-wider rounded-md transition-all ${
                          savedSubTab === 'cards'
                            ? 'bg-purple-600/20 text-purple-300 border border-purple-500/10'
                            : 'text-gray-500 hover:text-gray-300 border border-transparent'
                        }`}
                      >
                        カード ({savedCards.length}/{CARD_FAVORITES_LIMIT})
                      </button>
                    </div>

                    {savedSubTab === 'threads' ? (
                      <div className="flex-1 overflow-y-auto pr-1 max-h-[260px] scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent">
                        {threads.filter(t => savedThreadIds.includes(t.id)).length === 0 ? (
                          <div className="text-center py-12 text-gray-600 text-[9px] uppercase tracking-wider font-semibold">
                            保存したプロジェクトはありません
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                          {threads.filter(t => savedThreadIds.includes(t.id)).map(thread => {
                            const isActive = thread.id === activeThreadId;
                            const preview = threadPreviews[thread.id];
                            return (
                              <div
                                key={thread.id}
                                className={`group relative flex flex-col rounded-xl border overflow-hidden cursor-pointer transition-all ${
                                  isActive
                                    ? 'border-purple-500/60 shadow-[0_0_12px_rgba(168,85,247,0.25)]'
                                    : 'border-gray-800 hover:border-purple-500/30'
                                }`}
                              >
                                <button
                                  onClick={() => { playClick(); setActiveThreadId(thread.id); setView('swipe'); }}
                                  className="w-full aspect-square bg-black overflow-hidden flex items-center justify-center relative"
                                >
                                  {preview ? (
                                    preview.type === 'line'
                                      ? <LineCanvas dna={preview.dna as LineDNA} />
                                      : <MosaicCanvas dna={preview.dna as MosaicDNA} />
                                  ) : (
                                    <div className={`w-full h-full flex items-center justify-center ${
                                      thread.type === 'line'
                                        ? 'bg-gradient-to-br from-purple-950/60 to-indigo-950/60'
                                        : 'bg-gradient-to-br from-emerald-950/60 to-teal-950/60'
                                    }`}>
                                      <span className={`text-[9px] font-bold uppercase tracking-widest opacity-50 ${
                                        thread.type === 'line' ? 'text-purple-300' : 'text-emerald-300'
                                      }`}>{thread.type === 'line' ? 'LINE' : 'MOSAIC'}</span>
                                    </div>
                                  )}
                                  {isActive && <div className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.9)]" />}
                                  <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/70 text-[7px] text-purple-300 font-bold border border-purple-500/20">G{thread.generation}</span>
                                </button>
                                <div className={`flex items-center justify-between px-1.5 py-1 ${
                                  isActive ? 'bg-purple-950/50' : 'bg-gray-950/80'
                                }`}>
                                  <span className="text-[9px] font-bold text-gray-200 truncate flex-1 min-w-0">{thread.name}</span>
                                  <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
                                    {thread.creator_session_id === sessionId && (
                                      <button onClick={(e) => { playClick(); e.stopPropagation(); handleDeleteThread(thread.id); }} className="p-0.5 text-gray-600 hover:text-rose-400 transition-colors">
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                    <button onClick={(e) => { playClick(); e.stopPropagation(); toggleSaveThread(thread.id); }} className="p-0.5 text-purple-400 hover:text-purple-300 transition-colors">
                                      <Star className="w-3 h-3 fill-purple-400" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 overflow-y-auto pr-1 max-h-[260px] scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent">
                        {savedCards.length === 0 ? (
                          <div className="text-center py-12 text-gray-600 text-[9px] uppercase tracking-wider font-semibold">
                            保存した画像はありません
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-3">
                            {savedCards.map(card => (
                              <div
                                key={card.id}
                                onClick={() => {
                                  playClick();
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
                                <div className="absolute bottom-1 left-1 right-1 flex justify-between items-center bg-black/75 px-1.5 py-0.5 rounded text-[7px] text-gray-300 font-semibold border border-gray-800/40">
                                  <span className="truncate max-w-[70px]">{card.threadName}</span>
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
          ) : (
            <motion.div
              key="shop"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-[400px] flex flex-col p-5 bg-[#090a10]/80 border border-gray-900 rounded-3xl shadow-2xl backdrop-blur-md min-h-[420px] relative overflow-hidden"
            >
              {/* Background gradient flare */}
              <div className="absolute top-[-50%] left-[-50%] w-[100%] h-[100%] rounded-full bg-purple-500/5 blur-[80px] pointer-events-none" />

              <div className="flex items-center justify-between border-b border-gray-900 pb-3.5 mb-5 relative z-10">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-purple-400" />
                  <h2 className="text-xs font-bold text-gray-200 uppercase tracking-wider text-left">ソウルショップ</h2>
                </div>
                <button
                  onClick={() => {
                    playClick();
                    setView('swipe');
                  }}
                  className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                  title="閉じる"
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
              <div className="space-y-3 relative z-10 flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent">
                {/* Item 1: Recover Stamina */}
                <div className="p-3 bg-gray-950/40 border border-gray-900 rounded-xl flex items-center justify-between gap-4">
                  <div className="text-left min-w-0">
                    <h4 className="text-xs font-bold text-gray-200">スタミナ10回復薬</h4>
                    <p className="text-[9px] text-gray-500 mt-0.5">スタミナを10回復します（上限を超えません）</p>
                    <span className="text-[10px] text-yellow-300/80 font-bold block mt-1">価格: 300 Soul</span>
                  </div>
                  <button
                    onClick={buyStaminaRecovery}
                    disabled={staminaData.souls < 300 || staminaData.stamina >= staminaData.maxStamina}
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
                    <span className="text-[10px] text-yellow-300/80 font-bold block mt-1">価格: 1000 Soul</span>
                  </div>
                  <button
                    onClick={buyMaxStaminaUpgrade}
                    disabled={staminaData.souls < 1000}
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
              onClick={() => setView('shop')}
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
                        onClick={() => {
                          playClick();
                          setSelectedCard({
                            id: specimen.id,
                            generation: specimen.generation,
                            dna: specimen.dna,
                            threadId: activeThreadId || undefined,
                            threadName: activeThread?.name,
                            type: mode
                          });
                          setForkingMode(false);
                          setForkThreadName('');
                          setShowHistoryModal(false);
                          setShowDetailModal(true);
                        }}
                        className="bg-gray-950/60 border border-gray-900 rounded-xl p-2 flex flex-col items-center gap-1.5 hover:border-purple-500/40 transition-colors cursor-pointer active:scale-95"
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
                          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[6px] text-gray-400 font-bold border border-gray-800/50">
                            タップで詳細
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
                      <span className="text-[9px] text-gray-500 font-bold block mt-0.5">200 Soul</span>
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
                      <span className="text-[9px] text-gray-500 font-bold block mt-0.5">500 Soul</span>
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={creatingThread || staminaData.souls < (newThreadType === 'line' ? 200 : 500)}
                    className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-purple-600/20 disabled:opacity-50"
                  >
                    {creatingThread && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    プロジェクトを作成 ({newThreadType === 'line' ? '200' : '500'} Soul)
                  </button>
                </div>
              </form>
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
                      1000 Soul
                    </span>
                  </button>
                ) : (
                  <form onSubmit={handleForkThread} className="space-y-3 p-3 bg-gray-950/40 border border-gray-900 rounded-xl">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase tracking-wider font-extrabold text-purple-400 flex items-center gap-1">
                        <GitFork className="w-3 h-3" /> 分岐プロジェクト作成
                      </span>
                      <span className="text-[8px] font-bold text-yellow-300 bg-yellow-950/30 border border-yellow-500/10 px-1.5 py-0.5 rounded">
                        コスト: 1000 Soul
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
                        disabled={isForking || staminaData.souls < 1000}
                        className="py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-900 disabled:text-gray-600 text-white text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {isForking && <RefreshCw className="w-3 h-3 animate-spin" />}
                        {staminaData.souls < 1000 ? 'Soul不足' : '作成する'}
                      </button>
                    </div>
                    {staminaData.souls < 1000 && (
                      <span className="text-[8px] text-rose-400 block text-center font-semibold mt-1">
                        ※作成には1000 Soul必要です（現在: {staminaData.souls} Soul）
                      </span>
                    )}
                  </form>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Wplace-Style Custom Auth Modal */}
      <AnimatePresence>
        {showAuthModal && (
          <div 
            onClick={() => setShowAuthModal(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-fade-in"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full max-w-[360px] bg-[#0c0e15]/80 border border-purple-500/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden text-center backdrop-blur-lg flex flex-col justify-between"
              style={{
                boxShadow: '0 0 40px rgba(168, 85, 247, 0.15), inset 0 0 12px rgba(255, 255, 255, 0.05)',
                fontFamily: "'Outfit', sans-serif"
              }}
            >
              {/* Decorative top light flare */}
              <div className="absolute top-[-30%] left-[20%] right-[20%] h-[40%] rounded-full bg-gradient-to-r from-purple-500/20 to-indigo-500/20 blur-2xl pointer-events-none" />

              {/* Close Button */}
              <button
                onClick={() => setShowAuthModal(false)}
                className="absolute top-4 right-4 p-1.5 text-gray-500 hover:text-gray-300 rounded-full hover:bg-white/5 transition-all"
              >
                <X className="w-4.5 h-4.5" />
              </button>

              <div className="my-auto py-4">
                {/* Glowing DNA double helix logo */}
                <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-500/10 to-indigo-500/10 border border-purple-500/20 shadow-inner mb-6 mx-auto">
                  <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/20 to-indigo-500/20 rounded-2xl blur-md opacity-75" />
                  <Dna className="w-8 h-8 text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.7)] animate-pulse z-10" />
                </div>

                {/* Title and Branding */}
                <h2 className="text-xl font-bold tracking-tight text-white mb-2">
                  gene46 <span className="text-purple-400 font-medium">Evolution</span>
                </h2>
                <p className="text-xs text-gray-400 leading-relaxed max-w-[280px] mx-auto mb-8">
                  遺伝子の螺旋を探索し、 specimen（スペックメン）の進化を進めるにはログインが必要です。
                </p>

                {/* Continue with Google button */}
                <button
                  onClick={() => {
                    playClick();
                    triggerGoogleAuth();
                  }}
                  className="w-full py-3.5 px-5 bg-white text-gray-900 rounded-full text-xs font-bold transition-all flex items-center justify-center gap-2 hover:bg-gray-100 hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-white/5 duration-150 mb-2"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                  </svg>
                  Googleでログイン
                </button>

                {import.meta.env.DEV && (
                  <button
                    onClick={() => {
                      playClick();
                      triggerMockAuth();
                    }}
                    className="w-full py-2.5 px-4 bg-purple-950/40 border border-purple-500/20 hover:border-purple-500/40 text-purple-300 rounded-full text-xs font-bold transition-all flex items-center justify-center gap-2 mb-4"
                  >
                    Mock Developer Login
                  </button>
                )}

                {/* Muted Terms */}
                <p className="text-[10px] text-gray-500 leading-normal max-w-[240px] mx-auto">
                  ログインすることで、当サービスの
                  <a href="#" className="underline hover:text-gray-400 mx-1">利用規約</a>及び
                  <a href="#" className="underline hover:text-gray-400 ml-1">プライバシーポリシー</a>に同意したものとみなされます。
                </p>
              </div>

              {/* Dev mock indicator */}
              {import.meta.env.DEV && (
                <div className="border-t border-gray-900/50 pt-4 mt-2">
                  <span className="text-[9px] font-mono text-purple-400 bg-purple-950/30 px-2 py-0.5 rounded border border-purple-500/10">
                    Developer Mode: Direct Mock Auth Active
                  </span>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>


      {/* Side Drawer */}
      <AnimatePresence>
        {showDrawer && (
          <>
            {/* Backdrop */}
            <div 
              onClick={() => setShowDrawer(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 animate-fade-in"
            />
            {/* Sliding Panel */}
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 h-full w-[280px] sm:w-[320px] bg-[#090a0f]/95 border-r border-gray-900 z-50 p-6 flex flex-col justify-between shadow-2xl backdrop-blur-md text-left"
            >
              <div>
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-900 pb-4 mb-6">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-base font-bold text-gray-200 tracking-wider">gene46 メニュー</span>
                  </div>
                  <button
                    onClick={() => setShowDrawer(false)}
                    className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Navigation Menu */}
                <nav className="space-y-2">
                  {sessionType === 'anonymous' ? (
                    <button
                      onClick={() => {
                        playClick();
                        handleClerkUpgrade();
                      }}
                      className="w-full text-left px-4 py-3 bg-gradient-to-r from-purple-900/40 to-indigo-900/40 border border-purple-500/20 hover:border-purple-500/40 rounded-xl text-xs font-bold text-purple-200 hover:text-white transition-all flex items-center justify-between"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
                        クラウドに保存（ログイン）
                      </span>
                      <span className="text-purple-400 text-[10px]">→</span>
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="w-full px-4 py-3 bg-emerald-950/20 border border-emerald-500/20 rounded-xl text-xs font-semibold text-emerald-300 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        クラウド同期済み（登録済）
                      </div>
                      <button
                        onClick={() => {
                          playClick();
                          handleLogout();
                        }}
                        className="w-full text-left px-4 py-2.5 bg-rose-950/20 border border-rose-500/10 hover:border-rose-500/30 rounded-xl text-[10px] font-bold text-rose-300 hover:text-rose-200 transition-all flex items-center justify-between shadow-lg"
                      >
                        <span>アカウントのログアウト</span>
                        <span className="text-rose-400 opacity-60">→</span>
                      </button>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setShowTermsModal(true);
                    }}
                    className="w-full text-left px-4 py-3 bg-gray-950/40 border border-gray-900 hover:border-purple-500/20 rounded-xl text-xs font-semibold text-gray-300 hover:text-white transition-all flex items-center justify-between"
                  >
                    <span>利用規約</span>
                    <span className="text-gray-600 text-[10px]">→</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowPrivacyModal(true);
                    }}
                    className="w-full text-left px-4 py-3 bg-gray-950/40 border border-gray-900 hover:border-purple-500/20 rounded-xl text-xs font-semibold text-gray-300 hover:text-white transition-all flex items-center justify-between"
                  >
                    <span>プライバシーポリシー</span>
                    <span className="text-gray-600 text-[10px]">→</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowReportModal(true);
                    }}
                    className="w-full text-left px-4 py-3 bg-gray-950/40 border border-gray-900 hover:border-purple-500/20 rounded-xl text-xs font-semibold text-gray-300 hover:text-white transition-all flex items-center justify-between"
                  >
                    <span>問題報告・ご意見</span>
                    <span className="text-gray-600 text-[10px]">→</span>
                  </button>
                </nav>

                {/* Data Retention Test Section */}
                <div className="mt-4 p-3 bg-gray-950/60 border border-gray-900 rounded-xl space-y-2 text-left">
                  <div className="flex items-center justify-between border-b border-gray-900 pb-1.5 mb-1.5">
                    <span className="text-[9px] uppercase tracking-widest text-purple-400 font-extrabold flex items-center gap-1">
                      🧪 データ保持検証テスト
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                      sessionType === 'authenticated'
                        ? 'bg-emerald-950/40 border border-emerald-500/20 text-emerald-400'
                        : 'bg-yellow-950/40 border border-yellow-500/20 text-yellow-400'
                    }`}>
                      {sessionType === 'authenticated' ? 'テスト成功' : 'テスト待機中'}
                    </span>
                  </div>
                  <p className="text-[9px] text-gray-500 leading-normal">
                    ログイン後にデータ（セッションIDとスワイプ数・所持ソウル）が引き継がれ、消失しないことを実証するためのテストパネルです。
                  </p>
                  
                  <div className="space-y-1.5 text-[9px] font-semibold text-gray-400">
                    <div className="flex justify-between items-center bg-black/40 px-2 py-1 rounded">
                      <span>1. 累計スワイプ数:</span>
                      <span className="text-gray-200 font-bold">{staminaData.lifetimeSwipes} 回</span>
                    </div>
                    <div className="flex justify-between items-center bg-black/40 px-2 py-1 rounded">
                      <span>2. 所持ソウル:</span>
                      <span className="text-gray-200 font-bold">🔮 {staminaData.souls} Soul</span>
                    </div>
                    <div className="flex justify-between items-center bg-black/40 px-2 py-1 rounded">
                      <span>3. 接続アカウント状態:</span>
                      <span className={sessionType === 'authenticated' ? "text-emerald-400 font-bold" : "text-yellow-500 font-bold"}>
                        {sessionType === 'authenticated' ? "✅ ログイン済み（同期中）" : "未ログイン（匿名状態）"}
                      </span>
                    </div>
                  </div>

                  {sessionType === 'authenticated' ? (
                    <div className="mt-2 p-2 bg-emerald-950/30 border border-emerald-500/20 rounded-lg text-[9px] text-emerald-300 font-bold leading-normal">
                      🎉 【検証結果：合格】<br />
                      データは一切失われず、同じセッションID（末尾: {sessionId.slice(-6)}）のままクラウドに正常に同期・移行されました！
                    </div>
                  ) : (
                    <div className="mt-2 p-2 bg-yellow-950/20 border border-yellow-500/10 rounded-lg text-[9px] text-gray-400 leading-normal">
                      💡 ログイン前（匿名状態）でカードを数回スワイプしてソウルを貯めてからログイン（Google/Mock）してください。数値がそのまま引き継がれることを確認できます。
                    </div>
                  )}
                </div>
              </div>

              {/* Session ID / Debug info at the bottom */}
              <div className="border-t border-gray-900 pt-4 mt-6 text-[10px] text-gray-500 space-y-1.5">
                <div>
                  <span className="font-bold text-gray-400 block mb-0.5">セッションID:</span>
                  <div className="flex items-center gap-1 bg-gray-950/60 border border-gray-900 px-2.5 py-1.5 rounded-lg select-all font-mono truncate text-[9px] text-gray-400">
                    {sessionId}
                  </div>
                </div>
                <div className="text-center text-[9px] text-gray-600 mt-2">
                  © 2026 gene46 Project. All rights reserved.
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Terms of Use Modal */}
      <AnimatePresence>
        {showTermsModal && (
          <div 
            onClick={() => setShowTermsModal(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-[#0a0b10] border border-gray-900 rounded-2xl p-6 shadow-2xl relative overflow-hidden text-left"
            >
              <div className="flex items-center justify-between mb-4 border-b border-gray-900 pb-3">
                <h3 className="text-sm font-bold text-gray-200">利用規約</h3>
                <button
                  onClick={() => setShowTermsModal(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-gray-400 space-y-3 max-h-[350px] overflow-y-auto pr-1 leading-relaxed scrollbar-thin scrollbar-thumb-purple-900">
                <h4 className="font-bold text-gray-200">1. はじめに</h4>
                <p>本規約は、AI生成遺伝子型ジェネレーティブアート探索ツール「gene46」（以下、「本サービス」）の利用条件を定めるものです。</p>
                
                <h4 className="font-bold text-gray-200">2. 知的財産権について</h4>
                <p>ユーザーが作成または分岐（フォーク）したスレッド、および本サービス内で生成された個体（スペックメン）の画像・DNAデータは、パブリックドメイン扱いとして扱われ、商用・非商用問わず誰でも自由に保存、コピー、改変、配布することができます。</p>
                
                <h4 className="font-bold text-gray-200">3. 禁止事項</h4>
                <p>・自動スクリプト、ボット等の使用によるサーバーへの過度なリクエスト送信<br/>・ハニーポットや検証システムを意図的にバイパスする行為<br/>・その他、本サービスのシステム運用を妨げる一切のハッキングや不正アクセス行為</p>

                <h4 className="font-bold text-gray-200">4. 免責事項</h4>
                <p>本サービスの利用に関連して発生したユーザーの損害について、運営者は一切の責任を負いません。また、予告なくサービス内容の変更、休止、進化シミュレーションの終了を行う場合があります。</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Privacy Policy Modal */}
      <AnimatePresence>
        {showPrivacyModal && (
          <div 
            onClick={() => setShowPrivacyModal(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-[#0a0b10] border border-gray-900 rounded-2xl p-6 shadow-2xl relative overflow-hidden text-left"
            >
              <div className="flex items-center justify-between mb-4 border-b border-gray-900 pb-3">
                <h3 className="text-sm font-bold text-gray-200">プライバシーポリシー</h3>
                <button
                  onClick={() => setShowPrivacyModal(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-gray-400 space-y-3 max-h-[350px] overflow-y-auto pr-1 leading-relaxed scrollbar-thin scrollbar-thumb-purple-900">
                <h4 className="font-bold text-gray-200">1. 収集する情報</h4>
                <p>本サービスは匿名でご利用いただけるため、氏名、メールアドレス、電話番号などの個人情報は一切収集いたしません。</p>
                <p>本サービスでは、個人の識別およびスワイプや投票の重複を防ぐため、自動生成されたランダムなUUID形式の「セッションID」のみをブラウザのLocalStorageに保存し、バックエンドのデータベース（D1）と連携します。</p>

                <h4 className="font-bold text-gray-200">2. 情報の利用目的</h4>
                <p>収集された匿名セッションIDは、以下の目的のためにのみ利用されます。<br/>・スワイプスタミナおよびソウルの整合性管理<br/>・スレッドの作成権・所有権の識別<br/>・ボット等による不正行為、不正投票の検知および防御</p>

                <h4 className="font-bold text-gray-200">3. セキュリティおよびCloudflareの利用</h4>
                <p>本サービスはCloudflare Workers及びCloudflare D1で運用されており、不正アクセスを防ぐためのボット防御機能（Turnstileなど）が適用されます。セッションIDを含むローカルストレージの整合性は、暗号署名及びハッシュチェックサムによって検証され、改ざんを防いでいます。</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Report a Problem Modal */}
      <AnimatePresence>
        {showReportModal && (
          <div 
            onClick={() => setShowReportModal(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-[#0a0b10] border border-gray-900 rounded-2xl p-6 shadow-2xl relative overflow-hidden text-left"
            >
              <div className="flex items-center justify-between mb-4 border-b border-gray-900 pb-3">
                <h3 className="text-sm font-bold text-gray-200">問題報告・ご意見</h3>
                <button
                  onClick={() => setShowReportModal(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmitReport} className="space-y-4 relative z-10 text-left">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-1.5">
                    カテゴリー
                  </label>
                  <select
                    value={reportCategory}
                    onChange={(e) => setReportCategory(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-900 rounded-xl px-3 py-2.5 text-xs text-gray-300 outline-none focus:border-purple-500/50 transition-colors cursor-pointer"
                  >
                    <option value="不具合">不具合・バグ報告</option>
                    <option value="機能要望">新機能の要望</option>
                    <option value="デザイン">デザイン・UIへの不満</option>
                    <option value="その他">その他・感想</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-1.5">
                    詳細内容
                  </label>
                  <textarea
                    required
                    rows={5}
                    maxLength={1000}
                    placeholder="不具合の再現手順やご意見を詳しく入力してください。"
                    value={reportDesc}
                    onChange={(e) => setReportDesc(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-900 rounded-xl px-3 py-2.5 text-xs text-gray-300 outline-none focus:border-purple-500/50 transition-colors resize-none placeholder:text-gray-700"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingReport}
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl text-xs font-bold transition-all hover:from-purple-500 hover:to-indigo-500 hover:shadow-lg hover:shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {submittingReport && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  報告を送信する
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <div id="turnstile-container" className="hidden" />
    </div>
  );
}
