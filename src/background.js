browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openInNewWindow" && message.session) {
    openTabsInNewWindow(message.session);
    return true;
  }

  if (message.action === "openInCurrentWindow" && message.session) {
    openTabsInCurrentWindow(message.session);
    return true;
  }

  if (message.action === "deleteSession" && message.sessionId) {
    deleteSession(message.sessionId);
    return true;
  }

  if (
    message.action === "renameSession" && message.sessionId && message.newName
  ) {
    renameSession(message.sessionId, message.newName);
    return true;
  }

  if (message.action === "moveToTrash" && message.sessionId) {
    moveToTrash(message.sessionId);
    return true;
  }

  if (message.action === "restoreFromTrash" && message.sessionId) {
    restoreFromTrash(message.sessionId);
    return true;
  }

  if (message.action === "deleteForever" && message.sessionId) {
    deleteForever(message.sessionId);
    return true;
  }
});

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

async function moveToTrash(sessionId) {
  try {
    const { sessions = [], trashSessions = [] } = await browser.storage.local
      .get([
        "sessions",
        "trashSessions",
      ]);

    const sessionToMove = sessions.find((session) => session.id === sessionId);

    if (!sessionToMove) {
      console.error(`Session ${sessionId} not found for moving to trash`);
      return;
    }

    const sessionWithDeleteTime = {
      ...sessionToMove,
      delete_time: Date.now(),
    };

    const updatedTrashSessions = [sessionWithDeleteTime, ...trashSessions];
    const updatedSessions = sessions.filter((session) =>
      session.id !== sessionId
    );

    await browser.storage.local.set({
      sessions: updatedSessions,
      trashSessions: updatedTrashSessions,
    });
  } catch (error) {
    console.error(`Error moving session ${sessionId} to trash:`, error);
  }
}

async function restoreFromTrash(sessionId) {
  try {
    const { sessions = [], trashSessions = [] } = await browser.storage.local
      .get([
        "sessions",
        "trashSessions",
      ]);

    const sessionToRestore = trashSessions.find((session) =>
      session.id === sessionId
    );

    if (!sessionToRestore) {
      console.error(`Session ${sessionId} not found in trash for restoring`);
      return;
    }

    const { delete_time, ...restoredSession } = sessionToRestore;

    const updatedSessions = [restoredSession, ...sessions];
    const updatedTrashSessions = trashSessions.filter((session) =>
      session.id !== sessionId
    );

    await browser.storage.local.set({
      sessions: updatedSessions,
      trashSessions: updatedTrashSessions,
    });

    console.log(`Session ${sessionId} restored from trash`);
  } catch (error) {
    console.error(`Error restoring session ${sessionId} from trash:`, error);
  }
}

async function deleteForever(sessionId) {
  try {
    const { trashSessions = [] } = await browser.storage.local.get(
      "trashSessions",
    );

    const updatedTrashSessions = trashSessions.filter((session) =>
      session.id !== sessionId
    );

    await browser.storage.local.set({ trashSessions: updatedTrashSessions });

    console.log(`Session ${sessionId} permanently deleted`);
  } catch (error) {
    console.error(`Error permanently deleting session ${sessionId}:`, error);
  }
}

async function deleteSession(sessionId) {
  try {
    const { sessions = [] } = await browser.storage.local.get("sessions");
    const updatedSessions = sessions.filter((session) =>
      session.id !== sessionId
    );

    await browser.storage.local.set({ sessions: updatedSessions });
    console.log(`Session ${sessionId} deleted successfully`);
  } catch (error) {
    console.error(`Error deleting session ${sessionId}:`, error);
  }
}

async function openTabsInCurrentWindow(session) {
  if (!session || !session.tabs || session.tabs.length === 0) {
    console.error("No tabs to open");
    return;
  }

  let successCount = 0;
  let failCount = 0;
  let firstTabId = null;

  if (session.tabs.length > 0) {
    try {
      const firstTab = await browser.tabs.create({ url: session.tabs[0].url });
      firstTabId = firstTab.id;
      successCount++;
    } catch (error) {
      console.error(`Error opening first tab ${session.tabs[0].url}:`, error);
      failCount++;
    }
  }

  for (let i = 1; i < session.tabs.length; i++) {
    try {
      await browser.tabs.create({ url: session.tabs[i].url });
      successCount++;
    } catch (error) {
      console.error(`Error opening tab ${session.tabs[i].url}:`, error);
      failCount++;
    }
  }

  if (firstTabId !== null) {
    try {
      await browser.tabs.update(firstTabId, { active: true });
    } catch (error) {
      console.error("Error activating first tab:", error);
    }
  }

  console.log(
    `Opened ${successCount} tabs successfully. Failed to open ${failCount} tabs.`,
  );
}

async function openTabsInNewWindow(session) {
  if (!session || !session.tabs || session.tabs.length === 0) {
    console.error("No tabs to open");
    return;
  }

  try {
    let newWindow;
    let firstTabId = null;

    try {
      newWindow = await browser.windows.create({
        url: session.tabs[0].url,
      });
      console.log("Successfully opened first tab in new window");

      if (newWindow && newWindow.tabs && newWindow.tabs.length > 0) {
        firstTabId = newWindow.tabs[0].id;
      }
    } catch (error) {
      console.error(
        `Error opening first tab in new window (${session.tabs[0].url}):`,
        error,
      );

      newWindow = await browser.windows.create({});
      console.log("Created empty window instead");
    }

    let successCount = newWindow.tabs ? 1 : 0;
    let failCount = newWindow.tabs ? 0 : 1;

    const startIndex = newWindow.tabs ? 1 : 0;

    if (startIndex === 0) {
      try {
        const firstTab = await browser.tabs.create({
          windowId: newWindow.id,
          url: session.tabs[0].url,
        });
        firstTabId = firstTab.id;
        successCount++;
      } catch (error) {
        console.error(
          `Error opening first tab ${session.tabs[0].url} in empty window:`,
          error,
        );
        failCount++;
      }
    }

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

    if (firstTabId !== null) {
      try {
        await browser.tabs.update(firstTabId, { active: true });
      } catch (error) {
        console.error("Error activating first tab in new window:", error);
      }
    }

    console.log(
      `Opened ${successCount} tabs successfully in new window. Failed to open ${failCount} tabs.`,
    );

    if (!newWindow.tabs) {
      try {
        const tabs = await browser.tabs.query({ windowId: newWindow.id });
        if (tabs.length > 0 && tabs[0].id !== firstTabId) {
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
