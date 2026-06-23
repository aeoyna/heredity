export const logEvent = (eventName: string, params?: Record<string, any>) => {
  if (typeof window !== 'undefined' && (window as any).gtag) {
    (window as any).gtag('event', eventName, params);
  } else {
    console.log(`[Analytics Event Logged (No-Op)]: ${eventName}`, params);
  }
};

export const logPageView = (pagePath: string) => {
  const gaId = import.meta.env.VITE_GA_MEASUREMENT_ID;
  if (gaId && typeof window !== 'undefined' && (window as any).gtag) {
    (window as any).gtag('config', gaId, {
      page_path: pagePath,
    });
  } else {
    console.log(`[Analytics PageView Logged (No-Op)]: ${pagePath}`);
  }
};

export const initGA = () => {
  const gaId = import.meta.env.VITE_GA_MEASUREMENT_ID;
  if (!gaId) {
    console.log('Google Analytics 4: VITE_GA_MEASUREMENT_ID is not configured. Analytics tracking disabled.');
    return;
  }

  if (typeof window === 'undefined') return;

  // Check if script is already added
  if (document.getElementById('google-analytics-script')) return;

  // Create script tag for gtag.js
  const script1 = document.createElement('script');
  script1.id = 'google-analytics-script';
  script1.async = true;
  script1.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
  document.head.appendChild(script1);

  // Initialize dataLayer and gtag function
  const script2 = document.createElement('script');
  script2.innerHTML = `
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){dataLayer.push(arguments);}
    window.gtag('js', new Date());
    window.gtag('config', '${gaId}', { send_page_view: false });
  `;
  document.head.appendChild(script2);
  
  console.log(`Google Analytics 4: Initialized with ID ${gaId}`);
};
