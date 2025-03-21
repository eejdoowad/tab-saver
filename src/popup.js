function h(tag, props = {}, children = []) {
  const element = document.createElement(tag);

  Object.entries(props).forEach(([key, value]) => {
    if (key === "className" || key === "class") {
      element.className = value;
    } else if (key === "dataset") {
      Object.entries(value).forEach(([dataKey, dataValue]) => {
        element.dataset[dataKey] = dataValue;
      });
    } else if (key.startsWith("on") && typeof value === "function") {
      const eventName = key.substring(2).toLowerCase();
      element.addEventListener(eventName, value);
    } else if (key === "style" && typeof value === "object") {
      Object.entries(value).forEach(([styleProp, styleValue]) => {
        element.style[styleProp] = styleValue;
      });
    } else if (key === "contentEditable") {
      element.contentEditable = value;
    } else {
      element.setAttribute(key, value);
    }
  });

  if (Array.isArray(children)) {
    children.forEach((child) => appendChild(element, child));
  } else if (children) {
    appendChild(element, children);
  }

  return element;
}

function appendChild(parent, child) {
  if (child === null || child === undefined) return;

  if (typeof child === "string" || typeof child === "number") {
    parent.appendChild(document.createTextNode(child));
  } else {
    parent.appendChild(child);
  }
}

const saveButton = document.getElementById("saveSession");
const draftSession = document.getElementById("draftSession");
const sessionsContainer = document.getElementById("sessions");
const trashSessionsContainer = document.getElementById("trashSessions");

function formatDate(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString();
}

const sessionTab = document.getElementById("sessionTab");
const trashTab = document.getElementById("trashTab");
const dataTab = document.getElementById("dataTab");

const mainView = document.getElementById("mainView");
const trashView = document.getElementById("trashView");
const exportView = document.getElementById("exportView");
const dataTextarea = document.getElementById("exportTextarea");
const copyJsonBtn = document.getElementById("copyJsonBtn");
const saveDataBtn = document.getElementById("saveDataBtn");
const revertDataBtn = document.getElementById("revertDataBtn");
const dataStatusMessage = document.getElementById("dataStatusMessage");
const emptyTrashBtn = document.getElementById("emptyTrashBtn");

let originalDataJSON = "";

function generateUniqueId() {
  return "session_" + Date.now() + "_" +
    Math.random().toString(36).substr(2, 9);
}

function isRestrictedUrl(url) {
  if (
    url.startsWith("about:") ||
    url.startsWith("chrome:") ||
    url.startsWith("resource:") ||
    url.startsWith("moz-extension:") ||
    url.startsWith("javascript:") ||
    url.startsWith("data:") ||
    url.startsWith("file:")
  ) {
    return true;
  }
  return false;
}

