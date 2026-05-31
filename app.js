const STORAGE_KEY = "poster-grid-editor-state";
const SCRIPT_PATH = new URL(document.currentScript?.src || window.location.href).pathname;
const APP_BASE = SCRIPT_PATH.endsWith("/app.js") ? SCRIPT_PATH.slice(0, -"/app.js".length) : "";
const FONT_OPTIONS = [
  ['"Noto Serif SC", "Songti SC", serif', "宋体"],
  ['"PingFang SC", "Microsoft YaHei", sans-serif', "黑体"],
  ['"Kaiti SC", "STKaiti", serif', "楷体"],
  ['"Heiti SC", "SimHei", sans-serif', "系统黑体"],
  ['Georgia, "Times New Roman", serif', "英文衬线"],
  ['Arial, Helvetica, sans-serif', "英文无衬线"],
  ['"Courier New", monospace', "等宽字体"],
  ['system-ui, sans-serif', "系统默认"],
];
const TILE_TITLE_STYLE = {
  fontFamily: '"Noto Serif SC", "Songti SC", serif',
  fontSize: 28,
  fontColor: "#ffffff",
  italic: false,
};
const TILE_SUBTITLE_STYLE = {
  fontFamily: '"Noto Serif SC", "Songti SC", serif',
  fontSize: 12,
  fontColor: "#ffffff",
  italic: false,
};
const DEFAULT_POSTER = {
  title: "三分",
  subtitle: "(及三分以上)",
  author: "@裴月歌",
  columns: 3,
  titleStyle: {
    fontFamily: '"Noto Serif SC", "Songti SC", serif',
    fontSize: 112,
    fontColor: "#6f6a62",
    italic: false,
  },
  subtitleStyle: {
    fontFamily: '"Noto Serif SC", "Songti SC", serif',
    fontSize: 44,
    fontColor: "#6f6a62",
    italic: false,
  },
  authorStyle: {
    fontFamily: '"Noto Serif SC", "Songti SC", serif',
    fontSize: 26,
    fontColor: "#cfc8c2",
    italic: false,
  },
};

const state = {
  items: [],
  selectedId: null,
  user: null,
  poster: { ...DEFAULT_POSTER },
};

const els = {
  form: document.querySelector("#itemForm"),
  loginScreen: document.querySelector("#loginScreen"),
  loginForm: document.querySelector("#loginForm"),
  loginUsername: document.querySelector("#loginUsername"),
  loginPassword: document.querySelector("#loginPassword"),
  loginError: document.querySelector("#loginError"),
  logoutButton: document.querySelector("#logoutButton"),
  accountLine: document.querySelector("#accountLine"),
  adminPanel: document.querySelector("#adminPanel"),
  accountPanel: document.querySelector("#accountPanel"),
  accountName: document.querySelector("#accountName"),
  accountUsage: document.querySelector("#accountUsage"),
  selfCurrentPassword: document.querySelector("#selfCurrentPassword"),
  selfNewPassword: document.querySelector("#selfNewPassword"),
  togglePasswordButton: document.querySelector("#togglePasswordButton"),
  passwordForm: document.querySelector("#passwordForm"),
  changePasswordButton: document.querySelector("#changePasswordButton"),
  clearAccountButton: document.querySelector("#clearAccountButton"),
  passwordMessage: document.querySelector("#passwordMessage"),
  newUsername: document.querySelector("#newUsername"),
  newPassword: document.querySelector("#newPassword"),
  newQuota: document.querySelector("#newQuota"),
  createUserButton: document.querySelector("#createUserButton"),
  userList: document.querySelector("#userList"),
  fileField: document.querySelector("#fileField"),
  imageFile: document.querySelector("#imageFile"),
  addMessage: document.querySelector("#addMessage"),
  tileGrid: document.querySelector("#tileGrid"),
  tileTemplate: document.querySelector("#tileTemplate"),
  poster: document.querySelector("#poster"),
  posterColumns: document.querySelector("#posterColumns"),
  posterTitleView: document.querySelector("#posterTitleView"),
  posterSubtitleView: document.querySelector("#posterSubtitleView"),
  posterAuthorView: document.querySelector("#posterAuthorView"),
  captureHeight: document.querySelector("#captureHeight"),
  captureButton: document.querySelector("#captureButton"),
  resetButton: document.querySelector("#resetButton"),
  selectAssetButton: document.querySelector("#selectAssetButton"),
};

let draggedId = null;
let cropDrag = null;
let pinchGesture = null;
let tileEditorOpen = false;
let posterEditorField = null;

init();

async function init() {
  bindEvents();
  await loadSession();
  loadSavedState();
  render();
}

