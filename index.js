export default async function handler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const origin = request.headers.origin || "*";

  // CORS
  if (request.method === "OPTIONS") {
    return sendCors(response, origin);
  }

  const key = url.searchParams.get("key") || "default";
  const uniqueMode = url.searchParams.get("unique") === "1";

  if (url.pathname.startsWith("/api/get")) {
    const data = await getCountsFirebase(key);
    return sendJSON(response, data, origin);
  }

  if (url.pathname.startsWith("/api/hit")) {
    const ip = request.headers["x-real-ip"] ||
               request.headers["x-forwarded-for"] ||
               "0.0.0.0";

    let uniqueInc = 1;
    if (uniqueMode) {
      const day = new Date().toISOString().slice(0, 10);
      const ipKey = `unique/${key}/${day}/${ip}.json`;

      const exists = await firebaseGet(ipKey);
      if (exists) uniqueInc = 0;
      else await firebasePut(ipKey, true);
    }

    const totalPath = `counters/${key}/total.json`;
    const uniquePath = `counters/${key}/unique.json`;

    const totalValue = (await firebaseGet(totalPath)) || 0;
    const uniqueValue = (await firebaseGet(uniquePath)) || 0;

    const newTotal = totalValue + 1;
    const newUnique = uniqueValue + uniqueInc;

    await firebasePut(totalPath, newTotal);
    await firebasePut(uniquePath, newUnique);
    await firebasePut(`counters/${key}/updated_at.json`, new Date().toISOString());

    const data = await getCountsFirebase(key);
    return sendJSON(response, data, origin);
  }

  response.send("Hit Counter API (Firebase + Vercel) ✔");
}


// ---------------- Firebase Helpers ----------------

const FIREBASE_URL = "https://hit-counters-default-rtdb.firebaseio.com/";

async function firebaseGet(path) {
  const res = await fetch(FIREBASE_URL + path);
  return res.json();
}

async function firebasePut(path, value) {
  await fetch(FIREBASE_URL + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

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


// ---------------- Utils ----------------

function sendCors(response, origin) {
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "86400");
  return response.status(200).end();
}

function sendJSON(response, data, origin) {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  return response.status(200).json(data);
}

function formatNum(n) {
  if (n < 1000) return String(n);
  const units = ["K", "M", "B", "T"];
  let unit = -1;
  let num = n;
  while (num >= 1000 && unit < units.length - 1) {
    num /= 1000;
    unit++;
  }
  return `${Math.round(num * 10) / 10}${units[unit]}`;
}
