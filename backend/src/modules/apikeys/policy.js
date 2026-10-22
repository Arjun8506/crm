// What an API key may call. Everything else (users, integrations, workflows, billing, ...) is refused outright,
// so a leaked key can never be used to escalate into account administration.
const ID = '[a-f0-9]{24}';
const rx = (s) => new RegExp(`^${s}$`);

const READ_PATHS = [
  ['GET', rx('/workspaces')], ['GET', rx(`/workspaces/${ID}`)],
  ['GET', rx('/dataforms')], ['GET', rx(`/dataforms/${ID}`)],
  ['GET', rx(`/dataforms/${ID}/records`)], ['GET', rx(`/dataforms/${ID}/records/${ID}`)], ['GET', rx(`/dataforms/${ID}/records/${ID}/history`)],
  ['POST', rx(`/dataforms/${ID}/records/query`)], ['POST', rx(`/dataforms/${ID}/records/export`)], ['POST', rx(`/dataforms/${ID}/analyze`)],
];
const WRITE_PATHS = [
  ['POST', rx(`/dataforms/${ID}/records`)], ['PATCH', rx(`/dataforms/${ID}/records/${ID}`)], ['DELETE', rx(`/dataforms/${ID}/records/${ID}`)],
  ['POST', rx(`/dataforms/${ID}/records/bulk`)], ['POST', rx(`/dataforms/${ID}/records/${ID}/copy`)], ['POST', rx(`/dataforms/${ID}/records/${ID}/move`)],
];

export function keyAllows(scope, method, path) {
  const list = scope === 'write' ? [...READ_PATHS, ...WRITE_PATHS] : READ_PATHS;
  return list.some(([m, re]) => m === method && re.test(path));
}