async function saveCurrentSession() {
  try {
    const tabs = await browser.tabs.query({ currentWindow: true });
    const validTabs = tabs.filter((tab) => !isRestrictedUrl(tab.url));

    if (validTabs.length === 0) {
      alert(
        "No valid tabs to save. All tabs have restricted URLs that can't be reopened later.",
      );
      return;
    }

    const { sessionCounter = 0 } = await browser.storage.local.get(
      "sessionCounter",
    );
    const newCounter = sessionCounter + 1;
    const timestamp = Date.now();

    const session = {
      id: generateUniqueId(),
      name: `Session ${newCounter}`,
      create_time: timestamp,
      tabs: validTabs.map((tab) => ({
        url: tab.url,
        title: tab.title,
      })),
    };

    const { sessions = [] } = await browser.storage.local.get("sessions");
    sessions.unshift(session);

    await browser.storage.local.set({
      sessions,
      sessionCounter: newCounter,
    });

    displaySessions();
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

saveButton.addEventListener("click", (event) => {
  event.stopPropagation();
  saveCurrentSession();
});

draftSession.addEventListener("click", () => {
  saveCurrentSession();
});

async function openInCurrentWindow(session) {
  browser.runtime.sendMessage({
    action: "openInCurrentWindow",
    session: session,
  });
  window.close();
}

async function openInNewWindow(session) {
  browser.runtime.sendMessage({
    action: "openInNewWindow",
    session: session,
  });
  window.close();
}

async function saveSessionName(sessionId, newName) {
  try {
    browser.runtime.sendMessage({
      action: "renameSession",
      sessionId: sessionId,
      newName: newName,
    });
  } catch (error) {
    console.error(`Error renaming session ${sessionId}:`, error);
  }
}

async function moveToTrash(sessionId) {
  try {
    const sessionElement = document.querySelector(
      `.delete-btn[data-session-id="${sessionId}"]`,
    ).closest(".session-item");
    if (sessionElement) {
      sessionElement.remove();
    }

    browser.runtime.sendMessage({
      action: "moveToTrash",
      sessionId: sessionId,
    });

    displayTrashSessions();
  } catch (error) {
    console.error(`Error moving session ${sessionId} to trash:`, error);
    displaySessions();
    displayTrashSessions();
  }
}

async function restoreFromTrash(sessionId) {
  try {
    const sessionElement = document.querySelector(
      `.undelete-btn[data-session-id="${sessionId}"]`,
    ).closest(".session-item");
    if (sessionElement) {
      sessionElement.remove();
    }

    const { trashSessions = [] } = await browser.storage.local.get(
      "trashSessions",
    );
    const sessionToRestore = trashSessions.find((session) =>
      session.id === sessionId
    );

    if (sessionToRestore) {
      const { delete_time, ...restoredSession } = sessionToRestore;
      addSessionToUI(restoredSession);

      browser.runtime.sendMessage({
        action: "restoreFromTrash",
        sessionId: sessionId,
      });
    } else {
      console.error(
        `Session ${sessionId} not found in trash for immediate restoration`,
      );
      browser.runtime.sendMessage({
        action: "restoreFromTrash",
        sessionId: sessionId,
      });
      displaySessions();
    }
  } catch (error) {
    console.error(`Error restoring session ${sessionId} from trash:`, error);
    displaySessions();
    displayTrashSessions();
  }
}

function getClickTarget(event, sessionElement) {
  const rect = sessionElement.getBoundingClientRect();
  const sessionActions = sessionElement.querySelector(".session-actions");
  const actionsRect = sessionActions.getBoundingClientRect();

  if (event.clientX >= actionsRect.left) {
    const buttons = sessionActions.querySelectorAll("button");
    const buttonWidth = actionsRect.width / buttons.length;
    const posInActions = event.clientX - actionsRect.left;
    const buttonIndex = Math.min(
      Math.floor(posInActions / buttonWidth),
      buttons.length - 1,
    );
    return buttons[buttonIndex];
  }

  const titleContainer = sessionElement.querySelector(".title-container");
  if (
    event.target === titleContainer || titleContainer.contains(event.target)
  ) {
    return sessionElement.querySelector(".session-title");
  }

  return titleContainer;
}

function addSessionRowClickHandling(sessionElement) {
  if (sessionElement.closest(".draft-session")) return;

  sessionElement.addEventListener("click", function (event) {
    if (
      event.target.tagName === "BUTTON" ||
      event.target.classList.contains("session-title") ||
      event.target.closest(".tab-list-container") ||
      event.target.closest(".tab-list")
    ) {
      return;
    }

    const target = getClickTarget(event, sessionElement);
    if (target) {
      target.click();
    }
  });
}

function addSessionToUI(session) {
  const sessionElement = h("div", {
    className: "session-item",
    draggable: true,
    dataset: { sessionId: session.id },
  });

  const titleContainer = h("div", { className: "title-container" }, [
    h("span", {
      className: "session-title",
      contentEditable: "true",
      dataset: { sessionId: session.id },
    }, session.name),
    h("span", { className: "session-date" }, formatDate(session.create_time)),
  ]);

  const sessionActions = h("div", { className: "session-actions" }, [
    h("button", {
      className: "show-tabs-btn",
      title: "Show Tabs",
      dataset: { sessionId: session.id },
    }, "▼"),
    h("button", {
      className: "restore-btn",
      title: "Open Here",
      dataset: { sessionId: session.id },
    }, "⊕"),
    h("button", {
      className: "new-window-btn",
      title: "New Window",
      dataset: { sessionId: session.id },
    }, "⧉"),
    h("button", {
      className: "delete-btn",
      title: "Move to Trash",
      dataset: { sessionId: session.id },
    }, "🗑︎"),
  ]);

  const sessionInfo = h("div", { className: "session-info" }, [
    titleContainer,
    sessionActions,
  ]);

  sessionElement.appendChild(sessionInfo);

  const tabListContainer = h("div", {
    className: "tab-list-container",
    style: { display: "none" },
  });

  const dateElement = h(
    "div",
    { className: "session-date" },
    `Created: ${formatDate(session.create_time)}`,
  );
  tabListContainer.appendChild(dateElement);

  const tabListElement = h("div", { className: "tab-list" });

  session.tabs.forEach((tab) => {
    const tabElement = h("div", { className: "tab-item" }, [
      h("span", { className: "tab-title" }, tab.title),
      h("span", { className: "tab-url" }, tab.url),
    ]);

    tabListElement.appendChild(tabElement);
  });

  tabListContainer.appendChild(tabListElement);
  sessionElement.appendChild(tabListContainer);

  const sessionsContainer = document.getElementById("sessions");
  if (sessionsContainer.firstChild) {
    sessionsContainer.insertBefore(
      sessionElement,
      sessionsContainer.firstChild,
    );
  } else {
    sessionsContainer.appendChild(sessionElement);
  }

  addSessionEventListeners(sessionElement);
  addSessionRowClickHandling(sessionElement);
  addDragAndDropListeners();
}

function addSessionEventListeners(sessionElement) {
  const titleElement = sessionElement.querySelector(".session-title");
  if (titleElement) {
    const sessionId = titleElement.dataset.sessionId;

    titleElement.addEventListener("focus", function () {
      this.dataset.originalValue = this.textContent;

      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(this);
      selection.removeAllRanges();
      selection.addRange(range);
    });

    titleElement.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        this.blur();
      }

      if (e.key === "Escape") {
        this.textContent = this.dataset.originalValue;
        this.blur();
      }
    });

    titleElement.addEventListener("blur", function () {
      const newName = this.textContent.trim();
      if (newName && newName !== this.dataset.originalValue) {
        saveSessionName(sessionId, newName);
      } else if (!newName) {
        this.textContent = this.dataset.originalValue;
      }
    });
  }

  const showTabsBtn = sessionElement.querySelector(".show-tabs-btn");
  if (showTabsBtn) {
    showTabsBtn.addEventListener("click", () => {
      const tabListContainer = sessionElement.querySelector(
        ".tab-list-container",
      );
      if (tabListContainer) {
        if (tabListContainer.style.display === "none") {
          tabListContainer.style.display = "block";
          showTabsBtn.classList.add("active");
          showTabsBtn.title = "Hide Tabs";
        } else {
          tabListContainer.style.display = "none";
          showTabsBtn.classList.remove("active");
          showTabsBtn.title = "Show Tabs";
        }
      }
    });
  }

  const restoreBtn = sessionElement.querySelector(".restore-btn");
  if (restoreBtn) {
    restoreBtn.addEventListener("click", async () => {
      const sessionId = restoreBtn.dataset.sessionId;
      const { sessions = [] } = await browser.storage.local.get("sessions");
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        await openInCurrentWindow(session);
      }
    });
  }

  const newWindowBtn = sessionElement.querySelector(".new-window-btn");
  if (newWindowBtn) {
    newWindowBtn.addEventListener("click", async () => {
      const sessionId = newWindowBtn.dataset.sessionId;
      const { sessions = [] } = await browser.storage.local.get("sessions");
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        await openInNewWindow(session);
      }
    });
  }

  const deleteBtn = sessionElement.querySelector(".delete-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      const sessionId = deleteBtn.dataset.sessionId;
      moveToTrash(sessionId);
    });
  }
}

