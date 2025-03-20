// Hyperscript-like helper function for creating DOM elements safely
function h(tag, props = {}, children = []) {
  // Create the element
  const element = document.createElement(tag);

  // Add attributes and event listeners
  Object.entries(props).forEach(([key, value]) => {
    if (key === "className" || key === "class") {
      element.className = value;
    } else if (key === "dataset") {
      Object.entries(value).forEach(([dataKey, dataValue]) => {
        element.dataset[dataKey] = dataValue;
      });
    } else if (key.startsWith("on") && typeof value === "function") {
      // Event listeners (onClick, onDragStart, etc.)
      const eventName = key.substring(2).toLowerCase();
      element.addEventListener(eventName, value);
    } else if (key === "style" && typeof value === "object") {
      // Handle style object
      Object.entries(value).forEach(([styleProp, styleValue]) => {
        element.style[styleProp] = styleValue;
      });
    } else if (key === "contentEditable") {
      // Special case for contentEditable
      element.contentEditable = value;
    } else {
      // Regular attributes
      element.setAttribute(key, value);
    }
  });

  // Add children
  if (Array.isArray(children)) {
    children.forEach((child) => appendChild(element, child));
  } else if (children) {
    appendChild(element, children);
  }

  return element;
}

// Helper function to append child nodes
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

// Date utility function for formatting timestamps
function formatDate(timestamp) {
  if (!timestamp) return "";
  // Convert numeric timestamp to readable date string
  return new Date(timestamp).toLocaleString();
}

// Tab navigation elements
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

// Variable to store the original data for reverting changes
let originalDataJSON = "";

// Generate a unique ID
function generateUniqueId() {
  return "session_" + Date.now() + "_" +
    Math.random().toString(36).substr(2, 9);
}

