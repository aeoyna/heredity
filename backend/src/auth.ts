export function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return {};
  
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts[0].trim();
    const val = parts.slice(1).join('=').trim();
    if (name) {
      cookies[name] = decodeURIComponent(val);
    }
  });
  return cookies;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function jsonToBase64Url(obj: any): string {
  const str = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function base64UrlToJson(base64url: string): any {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const str = new TextDecoder().decode(bytes);
  return JSON.parse(str);
}

export async function signJWT(payload: any, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const secretKeyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    secretKeyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = jsonToBase64Url(header);
  const encodedPayload = jsonToBase64Url(payload);

  const dataToSign = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, dataToSign);
  const encodedSignature = arrayBufferToBase64Url(signatureBuffer);

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

export async function verifyJWT(token: string, secret: string): Promise<any | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerStr, payloadStr, signatureStr] = parts;
    const encoder = new TextEncoder();
    const dataToVerify = encoder.encode(`${headerStr}.${payloadStr}`);
    const signatureBuffer = base64UrlToArrayBuffer(signatureStr);

    const secretKeyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      secretKeyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const isValid = await crypto.subtle.verify('HMAC', key, signatureBuffer, dataToVerify);
    if (!isValid) return null;

    const payload = base64UrlToJson(payloadStr);

    // Validate expiration
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null;
    }

    return payload;
  } catch (err) {
    console.error('JWT Verification error:', err);
    return null;
  }
}


