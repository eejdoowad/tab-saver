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

    // Add the new session to the UI immediately
    addSessionToUI(session);

    const { sessions = [] } = await browser.storage.local.get("sessions");
    sessions.unshift(session);

    await browser.storage.local.set({
      sessions,
      sessionCounter: newCounter,
    });

    // No need to call displaySessions() here as we've already added the session to the UI
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

/**
 * Saves a new name for a session
 * @param {string} sessionId - The ID of the session to rename
 * @param {string} newName - The new name for the session
 */
async function saveSessionName(sessionId, newName) {
  try {
    // Check if this is a regular session or trash session
    const { sessions = [], trashSessions = [] } = await browser.storage.local
      .get([
        "sessions",
        "trashSessions",
      ]);

    let inSessions = false;
    let inTrash = false;

    // Update in regular sessions if found
    const updatedSessions = sessions.map((session) => {
      if (session.id === sessionId) {
        inSessions = true;
        return { ...session, name: newName };
      }
      return session;
    });

    // Update in trash sessions if found
    const updatedTrashSessions = trashSessions.map((session) => {
      if (session.id === sessionId) {
        inTrash = true;
        return { ...session, name: newName };
      }
      return session;
    });

    // Save the updates based on where the session was found
    if (inSessions) {
      await browser.storage.local.set({ sessions: updatedSessions });

      // Update the session name in UI
      const titleElement = document.querySelector(
        `#sessions .session-title[data-session-id="${sessionId}"]`,
      );
      if (titleElement) {
        titleElement.textContent = newName;
      }
    }

    if (inTrash) {
      await browser.storage.local.set({ trashSessions: updatedTrashSessions });

      // Update the session name in UI
      const titleElement = document.querySelector(
        `#trashSessions .session-title[data-session-id="${sessionId}"]`,
      );
      if (titleElement) {
        titleElement.textContent = newName;
      }
    }

    // Optionally, update the export textarea if it's open
    if (currentView === "export") {
      updateExportTextarea();
    }
  } catch (error) {
    console.error("Error saving session name:", error);
  }
}

async function moveToTrash(sessionId) {
  try {
    // Find the session element in a safer way
    const sessionElement = document.querySelector(
      `.session-item[data-session-id="${sessionId}"]`,
    );

    if (sessionElement && !sessionElement.closest("#trashSessions")) {
      sessionElement.remove();
    }

    // Send a message to the background script to handle the actual data moving
    browser.runtime.sendMessage({
      action: "moveToTrash",
      sessionId: sessionId,
    });

    // Update the trash view since we're adding an item to it
    displayTrashSessions();
  } catch (error) {
    console.error(`Error moving session ${sessionId} to trash:`, error);
    // Refresh both views in case of error
    displaySessions();
    displayTrashSessions();
  }
}

async function restoreFromTrash(sessionId) {
  try {
    // Find the session element in a safer way
    const sessionElement = document.querySelector(
      `.session-item[data-session-id="${sessionId}"]`,
    );

    if (sessionElement && sessionElement.closest("#trashSessions")) {
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
      // Add the restored session to the UI immediately
      addSessionToUI(restoredSession);

      // Send a message to the background script to handle the actual data moving
      browser.runtime.sendMessage({
        action: "restoreFromTrash",
        sessionId: sessionId,
      });
    } else {
      console.error(
        `Session ${sessionId} not found in trash for immediate restoration`,
      );
      // If we can't find it in the local trash data, just ask the background to restore
      // and then refresh both views
      browser.runtime.sendMessage({
        action: "restoreFromTrash",
        sessionId: sessionId,
      });
      displaySessions();
    }
  } catch (error) {
    console.error(`Error restoring session ${sessionId} from trash:`, error);
    // Refresh both views in case of error
    displaySessions();
    displayTrashSessions();
  }
}

function getClickTarget(event, sessionElement) {
  // In the new UI, we don't need this complex detection
  // The entire row is clickable by default (will open session in current window)
  // And buttons handle their own click events with stopPropagation
  return sessionElement;
}