// Function to check if a URL is a privileged Firefox URL or otherwise not openable
function isRestrictedUrl(url) {
  // About pages and other Firefox internal pages
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

// Save current session function
async function saveCurrentSession() {
  try {
    const tabs = await browser.tabs.query({ currentWindow: true });

    // Filter out tabs with restricted URLs before saving
    const validTabs = tabs.filter((tab) => !isRestrictedUrl(tab.url));

    if (validTabs.length === 0) {
      alert(
        "No valid tabs to save. All tabs have restricted URLs that can't be reopened later.",
      );
      return;
    }

    // Get the current session counter and increment it
    const { sessionCounter = 0 } = await browser.storage.local.get(
      "sessionCounter",
    );
    const newCounter = sessionCounter + 1;

    // Store current timestamp as a number
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

    // Get existing sessions
    const { sessions = [] } = await browser.storage.local.get("sessions");
    sessions.unshift(session);

    // Save updated sessions and counter
    await browser.storage.local.set({
      sessions,
      sessionCounter: newCounter,
    });

    // Refresh the display
    displaySessions();
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

// Make both the save button and the entire draft session clickable
saveButton.addEventListener("click", (event) => {
  event.stopPropagation(); // Prevent triggering the draftSession click event
  saveCurrentSession();
});

// Make the entire draft session area clickable
draftSession.addEventListener("click", () => {
  saveCurrentSession();
});

// Open tabs in current window
async function openInCurrentWindow(session) {
  // Send message to background script to handle opening tabs in current window
  // This allows the operation to complete even after the popup closes
  browser.runtime.sendMessage({
    action: "openInCurrentWindow",
    session: session,
  });
}

// Open tabs in new window
async function openInNewWindow(session) {
  // Send message to background script to handle opening tabs in a new window
  // This allows the operation to complete even after the popup closes
  browser.runtime.sendMessage({
    action: "openInNewWindow",
    session: session,
  });
}

// Save session name change
async function saveSessionName(sessionId, newName) {
  try {
    // Send message to background script to handle renaming
    browser.runtime.sendMessage({
      action: "renameSession",
      sessionId: sessionId,
      newName: newName,
    });
  } catch (error) {
    console.error(`Error renaming session ${sessionId}:`, error);
  }
}

// Move session to trash
async function moveToTrash(sessionId) {
  try {
    // First, remove the session element from the UI immediately
    const sessionElement = document.querySelector(
      `.delete-btn[data-session-id="${sessionId}"]`,
    ).closest(".session-item");
    if (sessionElement) {
      sessionElement.remove();
    }

    // Then send message to background script to handle moving to trash
    browser.runtime.sendMessage({
      action: "moveToTrash",
      sessionId: sessionId,
    });

    // Only refresh trash view since we've already updated the main view
    displayTrashSessions();
  } catch (error) {
    console.error(`Error moving session ${sessionId} to trash:`, error);
    // If something went wrong, refresh both views to ensure correct state
    displaySessions();
    displayTrashSessions();
  }
}

// Restore session from trash
async function restoreFromTrash(sessionId) {
  try {
    // First, remove the session element from the trash UI immediately
    const sessionElement = document.querySelector(
      `.undelete-btn[data-session-id="${sessionId}"]`,
    ).closest(".session-item");
    if (sessionElement) {
      sessionElement.remove();
    }

    // Get the session data from trashSessions
    const { trashSessions = [] } = await browser.storage.local.get(
      "trashSessions",
    );
    const sessionToRestore = trashSessions.find((session) =>
      session.id === sessionId
    );

    if (sessionToRestore) {
      // Add the restored session to the main view immediately
      const { delete_time, ...restoredSession } = sessionToRestore;

      // Add the session to the UI directly
      addSessionToUI(restoredSession);

      // Then send message to background script to handle restoring from trash
      browser.runtime.sendMessage({
        action: "restoreFromTrash",
        sessionId: sessionId,
      });
    } else {
      // If we couldn't find the session data, fall back to just refreshing the views
      console.error(
        `Session ${sessionId} not found in trash for immediate restoration`,
      );
      browser.runtime.sendMessage({
        action: "restoreFromTrash",
        sessionId: sessionId,
      });

      // Refresh main view
      displaySessions();
    }
  } catch (error) {
    console.error(`Error restoring session ${sessionId} from trash:`, error);
    // If something went wrong, refresh both views to ensure correct state
    displaySessions();
    displayTrashSessions();
  }
}

// Helper function to get click target based on x-coordinate position
function getClickTarget(event, sessionElement) {
  const rect = sessionElement.getBoundingClientRect();
  const sessionActions = sessionElement.querySelector(".session-actions");
  const actionsRect = sessionActions.getBoundingClientRect();

  // If click is in the actions area
  if (event.clientX >= actionsRect.left) {
    const buttons = sessionActions.querySelectorAll("button");
    // Divide actions area into equal parts for each button
    const buttonWidth = actionsRect.width / buttons.length;

    // Determine which button area was clicked based on x position
    const posInActions = event.clientX - actionsRect.left;
    const buttonIndex = Math.min(
      Math.floor(posInActions / buttonWidth),
      buttons.length - 1,
    );
    return buttons[buttonIndex];
  }

  // If click is on the title
  const titleContainer = sessionElement.querySelector(".title-container");
  if (
    event.target === titleContainer || titleContainer.contains(event.target)
  ) {
    // Return the session title if it was clicked
    return sessionElement.querySelector(".session-title");
  }

  // Default: return the title container itself
  return titleContainer;
}

// Helper function to add session row click handling
function addSessionRowClickHandling(sessionElement) {
  if (sessionElement.closest(".draft-session")) return; // Skip draft sessions

  // Add click handler for the entire session row
  sessionElement.addEventListener("click", function (event) {
    // Don't trigger for direct clicks on buttons or the session title
    if (
      event.target.tagName === "BUTTON" ||
      event.target.classList.contains("session-title") ||
      event.target.closest(".tab-list-container") ||
      event.target.closest(".tab-list")
    ) {
      return;
    }

    // Get the appropriate target based on click position
    const target = getClickTarget(event, sessionElement);

    // Simulate a click on the target
    if (target) {
      target.click();
    }
  });
}

// Helper function to add a session to the main view UI
function addSessionToUI(session) {
  const sessionElement = document.createElement("div");
  sessionElement.className = "session-item";
  sessionElement.draggable = true;
  sessionElement.dataset.sessionId = session.id;

  // Create the main session info and action buttons with h function
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
    }, "⟴"),
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

  // Create hidden tab list container (initially hidden)
  const tabListContainer = document.createElement("div");
  tabListContainer.className = "tab-list-container";
  tabListContainer.style.display = "none";

  // Add timestamp to the tab list container
  const dateElement = h(
    "div",
    { className: "session-date" },
    `Created: ${formatDate(session.create_time)}`,
  );
  tabListContainer.appendChild(dateElement);

  // Create the tab list
  const tabListElement = document.createElement("div");
  tabListElement.className = "tab-list";

  // Add each tab to the list
  session.tabs.forEach((tab) => {
    const tabElement = h("div", { className: "tab-item" }, [
      h("span", { className: "tab-title" }, tab.title),
      h("span", { className: "tab-url" }, tab.url),
    ]);

    tabListElement.appendChild(tabElement);
  });

  // Append the tab list to the container
  tabListContainer.appendChild(tabListElement);

  // Append the tab list container to the session element
  sessionElement.appendChild(tabListContainer);

  // Add the new session element to the top of the main sessions list
  const sessionsContainer = document.getElementById("sessions");
  if (sessionsContainer.firstChild) {
    sessionsContainer.insertBefore(
      sessionElement,
      sessionsContainer.firstChild,
    );
  } else {
    sessionsContainer.appendChild(sessionElement);
  }

  // Add event listeners to the newly added session element
  addSessionEventListeners(sessionElement);

  // Add row click handling
  addSessionRowClickHandling(sessionElement);

  // Re-initialize drag and drop functionality to include the new element
  addDragAndDropListeners();
}

// Helper function to add event listeners to session elements
function addSessionEventListeners(sessionElement) {
  // Add title editing functionality
  const titleElement = sessionElement.querySelector(".session-title");
  if (titleElement) {
    const sessionId = titleElement.dataset.sessionId;

    // Store original value when editing starts
    titleElement.addEventListener("focus", function () {
      this.dataset.originalValue = this.textContent;
      // Select all text when focused
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(this);
      selection.removeAllRanges();
      selection.addRange(range);
    });

    // Save on enter key
    titleElement.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        this.blur();
      }
      // Cancel on escape
      if (e.key === "Escape") {
        this.textContent = this.dataset.originalValue;
        this.blur();
      }
    });

    // Save on blur (losing focus)
    titleElement.addEventListener("blur", function () {
      const newName = this.textContent.trim();
      if (newName && newName !== this.dataset.originalValue) {
        saveSessionName(sessionId, newName);
      } else if (!newName) {
        // If name is empty, revert to original
        this.textContent = this.dataset.originalValue;
      }
    });
  }

  // Add show tabs functionality
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

  // Add restore functionality
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

  // Add new window functionality
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

  // Add deletion functionality
  const deleteBtn = sessionElement.querySelector(".delete-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      const sessionId = deleteBtn.dataset.sessionId;
      moveToTrash(sessionId);
    });
  }
}

