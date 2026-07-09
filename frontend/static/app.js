const state = {
  user: null,
  macros: [],
  selectedMacro: null,
  selectedButton: null,
  mode: "loading",
  authMode: "login",
  toast: "",
  previewHeights: {},
  editorHeights: {},
  authFields: {
    username: "",
    email: "",
    password: "",
  },
};

const previewHeightsStorageKey = "macroleia.previewHeights.v1";
const editorHeightsStorageKey = "macroleia.editorHeights.v1";
const maxImageBytes = 5 * 1024 * 1024;
const app = document.querySelector("#app");
const toast = document.createElement("div");
toast.className = "toast";
toast.hidden = true;
document.body.appendChild(toast);

const gatenho = document.createElement("img");
gatenho.className = "gatenho-layer";
gatenho.src = "/assets/gatenho.png";
gatenho.alt = "";
gatenho.setAttribute("aria-hidden", "true");
document.body.appendChild(gatenho);
gatenho.addEventListener("load", syncGatenhoReserve);

const poweredBy = document.createElement("img");
poweredBy.className = "powered-by";
poweredBy.src = "/assets/poweredby.png";
poweredBy.alt = "Powered by";
document.body.appendChild(poweredBy);

let previewResizeObserver = null;
let editorResizeObserver = null;
let gatenhoResizeFrame = null;

const defaultButtons = () =>
  Array.from({ length: 1 }, (_, index) => ({
    number: index + 1,
    label: createButtonKey(),
    message: "",
    content_type: "text",
  }));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "include",
    ...options,
  });

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || "Algo saiu do esperado");
  return payload;
}

function setToast(message) {
  state.toast = message;
  renderToast();
  if (message) {
    window.clearTimeout(setToast.timer);
    setToast.timer = window.setTimeout(() => {
      state.toast = "";
      renderToast();
    }, 2200);
  }
}

async function loadSession() {
  try {
    const { user } = await api("/api/me");
    state.user = user;
    await loadMacros();
    state.mode = "list";
  } catch {
    state.mode = "auth";
  }
  render();
}

async function loadMacros() {
  const { macros } = await api("/api/macros");
  state.macros = macros;
}

function render() {
  const focusedField = captureFocusedField();
  const views = {
    loading: renderLoading,
    auth: renderAuth,
    list: renderList,
    detail: renderDetail,
    form: renderForm,
  };
  app.innerHTML = views[state.mode]();
  renderToast();
  restoreFocusedField(focusedField);
  initResizablePreviews();
  initResizableEditors();
  syncGatenhoReserve();
}

function renderLoading() {
  return `<section class="center-panel">${renderLogo()}<h1>MacroLeia</h1><p>Carregando...</p></section>`;
}

function renderAuth() {
  const isLogin = state.authMode === "login";
  const isReset = state.authMode === "reset";
  return `
    <section class="auth-panel">
      <div class="brand">
        ${renderLogo()}
        <div>
          <p>Suas macros protegidas e prontas para colar.</p>
        </div>
      </div>
      <form class="panel" data-action="${isReset ? "reset-password" : isLogin ? "login" : "register"}">
        <h2>${isReset ? "Redefinir senha" : isLogin ? "Entrar" : "Criar usuario"}</h2>
        <label>Usuario<input name="username" autocomplete="username" required minlength="3" value="${escapeAttr(state.authFields.username)}" /></label>
        ${isLogin ? "" : `<label>Email<input name="email" type="email" autocomplete="email" required value="${escapeAttr(state.authFields.email)}" /></label>`}
        <label>${isReset ? "Nova senha" : "Senha"}<input name="password" type="password" autocomplete="${isLogin ? "current-password" : "new-password"}" required minlength="6" value="${escapeAttr(state.authFields.password)}" /></label>
        <button class="primary" type="submit">${isReset ? "Salvar nova senha" : isLogin ? "Entrar" : "Criar e entrar"}</button>
        <button class="ghost" type="button" data-action="${isReset ? "show-login" : "toggle-auth"}">
          ${isLogin ? "Criar novo usuario" : "Ja tenho usuario"}
        </button>
        ${isLogin ? `<button class="link-button" type="button" data-action="show-reset">Esqueci minha senha</button>` : ""}
      </form>
    </section>
  `;
}

