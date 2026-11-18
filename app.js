"use strict";

const STORAGE_KEY = "haru-planner-data-v1";
const state = { tasks: [], courses: [], settings: { notificationsEnabled: true } };
let selectedDate = new Date();
let displayMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
let editingTaskId = null;
let editingCourseId = null;
let activeReminderId = null;
let deferredInstallPrompt = null;
let generatedCourseTaskTitle = "";
let xpToastTimer = null;

const $ = (selector) => document.querySelector(selector);
const calendarGrid = $("#calendarGrid");
const taskList = $("#taskList");
const monthTitle = $("#monthTitle");
const dayTitle = $("#dayTitle");
const daySummary = $("#daySummary");
const editorDialog = $("#editorDialog");
const courseDialog = $("#courseDialog");
const reminderDialog = $("#reminderDialog");
const taskForm = $("#taskForm");
const courseForm = $("#courseForm");

function pad(number) { return String(number).padStart(2, "0"); }
function dateKey(date) { return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()); }
function dateFromKey(key) { const parts = key.split("-").map(Number); return new Date(parts[0], parts[1] - 1, parts[2]); }
function timeNow() { const now = new Date(); return pad(now.getHours()) + ":" + pad(now.getMinutes()); }
function formatDate(date, options) { return new Intl.DateTimeFormat("ko-KR", options).format(date); }

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return;
    if (Array.isArray(saved.tasks)) state.tasks = saved.tasks;
    if (Array.isArray(saved.courses)) state.courses = saved.courses;
    if (saved.settings && typeof saved.settings.notificationsEnabled === "boolean") {
      state.settings.notificationsEnabled = saved.settings.notificationsEnabled;
    }
  } catch (error) { console.warn("플래너 데이터를 불러오지 못했습니다.", error); }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function tasksOn(date) {
  const key = dateKey(date);
  return state.tasks.filter((task) => task.date === key);
}

function completedLessons(course) {
  const lessons = new Set();
  state.tasks.filter((task) => task.done && task.courseId === course.id).forEach((task) => {
    const start = Math.max(1, Number(task.lessonStart) || 1);
    const end = Math.min(Number(course.totalLessons) || 0, Number(task.lessonEnd) || start);
    for (let number = start; number <= end; number += 1) lessons.add(number);
  });
  return lessons;
}

function calculateXp() {
  const courseIds = new Set(state.courses.map((course) => course.id));
  const ordinaryTasks = state.tasks.filter((task) => task.done && (!task.courseId || !courseIds.has(task.courseId))).length;
  const courseXp = state.courses.reduce((sum, course) => sum + completedLessons(course).size * 20, 0);
  return ordinaryTasks * 10 + courseXp;
}

function showXpToast(amount) {
  if (amount <= 0) return;
  const toast = $("#xpToast");
  toast.textContent = "+" + amount + " XP  ·  잘했어요!";
  toast.classList.add("visible");
  window.clearTimeout(xpToastTimer);
  xpToastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2300);
}

function renderXp() {
  const total = calculateXp();
  const level = Math.floor(total / 100) + 1;
  const rank = level < 3 ? "새싹" : (level < 6 ? "꾸준러" : (level < 10 ? "집중러" : "마스터"));
  const withinLevel = total % 100;
  $("#xpLevel").textContent = "Lv. " + level + " " + rank;
  $("#xpCount").textContent = withinLevel + " / 100 XP";
  $("#xpProgress").style.width = withinLevel + "%";
}

function renderCourses() {
  const list = $("#coursesList");
  list.replaceChildren();
  if (!state.courses.length) {
    const empty = document.createElement("div");
    empty.className = "course-empty";
    empty.textContent = "듣고 있는 강의를 등록해보세요. 계획을 강의에 연결해 완료 체크하면 강의 진도와 XP가 자동으로 쌓여요.";
    list.append(empty);
    return;
  }
  state.courses.forEach((course) => {
    const total = Math.max(1, Number(course.totalLessons) || 1);
    const done = completedLessons(course).size;
    const percent = Math.min(100, Math.round((done / total) * 100));
    const card = document.createElement("article");
    card.className = "course-card";
    const top = document.createElement("div");
    top.className = "course-card-top";
    const name = document.createElement("p");
    name.className = "course-name";
    name.textContent = course.name;
    const count = document.createElement("span");
    count.className = "course-count";
    count.textContent = done + " / " + total + "강";
    top.append(name, count);
    const bar = document.createElement("div");
    bar.className = "course-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(total));
    bar.setAttribute("aria-valuenow", String(done));
    const fill = document.createElement("i");
    fill.style.width = percent + "%";
    bar.append(fill);
    const bottom = document.createElement("div");
    bottom.className = "course-card-bottom";
    const status = document.createElement("strong");
    status.textContent = done >= total ? "완강했어요!" : (percent + "% 진행");
    const earned = document.createElement("span");
    earned.textContent = "+" + (done * 20) + " XP";
    const actions = document.createElement("span");
    actions.className = "course-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "course-edit";
    edit.textContent = "수정";
    edit.setAttribute("aria-label", course.name + " 강의 정보 수정");
    edit.addEventListener("click", () => openCourseEditor(course));
    actions.append(edit);
    bottom.append(status, earned, actions);
    card.append(top, bar, bottom);
    list.append(card);
  });
}

