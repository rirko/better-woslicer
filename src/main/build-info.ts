import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Language } from "../core/language.js";

export interface BuildInfo {
  version: string;
  commit: string;
  dirty: boolean;
  /** ISO 8601 UTC build timestamp, not the commit date or app launch time. */
  builtAt: string;
}

export function parseBuildInfo(input: unknown): BuildInfo {
  if (typeof input !== "object" || input === null) throw new Error("Missing build information");
  const info = input as Record<string, unknown>;
  if (typeof info.version !== "string" || !/^\d+\.\d+\.\d+$/.test(info.version) ||
      typeof info.commit !== "string" || !/^[a-f0-9]{40,64}$/.test(info.commit) ||
      typeof info.dirty !== "boolean" || typeof info.builtAt !== "string" ||
      !Number.isFinite(Date.parse(info.builtAt)) || new Date(info.builtAt).toISOString() !== info.builtAt) {
    throw new Error("Invalid build information; rebuild the application");
  }
  return info as unknown as BuildInfo;
}

export function readBuildInfo(): BuildInfo {
  return parseBuildInfo(JSON.parse(readFileSync(join(__dirname, "build-info.json"), "utf8")));
}

export function formatBuildDetails(info: BuildInfo, language: Language): string {
  const labels = {
    en: { commit: "Commit", date: "Built (UTC)", dirty: "modified working tree" },
    zh: { commit: "提交", date: "构建日期（UTC）", dirty: "包含未提交修改" },
    ja: { commit: "コミット", date: "ビルド日時（UTC）", dirty: "未コミットの変更あり" },
    ko: { commit: "커밋", date: "빌드 날짜 (UTC)", dirty: "커밋되지 않은 변경 포함" },
  }[language];
  return `${labels.commit}: ${info.commit}${info.dirty ? ` (${labels.dirty})` : ""}\n` +
    `${labels.date}: ${info.builtAt}`;
}
