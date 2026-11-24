export const PUPPYROUTER_WEBSITE = "https://puppyrouter.com";
export const PUPPYROUTER_DOWNLOADS = PUPPYROUTER_WEBSITE + "/client";

/** Imported and custom configurations may contain arbitrary websites. The built-in key action
 * always points to the first-party account page and never forwards a stored path or query. */
export function puppyRouterKeyPage(
  website: string | undefined,
): string | undefined {
  if (!website) return undefined;
  try {
    const url = new URL(website);
    if (
      !url.username &&
      !url.password &&
      (url.origin === PUPPYROUTER_WEBSITE ||
        url.origin === "https://www.puppyrouter.com")
    ) {
      return PUPPYROUTER_WEBSITE + "/console/token";
    }
  } catch {
    // A blank or partially edited URL has no key action.
  }
  return undefined;
}