function renderCalendar() {
  monthTitle.textContent = formatDate(displayMonth, { year: "numeric", month: "long" });
  calendarGrid.replaceChildren();
  const firstDay = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), 1);
  const daysInMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 0).getDate();
  const today = dateKey(new Date());
  const selected = dateKey(selectedDate);
  const offset = firstDay.getDay();

  for (let index = 0; index < 42; index += 1) {
    const dayNumber = index - offset + 1;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-cell";
    cell.setAttribute("role", "gridcell");
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      cell.classList.add("outside-month");
      cell.tabIndex = -1;
      cell.setAttribute("aria-hidden", "true");
      calendarGrid.append(cell);
      continue;
    }
    const cellDate = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), dayNumber);
    const key = dateKey(cellDate);
    const weekday = cellDate.getDay();
    if (weekday === 0) cell.classList.add("sunday");
    if (weekday === 6) cell.classList.add("saturday");
    if (key === today) cell.classList.add("today");
    if (key === selected) cell.classList.add("selected");
    const number = document.createElement("span");
    number.textContent = String(dayNumber);
    const count = document.createElement("span");
    count.className = "calendar-count";
    const remaining = state.tasks.filter((task) => task.date === key && !task.done).length;
    count.textContent = remaining ? "· " + remaining : "";
    cell.append(number, count);
    cell.setAttribute("aria-label", formatDate(cellDate, { year: "numeric", month: "long", day: "numeric" }) + (remaining ? ", 일정 " + remaining + "개" : ""));
    cell.setAttribute("aria-selected", key === selected ? "true" : "false");
    cell.addEventListener("click", () => {
      selectedDate = cellDate;
      displayMonth = new Date(cellDate.getFullYear(), cellDate.getMonth(), 1);
      render();
    });
    calendarGrid.append(cell);
  }
}

function makeActionButton(label, symbol, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small-action" + (className ? " " + className : "");
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = symbol;
  button.addEventListener("click", onClick);
  return button;
}

function renderTask(task) {
  const card = document.createElement("article");
  card.className = "task-card" + (task.done ? " completed" : "");
  const time = document.createElement("time");
  time.className = "task-time";
  time.textContent = task.time;
  const main = document.createElement("div");
  main.className = "task-main";
  const title = document.createElement("p");
  title.className = "task-title";
  title.textContent = task.title;
  main.append(title);
  if (task.notes) {
    const note = document.createElement("p");
    note.className = "task-note";
    note.textContent = task.notes;
    main.append(note);
  }
  const meta = document.createElement("div");
  meta.className = "task-meta";
  const badge = document.createElement("span");
  badge.className = "reminder-badge" + (task.reminder && !task.done ? "" : " off");
  badge.textContent = task.done ? "완료" : (task.reminder ? "알림 설정됨" : "알림 없음");
  meta.append(badge);
  const linkedCourse = state.courses.find((course) => course.id === task.courseId);
  if (linkedCourse) {
    const lessonBadge = document.createElement("span");
    lessonBadge.className = "course-link-badge";
    const start = Number(task.lessonStart) || 1;
    const end = Number(task.lessonEnd) || start;
    lessonBadge.textContent = linkedCourse.name + " · " + (start === end ? start : start + "–" + end) + "강";
    meta.append(lessonBadge);
  }
  main.append(meta);
  const actions = document.createElement("div");
  actions.className = "task-actions";
  const done = document.createElement("input");
  done.className = "task-check";
  done.type = "checkbox";
  done.checked = Boolean(task.done);
  done.setAttribute("aria-label", task.title + " 완료 표시");
  done.addEventListener("change", () => {
    const previousXp = calculateXp();
    task.done = done.checked;
    if (task.done) task.snoozeUntil = "";
    saveState();
    if (task.done) showXpToast(calculateXp() - previousXp);
  });
  actions.append(done);
  actions.append(makeActionButton("일정 수정", "✎", "", () => openEditor(task)));
  actions.append(makeActionButton("일정 삭제", "×", "delete", () => {
    if (!window.confirm("이 일정을 삭제할까요?")) return;
    state.tasks = state.tasks.filter((item) => item.id !== task.id);
    if (activeReminderId === task.id) reminderDialog.close();
    saveState();
  }));
  card.append(time, main, actions);
  return card;
}

