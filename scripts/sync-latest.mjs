import { readFile, writeFile } from "node:fs/promises";

const API_URL = process.env.LATEST_POSTS_API || "https://script.google.com/macros/s/AKfycbyHYoykgR_MZIfPtTWZODIXmCX1cmn9XzzKryyejbcjScFdhSnUNVwRQUX1G8ZNz1wU/exec";
const X_HANDLE = (process.env.X_HANDLE || "doa07382711").replace(/^@/, "");
const FILE = "latest-posts.json";
const ORDER = ["instagram", "tiktok", "youtube", "x", "threads"];

function normalizeText(value, max = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function platformKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "twitter") return "x";
  return ORDER.includes(key) ? key : "";
}

function formatTokyoDate(value) {
  if (!value) return "";
  const raw = String(value).trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return month && day ? `${month}/${day}` : "";
}

async function fetchText(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (D.O.A SNS HUB sync)" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 25000) {
  const text = await fetchText(url, timeoutMs);
  return JSON.parse(text);
}

function mergeAppsScriptItems(existing, items) {
  const map = new Map(existing.map((p) => [p.platform, p]));
  for (const item of Array.isArray(items) ? items : []) {
    const platform = platformKey(item?.sns);
    if (!platform || platform === "x") continue;

    const status = String(item?.status || "");
    const excerpt = normalizeText(item?.title, 220);
    const url = String(item?.url || "").trim();
    const thumbnail = String(item?.thumbnailUrl || "").trim();
    const time = formatTokyoDate(item?.publishedAt);

    if (/未接続/.test(status)) continue;
    if (!excerpt && !url && !thumbnail && !time) continue;

    const previous = map.get(platform) || { platform };
    map.set(platform, {
      platform,
      excerpt: excerpt || previous.excerpt || "",
      time: time || previous.time || "最新",
      url: url || previous.url || "",
      thumbnail,
    });
  }
  return ORDER.map((k) => map.get(k)).filter(Boolean);
}

function findTweetCandidates(value, out = [], seen = new Set()) {
  if (!value || typeof value !== "object") return out;
  if (seen.has(value)) return out;
  seen.add(value);

  if (
    typeof value.id_str === "string" &&
    typeof value.text === "string" &&
    value.user &&
    typeof value.user.screen_name === "string"
  ) {
    out.push(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) findTweetCandidates(item, out, seen);
  } else {
    for (const item of Object.values(value)) findTweetCandidates(item, out, seen);
  }
  return out;
}

function newestTweet(candidates) {
  const matching = candidates.filter(
    (t) => String(t.user?.screen_name || "").toLowerCase() === X_HANDLE.toLowerCase()
  );
  const pool = matching.length ? matching : candidates;
  return pool
    .filter((t) => /^\d+$/.test(String(t.id_str || "")))
    .sort((a, b) => {
      const ai = BigInt(a.id_str);
      const bi = BigInt(b.id_str);
      return ai === bi ? 0 : ai > bi ? -1 : 1;
    })[0];
}