async function deleteForever(sessionId) {
  try {
    const sessionElement = document.querySelector(
      `.delete-forever-btn[data-session-id="${sessionId}"]`,
    ).closest(".session-item");
    if (sessionElement) {
      sessionElement.remove();
    }

    browser.runtime.sendMessage({
      action: "deleteForever",
      sessionId: sessionId,
    });
  } catch (error) {
    console.error(`Error permanently deleting session ${sessionId}:`, error);

    displayTrashSessions();
  }
}

async function emptyTrash() {
  try {
    await browser.storage.local.set({ trashSessions: [] });

    displayTrashSessions();
  } catch (error) {
    console.error("Error emptying trash:", error);
  }
}

async function displaySessions() {
  try {
    const { sessions = [] } = await browser.storage.local.get("sessions");
    sessionsContainer.innerHTML = "";

    sessions.forEach((session) => {
      const sessionElement = h("div", {
        className: "session-item",
        draggable: true,
        dataset: { sessionId: session.id },
      });

      const titleContainer = h("div", { className: "title-container" }, [
        h("span", {
          className: "session-title",
          contentEditable: "true",
          dataset: { sessionId: session.id },
        }, session.name),
        h(
          "span",
          { className: "session-date" },
          formatDate(session.create_time),
        ),
      ]);

      const sessionActions = h("div", { className: "session-actions" }, [
        h("button", {
          className: "show-tabs-btn",
          title: "Show Tabs",
          dataset: { sessionId: session.id },
        }, "▼"),
        h("button", {
          className: "restore-btn",
          title: "Open Here",
          dataset: { sessionId: session.id },
        }, "⊕"),
        h("button", {
          className: "new-window-btn",
          title: "New Window",
          dataset: { sessionId: session.id },
        }, "⧉"),
        h("button", {
          className: "delete-btn",
          title: "Move to Trash",
          dataset: { sessionId: session.id },
        }, "🗑︎"),
      ]);

      const sessionInfo = h("div", { className: "session-info" }, [
        titleContainer,
        sessionActions,
      ]);

      sessionElement.appendChild(sessionInfo);

      const tabListContainer = h("div", {
        className: "tab-list-container",
        style: { display: "none" },
      });

      const dateElement = h(
        "div",
        { className: "session-date" },
        `Created: ${formatDate(session.create_time)}`,
      );
      tabListContainer.appendChild(dateElement);

      const tabListElement = h("div", { className: "tab-list" });

      session.tabs.forEach((tab) => {
        const tabElement = h("div", { className: "tab-item" }, [
          h("span", { className: "tab-title" }, tab.title),
          h("span", { className: "tab-url" }, tab.url),
        ]);

        tabListElement.appendChild(tabElement);
      });

      tabListContainer.appendChild(tabListElement);
      sessionElement.appendChild(tabListContainer);
      sessionsContainer.appendChild(sessionElement);
    });

    document.querySelectorAll("#sessions .session-item").forEach(
      (sessionElement) => {
        addSessionRowClickHandling(sessionElement);
      },
    );

    addDragAndDropListeners();

    document.querySelectorAll("#sessions .session-title").forEach(
      (titleElement) => {
        const sessionId = titleElement.dataset.sessionId;

        titleElement.addEventListener("focus", function () {
          this.dataset.originalValue = this.textContent;
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(this);
          selection.removeAllRanges();
          selection.addRange(range);
        });

        titleElement.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            this.blur();
          }
          if (e.key === "Escape") {
            this.textContent = this.dataset.originalValue;
            this.blur();
          }
        });

        titleElement.addEventListener("blur", function () {
          const newName = this.textContent.trim();
          if (newName && newName !== this.dataset.originalValue) {
            saveSessionName(sessionId, newName);
          } else if (!newName) {
            this.textContent = this.dataset.originalValue;
          }
        });
      },
    );

    document.querySelectorAll("#sessions .show-tabs-btn").forEach(
      (button) => {
        button.addEventListener("click", () => {
          const sessionElement = button.closest(".session-item");
          const tabListContainer = sessionElement.querySelector(
            ".tab-list-container",
          );

          if (tabListContainer.style.display === "none") {
            tabListContainer.style.display = "block";
            button.classList.add("active");
            button.title = "Hide Tabs";
          } else {
            tabListContainer.style.display = "none";
            button.classList.remove("active");
            button.title = "Show Tabs";
          }
        });
      },
    );

    document.querySelectorAll("#sessions .restore-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const sessionId = button.dataset.sessionId;
        const { sessions = [] } = await browser.storage.local.get("sessions");
        const session = sessions.find((s) => s.id === sessionId);

        if (session) {
          await openInCurrentWindow(session);
        }
      });
    });

    document.querySelectorAll("#sessions .new-window-btn").forEach(
      (button) => {
        button.addEventListener("click", async () => {
          const sessionId = button.dataset.sessionId;
          const { sessions = [] } = await browser.storage.local.get(
            "sessions",
          );
          const session = sessions.find((s) => s.id === sessionId);

          if (session) {
            await openInNewWindow(session);
          }
        });
      },
    );

    document.querySelectorAll("#sessions .delete-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const sessionId = button.dataset.sessionId;
        moveToTrash(sessionId);
      });
    });
  } catch (error) {
    console.error("Error displaying sessions:", error);
  }
}

