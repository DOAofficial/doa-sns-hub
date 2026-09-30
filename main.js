/* ============================================================================
   main.js ― CONFIG.js の内容を、実際のページに描画するファイルです。
   基本的に編集は不要です。内容を変えたい場合は config.js を編集してください。
   ============================================================================ */
(function () {
  "use strict";

  /* ---- SNSごとのシンプルアイコン（自作の線画・ブランド公式ロゴの複製ではありません） --- */
  var ICONS = {
    instagram:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="6"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/></svg>',
    tiktok:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="14" y1="4" x2="14" y2="14.5"/><circle cx="10.8" cy="14.5" r="3.2"/><path d="M14 4c.6 2.8 2.6 4.7 5.2 5.1"/></svg>',
    youtube:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10.5 9.3v5.4l4.7-2.7-4.7-2.7Z" fill="currentColor" stroke="none"/></svg>',
    x:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 4l16 16M20 4L4 20"/></svg>',
    threads:
      '<svg viewBox="0 0 24 24"><text x="12" y="16.5" text-anchor="middle" font-size="15" font-family="Arial, sans-serif" font-weight="700" fill="currentColor">@</text></svg>'
  };

  var PLATFORM_ORDER = ["instagram", "tiktok", "youtube", "x", "threads"];

  function latestFor(platform) {
    return (CONFIG.latestPosts || []).find(function (p) { return p.platform === platform; });
  }
  function isRecent(timeStr) {
    return /分前|時間前/.test(timeStr || "");
  }

  /* ---------- 公開後の最新投稿データを読み込む ----------
     1) GitHub上の自動同期ミラー latest-posts.json を最優先
        （Mac / iPhone で同じデータを確実に読むため）
     2) 同一サイト内の latest-posts.json
     3) Google Apps Script API
     4) すべて失敗した場合は config.js の CONFIG.latestPosts

     ※ file:// のローカル表示はブラウザの通信制限を避けるため、
        config.js のフォールバック表示を使います。 */
  function platformKeyFromApi(value) {
    var key = String(value || "").trim().toLowerCase();
    if (key === "instagram") return "instagram";
    if (key === "tiktok") return "tiktok";
    if (key === "youtube") return "youtube";
    if (key === "x" || key === "twitter") return "x";
    if (key === "threads") return "threads";
    return "";
  }

  function formatApiDate(value) {
    if (!value) return "";
    var raw = String(value).trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    var d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    try {
      var parts = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric"
      }).formatToParts(d);
      var month = "", day = "";
      parts.forEach(function (part) {
        if (part.type === "month") month = part.value;
        if (part.type === "day") day = part.value;
      });
      return month && day ? month + "/" + day : "";
    } catch (_) {
      return (d.getMonth() + 1) + "/" + d.getDate();
    }
  }

  function clipLatestText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 90);
  }

  function mergeApiLatest(items) {
    if (!Array.isArray(items) || !items.length) return false;

    var existing = {};
    (CONFIG.latestPosts || []).forEach(function (post) {
      if (post && post.platform) existing[post.platform] = post;
    });

    items.forEach(function (item) {
      var platform = platformKeyFromApi(item && item.sns);
      if (!platform) return;

      var previous = existing[platform] || { platform: platform };
      var excerpt = clipLatestText(item.title);
      var url = String(item.url || "").trim();
      var thumbnail = String(item.thumbnailUrl || "").trim();
      var time = formatApiDate(item.publishedAt);
      var status = String(item.status || "");

      // 未接続媒体（現在のXなど）は、config.js 側の既存表示を保持する。
      var disconnected = /未接続/.test(status);
      if (disconnected || (!excerpt && !url && !thumbnail && !time)) return;

      existing[platform] = {
        platform: platform,
        excerpt: excerpt || previous.excerpt || (CONFIG.sns[platform].label + "の最新投稿をチェック。"),
        time: time || previous.time || "最新",
        url: url || previous.url || CONFIG.sns[platform].url,
        thumbnail: thumbnail || ""
      };
    });

    CONFIG.latestPosts = PLATFORM_ORDER.map(function (key) { return existing[key]; }).filter(Boolean);
    return true;
  }

  function applyLatestPayload(payload) {
    // Apps Script API: { ok:true, items:[...] }
    if (payload && Array.isArray(payload.items)) {
      return mergeApiLatest(payload.items);
    }

    // 従来の latest-posts.json: { latestPosts:[...] } または配列
    var posts = Array.isArray(payload) ? payload : payload && payload.latestPosts;
    if (!Array.isArray(posts) || !posts.length) return false;
    CONFIG.latestPosts = posts;
    return true;
  }

  function fetchLatestJson(url) {
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    return fetch(url + sep + "v=" + Date.now(), {
      cache: "no-store",
      redirect: "follow"
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function loadRemoteLatest() {
    if (window.location.protocol === "file:") return Promise.resolve(false);

    var mirrorUrl = "https://raw.githubusercontent.com/DOAofficial/doa-sns-hub/main/latest-posts.json";
    var apiUrl = CONFIG.automation && CONFIG.automation.latestPostsApi;

    function usePayload(url, label) {
      return fetchLatestJson(url).then(function (payload) {
        if (!applyLatestPayload(payload)) throw new Error(label + " returned no usable items");
        return true;
      });
    }

    return usePayload(mirrorUrl, "GitHub mirror").catch(function (mirrorErr) {
      if (window.console && console.warn) console.warn("[SNS HUB] GitHub mirror fallback:", mirrorErr);
      return usePayload("latest-posts.json", "local latest-posts.json");
    }).catch(function (localErr) {
      if (window.console && console.warn) console.warn("[SNS HUB] local JSON fallback:", localErr);
      if (!apiUrl) throw new Error("Apps Script API URL is not configured");
      return usePayload(apiUrl, "Apps Script API");
    }).catch(function (fallbackErr) {
      if (window.console && console.warn) console.warn("[SNS HUB] latest data fallback to config.js:", fallbackErr);
      return false;
    });
  }

  function mediaThumbNode(key, post, className, recent) {
    var box = el("div", { class: "media-thumb " + className, "data-p": key });
    var fallback = function () {
      if (box.querySelector(".media-thumb-icon")) return;
      var icon = el("span", { class: "media-thumb-icon", html: ICONS[key] });
      box.insertBefore(icon, box.firstChild);
    };

    if (post && post.thumbnail) {
      var img = el("img", {
        class: "media-thumb-img",
        src: post.thumbnail,
        alt: "",
        loading: "lazy",
        decoding: "async",
        referrerpolicy: "no-referrer"
      });
      img.addEventListener("error", function () {
        img.remove();
        fallback();
      });
      box.appendChild(img);
    } else {
      fallback();
    }

    if (post) {
      box.appendChild(el("span", {
        class: "media-badge" + (recent ? " is-new" : ""),
        text: (recent ? "NEW ・ " : "") + post.time
      }));
    }
    return box;
  }

  /* ---------- ヘルパー ---------- */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "html") node.innerHTML = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function initials(name) {
    return (name || "?").trim().charAt(0).toUpperCase();
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  /* ---------- テーマ / メタ情報の適用 ---------- */
  function applyTheme() {
    if (CONFIG.site.accentColor) {
      document.documentElement.style.setProperty("--accent", CONFIG.site.accentColor);
    }
  }

  function applyMeta() {
    var s = CONFIG.site;
    var title = s.area + "ホストクラブ｜" + s.name + " " + s.subName;
    var desc = s.subTagline;
    document.title = title;
    var descTag = qs('meta[name="description"]');
    if (descTag) descTag.setAttribute("content", desc);
    var ogTitle = qs('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", title);
    var ogDesc = qs('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", desc);
    if (s.ogImage) {
      var ogImg = qs('meta[property="og:image"]');
      if (ogImg) ogImg.setAttribute("content", s.ogImage);
    }
  }

  /* ---------- ヘッダー / ロゴ ---------- */
  function renderBrand() {
    qsa("[data-brand-name]").forEach(function (n) { n.textContent = CONFIG.site.name; });
    qsa("[data-brand-sub]").forEach(function (n) { n.textContent = CONFIG.site.subName; });
    qsa("[data-brand-area]").forEach(function (n) { n.textContent = CONFIG.site.area; });

    // logoImage が設定されている場合のみ、ヘッダーのロゴをテキストから画像に差し替える。
    // 空のままなら何もしない（今まで通りテキストロゴのまま＝見た目は変わらない）。
    var logoSrc = CONFIG.site.logoImage;
    if (logoSrc) {
      var headerBrand = qs("#site-logo");
      if (headerBrand) {
        headerBrand.innerHTML = "";
        headerBrand.appendChild(el("img", {
          src: logoSrc,
          alt: CONFIG.site.name + " " + CONFIG.site.subName
        }));
      }
    }
  }

  /* ---------- スマホ専用の改行位置を制御するヘルパー ----------
     見出し・タグラインが単語の途中で不自然に折り返されるのを防ぐ。
     テキスト中に半角 "|" があれば、そこを改行位置として使う（優先・"|"自体は表示されない）。
     無ければ「、」の直後を既定の改行候補にする。
     PCでは<br class="mobile-break">は非表示のまま（1行 or 自然な折返し）。 */
  function setBreakableText(node, text) {
    if (!node) return;
    var t = text || "";

    var pipeIdx = t.indexOf("|");
    if (pipeIdx > -1) {
      node.innerHTML = "";
      node.appendChild(document.createTextNode(t.slice(0, pipeIdx)));
      node.appendChild(el("br", { class: "mobile-break" }));
      node.appendChild(document.createTextNode(t.slice(pipeIdx + 1)));
      return;
    }

    var commaIdx = t.indexOf("、");
    if (commaIdx > -1 && commaIdx < t.length - 1) {
      node.innerHTML = "";
      node.appendChild(document.createTextNode(t.slice(0, commaIdx + 1)));
      node.appendChild(el("br", { class: "mobile-break" }));
      node.appendChild(document.createTextNode(t.slice(commaIdx + 1)));
      return;
    }

    node.textContent = t;
  }

  function setMultilineText(node, text) {
    if (!node) return;
    var parts = String(text || "").split(/\n/);
    node.innerHTML = "";
    parts.forEach(function (part, i) {
      if (i) node.appendChild(document.createElement("br"));
      node.appendChild(document.createTextNode(part));
    });
  }

  /* ---------- CONFIG.copy の文言を各所に反映 ----------
     ナビゲーション・各セクションの見出し／説明文／小さな一言など、
     静的HTML側に文字が書かれている箇所をここでまとめて上書きする。 */
  function applySectionCopy() {
    var c = CONFIG.copy || {};

    var nav = c.nav || {};
    Object.keys(nav).forEach(function (key) {
      qsa('[data-nav="' + key + '"]').forEach(function (n) { n.textContent = nav[key]; });
    });

    var heroText = qs("#hero-activity-text");
    if (heroText && c.hero) heroText.textContent = c.hero.activity;

    if (c.snsSection) {
      var snsEyebrow = qs("#sns-eyebrow");
      if (snsEyebrow) snsEyebrow.textContent = c.snsSection.eyebrow;
      setBreakableText(qs("#sns-heading"), c.snsSection.heading);
      var snsBody = qs("#sns-body");
      if (snsBody) setMultilineText(snsBody, c.snsSection.body);
    }

    if (c.followAll) {
      var followEyebrow = qs("#follow-eyebrow");
      if (followEyebrow) followEyebrow.textContent = c.followAll.eyebrow;
      setBreakableText(qs("#follow-heading"), c.followAll.heading);
      var followBody = qs("#follow-body");
      if (followBody) setMultilineText(followBody, c.followAll.body);
      var followNote = qs("#follow-note-text");
      if (followNote) followNote.textContent = c.followAll.note;
    }

    if (c.latestSection) {
      var latestEyebrow = qs("#latest-eyebrow");
      if (latestEyebrow) latestEyebrow.textContent = c.latestSection.eyebrow;
      var latestStatus = qs("#latest-status-pill");
      if (latestStatus) latestStatus.textContent = c.latestSection.statusPill;
      setBreakableText(qs("#latest-heading"), c.latestSection.heading);
      var latestBody = qs("#latest-body");
      if (latestBody) setMultilineText(latestBody, c.latestSection.body);
    }

    if (c.castSection) {
      var castEyebrow = qs("#cast-eyebrow");
      if (castEyebrow) castEyebrow.textContent = c.castSection.eyebrow;
      setBreakableText(qs("#cast-heading"), c.castSection.heading);
      var castBody = qs("#cast-body");
      if (castBody) setMultilineText(castBody, c.castSection.body);
    }

    if (c.footer) {
      var menuLabel = qs("#footer-menu-label");
      if (menuLabel) menuLabel.textContent = c.footer.menuLabel;
      var disclaimer = qs("#footer-disclaimer");
      if (disclaimer) disclaimer.textContent = c.footer.disclaimer;
      var backTop = qs("#footer-back-top");
      if (backTop) backTop.textContent = c.footer.backToTop;
    }
  }

  /* ---------- ヒーロー ---------- */
  function renderHero() {
    var eyebrow = qs("#hero-eyebrow");
    if (eyebrow) eyebrow.textContent = CONFIG.site.eyebrow;
    var word = qs("#hero-word");
    if (word) word.textContent = CONFIG.site.name;
    var sub = qs("#hero-subword");
    if (sub) sub.textContent = CONFIG.site.subName;
    setBreakableText(qs("#hero-tagline"), CONFIG.site.tagline);
    var subtagline = qs("#hero-subtagline");
    if (subtagline) subtagline.textContent = CONFIG.site.subTagline;

    var platforms = qs("#hero-platforms");
    if (platforms) {
      platforms.innerHTML = "";
      PLATFORM_ORDER.forEach(function (key) {
        var s = CONFIG.sns[key];
        if (!s || !s.url) return;
        platforms.appendChild(el("a", { href: s.url, target: "_blank", rel: "noopener", class: "platform-chip", "data-p": key }, [
          el("span", { class: "chip-icon", html: ICONS[key] }),
          el("span", { class: "chip-label", text: s.label })
        ]));
      });
    }
  }

  /* ---------- ヒーロー内オービットのアイコンノード ---------- */
  var ORBIT_POSITIONS = {
    instagram: [150, 30],
    tiktok: [264, 113],
    youtube: [220, 247],
    x: [79, 247],
    threads: [36, 113]
  };
  function renderOrbitNodes() {
    var g = qs("#orbit-nodes");
    if (!g) return;
    var html = "";
    PLATFORM_ORDER.forEach(function (key) {
      var pos = ORBIT_POSITIONS[key];
      if (!pos) return;
      var cx = pos[0], cy = pos[1];
      var iconSvg = ICONS[key].replace("<svg ", '<svg x="' + (cx - 8) + '" y="' + (cy - 8) + '" width="16" height="16" ');
      html += '<g class="orbit-node-group" data-p="' + key + '">' +
                '<circle class="orbit-node-bg" cx="' + cx + '" cy="' + cy + '" r="15.5"></circle>' +
                iconSvg +
              "</g>";
    });
    g.innerHTML = html;
  }

  /* ---------- SNSカード ---------- */
  function snsIconNode(key, extraClass) {
    return el("span", { class: "sns-icon " + (extraClass || ""), html: ICONS[key] });
  }

  function renderSnsCards() {
    var grid = qs("#sns-grid");
    if (!grid) return;
    grid.innerHTML = "";
    PLATFORM_ORDER.forEach(function (key, i) {
      var s = CONFIG.sns[key];
      if (!s || !s.url) return;
      var post = latestFor(key);
      var postUrl = (post && post.url) || s.url;
      var recent = post ? isRecent(post.time) : false;

      var preview = el("a", {
        class: "sns-card-preview", href: postUrl, target: "_blank", rel: "noopener",
        "aria-label": s.label + "の最新投稿を見る"
      }, [
        mediaThumbNode(key, post, "preview-thumb", recent),
        el("p", { class: "preview-caption", text: (post && post.excerpt) || s.role })
      ]);

      var card = el("article", { class: "sns-card reveal", "data-p": key, style: "--i:" + i }, [
        el("div", { class: "sns-card-top" }, [
          snsIconNode(key),
          el("span", { class: "sns-handle", text: s.handle }),
          post ? el("span", { class: "sns-card-time" + (recent ? " is-new" : ""), text: post.time }) : null
        ]),
        preview,
        el("div", { class: "sns-card-info" }, [
          el("div", { class: "label", text: s.label }),
          el("div", { class: "role", text: s.role })
        ]),
        el("div", { class: "sns-card-actions" }, [
          el("a", { href: postUrl, target: "_blank", rel: "noopener", class: "btn btn-ghost", text: (CONFIG.copy && CONFIG.copy.buttons && CONFIG.copy.buttons.viewPost) || "投稿を見る" }),
          el("a", { href: s.url, target: "_blank", rel: "noopener", class: "btn btn-primary", text: s.cta })
        ])
      ]);
      grid.appendChild(card);
    });
  }

  /* ---------- FOLLOW ALL SNS ---------- */
  function renderFollowAll() {
    var row = qs("#follow-row");
    if (!row) return;
    row.innerHTML = "";
    var n = 0;
    PLATFORM_ORDER.forEach(function (key) {
      var s = CONFIG.sns[key];
      if (!s || !s.url) return;
      n += 1;
      var index = (n < 10 ? "0" + n : "" + n);
      row.appendChild(el("a", { href: s.url, target: "_blank", rel: "noopener", class: "follow-chip" }, [
        el("span", { class: "follow-index", text: index }),
        snsIconNode(key),
        el("span", { text: s.label })
      ]));
    });
  }

  /* ---------- LATEST SOCIALS ---------- */
  function renderLatest() {
    var track = qs("#latest-track");
    if (!track) return;
    track.innerHTML = "";
    (CONFIG.latestPosts || []).forEach(function (post) {
      var s = CONFIG.sns[post.platform];
      if (!s) return;
      var recent = isRecent(post.time);
      var card = el("div", { class: "latest-card reveal" }, [
        mediaThumbNode(post.platform, post, "latest-thumb", recent),
        el("div", { class: "latest-body" }, [
          el("div", { class: "plat" }, [
            el("span", { html: ICONS[post.platform] }),
            el("span", { text: s.label })
          ]),
          el("p", { text: post.excerpt }),
          el("a", { href: post.url, target: "_blank", rel: "noopener", text: ((CONFIG.copy && CONFIG.copy.buttons && CONFIG.copy.buttons.viewPost) || "投稿を見る") + " →" })
        ])
      ]);
      track.appendChild(card);
    });
  }

  /* ---------- CAST グリッド ---------- */
  function castPhotoNode(cast, sizeClass) {
    if (cast.image) {
      return el("img", { src: cast.image, alt: cast.name });
    }
    return el("span", { class: "initial", text: initials(cast.name) });
  }

  function renderCastGrid() {
    var grid = qs("#cast-grid");
    if (!grid) return;
    grid.innerHTML = "";
    (CONFIG.cast || []).forEach(function (cast, i) {
      var photoLink = el("a", { class: "cast-photo", href: "cast.html?id=" + encodeURIComponent(cast.id) }, [
        castPhotoNode(cast),
        el("div", { class: "cast-photo-scrim" }),
        el("div", { class: "cast-photo-caption" }, [
          cast.title ? el("span", { class: "cast-title-tag", text: cast.title }) : null,
          el("span", { class: "cast-name-tag", text: cast.name })
        ])
      ]);

      var snsRow = el("div", { class: "cast-sns-row" });
      PLATFORM_ORDER.forEach(function (key) {
        var url = cast.sns && cast.sns[key];
        if (!url) return;
        snsRow.appendChild(el("a", { href: url, target: "_blank", rel: "noopener", "aria-label": key }, [
          el("span", { html: ICONS[key] })
        ]));
      });

      var card = el("div", { class: "cast-card reveal", style: "--i:" + i }, [
        photoLink,
        el("div", { class: "cast-foot" }, [
          cast.comment ? el("p", { class: "cast-comment", text: cast.comment }) : null,
          snsRow
        ])
      ]);
      grid.appendChild(card);
    });
  }

  /* ---------- CAST 個人ページ ---------- */
  function renderCastDetail() {
    var root = qs("#cast-detail");
    if (!root) return;
    var cd = (CONFIG.copy && CONFIG.copy.castDetail) || {};
    var id = getParam("id");
    var cast = (CONFIG.cast || []).find(function (c) { return c.id === id; });

    if (!cast) {
      root.innerHTML = "";
      root.appendChild(el("div", { class: "notfound" }, [
        el("h1", { text: cd.notFoundTitle || "キャストが見つかりませんでした" }),
        el("p", { text: cd.notFoundBody || "URLをご確認いただくか、一覧からお探しください。" }),
        el("a", { href: "index.html#cast", class: "btn btn-primary", text: cd.notFoundBtn || "CAST一覧へ戻る" })
      ]));
      return;
    }

    document.title = cast.name + " ｜ " + CONFIG.site.name + " " + CONFIG.site.subName;

    var head = el("div", { class: "cast-detail-head" }, [
      el("div", { class: "cast-detail-photo" }, [castPhotoNode(cast)]),
      el("div", {}, [
        cast.title ? el("div", { class: "cast-detail-title", text: cast.title }) : null,
        el("h1", { class: "cast-detail-name", text: cast.name }),
        cast.comment ? el("p", { class: "cast-detail-comment", text: cast.comment }) : null
      ])
    ]);

    var snsGrid = el("div", { class: "cast-detail-sns" });
    PLATFORM_ORDER.forEach(function (key) {
      var url = cast.sns && cast.sns[key];
      var meta = CONFIG.sns[key];
      if (!url) return;
      snsGrid.appendChild(el("a", { href: url, target: "_blank", rel: "noopener", class: "follow-chip" }, [
        snsIconNode(key),
        el("span", { text: meta.label })
      ]));
    });

    var soon = el("div", { class: "cast-detail-soon", text: cd.comingSoon || "出勤情報・ご予約は現在準備中です。最新情報は各SNSをご確認ください。" });

    root.appendChild(el("a", { href: "index.html#cast", class: "back-link" }, [
      el("span", { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 5l-7 7 7 7"/></svg>' }),
      el("span", { text: cd.backLink || "CAST一覧に戻る" })
    ]));
    root.appendChild(head);
    root.appendChild(snsGrid);
    root.appendChild(soon);
  }

  /* ---------- RECRUIT ---------- */
  function renderRecruit() {
    var r = CONFIG.recruit;
    var eyebrow = qs("#recruit-eyebrow");
    if (eyebrow) eyebrow.textContent = r.eyebrow;
    var headline = qs("#recruit-headline");
    // "|" が config.js 側の headline に入っていれば、その位置でスマホ改行する
    setBreakableText(headline, r.headline);
    var body = qs("#recruit-body");
    if (body) setMultilineText(body, r.body);
    var btn = qs("#recruit-btn");
    if (btn) { btn.textContent = r.buttonLabel; btn.href = r.url; }
  }

  /* ---------- 予約フローティングボタン ---------- */
  function renderReserveFab() {
    var fab = qs("#reserve-fab");
    if (!fab) return;
    fab.href = CONFIG.reservation.url;

    var fullLabel = CONFIG.reservation.buttonLabel || "";
    var shortLabel = fullLabel.split("・")[0] || fullLabel;
    var fullEl = qs("#reserve-fab-label");
    var shortEl = qs("#reserve-fab-label-short");
    if (fullEl) fullEl.textContent = fullLabel;
    if (shortEl) shortEl.textContent = shortLabel;

    var footer = qs(".site-footer");
    var hero = qs(".hero");

    function update() {
      // フッターに近づいたら、重ならないよう非表示にする
      if (footer) {
        var footerTop = footer.getBoundingClientRect().top;
        if (footerTop < window.innerHeight * 0.92) {
          fab.classList.remove("is-visible");
          return;
        }
      }
      if (!hero) {
        // ヒーローが無いページ（キャスト個人ページなど）は常に表示する
        fab.classList.add("is-visible");
        return;
      }
      fab.classList.toggle("is-visible", window.scrollY > window.innerHeight * 0.9);
    }

    var scrollTimer = null;
    window.addEventListener("scroll", function () {
      update();
      fab.classList.add("is-scrolling");
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () { fab.classList.remove("is-scrolling"); }, 220);
    }, { passive: true });
    window.addEventListener("resize", update, { passive: true });

    update();
  }

  /* ---------- フッター ---------- */
  function renderFooterSns() {
    var row = qs("#footer-social");
    if (!row) return;
    row.innerHTML = "";
    PLATFORM_ORDER.forEach(function (key) {
      var s = CONFIG.sns[key];
      if (!s || !s.url) return;
      row.appendChild(el("a", { href: s.url, target: "_blank", rel: "noopener", "aria-label": s.label }, [
        el("span", { html: ICONS[key] })
      ]));
    });
  }

  /* ---------- LATEST SOCIALSのスワイプ方向ヒント ---------- */
  function initLatestScrollHints() {
    var track = qs("#latest-track");
    var wrap = qs("#latest-track-wrap");
    if (!track || !wrap) return;
    function update() {
      var maxScroll = track.scrollWidth - track.clientWidth;
      wrap.classList.toggle("can-scroll-left", track.scrollLeft > 8);
      wrap.classList.toggle("can-scroll-right", maxScroll > 8 && track.scrollLeft < maxScroll - 8);
    }
    track.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  /* ---------- スクロールリビール ----------
     .reveal は CSS 側では常に「表示状態」がデフォルト。
     ここで初めて .reveal-armed を付けてフェードイン演出の対象にする。
     → この関数が実行されなかった場合（JS無効・一部プレビュー環境など）でも
       コンテンツは常に表示されたままになる。 */
  function initReveal() {
    var els = qsa(".reveal");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) return; // 未対応環境は常時表示のままでOK

    els.forEach(function (n) { n.classList.add("reveal-armed"); });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -6% 0px" });
    els.forEach(function (n) { io.observe(n); });

    // 万一オブザーバーが発火しない環境向けの保険（一定時間後は必ず表示）
    setTimeout(function () {
      qsa(".reveal-armed:not(.in-view)").forEach(function (n) { n.classList.add("in-view"); });
    }, 2500);
  }

  /* ---------- ヘッダー / モバイルメニュー ---------- */
  function initHeader() {
    var header = qs(".site-header");
    if (header) {
      window.addEventListener("scroll", function () {
        header.classList.toggle("scrolled", window.scrollY > 30);
      }, { passive: true });
    }
    var toggle = qs("#menu-toggle");
    var menu = qs("#mobile-menu");
    if (toggle && menu) {
      toggle.addEventListener("click", function () {
        var open = toggle.classList.toggle("is-open");
        menu.classList.toggle("is-open", open);
        document.body.style.overflow = open ? "hidden" : "";
      });
      qsa("a", menu).forEach(function (a) {
        a.addEventListener("click", function () {
          toggle.classList.remove("is-open");
          menu.classList.remove("is-open");
          document.body.style.overflow = "";
        });
      });
    }
  }

  /* ---------- 安全実行ヘルパー ----------
     どこか1箇所でエラーが起きても、他のセクションの描画を止めないようにする。 */
  function safe(fn, label) {
    try {
      fn();
    } catch (e) {
      if (window.console && console.error) console.error("[SNS HUB] " + label + " failed:", e);
    }
  }

  /* ---------- 初期化 ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    safe(applyTheme, "applyTheme");
    safe(applyMeta, "applyMeta");
    safe(renderBrand, "renderBrand");
    safe(applySectionCopy, "applySectionCopy");
    safe(initHeader, "initHeader");

    // トップページ要素
    safe(renderHero, "renderHero");
    safe(renderOrbitNodes, "renderOrbitNodes");
    safe(renderSnsCards, "renderSnsCards");
    safe(renderFollowAll, "renderFollowAll");
    safe(renderLatest, "renderLatest");
    safe(initLatestScrollHints, "initLatestScrollHints");

    // 公開環境では自動更新ファイルを取得し、SNSカードとLATESTだけ再描画。
    loadRemoteLatest().then(function (changed) {
      if (!changed) return;
      safe(renderSnsCards, "renderSnsCards(remote)");
      safe(renderLatest, "renderLatest(remote)");
      safe(initLatestScrollHints, "initLatestScrollHints(remote)");
      safe(initReveal, "initReveal(remote)");
    });

    safe(renderCastGrid, "renderCastGrid");
    safe(renderRecruit, "renderRecruit");
    safe(renderReserveFab, "renderReserveFab");
    safe(renderFooterSns, "renderFooterSns");

    // キャスト個人ページ要素
    safe(renderCastDetail, "renderCastDetail");

    safe(initReveal, "initReveal");
  });
})();