function renderLogo() {
  return `<img class="site-logo" src="/assets/logo.png" alt="MacroLeia" />`;
}

function renderImagePreview(value) {
  if (!value) {
    return `<span class="number-preview">Sem imagem carregada neste botão.</span>`;
  }

  return `
    <span class="image-preview">
      <img src="${escapeAttr(value)}" alt="Imagem pronta para copiar" />
      <span>Imagem pronta para copiar</span>
    </span>
  `;
}

function renderImageEditor(button) {
  return `
    <div class="image-editor">
      ${button.message ? `<img src="${escapeAttr(button.message)}" alt="Imagem carregada" />` : `<div class="image-empty">Nenhuma imagem carregada.</div>`}
      <label>Imagem<input name="button-image" type="file" accept="image/*" data-index="${button.number - 1}" /></label>
    </div>
  `;
}

function renderHeader(title, actions = "") {
  return `
    <div class="logo-strip">${renderLogo()}</div>
    <header class="topbar">
      <div>
        <p class="eyebrow">${escapeHtml(state.user?.username || "")}</p>
        ${title ? `<h1>${escapeHtml(title)}</h1>` : ""}
      </div>
      <div class="top-actions">${actions}<button class="icon-button" data-action="logout" title="Sair">Sair</button></div>
    </header>
  `;
}

function renderList() {
  const items = state.macros
    .map(
      (macro, index) => {
        const kind = getMacroKind(macro);
        return `
        <article class="macro-row">
          <button class="macro-name" data-action="open" data-id="${macro.id}">
            <span class="macro-kind ${kind === "M" ? "multi" : "single"}" aria-label="${kind === "M" ? "Macro com múltiplas opções" : "Macro single"}">${kind}</span>
            <span>${escapeHtml(macro.name)}</span>
          </button>
          <div class="row-actions">
            <button class="arrow" title="Subir" data-action="move" data-id="${macro.id}" data-direction="up" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="arrow" title="Descer" data-action="move" data-id="${macro.id}" data-direction="down" ${index === state.macros.length - 1 ? "disabled" : ""}>↓</button>
            <button class="small" data-action="edit" data-id="${macro.id}">Editar</button>
          </div>
        </article>
      `;
      },
    )
    .join("");

  return `
    ${renderHeader("", `<button class="primary compact" data-action="new">Nova</button>`)}
    <section class="list-wrap">
      ${items || `<div class="empty">Nenhuma macro ainda.</div>`}
    </section>
  `;
}