async function displayTrashSessions() {
  try {
    const { trashSessions = [] } = await browser.storage.local.get(
      "trashSessions",
    );
    trashSessionsContainer.innerHTML = "";

    trashSessions.forEach((session) => {
      const sessionElement = h("div", {
        className: "session-item",
        draggable: true,
        dataset: { sessionId: session.id },
      });

      const titleContainer = h("div", { className: "title-container" }, [
        h("span", { className: "session-title" }, session.name),
        h(
          "span",
          { className: "session-date" },
          formatDate(session.create_time),
        ),
      ]);

      const sessionActions = h("div", { className: "session-actions" }, [
        h("button", {
          className: "show-tabs-btn",
          title: "Show Tabs",
          dataset: { sessionId: session.id },
        }, "▼"),
        h("button", {
          className: "undelete-btn",
          title: "Restore",
          dataset: { sessionId: session.id },
        }, "♻︎"),
        h("button", {
          className: "delete-forever-btn",
          title: "Delete Forever",
          dataset: { sessionId: session.id },
        }, "🗑︎"),
      ]);

      const sessionInfo = h("div", { className: "session-info" }, [
        titleContainer,
        sessionActions,
      ]);

      sessionElement.appendChild(sessionInfo);

      const tabListContainer = h("div", {
        className: "tab-list-container",
        style: { display: "none" },
      });

      const dateElement = h(
        "div",
        { className: "session-date" },
        `Created: ${formatDate(session.create_time)}${
          session.delete_time
            ? " | Deleted: " + formatDate(session.delete_time)
            : ""
        }`,
      );
      tabListContainer.appendChild(dateElement);

      const tabListElement = h("div", { className: "tab-list" });

      session.tabs.forEach((tab) => {
        const tabElement = h("div", { className: "tab-item" }, [
          h("span", { className: "tab-title" }, tab.title),
          h("span", { className: "tab-url" }, tab.url),
        ]);

        tabListElement.appendChild(tabElement);
      });

      tabListContainer.appendChild(tabListElement);
      sessionElement.appendChild(tabListContainer);
      trashSessionsContainer.appendChild(sessionElement);
    });

    document.querySelectorAll("#trashSessions .session-item").forEach(
      (sessionElement) => {
        addSessionRowClickHandling(sessionElement);
      },
    );

    addTrashDragAndDropListeners();

    document.querySelectorAll("#trashSessions .show-tabs-btn").forEach(
      (button) => {
        button.addEventListener("click", () => {
          const sessionElement = button.closest(".session-item");
          const tabListContainer = sessionElement.querySelector(
            ".tab-list-container",
          );

          if (tabListContainer.style.display === "none") {
            tabListContainer.style.display = "block";
            button.classList.add("active");
            button.title = "Hide Tabs";
          } else {
            tabListContainer.style.display = "none";
            button.classList.remove("active");
            button.title = "Show Tabs";
          }
        });
      },
    );

    document.querySelectorAll("#trashSessions .undelete-btn").forEach(
      (button) => {
        button.addEventListener("click", () => {
          const sessionId = button.dataset.sessionId;
          restoreFromTrash(sessionId);
        });
      },
    );

    document.querySelectorAll("#trashSessions .delete-forever-btn").forEach(
      (button) => {
        button.addEventListener("click", () => {
          const sessionId = button.dataset.sessionId;
          deleteForever(sessionId);
        });
      },
    );
  } catch (error) {
    console.error("Error displaying trash sessions:", error);
  }
}

