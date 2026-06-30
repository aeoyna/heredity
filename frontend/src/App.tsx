import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Sparkles, RefreshCw, ShieldAlert, Plus, X, Star, Trash2, ShoppingCart, List, Diamond, Download, GitFork, Dna, Copy, Pencil, Battery, ArrowUpCircle, Search, Volume2, VolumeX, Share2, ShoppingBag, Users } from 'lucide-react';
import type { LineDNA, MosaicDNA } from '../../backend/src/shared-types';
import { SwipeCard } from './components/SwipeCard';
import { LineCanvas } from './components/LineCanvas';
import { MosaicCanvas } from './components/MosaicCanvas';
import { NoiseCard } from './components/NoiseCard';
import { AdBanner } from './components/AdBanner';
import { initGA, logPageView, logEvent } from './utils/analytics';
import {
  playClick, 
  playSwipeLike, 
  playSwipeNope, 
  playEvolve, 
  playPurchase, 
  playCreate, 
  playError,
  setSoundEnabled,
  getSoundEnabled
} from './utils/sound';

const BlueFire = () => (
  <span className="inline-block mr-0.5" style={{ filter: 'hue-rotate(195deg) saturate(1.6) brightness(1.1)', transform: 'translateY(-1px)' }}>🔥</span>
);

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
  isAdFree: boolean,
  outs = 0,
  lastOutRecoveryTime = 0,
  swipesSinceLastOutRecovery = 0
): string => {
  const payload = `${stamina}:${maxStamina}:${lifetimeSwipes}:${lastRecovery}:${souls}:${isAdFree ? 1 : 0}:${outs}:${lastOutRecoveryTime}:${swipesSinceLastOutRecovery}:${SIGNATURE_SALT}`;
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
  outs: number;
  lastOutRecoveryTime: number;
  swipesSinceLastOutRecovery: number;
}): string => {
  const checksum = calculateStaminaChecksum(
    data.stamina,
    data.maxStamina,
    data.lifetimeSwipes,
    data.lastRecoveryTime,
    data.souls,
    data.isAdFree,
    data.outs,
    data.lastOutRecoveryTime,
    data.swipesSinceLastOutRecovery
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
  outs: number;
  lastOutRecoveryTime: number;
  swipesSinceLastOutRecovery: number;
} | null => {
  try {
    const rawXored = atob(encoded);
    let decoded = '';
    for (let i = 0; i < rawXored.length; i++) {
      decoded += String.fromCharCode(rawXored.charCodeAt(i) ^ OBFS_KEY);
    }
    
    const parsed = JSON.parse(decoded);
    const isAdFree = typeof parsed.isAdFree === 'boolean' ? parsed.isAdFree : false;
    const outs = typeof parsed.outs === 'number' ? parsed.outs : 0;
    const lastOutRecoveryTime = typeof parsed.lastOutRecoveryTime === 'number' ? parsed.lastOutRecoveryTime : 0;
    const swipesSinceLastOutRecovery = typeof parsed.swipesSinceLastOutRecovery === 'number' ? parsed.swipesSinceLastOutRecovery : 0;

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
      isAdFree,
      outs,
      lastOutRecoveryTime,
      swipesSinceLastOutRecovery
    );
    
    if (calculatedChecksum !== parsed.checksum) {
      // Legacy checksum check for backward compatibility
      const legacyChecksum = calculateStaminaChecksum(
        parsed.stamina,
        parsed.maxStamina,
        parsed.lifetimeSwipes,
        parsed.lastRecoveryTime,
        parsed.souls,
        isAdFree,
        0, 0, 0
      );
      if (legacyChecksum !== parsed.checksum) {
        console.warn('Stamina integrity verification failed! Signature mismatch.');
        return null;
      }
    }
    
    return {
      stamina: parsed.stamina,
      maxStamina: parsed.maxStamina,
      lifetimeSwipes: parsed.lifetimeSwipes,
      lastRecoveryTime: parsed.lastRecoveryTime,
      souls: parsed.souls,
      isAdFree,
      outs,
      lastOutRecoveryTime,
      swipesSinceLastOutRecovery
    };
  } catch (e) {
    return null;
  }
};

interface CardData {
  id: string;
  generation: number;
  dna: LineDNA | MosaicDNA;
  is_honeypot?: boolean;
  required_swipe?: 'like' | 'nope';
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
  const [showStaminaModal, setShowStaminaModal] = useState<boolean>(false);

  // History Gallery State
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [historySpecimens, setHistorySpecimens] = useState<SpecimenData[]>([]);
  // Per-thread latest card preview (populated lazily as user visits threads)
  const [threadPreviews, setThreadPreviews] = useState<Record<string, { dna: any; type: 'line' | 'mosaic' }>>({});
  const [galleryLoading, setGalleryLoading] = useState<boolean>(false);
  const [historyViewMode, setHistoryViewMode] = useState<'grid' | 'flipbook'>('flipbook');
  const [flipbookIndex, setFlipbookIndex] = useState<number>(0);

  // App View State ('swipe' for swiping cards, 'threads' for threads explorer, 'shop' for soul shop)
  const [view, setView] = useState<'swipe' | 'threads' | 'shop'>('swipe');
  // Explorer Tab State ('all' for all threads, 'saved' for bookmarked ones)
  const [threadsTab, setThreadsTab] = useState<'all' | 'saved'>('all');

  // Search State
  const [threadSearchQuery, setThreadSearchQuery] = useState<string>('');
  const [isSearchActive, setIsSearchActive] = useState<boolean>(false);
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

  // Commercial Modal Language State
  const [commercialLang, setCommercialLang] = useState<'ja' | 'en'>('ja');

  // Global/Menu Language State
  const [lang, setLang] = useState<'ja' | 'en'>(() => {
    try {
      const saved = localStorage.getItem('project_x_lang');
      return saved === 'en' ? 'en' : 'ja';
    } catch (e) {
      return 'ja';
    }
  });

  const changeLang = (newLang: 'ja' | 'en') => {
    setLang(newLang);
    setCommercialLang(newLang);
    try {
      localStorage.setItem('project_x_lang', newLang);
    } catch (e) {}
  };

  // Sound Muted/Enabled State
  const [soundEnabledState, setSoundEnabledState] = useState<boolean>(() => {
    return getSoundEnabled();
  });

