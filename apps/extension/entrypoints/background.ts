import { startDevReload } from "../src/lib/dev-reload";

export default defineBackground(() => {
  // The toolbar action opens the side panel (Chrome only); with
  // openPanelOnActionClick, action.onClicked never fires. No message routing:
  // the content script owns the engine handlers, the side panel calls the web
  // API directly.
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  // Dev builds only (inert without a build stamp / with an update_url): reload
  // the whole extension when a fresh build lands in the unpacked directory.
  // Slightly delayed so an open side panel can refresh itself first.
  void startDevReload(() => setTimeout(() => browser.runtime.reload(), 400));
});