async function loadDataView() {
  try {
    const { sessions = [], trashSessions = [] } = await browser.storage.local
      .get([
        "sessions",
        "trashSessions",
      ]);

    const manifestData = browser.runtime.getManifest();
    const extensionVersion = manifestData.version;

    const configData = {
      extension_version: extensionVersion,
      create_time: Date.now(),
      sessions,
      trashSessions,
    };

    const jsonString = JSON.stringify(configData, null, 2);

    originalDataJSON = jsonString;

    dataTextarea.value = jsonString;

    revertDataBtn.disabled = true;

    hideStatusMessage();
  } catch (error) {
    console.error("Error loading data:", error);
    showStatusMessage("Failed to load data. Please try again.", "error");
  }
}

async function saveDataView() {
  try {
    const jsonString = dataTextarea.value;
    let configData;

    try {
      configData = JSON.parse(jsonString);
    } catch (parseError) {
      showStatusMessage(
        "Invalid JSON format. Please check your syntax.",
        "error",
      );
      return false;
    }

    if (!configData.sessions || !configData.trashSessions) {
      showStatusMessage(
        "Invalid data structure. Missing 'sessions' or 'trashSessions' properties.",
        "error",
      );
      return false;
    }

    if (
      !Array.isArray(configData.sessions) ||
      !Array.isArray(configData.trashSessions)
    ) {
      showStatusMessage(
        "Invalid data structure. 'sessions' and 'trashSessions' must be arrays.",
        "error",
      );
      return false;
    }

    for (
      const session of [...configData.sessions, ...configData.trashSessions]
    ) {
      if (
        !session.id || !session.name || !session.create_time ||
        !Array.isArray(session.tabs)
      ) {
        showStatusMessage(
          "Invalid session format. Each session must have id, name, create_time, and tabs array.",
          "error",
        );
        return false;
      }

      if (typeof session.create_time !== "number") {
        showStatusMessage(
          "Invalid creation date format. All dates must be numeric timestamps.",
          "error",
        );
        return false;
      }

      if (session.delete_time && typeof session.delete_time !== "number") {
        showStatusMessage(
          "Invalid deleted date format. All dates must be numeric timestamps.",
          "error",
        );
        return false;
      }

      for (const tab of session.tabs) {
        if (!tab.url || !tab.title) {
          showStatusMessage(
            "Invalid tab format. Each tab must have url and title properties.",
            "error",
          );
          return false;
        }
      }
    }

    await browser.storage.local.set({
      sessions: configData.sessions,
      trashSessions: configData.trashSessions,
    });

    const manifestData = browser.runtime.getManifest();
    const extensionVersion = manifestData.version;

    configData.create_time = Date.now();
    configData.extension_version = extensionVersion;
    dataTextarea.value = JSON.stringify(configData, null, 2);

    displaySessions();
    displayTrashSessions();

    showStatusMessage("Changes saved successfully!", "success");
    return true;
  } catch (error) {
    console.error("Error saving data:", error);
    showStatusMessage("Failed to save data: " + error.message, "error");
    return false;
  }
}

