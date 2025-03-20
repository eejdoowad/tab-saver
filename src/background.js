// Background script for Tab Saver extension

// Listen for messages from the popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openInNewWindow" && message.session) {
    openTabsInNewWindow(message.session);
    return true; // Indicates we'll handle the response asynchronously
  }

  if (message.action === "openInCurrentWindow" && message.session) {
    openTabsInCurrentWindow(message.session);
    return true; // Indicates we'll handle the response asynchronously
  }

  if (message.action === "deleteSession" && message.sessionId) {
    deleteSession(message.sessionId);
    return true; // Indicates we'll handle the response asynchronously
  }

  if (
    message.action === "renameSession" && message.sessionId && message.newName
  ) {
    renameSession(message.sessionId, message.newName);
    return true; // Indicates we'll handle the response asynchronously
  }

  if (message.action === "moveToTrash" && message.sessionId) {
    moveToTrash(message.sessionId);
    return true; // Indicates we'll handle the response asynchronously
  }

  if (message.action === "restoreFromTrash" && message.sessionId) {
    restoreFromTrash(message.sessionId);
    return true; // Indicates we'll handle the response asynchronously
  }

  if (message.action === "deleteForever" && message.sessionId) {
    deleteForever(message.sessionId);
    return true; // Indicates we'll handle the response asynchronously
  }
});

// Function to rename a session
async function renameSession(sessionId, newName) {
  try {
    const { sessions = [] } = await browser.storage.local.get("sessions");
    const updatedSessions = sessions.map((session) => {
      if (session.id === sessionId) {
        return { ...session, name: newName };
      }
      return session;
    });

    await browser.storage.local.set({ sessions: updatedSessions });
  } catch (error) {
    console.error(`Error renaming session ${sessionId}:`, error);
  }
}

// Function to move a session to trash
async function moveToTrash(sessionId) {
  try {
    // Get current sessions and trash sessions
    const { sessions = [], trashSessions = [] } = await browser.storage.local
      .get([
        "sessions",
        "trashSessions",
      ]);

    // Find the session to move
    const sessionToMove = sessions.find((session) => session.id === sessionId);

    if (!sessionToMove) {
      console.error(`Session ${sessionId} not found for moving to trash`);
      return;
    }

    // Add delete time to the session - use current timestamp
    const sessionWithDeleteTime = {
      ...sessionToMove,
      delete_time: Date.now(),
    };

    // Add to trash and remove from active sessions
    const updatedTrashSessions = [sessionWithDeleteTime, ...trashSessions];
    const updatedSessions = sessions.filter((session) =>
      session.id !== sessionId
    );

    // Save updated lists
    await browser.storage.local.set({
      sessions: updatedSessions,
      trashSessions: updatedTrashSessions,
    });
  } catch (error) {
    console.error(`Error moving session ${sessionId} to trash:`, error);
  }
}

// Function to restore a session from trash
async function restoreFromTrash(sessionId) {
  try {
    // Get current sessions and trash sessions
    const { sessions = [], trashSessions = [] } = await browser.storage.local
      .get([
        "sessions",
        "trashSessions",
      ]);

    // Find the session to restore
    const sessionToRestore = trashSessions.find((session) =>
      session.id === sessionId
    );

    if (!sessionToRestore) {
      console.error(`Session ${sessionId} not found in trash for restoring`);
      return;
    }

    // Remove the delete_time property
    const { delete_time, ...restoredSession } = sessionToRestore;

    // Add to active sessions and remove from trash
    const updatedSessions = [restoredSession, ...sessions];
    const updatedTrashSessions = trashSessions.filter((session) =>
      session.id !== sessionId
    );

    // Save updated lists
    await browser.storage.local.set({
      sessions: updatedSessions,
      trashSessions: updatedTrashSessions,
    });

    console.log(`Session ${sessionId} restored from trash`);
  } catch (error) {
    console.error(`Error restoring session ${sessionId} from trash:`, error);
  }
}