// Delete session permanently
async function deleteForever(sessionId) {
  try {
    // First, remove the session element from the UI immediately
    const sessionElement = document.querySelector(
      `.delete-forever-btn[data-session-id="${sessionId}"]`,
    ).closest(".session-item");
    if (sessionElement) {
      sessionElement.remove();
    }

    // Then send message to background script to handle permanent deletion
    browser.runtime.sendMessage({
      action: "deleteForever",
      sessionId: sessionId,
    });
  } catch (error) {
    console.error(`Error permanently deleting session ${sessionId}:`, error);
    // If something went wrong, refresh the trash view to ensure correct state
    displayTrashSessions();
  }
}

// Delete all sessions from trash
async function emptyTrash() {
  try {
    // Clear the trash by setting an empty array
    await browser.storage.local.set({ trashSessions: [] });

    // Refresh trash view
    displayTrashSessions();
  } catch (error) {
    console.error("Error emptying trash:", error);
  }
}

// Display saved sessions
async function displaySessions() {
  try {
    const { sessions = [] } = await browser.storage.local.get("sessions");
    sessionsContainer.innerHTML = "";

    sessions.forEach((session) => {
      const sessionElement = document.createElement("div");
      sessionElement.className = "session-item";
      sessionElement.draggable = true;
      sessionElement.dataset.sessionId = session.id;

      // Create the main session info and action buttons with h function
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
        }, "⟴"),
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

      // Create hidden tab list container (initially hidden)
      const tabListContainer = document.createElement("div");
      tabListContainer.className = "tab-list-container";
      tabListContainer.style.display = "none";

      // Add timestamp to the tab list container
      const dateElement = h(
        "div",
        { className: "session-date" },
        `Created: ${formatDate(session.create_time)}`,
      );
      tabListContainer.appendChild(dateElement);

      // Create the tab list
      const tabListElement = document.createElement("div");
      tabListElement.className = "tab-list";

      // Add each tab to the list
      session.tabs.forEach((tab) => {
        const tabElement = h("div", { className: "tab-item" }, [
          h("span", { className: "tab-title" }, tab.title),
          h("span", { className: "tab-url" }, tab.url),
        ]);

        tabListElement.appendChild(tabElement);
      });

      // Append the tab list to the container
      tabListContainer.appendChild(tabListElement);

      // Append the tab list container to the session element
      sessionElement.appendChild(tabListContainer);

      // Add the complete session element to the container
      sessionsContainer.appendChild(sessionElement);
    });

    // Add row click handling to all sessions
    document.querySelectorAll("#sessions .session-item").forEach(
      (sessionElement) => {
        addSessionRowClickHandling(sessionElement);
      },
    );

    // Add drag-and-drop functionality for reordering
    addDragAndDropListeners();

    // Add title editing functionality
    document.querySelectorAll("#sessions .session-title").forEach(
      (titleElement) => {
        const sessionId = titleElement.dataset.sessionId;

        // Store original value when editing starts
        titleElement.addEventListener("focus", function () {
          this.dataset.originalValue = this.textContent;
          // Select all text when focused
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(this);
          selection.removeAllRanges();
          selection.addRange(range);
        });

        // Save on enter key
        titleElement.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            this.blur();
          }
          // Cancel on escape
          if (e.key === "Escape") {
            this.textContent = this.dataset.originalValue;
            this.blur();
          }
        });

        // Save on blur (losing focus)
        titleElement.addEventListener("blur", function () {
          const newName = this.textContent.trim();
          if (newName && newName !== this.dataset.originalValue) {
            saveSessionName(sessionId, newName);
          } else if (!newName) {
            // If name is empty, revert to original
            this.textContent = this.dataset.originalValue;
          }
        });
      },
    );

    // Add show tabs functionality
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

    // Add restore functionality
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

    // Add new window functionality
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

    // Add deletion functionality (moved to trash)
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