function showStatusMessage(message, type) {
  dataStatusMessage.textContent = message;
  dataStatusMessage.className = "data-status-message " + type;

  if (type === "success") {
    setTimeout(() => {
      if (dataStatusMessage.classList.contains("success")) {
        hideStatusMessage();
      }
    }, 3000);
  }
}

function hideStatusMessage() {
  dataStatusMessage.textContent = "";
  dataStatusMessage.className = "data-status-message";
}

dataTextarea.addEventListener("input", () => {
  if (dataStatusMessage.classList.contains("success")) {
    hideStatusMessage();
  }

  if (dataTextarea.value !== originalDataJSON) {
    revertDataBtn.disabled = false;
  } else {
    revertDataBtn.disabled = true;
  }
});

let currentView = "main";

function switchView(viewName) {
  currentView = viewName;

  mainView.style.display = "none";
  trashView.style.display = "none";
  exportView.style.display = "none";

  sessionTab.classList.remove("active");
  trashTab.classList.remove("active");
  dataTab.classList.remove("active");

  if (viewName === "main") {
    mainView.style.display = "flex";
    sessionTab.classList.add("active");
  } else if (viewName === "trash") {
    trashView.style.display = "flex";
    trashTab.classList.add("active");

    displayTrashSessions();

    setupEmptyTrashClickHandler();
  } else if (viewName === "data") {
    exportView.style.display = "flex";
    dataTab.classList.add("active");

    loadDataView();
  }
}