function bindEvents() {
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await login();
  });

  els.logoutButton.addEventListener("click", logout);
  els.createUserButton.addEventListener("click", createUser);
  els.togglePasswordButton.addEventListener("click", () => {
    els.passwordForm.hidden = !els.passwordForm.hidden;
  });
  els.changePasswordButton.addEventListener("click", changeOwnPassword);
  els.clearAccountButton.addEventListener("click", clearCurrentAccountStorage);

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitImagesToServer();
  });

  [
    els.posterColumns,
  ].forEach((input) => {
    input.addEventListener("input", () => {
      state.poster.columns = normalizeColumns(els.posterColumns.value);
      persist(false);
      renderGridColumns();
    });
  });

  els.poster.addEventListener("click", (event) => {
    const target = event.target.closest("[data-poster-field]");
    if (!target) return;
    event.stopPropagation();
    posterEditorField = target.dataset.posterField;
    renderPosterText();
  });

  els.captureButton.addEventListener("click", capturePoster);
  els.selectAssetButton.addEventListener("click", openAssetPickerModal);

  els.resetButton.addEventListener("click", () => {
    if (!confirm("确定清空当前页面吗？")) return;
    state.items = [];
    state.selectedId = null;
    tileEditorOpen = false;
    persist(false);
    render();
  });
}

function fillFontSelect(select) {
  select.replaceChildren();
  FONT_OPTIONS.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  });
}

function createItem(image, index, total) {
  const title = image.name || (total > 1 ? `标题 ${index + 1}` : "点击输入标题");
  return {
    id: createId(),
    image: image.src,
    title,
    subtitle: "点击输入副标题",
    titleStyle: { ...TILE_TITLE_STYLE },
    subtitleStyle: { ...TILE_SUBTITLE_STYLE },
    zoom: 100,
    x: 50,
    y: 50,
  };
}

async function submitImagesToServer() {
  els.addMessage.textContent = "";
  const submitButton = els.form.querySelector("button[type='submit']");
  const files = Array.from(els.imageFile.files);
  if (!files.length) {
    alert("请选择本地图片。");
    return;
  }

  submitButton.disabled = true;
  try {
    els.addMessage.textContent = "正在提交到服务器并压缩到 500KB 以内...";
    await Promise.all(files.map(uploadRawImageFile));
    els.form.reset();
    els.addMessage.textContent = "提交成功";
    renderSession();
  } catch (error) {
    els.addMessage.textContent = error.message || "提交图片失败，请换一张图片再试。";
  } finally {
    submitButton.disabled = false;
  }
}

async function uploadRawImageFile(file) {
  const form = new FormData();
  form.append("image", file);
  const response = await fetch(`${APP_BASE}/api/upload-file`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "图片上传失败");
  }
  state.user = payload.user;
  return {
    src: payload.url,
    name: file.name.replace(/\.[^.]+$/, ""),
  };
}

function render() {
  renderSession();
  els.posterColumns.value = normalizeColumns(state.poster.columns);
  renderPosterText();
  renderGridColumns();
  renderTiles();
}

function renderSession() {
  const isLoggedIn = Boolean(state.user);
  els.loginScreen.hidden = isLoggedIn;
  document.body.classList.toggle("is-locked", !isLoggedIn);
  els.accountLine.textContent = isLoggedIn
    ? `${state.user.username} · 已用 ${formatBytes(state.user.usedBytes)} / ${formatBytes(state.user.quotaBytes)}`
    : "";
  els.accountPanel.hidden = !isLoggedIn;
  els.accountName.textContent = state.user?.username || "";
  els.accountUsage.textContent = isLoggedIn
    ? `已用 ${formatBytes(state.user.usedBytes)} / ${formatBytes(state.user.quotaBytes)}`
    : "";
  els.adminPanel.hidden = state.user?.role !== "admin";
  if (state.user?.role === "admin") {
    loadUsers();
  }
}

function renderPosterText() {
  els.posterTitleView.textContent = state.poster.title || " ";
  els.posterSubtitleView.textContent = state.poster.subtitle || " ";
  els.posterAuthorView.textContent = state.poster.author || " ";
  applyTextStyle(els.posterTitleView, state.poster.titleStyle);
  applyTextStyle(els.posterSubtitleView, state.poster.subtitleStyle);
  applyTextStyle(els.posterAuthorView, state.poster.authorStyle);
  document.querySelector(".poster-text-editor")?.remove();
  if (posterEditorField) {
    getPosterFieldElement(posterEditorField).after(createPosterTextEditor(posterEditorField));
  }
}

function applyTextStyle(element, style) {
  const normalized = normalizeTextStyle(style, DEFAULT_POSTER.authorStyle);
  element.style.fontFamily = normalized.fontFamily;
  element.style.fontSize = `${normalized.fontSize}px`;
  element.style.color = normalized.fontColor;
  element.style.fontStyle = normalized.italic ? "italic" : "normal";
}

