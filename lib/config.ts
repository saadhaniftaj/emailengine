import { ensureTab, readTab, writeCells } from "./sheets";

export const CONFIG_TAB = "_EngineConfig";

export type Pipeline = { id: string; tab: string; label: string };
export const PIPELINES: Pipeline[] = [
  { id: "market-research", tab: "Market Research", label: "Market Research" },
  { id: "consultancy", tab: "Consultancy", label: "Consultancy" },
];

export type Template = { subject: string; body: string };
export type PipelineCfg = {
  paused: boolean;
  delays: number[];      // hours to wait after step i before follow-up i+1
  templates: Template[]; // index 0 = initial, 1.. = follow-ups
  startH: number;        // lead-local send window start (hour, decimals ok)
  endH: number;
  cap: number;           // max sends per rolling 24h for this pipeline
};
export type GlobalCfg = {
  paused: boolean;
  senderName: string;
  fromAddress: string;
  dc: string;
  cap: number;
  minGap: number;
  maxGap: number;
  breakChance: number;
};
export type SentStamp = { t: number; p: string };
export type State = { nextAllowed: number; stamps: SentStamp[]; seen: string[] };
export type ZohoState = { refresh?: string; accountId?: string; inboxId?: string };

const SIG = "Regards,\nSohail Anwar\nSource Pivot";
export const DEFAULT_TEMPLATES: Template[] = [
  {
    subject: "{Request for Meeting|Quick introduction|Potential collaboration}",
    body: `{Hi|Hello} {{FirstName}},\n\nI'm reaching out to explore a potential collaboration with {{CompanyName}}.\n\nWe support research teams with B2B recruitment and fieldwork across APAC, EMEA, and the Americas, particularly for niche and hard-to-reach audiences.\n\nIf {{CompanyName}} has any upcoming projects where additional recruitment or fieldwork support could be useful, I'd be happy to explore how we can help.\n\nWould you be open to a quick 15-minute call next week?\n\n${SIG}`,
  },
  {
    subject: "Re: Request for Meeting",
    body: `{Hi|Hello} {{FirstName}},\n\n{Just following up on my previous note.|Just circling back on my earlier message.|Wanted to quickly follow up on my last note.}\n\nWould you be available for a quick introductory call?\n\n{Looking forward to hearing from you.|Happy to work around your schedule.}\n\n${SIG}`,
  },
  {
    subject: "Re: Request for Meeting",
    body: `{Hello|Hi} {{FirstName}},\n\nI wanted to check back in case additional recruitment or fieldwork support is relevant to any projects currently in your pipeline.\n\nWe can help source niche professional audiences and provide fieldwork support across multiple markets, depending on your project needs.\n\nIf there's a brief you're able to share, I'd be glad to review it and provide an initial feasibility assessment.\n\n${SIG}`,
  },
  {
    subject: "Re: Request for Meeting",
    body: `{Hello|Hi} {{FirstName}},\n\nI know priorities and project timelines can shift, so I wanted to reach out {one last time|once more}.\n\nIf your team needs additional support reaching hard-to-find professionals or managing fieldwork for an upcoming study, Source Pivot would be glad to be considered.\n\nFeel free to keep my details on hand, and reach out whenever a suitable requirement comes up.\n\n${SIG}`,
  },
  {
    subject: "Re: Request for Meeting",
    body: `{Hello|Hi} {{FirstName}},\n\n{Just a final check-in from my side.|Just one more note from my side.}\n\nWould you be available for a quick introductory call? If now isn't the right time, no problem at all.\n\n{Looking forward to hearing from you.|Thanks for your time.}\n\n${SIG}`,
  },
];

export const DEFAULT_PIPELINE: PipelineCfg = {
  paused: true,
  delays: [24, 48, 168, 168],
  templates: DEFAULT_TEMPLATES,
  startH: 8,
  endH: 11,
  cap: 75,
};
export const DEFAULT_GLOBAL: GlobalCfg = {
  paused: true,
  senderName: "Sohail Anwar",
  fromAddress: "",
  dc: "com",
  cap: 150,
  minGap: 3,
  maxGap: 14,
  breakChance: 0.1,
};
export const DEFAULT_STATE: State = { nextAllowed: 0, stamps: [], seen: [] };

/** key/value store living in a hidden-ish tab of the main sheet. */
export async function loadConfig(): Promise<Record<string, string>> {
  await ensureTab(CONFIG_TAB);
  const rows = await readTab(CONFIG_TAB);
  const out: Record<string, string> = {};
  rows.forEach((r) => { if (r[0]) out[r[0]] = r[1] || ""; });
  return out;
}

export async function saveKey(key: string, value: unknown) {
  await ensureTab(CONFIG_TAB);
  const rows = await readTab(CONFIG_TAB);
  let idx = rows.findIndex((r) => r[0] === key);
  if (idx < 0) idx = rows.length;
  await writeCells(CONFIG_TAB, [
    { r: idx, c: 0, v: key },
    { r: idx, c: 1, v: JSON.stringify(value) },
  ]);
}

function parse<T>(raw: string | undefined, def: T): T {
  if (!raw) return def;
  try { return { ...def, ...JSON.parse(raw) }; } catch { return def; }
}
export const getGlobal = (c: Record<string, string>) => parse<GlobalCfg>(c["global"], DEFAULT_GLOBAL);
export const getPipeline = (c: Record<string, string>, id: string) => parse<PipelineCfg>(c["pipeline:" + id], DEFAULT_PIPELINE);
export const getState = (c: Record<string, string>) => parse<State>(c["state"], DEFAULT_STATE);
export const getZoho = (c: Record<string, string>) => parse<ZohoState>(c["zoho"], {});