function renderDetail() {
  const macro = state.selectedMacro;
  const buttons = macro.buttons.length ? macro.buttons : defaultButtons();
  const selected = state.selectedButton || buttons[0];
  return `
    ${renderHeader(macro.name, `<button class="ghost compact" data-action="back">Voltar</button><button class="primary compact" data-action="edit" data-id="${macro.id}">Editar</button>`)}
    <section class="detail">
      <div class="number-grid">
        ${buttons
          .map(
            (button) => {
              const resizeKey = getPreviewResizeKey(macro.id, button);
              const savedHeight = state.previewHeights[resizeKey];
              const heightStyle = savedHeight ? ` style="height: ${savedHeight}px"` : "";
              const expandedClass = savedHeight > 92 ? " expanded-preview" : "";
              const isImage = getButtonContentType(button) === "image";
              return `
              <button class="number-button ${selected?.number === button.number ? "active" : ""}${expandedClass}" data-action="copy" data-number="${button.number}" data-resize-key="${resizeKey}"${heightStyle}>
                <span class="number-badge">${button.number}</span>
                ${isImage ? renderImagePreview(button.message) : `<span class="number-preview">${escapeHtml(button.message || "Sem texto gravado neste botão.")}</span>`}
              </button>
            `;
            },
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderForm() {
  const macro = state.selectedMacro || { name: "", buttons: defaultButtons() };
  const buttons = normalizeButtons(macro.buttons);
  return `
    ${renderHeader(macro.id ? "Editar macro" : "Nova macro", `<button class="ghost compact" data-action="back">Voltar</button>`)}
    <form class="editor" data-action="save-macro" data-id="${macro.id || ""}">
      <label>Nome da macro<input name="name" required maxlength="80" value="${escapeAttr(macro.name)}" /></label>
      <div class="button-editor-head">
        <h2>Conteudos dos botoes</h2>
        <button class="ghost compact" type="button" data-action="add-button">Adicionar botao</button>
      </div>
      <div class="button-editor">
        ${buttons.map(renderButtonEditor).join("")}
      </div>
      <div class="form-actions">
        ${macro.id ? `<button class="danger" type="button" data-action="delete" data-id="${macro.id}">Excluir</button>` : ""}
        <button class="primary" type="submit">Salvar</button>
      </div>
    </form>
  `;
}

function renderButtonEditor(button, index) {
  const buttons = normalizeButtons(state.selectedMacro?.buttons || []);
  const buttonKey = getButtonKey(button);
  const contentType = getButtonContentType(button);
  const resizeKey = getEditorResizeKey(state.selectedMacro?.id || "draft", buttonKey);
  const savedHeight = state.editorHeights[resizeKey];
  const heightStyle = savedHeight ? ` style="height: ${savedHeight}px"` : "";
  return `
    <section class="button-card" data-button-key="${escapeAttr(buttonKey)}" data-content-type="${escapeAttr(contentType)}">
      <div class="button-card-title">
        <strong>${index + 1}</strong>
        <div class="card-actions">
          <button class="small ${contentType === "text" ? "active" : ""}" type="button" data-action="set-button-type" data-index="${index}" data-content-type="text">Texto</button>
          <button class="small ${contentType === "image" ? "active" : ""}" type="button" data-action="set-button-type" data-index="${index}" data-content-type="image">Imagem</button>
          <button class="arrow" title="Subir card" type="button" data-action="move-button" data-index="${index}" data-direction="up" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="arrow" title="Descer card" type="button" data-action="move-button" data-index="${index}" data-direction="down" ${index === buttons.length - 1 ? "disabled" : ""}>↓</button>
          <button class="icon-button" type="button" data-action="remove-button" data-index="${index}" ${index < 1 ? "disabled" : ""}>Remover</button>
        </div>
      </div>
      ${contentType === "image" ? renderImageEditor(button) : `<label>Mensagem<textarea name="button-message" rows="4" maxlength="5000" data-resize-key="${escapeAttr(resizeKey)}"${heightStyle}>${escapeHtml(button.message || "")}</textarea></label>`}
    </section>
  `;
}

function normalizeButtons(buttons) {
  const normalized = buttons?.length ? buttons : defaultButtons();
  return normalized.map((button, index) => ({
    number: index + 1,
    label: getButtonKey(button),
    message: button.message || "",
    content_type: getButtonContentType(button),
  }));
}

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const action = form.dataset.action;
  const formData = new FormData(form);

  try {
    if (action === "login") {
      const { user } = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: formData.get("username"),
          password: formData.get("password"),
        }),
      });
      state.user = user;
      resetAuthFields();
      await loadMacros();
      state.mode = "list";
    }

    if (action === "register") {
      const { user } = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: formData.get("username"),
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });
      state.user = user;
      resetAuthFields();
      await loadMacros();
      state.mode = "list";
    }

    if (action === "reset-password") {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          username: formData.get("username"),
          email: formData.get("email"),
          new_password: formData.get("password"),
        }),
      });
      state.authMode = "login";
      state.mode = "auth";
      resetAuthFields();
      setToast("Senha redefinida");
    }

    if (action === "save-macro") {
      syncEditorState();
      const payload = {
        name: formData.get("name"),
        buttons: normalizeButtons(state.selectedMacro.buttons).map((button) => ({
          label: getButtonKey(button),
          message: button.message,
          content_type: getButtonContentType(button),
        })),
      };
      const macroId = form.dataset.id;
      const result = await api(macroId ? `/api/macros/${macroId}` : "/api/macros", {
        method: macroId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      await loadMacros();
      if (macroId) {
        state.selectedMacro = result.macro;
        state.selectedButton = result.macro.buttons[0] || null;
        state.mode = "detail";
      } else {
        state.selectedMacro = null;
        state.selectedButton = null;
        state.mode = "list";
      }
      setToast("Macro salva");
    }
    render();
  } catch (error) {
    setToast(error.message);
  }
});

app.addEventListener("input", (event) => {
  const field = event.target;
  if (
    state.mode !== "auth" ||
    !field.name ||
    !Object.prototype.hasOwnProperty.call(state.authFields, field.name)
  ) {
    return;
  }
  state.authFields[field.name] = field.value;
});

app.addEventListener("click", async (event) => {
  const target = event.target.closest("button[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;

  try {
    if (action === "toggle-auth") {
      state.authMode = state.authMode === "login" ? "register" : "login";
    }

    if (action === "show-reset") {
      state.authMode = "reset";
    }

    if (action === "show-login") {
      state.authMode = "login";
    }

    if (action === "logout") {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      state.macros = [];
      state.mode = "auth";
    }

    if (action === "new") {
      state.selectedMacro = { name: "", buttons: defaultButtons() };
      state.mode = "form";
    }

    if (action === "back") {
      if (state.mode === "detail") {
        state.selectedMacro = null;
        state.selectedButton = null;
        state.mode = "list";
      } else {
        state.mode = state.selectedMacro?.id ? "detail" : "list";
      }
      if (state.mode === "detail") state.selectedButton = state.selectedMacro.buttons[0] || null;
    }

    if (action === "open") {
      const listedMacro = state.macros.find((item) => String(item.id) === String(id));
      const singleButton = getSingleFilledButton(listedMacro);
      if (singleButton) {
        if (getButtonContentType(singleButton) === "image") {
          await copyImage(singleButton.message);
        } else {
          await copyText(singleButton.message);
        }
        setToast("Copiado");
        return;
      }

      const { macro } = await api(`/api/macros/${id}`);
      state.selectedMacro = macro;
      state.selectedButton = macro.buttons[0] || null;
      state.mode = "detail";
    }

    if (action === "edit") {
      const macro = state.macros.find((item) => String(item.id) === String(id)) || state.selectedMacro;
      state.selectedMacro = macro;
      state.mode = "form";
    }

    if (action === "move") {
      const { macros } = await api(`/api/macros/${id}/reorder`, {
        method: "POST",
        body: JSON.stringify({ direction: target.dataset.direction }),
      });
      state.macros = macros;
    }

    if (action === "copy") {
      const number = Number(target.dataset.number);
      state.selectedButton = state.selectedMacro.buttons.find((button) => button.number === number);
      const message = state.selectedButton?.message || "";
      if (message) {
        if (getButtonContentType(state.selectedButton) === "image") {
          await copyImage(message);
        } else {
          await copyText(message);
        }
        setToast("Copiado");
      }
    }

    if (action === "add-button") {
      syncEditorState();
      const cards = state.selectedMacro.buttons.length;
      state.selectedMacro.buttons.push({ number: cards + 1, label: createButtonKey(), message: "", content_type: "text" });
    }

    if (action === "remove-button") {
      syncEditorState();
      const index = Number(target.dataset.index);
      state.selectedMacro.buttons = normalizeButtons(state.selectedMacro.buttons).filter((_, itemIndex) => itemIndex !== index);
    }

    if (action === "move-button") {
      syncEditorState();
      const index = Number(target.dataset.index);
      const direction = target.dataset.direction;
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      const buttons = normalizeButtons(state.selectedMacro.buttons);
      if (nextIndex >= 0 && nextIndex < buttons.length) {
        [buttons[index], buttons[nextIndex]] = [buttons[nextIndex], buttons[index]];
        state.selectedMacro.buttons = normalizeButtons(buttons);
      }
    }

    if (action === "set-button-type") {
      syncEditorState();
      const index = Number(target.dataset.index);
      const contentType = target.dataset.contentType;
      const buttons = normalizeButtons(state.selectedMacro.buttons);
      if (buttons[index] && ["text", "image"].includes(contentType)) {
        buttons[index].content_type = contentType;
        buttons[index].message = "";
        state.selectedMacro.buttons = normalizeButtons(buttons);
      }
    }

    if (action === "delete") {
      if (window.confirm("Excluir esta macro?")) {
        await api(`/api/macros/${id}`, { method: "DELETE" });
        await loadMacros();
        state.selectedMacro = null;
        state.selectedButton = null;
        state.mode = "list";
        setToast("Macro excluida");
      }
    }

    render();
  } catch (error) {
    setToast(error.message);
  }
});

app.addEventListener("change", async (event) => {
  const field = event.target;
  if (field.name !== "button-image" || state.mode !== "form") return;

  const file = field.files?.[0];
  try {
    await setEditorCardImage(Number(field.dataset.index), file);
  } catch (error) {
    field.value = "";
    setToast(error.message);
  }
});

app.addEventListener("paste", async (event) => {
  if (state.mode !== "form") return;

  const field = event.target;
  if (!field.matches?.('[name="button-message"]')) return;

  const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));
  if (!file) return;

  event.preventDefault();
  try {
    const card = field.closest(".button-card");
    const index = [...app.querySelectorAll(".button-card")].indexOf(card);
    await setEditorCardImage(index, file);
  } catch (error) {
    setToast(error.message);
  }
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function renderToast() {
  toast.hidden = !state.toast;
  toast.textContent = state.toast;
}

function initResizablePreviews() {
  if (previewResizeObserver) {
    previewResizeObserver.disconnect();
    previewResizeObserver = null;
  }

  if (state.mode !== "detail" || typeof ResizeObserver !== "function") return;

  previewResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const card = entry.target;
      const height = Math.round(card.getBoundingClientRect().height);
      const resizeKey = card.dataset.resizeKey;
      if (!resizeKey || !height) continue;

      state.previewHeights[resizeKey] = height;
      savePreviewHeights();
      card.classList.toggle("expanded-preview", height > 92);
    }
  });

  app.querySelectorAll(".number-button[data-resize-key]").forEach((card) => {
    previewResizeObserver.observe(card);
  });
}

function initResizableEditors() {
  if (editorResizeObserver) {
    editorResizeObserver.disconnect();
    editorResizeObserver = null;
  }

  if (state.mode !== "form" || typeof ResizeObserver !== "function") return;

  editorResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const field = entry.target;
      const height = Math.round(field.getBoundingClientRect().height);
      const resizeKey = field.dataset.resizeKey;
      if (!resizeKey || !height) continue;

      state.editorHeights[resizeKey] = height;
      saveEditorHeights();
    }
  });

  app.querySelectorAll('textarea[name="button-message"][data-resize-key]').forEach((field) => {
    editorResizeObserver.observe(field);
  });
}

function captureFocusedField() {
  const field = document.activeElement;
  if (!field || !app.contains(field) || !["INPUT", "TEXTAREA"].includes(field.tagName)) return null;
  if (field.type === "file") return null;

  const fields = [...app.querySelectorAll(field.tagName.toLowerCase())].filter((item) => item.name === field.name);
  return {
    tag: field.tagName.toLowerCase(),
    type: field.type || "",
    name: field.name,
    index: fields.indexOf(field),
    value: field.value,
    selectionStart: field.selectionStart,
    selectionEnd: field.selectionEnd,
  };
}

function restoreFocusedField(focusedField) {
  if (!focusedField) return;

  const candidates = [...app.querySelectorAll(focusedField.tag)].filter((item) => item.name === focusedField.name);
  const field = candidates[focusedField.index];
  if (!field) return;

  if (field.type !== "file") {
    field.value = focusedField.value;
  }
  field.focus({ preventScroll: true });
  if (canRestoreSelection(field, focusedField)) {
    field.setSelectionRange(focusedField.selectionStart, focusedField.selectionEnd);
  }
}

function canRestoreSelection(field, focusedField) {
  const selectableTypes = ["", "text", "search", "tel", "url", "password"];
  return (
    typeof field.setSelectionRange === "function" &&
    focusedField.selectionStart !== null &&
    focusedField.selectionEnd !== null &&
    (focusedField.tag === "textarea" || selectableTypes.includes(focusedField.type))
  );
}

function resetAuthFields() {
  state.authFields = {
    username: "",
    email: "",
    password: "",
  };
}

function syncEditorState() {
  const editor = app.querySelector(".editor");
  if (!editor || !state.selectedMacro) return;
  const formData = new FormData(editor);
  const previousButtons = normalizeButtons(state.selectedMacro.buttons);
  state.selectedMacro.name = formData.get("name") || state.selectedMacro.name;
  state.selectedMacro.buttons = [...editor.querySelectorAll(".button-card")].map((card, index) => {
    const contentType = card.dataset.contentType || "text";
    const label = card.dataset.buttonKey || createButtonKey();
    const previousButton = previousButtons.find((button) => getButtonKey(button) === label);
    return {
      number: index + 1,
      label,
      message: contentType === "image" ? previousButton?.message || "" : card.querySelector('[name="button-message"]')?.value || "",
      content_type: contentType,
    };
  });
}

function getSingleFilledButton(macro) {
  const filledButtons = getFilledButtons(macro);
  return filledButtons.length === 1 ? filledButtons[0] : null;
}

function getFilledButtons(macro) {
  return (macro?.buttons || []).filter((button) => button.message?.trim());
}

async function setEditorCardImage(index, file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Selecione uma imagem");
  }

  if (file.size > maxImageBytes) {
    throw new Error("Imagem muito grande. Use ate 5 MB");
  }

  syncEditorState();
  const buttons = normalizeButtons(state.selectedMacro.buttons);
  if (!buttons[index]) return;

  buttons[index].content_type = "image";
  buttons[index].message = await readFileAsDataUrl(file);
  state.selectedMacro.buttons = normalizeButtons(buttons);
  setToast("Imagem carregada");
  render();
}

function getMacroKind(macro) {
  return getFilledButtons(macro).length > 1 ? "M" : "S";
}

function getPreviewResizeKey(macroId, button) {
  return `${macroId}:${getButtonKey(button)}`;
}

function getEditorResizeKey(macroId, buttonKey) {
  return `${macroId}:${buttonKey}`;
}

function getButtonKey(button) {
  return button?.label || createButtonKey();
}

function getButtonContentType(button) {
  return button?.content_type === "image" ? "image" : "text";
}

function createButtonKey() {
  return `btn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function loadPreviewHeights() {
  try {
    state.previewHeights = JSON.parse(localStorage.getItem(previewHeightsStorageKey) || "{}");
  } catch {
    state.previewHeights = {};
  }
}

function loadEditorHeights() {
  try {
    state.editorHeights = JSON.parse(localStorage.getItem(editorHeightsStorageKey) || "{}");
  } catch {
    state.editorHeights = {};
  }
}

function savePreviewHeights() {
  try {
    localStorage.setItem(previewHeightsStorageKey, JSON.stringify(state.previewHeights));
  } catch {
    return;
  }
}

function saveEditorHeights() {
  try {
    localStorage.setItem(editorHeightsStorageKey, JSON.stringify(state.editorHeights));
  } catch {
    return;
  }
}

function syncGatenhoReserve() {
  window.cancelAnimationFrame(gatenhoResizeFrame);
  gatenhoResizeFrame = window.requestAnimationFrame(() => {
    const height = Math.ceil(gatenho.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--gatenho-reserved-height", `${height}px`);
  });
}

async function copyText(message) {
  await navigator.clipboard.writeText(message);
}

async function copyImage(dataUrl) {
  if (typeof ClipboardItem !== "function") {
    throw new Error("Copia de imagem nao suportada neste navegador");
  }

  const response = dataUrl.startsWith("data:")
    ? await fetch(dataUrl)
    : await fetch(dataUrl, { credentials: "include" });
  if (!response.ok) {
    throw new Error("Nao foi possivel carregar a imagem");
  }
  const originalBlob = await response.blob();
  const blob = originalBlob.type === "image/png" ? originalBlob : await convertImageBlobToPng(originalBlob);
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

async function convertImageBlobToPng(blob) {
  const image = await loadImageFromBlob(blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((pngBlob) => {
      if (pngBlob) {
        resolve(pngBlob);
      } else {
        reject(new Error("Nao foi possivel preparar a imagem"));
      }
    }, "image/png");
  });
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.addEventListener("load", () => {
      URL.revokeObjectURL(url);
      resolve(image);
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Nao foi possivel carregar a imagem"));
    });
    image.src = url;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("Nao foi possivel carregar a imagem")));
    reader.readAsDataURL(file);
  });
}

window.addEventListener("resize", syncGatenhoReserve);
loadPreviewHeights();
loadEditorHeights();
loadSession();