function createPosterTextEditor(field) {
  const label = field === "title" ? "主标题" : field === "subtitle" ? "副标题" : "署名";
  const styleKey = `${field}Style`;
  const style = normalizeTextStyle(state.poster[styleKey], DEFAULT_POSTER[styleKey]);
  const editor = document.createElement("form");
  editor.className = "poster-text-editor";
  editor.innerHTML = `
    <strong>${label}</strong>
    <input name="text" type="text" value="${escapeAttribute(state.poster[field])}" />
    <select name="fontFamily"></select>
    <input name="fontSize" type="number" min="12" max="160" value="${style.fontSize}" />
    <input name="fontColor" type="color" value="${style.fontColor}" />
    <label class="toggle-label">
      <input name="italic" type="checkbox" />
      倾斜
    </label>
    <button class="primary-button" type="submit">确定</button>
  `;
  fillFontSelect(editor.elements.fontFamily);
  editor.elements.fontFamily.value = style.fontFamily;
  editor.elements.italic.checked = style.italic;
  editor.addEventListener("click", (event) => event.stopPropagation());
  editor.addEventListener("input", () => updatePosterFromEditor(field, editor));
  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    updatePosterFromEditor(field, editor);
    posterEditorField = null;
    persist(false);
    renderPosterText();
  });
  return editor;
}

function updatePosterFromEditor(field, editor) {
  const styleKey = `${field}Style`;
  state.poster[field] = editor.elements.text.value.trim();
  state.poster[styleKey] = {
    fontFamily: editor.elements.fontFamily.value,
    fontSize: Number(editor.elements.fontSize.value) || DEFAULT_POSTER[styleKey].fontSize,
    fontColor: editor.elements.fontColor.value,
    italic: editor.elements.italic.checked,
  };
  persist(false);
  const element = getPosterFieldElement(field);
  element.textContent = state.poster[field] || " ";
  applyTextStyle(element, state.poster[styleKey]);
}

function getPosterFieldElement(field) {
  if (field === "subtitle") return els.posterSubtitleView;
  if (field === "author") return els.posterAuthorView;
  return els.posterTitleView;
}

function renderGridColumns() {
  const columns = normalizeColumns(state.poster.columns);
  state.poster.columns = columns;
  els.tileGrid.style.setProperty("--grid-columns", columns);
}

function renderTiles() {
  els.tileGrid.replaceChildren();

  if (!state.items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "添加图片后会显示在这里";
    els.tileGrid.append(empty);
    return;
  }

  state.items.forEach((item, index) => {
    const tile = els.tileTemplate.content.firstElementChild.cloneNode(true);
    const frame = tile.querySelector(".tile-frame");
    const image = tile.querySelector("img");
    const title = tile.querySelector("strong");
    const subtitle = tile.querySelector("span");

    tile.dataset.id = item.id;
    tile.classList.toggle("is-selected", item.id === state.selectedId);
    image.src = item.image;
    applyImageTransform(image, item);
    title.textContent = item.title;
    subtitle.textContent = item.subtitle;
    applyTextStyle(title, item.titleStyle);
    applyTextStyle(subtitle, item.subtitleStyle);

    tile.addEventListener("click", () => {
      selectItem(item.id);
    });

    image.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.selectedId = item.id;
      tileEditorOpen = false;
      document.querySelector(".tile-editor-popover")?.remove();
      startCropDrag(event, frame, image, item);
    });

    image.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.selectedId = item.id;
        zoomItemAtCenter(item, event.deltaY < 0 ? 8 : -8, image);
      },
      { passive: false },
    );

    image.addEventListener(
      "touchstart",
      (event) => {
        if (event.touches.length < 2) return;
        event.preventDefault();
        event.stopPropagation();
        state.selectedId = item.id;
        startPinchGesture(event, item);
      },
      { passive: false },
    );

    image.addEventListener(
      "touchmove",
      (event) => {
        if (!pinchGesture || pinchGesture.id !== item.id || event.touches.length < 2) return;
        event.preventDefault();
        updatePinchGesture(event, item, image);
      },
      { passive: false },
    );

    image.addEventListener("touchend", finishPinchGesture);
    image.addEventListener("touchcancel", finishPinchGesture);

    image.addEventListener("dragstart", (event) => {
      event.preventDefault();
    });

    tile.addEventListener("dragstart", () => {
      draggedId = item.id;
      tile.classList.add("is-dragging");
    });

    tile.addEventListener("dragend", () => {
      draggedId = null;
      tile.classList.remove("is-dragging");
    });

    tile.addEventListener("dragover", (event) => {
      event.preventDefault();
    });

    tile.addEventListener("drop", () => {
      if (!draggedId || draggedId === item.id) return;
      moveItemTo(draggedId, index);
    });

    tile.querySelector("[data-action='up']").addEventListener("click", (event) => {
      event.stopPropagation();
      moveItem(item.id, -1);
    });

    tile.querySelector("[data-action='down']").addEventListener("click", (event) => {
      event.stopPropagation();
      moveItem(item.id, 1);
    });

    tile.querySelector("[data-action='delete']").addEventListener("click", (event) => {
      event.stopPropagation();
      deleteItem(item.id);
    });

    els.tileGrid.append(tile);
    if (item.id === state.selectedId && tileEditorOpen) {
      els.tileGrid.append(createTileEditor(item));
    }
  });
}

