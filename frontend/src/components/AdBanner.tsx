import React, { useEffect, useRef } from 'react';

interface AdBannerProps {
  country: string;
  lang?: 'ja' | 'en';
}

export const AdBanner: React.FC<AdBannerProps> = ({ country, lang }) => {
  const adContainerRef = useRef<HTMLDivElement>(null);

  // ==========================================
  // 【本番用設定】広告提携後に取得したIDを設定してください
  // ==========================================
  const IMOBILE_PID = "YOUR_IMOBILE_PID";     // iMobile パートナーID
  const IMOBILE_ASID = "YOUR_IMOBILE_ASID";   // iMobile 広告スポットID
  
  const ADS_KEEPER_ID = "YOUR_ADS_KEEPER_ID"; // AdsKeeper ウィジェットID
  const ADS_KEEPER_SCRIPT_ID = "YOUR_ADS_KEEPER_SCRIPT_ID"; // 例: 123456

  // IDがデフォルト（YOUR_...）のままであれば開発プレースホルダーを表示
  const isDevMode = 
    IMOBILE_PID.startsWith("YOUR_") || 
    IMOBILE_ASID.startsWith("YOUR_") || 
    ADS_KEEPER_ID.startsWith("YOUR_");

  // 簡易復号ヘルパー（クローラーやアドブロックによる静的解析を回避）
  const d = (encoded: string): string => {
    try {
      const raw = atob(encoded);
      let result = '';
      for (let i = 0; i < raw.length; i++) {
        result += String.fromCharCode(raw.charCodeAt(i) ^ 0x5C);
      }
      return result;
    } catch (e) {
      return '';
    }
  };

  useEffect(() => {
    const container = adContainerRef.current;
    if (!container) return;

    // 広告描画エリアのクリーンアップ
    container.innerHTML = '';

    if (isDevMode) {
      // --- 開発用の美しいプレースホルダー表示 ---
      const placeholder = document.createElement('div');
      placeholder.className = "w-full h-full flex items-center justify-between px-3 bg-gradient-to-r from-gray-950 via-purple-950/20 to-gray-950 text-left border border-purple-900/20 rounded-xl relative overflow-hidden group";
      
      const glow = document.createElement('div');
      glow.className = "absolute -inset-px bg-gradient-to-r from-purple-500/10 to-indigo-500/10 rounded-xl blur opacity-30 group-hover:opacity-50 transition-opacity duration-500";
      placeholder.appendChild(glow);

      const content = document.createElement('div');
      content.className = "flex items-center gap-2.5 z-10";
      
      const badge = document.createElement('div');
      badge.className = "w-7 h-7 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-purple-500/10";
      badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-white"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
      content.appendChild(badge);

      const info = document.createElement('div');
      info.className = "min-w-0";
      
      const title = document.createElement('h4');
      title.className = "text-[9.5px] font-black text-gray-200 tracking-wider uppercase flex items-center gap-1.5";
      title.innerHTML = `<span>${country === 'JP' ? 'iMobile Ad' : 'AdsKeeper Ad'}</span><span class="text-[7.5px] px-1 py-0.2 bg-purple-500/20 border border-purple-500/30 rounded text-purple-400 font-bold normal-case">Dev Mode</span>`;
      
      const desc = document.createElement('p');
      desc.className = "text-[8px] text-gray-500 truncate mt-0.5";
      desc.innerText = lang === 'en'
        ? (country === 'JP'
          ? "Serving domestic ad (iMobile) slot"
          : `Serving international ad (AdsKeeper) slot (${country})`)
        : (country === 'JP' 
          ? "日本国内向け広告 (iMobile) の枠を配信中" 
          : `海外向け広告 (AdsKeeper) の枠を配信中 (${country})`);
      
      info.appendChild(title);
      info.appendChild(desc);
      content.appendChild(info);
      placeholder.appendChild(content);

      const action = document.createElement('div');
      action.className = "z-10 px-2 py-0.5 bg-gray-900 border border-gray-800 rounded text-[7.5px] font-bold text-gray-400 uppercase tracking-widest";
      action.innerText = country;
      placeholder.appendChild(action);

      container.appendChild(placeholder);
      return;
    }

    // --- 本番環境用の実広告ロード（難読化文字列のデコード） ---
    const IMOBILE_URL = d("NCgoLC9mc3MvLD04cjVxMTM+NTA5cj8zcjYscy8/LjUsKHM9OC8vLHI2L2NubG1tbG5taQ==");
    const ADS_DOMAIN = d("MnI9OC9tcT04LzkuKjkucj8zMQ==");
    const ADS_URL_BASE = d("NCgoLC9mc3M2Lz9yPTgvbXE9OC85Lio5LnI/MzFzL3M/cw==");
    
    const VAR_VER = d("NTEzPjUwOQMoPTsDKjku"); // "imobile_tag_ver"
    const VAR_PID = d("NTEzPjUwOQMsNTg=");     // "imobile_pid"
    const VAR_ASID = d("NTEzPjUwOQM9LzU4");    // "imobile_asid"
    const VAR_TYPE = d("NTEzPjUwOQMoJSw5");    // "imobile_type"
    const VAR_ADV_OUT = d("Lz8DPTgqAzMpKA="); // "sc_adv_out"

    if (country === 'JP') {
      const configScript = document.createElement('script');
      configScript.type = 'text/javascript';
      configScript.innerHTML = `
        window["${VAR_VER}"] = "1.0.1.1";
        window["${VAR_PID}"] = "${IMOBILE_PID}";
        window["${VAR_ASID}"] = "${IMOBILE_ASID}";
        window["${VAR_TYPE}"] = "inline";
      `;
      container.appendChild(configScript);

      const adScript = document.createElement('script');
      adScript.type = 'text/javascript';
      adScript.src = IMOBILE_URL;
      adScript.async = true;
      container.appendChild(adScript);
    } else {
      const adDiv = document.createElement('div');
      const widgetId = `SC_T_${ADS_KEEPER_ID}`;
      adDiv.id = widgetId;
      container.appendChild(adDiv);

      const configScript = document.createElement('script');
      configScript.type = 'text/javascript';
      configScript.innerHTML = `
        (window["${VAR_ADV_OUT}"] = window["${VAR_ADV_OUT}"] || []).push({
          id: "${ADS_KEEPER_ID}",
          domain: "${ADS_DOMAIN}",
          target: "${widgetId}"
        });
      `;
      container.appendChild(configScript);

      const adScript = document.createElement('script');
      adScript.type = 'text/javascript';
      adScript.src = `${ADS_URL_BASE}${ADS_KEEPER_SCRIPT_ID}.js`;
      adScript.async = true;
      container.appendChild(adScript);
    }

    return () => {
      // コンポーネントアンマウント時・国切り替え時のクリーンアップ
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [country, isDevMode, lang]);

  return (
    <div className="w-full max-w-[380px] h-[50px] flex items-center justify-center relative">
      <div ref={adContainerRef} className="w-full h-full" />
    </div>
  );
};