// Function to permanently delete a session from trash
async function deleteForever(sessionId) {
  try {
    // Get trash sessions
    const { trashSessions = [] } = await browser.storage.local.get(
      "trashSessions",
    );

    // Remove the session from trash
    const updatedTrashSessions = trashSessions.filter((session) =>
      session.id !== sessionId
    );

    // Save updated trash list
    await browser.storage.local.set({ trashSessions: updatedTrashSessions });

    console.log(`Session ${sessionId} permanently deleted`);
  } catch (error) {
    console.error(`Error permanently deleting session ${sessionId}:`, error);
  }
}

// Function to delete a session (legacy function, kept for backward compatibility)
async function deleteSession(sessionId) {
  try {
    // Get sessions but don't modify the session counter
    const { sessions = [] } = await browser.storage.local.get("sessions");
    const updatedSessions = sessions.filter((session) =>
      session.id !== sessionId
    );

    // Only update the sessions, preserve the sessionCounter
    await browser.storage.local.set({ sessions: updatedSessions });
    console.log(`Session ${sessionId} deleted successfully`);
  } catch (error) {
    console.error(`Error deleting session ${sessionId}:`, error);
  }
}

// Function to open tabs in the current window
async function openTabsInCurrentWindow(session) {
  if (!session || !session.tabs || session.tabs.length === 0) {
    console.error("No tabs to open");
    return;
  }

  let successCount = 0;
  let failCount = 0;

  // Create each tab in the current window
  for (const tab of session.tabs) {
    try {
      await browser.tabs.create({ url: tab.url });
      successCount++;
    } catch (error) {
      console.error(`Error opening tab ${tab.url}:`, error);
      failCount++;
    }
  }

  console.log(
    `Opened ${successCount} tabs successfully. Failed to open ${failCount} tabs.`,
  );
}

// Function to open tabs in a new window
async function openTabsInNewWindow(session) {
  if (!session || !session.tabs || session.tabs.length === 0) {
    console.error("No tabs to open");
    return;
  }

  try {
    // Try to create the new window with the first tab
    let newWindow;
    try {
      newWindow = await browser.windows.create({
        url: session.tabs[0].url,
      });
      console.log("Successfully opened first tab in new window");
    } catch (error) {
      console.error(
        `Error opening first tab in new window (${session.tabs[0].url}):`,
        error,
      );

      // If the first tab fails, try to create an empty window and proceed with the rest
      newWindow = await browser.windows.create({});
      console.log("Created empty window instead");
    }

    // Add the rest of the tabs to the new window
    let successCount = newWindow.tabs ? 1 : 0; // Start with 1 if first tab succeeded
    let failCount = newWindow.tabs ? 0 : 1; // Start with 1 if first tab failed

    // Start from index 1 if the first tab was successfully opened with the window
    // Or start from index 0 if we had to create an empty window
    const startIndex = newWindow.tabs ? 1 : 0;

    for (let i = startIndex; i < session.tabs.length; i++) {
      try {
        await browser.tabs.create({
          windowId: newWindow.id,
          url: session.tabs[i].url,
        });
        successCount++;
      } catch (error) {
        console.error(
          `Error opening tab ${session.tabs[i].url} in new window:`,
          error,
        );
        failCount++;
      }
    }

    console.log(
      `Opened ${successCount} tabs successfully in new window. Failed to open ${failCount} tabs.`,
    );

    // Close the empty tab if we created an empty window
    if (!newWindow.tabs) {
      try {
        // Get the first (empty) tab in the window
        const tabs = await browser.tabs.query({ windowId: newWindow.id });
        if (tabs.length > 0) {
          await browser.tabs.remove(tabs[0].id);
        }
      } catch (error) {
        console.error("Error closing empty tab:", error);
      }
    }
  } catch (error) {
    console.error("Fatal error opening tabs in new window:", error);
  }
}