  const toggleSound = () => {
    const newVal = !soundEnabledState;
    setSoundEnabledState(newVal);
    setSoundEnabled(newVal);
    if (newVal) {
      setTimeout(() => {
        playClick();
      }, 50);
    }
  };
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
    outs: number;
    lastOutRecoveryTime: number;
    swipesSinceLastOutRecovery: number;
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
      isAdFree: false,
      outs: 0,
      lastOutRecoveryTime: 0,
      swipesSinceLastOutRecovery: 0
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
          isAdFree: data.isAdFree,
          outs: data.outs,
          lastOutRecoveryTime: data.lastOutRecoveryTime,
          swipesSinceLastOutRecovery: data.swipesSinceLastOutRecovery
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
            isAdFree: merged.isAdFree,
            outs: merged.outs ?? 0,
            lastOutRecoveryTime: merged.lastOutRecoveryTime ?? 0,
            swipesSinceLastOutRecovery: merged.swipesSinceLastOutRecovery ?? 0
          };
          localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
          setStaminaData(nextData);
        }
      }
    } catch (e) {
      console.error('Failed to sync stamina with server:', e);
    }
  };

  // Countdown Timer Update Hook
  const [nowTime, setNowTime] = useState<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Time-based Out Recovery Hook (1 hour per out)
  useEffect(() => {
    if (staminaData.outs > 0 && staminaData.lastOutRecoveryTime > 0) {
      const checkRecovery = () => {
        const now = Date.now();
        const elapsed = now - staminaData.lastOutRecoveryTime;
        const OUT_RECOVERY_INTERVAL = 3600000; // 1 hour
        
        if (elapsed >= OUT_RECOVERY_INTERVAL) {
          const outsToRecover = Math.floor(elapsed / OUT_RECOVERY_INTERVAL);
          setStaminaData(prev => {
            const nextOuts = Math.max(0, prev.outs - outsToRecover);
            const nextTime = nextOuts === 0 ? 0 : prev.lastOutRecoveryTime + outsToRecover * OUT_RECOVERY_INTERVAL;
            const nextData = {
              ...prev,
              outs: nextOuts,
              lastOutRecoveryTime: nextTime,
              swipesSinceLastOutRecovery: nextOuts === 0 ? 0 : prev.swipesSinceLastOutRecovery
            };
            localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
            syncStaminaWithServer(nextData);
            setTimeout(() => {
              showMsg(lang === 'en' ? `💚 Recovered ${outsToRecover} out(s) over time! (Current outs: ${nextOuts}/3)` : `💚 時間経過によりアウトが${outsToRecover}個回復しました！(現在のアウト数: ${nextOuts}/3)`, 'success');
            }, 100);
            return nextData;
          });
        }
      };
      
      checkRecovery();
      const timer = setInterval(checkRecovery, 5000); // check every 5 seconds
      return () => clearInterval(timer);
    }
  }, [staminaData.outs, staminaData.lastOutRecoveryTime]);

  // Left Drawer & Legal/Report Modals
  const [showDrawer, setShowDrawer] = useState<boolean>(false);
  const [pendingSwipes, setPendingSwipes] = useState<{ card_id: string; swipe: 'like' | 'nope' }[]>([]);
  const [showChargeEffect, setShowChargeEffect] = useState<boolean>(false);
  const [newGenNotification, setNewGenNotification] = useState<number | null>(null);
  const [showTermsModal, setShowTermsModal] = useState<boolean>(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState<boolean>(false);
  const [showCommercialModal, setShowCommercialModal] = useState<boolean>(false);
  const [showLimitsModal, setShowLimitsModal] = useState<boolean>(false);
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [contactCategory, setContactCategory] = useState<'bug' | 'other'>('bug');

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

  const handleSwipeStateUpdate = (isAd = false, isIncorrectHoneypot = false) => {
    setStaminaData(prev => {
      const nextSwipes = prev.lifetimeSwipes + 1;
      
      // Determine souls gained
      let nextSouls = prev.souls;
      if (isIncorrectHoneypot) {
        // No souls for incorrect ad swipe
      } else if (isAd) {
        nextSouls += 3;
      } else {
        nextSouls += 1;
      }

      const newStamina = (isAd || prev.maxStamina >= 9999) ? prev.stamina : Math.max(0, prev.stamina - 1);
      
      let nextOuts = prev.outs;
      let nextLastOutRecoveryTime = prev.lastOutRecoveryTime;
      let nextSwipesSinceLastOutRecovery = prev.swipesSinceLastOutRecovery;

      if (isIncorrectHoneypot) {
        nextOuts = Math.min(3, prev.outs + 1);
        if (prev.outs === 0) {
          nextLastOutRecoveryTime = Date.now();
        }
      } else if (!isAd) {
        // Recover out with swipes
        if (nextOuts > 0) {
          nextSwipesSinceLastOutRecovery += 1;
          if (nextSwipesSinceLastOutRecovery >= 100) {
            nextOuts = Math.max(0, nextOuts - 1);
            nextSwipesSinceLastOutRecovery = 0;
            if (nextOuts === 0) {
              nextLastOutRecoveryTime = 0;
            } else {
              nextLastOutRecoveryTime = Date.now();
            }
            setTimeout(() => {
              showMsg(lang === 'en' ? `💚 100 swipes reached! Recovered 1 out! (Current outs: ${nextOuts}/3)` : `💚 100スワイプ達成！アウトが1個回復しました！(現在のアウト数: ${nextOuts}/3)`, 'success');
            }, 100);
          }
        }
      }

      const nextData = {
        ...prev,
        stamina: newStamina,
        lifetimeSwipes: nextSwipes,
        souls: nextSouls,
        lastRecoveryTime: prev.stamina >= prev.maxStamina ? Date.now() : prev.lastRecoveryTime,
        outs: nextOuts,
        lastOutRecoveryTime: nextLastOutRecoveryTime,
        swipesSinceLastOutRecovery: nextSwipesSinceLastOutRecovery
      };

      localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));

      return nextData;
    });
  };

  const buyStaminaRecovery = (qty: number = 1) => {
    setStaminaData(prev => {
      const cost = 300 * qty;
      if (prev.souls < cost) {
        showMsg(lang === 'en' ? `Not enough Souls! (Required: ${cost} Souls)` : `Soulが足りません！（必要: ${cost} Soul）`, 'error');
        playError();
        return prev;
      }
      const newStamina = prev.stamina + 10 * qty;
      const nextData = {
        ...prev,
        stamina: newStamina,
        souls: prev.souls - cost
      };
      localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
      showMsg(lang === 'en' ? `Recovered ${10 * qty} stamina!` : `スタミナを${10 * qty}回復しました！`, 'success');
      playPurchase();
      syncStaminaWithServer(nextData);
      logEvent('shop_purchase', { item_type: 'stamina_recovery', cost, quantity: qty });
      return nextData;
    });
  };

  const buyMaxStaminaUpgrade = (qty: number = 1) => {
    setStaminaData(prev => {
      const cost = 1000 * qty;
      if (prev.souls < cost) {
        showMsg(lang === 'en' ? `Not enough Souls! (Required: ${cost} Souls)` : `Soulが足りません！（必要: ${cost} Soul）`, 'error');
        playError();
        return prev;
      }
      const newMax = prev.maxStamina + 5 * qty;
      const newStamina = prev.stamina + 5 * qty; // Also increase current stamina by 5 * qty
      const nextData = {
        ...prev,
        stamina: newStamina,
        maxStamina: newMax,
        souls: prev.souls - cost
      };
      localStorage.setItem('project_x_stamina_data', serializeAndSign(nextData));
      showMsg(lang === 'en' ? `Max stamina increased to ${newMax}!` : `スタミナ上限が ${newMax} にアップしました！`, 'success');
      playPurchase();
      syncStaminaWithServer(nextData);
      logEvent('shop_purchase', { item_type: 'max_stamina_upgrade', cost, quantity: qty });
      return nextData;
    });
  };



  const handleStripePurchase = async (item: 'souls_500' | 'souls_1500' | 'souls_4000') => {
    if (sessionType === 'anonymous') {
      showMsg(lang === 'en' ? 'You need to log in to make a purchase.' : '商品を購入するにはログインが必要です。', 'error');
      setShowAuthModal(true);
      playError();
      return;
    }
    try {
      showMsg(lang === 'en' ? 'Redirecting to checkout...' : '決済画面へ移動しています...', 'info');
      const res = await fetch(`${API_BASE}/api/stripe/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ item })
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || (lang === 'en' ? 'Failed to create checkout session' : '決済セッションの作成に失敗しました'));
      }

      const data = await res.json();
      if (data.url) {
        // Track checkout initiation
        const value = item === 'souls_500' ? 1.99 : item === 'souls_1500' ? 4.99 : item === 'souls_4000' ? 9.99 : 0;
        logEvent('begin_checkout', {
          value: value,
          currency: 'USD',
          items: [{ item_id: item, item_name: item, price: value, quantity: 1 }]
        });
        window.location.href = data.url;
      } else {
        throw new Error(lang === 'en' ? 'No checkout URL returned' : '決済URLが返されませんでした');
      }
    } catch (err: any) {
      console.error('Stripe purchase error:', err);
      showMsg(lang === 'en' ? `Payment error: ${err.message}` : `決済エラー: ${err.message}`, 'error');
      playError();
    }
  };

  const [sessionId, setSessionId] = useState<string>('');
  const [staminaRecoveryQty, setStaminaRecoveryQty] = useState<number>(1);
  const [maxStaminaUpgradeQty, setMaxStaminaUpgradeQty] = useState<number>(1);
  const [showBuySoulsModal, setShowBuySoulsModal] = useState<boolean>(false);
  const [sessionType, setSessionType] = useState<'anonymous' | 'authenticated'>('anonymous');
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticating' | 'authenticated' | 'error'>('checking');
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [country, setCountry] = useState<string>('JP');

  // Fetch user country for targeted ads
  useEffect(() => {
    const fetchCountry = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const testCountry = params.get('test_country');
        const url = testCountry 
          ? `${API_BASE}/api/geo?test_country=${testCountry}` 
          : `${API_BASE}/api/geo`;

        const res = await fetch(url, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.country) {
            setCountry(data.country);
          }
        }
      } catch (err) {
        console.error('Failed to fetch country geo information:', err);
      }
    };
    fetchCountry();
  }, []);

  // Check auth status on mount
  useEffect(() => {
    initGA();
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

  // Log virtual PageView on view change
  useEffect(() => {
    logPageView(`/${view}`);
  }, [view]);

  // Dynamic Document Title and Meta Tags based on language
  useEffect(() => {
    const isEn = lang === 'en';
    const titleText = isEn 
      ? "gene46 | Swipe Genetic Algorithm Evolution System" 
      : "gene46 | スワイプ遺伝的アルゴリズム進化システム";
    const descText = isEn 
      ? "A genetic algorithm simulation game where you select and eliminate AI cards by swiping, and evolve them over generations. Create your own evolutionary tree."
      : "スワイプでAIカードを選択淘汰し、世代を重ねて進化させる遺伝的アルゴリズムシミュレーションゲーム。自分だけの進化系統樹を作り出そう。";
    const keywordsText = isEn
      ? "genetic algorithm, AI evolution, swipe game, simulation, natural selection, gene46"
      : "遺伝的アルゴリズム, AI進化, スワイプゲーム, シミュレーション, 選択淘汰, gene46";

    document.title = titleText;

    // Update Meta Description
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) metaDescription.setAttribute('content', descText);

    // Update og:description
    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) ogDescription.setAttribute('content', descText);

    // Update twitter:description
    const twitterDescription = document.querySelector('meta[property="twitter:description"]');
    if (twitterDescription) twitterDescription.setAttribute('content', descText);

    // Update og:title
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', titleText);

    // Update twitter:title
    const twitterTitle = document.querySelector('meta[property="twitter:title"]');
    if (twitterTitle) twitterTitle.setAttribute('content', titleText);

    // Update keywords
    const metaKeywords = document.querySelector('meta[name="keywords"]');
    if (metaKeywords) metaKeywords.setAttribute('content', keywordsText);

    // Update HTML lang attribute
    document.documentElement.setAttribute('lang', isEn ? 'en' : 'ja');
  }, [lang]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error');
    if (errorParam) {
      showMsg(lang === 'en' ? `Login error: ${errorParam}` : `ログインエラー: ${errorParam}`, 'error');
      const url = new URL(window.location.href);
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
    }

    // Google Login Success Tracking
    const tokenParam = params.get('token');
    if (tokenParam) {
      logEvent('login', { method: 'Google' });
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
    }

    const paymentParam = params.get('payment');
    if (paymentParam === 'success') {
      const itemParam = params.get('item') || 'unknown';
      let value = 0;
      if (itemParam === 'souls_500') value = 1.99;
      else if (itemParam === 'souls_1500') value = 4.99;
      else if (itemParam === 'souls_4000') value = 9.99;

      logEvent('purchase', {
        transaction_id: `tx_${Date.now()}`,
        value: value,
        currency: 'USD',
        items: [{ item_id: itemParam, item_name: itemParam, price: value, quantity: 1 }]
      });

      showMsg(lang === 'en' ? '🎉 Thank you for your purchase! Premium features have been activated.' : '🎉 ご購入ありがとうございます！プレミアム機能が有効化されました。', 'success');
      playPurchase();
      const url = new URL(window.location.href);
      url.searchParams.delete('payment');
      url.searchParams.delete('item');
      window.history.replaceState({}, '', url.toString());
      syncStaminaWithServer();
    } else if (paymentParam === 'cancel') {
      showMsg(lang === 'en' ? 'Payment was cancelled.' : '決済がキャンセルされました。', 'info');
      const url = new URL(window.location.href);
      url.searchParams.delete('payment');
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
          showMsg(lang === 'en' ? 'Session started (silent auth)' : 'セッションを開始しました（サイレント認証）', 'success');
        }
      } catch (err: any) {
        console.error('Silent auth error:', err);
        showMsg(lang === 'en' ? `Authentication failed: ${err.message}` : `認証に失敗しました: ${err.message}`, 'error');
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
        showMsg(lang === 'en' ? `You can only favorite up to ${THREAD_FAVORITES_LIMIT} projects.` : `プロジェクトのお気に入りは${THREAD_FAVORITES_LIMIT}件までです。`, 'error');
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
        } else {
          setLoading(false);
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
      setLoading(false);
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
        setFlipbookIndex(historyData.history.length - 1);
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
            showMsg(
              lang === 'ja'
                ? `すべての個体をスワイプ完了！${data.generation}世代へ自動進化しました`
                : `All specimens swiped! Auto-evolved to Gen ${data.generation}`,
              'success'
            );
            playEvolve();
            setNewGenNotification(data.generation);
            logEvent('thread_evolve', { thread_id: activeThreadId || '', generation: data.generation });
            setTimeout(() => {
              setNewGenNotification(null);
            }, 1200);
          }
        }
        setGeneration(data.generation);
        generationRef.current = data.generation;
      }
    } catch (err: any) {
      console.error('Failed to fetch cards:', err);
      let errorMsg = err.message || 'Unknown error';
      if (err.message && err.message.includes('Failed to fetch') && window.location.hostname === 'localhost') {
        errorMsg = lang === 'ja'
          ? 'ローカルのバックエンドに接続できません。Wrangler開発サーバーがポート8787で起動しているか確認してください。'
          : 'Cannot connect to local backend. Make sure the local Wrangler dev server is running on port 8787.';
      }
      showMsg(
        lang === 'ja'
          ? `カードの取得に失敗しました: ${errorMsg}`
          : `Failed to fetch cards: ${errorMsg}`,
        'error'
      );
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
        logEvent('login', { method: 'Mock' });
        setSessionType('authenticated');
        setShowAuthModal(false);
        showMsg(lang === 'en' ? '🎉 Logged in! (Dev Account)' : '🎉 ログイン完了！（開発用アカウント）', 'success');
      }
    } catch (err: any) {
      console.error(err);
      showMsg(lang === 'en' ? 'Mock login failed' : 'モックログインに失敗しました', 'error');
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
    if (!window.confirm(lang === 'en' ? 'Are you sure you want to log out?\n(You will be logged out from this device, data will be reset, and a new anonymous account will be created)' : '本当にログアウトしますか？\n（現在のデバイスでログイン状態が解除され、データがリセットされて新しい匿名アカウントになります）')) {
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
        
        showMsg(lang === 'en' ? 'Logged out. Restarting...' : 'ログアウトしました。再起動しています...', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } else {
        showMsg(lang === 'en' ? 'Failed to log out.' : 'ログアウトに失敗しました。', 'error');
      }
    } catch (err) {
      console.error('Logout error:', err);
      showMsg(lang === 'en' ? 'An error occurred during logout.' : 'ログアウト中にエラーが発生しました。', 'error');
    }
  };

  // Helper for messages
  const showMsg = (text: string, type: 'info' | 'error' | 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  // Submit Swipe Bulk to API
  const submitSwipesBulk = async (swipesToSend: { card_id: string; swipe: 'like' | 'nope' }[]) => {
    if (!activeThreadId) return;
    try {
      const response = await fetch(`${API_BASE}/api/swipe/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          thread_id: activeThreadId,
          swipes: swipesToSend,
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
      console.error('Failed to submit swipes in bulk:', err);
      showMsg(`Failed to submit swipes: ${err.message}`, 'error');
      playError();
    }
  };

  // Handle Swipe interaction
  const handleSwipe = (direction: 'like' | 'nope', cardId: string) => {
    if (staminaData.lifetimeSwipes > 0 && sessionType === 'anonymous') {
      playClick();
      setShowAuthModal(true);
      return;
    }

    const card = cards.find(c => c.id === cardId);
    const isAd = card?.is_honeypot === true;

    if (!isAd && staminaData.stamina <= 0 && staminaData.maxStamina < 9999) {
      setShowStaminaModal(true);
      playError();
      return;
    }
    
    const isTestSwipe = staminaData.lifetimeSwipes === 0;

    if (direction === 'like') {
      playSwipeLike();
    } else {
      playSwipeNope();
    }

    // Add to pending batch
    const newSwipe = { card_id: cardId, swipe: direction };
    const nextPending = [...pendingSwipes, newSwipe];
    
    swipedCardIdsRef.current.push(cardId);

    if (isAd) {
      const correctSwipe = card?.required_swipe;
      const isCorrect = direction === correctSwipe;
      
      if (isCorrect) {
        showMsg(lang === 'en' ? '✅ Correct swipe! Bypassed ad card.' : '✅ 正しいスワイプ！広告をバイパスしました', 'success');
        handleSwipeStateUpdate(true, false);
        logEvent('swipe_card', { direction, is_ad: true, is_correct: true, card_id: cardId });
      } else {
        const nextOuts = Math.min(3, staminaData.outs + 1);
        playError();
        showMsg(lang === 'en' ? `🚨 Swiped in the wrong direction! (Outs: ${nextOuts}/3)` : `🚨 指示と異なる方向にスワイプしました！ (アウト: ${nextOuts}/3)`, 'error');
        
        handleSwipeStateUpdate(true, true);
        logEvent('swipe_card', { direction, is_ad: true, is_correct: false, card_id: cardId });
        
        if (nextOuts === 3) {
          logEvent('penalty_lock');
        }
        
        // Immediately sync stamina with server to prevent reset via reload
        const tempState = {
          ...staminaData,
          outs: nextOuts,
          lastOutRecoveryTime: staminaData.outs === 0 ? Date.now() : staminaData.lastOutRecoveryTime
        };
        syncStaminaWithServer(tempState);
      }
    } else {
      handleSwipeStateUpdate(false, false);
      logEvent('swipe_card', { direction, is_ad: false, card_id: cardId });
    }

    if (nextPending.length >= 25) {
      // Trigger bulk submit and effects
      submitSwipesBulk(nextPending);
      setPendingSwipes([]);
      
      // Sync stamina
      setTimeout(() => {
        syncStaminaWithServer();
      }, 500);

      // Play special charge animation
      playEvolve(); // reuse evolve sound for punchy feedback
      setShowChargeEffect(true);
      setTimeout(() => setShowChargeEffect(false), 2000);
      showMsg('✨ SPECIAL EFFECT CHARGE MAX! Swipes synced! ✨', 'success');
    } else {
      setPendingSwipes(nextPending);
    }

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
      showMsg(lang === 'en' ? `Not enough Souls! Requires ${cost} Souls. (Current: ${staminaData.souls} Souls)` : `Soulが足りません！作成には ${cost} Soulが必要です。（現在: ${staminaData.souls} Soul）`, 'error');
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

        showMsg(lang === 'en' ? `Created project "${data.thread.name}"! (Cost: ${cost} Souls)` : `プロジェクト「${data.thread.name}」を作成しました！（コスト: ${cost} Soul）`, 'success');
        playCreate();
        setNewThreadName('');
        setShowCreateModal(false);
        await fetchThreads(data.thread.id);
        logEvent('create_thread', { thread_name: data.thread.name, thread_type: newThreadType, cost });
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
    showMsg(lang === 'en' ? 'Image downloaded!' : '画像をダウンロードしました！', 'success');
  };

  const handleShareCard = async (card?: CardData) => {
    playClick();
    const shareTitle = 'gene46 | Genetic Evolutionary Simulation';
    
    let shareText = '';
    if (!card || card.id === 'general') {
      shareText = lang === 'en'
        ? `I am playing gene46, an AI evolutionary simulation game! Check it out!`
        : `AIをスワイプで進化淘汰させるシミュレーションゲーム「gene46」をプレイ中！みんなも遊んでみてね！`;
    } else {
      shareText = lang === 'en'
        ? `Check out gene46, a genetic algorithm simulation game! I evolved a specimen to Gen ${card.generation}!`
        : `スワイプでAIを進化させるシワイプシミュレーションゲーム「gene46」をプレイ中！第 ${card.generation} 世代の個体を保存しました！`;
    }
    const shareUrl = window.location.origin;

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        logEvent('share_card', { card_id: card?.id || 'general', method: 'web_share' });
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Error sharing:', err);
        }
      }
    } else {
      // Fallback: Copy link to clipboard
      try {
        await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
        showMsg(lang === 'en' ? 'Link copied to clipboard!' : 'リンクをクリップボードにコピーしました！', 'success');
        logEvent('share_card', { card_id: card?.id || 'general', method: 'clipboard' });
      } catch (err) {
        console.error('Clipboard copy failed:', err);
        showMsg(lang === 'en' ? 'Failed to copy link.' : 'リンクのコピーに失敗しました。', 'error');
      }
    }
  };

  const CARD_FAVORITES_LIMIT = 10;

  const toggleSaveCard = (card: CardData & { threadId?: string; threadName?: string; type?: 'line' | 'mosaic' }) => {
    const isAlreadySaved = savedCards.some(c => c.id === card.id);
    let updatedCards: SavedCard[] = [];
    if (isAlreadySaved) {
      updatedCards = savedCards.filter(c => c.id !== card.id);
      showMsg(lang === 'en' ? 'Removed card from favorites.' : 'カードをコレクションから削除しました。', 'info');
    } else {
      if (savedCards.length >= CARD_FAVORITES_LIMIT) {
        showMsg(lang === 'en' ? `You can only favorite up to ${CARD_FAVORITES_LIMIT} cards.` : `カードのお気に入りは${CARD_FAVORITES_LIMIT}件までです。`, 'error');
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
      showMsg(lang === 'en' ? 'Saved card to favorites!' : 'カードをコレクションに保存しました！', 'success');
    }
    setSavedCards(updatedCards);
    localStorage.setItem('project_x_saved_cards', JSON.stringify(updatedCards));
  };

  const handleForkThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard) return;
    if (!forkThreadName.trim()) {
      showMsg(lang === 'en' ? 'Project name is required' : 'プロジェクト名は必須です', 'error');
      playError();
      return;
    }
    const cost = 1000;
    if (staminaData.souls < cost) {
      showMsg(lang === 'en' ? `Not enough Souls! Requires ${cost} Souls.` : `Soulが足りません！作成には ${cost} Soulが必要です。`, 'error');
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

        showMsg(lang === 'en' ? `Created branch project "${data.thread.name}"! (Cost: ${cost} Souls)` : `分岐プロジェクト「${data.thread.name}」を作成しました！（コスト: ${cost} Soul）`, 'success');
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
      alert(lang === 'en' ? "For iOS (Safari), tap the Share icon at the bottom of the browser (square with up arrow) and select 'Add to Home Screen'.\n\nFor Android/Chrome etc., it may already be installed, or you can install it from the browser menu." : "iOS (Safari) の場合は、ブラウザ下部の共有アイコン（スクエアに上矢印）をタップし、「ホーム画面に追加」を選択してください。\n\nAndroid/Chrome等の場合は、すでにインストールされているか、ブラウザメニューからインストールできます。");
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

  const handleShare = async () => {
    playClick();
    const shareData = {
      title: 'gene46',
      text: lang === 'ja'
        ? 'スワイプ遺伝的アルゴリズム進化システム「gene46」で遊ぼう！'
        : 'Play gene46 - Swipe Genetic Algorithm Evolution System!',
      url: 'https://gene46.net/'
    };
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.log('Share cancelled or failed:', err);
      }
    } else {
      try {
        await navigator.clipboard.writeText('https://gene46.net/');
        showMsg(lang === 'ja' ? 'リンクをコピーしました！' : 'Link copied to clipboard!', 'success');
      } catch (err) {
        showMsg(lang === 'ja' ? 'コピーに失敗しました' : 'Failed to copy link', 'error');
      }
    }
  };

  const isWebView = () => {
    if (typeof window === 'undefined' || !window.navigator) return false;
    const ua = window.navigator.userAgent.toLowerCase();
    return (
      ua.includes('wv') ||
      ua.includes('webview') ||
      ua.includes('line') ||
      ua.includes('fbav') ||
      ua.includes('instagram') ||
      ua.includes('twitter') ||
      ua.includes('gsa') ||
      (ua.includes('safari') && ua.includes('fban') && ua.includes('fbios'))
    );
  };

  const handleOpenInBrowser = () => {
    playClick();
    const url = window.location.href;
    const ua = window.navigator.userAgent.toLowerCase();
    
    if (ua.includes('android')) {
      // Android: Force open in default browser using intent schema
      window.location.href = `intent://${window.location.host}${window.location.pathname}${window.location.search}#Intent;scheme=https;end`;
    } else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
      if (ua.includes('line')) {
        // LINE iOS has openExternalBrowser query param support
        const separator = url.includes('?') ? '&' : '?';
        window.location.href = `${url}${separator}openExternalBrowser=1`;
      } else {
        // iOS general fallback: copy URL to clipboard and alert
        navigator.clipboard.writeText(url).then(() => {
          alert(lang === 'ja'
            ? "URLリンクをコピーしました。SafariやChromeなどの標準ブラウザを起動し、アドレスバーに貼り付けてアクセスし直してください。"
            : "Link URL copied! Please open a standard browser like Safari or Chrome, and paste it into the address bar to continue.");
        }).catch(() => {
          alert(lang === 'ja'
            ? "Safariなどの標準ブラウザで https://gene46.net/ に直接アクセスしてください。"
            : "Please open Safari and navigate to https://gene46.net/ directly.");
        });
      }
    } else {
      window.open(url, '_blank');
    }
  };

  const copyToClipboard = (text: string, msg: string) => {
    navigator.clipboard.writeText(text).then(
      () => showMsg(msg, 'success'),
      () => showMsg('Failed to copy', 'error')
    );
  };

  // Delete Thread API Call
  const handleDeleteThread = async (threadId: string) => {
    const thread = threads.find(t => t.id === threadId);
    if (!thread) return;
    if (!window.confirm(lang === 'ja' ? `本当にプロジェクト「${thread.name}」を削除しますか？\n（この操作は取り消せません）` : `Are you sure you want to delete project "${thread.name}"?\n(This action cannot be undone)`)) {
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
        showMsg(lang === 'ja' ? `プロジェクト「${thread.name}」を削除しました。` : `Deleted project "${thread.name}".`, 'success');
        
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
      showMsg(lang === 'ja' ? 'プロジェクトの削除に失敗しました。' : 'Failed to delete project.', 'error');
    }
  };

  // Rename Thread API Call
  const handleRenameThread = async (threadId: string, currentName: string) => {
    const newName = window.prompt(lang === 'ja' ? '新しいプロジェクト名を入力してください：' : 'Please enter the new project name:', currentName);
    if (newName === null) return; // cancelled
    if (!newName.trim()) {
      showMsg(lang === 'ja' ? 'プロジェクト名は必須です。' : 'Project name is required.', 'error');
      return;
    }
    if (newName.trim() === currentName) return;

    try {
      const res = await fetch(`${API_BASE}/api/threads/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          thread_id: threadId,
          name: newName.trim()
        })
      });
      const data = await res.json();
      if (data.error) {
        showMsg(data.error, 'error');
      } else if (data.success) {
        showMsg(lang === 'ja' ? 'プロジェクト名を変更しました。' : 'Project name updated.', 'success');
        playClick();
        setThreads(prev => prev.map(t => t.id === threadId ? { ...t, name: newName.trim() } : t));
      }
    } catch (err) {
      console.error(err);
      showMsg(lang === 'en' ? 'Failed to rename project.' : '名称の変更に失敗しました。', 'error');
    }
  };



  const renderSidebarContent = (isDrawer: boolean) => {
    return (
      <div className="flex flex-col justify-between h-full">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-900 pb-4 mb-6">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="text-base font-bold text-gray-200 tracking-wider">
                {lang === 'ja' ? 'gene46 メニュー' : 'gene46 Menu'}
              </span>
            </div>
            {isDrawer && (
              <button
                onClick={() => setShowDrawer(false)}
                className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                title={lang === 'ja' ? '閉じる' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Quick Settings Row */}
          <div className="flex items-center justify-between bg-gray-950/40 border border-gray-900 rounded-xl px-4 py-2.5 mb-4 text-xs">
            {/* Language Switcher */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                {lang === 'ja' ? '言語' : 'Language'}
              </span>
              <div className="flex p-0.5 bg-black/40 border border-gray-900 rounded-lg font-bold text-[9px]">
                <button
                  onClick={() => { playClick(); changeLang('ja'); }}
                  className={`px-2 py-0.5 rounded transition-all ${
                    lang === 'ja'
                      ? 'bg-purple-600/20 text-purple-300 border border-purple-500/10'
                      : 'text-gray-500 hover:text-gray-400 border border-transparent'
                  }`}
                >
                  JP
                </button>
                <button
                  onClick={() => { playClick(); changeLang('en'); }}
                  className={`px-2 py-0.5 rounded transition-all ${
                    lang === 'en'
                      ? 'bg-purple-600/20 text-purple-300 border border-purple-500/10'
                      : 'text-gray-500 hover:text-gray-400 border border-transparent'
                  }`}
                >
                  EN
                </button>
              </div>
            </div>

            {/* Sound Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                {lang === 'ja' ? '音量' : 'Audio'}
              </span>
              <button
                onClick={toggleSound}
                className={`p-1 rounded-lg border transition-all flex items-center justify-center ${
                  soundEnabledState
                    ? 'bg-purple-950/20 border-purple-500/20 text-purple-400 hover:bg-purple-950/40'
                    : 'bg-gray-950 border-gray-900 text-gray-600 hover:bg-gray-900'
                }`}
                title={soundEnabledState ? (lang === 'ja' ? 'ミュートにする' : 'Mute') : (lang === 'ja' ? '音声を有効化' : 'Unmute')}
              >
                {soundEnabledState ? (
                  <Volume2 className="w-3.5 h-3.5" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="space-y-4">
            {/* Account Section */}
            <div>
              {sessionType === 'anonymous' ? (
                <button
                  onClick={() => {
                    playClick();
                    handleClerkUpgrade();
                  }}
                  className="w-full text-left px-4 py-3 bg-gradient-to-r from-purple-600/20 to-indigo-600/20 border border-purple-500/30 hover:border-purple-500/60 rounded-xl text-xs font-bold text-purple-200 hover:text-white transition-all flex items-center justify-between shadow-lg shadow-purple-950/20"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    {lang === 'ja' ? 'クラウドに保存（ログイン）' : 'Save to Cloud (Login)'}
                  </span>
                  <span className="text-purple-400 text-[10px]">→</span>
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="w-full px-4 py-2.5 bg-emerald-950/10 border border-emerald-500/20 rounded-xl text-[11px] font-bold text-emerald-400 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {lang === 'ja' ? 'クラウド同期済み（登録済）' : 'Synced to Cloud (Registered)'}
                  </div>
                  <button
                    onClick={() => {
                      playClick();
                      handleLogout();
                    }}
                    className="w-full text-left px-4 py-2 bg-rose-950/10 border border-rose-500/10 hover:border-rose-500/30 rounded-lg text-[9px] font-bold text-rose-400 hover:text-rose-300 transition-all flex items-center justify-between"
                  >
                    <span>{lang === 'ja' ? 'アカウントのログアウト' : 'Logout Account'}</span>
                    <span className="text-rose-400 opacity-60">→</span>
                  </button>
                </div>
              )}
            </div>

            {/* Document Links Section */}
            <div className="bg-gray-950/40 border border-gray-900 rounded-xl overflow-hidden divide-y divide-gray-900/60">
              <button
                onClick={() => {
                  setShowTermsModal(true);
                }}
                className="w-full text-left px-4 py-3 hover:bg-gray-900/40 text-xs font-semibold text-gray-300 hover:text-white transition-all flex items-center justify-between border-none"
              >
                <span>{lang === 'ja' ? '利用規約' : 'Terms of Service'}</span>
                <span className="text-gray-600 text-[10px]">→</span>
              </button>

              <button
                onClick={() => {
                  setShowPrivacyModal(true);
                }}
                className="w-full text-left px-4 py-3 hover:bg-gray-900/40 text-xs font-semibold text-gray-300 hover:text-white transition-all flex items-center justify-between border-none"
              >
                <span>{lang === 'ja' ? 'プライバシーポリシー' : 'Privacy Policy'}</span>
                <span className="text-gray-600 text-[10px]">→</span>
              </button>

              <button
                onClick={() => {
                  setShowCommercialModal(true);
                }}
                className="w-full text-left px-4 py-3 hover:bg-gray-900/40 text-xs font-semibold text-gray-300 hover:text-white transition-all flex items-center justify-between border-none"
              >
                <span>{lang === 'ja' ? '特定商取引法に基づく表記・返金' : 'Legal & Refund Policy'}</span>
                <span className="text-gray-600 text-[10px]">→</span>
              </button>

              <button
                onClick={() => {
                  setShowLimitsModal(true);
                }}
                className="w-full text-left px-4 py-3 hover:bg-gray-900/40 text-xs font-semibold text-gray-300 hover:text-white transition-all flex items-center justify-between border-none"
              >
                <span>{lang === 'ja' ? '使用制限' : 'Usage Limits'}</span>
                <span className="text-gray-600 text-[10px]">→</span>
              </button>

              <button
                onClick={() => {
                  playClick();
                  setShowReportModal(true);
                  setShowDrawer(false);
                }}
                className="w-full text-left px-4 py-3 hover:bg-gray-900/40 text-xs font-semibold text-gray-300 hover:text-white transition-all flex items-center justify-between border-none"
              >
                <span>{lang === 'ja' ? 'お問い合わせ' : 'Contact & Support'}</span>
                <span className="text-gray-600 text-[10px]">→</span>
              </button>
            </div>
          </nav>
        </div>

        {/* Session ID / Debug info at the bottom */}
        <div className="border-t border-gray-900 pt-4 mt-6 text-[8px] text-gray-600 space-y-1">
          <div className="flex items-center justify-between text-gray-500">
            <span>Session ID:</span>
            <span className="font-mono truncate max-w-[160px]" title={sessionId}>{sessionId.slice(-12)}</span>
          </div>
          <div className="text-center mt-2">
            © 2026 gene46 Project. All rights reserved.
          </div>
        </div>
      </div>
    );
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
          <div className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-300 to-gray-500 tracking-widest animate-pulse">gene46</div>
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
    <div className="h-[100dvh] bg-[#07080d] text-gray-100 flex flex-row items-stretch justify-between font-sans selection:bg-purple-600 selection:text-white relative overflow-hidden">
      
      {/* PC版の左サイドバー (常時展開メニュー) */}
      <div className="hidden lg:flex w-[280px] sm:w-[320px] bg-[#090a0f]/95 border-r border-gray-900 p-6 flex-col justify-between shadow-2xl backdrop-blur-md text-left flex-shrink-0 z-20">
        {renderSidebarContent(false)}
      </div>

      {/* 中央：元のスマホ向け画面 */}
      <div className="flex-1 flex flex-col items-center justify-between relative overflow-hidden pb-2 sm:pb-3 md:pb-4 max-w-lg mx-auto">
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
              <Star className={`w-5 h-5 ${view === 'threads' && threadsTab === 'saved' ? 'fill-purple-400' : ''}`} />
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
                            showMsg(lang === 'en' ? 'Copied project share link!' : 'プロジェクトの共有リンクをコピーしました！', 'success');
                          })
                          .catch(() => {
                            showMsg(lang === 'en' ? 'Failed to copy' : 'コピーに失敗しました', 'error');
                          });
                      }}
                      className="p-1 text-gray-500 hover:text-purple-400 hover:bg-purple-950/30 rounded transition-colors flex-shrink-0"
                      title={lang === 'en' ? 'Copy project link' : 'プロジェクトのリンクをコピー'}
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="px-2 py-0.5 text-[8px] rounded bg-purple-950/30 border border-purple-500/10 text-purple-300 font-medium">
                      {activeThread.type === 'line' ? (lang === 'en' ? 'Line' : 'ライン') : (lang === 'en' ? 'Mosaic' : 'モザイク')}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent opening the threads screen
                        playClick();
                        toggleSaveThread(activeThread.id);
                      }}
                      className="p-1 hover:bg-purple-950/30 rounded transition-colors flex items-center justify-center flex-shrink-0"
                      title={savedThreadIds.includes(activeThread.id) ? (lang === 'en' ? 'Remove from favorites' : 'お気に入り解除') : (lang === 'en' ? 'Add to favorites' : 'お気に入り登録')}
                    >
                      <Star className={`w-3.5 h-3.5 transition-all ${
                        savedThreadIds.includes(activeThread.id)
                          ? 'fill-purple-400 text-purple-400'
                          : 'text-gray-500 hover:text-purple-400'
                      }`} />
                    </button>
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
                {/* Fullscreen/Center Generation Transition VFX */}
                <AnimatePresence>
                  {newGenNotification !== null && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.6, y: 15 }}
                      animate={{ opacity: 1, scale: 1.0, y: 0 }}
                      exit={{ opacity: 0, scale: 1.2, y: -15 }}
                      transition={{ duration: 0.35, ease: "easeOut" }}
                      className="absolute z-40 pointer-events-none flex flex-col items-center justify-center bg-black/80 border border-purple-500/20 px-8 py-6 rounded-3xl shadow-[0_0_40px_rgba(168,85,247,0.35)] backdrop-blur-md"
                      style={{ fontFamily: "'Outfit', sans-serif" }}
                    >
                      <span className="text-[9px] text-purple-400 font-extrabold uppercase tracking-[0.25em] mb-1">
                        {lang === 'ja' ? '進化完了' : 'Evolution Advanced'}
                      </span>
                      <h2 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-yellow-300 via-pink-400 to-purple-400 drop-shadow-[0_0_8px_rgba(253,224,71,0.5)]">
                        {lang === 'ja' ? `${newGenNotification}世代` : `Gen ${newGenNotification}`}
                      </h2>
                    </motion.div>
                  )}
                </AnimatePresence>

                {staminaData.outs === 3 && !staminaData.isAdFree ? (
                  <div className="text-center p-6 bg-[#0c0e15]/95 border border-red-500/20 rounded-3xl flex flex-col items-center justify-center w-full h-full relative overflow-hidden backdrop-blur-lg shadow-2xl z-30"
                       style={{ fontFamily: "'Outfit', sans-serif" }}>
                    <div className="absolute top-[-20%] w-[60%] h-[40%] rounded-full bg-red-500/10 blur-3xl pointer-events-none" />
                    <ShieldAlert className="w-12 h-12 text-red-500 animate-pulse mb-3" />
                    <h3 className="text-base font-black text-red-400 uppercase tracking-widest mb-2">
                      {lang === 'en' ? '🚨 Penalty Active' : '🚨 ペナルティ発生中'}
                    </h3>
                    <p className="text-[11px] text-gray-400 leading-relaxed max-w-[260px] mb-4 text-center">
                      {lang === 'en' ? 'You swiped in the opposite direction of the noise card instructions and have been locked.' : 'ノイズカードの指示とは異なる方向にスワイプしたため、ロックされました。'}
                    </p>
                    <div className="bg-black/40 border border-red-950 px-4 py-2 rounded-xl mb-5 font-mono">
                      <span className="text-[10px] text-gray-500 block mb-0.5 uppercase tracking-wider">
                        {lang === 'en' ? 'Auto-unlock in' : '自動解除まで残り'}
                      </span>
                      <span className="text-xl font-bold text-red-400 tracking-widest">
                        {(() => {
                          const remaining = Math.max(0, (staminaData.lastOutRecoveryTime + 3600000) - nowTime);
                          const mins = Math.floor(remaining / 60000);
                          const secs = Math.floor((remaining % 60000) / 1000);
                          return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                        })()}
                      </span>
                    </div>
                    <p className="text-[9px] text-gray-500 max-w-[240px] leading-normal mb-3 text-center">
                      {lang === 'en' ? '*Purchasing the "Ad-Free Pass" in the shop disables ad cards completely and lifts all penalties instantly!' : '※ショップで「アドフリーパス」を購入すると、広告カード自体が表示されなくなり、ペナルティも即時解除されます！'}
                    </p>
                    <button
                      onClick={() => {
                        playClick();
                        setView('shop');
                      }}
                      className="px-4 py-2 text-[10px] font-extrabold bg-gradient-to-r from-red-600 to-pink-600 rounded-lg hover:from-red-500 hover:to-pink-500 transition-all uppercase tracking-widest text-white shadow-lg shadow-red-950/40 active:scale-95"
                    >
                      {lang === 'en' ? 'Go to Shop' : 'ショップに行く'}
                    </button>
                  </div>
                ) : loading ? (
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
                ) : (
                  <div className="w-full h-full relative">
                    {cards
                      .filter(card => !staminaData.isAdFree || !card.is_honeypot)
                      .slice(-3)
                      .map((card, idx, arr) => {
                      const isActive = idx === arr.length - 1;
                      return (
                        <SwipeCard
                          key={card.id}
                          isActive={isActive}
                          onSwipe={(dir) => handleSwipe(dir, card.id)}
                          onTap={() => {
                            if (card.is_honeypot) {
                              return;
                            }
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
                            <div className="w-full h-full bg-white flex flex-col items-center justify-center p-6 text-center select-none">
                              <span className="text-4xl md:text-5xl font-light text-gray-400 font-sans tracking-widest mb-4">
                                TEST
                              </span>
                              <p className="text-gray-500 text-xs font-semibold leading-relaxed">
                                カードを左右にスワイプしてお題を完成させよう!
                              </p>
                              <p className="text-gray-400 text-[10px] font-medium leading-relaxed mt-1">
                                Swipe cards left or right to complete the theme!
                              </p>
                            </div>
                          ) : card.is_honeypot ? (
                            <NoiseCard requiredSwipe={card.required_swipe} />
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
              <div className="flex items-center justify-between border-b border-gray-900 pb-3.5 mb-5 h-8">
                {isSearchActive ? (
                  <div className="flex-1 flex items-center gap-1.5 bg-gray-950/60 border border-gray-800 focus-within:border-purple-500/50 rounded-lg px-2.5 py-1 transition-all h-7">
                    <Search className="w-3.5 h-3.5 text-gray-500" />
                    <input
                      type="text"
                      value={threadSearchQuery}
                      onChange={(e) => setThreadSearchQuery(e.target.value)}
                      placeholder={lang === 'ja' ? "プロジェクト名で検索..." : "Search projects..."}
                      className="bg-transparent text-[10px] font-medium text-gray-200 focus:outline-none flex-1 placeholder:text-gray-600 border-none p-0"
                      autoFocus
                    />
                    <button
                      onClick={() => {
                        playClick();
                        setThreadSearchQuery('');
                        setIsSearchActive(false);
                      }}
                      className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
                      title="閉じる"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between w-full h-7">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-purple-400" />
                      <h2 className="text-xs font-bold text-gray-200 uppercase tracking-wider">
                        {lang === 'en' ? 'Project Selection / Management' : 'プロジェクト選択・管理'}
                      </h2>
                    </div>
                    <button
                      onClick={() => {
                        playClick();
                        setIsSearchActive(true);
                      }}
                      className="p-1 text-gray-400 hover:text-purple-400 hover:bg-purple-950/20 rounded transition-all"
                      title={lang === 'en' ? 'Search projects' : 'プロジェクト検索'}
                    >
                      <Search className="w-4 h-4" />
                    </button>
                  </div>
                )}
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
                    {lang === 'ja' ? '新規プロジェクトを作成' : 'Create New Project'}
                  </button>
                </div>
              )}

              {/* Tab Content */}
              <div className="flex-1 flex flex-col min-h-0">
                {threadsTab === 'all' ? (
                  <div className="flex-1 overflow-y-auto pr-1 max-h-[340px] scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
                    {(() => {
                      const filtered = threads.filter(thread =>
                        thread.name.toLowerCase().includes(threadSearchQuery.toLowerCase())
                      );
                      if (filtered.length === 0) {
                        return (
                          <div className="text-center py-12 text-gray-600 text-[9px] uppercase tracking-wider font-semibold">
                            {threadSearchQuery
                              ? (lang === 'ja' ? '一致するプロジェクトはありません' : 'No matching projects found')
                              : (lang === 'ja' ? 'プロジェクトはありません' : 'No projects found')}
                          </div>
                        );
                      }
                      return (
                        <div className="grid grid-cols-2 gap-2">
                          {filtered.map(thread => {
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
                                      <>
                                        <button
                                          onClick={(e) => { playClick(); e.stopPropagation(); handleRenameThread(thread.id, thread.name); }}
                                          className="p-0.5 text-gray-600 hover:text-purple-400 transition-colors"
                                          title={lang === 'en' ? 'Rename Project' : 'プロジェクト名を変更'}
                                        >
                                          <Pencil className="w-3 h-3" />
                                        </button>
                                        <button
                                          onClick={(e) => { playClick(); e.stopPropagation(); handleDeleteThread(thread.id); }}
                                          className="p-0.5 text-gray-600 hover:text-rose-400 transition-colors"
                                          title={lang === 'en' ? 'Delete Project' : 'プロジェクトを削除'}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </>
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
                      );
                    })()}
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
                        {lang === 'ja' ? 'プロジェクト' : 'Projects'} ({threads.filter(t => savedThreadIds.includes(t.id)).length})
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
                        {lang === 'ja' ? 'カード' : 'Cards'} ({savedCards.length}/{CARD_FAVORITES_LIMIT})
                      </button>
                    </div>

                    {savedSubTab === 'threads' ? (
                      <div className="flex-1 overflow-y-auto pr-1 max-h-[260px] scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent">
                        {(() => {
                          const filteredSaved = threads
                            .filter(t => savedThreadIds.includes(t.id))
                            .filter(thread =>
                              thread.name.toLowerCase().includes(threadSearchQuery.toLowerCase())
                            );
                          if (filteredSaved.length === 0) {
                            return (
                              <div className="text-center py-12 text-gray-600 text-[9px] uppercase tracking-wider font-semibold">
                                {threadSearchQuery
                                  ? (lang === 'ja' ? '一致するプロジェクトはありません' : 'No matching projects found')
                                  : (lang === 'ja' ? '保存したプロジェクトはありません' : 'No saved projects found')}
                              </div>
                            );
                          }
                          return (
                            <div className="grid grid-cols-2 gap-2">
                              {filteredSaved.map(thread => {
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
                                          <>
                                            <button
                                              onClick={(e) => { playClick(); e.stopPropagation(); handleRenameThread(thread.id, thread.name); }}
                                              className="p-0.5 text-gray-600 hover:text-purple-400 transition-colors"
                                              title={lang === 'en' ? 'Rename Project' : 'プロジェクト名を変更'}
                                            >
                                              <Pencil className="w-3 h-3" />
                                            </button>
                                            <button onClick={(e) => { playClick(); e.stopPropagation(); handleDeleteThread(thread.id); }} className="p-0.5 text-gray-600 hover:text-rose-400 transition-colors" title={lang === 'en' ? 'Delete Project' : 'プロジェクトを削除'}>
                                              <Trash2 className="w-3 h-3" />
                                            </button>
                                          </>
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
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="flex-1 overflow-y-auto pr-1 max-h-[260px] scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent">
                        {savedCards.length === 0 ? (
                          <div className="text-center py-12 text-gray-600 text-[9px] uppercase tracking-wider font-semibold">
                            {lang === 'ja' ? '保存した画像はありません' : 'No saved cards found'}
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
              className="w-full max-w-[500px] flex flex-col p-5 bg-[#090a10]/95 border border-purple-500/10 rounded-3xl shadow-2xl backdrop-blur-md max-h-[85vh] relative overflow-hidden"
            >
              {/* Background gradient flare */}
              <div className="absolute top-[-50%] left-[-50%] w-[100%] h-[100%] rounded-full bg-purple-500/5 blur-[80px] pointer-events-none" />

              {/* Header with Title and Balance / Close controls */}
              <div className="flex items-center justify-between border-b border-gray-800/60 pb-3 mb-4 relative z-10 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-purple-400" />
                  <h2 className="text-sm font-bold text-gray-100 uppercase tracking-wider">
                    {lang === 'en' ? 'Soul Shop' : 'ソウルショップ'}
                  </h2>
                </div>
                <div className="flex items-center gap-2.5">
                  {/* Current Souls Display with '+' link */}
                  <div className="flex items-center gap-1.5 pl-2.5 pr-1 py-0.5 bg-purple-950/40 border border-purple-500/20 rounded-full select-none text-[11px] font-bold text-yellow-300 shadow-inner">
                    <span><BlueFire /> {staminaData.souls}</span>
                    <button
                      onClick={() => {
                        playClick();
                        setShowBuySoulsModal(true);
                      }}
                      className="w-4 h-4 rounded-full bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center font-black text-xs transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                      title={lang === 'en' ? 'Buy Souls' : 'ソウルを購入する'}
                    >
                      +
                    </button>
                  </div>
                  {/* Close button */}
                  <button
                    onClick={() => {
                      playClick();
                      setView('swipe');
                    }}
                    className="p-1 text-gray-400 hover:text-gray-200 rounded-full hover:bg-gray-800 transition-colors bg-gray-900/40 border border-gray-800"
                    title={lang === 'en' ? 'Close' : '閉じる'}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Main Scrollable Content */}
              <div className="relative z-10 flex-1 overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent space-y-4">
                
                {/* Section Title: Items */}
                <div className="text-left">
                  <div className="flex items-center gap-1.5 text-purple-400 font-extrabold text-[11px] tracking-wider uppercase">
                    <Diamond className="w-3 h-3 text-purple-400" />
                    <span>{lang === 'en' ? 'Exchanged Items' : '交換アイテム'}</span>
                  </div>
                  <p className="text-[9.5px] text-gray-500 mt-0.5">
                    {lang === 'en' ? 'Spend Souls to recover swipe stamina or expand your stamina capacity.' : 'ソウルを消費してスワイプスタミナの回復や上限の拡張を行えます'}
                  </p>
                </div>

                {/* Shop Items Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Item 1: Recover Stamina */}
                  <div className="p-4 bg-gray-950/40 border border-gray-900 rounded-2xl flex flex-col justify-between text-center relative overflow-hidden group hover:border-purple-500/20 transition-all hover:translate-y-[-2px] shadow-lg">
                    <div>
                      <Battery className="w-9 h-9 text-purple-400 mx-auto mb-2" />
                      <h4 className="text-xs font-extrabold text-gray-200">
                        {lang === 'en' ? 'Stamina +10 Potion' : 'スタミナ10回復薬'}
                      </h4>
                      <p className="text-[9px] text-gray-500 leading-snug mt-1 mx-auto max-w-[150px]">
                        {lang === 'en' ? 'Recovers 10 stamina (does not exceed maximum limit)' : 'スタミナを10回復します（上限を超えません）'}
                      </p>
                    </div>
                    <div>
                      {/* Quantity Selector */}
                      <div className="flex items-center justify-center gap-2.5 my-2.5">
                        <button
                          onClick={() => setStaminaRecoveryQty(Math.max(1, staminaRecoveryQty - 1))}
                          disabled={staminaRecoveryQty <= 1}
                          className="w-6 h-6 rounded-full bg-gray-900 border border-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400 flex items-center justify-center font-bold text-xs select-none transition-colors"
                        >
                          -
                        </button>
                        <div className="w-8 text-center text-xs font-black text-gray-200 bg-gray-950/60 border border-gray-900/60 py-0.5 rounded-lg">
                          {staminaRecoveryQty}
                        </div>
                        <button
                          onClick={() => setStaminaRecoveryQty(staminaRecoveryQty + 1)}
                          disabled={staminaData.souls < 300 * (staminaRecoveryQty + 1)}
                          className="w-6 h-6 rounded-full bg-gray-900 border border-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400 flex items-center justify-center font-bold text-xs select-none transition-colors"
                        >
                          +
                        </button>
                      </div>
                      {/* Purchase Button */}
                      <button
                        onClick={() => {
                          playClick();
                          buyStaminaRecovery(staminaRecoveryQty);
                          setStaminaRecoveryQty(1);
                        }}
                        disabled={staminaData.souls < 300 * staminaRecoveryQty || staminaData.stamina >= staminaData.maxStamina}
                        className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-900 disabled:text-gray-600 text-white rounded-full text-[10px] font-bold transition-all shadow-md active:scale-[0.98]"
                      >
                        <BlueFire /> {300 * staminaRecoveryQty} Soul
                      </button>
                    </div>
                  </div>

                  {/* Item 2: Upgrade Max Stamina */}
                  <div className="p-4 bg-gray-950/40 border border-gray-900 rounded-2xl flex flex-col justify-between text-center relative overflow-hidden group hover:border-purple-500/20 transition-all hover:translate-y-[-2px] shadow-lg">
                    <div>
                      <ArrowUpCircle className="w-9 h-9 text-indigo-400 mx-auto mb-2" />
                      <h4 className="text-xs font-extrabold text-gray-200">
                        {lang === 'en' ? 'Max Stamina +5' : 'スタミナ上限+5追加'}
                      </h4>
                      <p className="text-[9px] text-gray-500 leading-snug mt-1 mx-auto max-w-[150px]">
                        {lang === 'en' ? 'Increases maximum stamina by 5 (also adds 5 to current stamina)' : '最大スタミナ上限を5増やします（現在値も5増えます）'}
                      </p>
                    </div>
                    <div>
                      {/* Quantity Selector */}
                      <div className="flex items-center justify-center gap-2.5 my-2.5">
                        <button
                          onClick={() => setMaxStaminaUpgradeQty(Math.max(1, maxStaminaUpgradeQty - 1))}
                          disabled={maxStaminaUpgradeQty <= 1}
                          className="w-6 h-6 rounded-full bg-gray-900 border border-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400 flex items-center justify-center font-bold text-xs select-none transition-colors"
                        >
                          -
                        </button>
                        <div className="w-8 text-center text-xs font-black text-gray-200 bg-gray-950/60 border border-gray-900/60 py-0.5 rounded-lg">
                          {maxStaminaUpgradeQty}
                        </div>
                        <button
                          onClick={() => setMaxStaminaUpgradeQty(maxStaminaUpgradeQty + 1)}
                          disabled={staminaData.souls < 1000 * (maxStaminaUpgradeQty + 1)}
                          className="w-6 h-6 rounded-full bg-gray-900 border border-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400 flex items-center justify-center font-bold text-xs select-none transition-colors"
                        >
                          +
                        </button>
                      </div>
                      {/* Purchase Button */}
                      <button
                        onClick={() => {
                          playClick();
                          buyMaxStaminaUpgrade(maxStaminaUpgradeQty);
                          setMaxStaminaUpgradeQty(1);
                        }}
                        disabled={staminaData.souls < 1000 * maxStaminaUpgradeQty}
                        className="w-full py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-gray-900 disabled:to-gray-900 disabled:text-gray-600 text-white rounded-full text-[10px] font-bold transition-all shadow-md active:scale-[0.98]"
                      >
                        <BlueFire /> {1000 * maxStaminaUpgradeQty} Soul
                      </button>
                    </div>
                  </div>

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

        {staminaData.outs > 0 && !staminaData.isAdFree && (
          <div className="w-full flex items-center justify-between gap-1.5 py-1 px-3 bg-red-950/20 border border-red-500/10 rounded-lg text-[9px] text-red-400 font-extrabold tracking-widest uppercase mb-1">
            <div className="flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-red-400/90 animate-pulse" />
              <span>OUTS: {staminaData.outs}/3</span>
            </div>
            <span className="text-[7.5px] text-gray-500 font-medium normal-case">
              {lang === 'en'
                ? `(${100 - staminaData.swipesSinceLastOutRecovery} swipes left to recover)`
                : `(回復まであと ${100 - staminaData.swipesSinceLastOutRecovery} スワイプ)`}
            </span>
          </div>
        )}

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
                {staminaData.maxStamina >= 9999 ? '∞' : `${staminaData.stamina}/${staminaData.maxStamina}`}
              </span>
              {staminaData.stamina < staminaData.maxStamina && staminaData.maxStamina < 9999 && (
                <span className="text-[7px] text-gray-500 font-medium lowercase tracking-normal flex-shrink-0">
                  +{nextRecoverySeconds}s
                </span>
              )}
            </div>
          </div>
        </div>

        {/* App Promo Banner with Heartbeat Animation */}
        {!isPwaInstalled && (
          <motion.div
            animate={{
              scale: [1, 1.05, 0.98, 1.03, 1, 1],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              repeatDelay: 8.5,
              ease: "easeInOut"
            }}
            className="w-full flex justify-center"
          >
            <AdBanner 
              country={country} 
              lang={lang} 
              onInstallClick={handleInstallPwa} 
            />
          </motion.div>
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

              {/* Tabs */}
              {!galleryLoading && historySpecimens.length > 0 && (
                <div className="flex border-b border-gray-900 mb-4 relative z-10 text-[10px] font-bold">
                  <button
                    onClick={() => {
                      playClick();
                      setHistoryViewMode('flipbook');
                    }}
                    className={`flex-1 py-2 text-center border-b-2 transition-all ${
                      historyViewMode === 'flipbook'
                        ? 'border-purple-500 text-purple-400'
                        : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {lang === 'ja' ? 'パラパラ漫画' : 'Flipbook'}
                  </button>
                  <button
                    onClick={() => {
                      playClick();
                      setHistoryViewMode('grid');
                    }}
                    className={`flex-1 py-2 text-center border-b-2 transition-all ${
                      historyViewMode === 'grid'
                        ? 'border-purple-500 text-purple-400'
                        : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {lang === 'ja' ? 'ギャラリー' : 'Grid'}
                  </button>
                </div>
              )}

              {/* History Content */}
              <div className="relative z-10">
                {galleryLoading ? (
                  <div className="flex justify-center items-center py-12">
                    <RefreshCw className="w-5 h-5 text-purple-500 animate-spin" />
                  </div>
                ) : historySpecimens.length === 0 ? (
                  <div className="text-center py-12 text-gray-600 text-[10px] uppercase tracking-wider font-semibold">
                    No history recorded yet.<br/>Evolve the thread to see past generations!
                  </div>
                ) : historyViewMode === 'flipbook' ? (
                  <div className="flex flex-col items-center gap-4">
                    {/* Big Canvas Container */}
                    <div 
                      onClick={() => {
                        if (!historySpecimens[flipbookIndex]) return;
                        playClick();
                        setSelectedCard({
                          id: historySpecimens[flipbookIndex].id,
                          generation: historySpecimens[flipbookIndex].generation,
                          dna: historySpecimens[flipbookIndex].dna,
                          threadId: activeThreadId || undefined,
                          threadName: activeThread?.name,
                          type: mode
                        });
                        setForkingMode(false);
                        setForkThreadName('');
                        setShowHistoryModal(false);
                        setShowDetailModal(true);
                      }}
                      className="w-full max-w-[200px] aspect-square rounded-2xl overflow-hidden bg-black border border-gray-900 relative flex items-center justify-center shadow-xl cursor-pointer hover:border-purple-500/40 transition-all active:scale-[0.98] group"
                    >
                      {historySpecimens[flipbookIndex] && (
                        <>
                          {mode === 'line' ? (
                            <LineCanvas dna={historySpecimens[flipbookIndex].dna as LineDNA} />
                          ) : (
                            <MosaicCanvas dna={historySpecimens[flipbookIndex].dna as MosaicDNA} />
                          )}
                          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/75 text-[8px] text-purple-300 font-bold border border-purple-500/20">
                            Gen {historySpecimens[flipbookIndex].generation}
                          </span>
                          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/75 text-[6px] text-gray-400 font-bold border border-gray-800/50 opacity-0 group-hover:opacity-100 transition-opacity">
                            {lang === 'en' ? 'Tap for Details' : 'タップで詳細'}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Progress Slider */}
                    <div className="w-full px-2 flex flex-col gap-1.5">
                      <div className="flex justify-between text-[8px] text-gray-500 font-bold tracking-wider">
                        <span>GEN {historySpecimens[historySpecimens.length - 1]?.generation}</span>
                        <span>{historySpecimens.length - flipbookIndex} / {historySpecimens.length}</span>
                        <span>GEN {historySpecimens[0]?.generation}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={historySpecimens.length - 1}
                        value={historySpecimens.length - 1 - flipbookIndex}
                        onChange={(e) => {
                          setFlipbookIndex(historySpecimens.length - 1 - parseInt(e.target.value, 10));
                        }}
                        className="w-full accent-purple-500 bg-gray-900 rounded-lg h-1 appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 max-h-[340px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent">
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
                            {lang === 'en' ? 'Tap for Details' : 'タップで詳細'}
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
                  <h3 className="text-sm font-bold tracking-wider text-purple-400 uppercase">
                    {lang === 'en' ? 'Create New Project' : '新規プロジェクトを作成'}
                  </h3>
                  <span className="text-[9px] text-yellow-300 font-bold block mt-0.5">
                    {lang === 'en' ? 'Your Souls: ' : '所持ソウル: '}<BlueFire /> {staminaData.souls} {lang === 'en' ? 'Souls' : 'Soul'}
                  </span>
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
                    {lang === 'en' ? 'Project Name' : 'プロジェクト名'}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={30}
                    placeholder={lang === 'en' ? 'e.g., Cyber Geometry, Cyberpunk Girl' : '例: サイバー幾何学, サイバーパンクガール'}
                    value={newThreadName}
                    onChange={(e) => setNewThreadName(e.target.value)}
                    className="w-full text-xs bg-gray-950 border border-gray-900 rounded-xl px-4 py-3 text-gray-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-1.5">
                    {lang === 'en' ? 'Style / Mutation Base' : 'スタイル / 突然変異ベース'}
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
                      {lang === 'en' ? 'Line' : 'ライン'}
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
                      {lang === 'en' ? 'Mosaic' : 'モザイク'}
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
                    {lang === 'en' 
                      ? `Create Project (${newThreadType === 'line' ? '200' : '500'} Souls)`
                      : `プロジェクトを作成 (${newThreadType === 'line' ? '200' : '500'} Soul)`}
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
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 overflow-y-auto"
          >
            {/* Wrapper to stack modal and close button vertically */}
            <div className="flex flex-col items-center gap-5 my-auto">
              <motion.div
                onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-[340px] bg-[#0a0b10]/95 border border-gray-900 rounded-[32px] p-8 shadow-2xl relative overflow-hidden flex flex-col gap-6"
            >
              {/* Background gradient flare */}
              <div className="absolute top-[-50%] left-[-50%] w-[100%] h-[100%] rounded-full bg-purple-500/5 blur-[80px] pointer-events-none" />

              {/* Centered Image Preview Wrapper with Backlight Halo (後光) */}
              <div className="relative w-full max-w-[220px] mx-auto mb-5 flex-shrink-0 flex items-center justify-center">
                {/* Backlight Glow Layers */}
                <div className="absolute w-[130%] h-[130%] rounded-full bg-gradient-to-tr from-purple-500/35 via-indigo-500/25 to-purple-400/35 blur-3xl pointer-events-none z-0" />
                <div className="absolute w-[110%] h-[110%] rounded-full bg-purple-600/20 blur-2xl pointer-events-none z-0" />
                
                {/* Centered Image Preview (Top position) */}
                <div className="relative z-10 w-full aspect-square rounded-2xl border border-gray-800 bg-black overflow-hidden flex items-center justify-center shadow-inner">
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
                </div>
              </div>

              {/* Title & Metadata (Below Image) */}
              <div className="relative z-10 text-left flex flex-col gap-2.5 px-1.5">
                <h3 className="text-lg font-black text-gray-200 truncate leading-snug tracking-wide" title={selectedCard.threadName}>
                  {selectedCard.threadName || (lang === 'en' ? 'Unnamed Project' : '無題のプロジェクト')}
                </h3>
                
                {/* Generation, Index, and ID in a single line */}
                <div className="text-[9.5px] text-gray-500 font-bold tracking-wider flex items-center justify-start gap-2">
                  <span>{lang === 'en' ? `Gen ${selectedCard.generation}` : `第 ${selectedCard.generation} 世代`}</span>
                  <span className="text-gray-800">•</span>
                  <span>{lang === 'en' ? `${staminaData.lifetimeSwipes} swipes` : `${staminaData.lifetimeSwipes}枚目`}</span>
                  <span className="text-gray-800">•</span>
                  <span className="font-mono text-gray-600">ID:{selectedCard.id.replace('line_', '').replace('mosaic_', '').substring(0, 6)}</span>
                </div>
              </div>

              {/* Rounded Action Buttons Grid (Download, Save, Share) */}
              <div className="relative z-10 flex items-center justify-between px-6 mt-[-10px] mb-[-4px]">
                {/* Download Button */}
                <button
                  onClick={() => downloadCardAsPNG(selectedCard, selectedCard.type || 'line')}
                  className="w-11 h-11 bg-gray-950/60 border border-gray-900 hover:border-purple-500/40 text-gray-300 hover:text-purple-300 rounded-full transition-all flex items-center justify-center shadow-lg active:scale-90"
                  title={lang === 'en' ? 'Download' : 'ダウンロード'}
                >
                  <Download className="w-4.5 h-4.5" />
                </button>

                {/* Save/Favorite Toggle */}
                {(() => {
                  const isSaved = savedCards.some(c => c.id === selectedCard.id);
                  return (
                    <button
                      onClick={() => toggleSaveCard(selectedCard)}
                      className={`w-11 h-11 border rounded-full transition-all flex items-center justify-center shadow-lg active:scale-90 ${
                        isSaved
                          ? 'bg-purple-950/40 border-purple-500/40 text-purple-300 hover:bg-purple-900/30'
                          : 'bg-gray-950/60 border-gray-900 hover:border-purple-500/40 text-gray-300 hover:text-purple-300'
                      }`}
                      title={isSaved ? (lang === 'en' ? 'Unsave' : '保存解除') : (lang === 'en' ? 'Save' : '保存')}
                    >
                      <Star className={`w-4.5 h-4.5 ${isSaved ? 'fill-purple-400 text-purple-400' : ''}`} />
                    </button>
                  );
                })()}

                {/* Share Button */}
                <button
                  onClick={() => handleShareCard(selectedCard)}
                  className="w-11 h-11 bg-gray-950/60 border border-gray-900 hover:border-purple-500/40 text-gray-300 hover:text-purple-300 rounded-full transition-all flex items-center justify-center shadow-lg active:scale-90"
                  title={lang === 'en' ? 'Share' : '共有'}
                >
                  <Share2 className="w-4.5 h-4.5" />
                </button>
              </div>

              {/* Branching (Fork) Thread Section */}
              <div className="relative z-10 border-t border-gray-900 pt-4.5 flex flex-col gap-2">
                {!forkingMode ? (
                  <button
                    onClick={() => setForkingMode(true)}
                    className="w-full py-3.5 px-4.5 bg-gray-950/60 border border-purple-950/40 hover:border-purple-500/40 text-white rounded-2xl text-xs font-bold transition-all flex items-center justify-between gap-3 shadow-md hover:shadow-purple-950/20 group relative overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 to-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                    
                    <div className="flex items-center gap-3 text-left relative z-10">
                      <div className="p-2 rounded-xl bg-purple-950/30 border border-purple-900/30 group-hover:border-purple-500/30 group-hover:bg-purple-950/50 transition-all">
                        <GitFork className="w-3.5 h-3.5 text-purple-400 group-hover:scale-110 transition-transform" />
                      </div>
                      <div className="leading-tight">
                        <div className="text-[10px] text-gray-400 font-semibold tracking-wide">
                          {lang === 'en' ? 'Fork new project' : 'この個体から分岐して'}
                        </div>
                        <div className="text-[11px] text-purple-400 font-extrabold mt-0.5 tracking-wider">
                          {lang === 'en' ? 'from this specimen' : '新プロジェクトを作成'}
                        </div>
                      </div>
                    </div>
                    
                    <span className="relative z-10 text-[9px] font-extrabold bg-purple-950/60 border border-purple-900/40 px-2 py-1 rounded-lg text-yellow-400 shadow-inner flex items-center gap-0.5 whitespace-nowrap flex-shrink-0">
                      <BlueFire /> 1000 Soul
                    </span>
                  </button>
                ) : (
                  <form onSubmit={handleForkThread} className="space-y-3 p-3 bg-gray-950/40 border border-gray-900 rounded-xl">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase tracking-wider font-extrabold text-purple-400 flex items-center gap-1">
                        <GitFork className="w-3 h-3" /> {lang === 'en' ? 'Create Forked Project' : '分岐プロジェクト作成'}
                      </span>
                      <span className="text-[8px] font-bold text-yellow-300 bg-yellow-950/30 border border-yellow-500/10 px-1.5 py-0.5 rounded">
                        {lang === 'en' ? 'Cost: ' : 'コスト: '}<BlueFire /> 1000 Soul
                      </span>
                    </div>

                    <input
                      type="text"
                      required
                      maxLength={30}
                      placeholder={lang === 'en' ? "Enter new project name" : "新しいプロジェクト名を入力"}
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
                        {lang === 'en' ? 'Cancel' : 'キャンセル'}
                      </button>
                      <button
                        type="submit"
                        disabled={isForking || staminaData.souls < 1000}
                        className="py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-900 disabled:text-gray-600 text-white text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {isForking && <RefreshCw className="w-3 h-3 animate-spin" />}
                        {staminaData.souls < 1000 
                          ? (lang === 'en' ? 'Insufficient Souls' : 'Soul不足') 
                          : (lang === 'en' ? 'Create' : '作成する')}
                      </button>
                    </div>
                    {staminaData.souls < 1000 && (
                      <span className="text-[8px] text-rose-400 block text-center font-semibold mt-1">
                        {lang === 'en'
                          ? `*Requires 1,000 Souls (Current: ${staminaData.souls} Souls)`
                          : `※作成には 1000 Soul必要です（現在: ${staminaData.souls} Soul）`}
                      </span>
                    )}
                  </form>
                )}
              </div>
              </motion.div>

              {/* Close Button Outside at the Bottom Center */}
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ delay: 0.05 }}
                onClick={() => setShowDetailModal(false)}
                className="p-3 bg-gray-900/60 border border-gray-800 hover:border-purple-500/40 text-gray-400 hover:text-white rounded-full transition-all shadow-xl backdrop-blur-sm active:scale-90 hover:scale-105 flex items-center justify-center"
                title={lang === 'en' ? 'Close' : '閉じる'}
              >
                <X className="w-5 h-5" />
              </motion.button>
            </div>
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
                  {lang === 'en'
                    ? 'Explore the gene helix and log in to continue the evolution of specimens.'
                    : '遺伝子の螺旋を探索し、 specimen（スペックメン）の進化を進めるにはログインが必要です。'}
                </p>

                {/* WebView Warning Banner */}
                {isWebView() && (
                  <div className="w-full p-4 mb-5 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex flex-col items-center gap-3 backdrop-blur-sm text-center">
                    <div className="flex items-center gap-2 text-amber-500 font-bold text-xs">
                      <ShieldAlert className="w-4 h-4 text-amber-500 animate-pulse" />
                      <span>{lang === 'ja' ? 'アプリ内ブラウザで閲覧中' : 'You are in a webview'}</span>
                    </div>
                    <p className="text-[10px] text-gray-300 leading-normal font-medium max-w-[260px]">
                      {lang === 'ja'
                        ? 'LINEやTwitterなどのアプリ内ブラウザでは、Googleログインが制限されているためログインできない場合があります。'
                        : 'Google login may not work correctly inside app webviews due to security policies.'}
                    </p>
                    <button
                      onClick={handleOpenInBrowser}
                      className="w-full py-2 bg-gradient-to-r from-amber-600 to-yellow-500 hover:from-amber-500 hover:to-yellow-400 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-[0.98]"
                    >
                      {lang === 'ja' ? '標準ブラウザで開く' : 'Open in browser'}
                    </button>
                  </div>
                )}

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
                  {lang === 'en' ? 'Sign in with Google' : 'Googleでログイン'}
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
                  {lang === 'ja' ? (
                    <>
                      ログインすることで、当サービスの
                      <a href="#" className="underline hover:text-gray-400 mx-1" onClick={(e) => { e.preventDefault(); setShowTermsModal(true); }}>利用規約</a>及び
                      <a href="#" className="underline hover:text-gray-400 ml-1" onClick={(e) => { e.preventDefault(); setShowPrivacyModal(true); }}>プライバシーポリシー</a>に同意したものとみなされます。
                    </>
                  ) : (
                    <>
                      By logging in, you agree to our
                      <a href="#" className="underline hover:text-gray-400 mx-1" onClick={(e) => { e.preventDefault(); setShowTermsModal(true); }}>Terms of Service</a> and
                      <a href="#" className="underline hover:text-gray-400 ml-1" onClick={(e) => { e.preventDefault(); setShowPrivacyModal(true); }}>Privacy Policy</a>.
                    </>
                  )}
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

      {/* Buy Souls Modal */}
      <AnimatePresence>
        {showBuySoulsModal && (
          <div 
            onClick={() => setShowBuySoulsModal(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-fade-in"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full max-w-[400px] bg-[#0c0e15]/95 border border-purple-500/20 rounded-3xl p-6 shadow-2xl relative overflow-hidden text-center backdrop-blur-lg flex flex-col justify-between"
              style={{
                boxShadow: '0 0 40px rgba(168, 85, 247, 0.15), inset 0 0 12px rgba(255, 255, 255, 0.05)',
                fontFamily: "'Outfit', sans-serif"
              }}
            >
              {/* Decorative top light flare */}
              <div className="absolute top-[-30%] left-[20%] right-[20%] h-[40%] rounded-full bg-gradient-to-r from-purple-500/20 to-indigo-500/20 blur-2xl pointer-events-none" />

              {/* Close Button */}
              <button
                onClick={() => setShowBuySoulsModal(false)}
                className="absolute top-4 right-4 p-1.5 text-gray-500 hover:text-gray-300 rounded-full hover:bg-white/5 transition-all"
                title="閉じる"
              >
                <X className="w-4.5 h-4.5" />
              </button>

              <div className="my-auto py-4">
                <div className="flex items-center justify-center gap-1.5 text-purple-400 font-extrabold text-sm tracking-wider uppercase mb-2">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  <span>{lang === 'en' ? 'Buy Souls (Stripe)' : 'ソウルの購入（Stripe決済）'}</span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed max-w-[280px] mx-auto mb-6">
                  {lang === 'en' 
                    ? 'Directly and securely charge Souls (crystals) using credit cards or other methods (requires login).'
                    : 'クレジットカード等を使って安全にソウル（水晶）を直接チャージできます（購入にはログインが必要です）。'}
                </p>

                {/* Stripe Item Cards in Stack */}
                <div className="space-y-3.5">
                  {/* Stripe Card 1 */}
                  <div className="p-4 bg-gradient-to-tr from-purple-950/20 to-pink-950/20 border border-purple-500/10 rounded-2xl flex items-center justify-between text-left relative overflow-hidden group hover:border-purple-500/25 transition-all shadow-lg">
                    <div className="flex items-center gap-3">
                      <Diamond className="w-6 h-6 text-purple-300 flex-shrink-0" />
                      <div>
                        <h4 className="text-sm font-black text-gray-200">500 Souls</h4>
                        <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">
                          {lang === 'en' ? 'Adds 500 Soul crystals to your account' : 'ソウル水晶を500個追加します'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        handleStripePurchase('souls_500');
                        setShowBuySoulsModal(false);
                      }}
                      className="px-4 py-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white rounded-full text-xs font-bold transition-all shadow-md active:scale-[0.98] flex-shrink-0"
                    >
                      $1.99
                    </button>
                  </div>

                  {/* Stripe Card 2 */}
                  <div className="p-4 bg-gradient-to-tr from-purple-950/20 to-indigo-950/20 border border-purple-500/10 rounded-2xl flex items-center justify-between text-left relative overflow-hidden group hover:border-purple-500/25 transition-all shadow-lg">
                    <div className="absolute top-1 right-2 px-1.5 py-0.2 bg-purple-600 text-[8px] font-bold text-white rounded-md uppercase tracking-wider scale-90">
                      {lang === 'en' ? 'Popular' : '人気'}
                    </div>
                    <div className="flex items-center gap-3">
                      <Diamond className="w-6 h-6 text-indigo-300 flex-shrink-0" />
                      <div>
                        <h4 className="text-sm font-black text-gray-200">1,500 Souls</h4>
                        <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">
                          {lang === 'en' ? 'Adds 1,500 Soul crystals to your account' : 'ソウル水晶を1,500個追加します'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        handleStripePurchase('souls_1500');
                        setShowBuySoulsModal(false);
                      }}
                      className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-full text-xs font-bold transition-all shadow-md active:scale-[0.98] flex-shrink-0"
                    >
                      $4.99
                    </button>
                  </div>

                  {/* Stripe Card 3 */}
                  <div className="p-4 bg-gradient-to-tr from-purple-950/20 to-amber-950/20 border border-purple-500/10 rounded-2xl flex items-center justify-between text-left relative overflow-hidden group hover:border-purple-500/25 transition-all shadow-lg">
                    <div className="absolute top-1 right-2 px-1.5 py-0.2 bg-amber-600 text-[8px] font-bold text-white rounded-md uppercase tracking-wider scale-90">
                      {lang === 'en' ? 'Best Value' : 'お得'}
                    </div>
                    <div className="flex items-center gap-3">
                      <Diamond className="w-6 h-6 text-amber-300 flex-shrink-0" />
                      <div>
                        <h4 className="text-sm font-black text-gray-200">4,000 Souls</h4>
                        <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">
                          {lang === 'en' ? 'Adds 4,000 Soul crystals to your account' : 'ソウル水晶を4,000個追加します'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        handleStripePurchase('souls_4000');
                        setShowBuySoulsModal(false);
                      }}
                      className="px-4 py-2 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white rounded-full text-xs font-bold transition-all shadow-md active:scale-[0.98] flex-shrink-0"
                    >
                      $9.99
                    </button>
                  </div>
                </div>
              </div>
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
              {renderSidebarContent(true)}
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
                <h3 className="text-sm font-bold text-gray-200">
                  {lang === 'en' ? 'Terms of Service' : '利用規約'}
                </h3>
                <button
                  onClick={() => setShowTermsModal(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-gray-400 space-y-3 max-h-[350px] overflow-y-auto pr-1 leading-relaxed scrollbar-thin scrollbar-thumb-purple-900">
                {lang === 'en' ? (
                  <>
                    <h4 className="font-bold text-gray-200">1. Introduction</h4>
                    <p>These terms govern the use of the AI-generated genotype generative art exploration tool "gene46" (hereinafter referred to as "the Service").</p>
                    
                    <h4 className="font-bold text-gray-200">2. Intellectual Property Rights</h4>
                    <p>Threads created or forked by users, as well as specimen images and DNA data generated within this Service, are treated as public domain. Anyone is free to save, copy, modify, and distribute them for both commercial and non-commercial purposes.</p>
                    
                    <h4 className="font-bold text-gray-200">3. Prohibited Matters</h4>
                    <p>• Sending excessive requests to the server using automated scripts, bots, etc.<br/>• Intentionally bypassing the honeypot or verification system.<br/>• Any other hacking or unauthorized access activities that disrupt the operation of this Service's system.</p>

                    <h4 className="font-bold text-gray-200">4. Disclaimer</h4>
                    <p>The operator shall not be liable for any damages incurred by users in connection with the use of this Service. In addition, the content of the Service may be modified, suspended, or the evolution simulation terminated without prior notice.</p>
                  </>
                ) : (
                  <>
                    <h4 className="font-bold text-gray-200">1. はじめに</h4>
                    <p>本規約は、AI生成遺伝子型ジェネレーティブアート探索ツール「gene46」（以下、「本サービス」）の利用条件を定めるものです。</p>
                    
                    <h4 className="font-bold text-gray-200">2. 知的財産権について</h4>
                    <p>ユーザーが作成または分岐（フォーク）したスレッド、および本サービス内で生成された個体（スペックメン）の画像・DNAデータは、パブリックドメイン扱いとして扱われ、商用・非商用問わず誰でも自由に保存、コピー、改変、配布することができます。</p>
                    
                    <h4 className="font-bold text-gray-200">3. 禁止事項</h4>
                    <p>・自動スクリプト、ボット等の使用によるサーバーへの過度なリクエスト送信<br/>・ハニーポットや検証システムを意図的にバイパスする行為<br/>・その他、本サービスのシステム運用を妨げる一切のハッキングや不正アクセス行為</p>

                    <h4 className="font-bold text-gray-200">4. 免責事項</h4>
                    <p>本サービスの利用に関連して発生したユーザーの損害について、運営者は一切の責任を負いません。また、予告なくサービス内容の変更、休止、進化シミュレーションの終了を行う場合があります。</p>
                  </>
                )}
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
                <h3 className="text-sm font-bold text-gray-200">
                  {lang === 'en' ? 'Privacy Policy' : 'プライバシーポリシー'}
                </h3>
                <button
                  onClick={() => setShowPrivacyModal(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-gray-400 space-y-3 max-h-[350px] overflow-y-auto pr-1 leading-relaxed scrollbar-thin scrollbar-thumb-purple-900">
                {lang === 'en' ? (
                  <>
                    <h4 className="font-bold text-gray-200">1. Information We Collect</h4>
                    <p>Because this Service is anonymous, we do not collect personal information such as name, email address, or phone number.</p>
                    <p>To identify sessions and prevent duplicate swipes or votes, we only store an automatically generated random UUID session ID in the browser LocalStorage and sync it with our backend database (D1).</p>

                    <h4 className="font-bold text-gray-200">2. Purpose of Use</h4>
                    <p>The collected anonymous session ID is used solely for:<br/>• Managing swipe stamina and soul balance integrity<br/>• Identifying thread ownership and creation rights<br/>• Detecting and preventing bots or fraudulent voting/actions</p>

                    <h4 className="font-bold text-gray-200">3. Security & Cloudflare</h4>
                    <p>This Service runs on Cloudflare Workers and Cloudflare D1, employing bot protection measures (such as Turnstile) to block unauthorized access. LocalStorage integrity, including the session ID, is validated via cryptographic signatures and checksums to prevent tampering.</p>
                  </>
                ) : (
                  <>
                    <h4 className="font-bold text-gray-200">1. 収集する情報</h4>
                    <p>本サービスは匿名でご利用いただけるため、氏名、メールアドレス、電話番号などの個人情報は一切収集いたしません。</p>
                    <p>本サービスでは、個人の識別およびスワイプや投票の重複を防ぐため、自動生成されたランダムなUUID形式の「セッションID」のみをブラウザのLocalStorageに保存し、バックエンドのデータベース（D1）と連携します。</p>

                    <h4 className="font-bold text-gray-200">2. 情報の利用目的</h4>
                    <p>収集された匿名セッションIDは、以下の目的のためにのみ利用されます。<br/>• スワイプスタミナおよびソウルの整合性管理<br/>• スレッドの作成権・所有権の識別<br/>• ボット等による不正行為、不正投票の検知および防御</p>

                    <h4 className="font-bold text-gray-200">3. セキュリティおよびCloudflareの利用</h4>
                    <p>本サービスはCloudflare Workers及びCloudflare D1で運用されており、不正アクセスを防ぐためのボット防御機能（Turnstileなど）が適用されます。セッションIDを含むローカルストレージの整合性は、暗号署名及びハッシュチェックサムによって検証され、改ざんを防いでいます。</p>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Act on Specified Commercial Transactions / Return Policy Modal */}
      <AnimatePresence>
        {showCommercialModal && (
          <div 
            onClick={() => setShowCommercialModal(false)}
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
                <div className="flex-1 min-w-0 mr-2">
                  <h3 className="text-sm font-bold text-gray-200 truncate">
                    {commercialLang === 'ja' ? '特定商取引法に基づく表記・返金' : 'Legal & Refund Policy'}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className="flex p-0.5 bg-gray-950 border border-gray-900 rounded-lg text-[9px] font-bold">
                    <button
                      onClick={() => { playClick(); setCommercialLang('ja'); }}
                      className={`px-1.5 py-0.5 rounded transition-all ${
                        commercialLang === 'ja'
                          ? 'bg-purple-600/20 text-purple-300 border border-purple-500/10'
                          : 'text-gray-500 hover:text-gray-400 border border-transparent'
                      }`}
                    >
                      JP
                    </button>
                    <button
                      onClick={() => { playClick(); setCommercialLang('en'); }}
                      className={`px-1.5 py-0.5 rounded transition-all ${
                        commercialLang === 'en'
                          ? 'bg-purple-600/20 text-purple-300 border border-purple-500/10'
                          : 'text-gray-500 hover:text-gray-400 border border-transparent'
                      }`}
                    >
                      EN
                    </button>
                  </div>
                  <button
                    onClick={() => setShowCommercialModal(false)}
                    className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors ml-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="text-xs text-gray-400 space-y-4 max-h-[380px] overflow-y-auto pr-1 leading-relaxed scrollbar-thin scrollbar-thumb-purple-900">
                {commercialLang === 'ja' ? (
                  <>
                    <div>
                      <h4 className="font-bold text-gray-200">■ 販売事業者名</h4>
                      <p>oyna / gene46運営事務局</p>
                    </div>
                    
                    <div>
                      <h4 className="font-bold text-gray-200">■ 代表者名・運営責任者</h4>
                      <p>非開示（請求があった場合は遅滞なく開示いたします）</p>
                    </div>
                    
                    <div>
                      <h4 className="font-bold text-gray-200">■ 所在地</h4>
                      <p>非開示（請求があった場合は遅滞なく開示いたします）</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ お問い合わせ先</h4>
                      <p>お問い合わせはメールにて受け付けております。<br/>メール：contact@gene46.net</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ 販売価格</h4>
                      <p>購入画面にて表示されます（米ドル表記）。</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ 商品代金以外の必要料金</h4>
                      <p>インターネット接続料金、パケット通信料などの通信費用。</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ 引き渡し時期</h4>
                      <p>Stripeによる決済完了後、即時にシステム上で「ソウル水晶」が付与されます。</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ 支払方法・支払時期</h4>
                      <p>・支払方法：クレジットカード決済（Stripe）<br/>・支払時期：商品購入時（前払い）</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ 返品・返金ポリシー（キャンセルについて）</h4>
                      <p>商品の性質上、決済完了後のキャンセル・返品・返金は一切お受けできません。<br/><br/>万が一、システム的なエラー等により決済完了後に「ソウル水晶」が正常に反映されなかった場合は、お手数ですがメール（contact@gene46.net）にてお問い合わせください。調査の上、個別に再付与等の対応をさせていただきます。</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ 動作環境</h4>
                      <p>インターネットに接続された一般的なPC、スマートフォンのブラウザ（Chrome、Safari、Edge、Firefox等最新版）。</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <h4 className="font-bold text-gray-200">■ Distributor / Seller Name</h4>
                      <p>oyna / gene46 Administrative Office</p>
                    </div>
                    
                    <div>
                      <h4 className="font-bold text-gray-200">■ Representative / Director</h4>
                      <p>Undisclosed (Will be disclosed without delay upon written request)</p>
                    </div>
                    
                    <div>
                      <h4 className="font-bold text-gray-200">■ Business Address</h4>
                      <p>Undisclosed (Will be disclosed without delay upon written request)</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ Customer Support / Contact</h4>
                      <p>Please contact us via email.<br/>Email: contact@gene46.net</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ Sales Price</h4>
                      <p>Displayed on the purchase screen (in USD).</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ Additional Required Fees</h4>
                      <p>Internet connection charges and cellular data communication costs.</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ Delivery Time</h4>
                      <p>Soul items will be credited to the user session immediately after the successful completion of the transaction via Stripe checkout.</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ Payment Method & Timing</h4>
                      <p>• Payment Method: Credit Card / Apple Pay / Google Pay via Stripe<br/>• Payment Timing: Prepaid at the time of purchase</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ Returns & Refunds Policy (Cancellations)</h4>
                      <p>Due to the digital nature of the products, all purchases are final and non-refundable. Cancellations and returns are not accepted once the payment transaction is completed.<br/><br/>If the purchased items fail to reflect in your account due to technical system issues, please contact us by email (contact@gene46.net). Upon validation, we will manually credit the items to your session.</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ Recommended System Environment</h4>
                      <p>Any standard desktop or mobile web browser with internet connection (latest version of Chrome, Safari, Edge, Firefox, etc.).</p>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Usage Limits Modal */}
      <AnimatePresence>
        {showLimitsModal && (
          <div 
            onClick={() => setShowLimitsModal(false)}
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
                <h3 className="text-sm font-bold text-gray-200">
                  {lang === 'en' ? 'Usage Limits' : '使用制限'}
                </h3>
                <button
                  onClick={() => setShowLimitsModal(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-gray-400 space-y-4 max-h-[350px] overflow-y-auto pr-1 leading-relaxed scrollbar-thin scrollbar-thumb-purple-900">
                {lang === 'en' ? (
                  <>
                    <div>
                      <h4 className="font-bold text-gray-200">■ Name of Prepaid Payment Instrument</h4>
                      <p>Souls (Crystals)</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ Monthly Purchase Limits</h4>
                      <p>For the protection of minors and sound service usage, we establish monthly purchase limits for "Souls" based on age groups:</p>
                      <ul className="list-disc pl-4 mt-1.5 space-y-1">
                        <li>Under 16 years old: Up to 5,000 JPY (or equivalent in USD) / month</li>
                        <li>16 to 19 years old: Up to 20,000 JPY (or equivalent in USD) / month</li>
                        <li>20 years old or older: No limit</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ Important Notes</h4>
                      <p>• Age verification will be displayed during the purchase checkout process. Please select your correct age.<br/>• Limits are calculated based on the total purchase amount per session/account from the 1st day to the last day of each calendar month.</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <h4 className="font-bold text-gray-200">■ 前払式支払手段の名称</h4>
                      <p>ソウル（水晶）</p>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ 購入限度額（月間制限）</h4>
                      <p>未成年者の保護および健全なサービス利用のため、年齢ごとに月間での「ソウル」購入限度額を以下の通り設定しております。</p>
                      <ul className="list-disc pl-4 mt-1.5 space-y-1">
                        <li>16歳未満：月間 5,000円（または相当額の米ドル）まで</li>
                        <li>16歳以上19歳以下：月間 20,000円（または相当額の米ドル）まで</li>
                        <li>20歳以上：制限なし</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-200">■ 注意事項</h4>
                      <p>• 購入手続きの際、年齢確認の画面が表示されます。必ず正しい年齢を選択の上ご購入ください。<br/>• 本制限は、アカウントごとに毎月1日〜末日までの合計購入金額に対して適用されます。</p>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Inquiry / Contact Modal */}
      <AnimatePresence>
        {showReportModal && (() => {
          const subject = contactCategory === 'bug'
            ? (lang === 'en' ? 'gene46 Bug Report' : 'gene46の不具合報告')
            : (lang === 'en' ? 'gene46 Inquiry' : 'gene46に関するお問い合わせ');
          
          const body = contactCategory === 'bug'
            ? (lang === 'en'
                ? `## Bug Description\n(Please enter details here)\n\n## Steps to Reproduce\n1.\n2.\n3.\n\n## System Environment\n(e.g. iPhone 15 / Safari)`
                : `## 不具合の説明\n(ここに不具合の詳細を入力してください)\n\n## 再現手順\n1.\n2.\n3.\n\n## 動作環境 (端末・ブラウザなど)\n(例: iPhone 15 / Safari)`)
            : (lang === 'en'
                ? `## Inquiry Details\n(Please enter details here)`
                : `## お問い合わせ内容\n(ここにお問い合わせ内容を入力してください)`);

          const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=contact@gene46.net&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

          return (
            <div 
              onClick={() => setShowReportModal(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
            >
              <motion.div
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="w-full max-w-md bg-[#0a0b10] border border-gray-900 rounded-3xl p-6 shadow-2xl relative overflow-hidden text-left"
              >
                {/* Close Button absolute */}
                <button
                  onClick={() => setShowReportModal(false)}
                  className="absolute top-4 right-4 p-1.5 text-gray-500 hover:text-gray-300 rounded-full hover:bg-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Centered Header */}
                <div className="text-center mb-6 mt-2">
                  <h3 className="text-xl font-black text-gray-100">
                    {lang === 'en' ? 'Inquiry' : 'お問い合わせ'}
                  </h3>
                  
                  {/* Centered Subtext */}
                  <div className="text-xs text-gray-400 leading-relaxed mt-2.5">
                    <p>
                      {lang === 'en'
                        ? 'Please contact us if you have any questions or issues.'
                        : '問題や質問があればお問い合わせください。'}
                    </p>
                  </div>
                </div>

                <div className="space-y-5">
                  {/* Category Pill Tabs */}
                  <div className="flex p-1 bg-gray-950 border border-gray-900 rounded-2xl font-extrabold text-xs">
                    <button
                      type="button"
                      onClick={() => { playClick(); setContactCategory('bug'); }}
                      className={`flex-1 py-2.5 text-center rounded-xl transition-all duration-200 ${
                        contactCategory === 'bug'
                          ? 'bg-gray-100 text-gray-950 shadow-sm'
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {lang === 'en' ? 'Bug Report' : 'バグ報告'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { playClick(); setContactCategory('other'); }}
                      className={`flex-1 py-2.5 text-center rounded-xl transition-all duration-200 ${
                        contactCategory === 'other'
                          ? 'bg-gray-100 text-gray-950 shadow-sm'
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {lang === 'en' ? 'Other' : 'その他'}
                    </button>
                  </div>

                  {/* Email address display & Gmail button */}
                  <div className="space-y-2">
                    <p className="text-xs text-gray-300 leading-normal">
                      {lang === 'en'
                        ? 'Please send your inquiry to the address below:'
                        : '以下のメールアドレスにお問い合わせ内容を送信してください。'}
                    </p>
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-950 border border-gray-900 rounded-2xl text-xs gap-3">
                      <a 
                        href={`mailto:contact@gene46.net?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
                        className="text-indigo-400 hover:text-indigo-300 hover:underline font-mono font-bold text-sm truncate max-w-[200px]"
                        title={lang === 'en' ? 'Open in mail client' : 'メールソフトで開く'}
                      >
                        contact@gene46.net
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          playClick();
                          window.open(gmailUrl, '_blank');
                        }}
                        className="px-3.5 py-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-200 hover:text-white rounded-full text-[11px] font-bold tracking-wide transition-all active:scale-[0.97] flex items-center gap-1 shadow-sm"
                      >
                        {lang === 'en' ? 'Open in Gmail' : 'Gmailで開く'}
                        <span className="text-gray-500 font-mono text-[9px]">&gt;</span>
                      </button>
                    </div>
                  </div>

                  {/* Template Box */}
                  <div className="p-5 bg-gray-950/30 border border-gray-900 rounded-2xl text-xs space-y-4 shadow-inner">
                    <span className="block text-sm font-extrabold text-gray-200 border-b border-gray-900/60 pb-2">
                      {lang === 'en' ? 'Email Template' : 'メールのテンプレート'}
                    </span>

                    {/* Subject */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-gray-400">
                          {lang === 'en' ? 'Subject' : '件名'}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(subject, lang === 'en' ? 'Copied subject!' : '件名をコピーしました！')}
                          className="text-gray-500 hover:text-indigo-400 p-0.5 rounded transition-colors flex items-center justify-center active:scale-90"
                          title={lang === 'en' ? 'Copy Subject' : '件名をコピー'}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div 
                        onClick={() => copyToClipboard(subject, lang === 'en' ? 'Copied subject!' : '件名をコピーしました！')}
                        className="w-full bg-gray-950 border border-gray-900/80 rounded-xl px-3 py-2.5 text-gray-300 font-mono text-xs select-all cursor-pointer hover:border-gray-800/80 transition-colors"
                      >
                        {subject}
                      </div>
                    </div>

                    {/* Body */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-gray-400">
                          {lang === 'en' ? 'Body' : '本文'}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(body, lang === 'en' ? 'Copied body template!' : '本文のテンプレートをコピーしました！')}
                          className="text-gray-500 hover:text-indigo-400 p-0.5 rounded transition-colors flex items-center justify-center active:scale-90"
                          title={lang === 'en' ? 'Copy Body' : '本文をコピー'}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <pre 
                        onClick={() => copyToClipboard(body, lang === 'en' ? 'Copied body template!' : '本文のテンプレートをコピーしました！')}
                        className="w-full bg-gray-950 border border-gray-900/80 rounded-xl px-3 py-3 text-gray-300 font-mono text-xs select-all cursor-pointer whitespace-pre-wrap leading-relaxed max-h-[160px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800 hover:border-gray-800/80 transition-colors"
                      >
                        {body}
                      </pre>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>
      <div id="turnstile-container" className="hidden" />
      </div>

      {/* PC版の右サイドバー (スマホ推奨メッセージ + QRコード) */}
      <div className="hidden lg:flex w-[280px] sm:w-[320px] bg-[#090a0f]/95 border-l border-gray-900 p-6 flex-col items-center justify-center gap-6 shadow-2xl backdrop-blur-md text-center flex-shrink-0 relative overflow-hidden z-20">
        {/* 背景グラデーション */}
        <div className="absolute top-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-purple-900/10 blur-[80px] pointer-events-none" />
        
        <div className="space-y-6 z-10 flex flex-col items-center">
          <div className="flex flex-col items-center gap-2">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-purple-500/10 to-indigo-500/10 border border-purple-500/20 shadow-inner">
              <Sparkles className="w-6 h-6 text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.7)] animate-pulse" />
            </div>
            <h3 className="text-sm font-extrabold text-gray-200 tracking-wider uppercase">MOBILE OPTIMIZED</h3>
          </div>
          
          <p className="text-xs text-gray-400 leading-relaxed max-w-[240px]">
            {lang === 'en'
              ? 'This application is optimized for mobile devices. Using it on a smartphone offers the best experience.'
              : '当アプリはスマホで使うことを前提に開発したため、スマートフォンからのご利用が最も快適です。'}
          </p>

          {/* QRコード表示枠 */}
          <div className="relative group p-3 bg-black border border-gray-800 rounded-2xl shadow-2xl transition-all duration-300 hover:border-purple-500/40">
            <img 
              src="/qr-code.png" 
              alt="QR Code to gene46.net" 
              className="w-40 h-40 rounded-xl"
            />
            <div className="absolute inset-0 border border-purple-500/10 rounded-2xl pointer-events-none group-hover:border-purple-500/30 transition-colors" />
          </div>

          <div className="space-y-1">
            <p className="text-[10px] text-gray-500 font-medium">
              {lang === 'en' ? 'Scan with your camera to access' : 'スマホのカメラで読み取ってアクセス'}
            </p>
            <a href="https://gene46.net" target="_blank" rel="noreferrer" className="text-[10px] text-purple-400 hover:underline font-mono">
              https://gene46.net
            </a>
          </div>
        </div>
      </div>

      {/* Special Charge Release Fullscreen VFX */}
      <AnimatePresence>
        {showChargeEffect && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-purple-950/20 backdrop-blur-[2px]"
          >
            {/* Energy radial pulse */}
            <motion.div
              initial={{ scale: 0, opacity: 1 }}
              animate={{ scale: 3, opacity: 0 }}
              transition={{ duration: 1.2, ease: "easeOut" }}
              className="absolute w-[200px] h-[200px] rounded-full bg-gradient-to-r from-cyan-400 via-purple-500 to-yellow-300 blur-xl opacity-80"
            />
            {/* Inner ring */}
            <motion.div
              initial={{ scale: 0.2, opacity: 1, rotate: 0 }}
              animate={{ scale: 2.2, opacity: 0, rotate: 180 }}
              transition={{ duration: 1.0, ease: "easeOut" }}
              className="absolute w-[150px] h-[150px] rounded-full border-4 border-dashed border-cyan-300 opacity-60"
            />
            {/* Flash screen overlay */}
            <motion.div
              initial={{ opacity: 0.8 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 bg-white"
            />
            {/* Particles explosion (Simulated with scaling points) */}
            <div className="absolute inset-0 flex items-center justify-center">
              {[...Array(12)].map((_, i) => {
                const angle = (i * 30 * Math.PI) / 180;
                const x = Math.cos(angle) * 150;
                const y = Math.sin(angle) * 150;
                return (
                  <motion.div
                    key={i}
                    initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                    animate={{ x, y, scale: 0, opacity: 0 }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                    className="absolute w-3 h-3 rounded-full bg-gradient-to-r from-yellow-300 to-pink-500 shadow-[0_0_8px_rgba(253,224,71,0.8)]"
                  />
                );
              })}
            </div>
            
            {/* Sparkles / Max Banner */}
            <motion.div
              initial={{ scale: 0.5, y: 50, opacity: 0 }}
              animate={{ scale: 1.1, y: 0, opacity: 1 }}
              exit={{ scale: 0.8, y: -30, opacity: 0 }}
              transition={{ type: "spring", damping: 12 }}
              className="flex flex-col items-center gap-2 z-10"
            >
              <div className="flex items-center gap-1 text-yellow-300 font-extrabold uppercase tracking-widest text-xs py-1.5 px-4 bg-black/80 border border-yellow-500/30 rounded-full shadow-2xl backdrop-blur-md">
                <Sparkles className="w-4 h-4 animate-spin" />
                <span>
                  {lang === 'ja' ? '25スワイプ チャージ完了！' : '25 Swipes Charged!'}
                </span>
              </div>
              <span className="text-[9px] font-mono text-cyan-300 uppercase tracking-widest font-bold">
                {lang === 'ja' ? '進化の同期中...' : 'Synchronizing Evolution...'}
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Out of Stamina Modal */}
      <AnimatePresence>
        {showStaminaModal && (
          <div 
            onClick={() => setShowStaminaModal(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-[#0a0b10] border border-gray-900 rounded-2xl p-6 shadow-2xl relative overflow-hidden text-center flex flex-col items-center justify-center gap-4 animate-fade-in"
            >
              {/* Close Button */}
              <button
                onClick={() => setShowStaminaModal(false)}
                className="absolute top-4 right-4 p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-900 transition-colors z-20"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-rose-950/20 blur-[50px] pointer-events-none" />
              <div className="relative flex flex-col items-center justify-center min-h-[70px] mt-2">
                <span className="text-6xl font-black text-rose-500 drop-shadow-[0_0_12px_rgba(244,63,94,0.5)] font-mono animate-pulse">
                  {nextRecoverySeconds}
                </span>
                <span className="text-[10px] text-rose-400/80 font-bold uppercase tracking-widest mt-1">
                  {lang === 'ja' ? '秒で回復' : 'Sec to Recover'}
                </span>
                <div className="absolute inset-0 bg-rose-500/10 blur-xl rounded-full pointer-events-none" />
              </div>
              <div>
                <p className="text-rose-400 font-bold text-sm tracking-wider">
                  {lang === 'ja' ? 'スタミナ切れ' : 'Out of Stamina'}
                </p>
                <p className="text-gray-400 text-[10px] mt-1 uppercase tracking-wider">
                  {lang === 'ja' ? '時間経過で徐々に回復します' : 'Recovers gradually over time'}
                </p>
              </div>
              <div className="w-full mt-2">
                <div className="flex flex-col gap-3 w-full">
                  <button
                    onClick={() => {
                      playClick();
                      setShowStaminaModal(false);
                      setView('shop');
                    }}
                    className="w-full py-2.5 px-4 text-white bg-gradient-to-r from-rose-500 to-fuchsia-600 hover:from-rose-400 hover:to-fuchsia-500 transition-all shadow-md flex flex-col items-center justify-center gap-0.5 rounded-2xl active:scale-[0.98] border border-rose-400/20"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <ShoppingBag className="w-3.5 h-3.5 text-white" />
                      <span>{lang === 'ja' ? 'ショップを開く' : 'Open Shop'}</span>
                    </div>
                    <span className="text-[9px] text-rose-100/70 font-medium">
                      {lang === 'ja' ? 'ソウルを使ってスタミナを回復する。' : 'Use souls to recover stamina.'}
                    </span>
                  </button>
                  <button
                    onClick={handleShare}
                    className="w-full py-2.5 px-4 text-white bg-gradient-to-r from-blue-600 to-indigo-500 hover:from-blue-500 hover:to-indigo-400 rounded-2xl transition-all shadow-md active:scale-[0.98] flex flex-col items-center justify-center gap-0.5 border border-blue-400/20"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <Users className="w-3.5 h-3.5 text-blue-100" />
                      <span>{lang === 'ja' ? '仲間を呼ぶ' : 'Invite Friends'}</span>
                    </div>
                    <span className="text-[9px] text-blue-100/70 font-medium">
                      {lang === 'ja' ? '共有して進化を加速する' : 'Share to accelerate evolution.'}
                    </span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
