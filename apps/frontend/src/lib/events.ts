"use client";

// Cross-component event: pages listen for data changes (they don't own
// each other's state) via window events.
export const notifyEmailsChanged = () =>
  window.dispatchEvent(new Event("reachinbox:emails-changed"));

export const onEmailsChanged = (fn: () => void) => {
  window.addEventListener("reachinbox:emails-changed", fn);
  return () => window.removeEventListener("reachinbox:emails-changed", fn);
};
