import { URL } from "url";

// Environment Variables are accessed here once
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SECRET_TOKEN = process.env.FIREBASE_SECRET_TOKEN;

// Error Handling Function
function handleCriticalError(response, message) {
  return sendJSON(response, { error: message }, "*", 500);
}

export default async function handler(request, response) {
  if (!FIREBASE_DATABASE_URL || !FIREBASE_SECRET_TOKEN) {
    return handleCriticalError(
      response,
      "Firebase configuration is missing in Render Environment Variables."
    );
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const origin = request.headers.origin || "*";

  if (request.method === "OPTIONS") {
    return sendCors(response, origin);
  }

  const key = url.searchParams.get("key") || "default";
  const uniqueMode = url.searchParams.get("unique") === "1";

  // IP Address extraction for Render (Most Reliable)
  const ip =
    request.headers["x-real-ip"] ||
    request.headers["x-forwarded-for"]?.split(',')[0].trim() ||
    "0.0.0.0";
  const safeIp = ip.replace(/\./g, "_");

  // Get Endpoint Handler
  if (url.pathname.startsWith("/api/get")) {
    const data = await getCountsFirebase(key);
    return sendJSON(response, data, origin);
  }

  // Hit Endpoint Handler
  if (url.pathname.startsWith("/api/hit")) {
    
    // --- 5-MINUTE RATE LIMITING (STRONGER IMPLEMENTATION) ---
    const rateLimitPath = `rate_limits/${key}/${safeIp}.json`;
    const lastHitTime = await firebaseGet(rateLimitPath);
    const currentTime = Date.now();
    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    if (lastHitTime && currentTime - lastHitTime < FIVE_MINUTES_MS) {
      const data = await getCountsFirebase(key);
      response.setHeader("X-RateLimit-Blocked", "true");
      return sendJSON(response, data, origin, 429); // 429 = Too Many Requests
    }

    try {
      await firebasePut(rateLimitPath, currentTime);
    } catch (e) {
      return handleCriticalError(response, "Failed to update rate limit timestamp in Firebase.");
    }

    // --- UNIQUE HIT LOGIC ---
    let uniqueInc = 1;
    if (uniqueMode) {
      const day = new Date().toISOString().slice(0, 10);
      const uniquePath = `unique/${key}/${day}/${safeIp}.json`;
      const exists = await firebaseGet(uniquePath);
      if (exists) uniqueInc = 0;
      else {
        try {
          await firebasePut(uniquePath, true);
        } catch (e) {
          // If unique tracking fails, still count as non-unique (fail-safe)
          uniqueInc = 0;
        }
      }
    }

    // --- COUNTER INCREMENT LOGIC ---
    const totalPath = `counters/${key}/total.json`;
    const uniqueCountPath = `counters/${key}/unique.json`;
    const updatedPath = `counters/${key}/updated_at.json`;

    // Fetch current values
    const totalValue = (await firebaseGet(totalPath)) || 0;
    const uniqueValue = (await firebaseGet(uniqueCountPath)) || 0;

    const newTotal = totalValue + 1;
    const newUnique = uniqueValue + uniqueInc;

    // Put new values
    try {
      await firebasePut(totalPath, newTotal);
      await firebasePut(uniqueCountPath, newUnique);
      await firebasePut(updatedPath, new Date().toISOString());
    } catch (e) {
      return handleCriticalError(response, "Failed to increment hit counter in Firebase.");
    }

    const data = await getCountsFirebase(key);
    return sendJSON(response, data, origin);
  }

  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("Hit Counter API is running on Render!");
}

// --- CORE FIREBASE NETWORK UTILS (WITH STRONGER ERROR HANDLING) ---

async function firebaseGet(path) {
  const authQuery = `?auth=${FIREBASE_SECRET_TOKEN}`;
  const url =
    FIREBASE_DATABASE_URL.replace(/\/$/, "") + "/" + path + authQuery;

  try {
    const res = await fetch(url);
    
    // Check for network success but application failure (e.g., 401 Unauthorized)
    if (res.status === 401) {
        throw new Error("Firebase Authentication Failed. Check SECRET_TOKEN.");
    }
    if (!res.ok) {
      return null;
    }
    
    const text = await res.text();
    return text === "null" ? null : JSON.parse(text);
  } catch (e) {
    // Suppress minor network errors to prevent app crash, return null
    return null;
  }
}

async function firebasePut(path, value) {
  const authQuery = `?auth=${FIREBASE_SECRET_TOKEN}`;
  const url =
    FIREBASE_DATABASE_URL.replace(/\/$/, "") + "/" + path + authQuery;

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });

    if (res.status === 401) {
        throw new Error("Firebase Authentication Failed. Check SECRET_TOKEN.");
    }
    if (!res.ok) {
      throw new Error(`Firebase PUT failed with status ${res.status}`);
    }
  } catch (e) {
    throw e; 
  }
}

// --- DATA UTILS ---

async function getCountsFirebase(key) {
  const base = `counters/${key}/`;
  const total = (await firebaseGet(base + "total.json")) || 0;
  const unique = (await firebaseGet(base + "unique.json")) || 0;
  const updated = await firebaseGet(base + "updated_at.json");

  return {
    key,
    total,
    unique,
    total_formatted: formatNum(total),
    unique_formatted: formatNum(unique),
    updated_at: updated || null,
  };
}

function sendCors(response, origin) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  });
  response.end();
}

function sendJSON(response, data, origin, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  });
  response.end(JSON.stringify(data));
}

function formatNum(n) {
  if (n < 1000) return n.toString();
  if (n < 10000) return (n / 1000).toFixed(1) + "K";
  if (n < 1000000) return Math.round(n / 1000) + "K";
  return (n / 1000000).toFixed(1) + "M";
}

