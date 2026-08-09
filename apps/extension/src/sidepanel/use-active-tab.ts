import { useEffect, useState } from "react";

/** The active tab the side panel drives: id (for tabs.sendMessage) + its url. */
export interface ActiveTab {
  id: number;
  url: string;
}

function toActiveTab(tab: { id?: number; url?: string } | undefined | null): ActiveTab | null {
  if (!tab || typeof tab.id !== "number") return null;
  return { id: tab.id, url: tab.url ?? "" };
}

/**
 * Track the active tab of the current window. The side panel is a thin client:
 * it drives whatever tab the user is looking at, so it re-reads the active tab
 * on activation (tab switch) and on updates (navigation completes / url changes).
 * Returns null while unknown or when the active tab has no id/url the panel can use.
 */
export function useActiveTab(): ActiveTab | null {
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);

  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (live) setActiveTab(toActiveTab(tab));
      } catch {
        if (live) setActiveTab(null);
      }
    };
    void refresh();

    const onActivated = () => void refresh();
    const onUpdated = (
      _tabId: number,
      changeInfo: { status?: string; url?: string },
      tab: { active?: boolean },
    ) => {
      // Only the active tab drives the panel; react when it finishes loading or its url changes.
      if (tab?.active && (changeInfo.status === "complete" || changeInfo.url !== undefined))
        void refresh();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      live = false;
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return activeTab;
}