function addSessionRowClickHandling(sessionElement) {
  // This function is now a no-op since we handle clicks directly in displaySessions
  // We keep it for backward compatibility with other code that calls it
  return;
}

function addDblClickTitleListener(titleElement) {
  if (!titleElement) return;

  titleElement.addEventListener("dblclick", function (e) {
    e.stopPropagation();

    // If we're not already in edit mode, enter it
    const sessionElement = this.closest(".session-item");
    if (!sessionElement.classList.contains("editing")) {
      const editBtn = sessionElement.querySelector(".edit-btn");

      // Determine if this is a regular session or trash session
      const isTrashSession = sessionElement.closest("#trashSessions");

      if (isTrashSession) {
        // Handle trash session editing
        if (editBtn) {
          toggleTrashEditMode(sessionElement, true);
          editBtn.textContent = "✕";
          editBtn.title = "Close";
        }
      } else {
        // Handle regular session editing
        if (editBtn) {
          toggleEditMode(sessionElement, true);
          editBtn.textContent = "✕";
          editBtn.title = "Close";
        }
      }
    }

    // Make the title editable and focus it
    this.contentEditable = true;
    this.focus();

    // Select all text in the title
    const range = document.createRange();
    range.selectNodeContents(this);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
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
      dataset: { sessionId: session.id },
      contentEditable: false,
    }, session.name),
    h("span", { className: "session-date" }, formatDate(session.create_time)),
  ]);

  const sessionActions = h("div", { className: "session-actions" }, [
    // New window button (visible in normal mode)
    h("button", {
      className: "new-window-btn",
      title: "New Window",
      dataset: { sessionId: session.id },
    }, "⧉"),

    // Edit/close button
    h("button", {
      className: "edit-btn",
      title: "Edit",
      dataset: { sessionId: session.id },
    }, "⋮"),
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

  // Add delete button in edit actions container
  const editActionsContainer = h("div", {
    className: "edit-actions-container",
    style: { display: "none" },
  });

  const deleteButtonContainer = h("div", {
    className: "delete-button-container",
  }, [
    h("button", {
      className: "delete-btn",
      title: "Move to Trash",
      dataset: { sessionId: session.id },
    }, "🗑︎ Move to Trash"),
  ]);

  editActionsContainer.appendChild(deleteButtonContainer);
  tabListContainer.appendChild(editActionsContainer);

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

  sessionElement.addEventListener("click", async function (e) {
    if (
      e.target.tagName === "BUTTON" ||
      e.target.closest("button") ||
      e.target.closest(".tab-list-container") ||
      e.target.closest(".tab-list") ||
      e.target.tagName === "INPUT" ||
      e.target.isContentEditable ||
      this.classList.contains("editing")
    ) {
      return;
    }

    const sessionId = this.dataset.sessionId;
    const { sessions = [] } = await browser.storage.local.get("sessions");
    const session = sessions.find((s) => s.id === sessionId);

    if (session) {
      await openInCurrentWindow(session);
    }
  });

  const newWindowBtn = sessionElement.querySelector(".new-window-btn");
  if (newWindowBtn) {
    newWindowBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

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
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();

      const sessionId = deleteBtn.dataset.sessionId;
      moveToTrash(sessionId);
    });
  }

  const editBtn = sessionElement.querySelector(".edit-btn");
  if (editBtn) {
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();

      if (sessionElement.classList.contains("editing")) {
        toggleEditMode(sessionElement, false);
        editBtn.textContent = "⋮";
        editBtn.title = "Edit";

        // Show new window button when exiting edit mode
        const newWindowBtn = sessionElement.querySelector(".new-window-btn");
        if (newWindowBtn) {
          newWindowBtn.style.display = "inline-flex";
        }
      } else {
        toggleEditMode(sessionElement, true);
        editBtn.textContent = "✕";
        editBtn.title = "Close";

        // Hide new window button when entering edit mode
        const newWindowBtn = sessionElement.querySelector(".new-window-btn");
        if (newWindowBtn) {
          newWindowBtn.style.display = "none";
        }

        // Focus the title for immediate editing
        const titleElement = sessionElement.querySelector(".session-title");
        if (titleElement) {
          titleElement.contentEditable = true;
          titleElement.focus();

          // Select all text for easy editing
          const range = document.createRange();
          range.selectNodeContents(titleElement);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });
  }

  const titleElement = sessionElement.querySelector(".session-title");
  if (titleElement) {
    const sessionId = titleElement.dataset.sessionId;

    // Add double-click to edit functionality
    addDblClickTitleListener(titleElement);

    titleElement.addEventListener("blur", function () {
      if (this.isContentEditable) {
        const newName = this.textContent.trim();
        if (newName) {
          saveSessionName(sessionId, newName);
        } else {
          // If empty, restore original name
          this.textContent = session.name;
        }
        this.contentEditable = false;
      }
    });

    titleElement.addEventListener("keydown", function (e) {
      if (!this.isContentEditable) return;

      if (e.key === "Enter") {
        e.preventDefault();
        this.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.textContent = session.name;
        this.blur();

        const sessionElement = this.closest(".session-item");
        const editBtn = sessionElement.querySelector(".edit-btn");
        toggleEditMode(sessionElement, false);

        editBtn.textContent = "⋮";
        editBtn.title = "Edit";
      }
    });
  }

  addDragAndDropListeners();
}