function applyImageTransform(image, item) {
  const zoom = item.zoom / 100;
  const translateX = getImageTranslate(item.x, zoom);
  const translateY = getImageTranslate(item.y, zoom);
  image.style.transform = `translate(${translateX}%, ${translateY}%) scale(${zoom})`;
}

function selectItem(id, shouldRender = true) {
  state.selectedId = id;
  tileEditorOpen = true;
  persist(false);
  if (shouldRender) {
    render();
  } else {
    document.querySelectorAll(".tile").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.id === id);
    });
  }
}

function createTileEditor(item) {
  const editor = document.createElement("form");
  editor.className = "tile-editor-popover";
  editor.innerHTML = `
    <label>
      主标题
      <input name="title" type="text" value="${escapeAttribute(item.title)}" />
    </label>
    <div class="style-section">
      <strong>主标题样式</strong>
      <div class="popover-row">
        <label>
          字体
          <select name="titleFontFamily"></select>
        </label>
        <label>
          字号
          <input name="titleFontSize" type="number" min="14" max="72" value="${item.titleStyle.fontSize}" />
        </label>
        <label>
          颜色
          <input name="titleFontColor" type="color" value="${item.titleStyle.fontColor}" />
        </label>
        <label class="toggle-label">
          <input name="titleItalic" type="checkbox" />
          倾斜
        </label>
      </div>
    </div>
    <label>
      副标题
      <input name="subtitle" type="text" value="${escapeAttribute(item.subtitle)}" />
    </label>
    <div class="style-section">
      <strong>副标题样式</strong>
      <div class="popover-row">
        <label>
          字体
          <select name="subtitleFontFamily"></select>
        </label>
        <label>
          字号
          <input name="subtitleFontSize" type="number" min="10" max="48" value="${item.subtitleStyle.fontSize}" />
        </label>
        <label>
          颜色
          <input name="subtitleFontColor" type="color" value="${item.subtitleStyle.fontColor}" />
        </label>
        <label class="toggle-label">
          <input name="subtitleItalic" type="checkbox" />
          倾斜
        </label>
      </div>
    </div>
    <div class="popover-actions">
      <button class="primary-button" type="submit">确定</button>
    </div>
  `;

  fillFontSelect(editor.elements.titleFontFamily);
  fillFontSelect(editor.elements.subtitleFontFamily);
  editor.elements.titleFontFamily.value = item.titleStyle.fontFamily;
  editor.elements.subtitleFontFamily.value = item.subtitleStyle.fontFamily;
  editor.elements.titleItalic.checked = item.titleStyle.italic;
  editor.elements.subtitleItalic.checked = item.subtitleStyle.italic;
  editor.addEventListener("click", (event) => event.stopPropagation());
  editor.addEventListener("input", () => {
    updateItemFromEditor(item.id, editor);
  });
  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    updateItemFromEditor(item.id, editor);
    tileEditorOpen = false;
    persist(false);
    render();
  });
  return editor;
}

function updateItemFromEditor(id, editor) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  item.title = editor.elements.title.value.trim();
  item.subtitle = editor.elements.subtitle.value.trim();
  item.titleStyle = {
    fontFamily: editor.elements.titleFontFamily.value,
    fontSize: Number(editor.elements.titleFontSize.value) || TILE_TITLE_STYLE.fontSize,
    fontColor: editor.elements.titleFontColor.value,
    italic: editor.elements.titleItalic.checked,
  };
  item.subtitleStyle = {
    fontFamily: editor.elements.subtitleFontFamily.value,
    fontSize: Number(editor.elements.subtitleFontSize.value) || TILE_SUBTITLE_STYLE.fontSize,
    fontColor: editor.elements.subtitleFontColor.value,
    italic: editor.elements.subtitleItalic.checked,
  };
  persist(false);
  const selectedTile = document.querySelector(`.tile[data-id="${id}"]`);
  const title = selectedTile?.querySelector("strong");
  const subtitle = selectedTile?.querySelector("span");
  if (!title || !subtitle) return;
  title.textContent = item.title;
  subtitle.textContent = item.subtitle;
  applyTextStyle(title, item.titleStyle);
  applyTextStyle(subtitle, item.subtitleStyle);
}

function escapeAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getImageTranslate(position, zoom) {
  return (50 - position) * Math.max(0, zoom - 1);
}