function renderTasks() {
  const selectedTasks = tasksOn(selectedDate).sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
  dayTitle.textContent = formatDate(selectedDate, { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  daySummary.textContent = selectedTasks.length ? "이 날짜의 일정 " + selectedTasks.length + "개" : "아직 등록된 일정이 없어요.";
  const enabled = state.settings.notificationsEnabled;
  const toggle = $("#notificationToggle");
  toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
  $("#notificationLabel").textContent = enabled ? "알림 켜짐" : "알림 꺼짐";
  taskList.replaceChildren();
  if (!selectedTasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const mark = document.createElement("span");
    mark.className = "empty-mark";
    mark.textContent = "＋";
    const heading = document.createElement("strong");
    heading.textContent = "이날은 아직 비어 있어요";
    const message = document.createElement("p");
    message.textContent = "일정을 추가하고, 원하는 시간에 화면 알림을 받아보세요.";
    empty.append(mark, heading, message);
    taskList.append(empty);
  } else selectedTasks.forEach((task) => taskList.append(renderTask(task)));
}

function render() { renderCalendar(); renderTasks(); renderCourses(); renderXp(); }

function newId() {
  return window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

function refreshCourseOptions(selectedId) {
  const select = $("#taskCourse");
  select.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "강의와 연결하지 않음";
  select.append(none);
  state.courses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = course.name + " · " + course.totalLessons + "강";
    select.append(option);
  });
  select.value = selectedId || "";
}

function detectCourseLessons(title) {
  const input = title.trim().replace(/\s+/g, " ");
  const courses = [...state.courses].sort((a, b) => b.name.trim().length - a.name.trim().length);
  for (const course of courses) {
    const courseName = course.name.trim().replace(/\s+/g, " ");
    if (!input.toLocaleLowerCase().startsWith(courseName.toLocaleLowerCase())) continue;
    const remainder = input.slice(courseName.length).trim().replace(/^[：:]\s*/, "");
    const match = remainder.match(/^(\d+)(?:\s*[-~–—]\s*(\d+))?\s*(?:강)?$/i);
    if (match) return { course, start: Number(match[1]), end: Number(match[2] || match[1]) };
  }
  return null;
}

function syncCourseFromTitle() {
  const match = detectCourseLessons($("#taskTitle").value);
  const feedback = $("#courseAutoFeedback");
  if (!match) {
    feedback.textContent = "";
    feedback.className = "course-auto-feedback";
    return;
  }
  $("#taskCourse").value = match.course.id;
  const total = Number(match.course.totalLessons);
  if (match.start < 1 || match.end < match.start || match.end > total) {
    $("#lessonRangeFields").hidden = false;
    $("#lessonStart").min = "1";
    $("#lessonEnd").min = "1";
    $("#lessonStart").max = String(total);
    $("#lessonEnd").max = String(total);
    $("#lessonStart").value = String(match.start);
    $("#lessonEnd").value = String(match.end);
    feedback.className = "course-auto-feedback warning";
    feedback.textContent = match.course.name + " 강의는 1–" + total + "강 범위예요. 번호를 확인해주세요.";
    return;
  }
  $("#lessonStart").value = String(match.start);
  $("#lessonEnd").value = String(match.end);
  updateCourseTaskFields();
  const range = match.start === match.end ? String(match.start) : match.start + "–" + match.end;
  feedback.className = "course-auto-feedback success";
  feedback.textContent = "자동 연결됨: " + match.course.name + " 강의 " + range + "강";
}

function updateCourseTaskFields() {
  const course = state.courses.find((item) => item.id === $("#taskCourse").value);
  const rangeFields = $("#lessonRangeFields");
  if (!course) { rangeFields.hidden = true; return; }
  rangeFields.hidden = false;
  const total = Math.max(1, Number(course.totalLessons) || 1);
  const startInput = $("#lessonStart");
  const endInput = $("#lessonEnd");
  startInput.max = String(total);
  endInput.max = String(total);
  const start = Math.max(1, Math.min(total, Number(startInput.value) || 1));
  const end = Math.max(start, Math.min(total, Number(endInput.value) || start));
  startInput.value = String(start);
  endInput.value = String(end);
  const rangeText = start === end ? String(start) : start + "–" + end;
  const autoTitle = course.name + " · " + rangeText + "강";
  const titleInput = $("#taskTitle");
  if (!titleInput.value.trim() || titleInput.value === generatedCourseTaskTitle) titleInput.value = autoTitle;
  generatedCourseTaskTitle = autoTitle;
}

function openEditor(task) {
  editingTaskId = task ? task.id : null;
  generatedCourseTaskTitle = "";
  taskForm.reset();
  $("#editorHeading").textContent = task ? "일정 수정" : "새 일정";
  $("#courseAutoFeedback").textContent = "";
  $("#courseAutoFeedback").className = "course-auto-feedback";
  refreshCourseOptions(task ? task.courseId : "");
  $("#taskTitle").value = task ? task.title : "";
  $("#taskDate").value = task ? task.date : dateKey(selectedDate);
  const initialTime = new Date();
  initialTime.setMinutes(initialTime.getMinutes() + 15);
  $("#taskTime").value = task ? task.time : pad(initialTime.getHours()) + ":" + pad(initialTime.getMinutes());
  $("#taskNotes").value = task ? (task.notes || "") : "";
  $("#taskReminder").checked = task ? Boolean(task.reminder) : true;
  $("#lessonStart").value = task ? String(task.lessonStart || 1) : "1";
  $("#lessonEnd").value = task ? String(task.lessonEnd || task.lessonStart || 1) : "1";
  updateCourseTaskFields();
  editorDialog.showModal();
  window.setTimeout(() => $("#taskTitle").focus(), 0);
}

$("#taskCourse").addEventListener("change", () => {
  $("#courseAutoFeedback").textContent = "";
  $("#courseAutoFeedback").className = "course-auto-feedback";
  updateCourseTaskFields();
});
$("#taskTitle").addEventListener("input", syncCourseFromTitle);
$("#lessonStart").addEventListener("change", () => {
  if (Number($("#lessonEnd").value) < Number($("#lessonStart").value)) $("#lessonEnd").value = $("#lessonStart").value;
  updateCourseTaskFields();
});
$("#lessonEnd").addEventListener("change", updateCourseTaskFields);

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = $("#taskTitle").value.trim();
  if (!title) { $("#taskTitle").focus(); return; }
  const existing = editingTaskId ? state.tasks.find((task) => task.id === editingTaskId) : null;
  const detected = detectCourseLessons(title);
  const course = detected ? detected.course : state.courses.find((item) => item.id === $("#taskCourse").value);
  let lessonStart = null;
  let lessonEnd = null;
  if (course) {
    lessonStart = detected ? detected.start : Number($("#lessonStart").value);
    lessonEnd = detected ? detected.end : Number($("#lessonEnd").value);
    if (!Number.isInteger(lessonStart) || !Number.isInteger(lessonEnd) || lessonStart < 1 || lessonEnd < lessonStart || lessonEnd > Number(course.totalLessons)) {
      window.alert(course.name + " 강의는 1강부터 " + course.totalLessons + "강까지예요. 강의 번호를 확인해주세요.");
      return;
    }
  }
  const next = {
    id: existing ? existing.id : newId(),
    title,
    date: $("#taskDate").value,
    time: $("#taskTime").value,
    notes: $("#taskNotes").value.trim(),
    reminder: $("#taskReminder").checked,
    courseId: course ? course.id : null,
    lessonStart,
    lessonEnd,
    done: existing ? Boolean(existing.done) : false,
    lastAlertDate: "",
    snoozeUntil: ""
  };
  if (existing) Object.assign(existing, next);
  else state.tasks.push(next);
  selectedDate = dateFromKey(next.date);
  displayMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  editorDialog.close();
  saveState();
});