// Display trash sessions
async function displayTrashSessions() {
  try {
    const { trashSessions = [] } = await browser.storage.local.get(
      "trashSessions",
    );
    trashSessionsContainer.innerHTML = "";

    trashSessions.forEach((session) => {
      const sessionElement = document.createElement("div");
      sessionElement.className = "session-item";
      sessionElement.draggable = true;
      sessionElement.dataset.sessionId = session.id;

      // Create the main session info and action buttons with h function
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

      // Create hidden tab list container (initially hidden)
      const tabListContainer = document.createElement("div");
      tabListContainer.className = "tab-list-container";
      tabListContainer.style.display = "none";

      // Add timestamp and deletion date to the tab list container
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

      // Create the tab list
      const tabListElement = document.createElement("div");
      tabListElement.className = "tab-list";

      // Add each tab to the list
      session.tabs.forEach((tab) => {
        const tabElement = h("div", { className: "tab-item" }, [
          h("span", { className: "tab-title" }, tab.title),
          h("span", { className: "tab-url" }, tab.url),
        ]);

        tabListElement.appendChild(tabElement);
      });

      // Append the tab list to the container
      tabListContainer.appendChild(tabListElement);

      // Append the tab list container to the session element
      sessionElement.appendChild(tabListContainer);

      // Add the complete session element to the container
      trashSessionsContainer.appendChild(sessionElement);
    });

    // Add row click handling to all trash sessions
    document.querySelectorAll("#trashSessions .session-item").forEach(
      (sessionElement) => {
        addSessionRowClickHandling(sessionElement);
      },
    );

    // Add drag-and-drop functionality for reordering trash items
    addTrashDragAndDropListeners();

    // Add show tabs functionality for trash items
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

    // Add restore from trash functionality
    document.querySelectorAll("#trashSessions .undelete-btn").forEach(
      (button) => {
        button.addEventListener("click", () => {
          const sessionId = button.dataset.sessionId;
          restoreFromTrash(sessionId);
        });
      },
    );

    // Add delete forever functionality
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

// Function to load data into the configuration view
async function loadDataView() {
  try {
    // Get both active sessions and trash sessions
    const { sessions = [], trashSessions = [] } = await browser.storage.local
      .get([
        "sessions",
        "trashSessions",
      ]);

    // Get extension version from manifest
    const manifestData = browser.runtime.getManifest();
    const extensionVersion = manifestData.version;

    // Create a configuration object with all data
    const configData = {
      extension_version: extensionVersion, // Get version from the manifest
      create_time: Date.now(),
      sessions,
      trashSessions,
    };

    // Convert to JSON string with pretty formatting
    const jsonString = JSON.stringify(configData, null, 2);

    // Store the original JSON for possible revert
    originalDataJSON = jsonString;

    // Display in the data view
    dataTextarea.value = jsonString;

    // Initially disable the revert button since no changes have been made
    revertDataBtn.disabled = true;

    // Clear any status messages
    hideStatusMessage();
  } catch (error) {
    console.error("Error loading data:", error);
    showStatusMessage("Failed to load data. Please try again.", "error");
  }
}

// Function to save data from the configuration view
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

    // Validate the data structure
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

    // Validate each session has required fields and ensure dates are numeric
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

      // Ensure create_time timestamp is a number
      if (typeof session.create_time !== "number") {
        showStatusMessage(
          "Invalid creation date format. All dates must be numeric timestamps.",
          "error",
        );
        return false;
      }

      // Ensure delete_time is a number if it exists
      if (session.delete_time && typeof session.delete_time !== "number") {
        showStatusMessage(
          "Invalid deleted date format. All dates must be numeric timestamps.",
          "error",
        );
        return false;
      }

      // Validate tabs
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

    // Save the data
    await browser.storage.local.set({
      sessions: configData.sessions,
      trashSessions: configData.trashSessions,
    });

    // Get extension version from manifest
    const manifestData = browser.runtime.getManifest();
    const extensionVersion = manifestData.version;

    // Update create_time and ensure extension_version is set correctly
    configData.create_time = Date.now();
    configData.extension_version = extensionVersion; // Set to current extension version
    dataTextarea.value = JSON.stringify(configData, null, 2);

    // Refresh the views
    displaySessions();
    displayTrashSessions();

    // Show success message
    showStatusMessage("Changes saved successfully!", "success");
    return true;
  } catch (error) {
    console.error("Error saving data:", error);
    showStatusMessage("Failed to save data: " + error.message, "error");
    return false;
  }
}