function startCropDrag(event, tile, image, item) {
  cropDrag = {
    id: item.id,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: item.x,
    startY: item.y,
    width: tile.clientWidth,
    height: tile.clientHeight,
  };
  tile.classList.add("is-cropping");
  document.querySelectorAll(".tile").forEach((node) => {
    node.classList.toggle("is-selected", node.dataset.id === item.id);
  });
  image.setPointerCapture(event.pointerId);

  image.addEventListener("pointermove", handleCropDrag);
  image.addEventListener("pointerup", finishCropDrag);
  image.addEventListener("pointercancel", finishCropDrag);
}

function handleCropDrag(event) {
  if (pinchGesture || !cropDrag || event.pointerId !== cropDrag.pointerId) return;
  updateCropDrag(event.clientX, event.clientY);
}

function updateCropDrag(clientX, clientY) {
  if (!cropDrag) return;
  const item = state.items.find((entry) => entry.id === cropDrag.id);
  if (!item) return;

  const zoomOverflow = Math.max(0.01, item.zoom / 100 - 1);
  const deltaX = ((clientX - cropDrag.startClientX) / cropDrag.width / zoomOverflow) * 100;
  const deltaY = ((clientY - cropDrag.startClientY) / cropDrag.height / zoomOverflow) * 100;
  item.x = clamp(cropDrag.startX - deltaX, 0, 100);
  item.y = clamp(cropDrag.startY - deltaY, 0, 100);

  const selectedImage = document.querySelector(`.tile[data-id="${item.id}"] img`);
  if (selectedImage) applyImageTransform(selectedImage, item);
}

function finishCropDrag(event) {
  if (!cropDrag || event.pointerId !== cropDrag.pointerId) return;
  const selectedTile = document.querySelector(`.tile[data-id="${cropDrag.id}"]`);
  const selectedImage = selectedTile?.querySelector("img");
  selectedTile?.classList.remove("is-cropping");
  selectedImage?.releasePointerCapture(event.pointerId);
  selectedImage?.removeEventListener("pointermove", handleCropDrag);
  selectedImage?.removeEventListener("pointerup", finishCropDrag);
  selectedImage?.removeEventListener("pointercancel", finishCropDrag);
  cropDrag = null;
  persist(false);
}

function startPinchGesture(event, item) {
  const [first, second] = event.touches;
  pinchGesture = {
    id: item.id,
    distance: getTouchDistance(first, second),
    zoom: item.zoom,
  };
}

function updatePinchGesture(event, item, image) {
  const [first, second] = event.touches;
  const nextDistance = getTouchDistance(first, second);
  if (!pinchGesture?.distance || nextDistance <= 0) return;
  item.zoom = clamp(Math.round(pinchGesture.zoom * (nextDistance / pinchGesture.distance)), 100, 320);
  applyImageTransform(image, item);
}

function finishPinchGesture() {
  if (!pinchGesture) return;
  pinchGesture = null;
  persist(false);
}