function closeEditor() { editorDialog.close(); }
$("#closeEditor").addEventListener("click", closeEditor);
$("#cancelEditor").addEventListener("click", closeEditor);
editorDialog.addEventListener("click", (event) => { if (event.target === editorDialog) editorDialog.close(); });

function openCourseEditor(course) {
  editingCourseId = course ? course.id : null;
  courseForm.reset();
  $("#courseHeading").textContent = course ? "강의 수정" : "강의 등록";
  $("#courseName").value = course ? course.name : "";
  $("#courseTotal").value = course ? String(course.totalLessons) : "30";
  courseDialog.showModal();
  window.setTimeout(() => $("#courseName").focus(), 0);
}

function closeCourseEditor() { courseDialog.close(); }
$("#addCourseButton").addEventListener("click", () => openCourseEditor(null));
$("#closeCourseEditor").addEventListener("click", closeCourseEditor);
$("#cancelCourseEditor").addEventListener("click", closeCourseEditor);
courseDialog.addEventListener("click", (event) => { if (event.target === courseDialog) courseDialog.close(); });
courseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#courseName").value.trim();
  const total = Number($("#courseTotal").value);
  if (!name || !Number.isInteger(total) || total < 1 || total > 1000) {
    window.alert("강의 이름과 전체 강의 수를 확인해주세요.");
    return;
  }
  const existing = editingCourseId ? state.courses.find((course) => course.id === editingCourseId) : null;
  if (existing) {
    const highestPlanned = state.tasks.filter((task) => task.courseId === existing.id).reduce((max, task) => Math.max(max, Number(task.lessonEnd) || 0), 0);
    if (total < highestPlanned) {
      window.alert("이미 계획에 연결된 " + highestPlanned + "강보다 전체 강의 수를 작게 설정할 수 없어요.");
      return;
    }
    existing.name = name;
    existing.totalLessons = total;
  } else {
    state.courses.push({ id: newId(), name, totalLessons: total });
  }
  courseDialog.close();
  saveState();
});