function toggleEditMode(sessionElement, isEditing) {
  const tabListContainer = sessionElement.querySelector(".tab-list-container");
  const editActionsContainer = sessionElement.querySelector(
    ".edit-actions-container",
  );
  const titleElement = sessionElement.querySelector(".session-title");

  if (isEditing) {
    sessionElement.classList.add("editing");
    tabListContainer.style.display = "block";
    if (editActionsContainer) {
      editActionsContainer.style.display = "block";
    }

    // Hide new window button
    const newWindowBtn = sessionElement.querySelector(".new-window-btn");
    if (newWindowBtn) newWindowBtn.style.display = "none";

    // Make the title directly editable
    if (titleElement) {
      titleElement.contentEditable = "true";
      setTimeout(() => {
        titleElement.focus();

        // Select all text in the title
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }, 0);
    }
  } else {
    sessionElement.classList.remove("editing");
    tabListContainer.style.display = "none";
    if (editActionsContainer) {
      editActionsContainer.style.display = "none";
    }

    // Show new window button
    const newWindowBtn = sessionElement.querySelector(".new-window-btn");
    if (newWindowBtn) newWindowBtn.style.display = "inline-flex";

    // Make title non-editable
    if (titleElement) {
      titleElement.contentEditable = "false";
    }
  }
}