sessionTab.addEventListener("click", () => {
  switchView("main");
});

trashTab.addEventListener("click", () => {
  switchView("trash");
});

dataTab.addEventListener("click", () => {
  switchView("data");
});

copyJsonBtn.addEventListener("click", () => {
  dataTextarea.select();
  document.execCommand("copy");

  copyJsonBtn.innerHTML = "✓︎ Copied!";
  setTimeout(() => {
    copyJsonBtn.innerHTML = "📋︎ Copy";
  }, 1500);
});

saveDataBtn.addEventListener("click", () => {
  if (saveDataView()) {
    originalDataJSON = dataTextarea.value;
    revertDataBtn.disabled = true;
  }
});

revertDataBtn.addEventListener("click", () => {
  dataTextarea.value = originalDataJSON;
  revertDataBtn.disabled = true;
  hideStatusMessage();
  showStatusMessage("Changes reverted to last saved state.", "success");
});

function setupEmptyTrashClickHandler() {
  const emptyTrashItem = document.querySelector("#trashView .draft-session");
  if (emptyTrashItem) {
    const newItem = emptyTrashItem.cloneNode(true);
    emptyTrashItem.parentNode.replaceChild(newItem, emptyTrashItem);

    newItem.addEventListener("click", (event) => {
      if (
        event.target.id === "emptyTrashBtn" ||
        event.target.closest("#emptyTrashBtn")
      ) {
        return;
      }
      emptyTrash();
    });

    const emptyTrashBtn = newItem.querySelector("#emptyTrashBtn");
    if (emptyTrashBtn) {
      emptyTrashBtn.addEventListener("click", emptyTrash);
    }
  }
}

emptyTrashBtn.addEventListener("click", () => {
  emptyTrash();
});

