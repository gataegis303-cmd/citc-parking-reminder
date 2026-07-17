(function () {
  const STORAGE_KEY = "parking-reminder-state-v1";
  const WORK_END = "18:00";
  const NAP_START = "13:00";
  const NAP_END = "14:00";
  const MOVE_MINUTES = 15;
  const FALLBACK_ENTRY = "08:00";

  const els = {
    dayStatus: document.getElementById("day-status"),
    countdownLabel: document.getElementById("countdown-label"),
    countdownTime: document.getElementById("countdown-time"),
    ringProgress: document.getElementById("ring-progress"),
    nextAction: document.getElementById("next-action"),
    nextDetail: document.getElementById("next-detail"),
    startNow: document.getElementById("start-now"),
    confirmMoved: document.getElementById("confirm-moved"),
    finishDay: document.getElementById("finish-day"),
    entryTime: document.getElementById("entry-time"),
    freeHours: document.getElementById("free-hours"),
    leadMinutes: document.getElementById("lead-minutes"),
    timeline: document.getElementById("timeline"),
    template: document.getElementById("timeline-item-template"),
    downloadIcs: document.getElementById("download-ics")
  };

  const state = loadState();
  hydrateSettings();
  bindEvents();
  handleUrlAction();
  render();
  setInterval(render, 30000);

  function bindEvents() {
    els.startNow.addEventListener("click", () => {
      const entry = timeInputToDate(els.entryTime.value || nowTimeString());
      state.active = true;
      state.entryAt = entry.toISOString();
      state.lastMoveAt = entry.toISOString();
      state.finishedAt = null;
      state.settings = readSettings();
      saveState();
      render();
    });

    els.confirmMoved.addEventListener("click", () => {
      const movedAt = new Date();
      state.active = true;
      state.lastMoveAt = movedAt.toISOString();
      state.entryAt = state.entryAt || movedAt.toISOString();
      state.finishedAt = null;
      state.settings = readSettings();
      els.entryTime.value = toTimeValue(movedAt);
      saveState();
      render();
    });

    els.finishDay.addEventListener("click", () => {
      state.active = false;
      state.finishedAt = new Date().toISOString();
      saveState();
      render();
    });

    [els.entryTime, els.freeHours, els.leadMinutes].forEach((el) => {
      el.addEventListener("change", () => {
        state.settings = readSettings();
        saveState();
        render();
      });
    });

    els.downloadIcs.addEventListener("click", () => {
      const schedule = buildSchedule(currentEntryDate(), readSettings());
      downloadCalendar(schedule);
    });
  }

  function handleUrlAction() {
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    if (action === "end") {
      state.active = false;
      state.finishedAt = new Date().toISOString();
      saveState();
    }
  }

  function hydrateSettings() {
    const settings = state.settings || {};
    els.freeHours.value = String(settings.freeHours || 3);
    els.leadMinutes.value = String(settings.leadMinutes || 15);
    if (state.lastMoveAt) {
      els.entryTime.value = toTimeValue(new Date(state.lastMoveAt));
    } else {
      els.entryTime.value = FALLBACK_ENTRY;
    }
  }

  function render() {
    const settings = readSettings();
    const entry = currentEntryDate();
    const schedule = buildSchedule(entry, settings);
    const now = new Date();
    const next = schedule.find((item) => item.at > now);

    els.confirmMoved.disabled = !state.active;
    els.finishDay.disabled = !state.active;
    els.downloadIcs.disabled = schedule.length === 0 || !state.active;

    if (!state.active) {
      els.dayStatus.textContent = state.finishedAt ? "已结束" : "未开始";
      els.countdownLabel.textContent = state.finishedAt ? "今天已结束" : "今天还未开始";
      els.countdownTime.textContent = "--:--";
      els.nextAction.textContent = state.finishedAt ? "明天到公司再开始" : "到公司后开始计时";
      els.nextDetail.textContent = "iPhone 到达公司自动化可以打开这个页面。";
      setRingProgress(0);
    } else if (next) {
      const minutesLeft = Math.max(0, Math.ceil((next.at - now) / 60000));
      els.dayStatus.textContent = "计时中";
      els.countdownLabel.textContent = next.kind === "move" ? "距离挪车" : "距离确认";
      els.countdownTime.textContent = formatDuration(minutesLeft);
      els.nextAction.textContent = next.title;
      els.nextDetail.textContent = next.detail;
      setRingProgress(progressWithinWindow(entry, next.at, now));
    } else {
      els.dayStatus.textContent = "无需再挪";
      els.countdownLabel.textContent = "今天安全";
      els.countdownTime.textContent = "18:00";
      els.nextAction.textContent = "下班离场即可";
      els.nextDetail.textContent = "离开公司自动化可以提醒你结束今天。";
      setRingProgress(1);
    }

    renderTimeline(schedule);
  }

  function renderTimeline(schedule) {
    els.timeline.textContent = "";
    if (!state.active) {
      const item = els.template.content.cloneNode(true);
      item.querySelector("time").textContent = "现在";
      item.querySelector("strong").textContent = "等待开始";
      item.querySelector("span").textContent = "到公司后点开始停车，工具会生成今日挪车提醒。";
      els.timeline.appendChild(item);
      return;
    }

    schedule.forEach((event) => {
      const item = els.template.content.cloneNode(true);
      item.querySelector("time").textContent = formatTime(event.at);
      item.querySelector("strong").textContent = event.title;
      item.querySelector("span").textContent = event.detail;
      els.timeline.appendChild(item);
    });
  }

  function buildSchedule(entry, settings) {
    const freeMinutes = Number(settings.freeHours) * 60;
    const leadMinutes = Number(settings.leadMinutes);
    const workEnd = atToday(WORK_END);
    const schedule = [];
    let cursor = new Date(entry);

    for (let i = 1; i <= 4; i += 1) {
      const freeUntil = addMinutes(cursor, freeMinutes);
      if (freeUntil >= workEnd) break;

      let remindAt = addMinutes(freeUntil, -leadMinutes);
      remindAt = avoidNapWindow(remindAt, leadMinutes);
      if (remindAt >= workEnd) break;

      schedule.push({
        kind: "move",
        at: remindAt,
        title: `MOVE-${String(i).padStart(2, "0")} 挪车行动`,
        detail: `免费额度到 ${formatTime(freeUntil)}，预计挪车 ${MOVE_MINUTES} 分钟。`
      });

      const confirmAt = addMinutes(remindAt, MOVE_MINUTES);
      schedule.push({
        kind: "confirm",
        at: confirmAt,
        title: "CONFIRM 重新入场",
        detail: "挪完后点“已完成挪车，重新计时”，下一轮会按实际时间计算。"
      });

      cursor = addMinutes(remindAt, MOVE_MINUTES);
    }

    return schedule.filter((item) => item.at < workEnd);
  }

  function avoidNapWindow(date, leadMinutes) {
    const napStart = atToday(NAP_START);
    const napEnd = atToday(NAP_END);
    const moveEnds = addMinutes(date, MOVE_MINUTES);
    const overlapsNap = date < napEnd && moveEnds > napStart;
    if (!overlapsNap) return date;
    return addMinutes(napStart, -MOVE_MINUTES);
  }

  function downloadCalendar(schedule) {
    const events = schedule.map((item, index) => {
      const start = item.at;
      const end = addMinutes(start, item.kind === "move" ? MOVE_MINUTES : 5);
      const uid = `${start.getTime()}-${index}@parking-reminder`;
      return [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${toIcsDate(new Date())}`,
        `DTSTART:${toIcsDate(start)}`,
        `DTEND:${toIcsDate(end)}`,
        `SUMMARY:${escapeIcs(item.title)}`,
        `DESCRIPTION:${escapeIcs(item.detail)}`,
        "BEGIN:VALARM",
        "TRIGGER:-PT0M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeIcs(item.title)}`,
        "END:VALARM",
        "END:VEVENT"
      ].join("\r\n");
    });
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Parking Reminder//CN",
      "CALSCALE:GREGORIAN",
      ...events,
      "END:VCALENDAR"
    ].join("\r\n");

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `停车提醒-${todayKey()}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function readSettings() {
    return {
      freeHours: Number(els.freeHours.value),
      leadMinutes: Number(els.leadMinutes.value)
    };
  }

  function currentEntryDate() {
    if (state.active && state.lastMoveAt) return new Date(state.lastMoveAt);
    return timeInputToDate(els.entryTime.value || FALLBACK_ENTRY);
  }

  function timeInputToDate(value) {
    const [hours, minutes] = value.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  function atToday(value) {
    return timeInputToDate(value);
  }

  function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
  }

  function progressWithinWindow(start, end, now) {
    const total = Math.max(1, end - start);
    return Math.min(1, Math.max(0, (now - start) / total));
  }

  function setRingProgress(progress) {
    const circumference = 326.7;
    els.ringProgress.style.strokeDashoffset = String(circumference * (1 - progress));
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h <= 0) return `${m}分`;
    return `${h}时${String(m).padStart(2, "0")}分`;
  }

  function toTimeValue(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function nowTimeString() {
    return toTimeValue(new Date());
  }

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  }

  function toIcsDate(date) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  function escapeIcs(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");
  }

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState();
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function defaultState() {
    return {
      active: false,
      entryAt: null,
      lastMoveAt: null,
      finishedAt: null,
      settings: {
        freeHours: 3,
        leadMinutes: 15
      }
    };
  }
})();