async function displaySessions() {
  try {
    const { sessions = [] } = await browser.storage.local.get("sessions");
    sessionsContainer.innerHTML = "";

    sessions.forEach((session) => {
      addSessionToUI(session);
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
        h("span", {
          className: "session-title",
          contentEditable: false,
          dataset: { sessionId: session.id },
        }, session.name),
        h(
          "span",
          { className: "session-date" },
          formatDate(session.create_time),
        ),
      ]);

      const sessionActions = h("div", { className: "session-actions" }, [
        // Restore button (visible in normal mode)
        h("button", {
          className: "undelete-btn",
          title: "Restore",
          dataset: { sessionId: session.id },
        }, "♻︎"),

        // Quick delete button (visible in edit mode)
        h("button", {
          className: "quick-delete-forever-btn",
          title: "Delete Forever",
          dataset: { sessionId: session.id },
        }, "🗑️"),

        // Edit button
        h("button", {
          className: "edit-btn",
          title: "Edit",
          dataset: { sessionId: session.id },
        }, "⋮"),
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

      const editActionsContainer = h("div", {
        className: "edit-actions-container",
        style: { display: "none" },
      });

      const deleteButtonContainer = h("div", {
        className: "delete-button-container",
      }, [
        h("button", {
          className: "delete-forever-btn",
          title: "Delete Forever",
          dataset: { sessionId: session.id },
        }, "🗑︎ Delete Forever"),
      ]);

      editActionsContainer.appendChild(deleteButtonContainer);

      tabListContainer.appendChild(editActionsContainer);
      sessionElement.appendChild(tabListContainer);
      trashSessionsContainer.appendChild(sessionElement);
    });

    document.querySelectorAll("#trashSessions .session-item").forEach(
      (sessionElement) => {
        addTrashSessionRowClickHandling(sessionElement);
      },
    );

    addTrashDragAndDropListeners();

    // Add click listener for quick delete buttons in trash view
    document.querySelectorAll("#trashSessions .quick-delete-forever-btn")
      .forEach(
        (button) => {
          button.addEventListener("click", (e) => {
            e.stopPropagation();

            const sessionId = button.dataset.sessionId;
            deleteForever(sessionId);
          });
        },
      );

    document.querySelectorAll("#trashSessions .edit-btn").forEach(
      (button) => {
        button.addEventListener("click", (e) => {
          e.stopPropagation();

          const sessionElement = button.closest(".session-item");
          const undeleteBtn = sessionElement.querySelector(".undelete-btn");
          const quickDeleteBtn = sessionElement.querySelector(
            ".quick-delete-forever-btn",
          );

          if (sessionElement.classList.contains("editing")) {
            toggleTrashEditMode(sessionElement, false);
            button.textContent = "⋮";
            button.title = "Edit";

            // Show restore button, hide quick delete button
            if (undeleteBtn) undeleteBtn.style.display = "inline-flex";
            if (quickDeleteBtn) quickDeleteBtn.style.display = "none";
          } else {
            toggleTrashEditMode(sessionElement, true);
            button.textContent = "✕";
            button.title = "Close";

            // Focus the title for immediate editing
            const titleElement = sessionElement.querySelector(".session-title");
            if (titleElement) {
              titleElement.contentEditable = true;
              titleElement.focus();

              // Select all text for easy editing
              const range = document.createRange();
              range.selectNodeContents(titleElement);
              const selection = window.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
            }
          }
        });
      },
    );

    // Add title editing to trash sessions
    document.querySelectorAll("#trashSessions .session-title").forEach(
      (titleElement) => {
        const sessionId = titleElement.dataset.sessionId;

        // Add double-click to edit functionality
        addDblClickTitleListener(titleElement);

        titleElement.addEventListener("blur", function () {
          if (this.isContentEditable) {
            const newName = this.textContent.trim();
            if (newName) {
              saveSessionName(sessionId, newName);
            } else {
              // Get the original name from trash sessions
              browser.storage.local.get("trashSessions").then(
                ({ trashSessions = [] }) => {
                  const session = trashSessions.find((s) => s.id === sessionId);
                  if (session) {
                    this.textContent = session.name;
                  }
                },
              );
            }
            this.contentEditable = false;
          }
        });

        titleElement.addEventListener("keydown", function (e) {
          if (!this.isContentEditable) return;

          if (e.key === "Enter") {
            e.preventDefault();
            this.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            browser.storage.local.get("trashSessions").then(
              ({ trashSessions = [] }) => {
                const session = trashSessions.find((s) => s.id === sessionId);
                if (session) {
                  this.textContent = session.name;
                }
                this.blur();

                const sessionElement = this.closest(".session-item");
                const editBtn = sessionElement.querySelector(".edit-btn");
                toggleTrashEditMode(sessionElement, false);

                // Restore original button visibility
                const undeleteBtn = sessionElement.querySelector(
                  ".undelete-btn",
                );
                const quickDeleteBtn = sessionElement.querySelector(
                  ".quick-delete-forever-btn",
                );
                if (undeleteBtn) undeleteBtn.style.display = "inline-flex";
                if (quickDeleteBtn) quickDeleteBtn.style.display = "none";

                editBtn.textContent = "⋮";
                editBtn.title = "Edit";
              },
            );
          }
        });
      },
    );

    document.querySelectorAll("#trashSessions .undelete-btn").forEach(
      (button) => {
        button.addEventListener("click", (e) => {
          e.stopPropagation();

          const sessionId = button.dataset.sessionId;
          restoreFromTrash(sessionId);
        });
      },
    );

    document.querySelectorAll("#trashSessions .delete-forever-btn").forEach(
      (button) => {
        button.addEventListener("click", (e) => {
          e.stopPropagation();

          const sessionId = button.dataset.sessionId;
          deleteForever(sessionId);
        });
      },
    );
  } catch (error) {
    console.error("Error displaying trash sessions:", error);
  }
}