// Helper functions for displaying status messages
function showStatusMessage(message, type) {
  dataStatusMessage.textContent = message;
  dataStatusMessage.className = "data-status-message " + type;

  // Auto-hide success messages after 3 seconds
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

// Remove the auto-save functionality
// Instead, we'll use the Save button
dataTextarea.addEventListener("input", () => {
  // Clear any success messages when the user starts editing
  if (dataStatusMessage.classList.contains("success")) {
    hideStatusMessage();
  }

  // Enable the revert button when changes are made
  if (dataTextarea.value !== originalDataJSON) {
    revertDataBtn.disabled = false;
  } else {
    revertDataBtn.disabled = true;
  }
});

// Toggle between views
let currentView = "main"; // "main", "trash", or "data"

// Function to switch views and update tabs
function switchView(viewName) {
  currentView = viewName;

  // Hide all views first
  mainView.style.display = "none";
  trashView.style.display = "none";
  exportView.style.display = "none";

  // Remove active class from all tabs
  sessionTab.classList.remove("active");
  trashTab.classList.remove("active");
  dataTab.classList.remove("active");

  // Show the selected view and activate corresponding tab
  if (viewName === "main") {
    mainView.style.display = "flex";
    sessionTab.classList.add("active");
  } else if (viewName === "trash") {
    trashView.style.display = "flex";
    trashTab.classList.add("active");
    // Update trash view when switching to it
    displayTrashSessions();

    // Make the Empty Trash header fully clickable
    setupEmptyTrashClickHandler();
  } else if (viewName === "data") {
    exportView.style.display = "flex";
    dataTab.classList.add("active");
    // Load the current data when switching to the data view
    loadDataView();
  }
}

// Tab click event listeners
sessionTab.addEventListener("click", () => {
  switchView("main");
});

trashTab.addEventListener("click", () => {
  switchView("trash");
});

dataTab.addEventListener("click", () => {
  switchView("data");
});

// Add copy to clipboard functionality
copyJsonBtn.addEventListener("click", () => {
  dataTextarea.select();
  document.execCommand("copy");
  // Show quick feedback
  copyJsonBtn.innerHTML = "✓︎ Copied!";
  setTimeout(() => {
    copyJsonBtn.innerHTML = "📋︎ Copy";
  }, 1500);
});

// Add save functionality
saveDataBtn.addEventListener("click", () => {
  if (saveDataView()) {
    // Update original data after successful save
    originalDataJSON = dataTextarea.value;
    revertDataBtn.disabled = true;
  }
});

// Add revert functionality
revertDataBtn.addEventListener("click", () => {
  dataTextarea.value = originalDataJSON;
  revertDataBtn.disabled = true;
  hideStatusMessage();
  showStatusMessage("Changes reverted to last saved state.", "success");
});

// Function to set up the click handler for the Empty Trash header
function setupEmptyTrashClickHandler() {
  const emptyTrashItem = document.querySelector("#trashView .draft-session");
  if (emptyTrashItem) {
    // First remove any existing click handler to avoid duplicates
    const newItem = emptyTrashItem.cloneNode(true);
    emptyTrashItem.parentNode.replaceChild(newItem, emptyTrashItem);

    // Add click handler to the whole item
    newItem.addEventListener("click", (event) => {
      // Don't trigger for direct clicks on the button (it already has its own handler)
      if (
        event.target.id === "emptyTrashBtn" ||
        event.target.closest("#emptyTrashBtn")
      ) {
        return;
      }
      emptyTrash();
    });

    // Re-add the click handler to the button
    const emptyTrashBtn = newItem.querySelector("#emptyTrashBtn");
    if (emptyTrashBtn) {
      emptyTrashBtn.addEventListener("click", emptyTrash);
    }
  }
}

// Add empty trash functionality
emptyTrashBtn.addEventListener("click", () => {
  emptyTrash();
});

// Add drag-and-drop functionality for reordering sessions
function addDragAndDropListeners() {
  const sessionItems = document.querySelectorAll("#sessions .session-item");

  // Variable to store the currently dragged item
  let draggedItem = null;

  sessionItems.forEach((item) => {
    // Skip the draft session (it shouldn't be reorderable)
    if (item.closest("#draftSession")) return;

    // When drag starts
    item.addEventListener("dragstart", (e) => {
      draggedItem = item;
      setTimeout(() => {
        item.classList.add("dragging");
      }, 0);

      // Set data transfer to make dragging work in Firefox
      e.dataTransfer.setData("text/plain", item.dataset.sessionId);
      e.dataTransfer.effectAllowed = "move";
    });

    // When drag ends
    item.addEventListener("dragend", () => {
      draggedItem = null;
      item.classList.remove("dragging");

      // Remove drag-over styling from all items
      document.querySelectorAll(".drag-over").forEach((el) => {
        el.classList.remove("drag-over");
      });
    });

    // When dragging over other items
    item.addEventListener("dragover", (e) => {
      e.preventDefault(); // Allow dropping
      e.dataTransfer.dropEffect = "move";

      // Don't allow dropping on itself
      if (item === draggedItem) return;

      // Add styling to indicate drop target
      const bounding = item.getBoundingClientRect();
      const offset = bounding.y + (bounding.height / 2);

      // Determine if we're in the top or bottom half of the item
      if (e.clientY - offset > 0) {
        // Bottom half - place after this item
        item.classList.add("drag-over");
      } else {
        // Top half - place before this item
        item.classList.add("drag-over");
      }
    });

    // When drag leaves an item
    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });

    // When item is dropped
    item.addEventListener("drop", async (e) => {
      e.preventDefault();

      if (!draggedItem || item === draggedItem) return;

      // Get the ID of the dropped item
      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId) return;

      // Get current position in DOM
      const sessionsContainer = document.getElementById("sessions");
      const items = Array.from(
        sessionsContainer.querySelectorAll(
          ".session-item:not(#draftSession)",
        ),
      );

      // Get positions for reordering
      const fromIndex = items.findIndex((el) =>
        el.dataset.sessionId === draggedId
      );
      const toIndex = items.findIndex((el) => el === item);

      // If both items are found
      if (fromIndex !== -1 && toIndex !== -1) {
        // Reorder in DOM
        if (fromIndex < toIndex) {
          // Moving down - place after target
          sessionsContainer.insertBefore(draggedItem, item.nextSibling);
        } else {
          // Moving up - place before target
          sessionsContainer.insertBefore(draggedItem, item);
        }

        // Reorder in storage
        await reorderSessionsInStorage(fromIndex, toIndex);
      }

      // Clean up
      item.classList.remove("drag-over");
    });
  });
}

