interface JWK {
  kty: string;
  alg: string;
  use: string;
  kid: string;
  n: string;
  e: string;
  [key: string]: any;
}

interface JWKS {
  keys: JWK[];
}

// In-memory cache for JWKS keys
let cachedKeys: JWK[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function fetchGoogleJWKS(): Promise<JWK[]> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!res.ok) {
      throw new Error(`Failed to fetch Google certs: HTTP ${res.status}`);
    }
    const data = await res.json() as JWKS;
    if (data && Array.isArray(data.keys)) {
      cachedKeys = data.keys;
      cacheTimestamp = Date.now();
      return data.keys;
    }
    throw new Error('Invalid JWKS structure returned from Google');
  } catch (err) {
    console.error('Error fetching Google JWKS:', err);
    if (cachedKeys) {
      // Fallback to stale cache on error
      console.warn('Using stale cached JWKS keys due to fetch failure');
      return cachedKeys;
    }
    throw err;
  }
}

async function getGooglePublicKeys(forceRefresh = false): Promise<JWK[]> {
  const isExpired = Date.now() - cacheTimestamp > CACHE_TTL_MS;
  if (!cachedKeys || isExpired || forceRefresh) {
    return await fetchGoogleJWKS();
  }
  return cachedKeys;
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  const binary = base64UrlDecode(base64url);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string
): Promise<any | null> {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      console.error('Google ID token is not a valid 3-part JWT');
      return null;
    }

    const [headerStr, payloadStr, signatureStr] = parts;
    
    // 1. Decode header to identify Key ID (kid) and check algorithm
    const header = JSON.parse(base64UrlDecode(headerStr));
    if (header.alg !== 'RS256') {
      console.error(`Unsupported Google signature algorithm: ${header.alg}. Expected RS256.`);
      return null;
    }

    const kid = header.kid;
    if (!kid) {
      console.error('Missing kid in Google ID token header');
      return null;
    }

    // 2. Fetch JWKS and locate key
    let keys = await getGooglePublicKeys();
    let jwk = keys.find(k => k.kid === kid);

    if (!jwk) {
      // Try force refresh in case the key was recently rotated
      console.log(`Key ID ${kid} not found in cached JWKS. Force-refreshing keys...`);
      keys = await getGooglePublicKeys(true);
      jwk = keys.find(k => k.kid === kid);
    }

    if (!jwk) {
      console.error(`Google public key for kid ${kid} could not be resolved`);
      return null;
    }

    // 3. Import key to Web Crypto API
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: { name: 'SHA-256' }
      },
      false,
      ['verify']
    );

    // 4. Verify signature
    const encoder = new TextEncoder();
    const dataToVerify = encoder.encode(`${headerStr}.${payloadStr}`);
    const signatureBuffer = base64UrlToArrayBuffer(signatureStr);

    const isSignatureValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureBuffer,
      dataToVerify
    );

    if (!isSignatureValid) {
      console.error('Google ID token cryptographic signature verification failed');
      return null;
    }

    // 5. Verify token claims
    const payload = JSON.parse(base64UrlDecode(payloadStr));
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Audience check: aud must match your project's client ID
    if (payload.aud !== clientId) {
      console.error(`Google JWT audience mismatch. Got: ${payload.aud}, Expected: ${clientId}`);
      return null;
    }

    // Issuer check: iss must match accounts.google.com
    const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (!validIssuers.includes(payload.iss)) {
      console.error(`Google JWT issuer mismatch. Got: ${payload.iss}`);
      return null;
    }

    // Expiration check: exp must be in the future
    if (payload.exp && nowSeconds > payload.exp) {
      console.error(`Google JWT expired. Expiration: ${payload.exp}, Current time: ${nowSeconds}`);
      return null;
    }

    // Issued At check: allow up to 5 minutes clock skew
    if (payload.iat && nowSeconds < payload.iat - 300) {
      console.error(`Google JWT issued in the future. Issued At: ${payload.iat}, Current time: ${nowSeconds}`);
      return null;
    }

    return payload;
  } catch (err) {
    console.error('Fatal error verifying Google ID token:', err);
    return null;
  }
}
