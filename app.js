(function () {
  "use strict";

  var STATUS_COLORS = {
    "прочитал": "#4aba70",
    "читаю": "#e8c547",
    "хочу прочитать": "#c45c5c",
  };
  var MONTH_NAMES = [
    "янв", "фев", "мар", "апр", "май", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек",
  ];
  var BASE_PPD = 8;

  var timelineEl = document.getElementById("timeline");
  var axisEl = document.getElementById("timeline-axis");
  var itemsEl = document.getElementById("timeline-items");
  var panel = document.getElementById("book-panel");
  var panelClose = document.getElementById("panel-close");
  var panelContent = document.getElementById("panel-content");

  // --- Helpers ---

  function parseDate(str) {
    if (!str) return null;
    var parts = str.split("-");
    return new Date(+parts[0], +parts[1] - 1, +parts[2] || 1);
  }

  function daysBetween(a, b) {
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // --- Build timeline ---

  function buildTimeline() {
    if (typeof BOOKS === "undefined" || !BOOKS.length) return;

    var today = new Date();
    var GAP = 14;

    var withDate = [];
    var withoutDate = [];

    for (var i = 0; i < BOOKS.length; i++) {
      var b = BOOKS[i];
      var sd = parseDate(b.startDate);
      if (sd) {
        withDate.push({ book: b, start: sd, end: parseDate(b.endDate) });
      } else {
        withoutDate.push(b);
      }
    }

    if (withDate.length === 0) return;

    // Compute anchor date (top circle) for each entry
    for (var i = 0; i < withDate.length; i++) {
      var e = withDate[i];
      e.anchor = e.end || (e.book.status === "читаю" ? today : e.start);
    }

    // Sort newest anchor first
    withDate.sort(function (a, b) { return b.anchor - a.anchor; });

    // Date range
    var earliest = new Date(withDate[0].start);
    var latest = new Date(withDate[0].start);
    for (var i = 0; i < withDate.length; i++) {
      if (withDate[i].start < earliest) earliest = new Date(withDate[i].start);
      if (withDate[i].end && withDate[i].end > latest) latest = new Date(withDate[i].end);
    }
    if (today > latest) latest = new Date(today);

    // Padding
    latest = new Date(latest.getTime() + 7 * 86400000);
    earliest = new Date(earliest.getTime() - 14 * 86400000);

    var totalDays = daysBetween(earliest, latest);

    // dayIdx: latest=0 (top of page), earliest=totalDays (bottom)
    function dayIdx(d) {
      var di = daysBetween(d, latest);
      if (di < 0) return 0;
      if (di > totalDays) return totalDays;
      return di;
    }

    // --- Pass 1: create cards (hidden), measure ---
    var placedItems = [];

    for (var i = 0; i < withDate.length; i++) {
      var entry = withDate[i];
      var book = entry.book;

      var item = document.createElement("div");
      item.className = "tl-item left";
      item.style.top = "0px";
      item.style.visibility = "hidden";
      item.setAttribute("data-status", book.status || "");
      item._bookData = book;
      item._entry = entry;

      var card = document.createElement("div");
      card.className = "tl-card";

      var titleEl = document.createElement("div");
      titleEl.className = "tl-title";
      titleEl.textContent = book.title;
      card.appendChild(titleEl);

      var authorEl = document.createElement("div");
      authorEl.className = "tl-author";
      authorEl.textContent = book.author;
      card.appendChild(authorEl);

      var meta = document.createElement("div");
      meta.className = "tl-meta";

      if (book.status) {
        var statusEl = document.createElement("span");
        statusEl.className = "tl-status";
        statusEl.setAttribute("data-status", book.status);
        statusEl.textContent = book.status;
        meta.appendChild(statusEl);
      }

      var datesEl = document.createElement("span");
      datesEl.className = "tl-dates";
      var dStr = formatDate(book.startDate);
      if (book.endDate) dStr += " \u2014 " + formatDate(book.endDate);
      datesEl.textContent = dStr;
      meta.appendChild(datesEl);

      if (book.rating) {
        var ratingEl = document.createElement("span");
        ratingEl.className = "tl-rating";
        var stars = "";
        for (var s = 1; s <= 5; s++) {
          stars += s <= book.rating ? "\u2605" : "\u2606";
        }
        ratingEl.textContent = stars;
        meta.appendChild(ratingEl);
      }

      card.appendChild(meta);

      if (book.categories && book.categories.length > 0) {
        var cats = document.createElement("div");
        cats.className = "tl-categories";
        cats.textContent = book.categories.join(" / ");
        card.appendChild(cats);
      }

      card.addEventListener("click", (function (b) {
        return function (e) {
          e.stopPropagation();
          showBookPanel(b);
        };
      })(book));

      item.appendChild(card);
      itemsEl.appendChild(item);
      placedItems.push(item);
    }

    // Measure card heights
    for (var i = 0; i < placedItems.length; i++) {
      placedItems[i]._measuredH = placedItems[i].getBoundingClientRect().height;
    }

    // --- Assign sides (greedy with base scale) ---
    var baseSideBot = { left: 0, right: 0 };
    for (var i = 0; i < placedItems.length; i++) {
      var item = placedItems[i];
      var baseY = dayIdx(item._entry.anchor) * BASE_PPD;
      var side = baseSideBot.left <= baseSideBot.right ? "left" : "right";
      item._side = side;
      baseSideBot[side] = Math.max(baseSideBot[side], baseY) + item._measuredH + GAP;
    }

    // --- Adaptive day scale ---
    var dayScale = new Array(totalDays + 1);
    for (var d = 0; d <= totalDays; d++) dayScale[d] = BASE_PPD;

    var leftCards = [];
    var rightCards = [];
    for (var i = 0; i < placedItems.length; i++) {
      if (placedItems[i]._side === "left") leftCards.push(placedItems[i]);
      else rightCards.push(placedItems[i]);
    }

    function applyConstraints(cards) {
      for (var i = 0; i < cards.length; i++) {
        var di1 = dayIdx(cards[i]._entry.anchor);
        var di2 = (i + 1 < cards.length) ? dayIdx(cards[i + 1]._entry.anchor) : totalDays;
        var numDays = di2 - di1;
        if (numDays <= 0) numDays = 1;
        var neededPpd = (cards[i]._measuredH + GAP) / numDays;
        if (neededPpd > BASE_PPD) {
          for (var d = di1; d < di2; d++) {
            if (dayScale[d] < neededPpd) dayScale[d] = neededPpd;
          }
        }
      }
    }

    applyConstraints(leftCards);
    applyConstraints(rightCards);

    // --- Cumulative Y from day scale ---
    var cumY = new Array(totalDays + 2);
    cumY[0] = 0;
    for (var d = 0; d <= totalDays; d++) {
      cumY[d + 1] = cumY[d] + dayScale[d];
    }
    var totalHeight = cumY[totalDays + 1];

    function dateToY(d) {
      var di = dayIdx(d);
      return cumY[di];
    }

    // Set container heights
    itemsEl.style.height = totalHeight + "px";
    axisEl.style.top = "80px";
    axisEl.style.height = totalHeight + "px";

    // --- Axis markers at month boundaries ---
    var rangeStartMonth = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    var rangeEndMonth = new Date(latest.getFullYear(), latest.getMonth() + 1, 1);
    var cur = new Date(rangeStartMonth);
    while (cur <= rangeEndMonth) {
      var yy = cur.getFullYear();
      var mm = cur.getMonth();
      var boundaryY = dateToY(cur);

      if (mm === 0) {
        var yearEl = document.createElement("div");
        yearEl.className = "axis-year";
        yearEl.style.top = boundaryY + "px";
        var span = document.createElement("span");
        span.textContent = yy;
        yearEl.appendChild(span);
        itemsEl.appendChild(yearEl);
      } else {
        var monthEl = document.createElement("div");
        monthEl.className = "axis-month" + (cur <= today ? " past" : "");
        monthEl.style.top = boundaryY + "px";
        var dot = document.createElement("div");
        dot.className = "axis-month-dot";
        monthEl.appendChild(dot);
        var label = document.createElement("div");
        label.className = "axis-month-label";
        label.textContent = MONTH_NAMES[mm];
        monthEl.appendChild(label);
        itemsEl.appendChild(monthEl);
      }

      cur = new Date(yy, mm + 1, 1);
    }

    // "Now" marker
    var nowY = dateToY(today);
    if (nowY >= 0 && nowY <= totalHeight) {
      var nowEl = document.createElement("div");
      nowEl.className = "axis-now";
      nowEl.style.top = nowY + "px";
      var nowLine = document.createElement("div");
      nowLine.className = "axis-now-line";
      nowEl.appendChild(nowLine);
      var nowLabel = document.createElement("div");
      nowLabel.className = "axis-now-label";
      nowLabel.textContent = "сейчас";
      nowEl.appendChild(nowLabel);
      itemsEl.appendChild(nowEl);
    }

    // --- Pass 2: Place cards with collision resolution ---
    var sideBottom = { left: 0, right: 0 };
    for (var i = 0; i < placedItems.length; i++) {
      var item = placedItems[i];
      var y = dateToY(item._entry.anchor);
      var side = item._side;
      if (y < sideBottom[side]) {
        y = sideBottom[side];
      }
      sideBottom[side] = y + item._measuredH + GAP;
      item.className = "tl-item " + side;
      item.style.top = y + "px";
      item.style.visibility = "";
      item._placedY = y;
    }

    // Extend container if collision resolution pushed cards beyond totalHeight
    var maxBottom = Math.max(sideBottom.left, sideBottom.right);
    if (maxBottom > totalHeight) {
      totalHeight = maxBottom;
      itemsEl.style.height = totalHeight + "px";
      axisEl.style.height = totalHeight + "px";
    }

    // --- Duration tracks (per-side lane assignment) ---
    var LANE_WIDTH = 4;
    var LANE_GAP = 6;
    var TRACK_OFFSET = 10;
    var leftTracks = [];
    var rightTracks = [];

    for (var i = 0; i < placedItems.length; i++) {
      var item = placedItems[i];
      var entry = item._entry;
      if (!entry.end && entry.book.status !== "читаю") continue;
      var endDate = entry.end || today;
      var topY = dateToY(endDate);
      var botY = dateToY(entry.start);
      if (botY - topY < 2) botY = topY + 2;
      var t = {
        topY: topY, botY: botY,
        color: STATUS_COLORS[entry.book.status] || "#666",
        status: entry.book.status || "",
        side: item._side,
        lane: 0,
      };
      item._track = t;
      if (item._side === "left") leftTracks.push(t);
      else rightTracks.push(t);
    }

    function assignLanes(list) {
      list.sort(function (a, b) { return a.topY - b.topY; });
      var ends = [];
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        var assigned = -1;
        for (var l = 0; l < ends.length; l++) {
          if (ends[l] <= t.topY) { assigned = l; break; }
        }
        if (assigned === -1) { assigned = ends.length; ends.push(0); }
        t.lane = assigned;
        ends[assigned] = t.botY + 4;
      }
    }

    assignLanes(leftTracks);
    assignLanes(rightTracks);

    // Render tracks
    var trackContainer = document.createElement("div");
    trackContainer.id = "track-container";
    itemsEl.appendChild(trackContainer);

    var allTracks = leftTracks.concat(rightTracks);
    for (var i = 0; i < allTracks.length; i++) {
      var t = allTracks[i];
      var h = t.botY - t.topY;
      var step = TRACK_OFFSET + t.lane * (LANE_WIDTH + LANE_GAP);
      var offset = (t.side === "right") ? step : -step;
      var el = document.createElement("div");
      el.className = "tl-track";
      el.setAttribute("data-status", t.status);
      el.style.top = t.topY + "px";
      el.style.height = h + "px";
      el.style.left = "calc(50% + " + (offset - LANE_WIDTH / 2) + "px)";
      el.style.width = LANE_WIDTH + "px";
      el.style.setProperty("--track-color", t.color);
      trackContainer.appendChild(el);
    }

    // --- Connector lines from cards to their tracks ---
    var isMobile = window.innerWidth <= 640;
    var itemGap = isMobile ? 24 : 40;

    for (var i = 0; i < placedItems.length; i++) {
      var item = placedItems[i];
      var cardY = item._placedY;
      var side = item._side;
      var track = item._track;

      var connWidth;
      if (track) {
        var step = TRACK_OFFSET + track.lane * (LANE_WIDTH + LANE_GAP);
        connWidth = itemGap - step + LANE_WIDTH / 2;
      } else {
        connWidth = itemGap;
      }
      if (connWidth <= 0) continue;

      var conn = document.createElement("div");
      conn.className = "tl-connector";
      conn.setAttribute("data-status", item.getAttribute("data-status") || "");
      conn.style.position = "absolute";
      conn.style.height = "1px";
      conn.style.width = connWidth + "px";
      conn.style.background = "#2a2a2e";
      conn.style.zIndex = "2";
      conn.style.top = cardY + "px";

      if (side === "left") {
        conn.style.left = "calc(50% - " + itemGap + "px)";
      } else {
        conn.style.left = "calc(50% + " + (itemGap - connWidth) + "px)";
      }

      itemsEl.appendChild(conn);
    }

    // --- No-date books ---
    if (withoutDate.length > 0) {
      var section = document.createElement("div");
      section.id = "no-date-section";

      var label = document.createElement("div");
      label.id = "no-date-label";
      label.textContent = "БЕЗ ДАТЫ";
      section.appendChild(label);

      var container = document.createElement("div");
      container.id = "no-date-items";

      for (var i = 0; i < withoutDate.length; i++) {
        var book = withoutDate[i];
        var card = document.createElement("div");
        card.className = "tl-card";
        card.setAttribute("data-status", book.status || "");

        var titleEl = document.createElement("div");
        titleEl.className = "tl-title";
        titleEl.textContent = book.title;
        card.appendChild(titleEl);

        var authorEl = document.createElement("div");
        authorEl.className = "tl-author";
        authorEl.textContent = book.author;
        card.appendChild(authorEl);

        if (book.status) {
          var statusEl = document.createElement("span");
          statusEl.className = "tl-status";
          statusEl.setAttribute("data-status", book.status);
          statusEl.textContent = book.status;
          card.appendChild(statusEl);
        }

        card.addEventListener("click", (function (b) {
          return function (e) {
            e.stopPropagation();
            showBookPanel(b);
          };
        })(book));

        container.appendChild(card);
      }

      section.appendChild(container);
      timelineEl.appendChild(section);
    }
  }

  function formatDate(str) {
    if (!str) return "";
    var parts = str.split("-");
    if (parts.length < 2) return str;
    var m = +parts[1] - 1;
    return +parts[2] + " " + MONTH_NAMES[m] + " " + parts[0];
  }

  // --- Book panel ---

  function showBookPanel(data) {
    var html = "";

    if (data.cover) {
      html += '<img class="book-cover" src="' + escapeHtml(data.cover) + '" alt="' + escapeHtml(data.title) + '">';
    }

    html += '<h2 class="book-title">' + escapeHtml(data.title) + "</h2>";
    html += '<p class="book-author">' + escapeHtml(data.author) + "</p>";

    if (data.status) {
      html += '<p class="book-status">' + escapeHtml(data.status) + "</p>";
    }

    if (data.rating) {
      var stars = "";
      for (var i = 1; i <= 5; i++) {
        stars += i <= data.rating ? "\u2605" : "\u2606";
      }
      html += '<p class="book-rating">' + stars + "</p>";
    }

    if (data.startDate || data.endDate) {
      var dates = "";
      if (data.startDate) dates += data.startDate;
      if (data.startDate && data.endDate) dates += " \u2014 ";
      if (data.endDate) dates += data.endDate;
      html += '<p class="book-dates">' + escapeHtml(dates) + "</p>";
    }

    if (data.notes) {
      html += '<p class="book-notes">' + escapeHtml(data.notes) + "</p>";
    }

    if (data.quotes && data.quotes.length > 0) {
      html += '<div class="book-quotes">';
      for (var i = 0; i < data.quotes.length; i++) {
        html += "<blockquote>" + escapeHtml(data.quotes[i]) + "</blockquote>";
      }
      html += "</div>";
    }

    panelContent.innerHTML = html;
    panel.classList.add("open");
  }

  function closePanel() {
    panel.classList.remove("open");
  }

  panelClose.addEventListener("click", closePanel);

  document.addEventListener("click", function (e) {
    if (panel.classList.contains("open") && !panel.contains(e.target) && !e.target.closest(".tl-card")) {
      closePanel();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closePanel();
  });

  // --- Filters ---

  var activeFilter = "";
  var filterButtons = document.querySelectorAll(".filter-btn");

  function applyFilter(status) {
    activeFilter = status;
    var items = document.querySelectorAll(".tl-item");
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      if (!status || el.getAttribute("data-status") === status) {
        el.classList.remove("dimmed");
      } else {
        el.classList.add("dimmed");
      }
    }
    // Connectors
    var connectors = document.querySelectorAll(".tl-connector");
    for (var i = 0; i < connectors.length; i++) {
      var el = connectors[i];
      if (!status || el.getAttribute("data-status") === status) {
        el.style.opacity = "";
      } else {
        el.style.opacity = "0.08";
      }
    }
    // Tracks
    var tracks = document.querySelectorAll(".tl-track");
    for (var i = 0; i < tracks.length; i++) {
      var el = tracks[i];
      if (!status || el.getAttribute("data-status") === status) {
        el.style.opacity = "";
      } else {
        el.style.opacity = "0.03";
      }
    }
    // No-date cards
    var noDateCards = document.querySelectorAll("#no-date-items .tl-card");
    for (var i = 0; i < noDateCards.length; i++) {
      var el = noDateCards[i];
      if (!status || el.getAttribute("data-status") === status) {
        el.style.opacity = "1";
        el.style.pointerEvents = "all";
      } else {
        el.style.opacity = "0.08";
        el.style.pointerEvents = "none";
      }
    }
  }

  for (var i = 0; i < filterButtons.length; i++) {
    filterButtons[i].addEventListener("click", function (e) {
      for (var j = 0; j < filterButtons.length; j++) {
        filterButtons[j].classList.remove("active");
      }
      e.currentTarget.classList.add("active");
      applyFilter(e.currentTarget.getAttribute("data-status"));
    });
  }

  // --- Init ---
  buildTimeline();
})();