// Function to update local storage after reordering
async function reorderSessionsInStorage(fromIndex, toIndex) {
  try {
    const { sessions = [] } = await browser.storage.local.get("sessions");

    // Reorder the sessions array
    const [movedItem] = sessions.splice(fromIndex, 1);
    sessions.splice(toIndex, 0, movedItem);

    // Save back to storage
    await browser.storage.local.set({ sessions });
  } catch (error) {
    console.error("Error reordering sessions:", error);
  }
}

// Add drag-and-drop functionality for reordering trash items
function addTrashDragAndDropListeners() {
  const sessionItems = document.querySelectorAll(
    "#trashSessions .session-item",
  );

  // Variable to store the currently dragged item
  let draggedItem = null;

  sessionItems.forEach((item) => {
    // Skip the Empty Trash item (it shouldn't be reorderable)
    if (item.closest(".draft-session")) return;

    // When drag starts
    item.addEventListener("dragstart", (e) => {
      draggedItem = item;
      setTimeout(() => {
        item.classList.add("dragging");
      }, 0);

      // Set data transfer to make dragging work in Firefox
      e.dataTransfer.setData("text/plain", item.dataset.sessionId);
      e.dataTransfer.effectAllowed = "move";
    });

    // When drag ends
    item.addEventListener("dragend", () => {
      draggedItem = null;
      item.classList.remove("dragging");

      // Remove drag-over styling from all items
      document.querySelectorAll(".drag-over").forEach((el) => {
        el.classList.remove("drag-over");
      });
    });

    // When dragging over other items
    item.addEventListener("dragover", (e) => {
      e.preventDefault(); // Allow dropping
      e.dataTransfer.dropEffect = "move";

      // Don't allow dropping on itself
      if (item === draggedItem) return;

      // Add styling to indicate drop target
      const bounding = item.getBoundingClientRect();
      const offset = bounding.y + (bounding.height / 2);

      // Determine if we're in the top or bottom half of the item
      if (e.clientY - offset > 0) {
        // Bottom half - place after this item
        item.classList.add("drag-over");
      } else {
        // Top half - place before this item
        item.classList.add("drag-over");
      }
    });

    // When drag leaves an item
    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });

    // When item is dropped
    item.addEventListener("drop", async (e) => {
      e.preventDefault();

      if (!draggedItem || item === draggedItem) return;

      // Get the ID of the dropped item
      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId) return;

      // Get current position in DOM
      const trashContainer = document.getElementById("trashSessions");
      const items = Array.from(
        trashContainer.querySelectorAll(".session-item"),
      );

      // Get positions for reordering
      const fromIndex = items.findIndex((el) =>
        el.dataset.sessionId === draggedId
      );
      const toIndex = items.findIndex((el) => el === item);

      // If both items are found
      if (fromIndex !== -1 && toIndex !== -1) {
        // Reorder in DOM
        if (fromIndex < toIndex) {
          // Moving down - place after target
          trashContainer.insertBefore(draggedItem, item.nextSibling);
        } else {
          // Moving up - place before target
          trashContainer.insertBefore(draggedItem, item);
        }

        // Reorder in storage
        await reorderTrashSessionsInStorage(fromIndex, toIndex);
      }

      // Clean up
      item.classList.remove("drag-over");
    });
  });
}

// Function to update local storage after reordering trash sessions
async function reorderTrashSessionsInStorage(fromIndex, toIndex) {
  try {
    const { trashSessions = [] } = await browser.storage.local.get(
      "trashSessions",
    );

    // Reorder the trash sessions array
    const [movedItem] = trashSessions.splice(fromIndex, 1);
    trashSessions.splice(toIndex, 0, movedItem);

    // Save back to storage
    await browser.storage.local.set({ trashSessions });
  } catch (error) {
    console.error("Error reordering trash sessions:", error);
  }
}

// Initial page load
displaySessions();
switchView("main");
