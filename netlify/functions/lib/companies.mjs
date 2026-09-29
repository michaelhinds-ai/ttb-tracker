// Companies in Mikey Systems. Louisville Rickhouse is the ROOT workspace (users, retail, mail, etc.).
// Each other company is a fully separate workspace for its regulated data (barrels, bottling,
// finished goods, customers, orders, federal/state reports, QuickBooks) that SHARES the root's logins.
export const ROOT_WS = "7d72874cf4714c4e9242a22c39c42a65";
export const COMPANY_WS = { nbc: "d7ee258b1c714b6fab306c4a9396825d" };
export function isLinkedWs(ws) { return Object.values(COMPANY_WS).includes(String(ws || "")); }
