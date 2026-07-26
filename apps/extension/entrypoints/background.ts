export default defineBackground(() => {
  // The toolbar action opens the side panel (Chrome only); with
  // openPanelOnActionClick, action.onClicked never fires. No message routing:
  // the content script owns the engine handlers, the side panel calls the web
  // API directly.
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});