function getTouchDistance(first, second) {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function zoomItemAtCenter(item, amount, image) {
  item.zoom = clamp(item.zoom + amount, 100, 320);
  applyImageTransform(image, item);
  persist(false);
}

function moveItem(id, offset) {
  const from = state.items.findIndex((item) => item.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= state.items.length) return;
  const [item] = state.items.splice(from, 1);
  state.items.splice(to, 0, item);
  state.selectedId = id;
  persist(false);
  render();
}

function moveItemTo(id, to) {
  const from = state.items.findIndex((item) => item.id === id);
  if (from < 0 || to < 0) return;
  const [item] = state.items.splice(from, 1);
  const adjustedTo = from < to ? to - 1 : to;
  state.items.splice(adjustedTo, 0, item);
  state.selectedId = id;
  persist(false);
  render();
}

function deleteItem(id) {
  state.items = state.items.filter((item) => item.id !== id);
  if (state.selectedId === id) {
    state.selectedId = state.items[0]?.id || null;
    tileEditorOpen = false;
  }
  persist(false);
  render();
}

async function capturePoster() {
  const requestedHeight = Number(els.captureHeight.value);
  const fullHeight = els.poster.scrollHeight;
  const captureHeight = requestedHeight > 0 ? Math.min(requestedHeight, fullHeight) : fullHeight;
  let canvas;

  try {
    canvas = await drawPosterToCanvas(captureHeight);
  } catch {
    alert("截图生成失败。若使用网络图片，请确认图片链接允许网页截图，或改用本地上传。");
    return;
  }

  const link = document.createElement("a");
  link.download = `poster-${formatDateForFile(new Date())}.png`;
  try {
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch {
    alert("截图保存失败。若使用网络图片，请确认图片链接允许网页截图，或改用本地上传。");
  }
}

async function drawPosterToCanvas(captureHeight) {
  const scale = window.devicePixelRatio || 1;
  const posterRect = els.poster.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(posterRect.width * scale);
  canvas.height = Math.round(captureHeight * scale);

  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  drawPosterBackground(ctx, posterRect.width, captureHeight);
  drawPosterHeader(ctx, posterRect);
  await drawTiles(ctx, posterRect);
  return canvas;
}

function drawPosterBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#fbfaf8");
  gradient.addColorStop(0.38, "#f5f1ed");
  gradient.addColorStop(1, "#cfc7bd");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawPosterHeader(ctx, posterRect) {
  drawTextFromElement(ctx, els.posterTitleView, posterRect, {
    weight: "300",
    baseline: "middle",
  });
  drawTextFromElement(ctx, els.posterSubtitleView, posterRect, {
    baseline: "middle",
  });
  drawTextFromElement(ctx, els.posterAuthorView, posterRect, {
    weight: "700",
    baseline: "middle",
  });
}

async function drawTiles(ctx, posterRect) {
  const tileNodes = Array.from(els.tileGrid.querySelectorAll(".tile"));
  for (const tile of tileNodes) {
    const item = state.items.find((entry) => entry.id === tile.dataset.id);
    if (!item) continue;
    const frame = tile.querySelector(".tile-frame");
    const rect = getRelativeRect(frame || tile, posterRect);
    const image = await loadImage(item.image);
    drawCroppedImage(ctx, image, rect, item);
    drawCaption(ctx, tile, rect, item);
  }
}

function drawCroppedImage(ctx, image, rect, item) {
  ctx.save();
  ctx.shadowColor = "rgba(32, 24, 18, 0.22)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#ded8d1";
  ctx.beginPath();
  drawRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, getTileRadius(rect.width));
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  drawRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, getTileRadius(rect.width));
  ctx.clip();

  const coverScale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const finalScale = coverScale * (item.zoom / 100);
  const drawWidth = image.naturalWidth * finalScale;
  const drawHeight = image.naturalHeight * finalScale;
  const extraWidth = Math.max(0, drawWidth - rect.width);
  const extraHeight = Math.max(0, drawHeight - rect.height);
  const x = rect.x - extraWidth / 2 + ((50 - item.x) / 100) * extraWidth;
  const y = rect.y - extraHeight / 2 + ((50 - item.y) / 100) * extraHeight;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
  ctx.restore();
}

function drawCaption(ctx, tile, rect, item) {
  const gradient = ctx.createLinearGradient(0, rect.y + rect.height * 0.62, 0, rect.y + rect.height);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0.62)");
  ctx.fillStyle = gradient;
  ctx.fillRect(rect.x, rect.y + rect.height * 0.48, rect.width, rect.height * 0.52);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 1;

  const titleStyle = normalizeTextStyle(item.titleStyle, TILE_TITLE_STYLE);
  const subtitleStyle = normalizeTextStyle(item.subtitleStyle, TILE_SUBTITLE_STYLE);
  ctx.fillStyle = titleStyle.fontColor;
  ctx.font = `${titleStyle.italic ? "italic" : "normal"} 400 ${titleStyle.fontSize}px ${titleStyle.fontFamily}`;
  drawFittedLine(
    ctx,
    item.title,
    rect.x + rect.width / 2,
    rect.y + rect.height - titleStyle.fontSize * 1.25,
    rect.width - 16,
  );

  ctx.fillStyle = subtitleStyle.fontColor;
  ctx.font = `${subtitleStyle.italic ? "italic" : "normal"} 400 ${subtitleStyle.fontSize}px ${
    subtitleStyle.fontFamily
  }`;
  drawFittedLine(ctx, item.subtitle, rect.x + rect.width / 2, rect.y + rect.height - 12, rect.width - 16);
  ctx.restore();
}

function drawTextFromElement(ctx, element, posterRect, options = {}) {
  const rect = getRelativeRect(element, posterRect);
  const style = getComputedStyle(element);
  const fontStyle = style.fontStyle || "normal";
  const fontWeight = options.weight || style.fontWeight || "400";
  ctx.save();
  ctx.font = `${fontStyle} ${fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.fillStyle = style.color;
  ctx.textAlign = "center";
  ctx.textBaseline = options.baseline || "alphabetic";
  drawFittedLine(ctx, element.textContent, rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width);
  ctx.restore();
}

function drawFittedLine(ctx, text, x, y, maxWidth) {
  const value = text || " ";
  if (ctx.measureText(value).width <= maxWidth) {
    ctx.fillText(value, x, y);
    return;
  }

  let output = value;
  while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  ctx.fillText(`${output}...`, x, y);
}

function getRelativeRect(element, parentRect) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - parentRect.left,
    y: rect.top - parentRect.top,
    width: rect.width,
    height: rect.height,
  };
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
}

function getTileRadius(width) {
  return Math.max(6, Math.min(14, width * 0.045));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeColumns(value) {
  const columns = Number.parseInt(value, 10);
  if (!Number.isFinite(columns)) return 3;
  return clamp(columns, 1, 8);
}

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  const random = window.crypto?.getRandomValues
    ? window.crypto.getRandomValues(new Uint32Array(2)).join("")
    : `${Math.random()}`.slice(2);
  return `id-${Date.now()}-${random}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (isExternalImage(src)) {
      image.crossOrigin = "anonymous";
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load"));
    image.src = src;
  });
}