function toggleTrashEditMode(sessionElement, isEditing) {
  const tabListContainer = sessionElement.querySelector(".tab-list-container");
  const editActionsContainer = sessionElement.querySelector(
    ".edit-actions-container",
  );
  const titleElement = sessionElement.querySelector(".session-title");

  if (isEditing) {
    sessionElement.classList.add("editing");
    tabListContainer.style.display = "block";
    editActionsContainer.style.display = "block";

    // Make the title directly editable
    if (titleElement) {
      titleElement.contentEditable = "true";
      setTimeout(() => {
        titleElement.focus();

        // Select all text in the title
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }, 0);
    }
  } else {
    sessionElement.classList.remove("editing");
    tabListContainer.style.display = "none";
    editActionsContainer.style.display = "none";

    // Make title non-editable
    if (titleElement) {
      titleElement.contentEditable = "false";
    }
  }
}

function addTrashSessionRowClickHandling(sessionElement) {
  if (sessionElement.closest(".draft-session")) return;

  sessionElement.addEventListener("click", function (e) {
    if (
      e.target.tagName === "BUTTON" ||
      e.target.closest("button") ||
      e.target.closest(".tab-list-container") ||
      e.target.closest(".tab-list") ||
      e.target.tagName === "INPUT" ||
      this.classList.contains("editing")
    ) {
      return;
    }

    // Clicking on a trash session doesn't do anything by default
    // Could add a preview mode in the future
  });
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
  const sessionsContainer = document.getElementById("sessions");
  let draggedItem = null;
  let initialPosition = null;
  let hasMoved = false;

  // Check if there are no items to set up dragging for
  if (sessionItems.length <= 1) return;

  sessionItems.forEach((item) => {
    if (item.closest("#draftSession")) return;

    // Set up dragstart event
    item.addEventListener("dragstart", (e) => {
      draggedItem = item;
      initialPosition = { x: e.clientX, y: e.clientY };
      hasMoved = false;

      setTimeout(() => {
        item.classList.add("dragging");
      }, 0);

      e.dataTransfer.setData("text/plain", item.dataset.sessionId);
      e.dataTransfer.effectAllowed = "move";
    });

    // Set up dragend event
    item.addEventListener("dragend", () => {
      draggedItem = null;
      initialPosition = null;
      hasMoved = false;
      item.classList.remove("dragging");

      document.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach(
        (el) => {
          el.classList.remove("drag-over-top");
          el.classList.remove("drag-over-bottom");
        },
      );
    });

    // Set up dragover event
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (item === draggedItem) return;

      // Check if the user has moved the cursor enough from the starting position
      if (initialPosition) {
        const moveDistance = Math.sqrt(
          Math.pow(e.clientX - initialPosition.x, 2) +
            Math.pow(e.clientY - initialPosition.y, 2),
        );

        // Only consider it a move if dragged more than 5 pixels
        if (moveDistance > 5) {
          hasMoved = true;
        }
      }

      // Only show drop indicators if the user has actually moved the item
      if (hasMoved) {
        const bounding = item.getBoundingClientRect();
        const offset = bounding.y + (bounding.height / 2);

        // Determine whether to show the drag indicator above or below the target item
        if (e.clientY - offset > 0) {
          item.classList.add("drag-over-bottom");
          item.classList.remove("drag-over-top");
        } else {
          item.classList.add("drag-over-top");
          item.classList.remove("drag-over-bottom");
        }
      }
    });

    // Set up dragleave event
    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over-top");
      item.classList.remove("drag-over-bottom");
    });

    // Set up drop event
    item.addEventListener("drop", async (e) => {
      e.preventDefault();

      if (!draggedItem || item === draggedItem || !hasMoved) return;

      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId) return;

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
        // Determine whether to place the item before or after the target
        const bounding = item.getBoundingClientRect();
        const offset = bounding.y + (bounding.height / 2);

        if (e.clientY - offset > 0) {
          // Drop below the target
          if (item.nextSibling) {
            sessionsContainer.insertBefore(draggedItem, item.nextSibling);
          } else {
            sessionsContainer.appendChild(draggedItem);
          }
        } else {
          // Drop above the target
          sessionsContainer.insertBefore(draggedItem, item);
        }

        // Calculate the new index after the DOM has been updated
        const newItems = Array.from(
          sessionsContainer.querySelectorAll(
            ".session-item:not(#draftSession)",
          ),
        );
        const newIndex = newItems.findIndex((el) =>
          el.dataset.sessionId === draggedId
        );

        await reorderSessionsInStorage(fromIndex, newIndex);
      }

      item.classList.remove("drag-over-top");
      item.classList.remove("drag-over-bottom");
    });
  });

  // Add drop event to the container itself to handle dropping at the end
  sessionsContainer.addEventListener("dragover", (e) => {
    e.preventDefault();

    // Only show the indicator when not over an item and the user has moved the item
    if (e.target === sessionsContainer && hasMoved) {
      const draftSession = document.getElementById("draftSession");
      draftSession.classList.add("drag-over-bottom");
    }
  });

  sessionsContainer.addEventListener("dragleave", (e) => {
    // Remove the indicator when leaving the container
    const draftSession = document.getElementById("draftSession");
    draftSession.classList.remove("drag-over-bottom");
  });

  sessionsContainer.addEventListener("drop", async (e) => {
    e.preventDefault();

    // Only handle drops directly on the container (not on items) and if the user has moved the item
    if (e.target !== sessionsContainer || !hasMoved) return;

    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId || !draggedItem) return;

    // Append to the end
    sessionsContainer.appendChild(draggedItem);

    // Update storage with the new order
    const items = Array.from(
      sessionsContainer.querySelectorAll(
        ".session-item:not(#draftSession)",
      ),
    );

    const fromIndex = items.findIndex((el) =>
      el.dataset.sessionId === draggedId
    );

    await reorderSessionsInStorage(fromIndex, items.length - 1);

    const draftSession = document.getElementById("draftSession");
    draftSession.classList.remove("drag-over-bottom");
  });
}