function tweetToken(id) {
  const big = BigInt(id);
  const hi = Number(big / 1_000_000_000_000_000n);
  const lo = Number(big % 1_000_000_000_000_000n) / 1e15;
  return ((hi + lo) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

function mediaThumbnail(tweet) {
  const directArrays = [
    tweet?.mediaDetails,
    tweet?.photos,
    tweet?.entities?.media,
    tweet?.extended_entities?.media,
  ].filter(Array.isArray);

  for (const arr of directArrays) {
    for (const m of arr) {
      const url =
        m?.media_url_https ||
        m?.media_url ||
        m?.url ||
        m?.image?.url ||
        m?.preview_image_url;
      if (url && /^https?:\/\//.test(url)) return url;
    }
  }

  const visited = new Set();
  function walk(value) {
    if (!value || typeof value !== "object") return "";
    if (visited.has(value)) return "";
    visited.add(value);

    if (!Array.isArray(value)) {
      for (const [key, v] of Object.entries(value)) {
        if (
          typeof v === "string" &&
          /^(https?:\/\/)/.test(v) &&
          /(media_url|preview_image|pbs\.twimg\.com\/media)/i.test(key + " " + v)
        ) {
          return v;
        }
      }
    }

    for (const v of Array.isArray(value) ? value : Object.values(value)) {
      const found = walk(v);
      if (found) return found;
    }
    return "";
  }
  return walk(tweet);
}

async function hydrateTweetById(id) {
  return await fetchJson(
    "https://cdn.syndication.twimg.com/tweet-result?id=" +
      encodeURIComponent(id) +
      "&lang=ja&token=" +
      tweetToken(id)
  );
}

function xPostFromTweet(tweet, fallbackId = "") {
  const id = String(tweet?.id_str || fallbackId || "");
  if (!id) throw new Error("X post id missing");
  return {
    platform: "x",
    excerpt: normalizeText(tweet?.text, 220) || "Xの最新投稿をチェック。",
    time: formatTokyoDate(tweet?.created_at) || "最新",
    url: "https://x.com/" + X_HANDLE + "/status/" + id,
    thumbnail: mediaThumbnail(tweet) || "",
  };
}

async function fetchLatestXFromYahoo() {
  const q = encodeURIComponent("from:" + X_HANDLE);
  const htmlRaw = await fetchText(
    "https://search.yahoo.co.jp/realtime/search?p=" + q + "&ei=UTF-8"
  );
  const html = htmlRaw
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

  const nextMatch = htmlRaw.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (nextMatch) {
    try {
      const yahooData = JSON.parse(nextMatch[1]);
      const records = [];
      const seen = new Set();
      (function walk(value) {
        if (!value || typeof value !== "object" || seen.has(value)) return;
        seen.add(value);
        if (
          !Array.isArray(value) &&
          typeof value.tweetId === "string" &&
          (typeof value.body === "string" || typeof value.imageUrl === "string")
        ) {
          records.push(value);
        }
        for (const child of Array.isArray(value) ? value : Object.values(value)) {
          walk(child);
        }
      })(yahooData);
      console.warn(
        "Yahoo tweet records sample:",
        JSON.stringify(records.slice(0, 12))
      );
    } catch (err) {
      console.warn("Yahoo __NEXT_DATA__ parse diagnostic failed:", err?.message || err);
    }
  }

  const re = new RegExp(
    "https?:\\\\/\\\\/(?:x|twitter)\\\\.com\\\\/" +
      X_HANDLE +
      "\\\\/status\\\\/(\\\\d+)",
    "gi"
  );
  const ids = [];
  let m;
  while ((m = re.exec(html))) ids.push(m[1]);

  const relative = new RegExp(
    "\\\\/" + X_HANDLE + "\\\\/status\\\\/(\\\\d+)",
    "gi"
  );
  while ((m = relative.exec(html))) ids.push(m[1]);

  const unique = [...new Set(ids)].filter((id) => /^\\d+$/.test(id));
  if (!unique.length) {
    const compact = htmlRaw.replace(/\s+/g, " ");
    const lower = compact.toLowerCase();
    const needles = [X_HANDLE.toLowerCase(), "tweetid", "status/", "tweet", "__next_data__"];
    for (const needle of needles) {
      const positions = [];
      let p = 0;
      while ((p = lower.indexOf(needle, p)) >= 0) {
        positions.push(p);
        p += needle.length;
      }
      console.warn("Yahoo diagnostic " + needle + " count=" + positions.length);
      for (const pos of positions.slice(-4)) {
        console.warn(compact.slice(Math.max(0, pos - 220), pos + 700));
      }
    }
    throw new Error("Yahoo realtime returned no X post ids");
  }

  unique.sort((a, b) => {
    const ai = BigInt(a);
    const bi = BigInt(b);
    return ai === bi ? 0 : ai > bi ? -1 : 1;
  });

  let lastErr;
  for (const id of unique.slice(0, 8)) {
    try {
      const tweet = await hydrateTweetById(id);
      if (
        tweet &&
        tweet.__typename !== "TweetTombstone" &&
        String(tweet?.user?.screen_name || "").toLowerCase() ===
          X_HANDLE.toLowerCase()
      ) {
        return xPostFromTweet(tweet, id);
      }
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(
    "X tweet hydration failed after Yahoo lookup: " +
      (lastErr?.message || "unknown")
  );
}

async function fetchLatestX() {
  try {
    const timelineUrl =
      "https://syndication.twitter.com/srv/timeline-profile/screen-name/" +
      encodeURIComponent(X_HANDLE);
    const html = await fetchText(timelineUrl);
    const match = html.match(
      /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
    );
    if (!match) throw new Error("X timeline __NEXT_DATA__ not found");

    const nextData = JSON.parse(match[1]);
    const baseTweet = newestTweet(findTweetCandidates(nextData));
    if (!baseTweet) throw new Error("No X post found in timeline");

    try {
      const hydrated = await hydrateTweetById(String(baseTweet.id_str));
      if (hydrated && hydrated.__typename !== "TweetTombstone") {
        return xPostFromTweet(hydrated, baseTweet.id_str);
      }
    } catch (err) {
      console.warn(
        "X hydration failed; using timeline data:",
        err?.message || err
      );
    }
    return xPostFromTweet(baseTweet, baseTweet.id_str);
  } catch (err) {
    console.warn(
      "X profile syndication failed; trying Yahoo realtime:",
      err?.message || err
    );
  }

  return await fetchLatestXFromYahoo();
}

async function main() {
  const current = JSON.parse(await readFile(FILE, "utf8"));
  const existing = Array.isArray(current.latestPosts) ? current.latestPosts : [];
  let nextPosts = existing;

  try {
    const payload = await fetchJson(API_URL);
    if (payload?.ok && Array.isArray(payload.items)) {
      nextPosts = mergeAppsScriptItems(nextPosts, payload.items);
    } else {
      throw new Error("Apps Script response did not include items");
    }
  } catch (err) {
    console.warn("Apps Script sync failed; keeping previous data:", err?.message || err);
  }

  try {
    const x = await fetchLatestX();
    const map = new Map(nextPosts.map((p) => [p.platform, p]));
    map.set("x", x);
    nextPosts = ORDER.map((k) => map.get(k)).filter(Boolean);
  } catch (err) {
    console.warn("X sync failed; keeping previous X data:", err?.message || err);
  }

  const before = JSON.stringify(existing);
  const after = JSON.stringify(nextPosts);
  if (before === after) {
    console.log("No SNS changes.");
    return;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    latestPosts: nextPosts,
  };
  await writeFile(FILE, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log("Updated latest-posts.json");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});