$("#addButton").addEventListener("click", () => openEditor(null));
$("#previousMonth").addEventListener("click", () => {
  displayMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1);
  renderCalendar();
});
$("#nextMonth").addEventListener("click", () => {
  displayMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1);
  renderCalendar();
});
$("#todayButton").addEventListener("click", () => {
  selectedDate = new Date();
  displayMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  render();
});
$("#notificationToggle").addEventListener("click", () => {
  state.settings.notificationsEnabled = !state.settings.notificationsEnabled;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderTasks();
});

function showReminder(task) {
  activeReminderId = task.id;
  $("#reminderTime").textContent = task.time;
  $("#reminderTitle").textContent = task.title;
  $("#reminderNote").textContent = task.notes || "일정을 확인하고 천천히 시작해보세요.";
  if (!reminderDialog.open) reminderDialog.showModal();
}

function checkReminders() {
  if (!state.settings.notificationsEnabled || reminderDialog.open) return;
  const now = new Date();
  const today = dateKey(now);
  const currentTime = timeNow();
  const candidates = state.tasks.filter((task) => task.date === today && task.reminder && !task.done).sort((a, b) => a.time.localeCompare(b.time));
  for (const task of candidates) {
    const snoozeDue = task.snoozeUntil && new Date(task.snoozeUntil).getTime() <= now.getTime();
    const scheduledDue = task.time <= currentTime && task.lastAlertDate !== today;
    if (!snoozeDue && !scheduledDue) continue;
    task.lastAlertDate = today;
    task.snoozeUntil = "";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    showReminder(task);
    break;
  }
}

$("#completeReminder").addEventListener("click", () => {
  const previousXp = calculateXp();
  const task = state.tasks.find((item) => item.id === activeReminderId);
  if (task) { task.done = true; task.snoozeUntil = ""; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  reminderDialog.close();
  render();
  if (task) showXpToast(calculateXp() - previousXp);
});
$("#snoozeReminder").addEventListener("click", () => {
  const task = state.tasks.find((item) => item.id === activeReminderId);
  if (task) { task.snoozeUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString(); localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  reminderDialog.close();
});
$("#muteReminder").addEventListener("click", () => {
  state.settings.notificationsEnabled = false;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  reminderDialog.close();
  renderTasks();
});
$("#dismissReminder").addEventListener("click", () => reminderDialog.close());
reminderDialog.addEventListener("close", () => { activeReminderId = null; });

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("#installButton").hidden = false;
});
$("#installButton").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("#installButton").hidden = true;
});
window.addEventListener("appinstalled", () => { $("#installButton").hidden = true; deferredInstallPrompt = null; });

loadState();
render();
window.setInterval(checkReminders, 15000);
checkReminders();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => console.warn("오프라인 저장 기능을 시작하지 못했습니다.", error));
  });
}