function addTrashDragAndDropListeners() {
  const sessionItems = document.querySelectorAll(
    "#trashSessions .session-item",
  );
  const trashContainer = document.getElementById("trashSessions");
  let draggedItem = null;
  let initialPosition = null;
  let hasMoved = false;

  // Check if there are no items to set up dragging for
  if (sessionItems.length <= 0) return;

  sessionItems.forEach((item) => {
    if (item.closest(".draft-session")) return;

    // Set up dragstart event
    item.addEventListener("dragstart", (e) => {
      draggedItem = item;
      initialPosition = { x: e.clientX, y: e.clientY };
      hasMoved = false;

      setTimeout(() => {
        item.classList.add("dragging");
      }, 0);

      e.dataTransfer.setData("text/plain", item.dataset.sessionId);
      e.dataTransfer.effectAllowed = "move";
    });

    // Set up dragend event
    item.addEventListener("dragend", () => {
      draggedItem = null;
      initialPosition = null;
      hasMoved = false;
      item.classList.remove("dragging");

      document.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach(
        (el) => {
          el.classList.remove("drag-over-top");
          el.classList.remove("drag-over-bottom");
        },
      );
    });

    // Set up dragover event
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (item === draggedItem) return;

      // Check if the user has moved the cursor enough from the starting position
      if (initialPosition) {
        const moveDistance = Math.sqrt(
          Math.pow(e.clientX - initialPosition.x, 2) +
            Math.pow(e.clientY - initialPosition.y, 2),
        );

        // Only consider it a move if dragged more than 5 pixels
        if (moveDistance > 5) {
          hasMoved = true;
        }
      }

      // Only show drop indicators if the user has actually moved the item
      if (hasMoved) {
        const bounding = item.getBoundingClientRect();
        const offset = bounding.y + (bounding.height / 2);

        // Determine whether to show the drag indicator above or below the target item
        if (e.clientY - offset > 0) {
          item.classList.add("drag-over-bottom");
          item.classList.remove("drag-over-top");
        } else {
          item.classList.add("drag-over-top");
          item.classList.remove("drag-over-bottom");
        }
      }
    });

    // Set up dragleave event
    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over-top");
      item.classList.remove("drag-over-bottom");
    });

    // Set up drop event
    item.addEventListener("drop", async (e) => {
      e.preventDefault();

      if (!draggedItem || item === draggedItem || !hasMoved) return;

      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId) return;

      const items = Array.from(
        trashContainer.querySelectorAll(".session-item:not(.draft-session)"),
      );

      const fromIndex = items.findIndex((el) =>
        el.dataset.sessionId === draggedId
      );
      const toIndex = items.findIndex((el) => el === item);

      if (fromIndex !== -1 && toIndex !== -1) {
        // Determine whether to place the item before or after the target
        const bounding = item.getBoundingClientRect();
        const offset = bounding.y + (bounding.height / 2);

        if (e.clientY - offset > 0) {
          // Drop below the target
          if (item.nextSibling) {
            trashContainer.insertBefore(draggedItem, item.nextSibling);
          } else {
            trashContainer.appendChild(draggedItem);
          }
        } else {
          // Drop above the target
          trashContainer.insertBefore(draggedItem, item);
        }

        // Calculate the new index after the DOM has been updated
        const newItems = Array.from(
          trashContainer.querySelectorAll(".session-item:not(.draft-session)"),
        );
        const newIndex = newItems.findIndex((el) =>
          el.dataset.sessionId === draggedId
        );

        await reorderTrashSessionsInStorage(fromIndex, newIndex);
      }

      item.classList.remove("drag-over-top");
      item.classList.remove("drag-over-bottom");
    });
  });

  // Add drop event to the container itself to handle dropping at the end
  trashContainer.addEventListener("dragover", (e) => {
    e.preventDefault();

    // Only show the indicator when not over an item and the user has moved the item
    if (e.target === trashContainer && hasMoved) {
      const emptyTrashItem = trashContainer.querySelector(".draft-session");
      if (emptyTrashItem) {
        emptyTrashItem.classList.add("drag-over-bottom");
      }
    }
  });

  trashContainer.addEventListener("dragleave", (e) => {
    // Remove the indicator when leaving the container
    const emptyTrashItem = trashContainer.querySelector(".draft-session");
    if (emptyTrashItem) {
      emptyTrashItem.classList.remove("drag-over-bottom");
    }
  });

  trashContainer.addEventListener("drop", async (e) => {
    e.preventDefault();

    // Only handle drops directly on the container (not on items) and if the user has moved the item
    if (e.target !== trashContainer || !hasMoved) return;

    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId || !draggedItem) return;

    // Append to the end
    trashContainer.appendChild(draggedItem);

    // Update storage with the new order
    const items = Array.from(
      trashContainer.querySelectorAll(".session-item:not(.draft-session)"),
    );

    const fromIndex = items.findIndex((el) =>
      el.dataset.sessionId === draggedId
    );

    await reorderTrashSessionsInStorage(fromIndex, items.length - 1);

    const emptyTrashItem = trashContainer.querySelector(".draft-session");
    if (emptyTrashItem) {
      emptyTrashItem.classList.remove("drag-over-bottom");
    }
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

async function deleteForever(sessionId) {
  try {
    // Find the session element in a safer way
    const sessionElement = document.querySelector(
      `.session-item[data-session-id="${sessionId}"]`,
    );

    if (sessionElement && sessionElement.closest("#trashSessions")) {
      sessionElement.remove();
    }

    // Send a message to the background script to handle the actual data removal
    browser.runtime.sendMessage({
      action: "deleteForever",
      sessionId: sessionId,
    });
  } catch (error) {
    console.error(`Error permanently deleting session ${sessionId}:`, error);
    // Refresh the trash view in case of error
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

displaySessions();
switchView("main");
