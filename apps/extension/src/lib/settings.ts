import { storage } from "wxt/utils/storage";

export const settings = {
  // Base URL of the local OfferOS web app the side panel talks to.
  webApiBase: storage.defineItem<string>("local:webApiBase", { fallback: "http://localhost:3000" }),
};
