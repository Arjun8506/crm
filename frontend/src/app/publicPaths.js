// Pages anyone can open without signing in. The session is never restored (or refreshed) on these.
export const isPublicPath = (pathname) => /^\/(f|s)\/[^/]+\/?$/.test(pathname);