function addDragAndDropListeners() {
  const sessionItems = document.querySelectorAll("#sessions .session-item");

  let draggedItem = null;

  sessionItems.forEach((item) => {
    if (item.closest("#draftSession")) return;

    item.addEventListener("dragstart", (e) => {
      draggedItem = item;
      setTimeout(() => {
        item.classList.add("dragging");
      }, 0);

      e.dataTransfer.setData("text/plain", item.dataset.sessionId);
      e.dataTransfer.effectAllowed = "move";
    });

    item.addEventListener("dragend", () => {
      draggedItem = null;
      item.classList.remove("dragging");

      document.querySelectorAll(".drag-over").forEach((el) => {
        el.classList.remove("drag-over");
      });
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (item === draggedItem) return;

      const bounding = item.getBoundingClientRect();
      const offset = bounding.y + (bounding.height / 2);

      if (e.clientY - offset > 0) {
        item.classList.add("drag-over");
      } else {
        item.classList.add("drag-over");
      }
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });

    item.addEventListener("drop", async (e) => {
      e.preventDefault();

      if (!draggedItem || item === draggedItem) return;

      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId) return;

      const sessionsContainer = document.getElementById("sessions");
      const items = Array.from(
        sessionsContainer.querySelectorAll(
          ".session-item:not(#draftSession)",
        ),
      );

      const fromIndex = items.findIndex((el) =>
        el.dataset.sessionId === draggedId
      );
      const toIndex = items.findIndex((el) => el === item);

      if (fromIndex !== -1 && toIndex !== -1) {
        if (fromIndex < toIndex) {
          sessionsContainer.insertBefore(draggedItem, item.nextSibling);
        } else {
          sessionsContainer.insertBefore(draggedItem, item);
        }

        await reorderSessionsInStorage(fromIndex, toIndex);
      }

      item.classList.remove("drag-over");
    });
  });
}

async function reorderSessionsInStorage(fromIndex, toIndex) {
  try {
    const { sessions = [] } = await browser.storage.local.get("sessions");

    const [movedItem] = sessions.splice(fromIndex, 1);
    sessions.splice(toIndex, 0, movedItem);

    await browser.storage.local.set({ sessions });
  } catch (error) {
    console.error("Error reordering sessions:", error);
  }
}

function addTrashDragAndDropListeners() {
  const sessionItems = document.querySelectorAll(
    "#trashSessions .session-item",
  );

  let draggedItem = null;

  sessionItems.forEach((item) => {
    if (item.closest(".draft-session")) return;

    item.addEventListener("dragstart", (e) => {
      draggedItem = item;
      setTimeout(() => {
        item.classList.add("dragging");
      }, 0);

      e.dataTransfer.setData("text/plain", item.dataset.sessionId);
      e.dataTransfer.effectAllowed = "move";
    });

    item.addEventListener("dragend", () => {
      draggedItem = null;
      item.classList.remove("dragging");

      document.querySelectorAll(".drag-over").forEach((el) => {
        el.classList.remove("drag-over");
      });
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (item === draggedItem) return;

      const bounding = item.getBoundingClientRect();
      const offset = bounding.y + (bounding.height / 2);

      if (e.clientY - offset > 0) {
        item.classList.add("drag-over");
      } else {
        item.classList.add("drag-over");
      }
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });

    item.addEventListener("drop", async (e) => {
      e.preventDefault();

      if (!draggedItem || item === draggedItem) return;

      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId) return;

      const trashContainer = document.getElementById("trashSessions");
      const items = Array.from(
        trashContainer.querySelectorAll(".session-item"),
      );

      const fromIndex = items.findIndex((el) =>
        el.dataset.sessionId === draggedId
      );
      const toIndex = items.findIndex((el) => el === item);

      if (fromIndex !== -1 && toIndex !== -1) {
        if (fromIndex < toIndex) {
          trashContainer.insertBefore(draggedItem, item.nextSibling);
        } else {
          trashContainer.insertBefore(draggedItem, item);
        }

        await reorderTrashSessionsInStorage(fromIndex, toIndex);
      }

      item.classList.remove("drag-over");
    });
  });
}

async function reorderTrashSessionsInStorage(fromIndex, toIndex) {
  try {
    const { trashSessions = [] } = await browser.storage.local.get(
      "trashSessions",
    );

    const [movedItem] = trashSessions.splice(fromIndex, 1);
    trashSessions.splice(toIndex, 0, movedItem);

    await browser.storage.local.set({ trashSessions });
  } catch (error) {
    console.error("Error reordering trash sessions:", error);
  }
}

displaySessions();
switchView("main");