function isExternalImage(src) {
  try {
    return new URL(src, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function persist(saveSnapshot) {
  if (!state.user) return;
  const savedState = {
    items: state.items,
    selectedId: state.selectedId,
    poster: state.poster,
  };
  try {
    localStorage.setItem(accountStorageKey(STORAGE_KEY), JSON.stringify(savedState));
  } catch {
    alert("图片太多或图片过大，浏览器本地保存空间不足。请删除部分小框后再试。");
    return;
  }
}

function loadSavedState() {
  resetWorkspace();
  if (!state.user) return;
  const saved = localStorage.getItem(accountStorageKey(STORAGE_KEY));
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    state.items = Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : [];
    state.selectedId = parsed.selectedId || state.items[0]?.id || null;
    state.poster = normalizePoster({ ...DEFAULT_POSTER, ...(parsed.poster || {}) });
  } catch {
    localStorage.removeItem(accountStorageKey(STORAGE_KEY));
  }
}

function normalizePoster(poster) {
  return {
    ...DEFAULT_POSTER,
    ...(poster || {}),
    titleStyle: normalizeTextStyle(poster?.titleStyle, DEFAULT_POSTER.titleStyle),
    subtitleStyle: normalizeTextStyle(poster?.subtitleStyle, DEFAULT_POSTER.subtitleStyle),
    authorStyle: normalizeTextStyle(poster?.authorStyle, DEFAULT_POSTER.authorStyle),
  };
}

function normalizeItem(item) {
  return {
    ...item,
    titleStyle: normalizeTextStyle(item.titleStyle || item, TILE_TITLE_STYLE),
    subtitleStyle: normalizeTextStyle(item.subtitleStyle || item, TILE_SUBTITLE_STYLE),
  };
}

function normalizeTextStyle(style, fallback) {
  return {
    fontFamily: style?.fontFamily || fallback.fontFamily,
    fontSize: Number(style?.fontSize) || fallback.fontSize,
    fontColor: style?.fontColor || fallback.fontColor,
    italic: Boolean(style?.italic),
  };
}

function accountStorageKey(key) {
  return `${key}:user:${state.user.id}`;
}

function resetWorkspace() {
  state.items = [];
  state.selectedId = null;
  state.poster = normalizePoster(DEFAULT_POSTER);
  tileEditorOpen = false;
}

async function openAssetPickerModal() {
  let assets = [];
  try {
    const payload = await api("/api/account/assets");
    assets = payload.assets || [];
  } catch (error) {
    alert(error.message);
    return;
  }
  const modal = createModal("选择图片", "asset-picker-modal");
  const selected = new Set();
  const grid = document.createElement("div");
  grid.className = "asset-grid";

  if (!assets.length) {
    const empty = document.createElement("p");
    empty.className = "helper-text";
    empty.textContent = "暂无已提交图片";
    modal.body.append(empty);
  } else {
    assets.forEach((asset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "asset-thumb";
      button.innerHTML = `<img src="${asset.url}" alt="" /><span class="checkmark">✓</span>`;
      button.addEventListener("click", () => {
        if (selected.has(asset.id)) {
          selected.delete(asset.id);
          button.classList.remove("is-picked");
        } else {
          selected.add(asset.id);
          button.classList.add("is-picked");
        }
      });
      grid.append(button);
    });
    modal.body.append(grid);
  }

  modal.actions.append(
    makeModalButton("加入当前页面", () => {
      const picked = assets.filter((asset) => selected.has(asset.id));
      if (!picked.length) return;
      const items = picked.map((asset, index) => createItem({ src: asset.url, name: asset.name }, index, picked.length));
      state.items.push(...items);
      state.selectedId = items.at(-1).id;
      tileEditorOpen = false;
      persist(true);
      closeModal(modal.root);
      render();
    }),
    makeModalButton("本地保存", () => {
      assets
        .filter((asset) => selected.has(asset.id))
        .forEach((asset) => downloadUrl(asset.url, asset.name || `image-${asset.id}.jpg`));
      closeModal(modal.root);
    }),
    makeModalButton("删除", async () => {
      const assetIds = [...selected];
      if (!assetIds.length || !confirm("确定删除选中的图片吗？")) return;
      try {
        const payload = await api("/api/account/assets/delete", {
          method: "POST",
          body: JSON.stringify({ assetIds }),
        });
        state.user = payload.user;
        closeModal(modal.root);
        render();
      } catch (error) {
        alert(error.message);
      }
    }, "danger-button"),
  );
}

function createModal(title, extraClass = "") {
  closeModal(document.querySelector(".modal-backdrop"));
  const root = document.createElement("div");
  root.className = "modal-backdrop";
  root.innerHTML = `
    <section class="modal-panel ${extraClass}">
      <div class="modal-title">
        <button type="button" class="ghost-button modal-close" data-close>关闭</button>
        <h2>${title}</h2>
      </div>
      <div class="modal-body"></div>
      <div class="modal-actions"></div>
    </section>
  `;
  root.addEventListener("click", (event) => {
    if (event.target === root) closeModal(root);
  });
  root.querySelector("[data-close]").addEventListener("click", () => closeModal(root));
  document.body.append(root);
  return {
    root,
    body: root.querySelector(".modal-body"),
    actions: root.querySelector(".modal-actions"),
  };
}

function closeModal(root) {
  root?.remove();
}

function makeModalButton(label, onClick, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ghost-button ${extraClass}`.trim();
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function downloadUrl(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
}

function getSelectedItem() {
  return state.items.find((item) => item.id === state.selectedId);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDateForFile(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

async function api(path, options = {}) {
  const response = await fetch(`${APP_BASE}${path}`, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}

async function loadSession() {
  try {
    const payload = await api("/api/session");
    state.user = payload.user;
  } catch {
    state.user = null;
  }
}

async function login() {
  els.loginError.textContent = "";
  try {
    const payload = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: els.loginUsername.value.trim(),
        password: els.loginPassword.value,
      }),
    });
    state.user = payload.user;
    loadSavedState();
    els.loginForm.reset();
    render();
  } catch (error) {
    els.loginError.textContent = error.message;
  }
}

async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
  state.user = null;
  resetWorkspace();
  render();
}

async function loadUsers() {
  try {
    const payload = await api("/api/admin/users");
    renderUsers(payload.users);
  } catch (error) {
    els.userList.textContent = error.message;
  }
}

async function createUser() {
  try {
    const payload = await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: els.newUsername.value.trim(),
        password: els.newPassword.value,
        quota: els.newQuota.value.trim(),
      }),
    });
    els.newUsername.value = "";
    els.newPassword.value = "";
    renderUsers(payload.users);
  } catch (error) {
    alert(error.message);
  }
}

async function changeOwnPassword() {
  els.passwordMessage.textContent = "";
  const newPassword = els.selfNewPassword.value;
  if (newPassword.length < 3 || newPassword.length > 8) {
    els.passwordMessage.textContent = "新密码必须是 3-8 位。";
    return;
  }
  try {
    await api("/api/account/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: els.selfCurrentPassword.value,
        newPassword,
      }),
    });
    els.selfCurrentPassword.value = "";
    els.selfNewPassword.value = "";
    els.passwordMessage.textContent = "密码已更新";
    els.passwordForm.hidden = true;
  } catch (error) {
    els.passwordMessage.textContent = error.message;
  }
}

async function clearCurrentAccountStorage() {
  if (!state.user) return;
  const first = confirm("确定清除当前账号的所有小框和已上传图片吗？");
  if (!first) return;
  const second = confirm("再次确认：清除后容量将归零，当前账号内容不可恢复。");
  if (!second) return;

  try {
    const payload = await api("/api/account/clear-storage", {
      method: "POST",
      body: "{}",
    });
    localStorage.removeItem(accountStorageKey(STORAGE_KEY));
    state.user = payload.user;
    resetWorkspace();
    tileEditorOpen = false;
    render();
  } catch (error) {
    alert(error.message);
  }
}

function renderUsers(users) {
  els.userList.replaceChildren();
  users.forEach((user) => {
    const row = document.createElement("div");
    row.className = "user-row";

    const info = document.createElement("div");
    info.innerHTML = `<strong>${user.username}</strong><span>${user.role} · ${formatBytes(user.usedBytes)} / ${formatBytes(
      user.quotaBytes,
    )}</span>`;

    const quota = document.createElement("input");
    quota.type = "text";
    quota.value = formatBytes(user.quotaBytes);

    const button = document.createElement("button");
    button.className = "ghost-button";
    button.type = "button";
    button.textContent = "更新";
    button.addEventListener("click", async () => {
      try {
        const payload = await api("/api/admin/quota", {
          method: "POST",
          body: JSON.stringify({ userId: user.id, quota: quota.value }),
        });
        renderUsers(payload.users);
      } catch (error) {
        alert(error.message);
      }
    });

    row.append(info, quota, button);
    els.userList.append(row);
  });
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)}GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${value}B`;
}
