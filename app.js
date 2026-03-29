(function () {
  "use strict";

  var STATUS_COLORS = {
    "прочитал": "#4aba70",
    "читаю": "#e8c547",
    "хочу прочитать": "#c45c5c",
  };
  var MONTH_NAMES = [
    "янв", "фев", "мар", "апр", "май", "июн",
    "��юл", "авг", "сен", "окт", "ноя", "дек",
  ];
  var MONTH_NAMES_FULL = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
  ];
  var BASE_PPD = 8;
  var GAP = 14;
  var TRACK_WIDTH = 5;
  var TRACK_GAP = 8;
  var TRACK_OFFSET = 8;

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
    return Math.round((b - a) / 86400000);
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatDate(str) {
    if (!str) return "";
    var p = str.split("-");
    if (p.length < 2) return str;
    return +p[2] + " " + MONTH_NAMES[+p[1] - 1] + " " + p[0];
  }

  // --- Card creation ---

  function createCard(book) {
    var card = document.createElement("div");
    card.className = "tl-card";

    var title = document.createElement("div");
    title.className = "tl-title";
    title.textContent = book.title;
    card.appendChild(title);

    var author = document.createElement("div");
    author.className = "tl-author";
    author.textContent = book.author;
    card.appendChild(author);

    var meta = document.createElement("div");
    meta.className = "tl-meta";

    if (book.status) {
      var s = document.createElement("span");
      s.className = "tl-status";
      s.setAttribute("data-status", book.status);
      s.textContent = book.status;
      meta.appendChild(s);
    }

    var dates = document.createElement("span");
    dates.className = "tl-dates";
    var dStr = formatDate(book.startDate);
    if (book.endDate) dStr += " \u2014 " + formatDate(book.endDate);
    dates.textContent = dStr;
    meta.appendChild(dates);

    if (book.rating) {
      var r = document.createElement("span");
      r.className = "tl-rating";
      var stars = "";
      for (var i = 1; i <= 5; i++) stars += i <= book.rating ? "\u2605" : "\u2606";
      r.textContent = stars;
      meta.appendChild(r);
    }

    card.appendChild(meta);

    if (book.categories && book.categories.length) {
      var cats = document.createElement("div");
      cats.className = "tl-categories";
      cats.textContent = book.categories.join(" / ");
      card.appendChild(cats);
    }

    card.addEventListener("click", function (e) {
      e.stopPropagation();
      showBookPanel(book);
    });

    return card;
  }

  // --- Build timeline ---

  function buildTimeline() {
    if (typeof BOOKS === "undefined" || !BOOKS.length) return;

    var today = new Date();
    var entries = [];
    var withoutDate = [];

    for (var i = 0; i < BOOKS.length; i++) {
      var b = BOOKS[i];
      var sd = parseDate(b.startDate);
      if (sd) {
        var ed = parseDate(b.endDate);
        entries.push({
          book: b,
          start: sd,
          end: ed,
          anchor: ed || (b.status === "читаю" ? today : sd),
        });
      } else {
        withoutDate.push(b);
      }
    }

    if (!entries.length) return;

    // Sort: "читаю" always on top, then by anchor descending
    entries.sort(function (a, b) {
      var aR = a.book.status === "читаю" ? 1 : 0;
      var bR = b.book.status === "читаю" ? 1 : 0;
      if (aR !== bR) return bR - aR;
      return b.anchor - a.anchor;
    });

    // Date range
    var earliest = entries[0].start;
    var latest = entries[0].anchor;
    for (var i = 1; i < entries.length; i++) {
      if (entries[i].start < earliest) earliest = entries[i].start;
      if (entries[i].anchor > latest) latest = entries[i].anchor;
    }
    if (today > latest) latest = today;
    var earliestReal = new Date(earliest);
    latest = new Date(latest.getTime() + 7 * 86400000);
    earliest = new Date(earliest.getTime() - 14 * 86400000);

    var totalDays = daysBetween(earliest, latest);

    function dayIdx(d) {
      var di = daysBetween(d, latest);
      return Math.max(0, Math.min(di, totalDays));
    }

    // Create and measure cards
    var items = [];
    for (var i = 0; i < entries.length; i++) {
      var el = document.createElement("div");
      el.className = "tl-item";
      el.style.visibility = "hidden";
      el.setAttribute("data-status", entries[i].book.status || "");
      el.appendChild(createCard(entries[i].book));
      itemsEl.appendChild(el);
      items.push({ el: el, entry: entries[i], h: 0, y: 0 });
    }
    for (var i = 0; i < items.length; i++) {
      items[i].h = items[i].el.getBoundingClientRect().height;
    }

    // Group cards by dayIdx (cards on the same day form a group)
    var groups = [];
    var curGroup = null;
    for (var i = 0; i < items.length; i++) {
      var di = dayIdx(items[i].entry.anchor);
      if (!curGroup || curGroup.di !== di) {
        curGroup = { di: di, items: [], totalH: 0 };
        groups.push(curGroup);
      }
      curGroup.items.push(items[i]);
      curGroup.totalH += items[i].h + GAP;
    }

    // Adaptive day scale — stretch time so all groups fit on the axis
    var dayScale = new Array(totalDays + 1);
    for (var d = 0; d <= totalDays; d++) dayScale[d] = BASE_PPD;

    // Pair-wise estimate between groups
    for (var g = 0; g < groups.length - 1; g++) {
      var di1 = groups[g].di;
      var di2 = groups[g + 1].di;
      var span = Math.max(di2 - di1, 1);
      var needed = groups[g].totalH / span;
      for (var d = di1; d < di1 + span && d <= totalDays; d++) {
        if (dayScale[d] < needed) dayScale[d] = needed;
      }
    }

    // Build cumulative Y
    var cumY = new Array(totalDays + 2);
    cumY[0] = 0;
    for (var d = 0; d <= totalDays; d++) cumY[d + 1] = cumY[d] + dayScale[d];

    // Resolve remaining overlaps by stretching the scale
    var bottom = 0;
    for (var g = 0; g < groups.length; g++) {
      var di = groups[g].di;
      if (cumY[di] < bottom) {
        var prevDi = g > 0 ? groups[g - 1].di : 0;
        var span = Math.max(di - prevDi, 1);
        var extra = (bottom - cumY[di]) / span;
        for (var d = prevDi; d < prevDi + span && d <= totalDays; d++) {
          dayScale[d] += extra;
        }
        for (var d = prevDi; d <= totalDays; d++) {
          cumY[d + 1] = cumY[d] + dayScale[d];
        }
      }
      bottom = cumY[di] + groups[g].totalH;
    }

    // Ensure last group fits within the scale
    var lastG = groups[groups.length - 1];
    var lastEnd = cumY[lastG.di] + lastG.totalH;
    if (lastEnd > cumY[totalDays + 1]) {
      var span = Math.max(totalDays - lastG.di, 1);
      var extra = (lastEnd - cumY[totalDays + 1]) / span;
      for (var d = lastG.di; d <= totalDays; d++) dayScale[d] += extra;
      for (var d = lastG.di; d <= totalDays; d++) cumY[d + 1] = cumY[d] + dayScale[d];
    }

    var totalHeight = cumY[totalDays + 1];
    function dateToY(d) { return cumY[dayIdx(d)]; }

    // Place cards — within groups, stack sequentially
    for (var g = 0; g < groups.length; g++) {
      var y = cumY[groups[g].di];
      for (var j = 0; j < groups[g].items.length; j++) {
        var item = groups[g].items[j];
        item.y = y;
        item.el.style.top = y + "px";
        item.el.style.visibility = "";
        y += item.h + GAP;
      }
    }

    itemsEl.style.height = totalHeight + "px";
    axisEl.style.height = totalHeight + "px";

    // Axis markers
    var cur = new Date(earliestReal.getFullYear(), earliestReal.getMonth(), 1);
    var endMonth = new Date(latest.getFullYear(), latest.getMonth() + 1, 1);

    while (cur <= endMonth) {
      var y = dateToY(cur);
      var el = document.createElement("div");

      el.className = "axis-month" + (cur <= today ? " past" : "");
      el.style.top = y + "px";
      var dot = document.createElement("div");
      dot.className = "axis-month-dot";
      el.appendChild(dot);
      var label = document.createElement("div");
      label.className = "axis-month-label";
      label.appendChild(document.createTextNode(MONTH_NAMES_FULL[cur.getMonth()]));
      var yearSpan = document.createElement("span");
      yearSpan.className = "axis-month-year";
      yearSpan.textContent = cur.getFullYear();
      label.appendChild(yearSpan);
      el.appendChild(label);

      // Day markers within this month: 5, 10, 15, 20, 25
      var daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
      for (var dd = 5; dd <= daysInMonth; dd += 5) {
        var dayDate = new Date(cur.getFullYear(), cur.getMonth(), dd);
        if (dayDate < earliestReal || dayDate > latest) continue;
        var dayY = dateToY(dayDate);
        var dayEl = document.createElement("div");
        dayEl.className = "axis-day" + (dayDate <= today ? " past" : "");
        dayEl.style.top = dayY + "px";
        dayEl.textContent = dd;
        itemsEl.appendChild(dayEl);
      }

      itemsEl.appendChild(el);
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }

    // "Now" marker
    var nowY = dateToY(today);
    if (nowY >= 0 && nowY <= totalHeight) {
      var el = document.createElement("div");
      el.className = "axis-now";
      el.style.top = nowY + "px";
      var line = document.createElement("div");
      line.className = "axis-now-line";
      el.appendChild(line);
      itemsEl.appendChild(el);
    }

    // Duration tracks
    var axisLeft = parseInt(getComputedStyle(timelineEl).getPropertyValue("--axis-left")) || 50;
    var trackContainer = document.createElement("div");
    trackContainer.id = "track-container";
    itemsEl.appendChild(trackContainer);

    var tracks = [];
    for (var i = 0; i < items.length; i++) {
      var e = items[i].entry;
      if (!e.end && e.book.status !== "читаю") continue;
      var topY = dateToY(e.end || today);
      var botY = dateToY(e.start);
      if (botY - topY < 16) botY = topY + 16;
      tracks.push({
        topY: topY, botY: botY,
        color: STATUS_COLORS[e.book.status] || "#666",
        status: e.book.status || "",
        lane: 0,
        itemIdx: i,
      });
    }

    // Lane assignment for overlapping tracks
    tracks.sort(function (a, b) { return a.topY - b.topY; });
    var laneEnds = [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var lane = -1;
      for (var l = 0; l < laneEnds.length; l++) {
        if (laneEnds[l] <= t.topY) { lane = l; break; }
      }
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      t.lane = lane;
      laneEnds[lane] = t.botY + 4;
    }

    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var el = document.createElement("div");
      el.className = "tl-track";
      el.setAttribute("data-status", t.status);
      el.style.top = t.topY + "px";
      el.style.height = (t.botY - t.topY) + "px";
      el.style.left = (axisLeft + TRACK_OFFSET + t.lane * (TRACK_WIDTH + TRACK_GAP)) + "px";
      el.style.width = TRACK_WIDTH + "px";
      el.style.setProperty("--track-color", t.color);
      trackContainer.appendChild(el);
      items[t.itemIdx].trackEl = el;
    }

    // Push cards right if tracks overlap at their vertical range
    var defaultLeft = parseInt(getComputedStyle(timelineEl).getPropertyValue("--cards-left")) || 90;
    var TRACK_CARD_PAD = 10;
    for (var i = 0; i < items.length; i++) {
      var cardTop = items[i].y;
      var cardBot = items[i].y + items[i].h;
      var maxRight = 0;
      for (var j = 0; j < tracks.length; j++) {
        if (tracks[j].topY < cardBot && tracks[j].botY > cardTop) {
          var right = axisLeft + TRACK_OFFSET + tracks[j].lane * (TRACK_WIDTH + TRACK_GAP) + TRACK_WIDTH;
          if (right > maxRight) maxRight = right;
        }
      }
      if (maxRight + TRACK_CARD_PAD > defaultLeft) {
        var needed = maxRight + TRACK_CARD_PAD;
        items[i].el.style.left = needed + "px";
        items[i].el.style.width = "calc(100% - " + needed + "px)";
      }
    }

    // Re-measure cards that got narrower and fix vertical placement
    var needsFixup = false;
    for (var i = 0; i < items.length; i++) {
      var newH = items[i].el.getBoundingClientRect().height;
      if (newH > items[i].h + 0.5) {
        items[i].h = newH;
        needsFixup = true;
      }
    }
    if (needsFixup) {
      for (var g = 0; g < groups.length; g++) {
        var y = cumY[groups[g].di];
        for (var j = 0; j < groups[g].items.length; j++) {
          var item = groups[g].items[j];
          item.y = y;
          item.el.style.top = y + "px";
          y += item.h + GAP;
        }
      }
      var lastItem = items[items.length - 1];
      var newTotal = lastItem.y + lastItem.h + GAP;
      if (newTotal > totalHeight) {
        totalHeight = newTotal;
        itemsEl.style.height = totalHeight + "px";
        axisEl.style.height = totalHeight + "px";
      }
    }

    // Hover: highlight track when hovering its card
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        item.el.addEventListener("mouseenter", function () {
          if (item.trackEl) item.trackEl.classList.add("highlight");
        });
        item.el.addEventListener("mouseleave", function () {
          if (item.trackEl) item.trackEl.classList.remove("highlight");
        });
      })(items[i]);
    }

    // No-date books
    if (withoutDate.length) {
      var section = document.createElement("div");
      section.id = "no-date-section";

      var lbl = document.createElement("div");
      lbl.id = "no-date-label";
      lbl.textContent = "\u0411\u0415\u0417 \u0414\u0410\u0422\u042B";
      section.appendChild(lbl);

      var container = document.createElement("div");
      container.id = "no-date-items";
      for (var i = 0; i < withoutDate.length; i++) {
        var card = createCard(withoutDate[i]);
        card.setAttribute("data-status", withoutDate[i].status || "");
        container.appendChild(card);
      }
      section.appendChild(container);
      timelineEl.appendChild(section);
    }
  }

  // --- Book panel ---

  function showBookPanel(data) {
    var html = "";
    if (data.cover) {
      html += '<img class="book-cover" src="' + escapeHtml(data.cover) + '" alt="' + escapeHtml(data.title) + '">';
    }
    html += '<h2 class="book-title">' + escapeHtml(data.title) + "</h2>";
    html += '<p class="book-author">' + escapeHtml(data.author) + "</p>";
    if (data.status) html += '<p class="book-status">' + escapeHtml(data.status) + "</p>";
    if (data.rating) {
      var stars = "";
      for (var i = 1; i <= 5; i++) stars += i <= data.rating ? "\u2605" : "\u2606";
      html += '<p class="book-rating">' + stars + "</p>";
    }
    if (data.startDate || data.endDate) {
      var d = (data.startDate || "") + (data.startDate && data.endDate ? " \u2014 " : "") + (data.endDate || "");
      html += '<p class="book-dates">' + escapeHtml(d) + "</p>";
    }
    if (data.notes) html += '<p class="book-notes">' + escapeHtml(data.notes) + "</p>";
    if (data.quotes && data.quotes.length) {
      html += '<div class="book-quotes">';
      for (var i = 0; i < data.quotes.length; i++) {
        html += "<blockquote>" + escapeHtml(data.quotes[i]) + "</blockquote>";
      }
      html += "</div>";
    }
    panelContent.innerHTML = html;
    panel.classList.add("open");
  }

  function closePanel() { panel.classList.remove("open"); }

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

  var filterButtons = document.querySelectorAll(".filter-btn");

  function applyFilter(status) {
    var items = document.querySelectorAll(".tl-item");
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle("dimmed", !!status && items[i].getAttribute("data-status") !== status);
    }
    var tracks = document.querySelectorAll(".tl-track");
    for (var i = 0; i < tracks.length; i++) {
      tracks[i].style.opacity = (!status || tracks[i].getAttribute("data-status") === status) ? "" : "0.03";
    }
    var noDate = document.querySelectorAll("#no-date-items .tl-card");
    for (var i = 0; i < noDate.length; i++) {
      var match = !status || noDate[i].getAttribute("data-status") === status;
      noDate[i].style.opacity = match ? "1" : "0.08";
      noDate[i].style.pointerEvents = match ? "all" : "none";
    }
  }

  for (var i = 0; i < filterButtons.length; i++) {
    filterButtons[i].addEventListener("click", function (e) {
      for (var j = 0; j < filterButtons.length; j++) filterButtons[j].classList.remove("active");
      e.currentTarget.classList.add("active");
      applyFilter(e.currentTarget.getAttribute("data-status"));
    });
  }

  buildTimeline();
})();
